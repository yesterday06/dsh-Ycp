/**
 * dsh-Ycp · 大肥鱼（器官）—— 日记（她自己写）。
 *
 * 只写进她自己的家：<家>\记忆\日记\YYYY-MM-DD.md。
 * 有模型时，用人设 + 今天的统计 + 当前作息状态生成第一人称日记；
 * 没模型或生成失败时，可以退回收到的原文（面板传 text）。
 */
import { appendLog, loadPersona, loadSettings } from '../kernel/paths.js'
import { buildSystem } from '../kernel/prompt.js'
import { appendDiary } from './memory.js'
import { todaySummary } from './mood.js'
import { describeStatus, loadSchedule } from './schedule.js'

function service(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function currentModel(ctx) {
  try {
    const selection = service(ctx, 'agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
  } catch { /* 服务未就绪 */ }
  return null
}

export function createDiaryWriter({ ctx } = {}) {
  async function write({ text } = {}) {
    const given = String(text ?? '').trim()
    if (given) return appendDiary(given)

    const llm = service(ctx, 'llm')
    const model = currentModel(ctx)
    if (!llm || typeof llm.stream !== 'function' || !model) {
      return { ok: false, error: '没有可用模型，先在 DSH 里选一个模型，或者直接给她一段话让她记' }
    }
    const settings = loadSettings()
    const mood = todaySummary(new Date(), loadSchedule())
    const status = describeStatus(loadSchedule(), new Date())
    const system = buildSystem({
      persona: loadPersona(),
      name: settings.name,
      now: new Date(),
      extra: [
        '【你在写今天的日记】只写日记正文，第一人称，像讲故事。',
        '写具体的事、对话、翻车、心理，不要写成汇报，不要列清单，不要加标题。',
        '字数 200–500 字。写完就停。',
      ].join('\n'),
    })
    const user = [
      `今天是 ${new Date().toLocaleDateString('zh-CN')}。`,
      `我现在的状态：${status.label}；体力 ${mood.energy}，心情 ${mood.mood}，饿 ${mood.hunger}。`,
      `今天我说了 ${mood.stats.said} 句，主动开口 ${mood.stats.proactive} 次，查网 ${mood.stats.web} 次。`,
      '写一篇今天的日记。',
    ].join('\n')

    const pieces = []
    try {
      const stream = llm.stream({
        provider: model.provider,
        model: model.model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        temperature: 0.9,
        sessionId: 'dsh-Ycp',
        signal: AbortSignal.timeout(60_000),
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') pieces.push(chunk.text)
      }
    } catch (error) {
      appendLog('写日记失败', { error: String(error?.message ?? error) })
      return { ok: false, error: String(error?.message ?? error) }
    }
    const body = pieces.join('').trim()
    if (!body) return { ok: false, error: '模型没写出内容' }
    const result = appendDiary(body)
    return { ...result, chars: body.length, model: `${model.provider}/${model.model}` }
  }

  return { write }
}
