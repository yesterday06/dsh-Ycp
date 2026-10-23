/**
 * 用 Edge headless + CDP 检查页面 DOM（无需 Playwright）。
 * 用法：node tests/cdp-check.mjs http://127.0.0.1:38421/?token=...
 */
const url = process.argv[2]
if (!url) throw new Error('usage: cdp-check.mjs <url>')
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223'

async function newTarget() {
  const res = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!res.ok) throw new Error(`CDP new target HTTP ${res.status}`)
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    ws.addEventListener('open', () => resolve({
      call(method, params = {}) {
        return new Promise((res, rej) => {
          const id = nextId++
          pending.set(id, { res, rej })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { try { ws.close() } catch { /* 已关闭 */ } },
    }))
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (event) => {
      let msg
      try { msg = JSON.parse(String(event.data)) } catch { return }
      if (!msg.id || !pending.has(msg.id)) return
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ''}`))
      else res(msg.result)
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const target = await newTarget()
console.log(`# target ${target.id}`)
const page = await connect(target.webSocketDebuggerUrl)
await page.call('Page.enable')
await page.call('Runtime.enable')
await sleep(6000)

async function evaluate(expression) {
  const result = await page.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed')
  return result.result?.value
}

const snapshot = await evaluate(`(() => {
  const text = document.body ? document.body.innerText : '';
  const attrs = [];
  for (const el of document.querySelectorAll('[aria-label],[title]')) {
    const a = el.getAttribute('aria-label'); const t = el.getAttribute('title');
    if (a) attrs.push('aria:' + a); if (t) attrs.push('title:' + t);
  }
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 40);
  return JSON.stringify({ length: text.length, text: text.slice(0, 5000), attrs: [...new Set(attrs)].slice(0, 80), buttons });
})()`)
const before = JSON.parse(snapshot)
console.log(`# body text length ${before.length}`)
console.log(`# labels with 记忆/Memory: ${before.attrs.filter((x) => /记忆|Memory/.test(x)).join(' | ') || '（无）'}`)
console.log(`# buttons: ${before.buttons.slice(0, 20).join(' | ')}`)
console.log(`# 全局卡片 before: ${/全局卡片/.test(before.text)}`)

const clicked = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('[aria-label],[title]')];
  const hit = nodes.find((el) => /记忆大脑/.test((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')));
  if (hit) { hit.click(); return 'clicked ' + (hit.getAttribute('aria-label') || hit.getAttribute('title')); }
  // 兜底：侧栏里唯一的 svg 按钮
  const svgs = [...document.querySelectorAll('button svg')];
  if (svgs.length) { svgs[svgs.length - 1].closest('button').click(); return 'clicked svg fallback'; }
  return 'not found';
})()`)
console.log(`# click: ${clicked}`)
await sleep(2500)

const after = JSON.parse(await evaluate(`(() => {
  const text = document.body ? document.body.innerText : '';
  return JSON.stringify({ text: text.slice(0, 8000), hasPanel: !!document.querySelector('.db-panel') });
})()`))
console.log(`# has .db-panel: ${after.hasPanel}`)
for (const keyword of ['记忆大脑', '全局卡片', '项目卡片', '实时卡', '立即接续', '立即消化', '自动接续', '保存设置']) {
  console.log(`# ${keyword}: ${after.text.includes(keyword)}`)
}
console.log('--- panel text ---')
console.log(after.text.slice(0, 3500))
page.close()
process.exit(0)
