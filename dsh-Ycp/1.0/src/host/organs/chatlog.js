/**
 * dsh-Ycp · 聊天记录（器官）
 *
 * 存法：<家>/状态/对话/历史.jsonl，一行一条，只追加、不重写、不设上限。
 * 聊天记录最后都会进原始记忆（每天一个文件、同样不设上限）；这里只负责
 * 「随时能翻到」和「给下一次说话挑一段」。
 *
 * 读取一律从文件末尾按块倒着读，所以聊到几万条也不会一次读进内存。
 * 老版本是 历史.json（整份重写、只留 800 条），第一次用到时自动迁过来。
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { homePaths } from '../kernel/paths.js'

const CHUNK = 256 * 1024

function dirPath() {
  return join(homePaths().root, '状态', '对话')
}

function jsonlPath() {
  return join(dirPath(), '历史.jsonl')
}

function legacyPath() {
  return join(dirPath(), '历史.json')
}

function ensureDir() {
  mkdirSync(dirPath(), { recursive: true })
}

/** 老格式（历史.json）导一次到 jsonl，导完改名留档。 */
export function migrateLegacy() {
  try {
    if (existsSync(jsonlPath()) || !existsSync(legacyPath())) return { migrated: false }
    const data = JSON.parse(readFileSync(legacyPath(), 'utf8'))
    const messages = Array.isArray(data?.messages) ? data.messages : []
    const lines = messages
      .filter((item) => item && String(item.text ?? '').trim())
      .map((item) => JSON.stringify({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        text: String(item.text),
        at: Number(item.at) || 0,
      }))
    ensureDir()
    writeFileSync(jsonlPath(), lines.length ? `${lines.join('\n')}\n` : '')
    renameSync(legacyPath(), `${legacyPath()}.migrated-${Date.now()}`)
    return { migrated: true, count: lines.length }
  } catch {
    return { migrated: false, error: true }
  }
}

/** 从文件末尾读一块，拆成消息（丢弃被截断的半行）。 */
function readTail(maxBytes) {
  const file = jsonlPath()
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    return { messages: [], reachedStart: true }
  }
  if (!size) return { messages: [], reachedStart: true }
  const bytes = Math.min(size, Math.max(4096, Number(maxBytes) || CHUNK))
  const start = size - bytes
  const fd = openSync(file, 'r')
  let text = ''
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, start)
    text = buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
  const lines = text.split('\n')
  if (start > 0) lines.shift()
  const messages = []
  for (const line of lines) {
    const raw = line.trim()
    if (!raw) continue
    try {
      const item = JSON.parse(raw)
      const body = String(item?.text ?? '').trim()
      if (!body) continue
      messages.push({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        text: body,
        at: Number(item.at) || 0,
      })
    } catch { /* 坏行跳过 */ }
  }
  return { messages, reachedStart: start <= 0 }
}

/** 倒着扩窗，直到拿到足够多的消息或读到文件头。 */
function readFromEnd({ enough, maxWindow = 64 * 1024 * 1024 } = {}) {
  let windowBytes = CHUNK
  let data = readTail(windowBytes)
  while (!data.reachedStart && !enough(data.messages) && windowBytes < maxWindow) {
    windowBytes *= 2
    data = readTail(windowBytes)
  }
  return data
}

/** 老接口：给模型用的最近对话，按时间正序。 */
export function loadHistory({ maxMessages = 200, maxChars = 16_000 } = {}) {
  migrateLegacy()
  const messageLimit = Math.max(1, Number(maxMessages) || 200)
  const charLimit = Math.max(200, Number(maxChars) || 16_000)
  const data = readFromEnd({
    enough: (messages) => {
      if (messages.length < messageLimit) return false
      let chars = 0
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        chars += messages[i].text.length
        if (chars >= charLimit) return true
      }
      return false
    },
  })
  const picked = []
  let chars = 0
  for (let i = data.messages.length - 1; i >= 0; i -= 1) {
    const item = data.messages[i]
    if (picked.length >= messageLimit || chars + item.text.length > charLimit) break
    picked.unshift(item)
    chars += item.text.length
  }
  return picked
}

/**
 * 面板翻聊天记录：取 before 之前的一段（默认最新），带 hasMore。
 * @param {{limit?: number, before?: number}} [options]
 */
export function loadMessages({ limit = 30, before = 0 } = {}) {
  migrateLegacy()
  const take = Math.max(1, Math.min(200, Number(limit) || 30))
  const cut = Number(before) || 0
  const data = readFromEnd({
    enough: (messages) => {
      const older = cut > 0 ? messages.filter((item) => item.at < cut) : messages
      return older.length >= take + 1
    },
  })
  const pool = cut > 0 ? data.messages.filter((item) => item.at < cut) : data.messages
  const messages = pool.slice(-take)
  return {
    messages,
    hasMore: pool.length > messages.length || !data.reachedStart,
    total: data.messages.length,
  }
}

/** 一次对话完成后追加两条；只追加，不裁剪。 */
export function appendTurn(user, assistant, now = Date.now()) {
  const text = String(user ?? '').trim()
  const reply = String(assistant ?? '').trim()
  if (!text || !reply) return { ok: false }
  try {
    migrateLegacy()
    ensureDir()
    const lines = [
      JSON.stringify({ role: 'user', text, at: now }),
      JSON.stringify({ role: 'assistant', text: reply, at: now }),
    ].join('\n')
    appendFileSync(jsonlPath(), `${lines}\n`)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** 面板/主人清空当前对话（不动记忆、不动原始资料）。 */
export function clearHistory() {
  try {
    migrateLegacy()
    ensureDir()
    writeFileSync(jsonlPath(), '')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** 给桌宠进程用：读最近 N 条，返回数组（保持老形状）。 */
export function recentMessages(limit = 60) {
  return loadMessages({ limit }).messages
}
