/**
 * dsh-brain · 自动接续（DESIGN 第五节）与任务封存（DESIGN-1.1 第四、十一节）。
 *
 * 自动接续触发（任一）：上下文 ≥ 阈值（默认 80%）、单轮 input > 150k、会话 > 60 轮。
 * 封存触发：模型调 `task_seal`、面板按钮、用户说「封存」。
 *
 * 两条路径共用 `performHandoff(session, opts)`：
 *   1. 写 实时记忆/当前任务.md（自动接续 ≤300 字；封存用满 800 字）
 *   2. session/create
 *   3. session/selectModel 继承 provider / model / reasoningEffort
 *   4. 继承权限：permission/preset、sandbox/mode、approval/policy
 *   5. archiveSession 归档旧会话（失败不阻塞）
 *   6. 记录 pendingHandoff，由 Client 轮询后导航 + toast
 *
 * 封存额外做三件事：拼任务卡（优先级截断）→ 写会话摘要（不限长度）→ 标失败原因。
 * 不删会话、不代发首条消息、不在生成中切换。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { clip, clipRealtime, REALTIME_CARD_FILE, REALTIME_CARD_LIMIT, SEAL_MARK } from './cards.js'
import { extractText } from './inject.js'
import { appendLog, debugLog, fmtTime, sessionSummaryPath, writeAtomic } from './paths.js'
import { svc } from './services.js'

const SEAL_COOLDOWN_MS = 5000
const CARD_LIMIT = REALTIME_CARD_LIMIT

/** 任务卡的截断优先级（高 → 低），DESIGN-1.1 第四节。 */
const CARD_PRIORITY = ['task', 'done', 'next', 'decisions', 'pitfalls', 'files', 'commands']

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

function deriveMessagesOf(session) {
  try {
    const derived = session.deriveMessages()
    if (Array.isArray(derived)) return derived
  } catch { /* 取不到就留空 */ }
  return []
}

function lastConversation(session) {
  const messages = deriveMessagesOf(session)
  const users = messages.filter((m) => m?.role === 'user' && m?.source?.kind === 'user')
  const assistants = messages.filter((m) => m?.role === 'assistant')
  return {
    user: messageText(users[users.length - 1]),
    firstUser: messageText(users[0]),
    assistant: messageText(assistants[assistants.length - 1]),
  }
}

/**
 * 未完成的工具调用（DESIGN-1.1 第七节）。
 * 会话事件里 tool/call 有 callId，tool/result 的 message.toolCallId 与之配对；
 * 自己这一次调用还没有结果，必须用 exec.callId 排除，否则永远拒绝。
 */
export function pendingToolCalls(session, ignoreCallId) {
  const open = new Map()
  for (const event of eventsOf(session)) {
    if (event?.type === 'tool/call') {
      const callId = event.data?.callId
      if (callId) open.set(String(callId), String(event.data?.name || '未知工具'))
    } else if (event?.type === 'tool/result') {
      const callId = event.data?.message?.toolCallId || event.data?.message?.source?.callId || event.data?.toolCallId
      if (callId) open.delete(String(callId))
    }
  }
  if (ignoreCallId) open.delete(String(ignoreCallId))
  return [...open.values()]
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

/** 自动接续用的短实时卡（保持 1.0 行为，≤300 字）。 */
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
  if (body.length > 300) body = `${body.slice(0, 299)}…`
  return store.writeCard('realtime', REALTIME_CARD_FILE, body, cwd)
}

// ── 任务卡（DESIGN-1.1 第四节）────────────────────────────────────────────────

function toList(value, limit) {
  const list = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : []
  return list
    .map((x) => String(x ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, limit)
}

function toFiles(value, limit) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((x) => {
      if (typeof x === 'string') return { path: x.trim(), change: '' }
      if (!x || typeof x !== 'object') return null
      const path = String(x.path ?? '').trim()
      if (!path) return null
      return { path, change: String(x.change ?? '').trim().replace(/\s+/g, ' ') }
    })
    .filter(Boolean)
    .slice(0, limit)
}

function sealPayload(payload = {}, session) {
  const { user, firstUser, assistant } = lastConversation(session)
  const task = String(payload.task ?? '').trim().replace(/\s+/g, ' ') || clip(user || firstUser, 100) || '（未填写任务名）'
  return {
    task,
    request: String(payload.request ?? '').trim() || firstUser || user,
    done: toList(payload.done, 12),
    decisions: toList(payload.decisions, 10),
    files: toFiles(payload.files, 12),
    next: toList(payload.next, 6),
    pitfalls: toList(payload.pitfalls, 8),
    commands: toList(payload.commands, 8),
    process: toList(payload.process, 60),
    errors: toList(payload.errors, 20),
    rollback: toList(payload.rollback, 10),
    assistant,
  }
}

function cardSections(model) {
  const sections = new Map()
  if (model.task) sections.set('task', { title: '## 任务', items: [model.task] })
  if (model.done.length) sections.set('done', { title: '## 已完成', items: model.done.map((x) => `- ${x}`) })
  if (model.decisions.length) sections.set('decisions', { title: '## 关键决定', items: model.decisions.map((x) => `- ${x}`) })
  if (model.files.length) {
    sections.set('files', {
      title: '## 涉及文件',
      items: model.files.map((f) => `- \`${f.path}\`${f.change ? ` —— ${f.change}` : ''}`),
    })
  }
  if (model.next.length) sections.set('next', { title: '## 下一步', items: model.next.map((x) => `- ${x}`) })
  if (model.pitfalls.length) sections.set('pitfalls', { title: '## 坑', items: model.pitfalls.map((x) => `- ${x}`) })
  if (model.commands.length) {
    sections.set('commands', { title: '## 恢复步骤', items: ['```powershell', ...model.commands, '```'] })
  }
  return sections
}

function renderCard(model, sections) {
  const lines = ['# 当前任务', '', `${SEAL_MARK}：${model.sealedAt} · 来自会话 ${model.from8}`]
  if (model.failure) lines.push(`**封存失败**：${model.failure}`)
  if (model.summaryMissing) lines.push('**摘要缺失**：会话摘要没写成，细节只在旧会话里')
  lines.push('')
  for (const key of CARD_PRIORITY) {
    const section = sections.get(key)
    if (!section || !section.items.length) continue
    lines.push(section.title, ...section.items, '')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

/**
 * 按「任务 > 已完成 > 下一步 > 关键决定 > 坑 > 文件 > 恢复步骤」截断到 800 字。
 * 先逐条删最低优先级的条目，再整段删，最后才硬截。
 */
export function composeTaskCard(model) {
  const sections = cardSections(model)
  let truncated = false
  let text = renderCard(model, sections)
  if (text.length > CARD_LIMIT) {
    truncated = true
    const lowFirst = [...CARD_PRIORITY].reverse()
    for (const key of lowFirst) {
      const section = sections.get(key)
      if (!section) continue
      while (renderCard(model, sections).length > CARD_LIMIT && section.items.length > 0) section.items.pop()
      if (renderCard(model, sections).length <= CARD_LIMIT) break
    }
    for (const key of lowFirst) {
      if (renderCard(model, sections).length <= CARD_LIMIT) break
      sections.delete(key)
    }
    text = renderCard(model, sections)
    if (text.length > CARD_LIMIT) text = `${text.slice(0, CARD_LIMIT - 1)}…`
  }
  return { text, truncated, chars: text.length }
}

function firstLine(value, maxChars) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s
}

function describeCall(name, rawArguments) {
  let args = {}
  try {
    args = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : (rawArguments || {})
  } catch { args = {} }
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : ''
  if (command) return `${name}：\`${firstLine(command, 220)}\``
  const path = args.file_path || args.path || args.target || ''
  if (path) return `${name}：\`${firstLine(path, 180)}\``
  return name
}

function sessionSpan(session) {
  const events = eventsOf(session)
  const times = []
  for (const event of events) {
    const value = Number(event?.at ?? event?.time ?? event?.timestamp)
    if (Number.isFinite(value) && value > 1e12) times.push(value)
  }
  const headerCreated = Number(session?.header?.createdAt ?? session?.header?.createdAtMs)
  const start = times.length ? times[0] : (Number.isFinite(headerCreated) && headerCreated > 1e12 ? headerCreated : null)
  const end = times.length ? times[times.length - 1] : Date.now()
  return { start, end }
}

function autoProcess(session) {
  const lines = []
  for (const event of eventsOf(session)) {
    if (event?.type !== 'tool/call') continue
    lines.push(`- ${describeCall(event.data?.name, event.data?.arguments)}`)
    if (lines.length >= 60) break
  }
  return lines
}

function autoErrors(session) {
  const lines = []
  for (const event of eventsOf(session)) {
    if (event?.type !== 'tool/result') continue
    if (event.data?.message?.isError !== true && event.data?.isError !== true) continue
    const raw = messageText(event.data?.message) || String(event.data?.message?.content ?? '')
    if (!raw.trim()) continue
    lines.push('```text', firstLine(raw, 600), '```')
    if (lines.length >= 30) break
  }
  return lines
}

function defaultRollback(payload, cardFile, summaryRel) {
  const lines = []
  if (payload.files.length) {
    const paths = payload.files.map((f) => f.path).slice(0, 12)
    lines.push(`- 还原改动的文件（git）：\`git checkout -- ${paths.map((p) => `"${p}"`).join(' ')}\``)
    lines.push('- 或从插件备份恢复：`~/.dsh/brain/backups/` 里按时间找同名备份，复制回原路径。')
  }
  lines.push(`- 撤销本次封存的任务卡：删除或还原 \`${cardFile}\`（旧内容在 \`~/.dsh/brain/backups/\`）。`)
  lines.push(`- 会话摘要只追加不改写：需要撤销就删除 \`${summaryRel}\`。`)
  return lines
}

function buildSummary(model, cwd, summaryPath, session) {
  const { start, end } = sessionSpan(session)
  const modelName = model.model ? `${model.model.provider}/${model.model.model}` : '（未取到）'
  const lines = [
    `# 会话摘要 · ${model.task}`,
    '',
    `- 时间：${fmtTime(start) || '（未知）'} – ${fmtTime(end)}`,
    `- 来源会话：${model.from8}`,
    `- 模型：${modelName}`,
    `- 摘要文件：${summaryPath}`,
    '',
    '## 原始需求',
    '',
    model.request || '（未取到原始需求）',
    '',
    '## 过程',
    '',
  ]
  const process = [...model.process, ...autoProcess(session)]
  lines.push(process.length ? process.join('\n') : '（没有记录到工具调用）', '')
  lines.push('## 错误与纠正', '')
  const errors = [...model.errors.map((x) => `- ${x}`), ...autoErrors(session)]
  lines.push(errors.length ? errors.join('\n') : '（本轮没有报错）', '')
  lines.push('## 最终方案', '')
  const plan = []
  plan.push(`- 任务：${model.task}`)
  for (const item of model.done) plan.push(`- 已完成：${item}`)
  for (const item of model.decisions) plan.push(`- 决定：${item}`)
  for (const file of model.files) plan.push(`- 文件：\`${file.path}\`${file.change ? ` —— ${file.change}` : ''}`)
  if (!plan.length) plan.push('（未填写）')
  lines.push(plan.join('\n'), '')
  lines.push('## 回滚方法', '')
  const fallback = defaultRollback(model, `${cwd}\\工作记忆\\实时记忆\\${REALTIME_CARD_FILE}`, summaryPath)
  lines.push([...model.rollback, ...fallback].join('\n'), '')
  return {
    text: lines.join('\n'),
    path: summaryPath,
    originalRequest: model.request,
  }
}

/** 会话摘要写在日志\会话摘要\ 下，不限长度，只追加不改写（同名加序号）。 */
function writeSummary(cwd, model, session) {
  try {
    const at = Date.now()
    let target = sessionSummaryPath(cwd, { task: model.task, at })
    for (let i = 2; i <= 20 && existsSync(target); i += 1) {
      target = sessionSummaryPath(cwd, { task: model.task, at, index: i })
    }
    mkdirSync(dirname(target), { recursive: true })
    const built = buildSummary(model, cwd, target, session)
    writeAtomic(target, built.text)
    return { ok: true, path: target, chars: built.text.length }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/** 任务卡是否来自封存（注入用它判断要不要强制注入全文）。 */
export { isSealCard, sealFromOf } from './cards.js'
export { sealRecordFor } from './paths.js'

export function createAutopilot({
  ctx,
  store,
  getSettings,
  getState,
  setState,
}) {
  const triggered = new Set()
  let busy = false
  let lastSealAt = 0

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

  /**
   * 建新会话 → 继承模型 / 权限 → 归档旧会话 → 记状态。
   * 调用方负责 busy 锁；create 失败返回 {ok:false, stage:'create'}，旧会话不动。
   */
  async function switchSession(session, options = {}) {
    const reason = options.reason || 'manual'
    const ratio = Number(options.ratio) || 0
    const cwd = resolveCwd(ctx, session)
    const model = resolveModel(session)
    const permission = resolvePermission(ctx, session)
    const agentPreset = session.header?.agentPreset
    const sessionController = svc(ctx, 'sessionController')
    const workspaceRegistry = svc(ctx, 'workspaceRegistry')
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
      appendLog(`接续失败：create ${String(error?.message ?? error)}`, { from: session.id })
      return { ok: false, stage: 'create', error: `创建新会话失败：${String(error?.message ?? error)}` }
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
      kind: options.kind || 'auto',
      reason,
      ratio: Number(ratio.toFixed(3)),
      model: selected,
      agentPreset: agentPreset ?? null,
      permission: { ...permission, applied: permissionApplied },
      archived,
      realtime: options.cardFile ?? null,
      summary: options.summaryFile ?? null,
      seal: options.seal ?? null,
    }
    const state = getState()
    const handoffs = [record, ...(state.handoffs || [])].slice(0, 20)
    setState({
      ...state,
      lastHandoff: record,
      pendingHandoff: record,
      handoffs,
    })
    appendLog(options.kind === 'seal' ? '任务封存完成' : '自动接续完成', record)
    return { ok: true, handoff: record }
  }

  /**
   * 接续（1.0 的入口，1.1 扩成通用）：opts 支持
   *   reason / ratio / kind
   *   card           直接给任务卡正文（封存用）
   *   writeCard:false 调用方已经写过卡
   *   cardFile       已经写好的卡路径（记录用）
   *   requireCard    写卡失败就中止（封存必须）
   */
  async function performHandoff(session, opts = {}) {
    if (!session) return { ok: false, error: '没有可接续的会话' }
    if (busy) return { ok: false, error: '已有接续正在进行' }
    busy = true
    try {
      const cwd = resolveCwd(ctx, session)
      let card = { ok: true, file: opts.cardFile ?? null }
      if (typeof opts.card === 'string') {
        card = store.writeCard('realtime', REALTIME_CARD_FILE, clipRealtime(opts.card), cwd)
      } else if (opts.writeCard !== false) {
        card = writeRealtimeHandoff(store, cwd, session, opts.reason || '接续', Number(opts.ratio) || 0)
      }
      if (!card.ok) {
        appendLog(`接续：写实时卡失败 ${card.error ?? ''}`, { from: session.id })
        if (opts.requireCard) return { ok: false, stage: 'card', error: `写任务卡失败：${card.error ?? '未知错误'}` }
      }
      return await switchSession(session, {
        reason: opts.reason,
        ratio: opts.ratio,
        kind: opts.kind,
        cardFile: card.ok ? card.file ?? null : null,
        summaryFile: opts.summaryFile ?? null,
        seal: opts.seal ?? null,
      })
    } finally {
      busy = false
    }
  }

  /**
   * 封存（DESIGN-1.1）：校验 → 拼卡 → 写卡 → 写会话摘要 → 建会话 → 继承 → 归档 → 切换。
   * payload 见 tools.js 的 task_seal；失败一律返回 {ok:false,error}，不抛。
   */
  async function sealTask(payload = {}, options = {}) {
    if (busy) return { ok: false, error: '已有封存 / 接续正在进行，稍后再试' }
    let session = options.session
    if (!session && options.sessionId) {
      try { session = svc(ctx, 'sessions')?.get?.(String(options.sessionId)) } catch { session = null }
    }
    if (!session) session = pickActiveSession()
    if (!session) return { ok: false, error: '没有可封存的活动会话' }
    if (session.header?.origin === 'subagent') return { ok: false, error: '子会话不能封存' }

    const turns = countTurns(session)
    if (turns < 2) {
      return { ok: false, error: `会话只有 ${turns} 轮（< 2），封存没有意义；先把这个任务做完再来` }
    }
    const pending = pendingToolCalls(session, options.callId)
    if (pending.length) {
      return { ok: false, error: `有未完成的工具调用：${pending.slice(0, 5).join('、')}，等它们结束再封存` }
    }
    const now = Date.now()
    if (now - lastSealAt < SEAL_COOLDOWN_MS) {
      const wait = Math.ceil((SEAL_COOLDOWN_MS - (now - lastSealAt)) / 1000)
      return { ok: false, error: `封存过于频繁：${SEAL_COOLDOWN_MS / 1000} 秒内只允许一次，约 ${wait} 秒后再试` }
    }
    lastSealAt = now
    busy = true

    const cwd = resolveCwd(ctx, session)
    const model = resolveModel(session)
    const permission = resolvePermission(ctx, session)
    const idShort = String(session.id).replace(/^session-/, '').slice(0, 8)
    const sealedAt = fmtTime(now)
    const normalized = sealPayload(payload, session)
    const cardModel = {
      ...normalized,
      from8: idShort,
      sealedAt,
      model,
      failure: '',
      summaryMissing: false,
    }

    try {
      const card = composeTaskCard(cardModel)
      const write = await Promise.resolve(store.writeCard('realtime', REALTIME_CARD_FILE, card.text, cwd))
      if (!write.ok) {
        appendLog('封存中止：写任务卡失败', { from: session.id, error: write.error })
        return { ok: false, error: `写任务卡失败，已中止（旧会话不变）：${write.error ?? '未知错误'}` }
      }
      const summary = writeSummary(cwd, cardModel, session)
      if (!summary.ok) {
        appendLog('封存：会话摘要写入失败（不阻塞）', { from: session.id, error: summary.error })
        cardModel.summaryMissing = true
        const retry = composeTaskCard(cardModel)
        store.writeCard('realtime', REALTIME_CARD_FILE, retry.text, cwd)
      }

      const switched = await switchSession(session, {
        reason: options.reason || 'task_seal',
        ratio: 0,
        kind: 'seal',
        cardFile: write.file ?? null,
        summaryFile: summary.ok ? summary.path : null,
        seal: {
          task: normalized.task,
          chars: card.chars,
          truncated: card.truncated,
          summary: summary.ok ? summary.path : null,
          summaryError: summary.ok ? null : summary.error,
          turns,
          source: options.source || 'tool',
        },
      })
      if (!switched.ok) {
        cardModel.failure = switched.error
        const failed = composeTaskCard(cardModel)
        store.writeCard('realtime', REALTIME_CARD_FILE, failed.text, cwd)
        return {
          ok: false,
          stage: 'create',
          error: `${switched.error}（任务卡已保留并标「封存失败」，旧会话仍可用）`,
          card: { file: write.file, chars: failed.chars },
          summary: summary.ok ? summary.path : null,
        }
      }
      return {
        ok: true,
        handoff: switched.handoff,
        card: { file: write.file, chars: card.chars, truncated: card.truncated },
        summary: summary.ok ? { path: summary.path, chars: summary.chars } : null,
        summaryError: summary.ok ? null : summary.error,
        model,
        permission,
      }
    } catch (error) {
      appendLog('封存异常', { from: session.id, error: String(error?.message ?? error) })
      return { ok: false, error: String(error?.message ?? error) }
    } finally {
      busy = false
    }
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
    const result = await performHandoff(session, { reason: reasons.join('；'), ratio, kind: 'auto' })
    if (!result.ok) triggered.delete(id)
    return result
  }

  async function handoffNow() {
    const session = pickActiveSession()
    if (!session) return { ok: false, error: '没有可接续的活动会话' }
    return evaluate(session, { reason: 'manual' })
  }

  return { evaluate, handoffNow, performHandoff, sealTask, pickActiveSession, countTurns }
}
