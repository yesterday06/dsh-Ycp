/**
 * dsh-brain · 卡片存储。
 *
 * 卡片就是带 frontmatter 的 markdown 文件，目录与格式完全沿用 sage-mem：
 *   <全局记忆>/用户-画像.md 等
 *   <工作区>/工作记忆/项目记忆/00-概况.md 01-决定.md 02-坑.md
 *   <工作区>/工作记忆/实时记忆/当前任务.md
 *
 * 本文件只负责「读得到、写得进、改不坏」：任何覆盖/删除前先备份。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { backupFile, workspacePaths, writeAtomic } from './paths.js'

const RESERVED = new Set(['memory.md', 'session-log.md'])
const NAME_RE = /^[\p{L}\p{N}][^\\/:*?"<>|\r\n]{0,80}\.md$/u

/**
 * 实时卡「当前任务.md」的字数上限。
 * 1.0 写卡时硬截 300；1.1 放宽到 800（DESIGN-1.1 第四节），封存的任务卡用满这个额度。
 */
export const REALTIME_CARD_LIMIT = 800
export const REALTIME_CARD_FILE = '当前任务.md'
export const SEAL_MARK = '**封存于**'

/** 任务卡是否来自封存（注入用它判断要不要强制注入全文）。 */
export function isSealCard(body) {
  return String(body ?? '').includes(SEAL_MARK)
}

/** 从任务卡里读「来自会话 xxxxxxxx」。 */
export function sealFromOf(body) {
  const match = /来自会话\s+([0-9A-Za-z-]{4,40})/.exec(String(body ?? ''))
  return match ? match[1] : ''
}

/** 按 1.1 的上限裁剪实时卡正文；超长时留省略号。 */
export function clipRealtime(text, limit = REALTIME_CARD_LIMIT) {
  const s = String(text ?? '').trim()
  const n = Math.max(120, Number(limit) || REALTIME_CARD_LIMIT)
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function scalar(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '')
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function parseBlock(lines) {
  const items = []
  const obj = {}
  let isList = false
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const li = /^-\s+(.*)$/.exec(t)
    if (li) { isList = true; items.push(scalar(li[1])); continue }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(t)
    if (kv) obj[kv[1]] = scalar(kv[2])
  }
  if (isList) return items
  return Object.keys(obj).length ? obj : ''
}

/**
 * 解析 frontmatter。只支持本体系实际用到的 YAML 子集：标量、行内数组、
 * 缩进列表、一层嵌套对象。解析失败不抛 —— 正文仍然可用。
 */
export function parseFrontmatter(input) {
  const text = stripBom(String(input ?? ''))
  if (!text.startsWith('---')) return { meta: {}, body: text }
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text)
  if (!match) return { meta: {}, body: text }
  const lines = match[1].split(/\r?\n/)
  const meta = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) { i += 1; continue }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) { i += 1; continue }
    const key = kv[1]
    const rest = kv[2]
    if (rest.trim() !== '') {
      meta[key] = scalar(rest)
      i += 1
      continue
    }
    const block = []
    let j = i + 1
    while (j < lines.length && (/^\s+/.test(lines[j]) || lines[j].trim() === '')) {
      block.push(lines[j])
      j += 1
    }
    meta[key] = parseBlock(block)
    i = j
  }
  return { meta, body: text.slice(match[0].length) }
}

function toList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return value.split(/[,，]/).map((x) => x.trim()).filter(Boolean)
  return []
}

function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(body)
  return m ? m[1].trim() : ''
}

function firstParagraph(body) {
  const withoutHeadings = body
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('<!--'))
  return withoutHeadings[0] || ''
}

function splitBody(body) {
  return body
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

export class CardStore {
  constructor(options = {}) {
    this.globalDir = options.globalDir
    this.globalSource = options.globalSource || 'config'
    this.cache = new Map()
  }

  configure(globalDir, source) {
    this.globalDir = globalDir
    this.globalSource = source
    this.cache.clear()
  }

  dirFor(layer, cwd) {
    if (layer === 'global') return this.globalDir
    const paths = workspacePaths(cwd)
    if (layer === 'project') return paths.projectDir
    if (layer === 'realtime') return paths.realtimeDir
    if (layer === 'log') return paths.logDir
    throw new Error(`未知记忆层：${layer}`)
  }

  readOne(layer, file, cwd) {
    if (!this.validName(file)) throw new Error(`非法文件名：${file}`)
    const dir = this.dirFor(layer, cwd)
    const path = join(dir, file)
    if (!existsSync(path)) return null
    return this.makeCard(layer, dir, file, path)
  }

  makeCard(layer, dir, file, path) {
    const raw = readFileSync(path, 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const stat = statSync(path)
    const nested = meta.metadata && typeof meta.metadata === 'object' && !Array.isArray(meta.metadata) ? meta.metadata : {}
    const title = firstHeading(body) || String(meta.name || '').trim() || basename(file, extname(file))
    const description = String(meta.description || nested.description || '').trim()
    const baseline = meta.baseline === true || meta.baseline === 'true' || /用户-画像|user-画像/i.test(file)
    const priorityRaw = meta.baselinePriority ?? nested.baselinePriority
    const priority = typeof priorityRaw === 'number' ? priorityRaw : Number(priorityRaw) || 0
    return {
      layer,
      dir,
      file,
      path,
      title,
      description,
      body,
      raw,
      meta,
      tags: toList(meta.tags).concat(toList(meta.aliases)),
      baseline,
      priority,
      chars: splitBody(body).length,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      summary: description || firstParagraph(body),
    }
  }

  scanDir(layer, dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
    const out = []
    for (const ent of entries) {
      if (!ent.isFile()) continue
      if (!/\.md$/i.test(ent.name)) continue
      const lower = ent.name.toLowerCase()
      if (RESERVED.has(lower)) continue
      try { out.push(this.makeCard(layer, dir, ent.name, join(dir, ent.name))) } catch { /* 单张坏卡不影响其余 */ }
    }
    return out
  }

  globalCards() {
    return this.scanDir('global', this.globalDir).sort((a, b) => {
      if (a.baseline !== b.baseline) return a.baseline ? -1 : 1
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.file.localeCompare(b.file, 'zh-CN')
    })
  }

  projectCards(cwd) {
    const dir = workspacePaths(cwd).projectDir
    const files = ['00-概况.md', '01-决定.md', '02-坑.md']
    const out = []
    for (const file of files) {
      const card = this.readOne('project', file, cwd)
      if (card) out.push(card)
    }
    return out
  }

  realtimeCard(cwd) {
    return this.readOne('realtime', '当前任务.md', cwd)
  }

  allCards(cwd, options = {}) {
    const cards = [...this.globalCards(), ...this.projectCards(cwd)]
    if (options.includeRealtime !== false) {
      const realtime = this.realtimeCard(cwd)
      if (realtime && realtime.chars > 0) cards.push(realtime)
    }
    return cards
  }

  validName(file) {
    const name = String(file ?? '').trim()
    if (!name || name === '.' || name === '..') return false
    if (name.includes('..') || name.includes('/') || name.includes('\\')) return false
    if (!NAME_RE.test(name)) return false
    return !RESERVED.has(name.toLowerCase())
  }

  /**
   * 写卡片：先备份旧内容，再原子写。失败返回 {ok:false,error}，不抛。
   */
  writeCard(layer, file, content, cwd) {
    if (!this.validName(file)) return { ok: false, error: `非法文件名：${file}` }
    if (typeof content !== 'string') return { ok: false, error: 'content 必须是字符串' }
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > 512 * 1024) return { ok: false, error: `内容过大（${bytes} 字节 > 512 KB）` }
    const dir = this.dirFor(layer, cwd)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, file)
    let backup = null
    try {
      backup = backupFile(path)
      writeAtomic(path, content)
      this.cache.delete(path)
      return { ok: true, file, layer, path, bytes, backup }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  deleteCard(layer, file, cwd) {
    if (!this.validName(file)) return { ok: false, error: `非法文件名：${file}` }
    const dir = this.dirFor(layer, cwd)
    const path = join(dir, file)
    if (!existsSync(path)) return { ok: false, error: `文件不存在：${file}` }
    try {
      const backup = backupFile(path)
      unlinkSync(path)
      this.cache.delete(path)
      return { ok: true, file, layer, backup }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
}

/** 打开目录：一次性 detached 进程，不等待窗口出现。 */
export function openDirectory(dir) {
  if (typeof dir !== 'string' || !dir) return { ok: false, error: '目录未知' }
  const plan = process.platform === 'win32'
    ? { command: 'explorer.exe', args: [resolve(dir)] }
    : process.platform === 'darwin'
      ? { command: 'open', args: [resolve(dir)] }
      : { command: 'xdg-open', args: [resolve(dir)] }
  try {
    const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on?.('error', () => {})
    child.unref?.()
    return { ok: true, dir: resolve(dir) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

export function cardBody(card) {
  return splitBody(card?.body ?? '')
}

export function cardBrief(card, maxChars) {
  const text = card?.description || card?.summary || ''
  return clip(text, maxChars)
}

export function clip(text, maxChars) {
  const s = String(text ?? '').trim()
  const n = Math.max(20, Number(maxChars) || 600)
  return s.length > n ? `${s.slice(0, n)}…` : s
}
