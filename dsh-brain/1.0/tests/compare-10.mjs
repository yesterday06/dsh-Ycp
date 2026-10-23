/**
 * 10 问回归对照：sage-mem 基线 vs dsh-brain。
 *
 * 用法（PowerShell）：
 *   $env:SAGE_MEM_DIR='D:\OpenAI\全局记忆'
 *   node tests/compare-10.mjs
 *
 * 命中定义：问题期望的卡片文件出现在前 N 条结果里。两边都取前 3 条
 * （sage-mem 注入名额是 10、工具是 5；dsh-brain 注入是 2、工具是 5，
 * 这里统一按「检索结果前 3」比较召回，另记注入 top-2 的命中）。
 */
import { readFileSync } from 'node:fs'
import { CardStore } from '../src/cards.js'
import { searchCards } from '../src/search.js'
import { resolveGlobalDir } from '../src/paths.js'

const WORKSPACE = 'D:\\OpenAI\\工作区1'
const QUESTIONS = [
  { q: '我是谁？', expect: ['用户-画像.md'] },
  { q: '我的身份和专业是什么？', expect: ['用户-画像.md'] },
  { q: '上次定过什么？', expect: ['01-决定.md'] },
  { q: '插件装在哪？', expect: ['环境-机器.md'] },
  { q: 'DSH 版本是多少？', expect: ['环境-机器.md'] },
  { q: '这个工作区是干什么的？', expect: ['00-概况.md', '索引-项目.md'] },
  { q: '全局记忆目录在哪？', expect: ['环境-机器.md'] },
  { q: '回滚脚本在哪？', expect: ['环境-机器.md'] },
  { q: '踩过什么坑？', expect: ['02-坑.md'] },
  { q: '项目索引里有什么？', expect: ['索引-项目.md'] },
]

const global = resolveGlobalDir()
const store = new CardStore({ globalDir: global.dir, globalSource: global.source })
const cards = store.allCards(WORKSPACE, { includeRealtime: true })
console.log(`# dsh-brain cards: ${cards.map((c) => c.file).join(', ')}`)
console.log(`# global dir: ${global.dir}`)

let dbHits = 0
let dbTop2 = 0
const dbRows = []
for (const item of QUESTIONS) {
  const result = searchCards(cards, item.q, { topK: 3, maxChars: 600, minScore: 0.5 })
  const files = result.hits.map((h) => h.file)
  const hit = item.expect.some((f) => files.includes(f)) ? 1 : 0
  const top2Hit = result.hits.slice(0, 2).some((h) => item.expect.includes(h.file)) ? 1 : 0
  dbHits += hit
  dbTop2 += top2Hit
  dbRows.push({ q: item.q, files, scores: result.hits.map((h) => h.score), hit, top2Hit })
}
console.log(`\n## dsh-brain 命中 ${dbHits}/10（top-2 ${dbTop2}/10）`)
for (const row of dbRows) console.log(`${row.hit ? '✅' : '❌'} ${row.q} → ${row.files.join(', ') || '（无）'}  scores=${row.scores.join(',')}`)

// ── sage-mem 基线 ────────────────────────────────────────────────────────────
// sage-mem 已于 2026-10-23 卸载，安装时直接跑它的 retrieve；卸载后使用
// baseline-sage-mem.json（同一批问题、同一目录、同一时点的记录）。
const sageRoot = 'C:/Users/淡痕/.dsh/profiles/desktop/node_modules/sage-mem/lib/memory'
let sageHits = 0
let sageRows = []
try {
  const { scanMemoryFiles } = await import(`file:///${sageRoot}/scan.js`)
  const { retrieve } = await import(`file:///${sageRoot}/search.js`)
  const files = await scanMemoryFiles({}, 'compare')
  console.log(`\n# sage-mem files: ${files.map((f) => f.file).join(', ')}`)
  for (const item of QUESTIONS) {
    const result = retrieve({ query: item.q, files, scope: 'all', limit: 3 })
    const got = (result.hits || []).map((h) => h.file)
    const hit = item.expect.some((f) => got.includes(f)) ? 1 : 0
    sageHits += hit
    sageRows.push({ q: item.q, files: got, hit })
  }
  console.log(`\n## sage-mem 命中 ${sageHits}/10（前 3 条）`)
} catch {
  const baseline = JSON.parse(readFileSync(new URL('./baseline-sage-mem.json', import.meta.url), 'utf8'))
  sageHits = baseline.hits
  sageRows = baseline.rows
  console.log(`\n# sage-mem 已卸载，使用 ${baseline.measuredAt} 保存的基线（${baseline.version}）`)
  console.log(`\n## sage-mem 基线命中 ${sageHits}/${baseline.total}（前 3 条）`)
}
for (const row of sageRows) console.log(`${row.hit ? '✅' : '❌'} ${row.q} → ${row.files.join(', ') || '（无）'}`)
console.log(`\n## 结论：dsh-brain ${dbHits}/10 vs sage-mem 基线 ${sageHits}/10 → ${dbHits >= sageHits ? '达标' : '未达标'}`)
if (dbHits < sageHits) process.exitCode = 1

