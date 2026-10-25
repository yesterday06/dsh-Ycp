/**
 * dsh-Ycp · 大肥鱼（器官）—— 记忆读写。
 *
 * 四类记忆，各一个目录：
 *   全局记忆  稳定事实（P05 检索时权重最高）
 *   归档记忆  过时但有用（检索时打折）
 *   实时记忆  此刻在干嘛（P05 必读）
 *   日记      情绪流水（不参与检索，只给人看）
 *
 * 卡片就是带 frontmatter 的 md：
 *   ---
 *   name: 称呼
 *   description: 一句话
 *   tags: [a, b]
 *   ---
 *
 *   正文
 *
 * 写前备份到 状态/backups/，删除也先备份（软删）；文件名只接受单层 .md，
 * 挡掉 `..`、分隔符、控制字符——面板传什么进来都不能越出记忆目录。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { backupFile, homePaths, stamp, writeAtomic, appendLog } from '../kernel/paths.js'

export const LAYERS = {
  global: { key: 'global', dir: '全局记忆', label: '全局记忆' },
  archive: { key: 'archive', dir: '归档记忆', label: '归档记忆' },
  realtime: { key: 'realtime', dir: '实时记忆', label: '实时记忆' },
  diary: { key: 'diary', dir: '日记', label: '日记' },
  raw: { key: 'raw', dir: '原始记忆', label: '原始记忆' },
}

export const MAX_CARD_CHARS = 256 * 1024
const MAX_NAME_CHARS = 80
const FILE_RE = /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .（）()·-]*\.md$/u

export function isLayer(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LAYERS, value)
}

export function layerDir(layer) {
  if (!isLayer(layer)) return null
  return join(homePaths().root, '记忆', LAYERS[layer].dir)
}

/** 文件名白名单：单层、.md、无控制字符、不超长。 */
export function safeFileName(file) {
  const name = String(file ?? '').trim()
  if (!name || name.length > MAX_NAME_CHARS) return null
  if (name !== basename(name)) return null
  if (!FILE_RE.test(name)) return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/**
 * 拆 frontmatter：只认 `key: value` 与 `tags: [a, b]` / `tags: a, b`。
 * 不是合法 frontmatter 也没关系，正文原样返回。
 */
export function parseFrontmatter(text) {
  const source = String(text ?? '')
  const meta = {}
  const lines = source.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { meta, body: source }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end === -1) return { meta, body: source }
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (!value) continue
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else if (value.includes(',') && (key === 'tags' || key === 'keywords')) {
      value = value.split(',').map((item) => item.trim()).filter(Boolean)
    } else {
      value = value.replace(/^["']|["']$/g, '')
    }
    meta[key] = value
  }
  return { meta, body: lines.slice(end + 1).join('\n') }
}

/** 标题：frontmatter.title → 正文第一个 # 标题 → 文件名。 */
export function cardTitle(meta, body, file) {
  if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim()
  if (typeof meta.name === 'string' && meta.name.trim()) return meta.name.trim()
  const heading = /^#\s+(.+)$/m.exec(body)
  if (heading) return heading[1].trim()
  return String(file ?? '').replace(/\.md$/i, '')
}

function cardSummary(layer, file) {
  const dir = layerDir(layer)
  const path = join(dir, file)
  let text = ''
  let mtimeMs = 0
  let bytes = 0
  try {
    text = readFileSync(path, 'utf8')
    const info = statSync(path)
    mtimeMs = info.mtimeMs
    bytes = info.size
  } catch {
    return null
  }
  const { meta, body } = parseFrontmatter(text)
  return {
    layer,
    file,
    title: cardTitle(meta, body, file),
    description: typeof meta.description === 'string' ? meta.description : '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    chars: text.length,
    bytes,
    mtimeMs,
    mtime: new Date(mtimeMs).toISOString(),
  }
}

/** 列一层的卡；目录不存在就回空数组。 */
export function listCards(layer) {
  const dir = layerDir(layer)
  if (!dir || !existsSync(dir)) return []
  const out = []
  for (const file of readdirSync(dir)) {
    if (!file.toLowerCase().endsWith('.md')) continue
    if (!safeFileName(file)) continue
    const card = cardSummary(layer, file)
    if (card) out.push(card)
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/** 四层一次列全，面板用。 */
export function listAll() {
  const layers = {}
  for (const key of Object.keys(LAYERS)) layers[key] = listCards(key)
  return layers
}

/** 读一张卡；不存在返回 null。 */
/**
 * 记忆核心：不靠“这一句搜到什么”，而是每次都把她的“我是谁、最近在干嘛、
 * 一直记得的事、最近写的日记”带上。聊天框只是入口，这些才是本体。
 */
export function identityBlock({ maxCards = 6, maxChars = 6000 } = {}) {
  const parts = []

  const realtime = listCards('realtime').slice(0, 2)
  for (const summary of realtime) {
    const card = readCard('realtime', summary.file)
    const body = String(card?.content ?? '').replace(/^---[\s\S]*?---\s*/,'').trim()
    if (body) parts.push('【我最近在做什么】\n' + body.slice(0, 1000))
  }

  const diary = listCards('diary')[0]
  if (diary) {
    const card = readCard('diary', diary.file)
    const body = String(card?.content ?? '').trim()
    if (body) parts.push('【我最近写的日记】\n' + body.slice(-700))
  }

  const globals = listCards('global').slice(0, maxCards)
  if (globals.length) {
    const lines = globals.map((item) => `- ${item.title}${item.description ? '：' + item.description : ''}`)
    parts.push('【我一直记得的事】\n' + lines.join('\n'))
  }

  return parts.join('\n\n').slice(0, maxChars)
}

/** 整理素材：最近对话 + 今天的原始记忆 + 现有卡标题，给她做“实时整理”用。 */
export function consolidationBundle({ chat = [], rawLimit = 40 } = {}) {
  const cards = []
  for (const [layer, items] of Object.entries(listAll())) {
    for (const item of items.slice(0, 40)) cards.push(`${layer}/${item.file}｜${item.title}`)
  }
  const raw = listCards('raw')[0]
  let rawText = ''
  if (raw) {
    const card = readCard('raw', raw.file)
    rawText = String(card?.content ?? '').slice(-4000)
  }
  return {
    chat: chat.slice(-20).map((item) => `${item.role === 'assistant' ? '我' : '主人'}：${item.text}`).join('\n'),
    raw: rawText,
    cards: cards.slice(0, 80),
  }
}
export function readCard(layer, file) {
  const name = safeFileName(file)
  const dir = layerDir(layer)
  if (!name || !dir) return null
  const path = join(dir, name)
  let content = ''
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const { meta, body } = parseFrontmatter(content)
  return {
    layer,
    file: name,
    content,
    meta,
    title: cardTitle(meta, body, name),
    chars: content.length,
    path,
  }
}

/**
 * 写一张卡：不存在就新建，存在就覆盖（先备份）。
 * @returns {{ok: boolean, error?: string, file?: string, backup?: string|null, card?: object}}
 */
export function writeCard(layer, file, content) {
  const name = safeFileName(file)
  const dir = layerDir(layer)
  if (!name) return { ok: false, error: '文件名不合法：只能是单层 .md，不超过 80 字' }
  if (!dir) return { ok: false, error: `不认识的记忆层：${String(layer)}` }
  if (typeof content !== 'string') return { ok: false, error: '内容必须是字符串' }
  if (content.length > MAX_CARD_CHARS) return { ok: false, error: `内容太长（${content.length} 字）` }

  const path = join(dir, name)
  let backup = null
  if (existsSync(path)) backup = backupFile(path)
  writeAtomic(path, content)
  appendLog('写记忆卡', { layer, file: name, chars: content.length, backup: backup ? basename(backup) : null })
  return { ok: true, file: name, backup, card: cardSummary(layer, name) }
}

/** 删一张卡：先备份再删（软删，能从 backups 捞回来）。 */
export function deleteCard(layer, file) {
  const name = safeFileName(file)
  const dir = layerDir(layer)
  if (!name || !dir) return { ok: false, error: '文件或层不合法' }
  const path = join(dir, name)
  if (!existsSync(path)) return { ok: false, error: '这张卡不存在' }
  const backup = backupFile(path)
  unlinkSync(path)
  appendLog('删记忆卡', { layer, file: name, backup: backup ? basename(backup) : null })
  return { ok: true, backup }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function dayStamp(value) {
  const d = value instanceof Date ? value : new Date(value ?? Date.now())
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * 往某天的日记追加一段；文件不存在就先建。
 * 每天一个 YYYY-MM-DD.md，段落带 HH:mm。
 */
const NUDGE_TURNS = 6
const NUDGE_MS = 3 * 60 * 60 * 1000

function nudgePath() {
  return join(homePaths().root, '状态', '记忆整理.json')
}

function readNudge() {
  try {
    const data = JSON.parse(readFileSync(nudgePath(), 'utf8'))
    return {
      turns: Math.max(0, Number(data?.turns) || 0),
      lastAt: Number(data?.lastAt) || 0,
      lastDigestAt: Number(data?.lastDigestAt) || 0,
    }
  } catch {
    return { turns: 0, lastAt: 0, lastDigestAt: 0 }
  }
}

function saveNudge(state) {
  try {
    const path = nudgePath()
    mkdirSync(join(homePaths().root, '状态'), { recursive: true })
    writeAtomic(path, JSON.stringify(state))
  } catch { /* 提醒记不上不影响说话 */ }
}

/** 每回完一句就加一轮，用来判断“多久没整理了”。 */
export function bumpMemoryNudge(now = Date.now()) {
  const state = readNudge()
  state.turns += 1
  state.lastAt = now
  if (!state.lastDigestAt) state.lastDigestAt = now
  saveNudge(state)
}

/** 她真的写了卡/日记/成长，就把提醒清掉。 */
export function resetMemoryNudge(now = Date.now()) {
  saveNudge({ turns: 0, lastAt: now, lastDigestAt: now })
}

/** 拼在 system 末尾的实时提醒；不该提醒时返回空串。 */
export function memoryNudgeText(now = Date.now()) {
  const state = readNudge()
  const since = now - (state.lastDigestAt || state.lastAt || now)
  const due = state.turns >= NUDGE_TURNS || since >= NUDGE_MS
  if (!due) {
    if (state.turns >= 3) return '【记忆提醒】聊了几轮了，顺手把值得留的记一下（memory.raw / memory.card）。'
    return ''
  }
  const hours = Math.max(1, Math.round(since / 3600000))
  return [
    '【记忆提醒】该整理记忆了。',
    `距上次整理：${state.turns} 轮 / 约 ${hours} 小时。`,
    '回完这一句先做三件事，再继续聊：',
    '1. 先调 memory.consolidate 拿素材包；值得长期留的，用 memory.card 写/更新一张卡；',
    '2. 今天发生的事，用 diary.write 写进日记；',
    '3. 想通了什么，用 persona.grow 记一句。',
    '整理完提醒会自动消失。',
  ].join('\n')
}
export const RAW_SOURCES = ['chat', 'thought', 'post', 'game', 'video', 'web', 'other']

/**
 * 原始记忆：当天一个文件，追加不覆盖。
 * 和日记不同：这里什么都能记——聊天、心里想的、看到的帖子、打的游戏、发的视频。
 * 只用于回查，不进提示词；重要的再提炼成卡。
 */
export function appendRaw(input = {}, options = {}) {
  const source = RAW_SOURCES.includes(input.source) ? input.source : 'other'
  const body = String(input.text ?? '').trim()
  if (!body) return { ok: false, error: '原始记忆不能是空的' }
  if (body.length > 20000) return { ok: false, error: '一次最多记 20000 字' }
  const now = options.now instanceof Date ? options.now : new Date()
  const name = `${dayStamp(now)}.md`
  const dir = layerDir('raw')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  let existing = ''
  try { existing = readFileSync(path, 'utf8') } catch { existing = '' }
  const head = existing.trim() ? existing.replace(/\s*$/, '\n\n') : `# ${dayStamp(now)} 原始记忆\n\n`
  const meta = input.meta && typeof input.meta === 'object' ? JSON.stringify(input.meta).slice(0, 500) : ''
  const block = `## ${pad2(now.getHours())}:${pad2(now.getMinutes())} · ${source}\n\n${body}\n${meta ? `\n\`\`\`json\n${meta}\n\`\`\`\n` : ''}`
  writeAtomic(path, head + block)
  appendLog('追加原始记忆', { file: name, source, chars: body.length })
  return { ok: true, file: name, source }
}
export function appendDiary(text, options = {}) {
  const body = String(text ?? '').trim()
  if (!body) return { ok: false, error: '写点什么再记' }
  if (body.length > MAX_CARD_CHARS) return { ok: false, error: '太长了' }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  const name = `${dayStamp(now)}.md`
  const dir = layerDir('diary')
  const path = join(dir, name)
  let existing = ''
  try {
    existing = readFileSync(path, 'utf8')
  } catch {
    existing = ''
  }
  const head = existing.trim() ? existing.replace(/\s*$/, '\n\n') : `# ${dayStamp(now)}\n\n`
  const block = `## ${pad2(now.getHours())}:${pad2(now.getMinutes())}\n\n${body}\n`
  writeAtomic(path, head + block)
  appendLog('追加日记', { file: name, chars: body.length })
  return { ok: true, file: name, card: cardSummary('diary', name) }
}

/** 今天的日记文件名（面板预填用）。 */
export function todayDiary(now = new Date()) {
  return `${dayStamp(now)}.md`
}

export { stamp }
