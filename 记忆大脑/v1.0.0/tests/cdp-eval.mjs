/** 在 CDP 页面里执行一段 JS：node tests/cdp-eval.mjs "<expression>" */
const expression = process.argv[2]
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223'
const want = process.argv[3] || ''
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
const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
if (result.exceptionDetails) console.error(JSON.stringify(result.exceptionDetails))
else console.log(typeof result.result?.value === 'string' ? result.result.value : JSON.stringify(result.result?.value))
ws.close()
process.exit(0)
