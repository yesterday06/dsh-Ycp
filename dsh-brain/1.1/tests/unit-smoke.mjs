/**
 * dsh-brain 单元冒烟：卡片存储 / 4 个工具 / 注入链。
 * 不依赖 DSH 进程，也不碰真实工作区（写操作只在 tests/tmp-workspace 里）。
 *
 * 用法：node tests/unit-smoke.mjs
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:\\OpenAI\\工作区1\\记忆大脑\\tests\\tmp-workspace'
const state = 'D:\\OpenAI\\工作区1\\记忆大脑\\tests\\tmp-state'
rmSync(root, { recursive: true, force: true })
rmSync(state, { recursive: true, force: true })
mkdirSync(join(root, '工作记忆', '项目记忆'), { recursive: true })
mkdirSync(join(root, '工作记忆', '实时记忆'), { recursive: true })
cpSync('D:\\OpenAI\\工作区1\\工作记忆\\项目记忆', join(root, '工作记忆', '项目记忆'), { recursive: true })
writeFileSync(join(root, '工作记忆', '实时记忆', '当前任务.md'), '# 当前任务\n\n## 进行中\n\n单元测试实时卡。\n', 'utf8')

process.env.DSH_BRAIN_STATE_DIR = state
process.env.DSH_BRAIN_GLOBAL_DIR = 'D:\\OpenAI\\全局记忆'
process.env.SAGE_MEM_DIR = 'D:\\OpenAI\\全局记忆'

const { CardStore } = await import('../src/cards.js')
const { createTools } = await import('../src/tools.js')
const { createInjector } = await import('../src/inject.js')
const { searchCards } = await import('../src/search.js')
const { DEFAULT_SETTINGS, loadSettings } = await import('../src/paths.js')

let passed = 0
function ok(name, condition, detail) {
  if (condition) { passed += 1; console.log(`✅ ${name}`) }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ''}`); process.exitCode = 1 }
}

const store = new CardStore({ globalDir: 'D:\\OpenAI\\全局记忆' })
const settings = loadSettings()
assert.equal(settings.threshold, DEFAULT_SETTINGS.threshold)

// ── 存储 / 检索 ──────────────────────────────────────────────────────────────
const cards = store.allCards(root, { includeRealtime: true })
ok('扫描到 3 张全局卡 + 3 张项目卡 + 实时卡', cards.length >= 7, `got ${cards.length}`)
const hit = searchCards(cards, '我是谁？', { topK: 2, maxChars: 600, minScore: 0.5 })
ok('「我是谁」命中用户画像', hit.hits.some((h) => h.file === '用户-画像.md'), JSON.stringify(hit.hits.map((h) => h.file)))
const hit2 = searchCards(cards, '上次定过什么？', { topK: 2, maxChars: 600, minScore: 0.5 })
ok('「上次定过什么」top-2 含 01-决定', hit2.hits.slice(0, 2).some((h) => h.file === '01-决定.md'), JSON.stringify(hit2.hits.map((h) => h.file)))

// ── 4 个工具 ────────────────────────────────────────────────────────────────
const tools = createTools({ ctx: { get: () => undefined }, store, getSettings: () => settings })
const exec = { agent: { session: { header: { cwd: root } } } }
const searchResult = await tools.search.execute({ query: '插件装在哪', limit: 3 }, exec)
ok('memory_search 有命中', searchResult.ok && searchResult.hits.length > 0, JSON.stringify(searchResult))
const readResult = await tools.read.execute({ file: '用户-画像.md', from: 1, lines: 5 }, exec)
ok('memory_read 读到前 5 行', readResult.ok && readResult.content.includes('用户画像'), JSON.stringify(readResult).slice(0, 200))
const writeResult = await tools.write.execute({
  layer: 'project',
  file: '99-测试.md',
  content: '---\nname: 测试卡\ndescription: 单元测试\n---\n\n# 测试\n\n写入内容。\n',
}, exec)
ok('memory_write 写入项目卡', writeResult.ok && readFileSync(join(root, '工作记忆', '项目记忆', '99-测试.md'), 'utf8').includes('写入内容'))
const digestResult = await tools.digest.execute({}, exec)
ok('memory_digest 消化到项目卡', digestResult.ok && readFileSync(join(root, '工作记忆', '项目记忆', '01-决定.md'), 'utf8').includes('dsh-brain:digest'))
ok('memory_digest 清空实时卡', readFileSync(join(root, '工作记忆', '实时记忆', '当前任务.md'), 'utf8').includes('已消化'))

// ── 注入链 ──────────────────────────────────────────────────────────────────
let injection = null
const injector = createInjector({
  ctx: {},
  store,
  getSettings: () => settings,
  getPrompt: () => '我是谁？用一句话回答。',
  onInjection: (info) => { injection = info },
})
const fakeSession = {
  id: 'session-unit-test',
  header: { cwd: root },
  deriveMessages: () => [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '我是谁？用一句话回答。' }] },
  ],
}
const assembled = await injector({ contexts: [] }, { agent: { session: fakeSession } }, async () => ({ contexts: [] }))
const injected = assembled.contexts?.find((c) => c.name === 'dsh-brain:memory')
ok('注入链产出 dsh-brain:memory', Boolean(injected), JSON.stringify(assembled).slice(0, 200))
ok('注入含用户画像 baseline', Boolean(injected && injected.text.includes('用户画像')))
ok('注入记录 token 与文件', Boolean(injection && injection.files.length > 0 && injection.tokens > 0), JSON.stringify(injection))

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`)
