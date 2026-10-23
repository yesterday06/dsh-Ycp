/**
 * 面板交互验收：编辑一张临时卡并保存、改阈值并保存。
 * 前置：临时 web profile 在 38421 运行，且已通过 HTTP 创建 zz-面板测试.md。
 */
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223'
const url = process.env.PANEL_URL || 'http://127.0.0.1:38421'
const list = await (await fetch(`${endpoint}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && String(t.url).includes('38421')) || list.find((t) => t.type === 'page')
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed')
  return result.result?.value
}
const check = (name, condition, detail) => console.log(`${condition ? '✅' : '❌'} ${name}${condition ? '' : `: ${detail ?? ''}`}`)

await call('Page.enable')
await call('Runtime.enable')

// 1. 找到临时卡，点「编辑」
const open = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.db-row')].find((r) => r.innerText.includes('zz-面板测试'));
  if (!row) return { ok: false, text: document.body.innerText.slice(0, 800) };
  const btn = [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === '编辑');
  if (!btn) return { ok: false, text: row.innerText };
  btn.click();
  return { ok: true, text: row.innerText };
})()`)
check('面板出现临时测试卡', open.ok, open.text)
await sleep(800)
const editor = await evaluate(`(() => {
  const ta = document.querySelector('.db-editor textarea');
  return ta ? { ok: true, value: ta.value } : { ok: false };
})()`)
check('点「编辑」打开编辑器', editor.ok && editor.value.includes('原始内容'), JSON.stringify(editor).slice(0, 300))

// 2. 改内容 → 保存
const saved = await evaluate(`(() => {
  const ta = document.querySelector('.db-editor textarea');
  if (!ta) return 'no textarea';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '---\\nname: 面板测试\\ndescription: 临时测试卡\\n---\\n\\n# 面板测试\\n\\n面板改过的内容。\\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = [...document.querySelectorAll('.db-editor button')].find((b) => b.innerText.trim() === '保存');
  if (!btn) return 'no save button';
  btn.click();
  return 'clicked';
})()`)
check('点击保存', saved === 'clicked', saved)
await sleep(1800)

// 3. 改阈值 → 保存设置
const settingsSaved = await evaluate(`(() => {
  const field = [...document.querySelectorAll('.db-field')].find((f) => f.innerText.includes('阈值'));
  if (!field) return 'no field';
  const input = field.querySelector('input[type=number]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '7');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = [...document.querySelectorAll('.db-section button')].find((b) => b.innerText.trim() === '保存设置');
  if (!btn) return 'no settings button';
  btn.click();
  return 'clicked';
})()`)
check('点击保存设置', settingsSaved === 'clicked', settingsSaved)
await sleep(1500)
const notice = await evaluate(`document.body.innerText.indexOf('设置已生效') >= 0 || document.body.innerText.indexOf('已保存') >= 0`)
check('面板出现保存提示', notice)
const panelText = await evaluate(`document.body.innerText`)
console.log('--- panel tail ---')
console.log(panelText.slice(Math.max(0, panelText.length - 1200)))

ws.close()
process.exit(process.exitCode || 0)
