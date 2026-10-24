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
const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const STATE_FILE = argOf('--ycp-state', path.join(__dirname, 'window-state.json'))
const DSH_URL = argOf('--ycp-url', '')
const SIZE = 200

app.disableHardwareAcceleration()

let win = null
let dragOffset = null
let throwTimer = null
let statusTimer = null
let state = 'idle'
let reactions = 0
let readyAt = 0

function workArea() {
  return screen.getPrimaryDisplay().workArea
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value))
}

function currentStatus() {
  const bounds = win && !win.isDestroyed() ? win.getBounds() : null
  return {
    pid: process.pid,
    ready: Boolean(win && !win.isDestroyed()),
    readyAt,
    state,
    reactions,
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
    if (x + SIZE > area.x + area.width) { x = area.x + area.width - SIZE; speedX = -Math.abs(speedX) * 0.55 }
    if (y < area.y) { y = area.y; speedY = Math.abs(speedY) * 0.55 }

    if (y + SIZE > area.y + area.height) {
      y = area.y + area.height - SIZE
      speedY = -speedY * 0.5
      speedX *= 0.82
      onGround = true
    } else {
      onGround = false
    }

    win.setPosition(Math.round(x), Math.round(y))
    scheduleStatus()

    const slow = Math.abs(speedX) < 0.35 && Math.abs(speedY) < 0.35
    if (slow && onGround) {
      stopThrow()
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
  const open = (url) => {
    if (!url) return
    shell.openExternal(url).catch(() => {})
  }
  const template = [
    { label: '聊天', click: () => open(DSH_URL) },
    {
      label: '动画',
      submenu: [
        { label: '待机', click: () => setState('idle') },
        { label: '游两圈', click: () => setState('swim') },
        { label: '打个盹', click: () => setState('nap') },
      ],
    },
    { label: '设置', click: () => open(DSH_URL) },
    { type: 'separator' },
    {
      label: '收起',
      click: () => {
        if (win && !win.isDestroyed()) win.close()
      },
    },
  ]
  Menu.buildFromTemplate(template).popup({ window: win })
}

app.whenReady().then(() => {
  const area = workArea()
  win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: area.x + area.width - SIZE - 40,
    y: area.y + area.height - SIZE - 40,
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
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.once('ready-to-show', () => {
    win.showInactive()
    readyAt = Date.now()
    writeStatus()
    console.log('YCP_PET_READY')
  })
  win.on('closed', () => {
    stopThrow()
    win = null
    app.quit()
  })
  win.on('move', scheduleStatus)
})

ipcMain.on('ycp:drag-start', (_event, point) => {
  if (!win || win.isDestroyed()) return
  stopThrow()
  const [wx, wy] = win.getPosition()
  dragOffset = { dx: wx - Number(point.x), dy: wy - Number(point.y) }
})

ipcMain.on('ycp:drag-move', (_event, point) => {
  if (!win || win.isDestroyed() || !dragOffset) return
  const area = workArea()
  const x = clamp(Math.round(Number(point.x) + dragOffset.dx), area.x, area.x + area.width - SIZE)
  const y = clamp(Math.round(Number(point.y) + dragOffset.dy), area.y, area.y + area.height - SIZE)
  win.setPosition(x, y)
  scheduleStatus()
})

ipcMain.on('ycp:drag-end', (_event, velocity) => {
  dragOffset = null
  const vx = Number(velocity && velocity.vx) || 0
  const vy = Number(velocity && velocity.vy) || 0
  startThrow(vx, vy)
  writeStatus()
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
