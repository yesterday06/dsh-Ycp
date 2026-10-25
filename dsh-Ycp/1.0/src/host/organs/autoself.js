/**
 * dsh-Ycp · 自动记忆（器官）
 *
 * 人不用提醒，聊完一段自己在后台把最近对话提炼成记忆。
 * 只做三件事：稳定的写卡、当天的事写日记、想通的写成长。
 *
 * 触发：最近记录 ≥8 条，且距上次自动整理 ≥20 分钟；一次只跑一个。
 * 失败只写日志，不影响说话；想更主动/更省 token 可在 settings.autoMemory 关掉。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendDiary, resetMemoryNudge, writeCard } from './memory.js'
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

function cleanFile(name, title) {
  const raw = String(name || title || '记忆').replace(/\.md$/i, '')
  const base = raw.replace(/[^\w\u4e00-\u9fa5（）()· -]/g, '').trim().slice(0, 40)
  return `${base || '记忆'}.md`
}

export function createAutoSelf({ ctx } = {}) {
  let busy = false

  async function maybe(history = []) {
    const settings = loadSettings()
    if (settings.autoMemory === false) return { ok: false, reason: 'off' }
    if (busy) return { ok: false, reason: 'busy' }
    if (!Array.isArray(history) || history.length < MIN_MESSAGES) return { ok: false, reason: 'short' }
    const state = readState()
    if (Date.now() - Number(state.lastAt || 0) < MIN_GAP_MS) return { ok: false, reason: 'cooling' }

    const llm = ctx?.get?.('llm')
    const selection = ctx?.get?.('agentDefaultModel')?.currentSelection?.()
    if (!llm || typeof llm.stream !== 'function' || !selection?.provider || !selection?.model) {
      return { ok: false, reason: 'no-model' }
    }

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
        '{"cards":[{"file":"中文短语.md","title":"标题","tags":["标签"],"body":"一段稳定的偏好/事实/约定/关系"}],"diary":"今天发生的事，第一人称，50-200字","growth":"如果她有想通/变化，写一句；没有就空字符串"}',
        '规则：cards 最多 3 张，只写长期有用的；同类信息合并；不记密码、证件、密钥；没有可写的就空数组/空字符串。',
      ].join('\n')
      const messages = [{ role: 'user', content: [{ type: 'text', text: transcript }] }]
      let text = ''
      try {
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          system,
          messages,
          temperature: 0.3,
          sessionId: 'dsh-Ycp-auto-memory',
          signal: AbortSignal.timeout(90_000),
        })
        for await (const chunk of stream) {
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        }
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
      for (const card of Array.isArray(data.cards) ? data.cards.slice(0, 3) : []) {
        const file = cleanFile(card?.file, card?.title)
        const title = String(card?.title || file.replace(/\.md$/, '')).slice(0, 60)
        const body = String(card?.body || '').trim().slice(0, 1200)
        if (!body) continue
        const tags = Array.isArray(card?.tags) ? card.tags.map((tag) => String(tag).slice(0, 20)).slice(0, 8) : []
        const content = [
          '---',
          `name: ${title}`,
          `description: ${body.replace(/\s+/g, ' ').slice(0, 80)}`,
          'metadata:',
          '  type: global',
          `  tags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
          `  updated: ${new Date().toISOString().slice(0, 10)}`,
          '---',
          '',
          body,
          '',
        ].join('\n')
        if (writeCard('global', file, content).ok) applied += 1
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
      resetMemoryNudge()
      appendLog('自动记忆完成', { applied, cards: Array.isArray(data.cards) ? data.cards.length : 0, diary: Boolean(diary), growth: Boolean(growth) })
      return { ok: true, applied }
    } catch (error) {
      appendLog('自动记忆异常', { error: String(error?.message ?? error) })
      return { ok: false, reason: 'error' }
    } finally {
      busy = false
    }
  }

  return { maybe }
}
