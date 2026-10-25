/**
 * dsh-Ycp · 试说一句（Host 半）—— P03 的 /say 后端。
 *
 * 一次说话的流程：
 *   1. 校验输入、总开关
 *   2. 模型跟随当前对话（agentDefaultModel.currentSelection），不另配 key
 *   3. 拼 system（人设全文 + 名字 + 当下）
 *   4. ctx.llm.stream 收到文字增量，拼成一句话返回
 *   5. 超时 60 秒；失败给结构化原因，不编文案
 *
 * 依赖全部走可选读取（ctx.get），插件没有 llm 也能加载。
 */
import { appendLog, loadPersona, loadSettings } from './kernel/paths.js'
import { commitSay, checkSay, loadRateState } from './organs/gate.js'
import { loadSchedule } from './organs/schedule.js'
import { loadMood, recordSay, moodSummary } from './organs/mood.js'
import { appendRaw, bumpMemoryNudge, memoryNudgeText, resetMemoryNudge } from './organs/memory.js'
import { appendTurn, loadHistory } from './organs/chatlog.js'
import { bumpUsage, contextFor } from './organs/brain.js'
import { buildSystem } from './kernel/prompt.js'

const TIMEOUT_MS = 60_000
const MAX_INPUT = 2000

/** 可选读服务：没注入时 ctx.get 会抛，统一吞掉。 */
function service(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

/** 当前对话的模型；没配置返回 null。 */
export function currentModel(ctx) {
  try {
    const selection = service(ctx, 'agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    /* 服务未就绪 */
  }
  return null
}

/** 当前模型是否声明支持 reasoning effort（含 off）；查不到就当不支持，宁可不传。 */
async function reasoningOffSupported(llm, provider, model) {
  if (typeof llm?.resolveModelInfo !== 'function') return false
  try {
    const info = await llm.resolveModelInfo(provider, model)
    return Boolean(info?.reasoning?.efforts?.some((effort) => effort?.id === 'off'))
  } catch {
    return false
  }
}

/**
 * 把状态翻译成语气指令。
 * 不报数字（她不该张口就说“体力 62”），只说怎么说话。
 */
function toneLine(summary) {
  if (!summary) return ''
  const parts = []
  const energy = Number(summary.energy) || 0
  const mood = Number(summary.mood) || 0
  const hunger = Number(summary.hunger) || 0
  if (energy <= 25) parts.push('你很累，句子短、懒得展开')
  else if (energy <= 45) parts.push('你有点没劲，能短就短')
  if (hunger >= 80) parts.push('你饿了，可能顺口提吃的')
  else if (hunger >= 60) parts.push('你有点饿')
  if (mood <= 30) parts.push('你心情不好，嘴硬、不撒娇')
  else if (mood >= 78) parts.push('你心情不错，愿意多接一句、会玩')
  if (!parts.length) return ''
  return '【你的状态】' + parts.join('；') + '。别说数字，也别解释自己的状态。'
}

/** 没有正文时，把终止块翻成人话。 */
function noTextReason(finish) {  const { kind, failure } = finish ?? {}
  if (kind === 'aborted') return '等太久了，这次没说完'
  if (kind === 'max-tokens') return '话说满了，没吐出正文'
  if (kind !== 'error') return '模型没说话'
  if (typeof failure?.message === 'string' && failure.message.trim()) return failure.message
  if (typeof failure?.code === 'string' && failure.code.trim()) return failure.code
  return '模型报错，没给原因'
}

export function createSayService(ctx, options = {}) {
  const toolRegistry = options.tools || null
  const autoSelf = options.autoSelf || null
  const desktop = options.desktop || null
  async function say(input, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date()
    const text = String(input?.text ?? '').trim()
    const channel = String(input?.channel || 'panel')
    if (!text) return { ok: false, reason: 'empty', error: '说点什么再试' }
    if (text.length > MAX_INPUT) return { ok: false, reason: 'too-long', error: `一次最多 ${MAX_INPUT} 字` }

    const settings = loadSettings()
    const schedule = loadSchedule()
    const rate = loadRateState()

    // 五道闸：总开关 → 睡眠 → 安静时段 →（手权限对说话不适用）→ 频率
    const gate = checkSay({ settings, schedule, now, rate })
    if (!gate.allow) {
      appendLog('被闸门挡住', { reason: gate.reason, used: gate.used, limit: gate.limit })
      return {
        ok: false,
        reason: gate.reason,
        error: gate.error,
        ...(gate.retryAfterSec ? { retryAfterSec: gate.retryAfterSec } : {}),
      }
    }

    // 放行就记账：模型请求马上要花出去了，失败也算一次尝试。
    commitSay(rate, now)

    // 开口前先想起事：核心记忆（按重要度）+ 相关记忆（按问题检索）+ 此刻场景。
    // 聊天记录只带最近 8 轮——更早的事由记忆卡和日记承载，不再把全部历史重发。
    const history = loadHistory({ maxMessages: 8, maxChars: 2400 })
    const historyBlock = history.length
      ? '\n\n【最近对话】\n' + history.map((item) => (item.role === 'assistant' ? '我：' : '主人：') + item.text).join('\n')
      : ''
    const recentUser = history
      .filter((item) => item.role === 'user')
      .slice(-3)
      .map((item) => item.text)
      .join('\n')
    const query = recentUser ? recentUser + '\n' + text : text
    const recalled = contextFor(query)

    // 状态进语气：体力 / 心情 / 饿，不报数字，只影响怎么说话。
    let moodLine = ''
    try {
      moodLine = toneLine(moodSummary(loadMood(now, schedule)))
    } catch { /* 状态读不到就不带 */ }

    // 感知：她开口前先知道主人现在在哪个窗口，不是瞎猜。
    let scene = ''
    try {
      if (desktop && typeof desktop.info === 'function') {
        const info = await desktop.info()
        const foreground = String(info?.foreground ?? '').trim()
        if (foreground) scene = '【眼前】系统刚读到的前台窗口标题是「' + foreground.slice(0, 80) + '」。这是真实窗口信息，不是猜的；被问“你能看到什么”时据此回答。'
      }
    } catch { /* 桌面手不可用就不带 */ }

    const memoryText = [
      recalled.core ? '【你一直记得的】\n' + recalled.core : '',
      recalled.recall ? '【你记得的】\n' + recalled.recall : '',
      recalled.scene ? '【此刻】\n' + recalled.scene : '',
    ].filter(Boolean).join('\n\n')

    const system = buildSystem({
      persona: loadPersona(),
      name: settings.name,
      memories: memoryText,
      extra: [
        gate.sleepy
          ? '【这会儿】你困得厉害，是被人叫醒的。只回很短的一句，带着困意，别硬撑着聊天。'
          : '',
        moodLine,
        memoryNudgeText(),
        scene,
      ].filter(Boolean).join('\n\n'),
    })
    const started = Date.now()
    const pieces = []
    let finish = null
    let usedModel = ''

    const custom = settings.model
    const customReady = Boolean(custom && custom.baseUrl && custom.apiKey && custom.model)
    if (customReady) {
      try {
        const url = custom.baseUrl.replace(/\/+$/, '') + '/chat/completions'
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${custom.apiKey}` },
          body: JSON.stringify({
            model: custom.model,
            messages: [
              { role: 'system', content: system + historyBlock },
              { role: 'user', content: text },
            ],
            temperature: 1,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`接口返回 ${response.status}`)
        const data = await response.json()
        const content = data?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || !content.trim()) throw new Error('接口没返回正文')
        pieces.push(content)
        usedModel = `custom/${custom.model}`
      } catch (error) {
        const message = String(error?.message ?? error)
        appendLog('自定义接口说话失败', { error: message })
        return { ok: false, reason: 'generate-error', error: message }
      }
    } else {
      const model = currentModel(ctx)
      if (!model) return { ok: false, reason: 'provider-missing', error: '还没选模型，也没配自定义接口' }
      const llm = service(ctx, 'llm')
      if (!llm || typeof llm.stream !== 'function') {
        return { ok: false, reason: 'llm-missing', error: 'LLM 服务不可用' }
      }
      usedModel = `${model.provider}/${model.model}`
      try {
        const wantsOff = await reasoningOffSupported(llm, model.provider, model.model)
        // 不再用原生 tool schema（模型接口对 id/消息结构很挑，容易整段失败）。
        // 改成“文字指令”：模型只输出一行 <<TOOL 工具名 {...}>>，宿主执行后把结果当对话喂回去。
        const CATALOG_IDS = [
          'memory.card', 'memory.raw', 'memory.list', 'memory.forget', 'memory.consolidate',
          'memory.reflect', 'memory.check', 'memory.merge', 'memory.recall',
          'diary.write', 'persona.grow', 'name.set', 'signature.set', 'schedule.set', 'proactive.set',
          'qq.send', 'desktop.ui', 'desktop.clickText', 'desktop.setValue', 'desktop.window', 'desktop.launch', 'browser.login', 'browser.goto', 'browser.text', 'browser.click',
          'bili.comment', 'bili.like', 'bili.dynamic', 'site.api',
        ]
        const catalog = toolRegistry && typeof toolRegistry.listTools === 'function'
          ? toolRegistry.listTools().filter((tool) => tool && tool.id && CATALOG_IDS.includes(tool.id))
          : []
        const toolNote = catalog.length
          ? '\n\n【工具】要用工具时，只输出一行：<<TOOL 工具名 {"参数":值}>>，不要解释。结果会以“工具结果”回给你。\n' +
            catalog.map((tool) => `- ${tool.id}：${String(tool.description || '').slice(0, 90)} 参数 ${JSON.stringify(tool.schema)}`).join('\n')
          : ''
        const systemWithTools = system + toolNote + historyBlock
        const messages = [{ role: 'user', content: [{ type: 'text', text }] }]
        let toolContext = ''
        let finalText = ''
        for (let round = 0; round < 3; round += 1) {
          let roundText = ''
          const stream = llm.stream({
            provider: model.provider,
            model: model.model,
            system: systemWithTools + (toolContext ? '\n\n【工具结果】\n' + toolContext + '\n工具已经执行完，现在只用一句自然的话回复主人，不要再输出任何 <<TOOL>> 指令。' : ''),
            messages,
            temperature: 1,
            sessionId: 'dsh-Ycp',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            ...(wantsOff ? { reasoningEffort: 'off' } : {}),
          })
          for await (const chunk of stream) {
            if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') roundText += chunk.text
            else if (chunk?.type === 'finish') finish = chunk.reason ?? null
          }
          const match = /<<TOOL\s+([\w.]+)\s*(\{[\s\S]*?\})?\s*>>/.exec(roundText)
          if (!match) { finalText += roundText; break }
          finalText += roundText.replace(match[0], '')
          const toolId = match[1]
          let args = {}
          try { args = JSON.parse(match[2] || '{}') } catch { args = {} }
          const result = toolRegistry ? await toolRegistry.invoke(toolId, args) : { ok: false, error: '没有工具注册表' }
          if (['memory.card', 'diary.write', 'persona.grow'].includes(toolId)) resetMemoryNudge()
          toolContext += '工具 ' + toolId + ' 结果：' + JSON.stringify(result).slice(0, 3000) + '\n'
        }
        if (!finalText.trim()) {
          // 工具执行完模型可能只吐了指令没吐正文：再要一次纯回复。
          try {
            let tail = ''
            const stream = llm.stream({
              provider: model.provider,
              model: model.model,
              system: system + historyBlock + '\n\n工具已经执行完，现在只用一句自然的话回复主人，不要再输出任何工具指令。',
              messages,
              temperature: 1,
              sessionId: 'dsh-Ycp',
              signal: AbortSignal.timeout(TIMEOUT_MS),
              ...(wantsOff ? { reasoningEffort: 'off' } : {}),
            })
            for await (const chunk of stream) {
              if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') tail += chunk.text
            }
            finalText = tail
          } catch { /* 还不行就算了 */ }
        }
        pieces.push(finalText)
      } catch (error) {
        const message = String(error?.message ?? error)
        appendLog('说话失败', { error: message })
        return { ok: false, reason: 'generate-error', error: message }
      }
    }

    const reply = pieces.join('').trim()
    if (!reply) {
      const error = noTextReason(finish)
      appendLog('说话没正文', { kind: finish?.kind ?? 'unknown', error })
      return { ok: false, reason: 'generate-error', error }
    }

    const ms = Date.now() - started
    try {
      appendRaw({ source: 'chat', text: '主人：' + text + '\n我：' + reply, meta: { model: usedModel, ms, channel } })
      appendTurn(text, reply)
      bumpMemoryNudge()
      // 想过的事记一笔，下次更容易被想起。
      if (recalled.files.length) bumpUsage(recalled.files)
      // 人不用提醒：攒够一段，后台自己整理成卡/日记/成长。
      if (autoSelf) {
        const nextHistory = [...history, { role: 'user', text }, { role: 'assistant', text: reply }]
        autoSelf.maybe(nextHistory).catch(() => {})
      }
    } catch { /* 原始记忆记不上不影响说话 */ }
    const recalledList = recalled.files.map((file) => ({ file }))

    // 说完一句就结账：体力掉、饿一点、心情好一点、今天多说一句。
    let mood = null
    try {
      mood = moodSummary(recordSay(now, schedule))
    } catch (error) {
      appendLog('心情结算失败', { error: String(error?.message ?? error) })
    }

    appendLog('说话', {
      chars: reply.length,
      model: usedModel,
      ms,
      sleepy: Boolean(gate.sleepy),
      recalled: recalledList.map((item) => item.file),
    })
    return {
      ok: true,
      text: reply,
      model: usedModel,
      ms,
      awake: !gate.sleepy,
      sleepy: Boolean(gate.sleepy),
      recalled: recalledList,
      mood,
      // 这一轮真正发出去的上下文长度（账本按它算，不再只算一问一答）。
      promptChars: system.length + historyBlock.length + text.length,
    }
  }

  return { say, currentModel: () => currentModel(ctx) }
}
