/**
 * dsh-brain · 自动接续（DESIGN 第五节）。
 *
 * 触发（任一）：上下文 ≥ 阈值（默认 80%）、单轮 input > 150k、会话 > 60 轮。
 * 同一个会话只触发一次；正在生成时不动作 —— 只在 turn/end 之后评估。
 *
 * 动作顺序：
 *   1. 覆盖写 实时记忆/当前任务.md（≤300 字）
 *   2. session/create
 *   3. session/selectModel 继承 provider / model / reasoningEffort
 *   4. 继承权限：permission/preset、sandbox/mode、approval/policy
 *   5. archiveSession 归档旧会话（失败不阻塞）
 *   6. 记录 pendingHandoff，由 Client 轮询后导航 + toast
 *
 * 不删会话、不代发首条消息。
 */
import { clip } from './cards.js'
import { extractText } from './inject.js'
import { appendLog, debugLog, fmtTime } from './paths.js'
import { svc } from './services.js'

function eventsOf(session) {
  try {
    return Array.isArray(session.snapshotEvents?.(0, session.seq)) ? session.snapshotEvents(0, session.seq) : []
  } catch {
    return []
  }
}

function countTurns(session) {
  let turns = 0
  for (const event of eventsOf(session)) if (event?.type === 'turn/start') turns += 1
  return turns
}

function lastInputTokens(session) {
  const events = eventsOf(session)
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'assistant/message') {
      const input = event.data?.usage?.inputTokens
      if (typeof input === 'number' && Number.isFinite(input)) return input
    }
  }
  return 0
}

function messageText(message) {
  if (!message) return ''
  return extractText(message.content).trim()
}

function lastConversation(session) {
  let messages = []
  try {
    const derived = session.deriveMessages()
    if (Array.isArray(derived)) messages = derived
  } catch { /* 取不到就留空 */ }
  const users = messages.filter((m) => m?.role === 'user' && m?.source?.kind === 'user')
  const assistants = messages.filter((m) => m?.role === 'assistant')
  return {
    user: messageText(users[users.length - 1]),
    assistant: messageText(assistants[assistants.length - 1]),
  }
}

function resolveCwd(ctx, session) {
  try {
    const workingDirectory = svc(ctx, 'workingDirectory')
    const dir = workingDirectory?.get?.(session)
    if (dir) return dir
  } catch { /* 继续兜底 */ }
  return session?.header?.cwd || process.cwd()
}

function resolveModel(session) {
  const header = session?.requestHeader?.()
  if (header?.config?.provider && header?.config?.model) {
    return {
      provider: String(header.config.provider),
      model: String(header.config.model),
      reasoningEffort: header.config.reasoningEffort ? String(header.config.reasoningEffort) : undefined,
    }
  }
  const context = session?.requestContext?.()
  if (context?.provider && context?.model) {
    return { provider: String(context.provider), model: String(context.model) }
  }
  return null
}

function resolvePermission(ctx, session) {
  let preset = null
  let sandbox = null
  let approval = null
  try { preset = svc(ctx, 'permissionPresets')?.current?.(session) ?? null } catch { /* 可选 */ }
  try { sandbox = svc(ctx, 'sandboxPolicy')?.overrideOf?.(session) ?? null } catch { /* 可选 */ }
  try { approval = svc(ctx, 'approval')?.overrideOf?.(session) ?? null } catch { /* 可选 */ }
  return {
    preset: preset && preset !== 'custom' ? String(preset) : null,
    sandbox: sandbox ? String(sandbox) : null,
    approval: approval ? String(approval) : null,
  }
}

function applyPermission(ctx, session, decision) {
  const applied = []
  try {
    if (decision.preset) {
      session.append('permission/preset', { preset: decision.preset })
      applied.push('permission/preset')
    }
  } catch (error) {
    appendLog(`继承 permission/preset 失败：${String(error?.message ?? error)}`)
  }
  try {
    if (decision.sandbox) {
      session.append('sandbox/mode', { mode: decision.sandbox })
      applied.push('sandbox/mode')
    }
  } catch (error) {
    appendLog(`继承 sandbox/mode 失败：${String(error?.message ?? error)}`)
  }
  try {
    if (decision.approval) {
      session.append('approval/policy', { policy: decision.approval })
      applied.push('approval/policy')
    }
  } catch (error) {
    appendLog(`继承 approval/policy 失败：${String(error?.message ?? error)}`)
  }
  return applied
}

function writeRealtimeHandoff(store, cwd, session, reason, ratio) {
  const { user, assistant } = lastConversation(session)
  const now = new Date()
  const lines = [
    '# 当前任务',
    '',
    `**最后更新**：${fmtTime(now.getTime())}`,
    '',
    `- 自动接续：${reason}（旧会话 ${String(session.id).slice(0, 20)}，上下文约 ${Math.round(ratio * 100)}%）`,
    `- 正在做：${clip(user.replace(/\s+/g, ' '), 120) || '（未记录）'}`,
    `- 上一轮结论：${clip(assistant.replace(/\s+/g, ' '), 90) || '（未记录）'}`,
    '- 下一步：在新会话继续，先读项目记忆。',
  ]
  let body = lines.join('\n')
  if (body.length > 300) body = body.slice(0, 295) + '…'
  return store.writeCard('realtime', '当前任务.md', body, cwd)
}

export function createAutopilot({
  ctx,
  store,
  getSettings,
  getState,
  setState,
}) {
  const triggered = new Set()
  let busy = false

  function pickActiveSession() {
    let best = null
    let bestSeq = -1
    const agents = svc(ctx, 'agents')
    const roots = agents?.roots?.() ?? []
    for (const agent of roots) {
      const session = agent?.session
      if (!session || session.header?.origin === 'subagent') continue
      if (countTurns(session) === 0) continue
      const seq = Number(session.seq) || 0
      if (seq > bestSeq) { bestSeq = seq; best = session }
    }
    return best
  }

  function alreadyHanded(sessionId) {
    const state = getState()
    return (state.handoffs || []).some((h) => h.from === sessionId) ||
      state.pendingHandoff?.from === sessionId
  }

  async function performHandoff(session, reason, ratio) {
    if (busy) return { ok: false, error: '已有接续正在进行' }
    busy = true
    const cwd = resolveCwd(ctx, session)
    const model = resolveModel(session)
    const permission = resolvePermission(ctx, session)
    const agentPreset = session.header?.agentPreset
    const sessionController = svc(ctx, 'sessionController')
    const workspaceRegistry = svc(ctx, 'workspaceRegistry')
    // 先写实时卡：就算建会话失败，这一轮的进展也不会丢。
    const realtime = writeRealtimeHandoff(store, cwd, session, reason, ratio)
    if (!realtime.ok) appendLog(`接续：写实时卡失败 ${realtime.error ?? ''}`, { from: session.id })
    let created
    try {
      if (!sessionController?.create) throw new Error('Host 缺少 sessionController.create')
      let workspaceId
      try {
        const workspace = await workspaceRegistry?.resolveByPath?.(cwd)
        workspaceId = workspace?.id
      } catch { /* 没有 workspace 就只带 cwd */ }
      created = await sessionController.create({
        ...(workspaceId ? { workspaceId } : { cwd }),
        ...(agentPreset ? { agentPreset } : {}),
      })
    } catch (error) {
      busy = false
      triggered.delete(String(session.id))
      appendLog(`接续失败：create ${String(error?.message ?? error)}`, { from: session.id })
      return { ok: false, error: `创建新会话失败：${String(error?.message ?? error)}`, realtime: realtime.ok ? realtime.file : null }
    }
    const newId = String(created.sessionId)
    const sessions = svc(ctx, 'sessions')
    const approval = svc(ctx, 'approval')
    const newSession = sessions?.get?.(newId)
    let selected = null
    let permissionApplied = []
    let newAgent = null
    try {
      if (model && sessionController?.selectModel) {
        const result = await sessionController.selectModel({
          sessionId: newId,
          provider: model.provider,
          model: model.model,
          ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        })
        selected = result?.selected ?? model
      }
    } catch (error) {
      appendLog(`接续：selectModel 失败 ${String(error?.message ?? error)}`, { to: newId })
    }
    try {
      if (sessionController?.resolveAgent) {
        const resolved = await sessionController.resolveAgent(newId)
        newAgent = resolved?.agent ?? null
      }
    } catch (error) {
      appendLog(`接续：resolveAgent 失败 ${String(error?.message ?? error)}`, { to: newId })
    }
    if (newSession) {
      permissionApplied = applyPermission(ctx, newSession, permission)
      if (newAgent && permission.approval) {
        try { approval?.setPolicy?.(newAgent, permission.approval) } catch { /* 已落盘，内存策略失败不阻塞 */ }
      }
    }
    let archived = false
    try {
      if (workspaceRegistry?.archiveSession) {
        await workspaceRegistry.archiveSession(session.id)
        archived = true
      }
    } catch (error) {
      appendLog(`接续：归档旧会话失败（不阻塞）${String(error?.message ?? error)}`, { from: session.id })
    }

    const at = Date.now()
    const record = {
      at,
      from: String(session.id),
      to: newId,
      reason,
      ratio: Number(ratio.toFixed(3)),
      model: selected,
      agentPreset: agentPreset ?? null,
      permission: { ...permission, applied: permissionApplied },
      archived,
      realtime: realtime.ok ? realtime.file : null,
    }
    const state = getState()
    const handoffs = [record, ...(state.handoffs || [])].slice(0, 20)
    setState({
      ...state,
      lastHandoff: record,
      pendingHandoff: record,
      handoffs,
    })
    appendLog('自动接续完成', record)
    busy = false
    return { ok: true, handoff: record }
  }

  async function evaluate(session, options = {}) {
    if (!session) return null
    if (session.header?.origin === 'subagent') return null
    const id = String(session.id)
    if (triggered.has(id) || alreadyHanded(id)) return null
    const turns = countTurns(session)
    if (turns === 0) return null
    const settings = getSettings()
    if (!settings.autopilot && options.reason !== 'manual') return null

    const tokenMeter = svc(ctx, 'tokenMeter')
    const measurement = tokenMeter?.measure?.(session)
    const totalTokens = Number(measurement?.totalTokens) || 0
    const contextWindow = Number(session.requestContext?.()?.contextWindow) || 128000
    const ratio = contextWindow > 0 ? totalTokens / contextWindow : 0
    const inputTokens = lastInputTokens(session)
    const reasons = []
    if (options.reason === 'manual') reasons.push('manual')
    if (ratio * 100 >= settings.threshold) reasons.push(`上下文 ${Math.round(ratio * 100)}% ≥ ${settings.threshold}%`)
    if (inputTokens > 150000) reasons.push(`单轮 input ${inputTokens} > 150k`)
    if (turns > 60) reasons.push(`会话 ${turns} 轮 > 60`)
    if (reasons.length === 0) {
      debugLog('接续评估：未到阈值', {
        sessionId: id,
        totalTokens,
        contextWindow,
        ratio: Number(ratio.toFixed(4)),
        inputTokens,
        turns,
        threshold: settings.threshold,
      })
      return null
    }

    triggered.add(id)
    const result = await performHandoff(session, reasons.join('；'), ratio)
    if (!result.ok) triggered.delete(id)
    return result
  }

  async function handoffNow() {
    const session = pickActiveSession()
    if (!session) return { ok: false, error: '没有可接续的活动会话' }
    return evaluate(session, { reason: 'manual' })
  }

  return { evaluate, handoffNow, performHandoff, pickActiveSession, countTurns }
}
