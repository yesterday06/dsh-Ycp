// 临时调试工具：在 app.asar 内按关键字搜索（asar 只有 Electron-as-Node 能读）。
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const pattern = process.argv[3]
if (!root || !pattern) throw new Error('usage: asar-grep.mjs <dir> <regex>')
const re = new RegExp(pattern, 'i')
let hits = 0

function walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) { walk(full); continue }
    if (!/\.(js|mjs|cjs|json|md|d\.ts)$/.test(ent.name)) continue
    let text
    try { text = fs.readFileSync(full, 'utf8') } catch { continue }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      console.log(`${full}:${i + 1}: ${lines[i].slice(0, 220)}`)
      hits++
      if (hits >= 120) { console.log('--- stopped at 120 hits'); return }
    }
  }
}

walk(root)
console.log(`--- ${hits} hits`)
