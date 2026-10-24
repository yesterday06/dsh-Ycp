/**
 * dsh-brain · 注入。
 *
 * 成本结构（DESIGN 第三节 / DESIGN-1.1 第五节）：
 *   - 每个会话首步：baseline 卡全文（默认 ≤1300 字）+ 当前工作区 00-概况 摘要（≤120 字）；
 *   - 由封存创建的新会话首步：任务卡全文（≤800 字）优先，其次画像、概况，总预算 1500 字；
 *   - 之后每步：BM25 top-2，单卡 ≤600 字；0 命中不注入；
 *   - 每轮硬上限默认 2400 字（约 800 token），超了截断并记日志。
 *
 * baseline 在压缩 / 清空后允许重新出现一次：消息条数下降就是「换代」信号。
 */
import { cardBody, cardBrief, clip, isSealCard, REALTIME_CARD_LIMIT, sealFromOf } from './cards.js'
import { appendLog, sealRecordFor } from './paths.js'
import { searchCards } from './search.js'

export const DISCIPLINE = [
  '> **引用纪律**：以下是过去某一刻写下的记录，不是当前事实。',
  '> 提到文件路径先确认存在，提到函数 / 配置项先 grep，要据此动手前先核实当前代码。',
  '> 「记忆里写着 X 存在」不等于「X 现在存在」。',
].join('\n')

export function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block) return ''
      if (block.type === 'text') return block.text || ''
      return ''
    })
    .join('\n')
    .trim()
}

function messagesOf(session) {
  try {
    const derived = session.deriveMessages()
    if (Array.isArray(derived)) return derived
    if (derived && typeof derived.then === 'function') return null
  } catch {
    return null
  }
  return null
}

/**
 * 本会话是不是由封存创建的（DESIGN-1.1 第五节）。
 * 两个条件同时成立才算：state.handoffs 里有 kind=seal 且 to=本会话；
 * 实时卡确实是封存卡，且「来自会话」对得上那条记录。
 */
export function sealedCardFor(state, sessionId, cards) {
  const record = sealRecordFor(state, sessionId)
  if (!record) return null
  const card = cards.find((c) => c.layer === 'realtime' && c.file === '当前任务.md')
  if (!card) return null
  const body = cardBody(card)
  if (!isSealCard(body)) return null
  const from8 = String(record.from || '').replace(/^session-/, '').slice(0, 8)
  const cardFrom = sealFromOf(body)
  if (from8 && cardFrom && !cardFrom.startsWith(from8) && !from8.startsWith(cardFrom)) return null
  return { record, card, text: body }
}

export function createInjector({ ctx, store, getSettings, getPrompt, getState, onInjection }) {
  const sessions = new Map()

  function stateFor(sessionId) {
    let state = sessions.get(sessionId)
    if (!state) {
      state = { baselineDone: false, messageCount: 0, lastSignature: '', lastFiles: [] }
      sessions.set(sessionId, state)
    }
    return state
  }

  function baselineText(cards, settings) {
    const baselines = cards.filter((c) => c.baseline)
    const chosen = baselines.length ? baselines : cards.filter((c) => /用户-画像|user-画像/i.test(c.file))
    const parts = []
    let left = Math.max(120, Number(settings.baselineChars) || 1300)
    for (const card of chosen) {
      if (left <= 40) break
      const body = clip(cardBody(card), Math.min(left, 1300))
      if (!body) continue
      parts.push(`### ${card.title}（${card.file}）\n${body}`)
      left -= body.length
    }
    return parts.join('\n\n')
  }

  function summaryText(cards, settings) {
    const overview = cards.find((c) => c.layer === 'project' && /00-概况/.test(c.file))
    if (!overview) return ''
    const budget = Number(settings.summaryChars) || 120
    if (budget <= 0) return ''
    return clip(cardBrief(overview, budget), budget)
  }

  const injector = async function inject(assembly, context, next) {
    const assembled = await next()
    const session = context?.agent?.session
    if (!session) return assembled
    let sessionId = ''
    try {
      sessionId = String(session.id || '')
      const messages = messagesOf(session)
      if (!messages) {
        appendLog('注入跳过：session.deriveMessages() 不可用', { sessionId })
        return assembled
      }
      const state = stateFor(sessionId)
      if (messages.length < state.messageCount) {
        // 压缩 / 清空：baseline 与预算重新开始。
        state.baselineDone = false
        state.lastSignature = ''
      }
      state.messageCount = messages.length

      const settings = getSettings()
      const cwd = session.header?.cwd || process.cwd()
      const cards = store.allCards(cwd, { includeRealtime: true })

      const userMessages = messages.filter((m) => m?.role === 'user' && m?.source?.kind === 'user')
      const fromHistory = extractText(userMessages[userMessages.length - 1]?.content).trim()
      const cached = typeof getPrompt === 'function' ? String(getPrompt(sessionId) || '').trim() : ''
      const query = (fromHistory || cached).slice(0, 2000)

      const wasFirst = !state.baselineDone
      const sealed = wasFirst
        ? sealedCardFor(typeof getState === 'function' ? getState() : null, sessionId, cards)
        : null

      const parts = []
      let baselinePart = ''
      let budget = Math.max(400, Number(settings.maxRoundChars) || 2400)

      if (wasFirst && sealed) {
        // 封存后的首步：任务卡全文优先，总预算 ≤ firstStepChars（默认 1500 字）。
        budget = Math.max(600, Number(settings.firstStepChars) || 1500)
        const prefixLen = `## 记忆大脑 · 记忆注入\n${DISCIPLINE}\n\n`.length
        const taskBody = clip(sealed.text, REALTIME_CARD_LIMIT)
        const taskPart = `### 任务卡（由封存创建，先按它接着干）\n${taskBody}`
        parts.push(taskPart)

        const overviewHead = '### 当前工作区概况\n'
        const baseHead = '### 用户画像（每会话首步）\n'
        const left = budget - prefixLen - taskPart.length - 2
        const summaryBudget = Math.min(
          Number(settings.summaryChars) || 120,
          Math.max(0, left - 300 - overviewHead.length),
        )
        const baseBudget = Math.max(
          200,
          Math.min(Number(settings.baselineChars) || 1300, left - overviewHead.length - summaryBudget - baseHead.length),
        )
        baselinePart = baselineText(cards, { ...settings, baselineChars: baseBudget })
        if (baselinePart) parts.push(`### 用户画像（每会话首步）\n${baselinePart}`)
        const summary = summaryText(cards, { ...settings, summaryChars: summaryBudget })
        if (summary) parts.push(`### 当前工作区概况\n${summary}`)
        state.baselineDone = true
      } else if (wasFirst) {
        baselinePart = baselineText(cards, settings)
        if (baselinePart) parts.push(`### 用户画像（每会话首步）\n${baselinePart}`)
        const summary = summaryText(cards, settings)
        if (summary) parts.push(`### 当前工作区概况\n${summary}`)
        state.baselineDone = true
      }

      let hits = []
      if (!(wasFirst && sealed) && query.trim()) {
        const exclude = new Set(cards.filter((c) => c.baseline).map((c) => c.file))
        const result = searchCards(cards, query, {
          topK: Number(settings.topK) || 2,
          maxChars: Number(settings.maxChars) || 600,
          excludeFiles: exclude,
        })
        hits = result.hits
        for (const hit of hits) {
          parts.push(`### 相关记忆：${hit.title}（${hit.file}）\n${hit.excerpt}`)
        }
      }

      if (parts.length === 0) return assembled

      let body = `## 记忆大脑 · 记忆注入\n${DISCIPLINE}\n\n${parts.join('\n\n')}`
      if (body.length > budget) {
        body = `${body.slice(0, budget)}\n\n（已按预算截断，完整内容用 memory_read 读）`
        appendLog('注入超预算，已截断', {
          sessionId,
          limit: budget,
          sealed: Boolean(sealed),
          before: parts.reduce((n, p) => n + p.length, 0),
        })
      }
      const tokens = Math.ceil(body.length / 3)
      const files = hits.map((h) => h.file)
      if (baselinePart) files.unshift('用户-画像.md')
      if (sealed) files.unshift('当前任务.md')
      const signature = `${query.slice(0, 80)}|${files.join(',')}|${body.length}`
      if (signature !== state.lastSignature) {
        appendLog('注入', {
          sessionId,
          files,
          chars: body.length,
          tokens,
          baseline: Boolean(baselinePart),
          sealed: Boolean(sealed),
          hits: hits.length,
          query: query.slice(0, 60),
        })
        state.lastSignature = signature
        state.lastFiles = files
      }
      if (typeof onInjection === 'function') {
        onInjection({
          sessionId,
          chars: body.length,
          tokens,
          files,
          baseline: Boolean(baselinePart),
          sealed: Boolean(sealed),
        })
      }

      return {
        ...assembled,
        contexts: [
          ...(assembled.contexts ?? []),
          { name: 'dsh-brain:memory', order: 1000, text: body },
        ],
      }
    } catch (error) {
      appendLog(`注入失败：${String(error?.message ?? error)}`, { sessionId })
      return assembled
    }
  }
  injector.dispose = (sessionId) => sessions.delete(String(sessionId))
  return injector
}
