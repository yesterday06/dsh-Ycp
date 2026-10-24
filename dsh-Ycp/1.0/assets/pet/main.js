/**
 * dsh-Ycp · 大肥鱼桌宠窗口（独立 Electron 进程）。
 *
 * 为什么是独立进程：插件跑在 Host 里，没有 Electron 主进程权限；
 * 主人在机器上已经有 dsh-pet 装的 Electron（~/.dsh/electron/electron.exe），用它起一个自己的窗口最省事。
 *
 * 参数：
 *   --ycp-state <文件>   窗口状态写这里（位置/状态/被点次数），宿主读它
 *   --ycp-url <地址>     右键菜单里"聊天/设置"打开的地址
 */
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const STATE_FILE = argOf('--ycp-state', path.join(__dirname, 'window-state.json'))
const CONFIG_FILE = argOf('--ycp-config', path.join(__dirname, 'window-config.json'))
const STATE_DIR = path.dirname(STATE_FILE)
const CHAT_REQUEST = path.join(STATE_DIR, '对话请求.json')
const CHAT_REPLY = path.join(STATE_DIR, '对话回复.json')
const DSH_URL = argOf('--ycp-url', '')
const NAME = process.env.YCP_NAME || '大肥鱼'
const BASE_WIDTH = 250
const BASE_HEIGHT = 460

app.disableHardwareAcceleration()

let win = null
let dragOffset = null
let throwTimer = null
let statusTimer = null
let state = 'idle'
let reactions = 0
let readyAt = 0
let chatWin = null
let menuWin = null
let cookie = ''
let scale = 1
let pinned = false
let gravity = true
let tray = null
let WIDTH = BASE_WIDTH
let HEIGHT = BASE_HEIGHT

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')
    const data = JSON.parse(raw)
    if (Number(data.scale) >= 0.5 && Number(data.scale) <= 2.2) scale = Number(data.scale)
    pinned = Boolean(data.pinned)
    gravity = data.gravity !== false
  } catch { /* 第一次没有配置 */ }
  WIDTH = Math.round(BASE_WIDTH * scale)
  HEIGHT = Math.round(BASE_HEIGHT * scale)
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ scale, pinned }, null, 2) + '\n', 'utf8')
  } catch { /* 记不下来不影响运行 */ }
}

loadConfig()

/** 登录面板一次，拿到 cookie；桌宠里的对话/设置都走这条通道。 */
async function ensureCookie() {
  if (cookie || !DSH_URL) return cookie
  try {
    const response = await fetch(DSH_URL)
    const raw = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : String(response.headers.get('set-cookie') || '').split(/,(?=[^;]+=)/)
    cookie = raw.map((item) => item.split(';')[0]).filter(Boolean).join('; ')
  } catch {
    cookie = ''
  }
  return cookie
}

async function apiFetch(pathName, method = 'GET', body) {
  if (!DSH_URL) throw new Error('没有面板地址')
  await ensureCookie()
  const url = new URL(pathName, DSH_URL)
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 300) } }
  return { ok: response.ok, status: response.status, data }
}

async function downloadAudio(urlPath) {
  if (!DSH_URL) throw new Error('没有面板地址')
  await ensureCookie()
  const url = new URL(urlPath, DSH_URL)
  const response = await fetch(url, { headers: cookie ? { cookie } : {} })
  if (!response.ok) throw new Error(`音频 ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const file = path.join(app.getPath('temp'), `ycp-voice-${Date.now()}.${urlPath.endsWith('.mp3') ? 'mp3' : 'wav'}`)
  fs.writeFileSync(file, buffer)
  return file
}

function workArea() {
  return screen.getPrimaryDisplay().workArea
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value))
}

/** 兜底：任何移动之后都保证整只窗在某个屏幕里，尺寸也不许被 DPI 改掉。 */
function ensureOnScreen() {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  const width = WIDTH
  const height = HEIGHT
  const x = clamp(b.x, area.x, area.x + area.width - width)
  const y = clamp(b.y, area.y, area.y + area.height - height)
  if (b.x !== x || b.y !== y || b.width !== width || b.height !== height) {
    win.setBounds({ x, y, width, height })
  }
}

function currentStatus() {
  const bounds = win && !win.isDestroyed() ? win.getBounds() : null
  return {
    pid: process.pid,
    ready: Boolean(win && !win.isDestroyed()),
    readyAt,
    state,
    reactions,
    scale,
    pinned,
    bounds,
    at: Date.now(),
  }
}

function writeStatus() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(currentStatus(), null, 2) + '\n', 'utf8')
  } catch {
    /* 写不进去不影响窗口 */
  }
}

function scheduleStatus() {
  if (statusTimer) return
  statusTimer = setTimeout(() => {
    statusTimer = null
    writeStatus()
  }, 120)
}

function stopThrow() {
  if (throwTimer) {
    clearInterval(throwTimer)
    throwTimer = null
  }
}

/** 放手后的抛掷：重力 + 碰边反弹 + 摩擦，慢下来就停。 */
function startThrow(vx, vy) {
  stopThrow()
  if (!win || win.isDestroyed()) return
  const area = workArea()
  let x = win.getBounds().x
  let y = win.getBounds().y
  let speedX = vx
  let speedY = vy
  let onGround = false

  throwTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      stopThrow()
      return
    }
    speedY += 0.9
    x += speedX
    y += speedY

    if (x < area.x) { x = area.x; speedX = Math.abs(speedX) * 0.55 }
    if (x + WIDTH > area.x + area.width) { x = area.x + area.width - WIDTH; speedX = -Math.abs(speedX) * 0.55 }
    if (y < area.y) { y = area.y; speedY = Math.abs(speedY) * 0.55 }

    if (y + HEIGHT > area.y + area.height) {
      y = area.y + area.height - HEIGHT
      speedY = -speedY * 0.5
      speedX *= 0.82
      onGround = true
    } else {
      onGround = false
    }

    win.setPosition(Math.round(x), Math.round(y))
    ensureOnScreen()
    scheduleStatus()

    const slow = Math.abs(speedX) < 0.35 && Math.abs(speedY) < 0.35
    if (slow && onGround) {
      stopThrow()
      ensureOnScreen()
      writeStatus()
    }
  }, 16)
}

function setState(next) {
  const value = ['idle', 'swim', 'nap'].includes(next) ? next : 'idle'
  state = value
  if (win && !win.isDestroyed()) win.webContents.send('ycp:state', value)
  writeStatus()
}

function showMenu() {
  if (!win || win.isDestroyed()) return
  if (!menuWin || menuWin.isDestroyed()) {
    menuWin = new BrowserWindow({
      width: 208,
      height: 366,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    })
    menuWin.loadFile(path.join(__dirname, 'menu.html'))
    menuWin.on('blur', () => { if (menuWin && !menuWin.isDestroyed()) menuWin.hide() })
    menuWin.on('closed', () => { menuWin = null })
  }
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  let x = bounds.x - 214
  if (x < area.x) x = bounds.x + bounds.width + 6
  x = Math.min(Math.max(area.x, x), area.x + area.width - 208)
  const y = Math.min(Math.max(area.y, bounds.y - 20), area.y + area.height - 366)
  menuWin.setBounds({ x, y, width: 208, height: 366 })
  menuWin.show()
  menuWin.focus()
  menuWin.webContents.send('ycp:menu-state', { pinned, gravity, scale })
}

function toggleChatWindow(force) {
  if (!win || win.isDestroyed()) return
  const show = force === undefined ? !(chatWin && chatWin.isVisible()) : Boolean(force)
  if (!chatWin || chatWin.isDestroyed()) {
    chatWin = new BrowserWindow({
      width: 340,
      height: 78,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    })
    chatWin.loadFile(path.join(__dirname, 'chat.html'))
    chatWin.on('closed', () => { chatWin = null })
  }
  if (!show) { chatWin.hide(); return }
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  let x = bounds.x + bounds.width + 6
  if (x + 340 > area.x + area.width) x = bounds.x - 346
  x = Math.max(area.x, x)
  let y = bounds.y + 40
  if (y + 78 > area.y + area.height) y = area.y + area.height - 78
  chatWin.setBounds({ x, y: Math.max(area.y, y), width: 340, height: 78 })
  chatWin.show()
  chatWin.focus()
}

function sendReply(payload) {
  // 不是每条都发表情包：默认三成概率，角色状态系数以后从设置里读。
  const chance = Number(payload && payload.memeChance)
  const memeChance = Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : 0.3
  if (payload && payload.ok && Math.random() > memeChance) delete payload.meme
  sendToWin('ycp:reply', payload)
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('ycp:chat-reply', payload)
}

function setPinned(value) {
  pinned = Boolean(value)
  if (win && !win.isDestroyed()) {
    if (pinned) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
    win.webContents.send('ycp:pinned', pinned)
  }
  saveConfig()
  writeStatus()
}

function applyScale(next) {
  scale = Math.min(2, Math.max(0.5, Number(next) || 1))
  WIDTH = Math.round(BASE_WIDTH * scale)
  HEIGHT = Math.round(BASE_HEIGHT * scale)
  if (win && !win.isDestroyed()) {
    const bounds = win.getBounds()
    const cx = bounds.x + Math.round(bounds.width / 2)
    const cy = bounds.y + Math.round(bounds.height / 2)
    const display = screen.getDisplayNearestPoint({ x: cx, y: cy })
    const area = display.workArea
    const x = clamp(cx - Math.round(WIDTH / 2), area.x, area.x + area.width - WIDTH)
    const y = clamp(cy - Math.round(HEIGHT / 2), area.y, area.y + area.height - HEIGHT)
    win.setBounds({ x, y, width: WIDTH, height: HEIGHT })
    win.webContents.send('ycp:scale', scale)
  }
  saveConfig()
  writeStatus()
}

function leaveDesktopNote(text) {
  try {
    const desktop = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop')
    if (!fs.existsSync(desktop)) return null
    const file = path.join(desktop, '大肥鱼留言.txt')
    fs.appendFileSync(file, `[${new Date().toLocaleString('zh-CN')}] ${text}\n`, 'utf8')
    return file
  } catch {
    return null
  }
}
function sendToWin(channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value)
}

function toggleVisible() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) win.hide()
  else win.show()
}

function updateTray() {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => toggleVisible() },
    { label: pinned ? '取消固定（恢复点击）' : '固定（点不到她）', click: () => setPinned(!pinned) },
    {
      label: '重力模式（松手会掉）',
      type: 'checkbox',
      checked: gravity,
      click: (item) => {
        gravity = Boolean(item.checked)
        if (!gravity) stopThrow()
        saveConfig()
        sendToWin('ycp:gravity', gravity)
        updateTray()
      },
    },
    {
      label: '大小',
      submenu: [
        { label: '小', click: () => applyScale(0.7) },
        { label: '中', click: () => applyScale(1) },
        { label: '大', click: () => applyScale(1.35) },
        { label: '特大', click: () => applyScale(1.7) },
      ],
    },
    { label: '打开面板', click: () => { if (DSH_URL) shell.openExternal(DSH_URL).catch(() => {}) } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(pinned ? NAME + '（已固定）' : NAME)
}

app.whenReady().then(() => {
  const area = workArea()
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: area.x + area.width - WIDTH - 40,
    y: area.y + area.height - HEIGHT - 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.on('console-message', (_event, _level, message) => {
    console.log('[ycp-pet]', message)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.log('[ycp-pet] load failed', code, description, url)
  })
  win.once('ready-to-show', () => {
    win.show()
    readyAt = Date.now()
    writeStatus()
    console.log('YCP_PET_READY')
    if (pinned) win.setIgnoreMouseEvents(true, { forward: true })
    try {
      const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'character', 'tray.png'))
      tray = new Tray(icon)
      tray.on('click', toggleVisible)
      updateTray()
    } catch (error) {
      console.log('[ycp-pet] tray failed', String(error && error.message))
    }
    globalShortcut.register('CommandOrControl+Alt+P', () => {
      if (win && !win.isDestroyed()) setPinned(false)
    })
  })
  win.on('closed', () => {
    stopThrow()
    if (tray) { tray.destroy(); tray = null }
    globalShortcut.unregisterAll()
    win = null
    app.quit()
  })
  win.on('move', scheduleStatus)
})

ipcMain.on('ycp:drag-start', (_event, point) => {
  if (!win || win.isDestroyed()) return
  stopThrow()
  // 尺寸漂移防护：每次拖动前把窗口钉回设定大小
  win.setSize(WIDTH, HEIGHT)
  const [wx, wy] = win.getPosition()
  dragOffset = { dx: wx - Number(point.x), dy: wy - Number(point.y) }
})

ipcMain.on('ycp:drag-move', (_event, point) => {
  if (!win || win.isDestroyed() || !dragOffset) return
  const display = screen.getDisplayNearestPoint({ x: Number(point.x), y: Number(point.y) })
  const area = display.workArea
  const x = clamp(Math.round(Number(point.x) + dragOffset.dx), area.x, area.x + area.width - WIDTH)
  const y = clamp(Math.round(Number(point.y) + dragOffset.dy), area.y, area.y + area.height - HEIGHT)
  win.setPosition(x, y)
  ensureOnScreen()
  scheduleStatus()
})

ipcMain.on('ycp:drag-end', (_event, velocity) => {
  dragOffset = null
  if (!gravity) {
    // 无重力：拖到哪就停哪，松手不落地
    stopThrow()
    writeStatus()
    return
  }
  const vx = Number(velocity && velocity.vx) || 0
  const vy = Number(velocity && velocity.vy) || 0
  startThrow(vx, vy)
  writeStatus()
})

ipcMain.handle('ycp:api', async (_event, payload) => {
  try {
    return await apiFetch(payload?.path, payload?.method || 'GET', payload?.body)
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message ?? error) }
  }
})

ipcMain.handle('ycp:audio', async (_event, urlPath) => {
  try {
    return { ok: true, file: await downloadAudio(String(urlPath ?? '')) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
})

ipcMain.on('ycp:balance-sync', (event) => {
  try {
    const file = process.env.YCP_BALANCE_FILE
    const data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
    const total = data ? Number(data.total) : NaN
    event.returnValue = Number.isFinite(total) ? total : null
  } catch {
    event.returnValue = null
  }
})

ipcMain.on('ycp:mouse', (_event, mode) => {
  if (!win || win.isDestroyed() || pinned) return
  if (mode === 'pass') win.setIgnoreMouseEvents(true, { forward: true })
  else win.setIgnoreMouseEvents(false)
})

ipcMain.on('ycp:action', (_event, payload) => {
  if (!win || win.isDestroyed()) return
  const { kind, value } = payload || {}
  if (kind === 'pin') { setPinned(!pinned); updateTray(); return }
  if (kind === 'gravity') { gravity = !gravity; if (!gravity) stopThrow(); saveConfig(); sendToWin('ycp:gravity', gravity); updateTray(); return }
  if (kind === 'size') { applyScale(value); return }
  if (kind === 'open') { if (DSH_URL) shell.openExternal(DSH_URL).catch(() => {}); return }
  if (kind === 'close') { win.close(); return }
  if (kind === 'menu-open') { win.setIgnoreMouseEvents(false); return }
  if (kind === 'chat-close') { if (chatWin && !chatWin.isDestroyed()) chatWin.hide(); return }
})

ipcMain.on('ycp:chat-send', (_event, text) => {
  if (!win || win.isDestroyed()) return
  const body = String(text ?? '').trim().slice(0, 500)
  if (!body) return
  const id = String(Date.now())
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(CHAT_REQUEST, JSON.stringify({ id, text: body, at: Date.now() }, null, 2) + '\n', 'utf8')
    try { fs.rmSync(CHAT_REPLY, { force: true }) } catch { /* 旧回复 */ }
  } catch (error) {
    sendToWin('ycp:reply', { ok: false, error: `写不进请求：${String(error?.message ?? error)}` })
    return
  }
  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if (tries > 120) {
      clearInterval(timer)
      const file = leaveDesktopNote(`想跟你说「${body}」，但我这边等太久没回音，先留张纸条。`)
      sendReply({ ok: false, error: '等太久了，给你留了张纸条', note: file })
      return
    }
    try {
      if (!fs.existsSync(CHAT_REPLY)) return
      const reply = JSON.parse(fs.readFileSync(CHAT_REPLY, 'utf8').replace(/^\uFEFF/, ''))
      if (String(reply.id) !== String(id)) return
      fs.rmSync(CHAT_REPLY, { force: true })
      clearInterval(timer)
      if (!reply.ok) reply.note = leaveDesktopNote(`想跟你说「${body}」，但没说出来（${reply.error || '没回应'}），先留张纸条。`)
      sendReply(reply)
    } catch { /* 下一轮 */ }
  }, 500)
})

ipcMain.on('ycp:ledger', (_event, payload) => {
  if (!win || win.isDestroyed()) return
  const id = String(Date.now())
  const request = { kind: 'ledger', id, action: payload?.action === 'add' ? 'add' : 'summary', at: Date.now() }
  if (request.action === 'add') {
    request.amount = Number(payload.amount) || 0
    request.category = String(payload.category || '其他')
    request.note = String(payload.note || '').slice(0, 80)
    request.type = payload.type === 'income' ? 'income' : 'expense'
  }
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(CHAT_REQUEST, JSON.stringify(request, null, 2) + '\n', 'utf8')
    try { fs.rmSync(CHAT_REPLY, { force: true }) } catch { /* 旧回复 */ }
  } catch (error) {
    sendToWin('ycp:ledger-reply', { ok: false, error: String(error?.message ?? error) })
    return
  }
  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if (tries > 20) { clearInterval(timer); sendToWin('ycp:ledger-reply', { ok: false, error: '账本没响应' }); return }
    try {
      if (!fs.existsSync(CHAT_REPLY)) return
      const reply = JSON.parse(fs.readFileSync(CHAT_REPLY, 'utf8').replace(/^\uFEFF/, ''))
      if (reply.kind !== 'ledger' || String(reply.id) !== id) return
      fs.rmSync(CHAT_REPLY, { force: true })
      clearInterval(timer)
      sendToWin('ycp:ledger-reply', reply)
    } catch { /* 下一轮 */ }
  }, 500)
})

ipcMain.on('ycp:chat-resize', (_event, expanded) => {
  if (!chatWin || chatWin.isDestroyed()) return
  const height = expanded ? 300 : 78
  const bounds = chatWin.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  let y = bounds.y
  if (y + height > area.y + area.height) y = area.y + area.height - height
  chatWin.setBounds({ x: bounds.x, y: Math.max(area.y, y), width: 340, height })
})
ipcMain.on('ycp:menu-pick', (_event, payload) => {
  if (!win || win.isDestroyed()) return
  if (menuWin && !menuWin.isDestroyed()) menuWin.hide()
  const act = payload?.act
  const value = payload?.value
  if (act === 'chat') { toggleChatWindow(true); return }
  if (act === 'settings') { sendToWin('ycp:settings'); return }
  if (act === 'ledger') { sendToWin('ycp:ledger-open'); return }
  if (act === 'pin') { setPinned(!pinned); updateTray(); return }
  if (act === 'gravity') {
    gravity = !gravity
    if (!gravity) stopThrow()
    saveConfig()
    sendToWin('ycp:gravity', gravity)
    updateTray()
    return
  }
  if (act === 'size') { applyScale(value); return }
  if (act === 'anim') { sendToWin('ycp:anim', value === 'random' ? ['idle', 'play', 'work', 'eat'][Math.floor(Math.random() * 4)] : value); return }
  if (act === 'open') { if (DSH_URL) shell.openExternal(DSH_URL).catch(() => {}); return }
  if (act === 'close') { win.close() }
})
ipcMain.on('ycp:reaction', () => {
  reactions += 1
  writeStatus()
})

ipcMain.on('ycp:menu', () => {
  showMenu()
})

app.on('window-all-closed', () => {
  app.quit()
})
