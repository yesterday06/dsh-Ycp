/**
 * dsh-brain · 记忆大脑（Host 半）。
 *
 * 一个插件同时提供：
 *   - 四层记忆（全局 3 张卡 + 项目卡 + 实时卡 + 日志）
 *   - 每会话首步画像注入 + 每轮 top-k BM25 检索 + 封存会话注入任务卡
 *   - 5 个模型工具：memory_search / memory_read / memory_write / memory_digest / task_seal
 *   - 自动接续：到阈值建新会话、继承模型与权限、归档旧会话
 *   - 任务封存：写任务卡 + 会话摘要、开新会话、归档旧会话（1.1）
 *   - 左侧边栏「记忆大脑」面板的数据接口（Client 半见 src/client.js）
 */
import { readFileSync } from 'node:fs'
import { CardStore } from './cards.js'
import { createAutopilot } from './handoff.js'
import { createHttpApi, mountHttp } from './http.js'
import { createInjector, extractText } from './inject.js'
import { appendLog, debugLog, loadSettings, loadState, resolveGlobalDir, saveSettings, saveState, VERSION } from './paths.js'
import { svc } from './services.js'
import { mountTools } from './tools.js'

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return String(pkg.version || VERSION)
  } catch {
    return VERSION
  }
}

export function apply(ctx) {
  const global = resolveGlobalDir(process.env.DSH_BRAIN_GLOBAL_DIR)
  const store = new CardStore({ globalDir: global.dir, globalSource: global.source })
  const version = readVersion()

  let state = loadState()
  if (!Array.isArray(state.handoffs)) state.handoffs = []
  const getState = () => state
  const setState = (next) => {
    state = next
    try { saveState(state) } catch (error) {
      appendLog('保存状态失败', { error: String(error?.message ?? error) })
    }
  }

  const getSettings = () => loadSettings()

  function getWorkspace() {
    let best = null
    let bestSeq = -1
    const agents = svc(ctx, 'agents')
    const roots = agents?.roots?.() ?? []
    for (const agent of roots) {
      const session = agent?.session
      if (!session || session.header?.origin === 'subagent') continue
      const seq = Number(session.seq) || 0
      if (seq > bestSeq) { bestSeq = seq; best = session }
    }
    const workingDirectory = svc(ctx, 'workingDirectory')
    return best?.header?.cwd ||
      workingDirectory?.defaultDirectory ||
      process.cwd()
  }

  // 首步的 system-prompt/assemble 发生在用户消息落进 session 之前，
  // deriveMessages 里还没有这一轮的问题。inbox 事件在开轮之前就带着消息，
  // 先缓存一份；agent/pre-step 再补一次（覆盖直接进 inbox 之外的路径）。
  const pendingPrompts = new Map()
  const rememberPrompt = (agent, message) => {
    try {
      const sessionId = String(agent?.session?.id || agent?.id || '')
      if (!sessionId) return
      const text = extractText(message?.content).trim()
      if (!text) return
      pendingPrompts.set(sessionId, { text, at: Date.now() })
      debugLog('inbox 捕获本轮问题', { sessionId, chars: text.length })
    } catch { /* 缓存失败不影响主链 */ }
  }
  ctx.on('agent/inbox/inserted', (payload) => rememberPrompt(payload?.agent, payload?.message))
  ctx.on('agent/inbox/claimed', (payload) => rememberPrompt(payload?.agent, payload?.message))

  ctx.on('agent/pre-step', (payload, next) => {
    try {
      const sessionId = String(payload?.agent?.session?.id || payload?.agent?.id || '')
      if (sessionId) {
        const texts = []
        for (const message of payload?.messages || []) {
          const text = extractText(message?.content).trim()
          if (text) texts.push(text)
        }
        if (texts.length) {
          pendingPrompts.set(sessionId, { text: texts.join('\n'), at: Date.now() })
          debugLog('pre-step 捕获本轮问题', { sessionId, chars: texts.join('\n').length })
        }
      }
    } catch { /* 缓存失败不影响主链 */ }
    return typeof next === 'function' ? next() : undefined
  })

  const injector = createInjector({
    ctx,
    store,
    getSettings,
    getState: () => state,
    getPrompt: (sessionId) => {
      const cached = pendingPrompts.get(String(sessionId))
      if (!cached) return ''
      if (Date.now() - cached.at > 10 * 60 * 1000) {
        pendingPrompts.delete(String(sessionId))
        return ''
      }
      return cached.text
    },
    onInjection: (info) => {
      const lastInjection = {
        at: Date.now(),
        sessionId: info.sessionId,
        chars: info.chars,
        tokens: info.tokens,
        files: info.files,
        baseline: info.baseline,
      }
      state = { ...state, lastInjection }
    },
  })
  ctx.on('system-prompt/assemble', injector)
  ctx.on('session/disposed', (session) => {
    try { injector.dispose?.(session?.id) } catch { /* 已清理 */ }
  })

  const autopilot = createAutopilot({ ctx, store, getSettings, getState, setState })
  const tools = mountTools({
    ctx,
    store,
    getSettings,
    sealTask: (payload, options) => autopilot.sealTask(payload, options),
  })
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    debugLog('检测到 turn/end', { sessionId: String(session?.id || ''), reason: event?.data?.reason?.kind })
    autopilot.evaluate(session).catch((error) => {
      appendLog('自动接续评估失败', { error: String(error?.message ?? error) })
    })
  })

  const httpApi = createHttpApi({
    ctx,
    store,
    getSettings,
    saveSettings,
    getState,
    setState,
    autopilot,
    getWorkspace,
    version,
  })
  mountHttp(ctx, httpApi)

  appendLog(`dsh-brain v${version} 已加载`, {
    globalDir: global.dir,
    globalSource: global.source,
    state: process.env.DSH_HOME ? 'dsh-home' : 'home',
  })
  console.log(`[dsh-brain] v${version} 已加载 · 全局记忆 ${global.dir}`)
  return { store, autopilot, tools }
}

export default apply
