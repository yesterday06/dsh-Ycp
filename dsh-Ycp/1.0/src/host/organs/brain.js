/**
 * dsh-Ycp · 她的脑子（记忆 v2）
 *
 * 设计见 工作区1\备忘录\dsh-Ycp-记忆层设计.md。要点：
 *   1. 写入先合并：新卡和同层每张卡算相似度，≥0.55 就并进旧卡，不再堆重复卡。
 *   2. 检索带权重：BM25 × 重要度 × 新鲜度 × 命中次数，而不是字面包含。
 *   3. 注入有预算：核心记忆（按重要度）≤1200 字 + 相关记忆 ≤900 字 + 场景 ≤200 字。
 *   4. 反思从原始记忆里长卡，走合并流程。
 *   5. 记忆体检：重复 / 空 / 超长 / 久未用。
 *
 * 文件格式保持 markdown + frontmatter，老卡没有 importance 就按 3。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appendGrowth, appendLog, homePaths, writeAtomic } from '../kernel/paths.js'
import { deleteCard, layerDir, listCards, parseFrontmatter, readCard, writeCard } from './memory.js'

const DAY = 86_400_000
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]+/g
const ASCII_RE = /[a-z0-9][a-z0-9_.+-]*/g

/** 注入预算（字）。总预算留给 say.js 再裁。 */
export const BUDGETS = { core: 1200, recall: 900, scene: 200, card: 400, merge: 0.45 }

export function clampInt(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 2026-10-25 */
export function dayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dayMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

export function clip(text, maxChars) {
  const s = String(text ?? '').trim()
  const n = Math.max(20, Number(maxChars) || 400)
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** 中文二元组 + 英文整词。 */
export function tokenize(input) {
  const text = String(input ?? '').toLowerCase()
  if (!text) return []
  const out = []
  for (const word of text.match(ASCII_RE) ?? []) {
    if (word.length >= 2) out.push(word)
    if (word.length > 3 && /[-_.]/.test(word)) {
      for (const piece of word.split(/[-_.]+/)) if (piece.length > 1) out.push(piece)
    }
  }
  for (const run of text.match(CJK_RE) ?? []) {
    if (run.length === 1) {
      out.push(run)
      continue
    }
    for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2))
  }
  return out
}

function tagsOf(meta) {
  const raw = meta?.tags
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 10)
  }
  return []
}

/**
 * 读一批卡，带元数据。
 * @param {string[]} layers
 */
export function loadCards(layers = ['global', 'archive']) {
  const out = []
  for (const layer of layers) {
    for (const summary of listCards(layer)) {
      const card = readCard(layer, summary.file)
      if (!card) continue
      const { meta, body } = parseFrontmatter(card.content)
      const text = String(body ?? '').trim()
      out.push({
        layer,
        file: summary.file,
        title: String(meta.title || meta.name || summary.title || summary.file).slice(0, 60),
        tags: tagsOf(meta),
        importance: clampInt(meta.importance, 1, 5, 3),
        source: String(meta.source || '').slice(0, 80),
        updated: String(meta.updated || ''),
        body: text,
        chars: text.length,
        mtimeMs: Number(summary.mtimeMs) || 0,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- 使用次数

function usagePath() {
  return join(homePaths().root, '状态', '记忆使用.json')
}

export function loadUsage() {
  try {
    const data = JSON.parse(readFileSync(usagePath(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/** 被想起来的卡计一次；写单独文件，不改卡的 mtime。 */
export function bumpUsage(files = [], now = Date.now()) {
  const list = (Array.isArray(files) ? files : []).filter(Boolean)
  if (!list.length) return { ok: false }
  const data = loadUsage()
  for (const file of list) {
    const item = data[file] && typeof data[file] === 'object' ? data[file] : { hits: 0, last: 0 }
    item.hits = Number(item.hits || 0) + 1
    item.last = now
    data[file] = item
  }
  try {
    mkdirSync(dirname(usagePath()), { recursive: true })
    writeAtomic(usagePath(), JSON.stringify(data))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// ---------------------------------------------------------------- 检索打分

/**
 * BM25 × 重要度 × 新鲜度 × 使用次数。
 * @param {object[]} cards — loadCards 产物
 * @param {string} query
 * @param {{now?: number, usage?: object}} [options]
 */
export function rankCards(cards, query, options = {}) {
  const now = Number(options.now) || Date.now()
  const usage = options.usage && typeof options.usage === 'object' ? options.usage : loadUsage()
  const q = tokenize(query)
  if (!q.length || !Array.isArray(cards) || !cards.length) return []

  const docs = cards.map((card) => {
    const metaTokens = tokenize(`${card.title} ${card.tags.join(' ')} ${card.source}`)
    const bodyTokens = tokenize(card.body)
    const tf = new Map()
    for (const t of metaTokens) tf.set(t, (tf.get(t) || 0) + 1.8)
    for (const t of bodyTokens) tf.set(t, (tf.get(t) || 0) + 1)
    let len = 0
    for (const v of tf.values()) len += v
    return { card, tf, len }
  })

  const N = docs.length
  const avgdl = docs.reduce((sum, d) => sum + d.len, 0) / N || 1
  const df = new Map()
  for (const d of docs) {
    for (const token of d.tf.keys()) df.set(token, (df.get(token) || 0) + 1)
  }
  const k1 = 1.2
  const b = 0.75
  const out = []
  for (const d of docs) {
    let score = 0
    for (const token of q) {
      const freq = d.tf.get(token)
      if (!freq) continue
      const dfv = df.get(token) || 1
      const idf = Math.log(1 + (N - dfv + 0.5) / (dfv + 0.5))
      const denom = freq + k1 * (1 - b + b * (d.len / avgdl))
      score += (idf * (freq * (k1 + 1))) / denom
    }
    if (score <= 0) continue
    const fresh = freshness(d.card, now)
    const hits = Number(usage?.[d.card.file]?.hits || 0)
    const used = 1 + Math.min(0.3, 0.05 * hits)
    const weighted = score * (0.78 + 0.06 * d.card.importance) * fresh * used
    out.push({ ...d.card, score: Number(weighted.toFixed(3)), base: Number(score.toFixed(3)) })
  }
  out.sort((a, b2) => b2.score - a.score || b2.mtimeMs - a.mtimeMs)
  return out
}

function freshness(card, now) {
  const when = Math.max(dayMs(card.updated), card.mtimeMs || 0)
  if (!when) return 0.85
  const days = (now - when) / DAY
  if (days <= 3) return 1.1
  if (days <= 30) return 1
  if (days <= 90) return 0.9
  return 0.8
}

// ---------------------------------------------------------------- 注入块

/** 核心记忆：按重要度取前几张，不按新旧。 */
export function coreBlock(cards, budget = BUDGETS.core) {
  const sorted = [...cards].sort((a, b) => b.importance - a.importance || b.mtimeMs - a.mtimeMs)
  const lines = []
  let left = budget
  for (const card of sorted) {
    if (left < 60) break
    if (!card.body) continue
    const text = clip(card.body, Math.min(left, 360))
    lines.push(`- ${card.title}：${text}`)
    left -= text.length + card.title.length + 4
  }
  return lines.join('\n')
}

/** 相关记忆：BM25 排序后按预算装。 */
export function recallBlock(cards, query, options = {}) {
  const budget = Math.max(120, Number(options.budget) || BUDGETS.recall)
  const exclude = options.excludeFiles instanceof Set ? options.excludeFiles : new Set(options.excludeFiles || [])
  const pool = cards.filter((card) => !exclude.has(card.file))
  const ranked = rankCards(pool, query, options)
  const lines = []
  const files = []
  let left = budget
  for (const card of ranked) {
    if (left < 80 || lines.length >= 3) break
    const text = clip(card.body, Math.min(left - card.title.length - 6, BUDGETS.card))
    if (!text) continue
    lines.push(`- ${card.title}：${text}`)
    files.push(card.file)
    left -= text.length + card.title.length + 4
  }
  return { text: lines.join('\n'), files }
}

/** 此刻场景：最新一张实时卡。 */
export function sceneBlock(budget = BUDGETS.scene) {
  const list = listCards('realtime')
  for (const summary of list.slice(0, 2)) {
    const card = readCard('realtime', summary.file)
    if (!card) continue
    const { body } = parseFrontmatter(card.content)
    const text = clip(String(body ?? '').replace(/^#\s+.+$/m, ''), budget)
    if (text) return { text, file: summary.file }
  }
  return { text: '', file: '' }
}

/**
 * 一次算齐：核心 + 相关 + 场景。
 * @returns {{core: string, recall: string, scene: string, files: string[]}}
 */
export function contextFor(query, options = {}) {
  const cards = options.cards || loadCards(['global', 'archive'])
  const core = coreBlock(cards, options.coreBudget)
  const recall = recallBlock(cards, query, {
    budget: options.recallBudget,
    usage: options.usage,
    now: options.now,
  })
  const scene = sceneBlock(options.sceneBudget)
  return {
    core,
    recall: recall.text,
    scene: scene.text,
    files: [...recall.files, ...(scene.file ? [scene.file] : [])],
  }
}

// ---------------------------------------------------------------- 写入合并

export function similarity(a, b) {
  const sa = new Set(tokenize(a))
  const sb = new Set(tokenize(b))
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const token of sa) if (sb.has(token)) inter += 1
  return inter / (sa.size + sb.size - inter)
}

/** Dice 系数：中文短句比 Jaccard 宽容，换个说法也能撞上。 */
export function dice(a, b) {
  const A = tokenize(a)
  const B = tokenize(b)
  if (!A.length || !B.length) return 0
  const pool = new Map()
  for (const token of A) pool.set(token, (pool.get(token) || 0) + 1)
  let inter = 0
  for (const token of B) {
    const count = pool.get(token) || 0
    if (count > 0) {
      inter += 1
      pool.set(token, count - 1)
    }
  }
  return (2 * inter) / (A.length + B.length)
}

function containment(a, b) {
  const sa = new Set(tokenize(a))
  const sb = new Set(tokenize(b))
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const token of sa) if (sb.has(token)) inter += 1
  return inter / Math.min(sa.size, sb.size)
}

/**
 * 两张卡「是不是在说同一件事」：
 * 标题说同一件事最可信，正文其次，标签只做加成（同一标签不代表同一件事）。
 * 中文换个说法会丢字面重合，所以标题/正文都取「Dice 与包含度」里较高的那个。
 * @returns {{score: number, title: number, body: number, tag: number}}
 */
export function cardSimilarity(a, b) {
  const at = String(a?.title ?? '')
  const bt = String(b?.title ?? '')
  const ab = String(a?.body ?? '').slice(0, 400)
  const bb = String(b?.body ?? '').slice(0, 400)
  const title = Math.max(dice(at, bt), 0.9 * containment(at, bt))
  const body = Math.max(dice(ab, bb), 0.9 * containment(ab, bb))
  const ta = new Set((a?.tags || []).map((t) => String(t).toLowerCase()))
  const tb = new Set((b?.tags || []).map((t) => String(t).toLowerCase()))
  let tag = 0
  if (ta.size && tb.size) {
    let inter = 0
    for (const token of ta) if (tb.has(token)) inter += 1
    tag = inter / (ta.size + tb.size - inter)
  }
  return { score: 0.6 * title + 0.25 * body + 0.15 * tag, title, body, tag }
}

/** 判定「该合并」：标题必须有实打实的重合，光靠标签和正文不算。 */
export function sameTopic(sim) {
  return Boolean(sim) && sim.title >= 0.35 && sim.score >= 0.38
}

/**
 * 合并正文：按句拆开，几乎重复的句子只留一句，新信息都保留。
 * 这样「同一件事」不会越并越长，也不会把旧细节弄丢。
 */
export function mergeBodies(...texts) {
  const parts = []
  for (const text of texts) {
    for (const piece of String(text ?? '').split(/[。\n]+/).map((s) => s.trim()).filter(Boolean)) {
      if (parts.some((kept) => dice(kept, piece) >= 0.6)) continue
      parts.push(piece)
    }
  }
  return parts.length ? `${parts.join('。')}。` : ''
}

export function formatCard({ title, body, tags = [], importance = 3, source = '', updated = '' }) {
  const desc = String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const list = tags.map((t) => String(t).replace(/[[\],]/g, '').trim()).filter(Boolean)
  // 来源去重：同一来源写一次就够（合并多张卡时容易串成三条一样的）。
  const sources = [...new Set(String(source ?? '').split(/[；;]/).map((s) => s.trim()).filter(Boolean))]
  return [
    '---',
    `name: ${String(title).trim()}`,
    `description: ${desc}`,
    `tags: [${[...new Set(list)].join(', ')}]`,
    `importance: ${importance}`,
    `source: ${sources.join('；')}`,
    `updated: ${updated}`,
    '---',
    '',
    String(body ?? '').trim(),
    '',
  ].join('\n')
}

/** 标题 → 文件名：中文短语，≤24 字，去掉非法字符。 */
export function slugFile(title) {
  const base = String(title ?? '')
    .replace(/[\\/:*?"<>|\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
  return `${base || '记忆'}.md`
}

/**
 * 写一张记忆：先找同类合并，找不到才新建。
 * @param {'global'|'archive'} layer
 * @param {{title: string, body: string, tags?: string[], importance?: number, source?: string}} input
 */
export function upsertCard(layer, input, now = new Date()) {
  const title = String(input?.title ?? '').trim().slice(0, 60)
  const body = String(input?.body ?? '').trim().slice(0, 4000)
  if (!title || body.length < 4) return { ok: false, error: '标题或正文太短' }
  const importance = clampInt(input?.importance, 1, 5, 3)
  const tags = (Array.isArray(input?.tags) ? input.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
  const source = String(input?.source || dayKey(now)).slice(0, 80)
  const cards = loadCards([layer])

  let best = null
  let bestSim = 0
  let bestDetail = null
  for (const card of cards) {
    const detail = cardSimilarity({ title, body, tags }, card)
    if (detail.score > bestSim) {
      bestSim = detail.score
      bestDetail = detail
      best = card
    }
  }

  if (best && sameTopic(bestDetail)) {
    const mergedBody = body.length >= 20 ? mergeBodies(best.body, body) : best.body || body
    const next = formatCard({
      title: title || best.title,
      body: mergedBody,
      tags: [...new Set([...best.tags, ...tags])].slice(0, 10),
      importance: Math.max(best.importance, importance),
      source: best.source && !best.source.includes(source) ? `${best.source}；${source}` : best.source || source,
      updated: dayKey(now),
    })
    const write = writeCard(layer, best.file, next)
    if (!write.ok) return { ok: false, error: write.error }
    appendLog('记忆合并', { file: best.file, sim: Number(bestSim.toFixed(3)), importance: Math.max(best.importance, importance) })
    return { ok: true, merged: true, file: best.file, sim: Number(bestSim.toFixed(3)), backup: write.backup }
  }

  let file = slugFile(title)
  const dir = layerDir(layer)
  if (existsSync(join(dir, file))) {
    const stem = file.replace(/\.md$/i, '')
    for (let i = 2; i < 50; i += 1) {
      const next = `${stem}-${i}.md`
      if (!existsSync(join(dir, next))) {
        file = next
        break
      }
    }
  }
  const write = writeCard(layer, file, formatCard({ title, body, tags, importance, source, updated: dayKey(now) }))
  if (!write.ok) return { ok: false, error: write.error }
  appendLog('记忆新建', { file, importance })
  return { ok: true, merged: false, file, backup: write.backup }
}

/** 两张卡合并成一张（体检时用）。 */
export function mergeCards(fileA, fileB, now = new Date()) {
  const cards = loadCards(['global', 'archive'])
  const a = cards.find((card) => card.file === fileA)
  const b = cards.find((card) => card.file === fileB)
  if (!a || !b) return { ok: false, error: '卡片不存在' }
  const body = mergeBodies(a.body, b.body)
  const write = writeCard(a.layer, a.file, formatCard({
    title: a.title,
    body: body.slice(0, 4000),
    tags: [...new Set([...a.tags, ...b.tags])],
    importance: Math.max(a.importance, b.importance),
    source: [a.source, b.source].filter(Boolean).join('；'),
    updated: dayKey(now),
  }))
  if (!write.ok) return { ok: false, error: write.error }
  const removed = deleteCard(b.layer, b.file)
  appendLog('记忆手动合并', { keep: a.file, drop: b.file, removed: Boolean(removed?.ok) })
  return { ok: true, keep: a.file, drop: b.file }
}

// ---------------------------------------------------------------- 反思

function reflectStatePath() {
  return join(homePaths().root, '状态', '反思.json')
}

function readReflectState() {
  try {
    return JSON.parse(readFileSync(reflectStatePath(), 'utf8'))
  } catch {
    return { lastAt: 0 }
  }
}

function saveReflectState(state) {
  try {
    mkdirSync(dirname(reflectStatePath()), { recursive: true })
    writeAtomic(reflectStatePath(), JSON.stringify(state))
  } catch { /* 记不上不影响 */ }
}

/** 读原始记忆最新一篇的末尾。 */
export function readRawTail(maxChars = 6000) {
  const raws = listCards('raw')
  if (!raws.length) return { text: '', file: '' }
  const card = readCard('raw', raws[0].file)
  if (!card) return { text: '', file: '' }
  const { body } = parseFrontmatter(card.content)
  const text = String(body ?? '').trim()
  return { text: text.slice(-maxChars), file: raws[0].file }
}

/** 读最近一篇日记末尾。 */
export function readDiaryTail(maxChars = 1500) {
  const diaries = listCards('diary')
  if (!diaries.length) return { text: '', file: '' }
  const card = readCard('diary', diaries[0].file)
  if (!card) return { text: '', file: '' }
  const { body } = parseFrontmatter(card.content)
  return { text: String(body ?? '').trim().slice(-maxChars), file: diaries[0].file }
}

async function streamText(llm, { provider, model, system, user, timeoutMs = 90_000 }) {
  let text = ''
  const stream = llm.stream({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    temperature: 0.3,
    sessionId: 'dsh-Ycp-reflect',
    signal: AbortSignal.timeout(timeoutMs),
  })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text
}

/**
 * 反思：从原始记忆里长出卡和成长。
 * @param {{llm: object, provider: string, model: string, now?: Date, force?: boolean, minGapMs?: number}} options
 */
export async function reflect(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const minGapMs = Number(options.minGapMs) || 6 * 3600 * 1000
  const state = readReflectState()
  if (!options.force && state.lastAt && now.getTime() - Number(state.lastAt) < minGapMs) {
    return { ok: false, reason: 'cooling', nextAt: Number(state.lastAt) + minGapMs }
  }
  const { llm, provider, model } = options
  if (!llm || typeof llm.stream !== 'function' || !provider || !model) {
    return { ok: false, reason: 'no-model' }
  }
  const raw = readRawTail(Number(options.rawChars) || 6000)
  if (!raw.text || raw.text.length < 40) return { ok: false, reason: 'empty' }
  const diary = readDiaryTail(1500)
  const existing = loadCards(['global']).map((card) => card.title).slice(0, 60)

  const system = [
    '你在替“阿闷”做每天一次的回忆整理。只根据材料里真实发生的事，不编造。',
    '输出严格 JSON，不要解释、不要代码块：',
    '{"cards":[{"title":"中文短语","body":"一句到三句稳定的事实/偏好/约定/经验","tags":["标签"],"importance":3}],"growth":"如果她今天想通了什么，写一句；没有就空字符串"}',
    '规则：cards 最多 3 张；只写以后还用得上的；一次性的流水账不写；和现有标题重复的不要新建；不记密码、证件、密钥。',
    'importance 1-5：5=关于主人和自己的根本事实，4=长期约定/偏好，3=普通事实，2=偶然经历，1=可以不记。',
  ].join('\n')
  const user = [
    `【今天的原始记忆（${raw.file} 末尾）】`,
    raw.text,
    '',
    diary.text ? `【最近一篇日记（${diary.file}）】\n${diary.text}` : '',
    '',
    existing.length ? `【现有记忆标题，别重复建】\n${existing.join('、')}` : '',
  ].filter(Boolean).join('\n')

  let text = ''
  try {
    text = await streamText(llm, { provider, model, system, user })
  } catch (error) {
    appendLog('反思失败', { error: String(error?.message ?? error) })
    return { ok: false, reason: 'llm' }
  }
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  let data
  try {
    data = JSON.parse(clean)
  } catch {
    appendLog('反思解析失败', { chars: clean.length })
    return { ok: false, reason: 'parse' }
  }

  let applied = 0
  const files = []
  for (const card of Array.isArray(data?.cards) ? data.cards.slice(0, 3) : []) {
    const title = String(card?.title || '').trim()
    const body = String(card?.body || '').trim()
    if (!title || !body) continue
    const result = upsertCard('global', {
      title,
      body,
      tags: Array.isArray(card?.tags) ? card.tags : [],
      importance: card?.importance,
      source: `反思 ${dayKey(now)}`,
    }, now)
    if (result.ok) {
      applied += 1
      files.push(result.file)
    }
  }
  const growth = String(data?.growth || '').trim()
  if (growth) appendGrowth(growth)
  saveReflectState({ lastAt: now.getTime(), cards: applied })
  appendLog('反思完成', { cards: applied, growth: Boolean(growth), raw: raw.file })
  return { ok: true, cards: applied, files, growth: Boolean(growth) }
}

// ---------------------------------------------------------------- 体检

/**
 * 记忆体检：重复、空、超长、久未用。
 */
export function healthCheck(now = Date.now()) {
  const cards = loadCards(['global', 'archive'])
  const usage = loadUsage()
  const duplicates = []
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const detail = cardSimilarity(cards[i], cards[j])
      if (sameTopic(detail)) duplicates.push({ a: cards[i].file, b: cards[j].file, sim: Number(detail.score.toFixed(2)) })
    }
  }
  duplicates.sort((x, y) => y.sim - x.sim)
  const empty = cards.filter((card) => card.chars < 8).map((card) => card.file)
  const long = cards.filter((card) => card.chars > 2500).map((card) => ({ file: card.file, chars: card.chars }))
  const stale = cards
    .filter((card) => {
      const last = Math.max(dayMs(card.updated), Number(usage?.[card.file]?.last || 0), card.mtimeMs || 0)
      return last > 0 && now - last > 30 * DAY && card.importance <= 2
    })
    .map((card) => card.file)
  const noMeta = cards.filter((card) => !card.updated && !card.source).map((card) => card.file)
  return {
    ok: true,
    total: cards.length,
    issues: { duplicates, empty, long, stale, noMeta },
    healthy: duplicates.length === 0 && empty.length === 0 && long.length === 0,
  }
}
