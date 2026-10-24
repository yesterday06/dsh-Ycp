/**
 * dsh-brain · 面板与动作的 HTTP 接口。
 *
 * 走宿主自己的 webServer，不另开端口、不另起服务：
 *   GET  /api/dsh-brain/state    面板一次拿全
 *   POST /api/dsh-brain/settings 改开关 / 阈值 / top-k / 单卡上限
 *   POST /api/dsh-brain/card     读 / 写 / 删卡片
 *   POST /api/dsh-brain/action   立即接续 / 立即消化 / 打开目录 / 接续确认
 *
 * 写操作只接受同源请求；body 上限 1 MB。
 */
import { cardBody, clip, openDirectory } from './cards.js'
import { digestRealtime } from './digest.js'
import { appendLog, fmtTime, stateRoot } from './paths.js'

const MAX_BODY = 1024 * 1024

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.host === req.headers.host
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体超过 1 MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${String(error?.message ?? error)}`))
      }
    })
    req.on('error', reject)
  })
}

function cardView(card) {
  return {
    layer: card.layer,
    file: card.file,
    title: card.title,
    description: card.description,
    chars: card.chars,
    baseline: card.baseline,
    tags: card.tags,
    mtime: fmtTime(card.mtimeMs),
    mtimeMs: card.mtimeMs,
  }
}

export function createHttpApi({ ctx, store, getSettings, saveSettings, getState, setState, autopilot, getWorkspace, version }) {
  function panelState() {
    const settings = getSettings()
    const cwd = getWorkspace()
    const global = store.globalCards()
    const project = store.projectCards(cwd)
    const realtime = store.realtimeCard(cwd)
    const state = getState()
    return {
      ok: true,
      version: version || '0.1.0',
      globalDir: store.globalDir,
      globalSource: store.globalSource,
      workspace: cwd,
      settings,
      global: global.map(cardView),
      project: project.map(cardView),
      realtime: realtime ? {
        ...cardView(realtime),
        preview: clip(cardBody(realtime), 400),
      } : null,
      status: {
        cardCount: global.length + project.length + (realtime ? 1 : 0),
        lastInjection: state.lastInjection ?? null,
        lastHandoff: state.lastHandoff ?? null,
        pendingHandoff: state.pendingHandoff ?? null,
      },
    }
  }

  async function cardAction(body) {
    const action = String(body?.action ?? 'read')
    const layer = String(body?.layer ?? '')
    const file = String(body?.file ?? '')
    const cwd = getWorkspace()
    if (!['global', 'project', 'realtime'].includes(layer)) {
      return { status: 400, value: { ok: false, error: 'layer 必须是 global / project / realtime' } }
    }
    if (action === 'read') {
      const card = store.readOne(layer, file, cwd)
      if (!card) return { status: 404, value: { ok: false, error: `找不到 ${file}` } }
      return { status: 200, value: { ok: true, layer, file, content: card.raw, chars: card.chars } }
    }
    if (action === 'write') {
      const result = store.writeCard(layer, file, String(body?.content ?? ''), cwd)
      appendLog('面板写入卡片', { layer, file, ok: result.ok })
      return { status: result.ok ? 200 : 400, value: result }
    }
    if (action === 'delete') {
      const result = store.deleteCard(layer, file, cwd)
      appendLog('面板删除卡片', { layer, file, ok: result.ok })
      return { status: result.ok ? 200 : 400, value: result }
    }
    return { status: 400, value: { ok: false, error: `未知 action：${action}` } }
  }

  async function action(body) {
    const name = String(body?.action ?? '')
    const cwd = getWorkspace()
    if (name === 'handoff') {
      const result = await autopilot.handoffNow()
      return { status: result.ok ? 200 : 409, value: result }
    }
    if (name === 'digest') {
      const result = digestRealtime({ store, cwd })
      return { status: result.ok ? 200 : 400, value: result }
    }
    if (name === 'openDir') {
      const target = String(body?.target ?? 'global')
      const dir = target === 'workspace'
        ? cwd
        : target === 'state'
          ? stateRoot()
          : store.globalDir
      return { status: 200, value: openDirectory(dir) }
    }
    if (name === 'ackHandoff') {
      const to = String(body?.to ?? '')
      const state = getState()
      if (state.pendingHandoff && (!to || state.pendingHandoff.to === to)) {
        setState({ ...state, pendingHandoff: null })
      }
      return { status: 200, value: { ok: true } }
    }
    return { status: 400, value: { ok: false, error: `未知 action：${name}` } }
  }

  function handlerFor(fn) {
    return async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
        await fn(req, res, url)
      } catch (error) {
        appendLog('HTTP 接口异常', { url: req.url, error: String(error?.message ?? error) })
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        else try { res.end() } catch { /* 已断开 */ }
      }
    }
  }

  return {
    panelState,
    routes: [
      {
        kind: 'exact',
        path: '/api/dsh-brain/state',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          sendJson(res, 200, panelState())
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-brain/settings',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' })
          const body = await readBody(req)
          const result = saveSettings(body)
          appendLog('面板保存设置', { ok: result.ok, error: result.error })
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-brain/card',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' })
          const body = await readBody(req)
          const result = await cardAction(body)
          sendJson(res, result.status, result.value)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-brain/action',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' })
          const body = await readBody(req)
          const result = await action(body)
          sendJson(res, result.status, result.value)
        }),
      },
    ],
  }
}

export function mountHttp(ctx, api) {
  const state = { mounted: false }
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (inner) => {
        inner.effect(() => {
          const disposers = api.routes.map((route) => inner.webServer.register(route))
          state.mounted = true
          appendLog('HTTP 接口已挂载', { routes: api.routes.map((r) => r.path) })
          return () => {
            for (const off of disposers) {
              try { off?.() } catch { /* 已卸载 */ }
            }
            state.mounted = false
          }
        })
      })
    }
  } catch (error) {
    appendLog('HTTP 接口挂载失败', { error: String(error?.message ?? error) })
  }
  return state
}
