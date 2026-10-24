/**
 * dsh-Ycp · 大肥鱼（能力层）—— 浏览器之手（P11）。
 *
 * 技术选择说明：
 *   本机没装 Playwright（profile 里没有、ms-playwright 缓存也没有）。
 *   按规矩「没装不硬装」，这里改用**系统已装的 Edge / Chrome + Chrome DevTools Protocol**：
 *   无依赖（Node 自带 WebSocket），只在你调用浏览器动作时才起一个 headless 进程，
 *   用专属 user-data-dir，闲置 5 分钟自动关。
 *
 * 能力（每个都过 browser 手权限 + 网址白名单）：
 *   browser.goto       打开网址，回标题与正文预览
 *   browser.text       读当前页正文
 *   browser.click      按文字点一个可见元素
 *   browser.type       往输入框打字
 *   browser.screenshot 截图存到 状态\截图\
 *   browser.wait       等一下（≤5 秒）
 *
 * 白名单在 settings.hands.browserSites；空的就谁也打不开——安全默认。
 * 点完链接会再查一次落地网址，跑出白名单就退回到 about:blank 并报错。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths } from '../kernel/paths.js'

const IDLE_MS = 5 * 60 * 1000
const START_TIMEOUT_MS = 20_000
const NAV_TIMEOUT_MS = 20_000
const MAX_TEXT = 8000
const MAX_HISTORY = 20

export const BROWSER_CANDIDATES = [
  { name: 'Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { name: 'Chrome', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
]

/** 找本机浏览器；YCP_BROWSER_PATH 可以指定一个。 */
export function detectBrowser(env = process.env) {
  const custom = String(env.YCP_BROWSER_PATH ?? '').trim()
  if (custom && existsSync(custom)) return { ok: true, path: custom, name: '自定义', source: 'env' }
  for (const item of BROWSER_CANDIDATES) {
    if (existsSync(item.path)) return { ok: true, path: item.path, name: item.name, source: 'installed' }
  }
  return { ok: false, error: '这台机器没找到 Edge / Chrome；装了任一个就能用浏览器手' }
}

/** 把 "https://a.com/x" 或 "a.com" 都收成 "a.com"。 */
export function siteHost(site) {
  const text = String(site ?? '').trim().toLowerCase()
  if (!text) return ''
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname
  } catch {
    return ''
  }
}

export function hostMatches(host, site) {
  const target = String(host ?? '').toLowerCase()
  const allowed = siteHost(site)
  if (!target || !allowed) return false
  return target === allowed || target.endsWith(`.${allowed}`)
}

/** 白名单里写了 * 就是不限制浏览。 */
export function isUnrestricted(sites) {
  return Array.isArray(sites) && sites.some((site) => String(site).trim() === '*')
}

/**
 * 网址能不能开。
 * 不限模式只拦协议（file: / javascript: 这些不给）；受限模式按白名单，空名单全拒。
 * @returns {{ok: boolean, reason?: string, error?: string, url?: string, host?: string}}
 */
export function checkUrlAllowed(url, sites) {
  const raw = String(url ?? '').trim()
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'bad-url', error: `网址不合法：${raw}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'bad-url', error: `只接受 http / https，收到 ${parsed.protocol}` }
  }
  const list = Array.isArray(sites) ? sites.filter(Boolean) : []
  if (isUnrestricted(list)) return { ok: true, url: parsed.href, host: parsed.hostname }
  if (list.length === 0) {
    return { ok: false, reason: 'empty-allowlist', error: '白名单是空的，先在面板里加一个站点，或填 * 表示不限制' }
  }
  if (!list.some((site) => hostMatches(parsed.hostname, site))) {
    return { ok: false, reason: 'not-allowed', error: `${parsed.hostname} 不在白名单里` }
  }
  return { ok: true, url: parsed.href, host: parsed.hostname }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 极简 CDP 客户端：一条 WebSocket，按 id 配对，能发会话级命令。 */
class Cdp {
  constructor(url) {
    this.url = url
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
  }

  async open() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      const timer = setTimeout(() => reject(new Error('连 CDP 超时')), 10_000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
      ws.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(new Error(`CDP 连接失败：${event?.message ?? 'unknown'}`))
      })
      ws.addEventListener('message', (event) => this.onMessage(event.data))
      ws.addEventListener('close', () => {
        this.closed = true
        for (const { reject: fail } of this.pending.values()) fail(new Error('CDP 连接已关闭'))
        this.pending.clear()
      })
    })
    return this
  }

  onMessage(data) {
    let message
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    if (message.id && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(message.error.message || 'CDP 出错'))
      else entry.resolve(message.result)
    }
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.closed) return Promise.reject(new Error('CDP 连接已关闭'))
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} 超时`))
      }, 25_000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify(payload))
    })
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      /* 已经关了 */
    }
    this.closed = true
  }
}

/**
 * 浏览器手本体：懒启动、共享一个 headless 进程。
 */
export function createBrowserHand(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({})
  const log = typeof options.log === 'function' ? options.log : () => {}
  const env = options.env ?? process.env

  let session = null
  let starting = null
  let timer = null
  let lastUsed = 0
  let current = { url: 'about:blank', title: '' }
  const history = []

  function paths() {
    const root = join(homePaths().root, '状态', '浏览器')
    return {
      root,
      profile: join(root, 'profile'),
      history: join(root, '最近动作.json'),
      shotDir: join(homePaths().root, '状态', '截图'),
    }
  }

  function remember(action, detail, ok = true) {
    const entry = { at: Date.now(), action, detail, ok }
    history.push(entry)
    while (history.length > MAX_HISTORY) history.shift()
    try {
      const file = paths().history
      const dir = join(homePaths().root, '状态', '浏览器')
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(history, null, 2) + '\n', 'utf8')
    } catch {
      /* 记不下来不影响动作 */
    }
    log('浏览器动作', { action, detail, ok })
  }

  function status() {
    const detected = detectBrowser(env)
    const sites = Array.isArray(getSettings()?.hands?.browserSites) ? getSettings().hands.browserSites : []
    return {
      available: detected.ok,
      browser: detected.ok ? { name: detected.name, path: detected.path } : null,
      error: detected.ok ? null : detected.error,
      running: Boolean(session),
      sites,
      unrestricted: isUnrestricted(sites),
      current: { ...current },
      recent: history.slice(-10).reverse(),
    }
  }

  async function start(options = {}) {
    const headless = options.headless !== false
    if (session) {
      // 用户关掉可见窗口后子进程会退出，下一次动作要重新拉起
      if (session.child.exitCode === null) return session
      session = null
    }
    if (starting) return starting
    starting = (async () => {
      const detected = detectBrowser(env)
      if (!detected.ok) throw new Error(detected.error)
      const dirs = paths()
      mkdirSync(dirs.profile, { recursive: true })
      const args = [
        ...(headless ? ['--headless=new'] : ['--window-size=1280,860', '--window-position=80,60']),
        '--remote-debugging-port=0',
        `--user-data-dir=${dirs.profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-features=Translate,BackForwardCache',
        'about:blank',
      ]
      const child = spawn(detected.path, args, { windowsHide: true, stdio: 'ignore' })
      const portFile = join(dirs.profile, 'DevToolsActivePort')
      // 上一次会话留下的端口文件是死的，先删掉再等新的，否则会连到一个已关闭的端口。
      try { rmSync(portFile, { force: true }) } catch { /* 没权限删就靠后面校验 */ }
      const deadline = Date.now() + START_TIMEOUT_MS
      let port = 0
      let path = ''
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('浏览器进程启动后就退出了')
        if (existsSync(portFile)) {
          const [line1, line2] = readFileSync(portFile, 'utf8').split(/\r?\n/)
          if (line1 && line2) {
            port = Number(line1)
            path = line2.trim()
            break
          }
        }
        await sleep(200)
      }
      if (!port || !path) {
        try { child.kill() } catch { /* 已经死了 */ }
        throw new Error('等不到浏览器的调试端口（可能被安全软件拦了）')
      }
      const cdp = await new Cdp(`ws://127.0.0.1:${port}${path}`).open()
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
      await cdp.send('Page.enable', {}, sessionId)
      await cdp.send('Runtime.enable', {}, sessionId)
      session = { child, cdp, sessionId, targetId, browser: detected, visible: !headless }
      lastUsed = Date.now()
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        if (session && !session.visible && Date.now() - lastUsed > IDLE_MS) {
          close().catch(() => {})
        }
      }, 60_000)
      if (typeof timer.unref === 'function') timer.unref()
      remember('启动', `${detected.name} ${headless ? 'headless' : '可见窗口'}`, true)
      return session
    })().finally(() => { starting = null })
    return starting
  }

  async function evaluate(expression) {
    const s = await start()
    lastUsed = Date.now()
    const result = await s.cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, s.sessionId)
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本出错')
    }
    return result?.result?.value
  }

  async function waitReady(timeoutMs = NAV_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const state = await evaluate('document.readyState')
        if (state === 'complete') return true
      } catch {
        /* 页面还在换 */
      }
      await sleep(200)
    }
    return false
  }

  async function goto(url) {
    const sites = getSettings()?.hands?.browserSites
    const checked = checkUrlAllowed(url, sites)
    if (!checked.ok) {
      remember('goto', `${url}（${checked.reason}）`, false)
      throw new Error(checked.error)
    }
    const s = await start()
    lastUsed = Date.now()
    await s.cdp.send('Page.navigate', { url: checked.url }, s.sessionId)
    await waitReady()
    const info = await evaluate('({url: location.href, title: document.title, text: (document.body ? document.body.innerText : "")})')
    const page = { url: info?.url ?? checked.url, title: info?.title ?? '', text: String(info?.text ?? '').slice(0, MAX_TEXT) }
    current = { url: page.url, title: page.title }
    // 落地网址也要在白名单里（重定向可能跑出去）
    const landed = checkUrlAllowed(page.url, sites)
    if (!landed.ok) {
      await s.cdp.send('Page.navigate', { url: 'about:blank' }, s.sessionId)
      current = { url: 'about:blank', title: '' }
      remember('goto', `${url} 落到白名单外 ${page.url}`, false)
      throw new Error(`落地到白名单外：${page.url}`)
    }
    remember('goto', page.url, true)
    return page
  }

  async function text() {
    const info = await evaluate('({url: location.href, title: document.title, text: (document.body ? document.body.innerText : "")})')
    lastUsed = Date.now()
    current = { url: info?.url ?? current.url, title: info?.title ?? current.title }
    return { url: current.url, title: current.title, text: String(info?.text ?? '').slice(0, MAX_TEXT) }
  }

  /** 在页面里执行一段 JS，用来点没有文字的按钮、填表、读状态。 */
  async function evalJs(expression) {
    const code = String(expression ?? '').trim()
    if (!code) throw new Error('要执行什么脚本？')
    if (code.length > 8000) throw new Error('脚本太长（上限 8000 字符）')
    const value = await evaluate(code)
    remember('页面脚本', code.slice(0, 80), true)
    return { value: value === undefined ? null : value }
  }

  /**
   * 打开一个**可见**的浏览器窗口，让主人自己登录。
   * 登录态就存在她的浏览器 profile 里，之后 headless 的动作也带着它。
   */
  async function login(url = 'https://www.bilibili.com') {
    const target = String(url || 'https://www.bilibili.com').trim()
    const checked = checkUrlAllowed(target, getSettings()?.hands?.browserSites)
    if (!checked.ok) throw new Error(checked.error)
    await close()
    const s = await start({ headless: false })
    lastUsed = Date.now()
    await s.cdp.send('Page.navigate', { url: checked.url }, s.sessionId)
    await waitReady(20_000)
    const info = await evaluate('({url: location.href, title: document.title})').catch(() => null)
    remember('打开登录窗口', checked.url, true)
    return {
      opened: true,
      url: info?.url ?? checked.url,
      title: info?.title ?? '',
      note: '这是她的浏览器窗口。在这里登录 B站/抖音/小黑盒，登录完直接关掉窗口；登录态留在她的 profile 里，之后 headless 动作也能用。只登你愿意交给她的账号。',
    }
  }

  async function click(label) {
    const target = String(label ?? '').trim()
    if (!target) throw new Error('要按哪个字点？')
    const found = await evaluate(`(() => {
      const wanted = ${JSON.stringify(target)};
      const nodes = [...document.querySelectorAll('a,button,input[type=submit],[role=button],label,li,span,div')];
      const el = nodes.find((node) => {
        const label = (node.innerText || node.value || '').trim();
        const rect = node.getBoundingClientRect();
        return label.includes(wanted) && rect.width > 0 && rect.height > 0;
      });
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: el.tagName, text: (el.innerText || '').trim().slice(0, 80) };
    })()`)
    if (!found) {
      remember('click', target, false)
      throw new Error(`页面上没找到写着「${target}」的东西`)
    }
    const s = await start()
    const x = Number(found.x)
    const y = Number(found.y)
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s.sessionId)
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, s.sessionId)
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, s.sessionId)
    await sleep(600)
    await waitReady(8000)
    const landed = await text()
    const sites = getSettings()?.hands?.browserSites
    if (!checkUrlAllowed(landed.url, sites).ok) {
      await s.cdp.send('Page.navigate', { url: 'about:blank' }, s.sessionId)
      current = { url: 'about:blank', title: '' }
      remember('click', `${target} → 白名单外 ${landed.url}`, false)
      throw new Error(`点完跑到白名单外了：${landed.url}`)
    }
    remember('click', `${target} → ${found.tag}`, true)
    return { clicked: target, tag: found.tag, url: landed.url, title: landed.title }
  }

  async function type(text, selector) {
    const value = String(text ?? '')
    if (!value) throw new Error('要打什么字？')
    const focused = await evaluate(`(() => {
      const selector = ${JSON.stringify(String(selector ?? ''))};
      let el = selector ? document.querySelector(selector) : null;
      if (!el) {
        el = [...document.querySelectorAll('input:not([type=hidden]), textarea')].find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      }
      if (!el) return null;
      el.focus();
      return { tag: el.tagName, type: el.getAttribute('type') || '', placeholder: el.getAttribute('placeholder') || '' };
    })()`)
    if (!focused) {
      remember('type', '没找到输入框', false)
      throw new Error('页面上没找到能打字的输入框')
    }
    const s = await start()
    await s.cdp.send('Input.insertText', { text: value }, s.sessionId)
    lastUsed = Date.now()
    remember('type', `${value.slice(0, 40)} → ${focused.placeholder || focused.tag}`, true)
    return { typed: value.length, into: focused.placeholder || focused.tag }
  }

  async function screenshot() {
    const s = await start()
    lastUsed = Date.now()
    const shot = await s.cdp.send('Page.captureScreenshot', { format: 'png' }, s.sessionId)
    const dir = paths().shotDir
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
    const file = join(dir, `browser-${stamp}.png`)
    const bytes = Buffer.from(String(shot.data ?? ''), 'base64')
    writeFileSync(file, bytes)
    remember('screenshot', `${basename(file)} ${bytes.length}B`, true)
    return { file, bytes: bytes.length }
  }

  async function wait(ms) {
    const value = Math.min(5000, Math.max(100, Number(ms) || 1000))
    await sleep(value)
    lastUsed = Date.now()
    remember('wait', `${value}ms`, true)
    return { waitedMs: value }
  }

  async function close() {
    const s = session
    session = null
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (!s) return { closed: false }
    try {
      s.cdp.close()
    } catch {
      /* 已经断开 */
    }
    try {
      if (process.platform === 'win32' && s.child.pid) {
        execFileSync('taskkill', ['/PID', String(s.child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        s.child.kill()
      }
    } catch {
      /* 进程可能已经退出 */
    }
    current = { url: 'about:blank', title: '' }
    remember('关闭', '手动或闲置超时', true)
    return { closed: true }
  }

  return { status, goto, text, click, type, screenshot, wait, close, start, evalJs, login }
}

function basename(file) {
  return String(file).split(/[\\/]/).pop()
}

/** 把浏览器动作挂进注册表（每条都要 browser 这条手开着）。 */
export function installBrowserTools(registry, hand) {
  const tools = [
    {
      id: 'browser.goto',
      description: '打开一个网址（只限白名单站点），返回标题和正文预览',
      hand: 'browser',
      schema: { type: 'object', properties: { url: { type: 'string', description: 'http/https 网址' } }, required: ['url'] },
      run: async ({ url }) => hand.goto(url),
    },
    {
      id: 'browser.text',
      description: '读当前页面的正文（最多 8000 字）',
      hand: 'browser',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => hand.text(),
    },
    {
      id: 'browser.click',
      description: '按页面上的文字点一下可见的链接 / 按钮',
      hand: 'browser',
      schema: { type: 'object', properties: { text: { type: 'string', description: '要点的文字' } }, required: ['text'] },
      run: async ({ text }) => hand.click(text),
    },
    {
      id: 'browser.type',
      description: '往输入框里打字（默认找页面上第一个可见输入框）',
      hand: 'browser',
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要输入的内容' },
          selector: { type: 'string', description: '可选 CSS 选择器' },
        },
        required: ['text'],
      },
      run: async ({ text, selector }) => hand.type(text, selector),
    },
    {
      id: 'browser.screenshot',
      description: '截一张当前页面的图，存到 状态\\截图\\',
      hand: 'browser',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => hand.screenshot(),
    },
    {
      id: 'browser.wait',
      description: '等一会儿（100–5000 毫秒）',
      hand: 'browser',
      schema: { type: 'object', properties: { ms: { type: 'integer', description: '毫秒' } }, required: ['ms'] },
      run: async ({ ms }) => hand.wait(ms),
    },
    {
      id: 'browser.login',
      description: '打开一个可见的浏览器窗口，让主人自己登录 B站/抖音/小黑盒；登录完关掉窗口，登录态留在她的浏览器里',
      hand: 'browser',
      schema: {
        type: 'object',
        properties: { url: { type: 'string', description: '要登录的站点，默认 B站首页' } },
        required: [],
      },
      run: async ({ url }) => hand.login(url),
    },
    {
      id: 'browser.eval',
      description: '在她当前页面里执行一段 JS：点没文字的按钮、填表、读页内状态（登录后的动作，需打开「登录后的动作」手）',
      hand: 'actions',
      schema: {
        type: 'object',
        properties: { expression: { type: 'string', description: '要执行的 JS，可 return 一个能序列化的值' } },
        required: ['expression'],
      },
      run: async ({ expression }) => hand.evalJs(expression),
    },
  ]

  for (const tool of tools) {
    const result = registry.registerTool(tool)
    if (!result.ok) throw new Error(`注册 ${tool.id} 失败：${result.error}`)
  }
}
