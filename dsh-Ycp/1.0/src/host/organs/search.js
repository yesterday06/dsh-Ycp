/**
 * dsh-Ycp · 检索（面板 / memory.search 工具的统一入口）
 *
 * 打分逻辑已经搬到 brain.js（BM25 × 重要度 × 新鲜度 × 使用次数），
 * 这里只保留老接口的形状，免得面板和工具要跟着改。
 */
import { clip, loadCards, rankCards, tokenize as brainTokenize } from './brain.js'
import { listCards, parseFrontmatter, readCard } from './memory.js'

export const tokenize = brainTokenize

/** 去掉 frontmatter、压平空白，截到 maxChars。 */
export function excerpt(content, maxChars = 600) {
  const { body } = parseFrontmatter(String(content ?? ''))
  return clip(
    String(body ?? '')
      .replace(/^#\s+.+$/m, '')
      .replace(/\s+/g, ' ')
      .trim(),
    maxChars,
  )
}

/**
 * 搜一次。
 * @param {string} query
 * @param {{topK?: number, maxChars?: number, now?: number}} [options]
 */
export function search(query, options = {}) {
  const topK = Math.max(1, Math.min(10, Number(options.topK) || 2))
  const maxChars = Math.max(50, Number(options.maxChars) || 600)
  const q = String(query ?? '').trim()
  if (!q) return { hits: [], realtime: [], tokens: 0 }

  const ranked = rankCards(loadCards(['global', 'archive']), q, options)
  const hits = ranked.slice(0, topK).map((card) => ({
    layer: card.layer,
    file: card.file,
    title: card.title,
    score: card.score,
    excerpt: clip(card.body, maxChars),
  }))

  const realtime = []
  for (const summary of listCards('realtime').slice(0, 2)) {
    const card = readCard('realtime', summary.file)
    if (!card) continue
    const { body } = parseFrontmatter(card.content)
    const text = clip(String(body ?? ''), Math.min(200, maxChars))
    if (!text) continue
    realtime.push({ layer: 'realtime', file: summary.file, title: summary.title, score: 0, excerpt: text })
  }

  return { hits, realtime, tokens: tokenize(q).length }
}
