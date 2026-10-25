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
import { recordSay, moodSummary } from './organs/mood.js'
import { appendRaw, bumpMemoryNudge, identityBlock, memoryNudgeText, resetMemoryNudge } from './organs/memory.js'
import { appendTurn, loadHistory } from './organs/chatlog.js'
import { memoryBlock, search } from './organs/search.js'
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

/** 没有正文时，把终止块翻成人话。 */
function noTextReason(finish) {
  const { kind, failure } = finish ?? {}
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

    // 开口前先想起事：全局 + 归档按分数取 top-k，实时卡必读，日记不参与。
    // 检索词带上最近几轮用户的话，免得一句“那个呢”就接不上。
    const history = loadHistory()
    const historyBlock = history.length
      ? '\n\n【最近对话】\n' + history.map((item) => (item.role === 'assistant' ? '我：' : '主人：') + item.text).join('\n')
      : ''
    const recentUser = history
      .filter((item) => item.role === 'user')
      .slice(-3)
      .map((item) => item.text)
      .join('\n')
    const query = recentUser ? recentUser + '\n' + text : text
    const recalled = search(query, { topK: settings.memoryTopK, maxChars: settings.memoryMaxChars })

    // 感知：她开口前先知道主人现在在哪个窗口，不是瞎猜。
    let scene = ''
    try {
      if (desktop && typeof desktop.info === 'function') {
        const info = await desktop.info()
        const foreground = String(info?.foreground ?? '').trim()
        if (foreground) scene = '【眼前】主人现在的前台窗口：' + foreground.slice(0, 80)
      }
    } catch { /* 桌面手不可用就不带 */ }

    const system = buildSystem({
      persona: loadPersona(),
      name: settings.name,
      memories: [identityBlock(), memoryBlock(recalled)].filter(Boolean).join('\n\n'),
      extra: [
        gate.sleepy
          ? '【这会儿】你困得厉害，是被人叫醒的。只回很短的一句，带着困意，别硬撑着聊天。'
          : '',
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
          'diary.write', 'persona.grow', 'name.set', 'signature.set', 'schedule.set', 'proactive.set',
          'qq.send', 'browser.login', 'browser.goto', 'browser.text', 'browser.click',
          'bili.comment', 'bili.like', 'site.api',
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
      // 人不用提醒：攒够一段，后台自己整理成卡/日记/成长。
      if (autoSelf) {
        const nextHistory = [...history, { role: 'user', text }, { role: 'assistant', text: reply }]
        autoSelf.maybe(nextHistory).catch(() => {})
      }
    } catch { /* 原始记忆记不上不影响说话 */ }
    const recalledList = [...recalled.hits, ...recalled.realtime].map((item) => ({
      layer: item.layer,
      file: item.file,
      title: item.title,
      score: item.score,
    }))

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
    }
  }

  return { say, currentModel: () => currentModel(ctx) }
}
