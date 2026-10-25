/**
 * dsh-Ycp · 聊天记录（器官）
 *
 * 目的：她不是每句话都重新认识主人。把最近对话落盘，下一次说话带上。
 *
 * 存法：<家>/状态/对话/历史.json
 *   { messages: [{ role: 'user'|'assistant', text, at }] }
 *
 * 只留最近 MAX_KEEP 条 / MAX_CHARS 字；更早的靠记忆卡与日记，不靠聊天记录。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homePaths, writeAtomic } from '../kernel/paths.js'

const MAX_KEEP = 800
const MAX_CHARS = 600000
const DEFAULT_MESSAGES = 400
const DEFAULT_CHARS = 200000

function historyFile() {
  return join(homePaths().root, '状态', '对话', '历史.json')
}

function readAll() {
  try {
    const data = JSON.parse(readFileSync(historyFile(), 'utf8'))
    return Array.isArray(data?.messages) ? data.messages : []
  } catch {
    return []
  }
}

/** 最近对话，按时间正序；给模型用。 */
export function loadHistory({ maxMessages = DEFAULT_MESSAGES, maxChars = DEFAULT_CHARS } = {}) {
  const all = readAll()
  const picked = []
  let chars = 0
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const item = all[index]
    const text = String(item?.text ?? '').trim()
    if (!text) continue
    if (picked.length >= maxMessages || chars + text.length > maxChars) break
    picked.unshift({ role: item.role === 'assistant' ? 'assistant' : 'user', text })
    chars += text.length
  }
  return picked
}

/**
 * 面板翻聊天记录用：按时间正序返回一段，带 hasMore。
 * @param {{limit?: number, before?: number}} [options] before = 已知最旧一条的时间戳，取它之前的
 */
export function loadMessages({ limit = 30, before = 0 } = {}) {
  const all = readAll().filter((item) => String(item?.text ?? '').trim())
  const cut = Number(before) || 0
  const pool = cut > 0 ? all.filter((item) => Number(item.at || 0) < cut) : all
  const take = Math.max(1, Math.min(200, Number(limit) || 30))
  const messages = pool.slice(-take).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    text: String(item.text),
    at: Number(item.at || 0),
  }))
  return {
    messages,
    hasMore: pool.length > messages.length,
    total: all.length,
  }
}

/** 一次对话完成后追加两条；只留最近一段。 */
export function appendTurn(user, assistant, now = Date.now()) {
  const text = String(user ?? '').trim()
  const reply = String(assistant ?? '').trim()
  if (!text || !reply) return { ok: false }
  const messages = readAll()
  messages.push({ role: 'user', text, at: now })
  messages.push({ role: 'assistant', text: reply, at: now })
  let trimmed = messages.slice(-MAX_KEEP)
  let chars = trimmed.reduce((sum, item) => sum + String(item.text ?? '').length, 0)
  while (trimmed.length > 2 && chars > MAX_CHARS) {
    chars -= String(trimmed[0].text ?? '').length
    trimmed = trimmed.slice(1)
  }
  try {
    mkdirSync(join(homePaths().root, '状态', '对话'), { recursive: true })
    writeAtomic(historyFile(), JSON.stringify({ messages: trimmed }))
    return { ok: true, messages: trimmed.length }
  } catch {
    return { ok: false }
  }
}

/** 面板/主人清空当前对话（不动记忆）。 */
export function clearHistory() {
  try {
    if (existsSync(historyFile())) writeAtomic(historyFile(), JSON.stringify({ messages: [] }))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
