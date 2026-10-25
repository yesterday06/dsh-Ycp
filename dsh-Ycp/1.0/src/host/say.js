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
    const recentUser = history
      .filter((item) => item.role === 'user')
      .slice(-3)
      .map((item) => item.text)
      .join('\n')
    const query = recentUser ? recentUser + '\n' + text : text
    const recalled = search(query, { topK: settings.memoryTopK, maxChars: settings.memoryMaxChars })

    const system = buildSystem({
      persona: loadPersona(),
      name: settings.name,
      memories: [identityBlock(), memoryBlock(recalled)].filter(Boolean).join('\n\n'),
      extra: [
        gate.sleepy
          ? '【这会儿】你困得厉害，是被人叫醒的。只回很短的一句，带着困意，别硬撑着聊天。'
          : '',
        memoryNudgeText(),
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
              { role: 'system', content: system },
              ...history.map((item) => ({ role: item.role, content: item.text })),
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
        // 模型接口只接受 [a-zA-Z0-9_-]；插件工具 id 带点（memory.raw、name.set），
        // 发给模型时统一换成下划线，调用回来再映射回真实 id。
        const toolIds = new Map()
        const tools = toolRegistry && typeof toolRegistry.listTools === 'function'
          ? toolRegistry.listTools()
              .filter((tool) => tool && tool.schema && tool.id)
              .map((tool) => {
                const apiName = String(tool.id).replace(/[^a-zA-Z0-9_-]/g, '_')
                toolIds.set(apiName, tool.id)
                return { name: apiName, description: String(tool.description || ''), parameters: tool.schema }
              })
          : []
        const messages = [
          ...history.map((item) => ({ role: item.role, content: [{ type: 'text', text: item.text }] })),
          { role: 'user', content: [{ type: 'text', text }] },
        ]
        let finalText = ''
        for (let round = 0; round < 4; round += 1) {
          const calls = new Map()
          let roundText = ''
          const stream = llm.stream({
            provider: model.provider,
            model: model.model,
            system,
            messages,
            temperature: 1,
            sessionId: 'dsh-Ycp',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            ...(wantsOff ? { reasoningEffort: 'off' } : {}),
            ...(tools.length ? { tools } : {}),
          })
          for await (const chunk of stream) {
            if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') roundText += chunk.text
            else if (chunk?.type === 'tool-call-delta') {
              const key = chunk.index ?? calls.size
              const entry = calls.get(key) || { id: chunk.id, name: chunk.name || '', arguments: '' }
              if (chunk.name) entry.name = chunk.name
              if (chunk.argumentsDelta) entry.arguments += chunk.argumentsDelta
              calls.set(key, entry)
            } else if (chunk?.type === 'finish') finish = chunk.reason ?? null
          }
          finalText += roundText
          const list = [...calls.values()].filter((call) => call.name)
          if (list.length === 0) break
          messages.push({
            role: 'assistant',
            id: 'm-' + Date.now() + '-' + round,
            source: { kind: 'model', provider: model.provider, model: model.model },
            content: [
              ...(roundText ? [{ type: 'text', text: roundText }] : []),
              ...list.map((call) => ({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments || '{}' })),
            ],
          })
          for (const call of list) {
            let args = {}
            try { args = JSON.parse(call.arguments || '{}') } catch { args = {} }
            const result = toolRegistry ? await toolRegistry.invoke(toolIds.get(call.name) || call.name, args) : { ok: false, error: '没有可用的工具注册表' }
            const realId = toolIds.get(call.name) || call.name
            if (['memory.card', 'diary.write', 'persona.grow'].includes(realId)) resetMemoryNudge()
            const content = JSON.stringify(result).slice(0, 4000)
            messages.push({
              role: 'tool',
              id: 't-' + call.id,
              source: { kind: 'tool', callId: call.id },
              toolCallId: call.id,
              isError: !result?.ok,
              content: [{ type: 'text', text: content }],
            })
          }
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
