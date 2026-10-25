/**
 * dsh-Ycp · 自动记忆（器官）
 *
 * 两条线：
 *   1. maybe()：聊完一段（≥6 条、距上次 ≥10 分钟）把最近的对话提炼成卡 / 日记 / 成长。
 *   2. reflect()：每天从原始记忆里回看一次（默认 6 小时内只做一次），长出更长期的卡。
 *
 * 两条线都走 brain.upsertCard：先查重合并，再新建，不会再堆重复卡。
 * 失败只写日志，不影响说话；想省 token 可在 settings.autoMemory 关掉。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reflect as brainReflect, upsertCard } from './brain.js'
import { appendDiary } from './memory.js'
import { appendGrowth, appendLog, homePaths, loadSettings, writeAtomic } from '../kernel/paths.js'

const MIN_MESSAGES = 6
const MIN_GAP_MS = 10 * 60 * 1000
const MAX_TRANSCRIPT = 6000

function statePath() {
  return join(homePaths().root, '状态', '自动记忆.json')
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'))
  } catch {
    return { lastAt: 0 }
  }
}

function saveState(state) {
  try {
    writeAtomic(statePath(), JSON.stringify(state))
  } catch { /* 失败不影响 */ }
}

async function streamText(llm, { provider, model, system, user, timeoutMs = 90_000 }) {
  let text = ''
  const stream = llm.stream({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    temperature: 0.3,
    sessionId: 'dsh-Ycp-auto-memory',
    signal: AbortSignal.timeout(timeoutMs),
  })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text
}

export function createAutoSelf({ ctx } = {}) {
  let busy = false

  function model() {
    const selection = ctx?.get?.('agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
    return null
  }

  function llm() {
    const service = ctx?.get?.('llm')
    return service && typeof service.stream === 'function' ? service : null
  }

  async function maybe(history = []) {
    const settings = loadSettings()
    if (settings.autoMemory === false) return { ok: false, reason: 'off' }
    if (busy) return { ok: false, reason: 'busy' }
    if (!Array.isArray(history) || history.length < MIN_MESSAGES) return { ok: false, reason: 'short' }
    const state = readState()
    if (Date.now() - Number(state.lastAt || 0) < MIN_GAP_MS) return { ok: false, reason: 'cooling' }

    const service = llm()
    const current = model()
    if (!service || !current) return { ok: false, reason: 'no-model' }

    busy = true
    try {
      const transcript = history
        .slice(-16)
        .map((item) => `${item.role === 'assistant' ? '我' : '主人'}：${item.text}`)
        .join('\n')
        .slice(-MAX_TRANSCRIPT)
      const system = [
        '你在替“阿闷”整理长期记忆。只根据下面的对话，不编造。',
        '输出严格 JSON，不要解释、不要代码块：',
        '{"cards":[{"title":"中文短语","body":"一段稳定的偏好/事实/约定/关系","tags":["标签"],"importance":3}],"diary":"今天发生的事，第一人称，50-200字","growth":"如果她有想通/变化，写一句；没有就空字符串"}',
        '规则：cards 最多 3 张，只写长期有用的；同一件事只写一张；不记密码、证件、密钥；没有可写的就空数组/空字符串。',
        'importance 1-5：5=关于主人和自己的根本事实，4=长期约定/偏好，3=普通事实，2=偶然经历，1=可不记。',
      ].join('\n')

      let text = ''
      try {
        text = await streamText(service, { provider: current.provider, model: current.model, system, user: transcript })
      } catch (error) {
        appendLog('自动记忆失败', { error: String(error?.message ?? error) })
        return { ok: false, reason: 'llm' }
      }

      const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        appendLog('自动记忆解析失败', { chars: raw.length })
        return { ok: false, reason: 'parse' }
      }

      let applied = 0
      let merged = 0
      for (const card of Array.isArray(data.cards) ? data.cards.slice(0, 3) : []) {
        const title = String(card?.title || '').trim()
        const body = String(card?.body || '').trim()
        if (!title || !body) continue
        const result = upsertCard('global', {
          title,
          body,
          tags: Array.isArray(card?.tags) ? card.tags : [],
          importance: card?.importance,
          source: `对话 ${new Date().toISOString().slice(0, 10)}`,
        })
        if (result.ok) {
          applied += 1
          if (result.merged) merged += 1
        }
      }
      const diary = String(data.diary || '').trim()
      if (diary) {
        appendDiary(diary)
        applied += 1
      }
      const growth = String(data.growth || '').trim()
      if (growth) {
        appendGrowth(growth)
        applied += 1
      }

      saveState({ lastAt: Date.now() })
      appendLog('自动记忆完成', { applied, merged, cards: Array.isArray(data.cards) ? data.cards.length : 0, diary: Boolean(diary), growth: Boolean(growth) })
      return { ok: true, applied, merged }
    } catch (error) {
      appendLog('自动记忆异常', { error: String(error?.message ?? error) })
      return { ok: false, reason: 'error' }
    } finally {
      busy = false
    }
  }

  /** 从原始记忆里回看：默认 6 小时一次，force 可立刻做。 */
  async function reflect(options = {}) {
    const settings = loadSettings()
    if (settings.autoReflect === false && !options.force) return { ok: false, reason: 'off' }
    if (settings.autoMemory === false && !options.force) return { ok: false, reason: 'off' }
    const service = llm()
    const current = model()
    if (!service || !current) return { ok: false, reason: 'no-model' }
    return brainReflect({
      llm: service,
      provider: current.provider,
      model: current.model,
      force: Boolean(options.force),
      minGapMs: Number(options.minGapMs) || 6 * 3600 * 1000,
    })
  }

  return { maybe, reflect }
}
