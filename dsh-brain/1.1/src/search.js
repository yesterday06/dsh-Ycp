/**
 * dsh-brain · 检索。
 *
 * 中文没有空格，所以这里的分词是「ASCII 词 + 中文二元组」；打分用 BM25
 * （k1=1.2, b=0.75），再叠一层少量意图先验（「我是谁」「插件装在哪」这类
 * 短问题）。先验只加分，不替代 BM25 —— 没有先验的问题仍然按正文命中。
 *
 * 目标是「不劣于 sage-mem」：sage-mem 的强项是文件摘要 + aliases 匹配，
 * 这里同样把 title/description/tags/aliases 组成一份权重更高的元文档。
 */
import { cardBody, clip } from './cards.js'

const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff'
const CJK_RE = new RegExp(`[${CJK}]+`, 'g')
const ASCII_RE = /[a-z0-9][a-z0-9_.+-]*/g

export function tokenize(input) {
  const text = String(input ?? '').toLowerCase()
  if (!text) return []
  const out = []
  const ascii = text.match(ASCII_RE) || []
  for (const word of ascii) {
    out.push(word)
    if (word.length > 3 && /[-_.]/.test(word)) out.push(...word.split(/[-_.]+/).filter((x) => x.length > 1))
  }
  const runs = text.match(CJK_RE) || []
  for (const run of runs) {
    if (run.length === 1) {
      out.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2))
  }
  return out
}

function chunkBody(body, size = 620) {
  const clean = cardBody({ body })
  if (!clean) return []
  const paragraphs = clean.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (!current) { current = paragraph; continue }
    if (current.length + paragraph.length + 2 <= size) {
      current += `\n\n${paragraph}`
    } else {
      chunks.push(current)
      current = paragraph
    }
  }
  if (current) chunks.push(current)
  // 单段超长时再按句子/换行切，避免一个 chunk 吃掉整张卡。
  const out = []
  for (const chunk of chunks) {
    if (chunk.length <= size * 1.6) { out.push(chunk); continue }
    let rest = chunk
    while (rest.length > size * 1.6) {
      const cut = rest.lastIndexOf('。', size)
      const at = cut > size / 2 ? cut + 1 : size
      out.push(rest.slice(0, at))
      rest = rest.slice(at)
    }
    if (rest) out.push(rest)
  }
  return out
}

const INTENTS = [
  { re: /我是谁|我的身份|自我介绍|用户画像|什么人|什么专业|农学/i, files: [/用户-画像|user-画像/i], boost: 9 },
  { re: /上次|之前|定过什么|决定|约定|选型|方案/i, files: [/01-决定/i], boost: 4.5 },
  { re: /插件|装在哪|安装|版本|环境|机器|dsh|profile/i, files: [/环境-机器/i], boost: 5 },
  { re: /项目|工作区|目录|索引|清单/i, files: [/索引-项目/i], boost: 4 },
  { re: /坑|踩过|问题|故障|报错/i, files: [/02-坑/i], boost: 4 },
  { re: /概况|这个工作区|主控台/i, files: [/00-概况/i], boost: 3.5 },
]

function intentBoost(card, query) {
  let boost = 0
  const sources = [card.file, card.title, card.description, ...(card.tags || [])].join(' ')
  for (const intent of INTENTS) {
    if (!intent.re.test(query)) continue
    if (intent.files.some((re) => re.test(sources))) boost = Math.max(boost, intent.boost)
  }
  // 文件名/标题被问题原样点名时，比正文偶然撞词更可信。
  const stem = String(card.file || '').replace(/\.md$/i, '')
  if (stem && query.includes(stem)) boost = Math.max(boost, 3)
  return boost
}

/**
 * @param {object[]} cards — CardStore 产出的卡片
 * @param {string} query
 * @param {{topK?: number, maxChars?: number, minScore?: number, excludeFiles?: Set<string>}} options
 */
export function searchCards(cards, query, options = {}) {
  const q = String(query ?? '').trim()
  const topK = Math.max(1, Math.min(10, Number(options.topK) || 2))
  const maxChars = Math.max(80, Number(options.maxChars) || 600)
  const minScore = typeof options.minScore === 'number' ? options.minScore : 0.9
  const exclude = options.excludeFiles instanceof Set ? options.excludeFiles : new Set(options.excludeFiles || [])
  if (!q || !Array.isArray(cards) || cards.length === 0) {
    return { query: q, hits: [], scanned: Array.isArray(cards) ? cards.length : 0, docs: 0 }
  }

  const queryTokens = tokenize(q)
  if (queryTokens.length === 0) return { query: q, hits: [], scanned: cards.length, docs: 0 }

  const docs = []
  const included = []
  for (const card of cards) {
    if (exclude.has(card.file)) continue
    const cardIndex = included.length
    included.push(card)
    const metaText = [card.title, card.description, card.file, ...(card.tags || [])].filter(Boolean).join(' ')
    docs.push({
      cardIndex,
      card,
      kind: 'meta',
      weight: 1.8,
      text: metaText,
      tokens: tokenize(metaText),
    })
    for (const chunk of chunkBody(card.body)) {
      docs.push({ cardIndex, card, kind: 'body', weight: 1, text: chunk, tokens: tokenize(chunk) })
    }
  }
  if (docs.length === 0) return { query: q, hits: [], scanned: cards.length, docs: 0 }

  const df = new Map()
  const lengths = new Array(docs.length)
  let totalLength = 0
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    lengths[i] = doc.tokens.length
    totalLength += lengths[i]
    const seen = new Set(doc.tokens)
    for (const token of seen) df.set(token, (df.get(token) || 0) + 1)
  }
  const avgdl = totalLength / docs.length || 1
  const N = docs.length
  const k1 = 1.2
  const b = 0.75

  const scored = new Map()
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    if (doc.tokens.length === 0) continue
    const tf = new Map()
    for (const token of doc.tokens) tf.set(token, (tf.get(token) || 0) + 1)
    let score = 0
    for (const token of queryTokens) {
      const freq = tf.get(token)
      if (!freq) continue
      const d = df.get(token) || 1
      const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5))
      const denom = freq + k1 * (1 - b + b * (lengths[i] / avgdl))
      score += idf * ((freq * (k1 + 1)) / denom)
    }
    if (score <= 0) continue
    score *= doc.weight
    const key = doc.cardIndex
    const entry = scored.get(key) || { card: doc.card, best: 0, bestText: '', extra: 0, chunks: 0 }
    if (score > entry.best) {
      entry.extra += entry.best * 0.2
      entry.best = score
      entry.bestText = doc.text
    } else {
      entry.extra += score * 0.2
    }
    entry.chunks += 1
    scored.set(key, entry)
  }

  const hits = []
  // 意图先验必须在「完全没撞词」时也能单独把卡带进来 —— 否则「我是谁」
  // 这种短问题会因为卡片正文里没有「我是」两个字而零候选。
  for (let i = 0; i < included.length; i += 1) {
    if (scored.has(i)) continue
    const card = included[i]
    if (!card) continue
    const boost = intentBoost(card, q)
    if (boost <= 0) continue
    scored.set(i, {
      card,
      best: 0,
      bestText: cardBody(card),
      extra: 0,
      chunks: 0,
    })
  }
  for (const entry of scored.values()) {
    const boost = intentBoost(entry.card, q)
    const recency = entry.card.baseline ? 0.2 : 0
    const score = entry.best + Math.min(entry.extra, entry.best * 0.8) + boost + recency
    if (score < minScore && boost === 0) continue
    const body = cardBody(entry.card)
    const excerpt = clip(body.length <= maxChars * 1.5 ? body : entry.bestText, maxChars)
    hits.push({
      layer: entry.card.layer,
      file: entry.card.file,
      title: entry.card.title,
      description: entry.card.description,
      baseline: entry.card.baseline,
      score: Number(score.toFixed(3)),
      excerpt,
      chars: entry.card.chars,
    })
  }
  hits.sort((a, b2) => b2.score - a.score || a.file.localeCompare(b2.file, 'zh-CN'))
  return {
    query: q,
    hits: hits.slice(0, topK),
    scanned: cards.length,
    docs: docs.length,
    intentMatched: hits.some((h) => h.score >= 3),
  }
}

export function searchFiles(cards, query, options = {}) {
  return searchCards(cards, query, options)
}
