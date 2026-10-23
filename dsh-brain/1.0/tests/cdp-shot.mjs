/** 截取当前 CDP 页面截图：node tests/cdp-shot.mjs <out.png> [urlSubstring] */
import { writeFileSync } from 'node:fs'

const out = process.argv[2]
const want = process.argv[3] || ''
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223'
if (!out) throw new Error('usage: cdp-shot.mjs <out.png> [urlSubstring]')

const list = await (await fetch(`${endpoint}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && (!want || String(t.url).includes(want))) || list.find((t) => t.type === 'page')
if (!target) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data))
  if (!msg.id || !pending.has(msg.id)) return
  const { res, rej } = pending.get(msg.id)
  pending.delete(msg.id)
  if (msg.error) rej(new Error(msg.error.message))
  else res(msg.result)
})
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { res: resolve, rej: reject })
  ws.send(JSON.stringify({ id, method, params }))
})
await call('Page.enable')
const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`saved ${out} (${Buffer.from(shot.data, 'base64').length} bytes) from ${target.url}`)
ws.close()
process.exit(0)
