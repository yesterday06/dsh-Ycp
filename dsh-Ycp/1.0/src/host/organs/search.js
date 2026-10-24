/**
 * dsh-Ycp · 大肥鱼（器官）—— 检索：开口前先想起事。
 *
 * 打分规则（P05 定死，改动要写进交接卡）：
 *   标题 / 文件名命中 ×3
 *   tags 命中          ×2
 *   正文命中           ×1
 *
 * 取分最高的 top-k（默认 2），每张卡截 maxChars（默认 600 字）。
 * 实时卡必读：不管分数，always 带上（它是"此刻在干嘛"，很短）。
 * 日记不参与检索：那是给人看的流水，不是她该拿来回答的事实。
 *
 * 中文按二元组切、英文按整词切；命中一次算一次（同一 token 在同一区域只算一分），
 * 避免长文靠重复把分数刷上去。
 */
import { listCards, parseFrontmatter, readCard } from './memory.js'

const DEFAULT_TOP_K = 2
const DEFAULT_MAX_CHARS = 600
const REALTIME_MAX_CHARS = 200

/** 检索词：英文/数字整词 + 中文二元组。 */
export function tokenize(text) {
  const source = String(text ?? '').toLowerCase()
  const tokens = new Set()
  for (const word of source.match(/[a-z0-9_]+/g) ?? []) {
    if (word.length >= 2) tokens.add(word)
  }
  const han = source.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const segment of han.split(/\s+/)) {
    if (!segment) continue
    if (segment.length === 1) tokens.add(segment)
    for (let i = 0; i + 1 < segment.length; i++) tokens.add(segment.slice(i, i + 2))
  }
  return [...tokens]
}

/** 去掉 frontmatter、压平空白，截到 maxChars。 */
export function excerpt(content, maxChars = DEFAULT_MAX_CHARS) {
  const { body } = parseFrontmatter(String(content ?? ''))
  const text = body
    .replace(/^#\s+.+$/m, '')
    .replace(/\s+/g, ' ')
    .trim()
  const limit = Math.max(1, Number(maxChars) || DEFAULT_MAX_CHARS)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function scoreCard(card, tokens) {
  const title = `${card.title} ${card.file}`.toLowerCase()
  const tags = card.tags.join(' ').toLowerCase()
  const body = card.body.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (title.includes(token)) score += 3
    if (tags.includes(token)) score += 2
    if (body.includes(token)) score += 1
  }
  return score
}

function loadLayer(layer) {
  return listCards(layer).map((summary) => {
    const card = readCard(layer, summary.file)
    const content = card ? card.content : ''
    const { body } = parseFrontmatter(content)
    return { ...summary, content, body }
  })
}

/**
 * 搜一次。
 * @param {string} query 用户刚说的话
 * @param {{topK?: number, maxChars?: number}} [options]
 * @returns {{hits: Array, realtime: Array, tokens: number}}
 */
export function search(query, options = {}) {
  const topK = Math.max(1, Number(options.topK) || DEFAULT_TOP_K)
  const maxChars = Math.max(50, Number(options.maxChars) || DEFAULT_MAX_CHARS)
  const tokens = tokenize(query)
  if (tokens.length === 0) return { hits: [], realtime: [], tokens: 0 }

  const candidates = [...loadLayer('global'), ...loadLayer('archive')]
  const scored = candidates
    .map((card) => ({ card, score: scoreCard(card, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.card.mtimeMs - a.card.mtimeMs)
    .slice(0, topK)
    .map(({ card, score }) => ({
      layer: card.layer,
      file: card.file,
      title: card.title,
      score,
      excerpt: excerpt(card.content, maxChars),
    }))

  const realtime = loadLayer('realtime')
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((card) => ({
      layer: 'realtime',
      file: card.file,
      title: card.title,
      score: 0,
      excerpt: excerpt(card.content, Math.min(REALTIME_MAX_CHARS, maxChars)),
    }))

  return { hits: scored, realtime, tokens: tokens.length }
}

/**
 * 把命中结果拼成 system 里「你记得的」那一段。
 * 什么都没有就返回空串（调用方直接省略这一段，省 token）。
 */
export function memoryBlock({ hits = [], realtime = [] } = {}) {
  const lines = []
  for (const item of hits) {
    if (!item.excerpt) continue
    lines.push(`- ${item.title}：${item.excerpt}`)
  }
  for (const item of realtime) {
    if (!item.excerpt) continue
    lines.push(`- 此刻：${item.excerpt}`)
  }
  if (lines.length === 0) return ''
  return ['【你记得的】', ...lines].join('\n')
}
