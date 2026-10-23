/**
 * dsh-brain · 4 个模型工具。
 *
 * 工具是「主动记忆」：注入是插件猜模型想看什么，工具让模型自己翻。
 * 所有失败都返回 {ok:false, error}，绝不抛 —— 一次读不到不该打断模型那一轮。
 */
import { cardBody, clip } from './cards.js'
import { digestRealtime } from './digest.js'
import { searchCards } from './search.js'
import { svc } from './services.js'

const text = (s) => [{ type: 'text', text: String(s ?? '') }]

function cwdOf(ctx, exec) {
  const session = exec?.agent?.session
  try {
    const workingDirectory = svc(ctx, 'workingDirectory')
    if (session && workingDirectory?.get) return workingDirectory.get(session)
    if (session?.header?.cwd) return session.header.cwd
  } catch {
    /* 取不到就用进程目录 */
  }
  return process.cwd()
}

function renderSearch(_args, value) {
  const v = value ?? {}
  if (v.ok === false) return text(`检索失败：${v.error ?? '未知错误'}`)
  const head = `检索面：${v.scope ?? 'all'}；扫了 ${v.scanned ?? 0} 张卡，命中 ${v.hits?.length ?? 0} 张。`
  if (!v.hits?.length) {
    return text(`${head}\n没有命中。可以换个说法（实体名、文件名、近义词）再搜，或直接 memory_read 已知文件。`)
  }
  const lines = v.hits.map((h, i) => {
    const where = `${h.layer}/${h.file}`
    return `${i + 1}. ${where}（score ${h.score}）\n    ${String(h.excerpt ?? '').replace(/\n/g, ' ').slice(0, 220)}`
  })
  return text(`${head}\n${lines.join('\n')}\n\n用 memory_read({file:"…"}) 读全文。`)
}

function renderRead(_args, value) {
  const v = value ?? {}
  if (v.ok === false) return text(`读取失败：${v.error ?? '未知错误'}`)
  const tail = v.to < v.totalLines ? `\n\n（还有内容：from=${v.to + 1}）` : '\n\n（已读到末尾）'
  return text(`${v.layer}/${v.file} 第 ${v.from}–${v.to} 行，共 ${v.totalLines} 行\n\n${v.content}${tail}`)
}

function renderWrite(_args, value) {
  const v = value ?? {}
  if (v.ok === false) return text(`写入失败：${v.error ?? '未知错误'}`)
  return text(`已写入 ${v.layer}/${v.file}（${v.bytes} 字节）${v.backup ? `\n旧内容备份：${v.backup}` : ''}`)
}

function renderDigest(_args, value) {
  const v = value ?? {}
  if (v.ok === false) return text(`消化失败：${v.error ?? '未知错误'}`)
  if (v.skipped) return text(`无需消化：${v.reason}（${v.target}）`)
  return text(`已消化到 ${v.target}（${v.chars} 字），实时卡已清空为下一步提示。${v.backup ? `\n旧内容备份：${v.backup}` : ''}`)
}

export function createTools({ ctx, store, getSettings }) {
  const search = {
    name: 'memory_search',
    description:
      '在本地记忆库（全局 3 张卡 + 当前工作区项目卡 + 实时卡）里检索。' +
      '中文按二元组、英文按整词做 BM25；返回卡片名、层级、分数与片段。' +
      '当你要用既往决定、用户偏好或项目细节，而当前上下文没有依据时用它。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词或问题原文' },
        scope: { type: 'string', enum: ['all', 'global', 'project', 'realtime'], description: '检索面，默认 all' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: '最多返回几张，默认 5' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: renderSearch },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = String(args?.query ?? '').trim()
      if (!query) return { ok: false, error: 'query 不能为空' }
      try {
        const cwd = cwdOf(ctx, exec)
        const scope = args?.scope || 'all'
        let cards = store.allCards(cwd, { includeRealtime: true })
        if (scope === 'global') cards = cards.filter((c) => c.layer === 'global')
        else if (scope === 'project') cards = cards.filter((c) => c.layer === 'project')
        else if (scope === 'realtime') cards = cards.filter((c) => c.layer === 'realtime')
        const result = searchCards(cards, query, {
          topK: Math.min(10, Number(args?.limit) || 5),
          maxChars: Number(getSettings().maxChars) || 600,
          minScore: 0.5,
        })
        return {
          ok: true,
          query,
          scope,
          scanned: result.scanned,
          hits: result.hits.map((h) => ({
            layer: h.layer,
            file: h.file,
            title: h.title,
            description: h.description,
            score: h.score,
            excerpt: clip(String(h.excerpt ?? '').replace(/\s+/g, ' '), 300),
          })),
        }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }

  const read = {
    name: 'memory_read',
    description:
      '按文件名读取一张本地记忆卡，支持行分页。文件可在全局 3 张卡、当前工作区项目卡、实时卡中按名字查找。' +
      '先用 memory_search 拿文件名。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '文件名，如 用户-画像.md / 01-决定.md / 当前任务.md' },
        from: { type: 'integer', minimum: 1, description: '起始行（1-based），默认 1' },
        lines: { type: 'integer', minimum: 1, maximum: 500, description: '最多读多少行，默认 120' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: renderRead },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      try {
        const file = String(args?.file ?? '').trim()
        if (!file) return { ok: false, error: 'file 不能为空' }
        const cwd = cwdOf(ctx, exec)
        let card = store.readOne('global', file, cwd) ||
          store.readOne('project', file, cwd) ||
          store.readOne('realtime', file, cwd)
        if (!card) {
          const names = store.allCards(cwd, { includeRealtime: true }).map((c) => `${c.layer}/${c.file}`)
          return { ok: false, error: `找不到 ${file}。可用文件：${names.join('、') || '（空）'}` }
        }
        const all = card.raw.split(/\r?\n/)
        const from = Math.max(1, Number(args?.from) || 1)
        const lines = Math.max(1, Math.min(500, Number(args?.lines) || 120))
        const to = Math.min(all.length, from + lines - 1)
        return {
          ok: true,
          layer: card.layer,
          file: card.file,
          totalLines: all.length,
          from,
          to,
          content: all.slice(from - 1, to).join('\n'),
        }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }

  const write = {
    name: 'memory_write',
    description:
      '新增或覆盖一张本地记忆卡（写前自动备份旧内容）。' +
      'layer=global 写全局卡，project 写当前工作区项目卡，realtime 写实时卡（默认 当前任务.md）。' +
      '内容要带 frontmatter（--- 开头），文件名必须以 .md 结尾。',
    parameters: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['global', 'project', 'realtime'], description: '记忆层' },
        file: { type: 'string', description: '文件名；realtime 可省略，默认 当前任务.md' },
        content: { type: 'string', description: '完整文件内容（含 frontmatter）' },
      },
      required: ['layer', 'content'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: renderWrite },
    async execute(args, exec) {
      try {
        const layer = String(args?.layer ?? '').trim()
        if (!['global', 'project', 'realtime'].includes(layer)) {
          return { ok: false, error: 'layer 必须是 global / project / realtime' }
        }
        const file = String(args?.file ?? '').trim() || (layer === 'realtime' ? '当前任务.md' : '')
        if (!file) return { ok: false, error: 'file 不能为空' }
        const content = args?.content
        if (typeof content !== 'string') return { ok: false, error: 'content 必须是字符串' }
        const cwd = cwdOf(ctx, exec)
        return store.writeCard(layer, file, content, cwd)
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }

  const digest = {
    name: 'memory_digest',
    description:
      '把实时卡（当前任务.md）的进展归档到项目卡（优先 01-决定.md），并清空实时卡。' +
      '同一份内容只消化一次（内容哈希判重）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: renderDigest },
    async execute(_args, exec) {
      try {
        return digestRealtime({ store, cwd: cwdOf(ctx, exec) })
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
  }

  return { search, read, write, digest }
}

/**
 * 用 ctx.inject 挂工具：拿不到 tools 服务时主插件照常做注入，不会整体待机。
 */
export function mountTools({ ctx, store, getSettings }) {
  const state = { ready: false }
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['tools'], (inner) => {
        try {
          const tools = createTools({ ctx, store, getSettings })
          for (const tool of Object.values(tools)) inner.tools.register(tool)
          state.ready = true
        } catch (error) {
          console.error('[dsh-brain] 工具注册失败（注入不受影响）：', error)
        }
      })
    }
  } catch (error) {
    console.error('[dsh-brain] 工具挂载失败（注入不受影响）：', error)
  }
  return state
}
