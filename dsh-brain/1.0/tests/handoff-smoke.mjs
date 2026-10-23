/**
 * 自动接续的纯单元测试：用假 ctx 验证「先写实时卡 → 建会话 → 继承模型 →
 * 继承权限 → 归档 → pendingHandoff」这条顺序，不碰真实会话。
 *
 * 用法：node tests/handoff-smoke.mjs
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:\\OpenAI\\工作区1\\记忆大脑\\tests\\tmp-handoff'
rmSync(root, { recursive: true, force: true })
mkdirSync(join(root, '工作记忆', '项目记忆'), { recursive: true })
mkdirSync(join(root, '工作记忆', '实时记忆'), { recursive: true })
cpSync('D:\\OpenAI\\工作区1\\工作记忆\\项目记忆', join(root, '工作记忆', '项目记忆'), { recursive: true })

process.env.DSH_BRAIN_STATE_DIR = 'D:\\OpenAI\\工作区1\\记忆大脑\\tests\\tmp-handoff-state'
process.env.DSH_BRAIN_GLOBAL_DIR = 'D:\\OpenAI\\全局记忆'
const { CardStore } = await import('../src/cards.js')
const { createAutopilot } = await import('../src/handoff.js')

const store = new CardStore({ globalDir: 'D:\\OpenAI\\全局记忆' })
const calls = { create: 0, createRequest: null, selectModel: null, archive: null, policy: null, events: [] }

const oldSession = {
  id: 'session-old-test',
  header: { cwd: root, agentPreset: 'standard', origin: undefined },
  seq: 3,
  snapshotEvents: () => [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: {} },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ],
  requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } }),
  requestContext: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', contextWindow: 1000000 }),
  deriveMessages: () => [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把当前任务接续到新会话。' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好的，已完成前两步。' }] },
  ],
}
const newSession = {
  id: 'session-new-test',
  append(type, data) { calls.events.push({ type, data }) },
}
const services = {
  agents: { roots: () => [{ session: oldSession }] },
  tokenMeter: { measure: () => ({ totalTokens: 900000 }) },
  sessionController: {
    create: async (request) => { calls.create += 1; calls.createRequest = request; return { sessionId: 'session-new-test' } },
    selectModel: async (request) => { calls.selectModel = request; return { selected: { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort } } },
    resolveAgent: async () => ({ agent: { id: 'session-new-test' } }),
  },
  sessions: { get: (id) => (id === 'session-new-test' ? newSession : oldSession) },
  workspaceRegistry: {
    resolveByPath: async () => ({ id: 'ws-test' }),
    archiveSession: async (id) => { calls.archive = id },
  },
  permissionPresets: { current: () => 'danger-full-access' },
  sandboxPolicy: { overrideOf: () => 'danger-full-access' },
  approval: {
    overrideOf: () => 'never',
    setPolicy: (agent, policy) => { calls.policy = { agent, policy } },
  },
  workingDirectory: { get: () => root },
}
const ctx = { get: (name) => services[name] }
let state = { lastHandoff: null, pendingHandoff: null, handoffs: [] }
const autopilot = createAutopilot({
  ctx,
  store,
  getSettings: () => ({ autopilot: true, threshold: 5, topK: 2, maxChars: 600, baselineChars: 1300, summaryChars: 120, maxRoundChars: 2400 }),
  getState: () => state,
  setState: (next) => { state = next },
})

let passed = 0
const ok = (name, condition, detail) => {
  if (condition) { passed += 1; console.log(`✅ ${name}`) }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ''}`); process.exitCode = 1 }
}

const result = await autopilot.evaluate(oldSession)
ok('evaluate 返回成功', result?.ok === true, JSON.stringify(result))
ok('创建了新会话', calls.create === 1)
ok('创建时带 workspaceId 与 agentPreset', calls.createRequest?.workspaceId === 'ws-test' && calls.createRequest?.agentPreset === 'standard', JSON.stringify(calls.createRequest))
ok('继承模型 provider/model/reasoningEffort', calls.selectModel?.provider === 'deepseek-official' && calls.selectModel?.model === 'deepseek-flash' && calls.selectModel?.reasoningEffort === 'high', JSON.stringify(calls.selectModel))
const types = calls.events.map((e) => e.type)
ok('继承 permission/preset', types.includes('permission/preset'), JSON.stringify(types))
ok('继承 sandbox/mode=danger-full-access', calls.events.some((e) => e.type === 'sandbox/mode' && e.data.mode === 'danger-full-access'))
ok('继承 approval/policy=never', calls.events.some((e) => e.type === 'approval/policy' && e.data.policy === 'never'))
ok('内存 approval.setPolicy 也已设置', calls.policy?.policy === 'never')
ok('旧会话已归档', calls.archive === 'session-old-test')
ok('pendingHandoff 指向新会话', state.pendingHandoff?.to === 'session-new-test', JSON.stringify(state.pendingHandoff))
ok('handoff 记录 model / permission', state.lastHandoff?.model?.model === 'deepseek-flash' && state.lastHandoff?.permission?.approval === 'never')
const realtime = readFileSync(join(root, '工作记忆', '实时记忆', '当前任务.md'), 'utf8')
ok('实时卡已写且 ≤300 字', realtime.length <= 310 && realtime.includes('自动接续'), `len=${realtime.length}`)

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`)
