/**
 * dsh-brain 1.1 · 任务封存验收（不依赖 DSH 进程，全部在临时目录里）。
 *
 * 覆盖 DESIGN-1.1 第八节里能纯单元验证的项：
 *   - 封存成功：任务卡 ≤800 字、会话摘要落盘、建会话、继承模型 / 权限、归档、pendingHandoff
 *   - 拒绝条件：未完成工具调用 / 轮次 < 2 / 5 秒内重复调用
 *   - 建会话失败：旧会话可用，任务卡带「封存失败」
 *   - 封存后的新会话首步：任务卡全文 + 总预算 1500 字；第二轮回到 BM25
 *   - 任务卡按「任务 > 已完成 > 下一步 > 关键决定 > 坑 > 文件 > 恢复步骤」截断
 *
 * 用法：node tests/seal-smoke.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(tmpdir(), 'dsh-brain-seal-test')
const stateDir = join(root, 'state')
const globalDir = join(tmpdir(), 'dsh-brain-seal-global')
rmSync(root, { recursive: true, force: true })
rmSync(globalDir, { recursive: true, force: true })
mkdirSync(join(root, '工作记忆', '项目记忆'), { recursive: true })
mkdirSync(join(root, '工作记忆', '实时记忆'), { recursive: true })
mkdirSync(globalDir, { recursive: true })
writeFileSync(join(globalDir, '用户-画像.md'), [
  '---',
  'name: 用户画像',
  'description: 测试画像',
  'baseline: true',
  '---',
  '',
  '# 用户画像',
  '',
  '- 中文直白，先结论后理由。',
  '- 结尾最多一步动作。',
  '',
].join('\n'), 'utf8')
writeFileSync(join(root, '工作记忆', '项目记忆', '00-概况.md'), [
  '---',
  'name: 工作区概况',
  'description: 临时验收工作区',
  '---',
  '',
  '# 工作区概况',
  '',
  '封存验收用的临时工作区。',
  '',
].join('\n'), 'utf8')
writeFileSync(join(root, '工作记忆', '项目记忆', '01-决定.md'), '# 决定\n\n- 先做任务卡。\n', 'utf8')

process.env.DSH_BRAIN_STATE_DIR = stateDir
process.env.DSH_BRAIN_GLOBAL_DIR = globalDir

const { CardStore, SEAL_MARK } = await import('../src/cards.js')
const { createAutopilot, composeTaskCard, pendingToolCalls } = await import('../src/handoff.js')
const { createInjector } = await import('../src/inject.js')
const { createTools } = await import('../src/tools.js')
const { DEFAULT_SETTINGS, sessionSummaryPath, sessionSummaryDir } = await import('../src/paths.js')

let passed = 0
function ok(name, condition, detail) {
  if (condition) { passed += 1; console.log(`✅ ${name}`) }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ''}`); process.exitCode = 1 }
}

const store = new CardStore({ globalDir })
const settings = { ...DEFAULT_SETTINGS }

// ── 假会话 ──────────────────────────────────────────────────────────────────
function makeSession({
  id = 'session-old-1234-5678',
  turns = 3,
  cwd = root,
  pending = [],
  done = true,
} = {}) {
  const events = []
  for (let t = 1; t <= turns; t += 1) {
    events.push({ type: 'turn/start', data: { turn: t } })
    events.push({
      type: 'assistant/message',
      data: { turn: t, usage: { inputTokens: 8000 + t * 100 }, message: { role: 'assistant', content: [{ type: 'text', text: `第 ${t} 轮结论` }] } },
    })
    events.push({ type: 'turn/end', data: { turn: t, reason: { kind: 'completed' } } })
  }
  events.push({ type: 'tool/call', data: { callId: 'call_done_1', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm add link:D:\\OpenAI\\仓库\\dsh-brain\\1.1' }) } })
  events.push({ type: 'tool/result', data: { turn: turns, step: 1, message: { role: 'tool', toolCallId: 'call_done_1', content: [{ type: 'text', text: 'done' }], isError: false } } })
  for (const call of pending) {
    events.push({ type: 'tool/call', data: { callId: call.callId, name: call.name || 'pwsh', arguments: '{}' } })
  }
  return {
    id,
    header: { cwd, agentPreset: 'standard' },
    seq: events.length,
    snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
    requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } }),
    requestContext: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', contextWindow: 1000000 }),
    deriveMessages: () => [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '原始需求：给插件加任务封存，验收六条。' }] },
      { role: 'assistant', content: [{ type: 'text', text: done ? '已完成：任务卡、摘要、封存接口。' : '进行中。' }] },
    ],
  }
}

function makeServices(session, options = {}) {
  const calls = {
    create: 0,
    createRequest: null,
    selectModel: null,
    archive: null,
    policy: null,
    events: [],
    failCreate: options.failCreate === true,
  }
  const newSession = { id: 'session-new-9999-0000', append(type, data) { calls.events.push({ type, data }) } }
  const services = {
    agents: { roots: () => [{ session }] },
    tokenMeter: { measure: () => ({ totalTokens: 1000 }) },
    sessionController: {
      create: async (request) => {
        calls.create += 1
        calls.createRequest = request
        if (calls.failCreate) throw new Error('模拟 create 失败')
        return { sessionId: 'session-new-9999-0000' }
      },
      selectModel: async (request) => {
        calls.selectModel = request
        return { selected: { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort } }
      },
      resolveAgent: async () => ({ agent: { id: 'session-new-9999-0000' } }),
    },
    sessions: { get: (id) => (id === 'session-new-9999-0000' ? newSession : session) },
    workspaceRegistry: {
      resolveByPath: async () => ({ id: 'ws-test' }),
      archiveSession: async (id) => { calls.archive = id },
    },
    permissionPresets: { current: () => 'danger-full-access' },
    sandboxPolicy: { overrideOf: () => 'danger-full-access' },
    approval: { overrideOf: () => 'never', setPolicy: (agent, policy) => { calls.policy = { agent, policy } } },
    workingDirectory: { get: () => session.header.cwd },
  }
  return { services, calls }
}

function makeAutopilot(services, stateRef = { value: null }) {
  const ctx = { get: (name) => services[name] }
  if (!stateRef.value) stateRef.value = { lastHandoff: null, pendingHandoff: null, handoffs: [] }
  const autopilot = createAutopilot({
    ctx,
    store,
    getSettings: () => settings,
    getState: () => stateRef.value,
    setState: (next) => { stateRef.value = next },
  })
  return { autopilot, ctx, stateRef }
}

const payload = {
  task: '给 dsh-brain 加任务封存',
  done: ['抽出 performHandoff', '新增 sealTask', '面板加封存按钮'],
  decisions: ['任务卡先写、再建会话，建失败时卡片保留'],
  files: [{ path: 'D:\\OpenAI\\仓库\\dsh-brain\\1.1\\src\\handoff.js', change: '新增 sealTask 与会话摘要' }],
  next: ['在临时 profile 跑验收'],
  pitfalls: ['exec.callId 不排除会永远判定有未完成调用'],
  commands: ['node tests/seal-smoke.mjs'],
  rollback: ['把 profile 的 link 指回 1.0 并重启'],
}

// ── 1. 任务卡纯函数 ──────────────────────────────────────────────────────────
const card = composeTaskCard({
  ...payload,
  from8: 'old-1234',
  sealedAt: '2026-10-24 12:00',
  failure: '',
  summaryMissing: false,
})
ok('任务卡 ≤800 字', card.chars <= 800, `chars=${card.chars}`)
ok('任务卡含封存标记与来源会话', card.text.includes(SEAL_MARK) && card.text.includes('来自会话 old-1234'))
ok('任务卡结构完整（任务/已完成/下一步/恢复步骤）', ['## 任务', '## 已完成', '## 下一步', '## 恢复步骤'].every((x) => card.text.includes(x)))

const huge = composeTaskCard({
  task: '超大任务',
  done: Array.from({ length: 30 }, (_, i) => `已完成第 ${i} 条，带一点结果说明`),
  decisions: Array.from({ length: 20 }, (_, i) => `决定 ${i}：因为……所以……`),
  files: Array.from({ length: 20 }, (_, i) => ({ path: `D:\\very\\long\\path\\file-${i}.js`, change: '改了很多东西' })),
  next: Array.from({ length: 10 }, (_, i) => `下一步 ${i}`),
  pitfalls: Array.from({ length: 20 }, (_, i) => `坑 ${i}`),
  commands: Array.from({ length: 10 }, (_, i) => `echo ${i}`),
  from8: 'old-1234',
  sealedAt: '2026-10-24 12:00',
  failure: '',
  summaryMissing: false,
})
ok('超长任务卡仍 ≤800 字', huge.chars <= 800, `chars=${huge.chars}`)
ok('超长任务卡保留最高优先级的任务段', huge.text.includes('## 任务') && huge.text.includes('超大任务'))
ok('超长任务卡按优先级截断（低优先级先掉）', huge.truncated && (!huge.text.includes('## 恢复步骤') || !huge.text.includes('## 坑')), huge.text.slice(-200))

ok('sessionSummaryPath 在 日志\\会话摘要\\ 下且带时间与任务名',
  /日志\\会话摘要\\\d{8}-\d{4}-.+\.md$/.test(sessionSummaryPath(root, { task: '任务封存', at: Date.now() })),
  sessionSummaryPath(root, { task: '任务封存' }))

// ── 2. 拒绝：未完成的工具调用 ───────────────────────────────────────────────
{
  const session = makeSession({ pending: [{ callId: 'call_open_1' }, { callId: 'call_open_2' }] })
  const { services, calls } = makeServices(session)
  const { autopilot } = makeAutopilot(services)
  ok('pendingToolCalls 能识别未完成调用', pendingToolCalls(session).length === 2, JSON.stringify(pendingToolCalls(session)))
  const rejected = await autopilot.sealTask(payload, { session })
  ok('有未完成工具调用时拒绝封存', rejected.ok === false && rejected.error.includes('未完成的工具调用'), JSON.stringify(rejected))
  ok('拒绝时不建会话', calls.create === 0)
  const remaining = pendingToolCalls(session, 'call_open_1')
  ok('自己这一次调用被 exec.callId 排除（只剩同轮其他调用）', remaining.length === 1, JSON.stringify(remaining))
  const ignored = await autopilot.sealTask(payload, { session, callId: 'call_open_1' })
  ok('排除自己的调用后仍被同轮其他调用挡住', ignored.ok === false && ignored.error.includes('未完成的工具调用'), JSON.stringify(ignored))
}

// ── 3. 拒绝：轮次 < 2 ───────────────────────────────────────────────────────
{
  const session = makeSession({ turns: 1 })
  const { services, calls } = makeServices(session)
  const { autopilot } = makeAutopilot(services)
  const rejected = await autopilot.sealTask(payload, { session })
  ok('轮次 < 2 时拒绝封存', rejected.ok === false && rejected.error.includes('< 2'), JSON.stringify(rejected))
  ok('轮次拒绝时不建会话', calls.create === 0)
}

// ── 4. 封存成功 ─────────────────────────────────────────────────────────────
const stateRef = { value: { lastHandoff: null, pendingHandoff: null, handoffs: [] } }
let sealResult = null
let sealedCardText = ''
{
  const session = makeSession()
  const { services, calls } = makeServices(session)
  const { autopilot } = makeAutopilot(services, stateRef)
  sealResult = await autopilot.sealTask(payload, { session, callId: 'call_seal_self', source: 'tool' })
  ok('封存成功', sealResult.ok === true, JSON.stringify(sealResult).slice(0, 400))
  ok('创建了新会话', calls.create === 1)
  ok('建会话带 workspaceId 与 agentPreset', calls.createRequest?.workspaceId === 'ws-test' && calls.createRequest?.agentPreset === 'standard', JSON.stringify(calls.createRequest))
  ok('继承模型 provider/model/reasoningEffort', calls.selectModel?.provider === 'deepseek-official' && calls.selectModel?.model === 'deepseek-flash' && calls.selectModel?.reasoningEffort === 'high', JSON.stringify(calls.selectModel))
  const types = calls.events.map((e) => e.type)
  ok('继承 permission/preset / sandbox/mode / approval/policy', types.includes('permission/preset') && types.includes('sandbox/mode') && types.includes('approval/policy'), JSON.stringify(types))
  ok('旧会话已归档', calls.archive === session.id, String(calls.archive))
  ok('pendingHandoff 指向新会话且 kind=seal', stateRef.value.pendingHandoff?.to === 'session-new-9999-0000' && stateRef.value.pendingHandoff?.kind === 'seal', JSON.stringify(stateRef.value.pendingHandoff).slice(0, 300))
  const realtime = readFileSync(join(root, '工作记忆', '实时记忆', '当前任务.md'), 'utf8')
  ok('当前任务.md 已写成封存任务卡且 ≤800 字', realtime.length <= 800 && realtime.includes(SEAL_MARK), `len=${realtime.length}`)
  ok('任务卡「来自会话」是旧会话前 8 位', realtime.includes('来自会话 old-1234'), realtime.split('\n')[2])
  ok('返回里带卡与会话摘要路径', Boolean(sealResult.card?.file) && Boolean(sealResult.summary?.path), JSON.stringify(sealResult.summary))
  sealedCardText = realtime

  const dir = sessionSummaryDir(root)
  const files = existsSync(dir) ? readdirSync(dir) : []
  ok('会话摘要文件已落盘', files.length === 1, JSON.stringify(files))
  const summaryText = files.length ? readFileSync(join(dir, files[0]), 'utf8') : ''
  ok('会话摘要含原始需求', summaryText.includes('## 原始需求') && summaryText.includes('原始需求：给插件加任务封存'), summaryText.slice(0, 120))
  ok('会话摘要含过程命令原文', summaryText.includes('## 过程') && summaryText.includes('pnpm add link:'), summaryText.slice(0, 400))
  ok('会话摘要含回滚方法', summaryText.includes('## 回滚方法') && summaryText.includes('git checkout --'), summaryText.slice(-400))
  ok('会话摘要含最终方案', summaryText.includes('## 最终方案') && summaryText.includes('任务：给 dsh-brain 加任务封存'))
  ok('摘要文件名带时间与任务名', /^\d{8}-\d{4}-.+\.md$/.test(files[0] || ''), files[0])
}

// ── 5. 拒绝：5 秒内重复调用 ─────────────────────────────────────────────────
{
  const session = makeSession({ id: 'session-old-2222-3333' })
  const { services, calls } = makeServices(session)
  const stateRef3 = { value: { lastHandoff: null, pendingHandoff: null, handoffs: [] } }
  const { autopilot } = makeAutopilot(services, stateRef3)
  const first = await autopilot.sealTask(payload, { session })
  ok('新实例第一次封存成功（冷却计时起点）', first.ok === true, JSON.stringify(first).slice(0, 200))
  const second = await autopilot.sealTask(payload, { session })
  ok('5 秒内第二次封存被拒绝', second.ok === false && second.error.includes('过于频繁'), JSON.stringify(second))
  ok('第二次没有多建会话', calls.create === 1, `create=${calls.create}`)
}

// ── 6. 建会话失败：旧会话可用 + 卡片标「封存失败」───────────────────────────
{
  const session = makeSession({ id: 'session-old-4444-5555' })
  const { services, calls } = makeServices(session, { failCreate: true })
  const stateRef2 = { value: { lastHandoff: null, pendingHandoff: null, handoffs: [] } }
  const { autopilot } = makeAutopilot(services, stateRef2)
  const failed = await autopilot.sealTask(payload, { session })
  ok('建会话失败返回错误', failed.ok === false && failed.error.includes('创建新会话失败'), JSON.stringify(failed))
  ok('建会话失败时任务卡保留并标「封存失败」', readFileSync(join(root, '工作记忆', '实时记忆', '当前任务.md'), 'utf8').includes('**封存失败**'))
  ok('建会话失败时不归档旧会话', calls.archive === null)
  ok('建会话失败时不写 pendingHandoff', stateRef2.value.pendingHandoff === null)
  ok('建会话失败时旧会话仍可用（没有删改）', session.id === 'session-old-4444-5555')
}

// ── 7. 封存后的首步注入 ─────────────────────────────────────────────────────
{
  // 第 5 / 6 段会覆盖实时卡，这里先恢复第 4 段封存出来的那张卡，
  // 让「封存后的首步注入」看到真实封存内容。
  store.writeCard('realtime', '当前任务.md', sealedCardText, root)
  const sealedSession = {
    id: 'session-new-9999-0000',
    header: { cwd: root },
    deriveMessages: () => [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '刚才做完什么了？下一步？' }] },
    ],
  }
  let injection = null
  const injector = createInjector({
    ctx: {},
    store,
    getSettings: () => settings,
    getState: () => stateRef.value,
    getPrompt: () => '刚才做完什么了？下一步？',
    onInjection: (info) => { injection = info },
  })
  const assembled = await injector({ contexts: [] }, { agent: { session: sealedSession } }, async () => ({ contexts: [] }))
  const parts = assembled.contexts || []
  const injected = parts.find((c) => c.name === 'dsh-brain:memory')
  ok('封存后的首步注入了记忆', Boolean(injected), JSON.stringify(assembled).slice(0, 200))
  const text = injected?.text || ''
  ok('首步注入含任务卡全文（任务 / 已完成 / 下一步）', text.includes('## 任务') && text.includes('## 已完成') && text.includes('## 下一步'), text.slice(0, 400))
  ok('首步注入仍有用户画像', text.includes('用户画像'))
  ok('首步总预算 ≤1500 字', text.length <= 1500, `chars=${text.length}`)
  ok('注入记录标记 sealed', injection?.sealed === true && injection?.files?.includes('当前任务.md'), JSON.stringify(injection))

  const round2 = {
    ...sealedSession,
    deriveMessages: () => [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '刚才做完什么了？下一步？' }] },
      { role: 'assistant', content: [{ type: 'text', text: '做完了。' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '任务卡里写的回滚方法是什么？' }] },
    ],
  }
  const second = await injector({ contexts: [] }, { agent: { session: round2 } }, async () => ({ contexts: [] }))
  const injected2 = (second.contexts || []).find((c) => c.name === 'dsh-brain:memory')
  ok('第二轮走 BM25，不再整段注入任务卡', Boolean(injected2) && !injected2.text.includes('### 任务卡（由封存创建') && !injected2.text.includes('### 用户画像（每会话首步）'), injected2?.text?.slice(0, 300))
  ok('第二轮预算 ≤2400 字', (injected2?.text?.length || 0) <= 2400, `chars=${injected2?.text?.length}`)
}

// ── 8. task_seal 工具接线 ──────────────────────────────────────────────────
{
  const seen = []
  const tools = createTools({
    ctx: { get: () => undefined },
    store,
    getSettings: () => settings,
    sealTask: async (args, options) => {
      seen.push({ args, options })
      return { ok: true, handoff: { to: 'session-new-9999-0000', archived: true, model: { provider: 'p', model: 'm' } }, card: { file: '当前任务.md', chars: 500 } }
    },
  })
  ok('注册了 task_seal 工具', Boolean(tools.seal) && tools.seal.name === 'task_seal')
  ok('task_seal 描述写明「任务完成时调用」', tools.seal.description.includes('任务完成时调用'))
  const schema = tools.seal.parameters.properties
  ok('task_seal 参数含 7 个规定字段', ['task', 'done', 'decisions', 'files', 'next', 'pitfalls', 'commands'].every((k) => Boolean(schema[k])))
  ok('files 是 {path, change} 对象数组', schema.files.items.properties.path.type === 'string' && schema.files.items.properties.change.type === 'string')
  const exec = { callId: 'call_x', agent: { session: { id: 's' } } }
  const result = await tools.seal.execute(payload, exec)
  ok('task_seal 把 payload / session / callId 交给 sealTask', seen.length === 1 && seen[0].options.callId === 'call_x' && seen[0].args.task === payload.task, JSON.stringify(seen[0]?.options))
  ok('task_seal 返回可渲染结果', result.ok === true && result.handoff.to === 'session-new-9999-0000')
}

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`)
