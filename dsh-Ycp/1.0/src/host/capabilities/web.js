/**
 * dsh-Ycp · 大肥鱼（能力层）—— 上网四件套：查 / 读 / 记 / 想。
 *
 *   web.search   查：用宿主 ctx.web 的搜索能力
 *   web.fetch    读：用宿主 ctx.web 的抓取能力，HTML 去标签
 *   memory.remember 记：把刚知道的事写成一张全局记忆卡
 *   memory.recall   想：从记忆里检索，返回命中的卡与摘要
 *
 * 每个工具都带 permission（webSearch / webFetch / memoryWrite / memoryRead），
 * 关掉就直接 permission 拒绝——注册表在 invoke 入口统一挡。
 * 查和读成功会记一次「今天查网」并掉一点体力。
 */
import { appendLog } from '../kernel/paths.js'
import { upsertCard } from '../organs/brain.js'
import { recordWeb } from '../organs/mood.js'
import { loadSchedule } from '../organs/schedule.js'
import { search } from '../organs/search.js'

const WEB_SEARCH_MAX = 10
const WEB_TEXT_MAX = 4000

function service(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function clampInt(value, lo, hi) {
  const number = Number(value)
  if (!Number.isFinite(number)) return lo
  return Math.min(hi, Math.max(lo, Math.round(number)))
}

/** 粗去标签：够给她读正文就行，不做完整的 HTML 解析。 */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''))
  return match ? htmlToText(match[1]).slice(0, 200) : ''
}

/** 标题 → 文件名：保留中英文数字，其余换成 -。 */
export function safeTitle(title) {
  return String(title ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function afterWebUse() {
  try {
    recordWeb(new Date(), loadSchedule())
  } catch (error) {
    appendLog('查网统计失败', { error: String(error?.message ?? error) })
  }
}

/**
 * 把四件套装进注册表。
 * @param {object} registry createRegistry() 的返回值
 * @param {{ctx: object}} options
 */
export function installWebTools(registry, { ctx }) {
  registry.registerTool({
    id: 'web.search',
    description: '上网搜一下，返回标题、链接和摘要（用宿主的搜索能力）',
    permission: 'webSearch',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜什么' },
        maxResults: { type: 'integer', description: '最多几条，默认 5' },
      },
      required: ['query'],
    },
    run: async ({ query, maxResults }) => {
      const web = service(ctx, 'web')
      if (!web || typeof web.search !== 'function') throw new Error('宿主的 web 服务不可用')
      const text = String(query ?? '').trim()
      if (!text) throw new Error('搜索词不能为空')
      let result
      try {
        result = await web.search({ query: text, maxResults: clampInt(maxResults ?? 5, 1, WEB_SEARCH_MAX) })
      } catch (error) {
        throw new Error(`联网搜索失败（可能断网，或宿主没配搜索）：${String(error?.message ?? error).slice(0, 200)}`)
      }
      afterWebUse()
      appendLog('联网搜索', {
        query: text,
        sources: Array.isArray(result?.sources) ? result.sources.length : 0,
        content: String(result?.content ?? '').length,
      })
      return {
        query: text,
        truncated: Boolean(result?.truncated),
        sources: (Array.isArray(result?.sources) ? result.sources : []).map((item) => ({
          title: item?.title ?? '',
          url: item?.url ?? '',
          snippet: item?.snippet ?? '',
        })),
        content: String(result?.content ?? '').slice(0, 1500),
      }
    },
  })

  registry.registerTool({
    id: 'web.fetch',
    description: '读一个网页，返回状态码、标题和正文（HTML 会去标签）',
    permission: 'webFetch',
    schema: {
      type: 'object',
      properties: { url: { type: 'string', description: '要读的网址（http/https）' } },
      required: ['url'],
    },
    run: async ({ url }) => {
      const web = service(ctx, 'web')
      if (!web || typeof web.fetch !== 'function') throw new Error('宿主的 web 服务不可用')
      const target = String(url ?? '').trim()
      if (!/^https?:\/\//i.test(target)) throw new Error('只接受 http/https 网址')
      let result
      try {
        result = await web.fetch({ url: target })
      } catch (error) {
        throw new Error(`读网页失败（可能断网）：${String(error?.message ?? error).slice(0, 200)}`)
      }
      afterWebUse()
      const body = result?.body ?? {}
      const raw = String(body.content ?? '')
      const isHtml = body.kind === 'html'
      const text = (isHtml ? htmlToText(raw) : raw).slice(0, WEB_TEXT_MAX)
      appendLog('读网页', { url: target, status: Number(result?.statusCode) || 0, chars: text.length })
      return {
        url: result?.url ?? target,
        status: Number(result?.statusCode) || 0,
        truncated: Boolean(result?.truncated),
        title: isHtml ? titleOf(raw) : '',
        text,
        ...(text.length < 200 ? { hint: '正文几乎为空：这页可能要 JS 渲染。改用 browser.goto 打开，再用 browser.text 或 browser.screenshot 读。' } : {}),
      }
    },
  })

  registry.registerTool({
    id: 'memory.remember',
    description: '把刚知道的一件事写成一张全局记忆卡（同名会覆盖，覆盖前自动备份）',
    permission: 'memoryWrite',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '这件事叫什么（也当文件名）' },
        text: { type: 'string', description: '要记住的内容' },
        tags: { type: 'array', description: '可选标签数组' },
      },
      required: ['title', 'text'],
    },
    run: async ({ title, text, tags }) => {
      const name = String(title ?? '').trim()
      const bodyText = String(text ?? '').trim()
      if (!name) throw new Error('标题不能为空')
      if (!bodyText) throw new Error('内容不能为空')
      const tagList = Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()) : []
      // 走统一入口：同类会合并进旧卡，不会又堆一张重复的。
      const result = upsertCard('global', { title: name, body: bodyText, tags: tagList, source: '上网记住的' })
      if (!result.ok) throw new Error(result.error)
      return { file: result.file, title: name, merged: Boolean(result.merged), backup: result.backup ? '有' : null }
    },
  })

  registry.registerTool({
    id: 'memory.recall',
    description: '从记忆里找相关的事，返回命中的卡片与摘要',
    permission: 'memoryRead',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '想找什么' },
        topK: { type: 'integer', description: '最多几张，默认 3' },
      },
      required: ['query'],
    },
    run: async ({ query, topK }) => {
      const text = String(query ?? '').trim()
      if (!text) throw new Error('要找什么？')
      const result = search(text, { topK: clampInt(topK ?? 3, 1, 5), maxChars: 600 })
      return {
        query: text,
        hits: result.hits.map((hit) => ({ file: hit.file, title: hit.title, score: hit.score, excerpt: hit.excerpt })),
        realtime: result.realtime.map((hit) => ({ file: hit.file, title: hit.title, excerpt: hit.excerpt })),
      }
    },
  })
}
