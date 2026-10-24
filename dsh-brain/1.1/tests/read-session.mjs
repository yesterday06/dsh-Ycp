/**
 * 读 DSH 会话日志（多帧 zstd）并打印事件摘要。
 * 用法：node tests/read-session.mjs <session-id>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const rawId = process.argv[2]
if (!rawId) throw new Error('usage: read-session.mjs <session-id>')
const id = rawId.replace(/^session-/, '')
const root = join(homedir(), '.dsh', 'sessions')
let file = ''
for (const ws of readdirSync(root)) {
  const candidate = join(root, ws, `session-${id}`, 'session.v4.jsonl.zstd')
  try { if (statSync(candidate).isFile()) { file = candidate; break } } catch { /* next */ }
}
if (!file) throw new Error(`session ${id} not found`)

const buf = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; i + 4 <= buf.length; i += 1) {
  if (buf[i] === magic[0] && buf[i + 1] === magic[1] && buf[i + 2] === magic[2] && buf[i + 3] === magic[3]) starts.push(i)
}
let text = ''
for (let i = 0; i < starts.length; i += 1) {
  const frame = buf.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : buf.length)
  try { text += zstdDecompressSync(frame).toString('utf8') } catch (error) { text += `\n{"__decode_error":"${String(error?.message ?? error)}"}\n` }
}
const events = text.split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
console.log(`# ${file}`)
console.log(`# ${events.length} events, ${buf.length} bytes compressed, ${text.length} bytes text`)
for (const event of events) {
  const data = event.data || event
  const type = event.type || event.kind || '?'
  if (type === 'session' || type === 'session/start' || event.sessionId) {
    console.log(`${event.seq ?? ''} ${type} ${JSON.stringify({ sessionId: event.sessionId, cwd: event.cwd, agentPreset: data.agentPreset }).slice(0, 220)}`)
    continue
  }
  if (type === 'permission/preset' || type === 'sandbox/mode' || type === 'approval/policy') {
    console.log(`${event.seq ?? ''} ${type} ${JSON.stringify(data)}`)
    continue
  }
  if (type === 'request/header') {
    console.log(`${event.seq ?? ''} ${type} ${JSON.stringify(data.header?.config ?? data).slice(0, 300)}`)
    continue
  }
  if (type === 'request/context') {
    console.log(`${event.seq ?? ''} ${type} ${JSON.stringify(data).slice(0, 220)}`)
    continue
  }
  if (type === 'user/message') {
    const content = JSON.stringify(data.message?.content ?? data.content ?? '').slice(0, 140)
    console.log(`${event.seq ?? ''} ${type} ${content}`)
    continue
  }
  if (type === 'assistant/message') {
    console.log(`${event.seq ?? ''} ${type} usage=${JSON.stringify(data.usage ?? {})} text=${JSON.stringify(data.message?.content ?? '').slice(0, 220)}`)
    continue
  }
  console.log(`${event.seq ?? ''} ${type}`)
}
