/**
 * dsh-Ycp · 大肥鱼（能力层）—— 桌面之手（P12）。
 *
 * 这条腿最危险，默认关：settings.hands.desktop = false。
 * 实现走 Windows 自带的 PowerShell + .NET（user32），不装任何依赖：
 *   截图（整屏）、鼠标移动/点击/拖动、键盘输入（剪贴板粘贴，支持中文）、按键、启动程序。
 *
 * 程序白名单 settings.hands.desktopApps：只认名单里的 .exe（名字或完整路径），空名单谁都不许启动。
 * 打字给了 pid 时，会先切到那个窗口并核对标题，切错了就不打——避免把字打进主人正在写的文档里。
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLog, homePaths } from '../kernel/paths.js'

const MAX_HISTORY = 20
const RUN_TIMEOUT_MS = 30_000

const SCRIPT_SOURCE = fileURLToPath(new URL('./desktop.ps1', import.meta.url))

/** 桌面手能不能用：Windows + 有 PowerShell。 */
export function detectDesktop(env = process.platform) {
  if (env !== 'win32') return { ok: false, error: '桌面手目前只支持 Windows' }
  return { ok: true, name: 'Windows 桌面', powershell: 'powershell.exe' }
}

/** 白名单匹配：名字或完整路径，大小写不敏感；空名单 = 全拒。 */
export function appAllowed(app, apps) {
  const target = String(app ?? '').trim().toLowerCase()
  if (!target) return false
  const list = Array.isArray(apps) ? apps.filter((item) => typeof item === 'string' && item.trim()) : []
  if (list.length === 0) return false
  if (list.includes('*')) return true
  const targetName = basename(target.replace(/\//g, '\\'))
  return list.some((entry) => {
    const rule = entry.trim().toLowerCase()
    if (!rule) return false
    if (rule === target || rule === targetName) return true
    return basename(rule.replace(/\//g, '\\')) === targetName
  })
}

function scriptPath() {
  const dir = join(homePaths().root, '状态', '桌面')
  return { dir, file: join(dir, 'desktop.ps1'), history: join(dir, '最近动作.json') }
}

export function createDesktopHand(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({})
  const log = typeof options.log === 'function' ? options.log : () => {}
  const env = options.env ?? process.platform
  const history = []

  function ensureScript() {
    const { dir, file } = scriptPath()
    mkdirSync(dir, { recursive: true })
    // 插件更新后脚本要跟着换：源文件比副本新就覆盖，别一直跑旧脚本。
    const sourceTime = statSync(SCRIPT_SOURCE).mtimeMs
    const copyTime = existsSync(file) ? statSync(file).mtimeMs : 0
    if (sourceTime > copyTime) copyFileSync(SCRIPT_SOURCE, file)
    return file
  }

  function remember(action, detail, ok = true) {
    const entry = { at: Date.now(), action, detail, ok }
    history.push(entry)
    while (history.length > MAX_HISTORY) history.shift()
    try {
      const { dir, history: file } = scriptPath()
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(history, null, 2) + '\n', 'utf8')
    } catch {
      /* 记不下来不影响动作 */
    }
    log('桌面动作', { action, detail, ok })
  }

  function run(action, params = {}) {
    return new Promise((resolve, reject) => {
      const script = ensureScript()
      const payload = Buffer.from(JSON.stringify({ action, ...params }), 'utf8').toString('base64')
      const started = Date.now()
      execFile(
        'powershell.exe',
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', payload],
        { timeout: RUN_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const ms = Date.now() - started
          const text = String(stdout ?? '').trim()
          const line = text.split(/\r?\n/).filter(Boolean).pop() ?? ''
          let parsed = null
          try {
            parsed = JSON.parse(line)
          } catch {
            parsed = null
          }
          if (parsed && parsed.ok === false) {
            reject(new Error(parsed.error || '桌面动作失败'))
            return
          }
          if (error) {
            reject(new Error(String(stderr || error.message || 'PowerShell 执行失败').trim().slice(0, 500)))
            return
          }
          if (!parsed) {
            reject(new Error(`桌面动作没有返回结果：${text.slice(0, 200)}`))
            return
          }
          parsed.ms = ms
          resolve(parsed)
        },
      )
    })
  }

  function status() {
    const detected = detectDesktop(env)
    const hands = getSettings()?.hands ?? {}
    return {
      available: detected.ok,
      error: detected.ok ? null : detected.error,
      enabled: Boolean(hands.desktop),
      apps: Array.isArray(hands.desktopApps) ? hands.desktopApps : [],
      recent: history.slice(-10).reverse(),
    }
  }

  async function info() {
    const result = await run('info')
    remember('info', `${result.screen?.width}x${result.screen?.height} · ${String(result.foreground ?? '').slice(0, 40)}`)
    return result
  }

  async function uia(window) {
    const result = await run('uia', window ? { window: String(window) } : {})
    remember('uia', String(result.elements?.length || 0) + ' 个元素')
    return result
  }

  async function windowControl(input = {}) {
    const result = await run('window', {
      window: String(input.window ?? '').trim(),
      ...(input.maximize ? { maximize: true } : {}),
      ...(input.restore ? { restore: true } : {}),
      ...(Number.isFinite(Number(input.x)) ? { x: Number(input.x) } : {}),
      ...(Number.isFinite(Number(input.y)) ? { y: Number(input.y) } : {}),
      ...(Number.isFinite(Number(input.width)) ? { width: Number(input.width) } : {}),
      ...(Number.isFinite(Number(input.height)) ? { height: Number(input.height) } : {}),
    })
    remember('window', String(input.window ?? ''))
    return result
  }
  async function uiaSet(name, value, window) {
    const key = String(name ?? '').trim()
    if (!key) throw new Error('要写哪个输入框？')
    const result = await run('uiaSet', { name: key, value: String(value ?? ''), ...(window ? { window: String(window) } : {}) })
    remember('uiaSet', key)
    return result
  }
  async function uiaClick(name, window) {
    const value = String(name ?? '').trim()
    if (!value) throw new Error('要点击哪个元素？')
    const result = await run('uiaClick', { name: value, ...(window ? { window: String(window) } : {}) })
    remember('uiaClick', value)
    return result
  }

  async function screenshot() {
    const dir = join(homePaths().root, '状态', '截图')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
    const file = join(dir, `desktop-${stamp}.png`)
    const result = await run('screenshot', { path: file })
    remember('screenshot', `${basename(file)} ${result.bytes}B`, true)
    return { file, bytes: result.bytes, width: result.width, height: result.height }
  }

  async function move(x, y) {
    const result = await run('move', { x: Number(x), y: Number(y) })
    remember('move', `${result.x},${result.y}`)
    return result
  }

  async function click(x, y) {
    const result = await run('click', { x: Number(x), y: Number(y) })
    remember('click', `${result.x},${result.y}`)
    return result
  }

  async function drag(fromX, fromY, toX, toY) {
    const result = await run('drag', {
      fromX: Number(fromX), fromY: Number(fromY), toX: Number(toX), toY: Number(toY),
    })
    remember('drag', `${result.from.x},${result.from.y} → ${result.to.x},${result.to.y}`)
    return result
  }

  async function type(text, options2 = {}) {
    const value = String(text ?? '')
    if (!value) throw new Error('要打什么字？')
    const params = { text: value }
    if (options2.pid) params.pid = Number(options2.pid)
    if (options2.expectTitle) params.expectTitle = String(options2.expectTitle)
    const result = await run('type', params)
    remember('type', `${value.slice(0, 40)} → ${String(result.foreground ?? '').slice(0, 40)}`)
    return { chars: result.chars, foreground: result.foreground }
  }

  async function key(keys, options2 = {}) {
    const value = String(keys ?? '').trim()
    if (!value) throw new Error('要按什么键？')
    const params = { keys: value }
    if (options2.pid) params.pid = Number(options2.pid)
    if (options2.expectTitle) params.expectTitle = String(options2.expectTitle)
    const result = await run('key', params)
    remember('key', `${value} → ${String(result.foreground ?? '').slice(0, 40)}`)
    return result
  }

  async function focus(pidOrTitle) {
    const value = String(pidOrTitle ?? '').trim()
    if (!value) throw new Error('要切到哪个窗口？')
    const params = /^\d+$/.test(value) ? { pid: Number(value) } : { title: value }
    const result = await run('focus', params)
    remember('focus', value)
    return result
  }

  async function clipboard() {
    const result = await run('clipboard')
    return { text: String(result.text ?? '') }
  }

  async function launch(app) {
    const wanted = String(app ?? '').trim()
    if (!wanted) throw new Error('要启动什么程序？')
    const apps = getSettings()?.hands?.desktopApps ?? []
    if (!appAllowed(wanted, apps)) {
      remember('launch', `${wanted}（不在白名单）`, false)
      throw new Error(`「${wanted}」不在程序白名单里（settings.hands.desktopApps）`)
    }
    const result = await run('launch', { path: wanted })
    remember('launch', `${wanted} → pid ${result.pid}`, true)
    return result
  }

  return { status, info, windowControl, uia, uiaClick, uiaSet, screenshot, move, click, drag, type, key, focus, clipboard, launch }
}

/** 把桌面动作挂进注册表（每条都要 desktop 这条手开着）。 */
export function installDesktopTools(registry, hand) {
  const tools = [
    {
      id: 'desktop.info',
      description: '看屏幕尺寸与当前打开的窗口（标题 / 进程 / pid）',
      hand: 'desktop',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => hand.info(),
    },
    {
      id: 'desktop.ui',
      description: '读一个窗口里能点的按钮/菜单/输入框（名字 + 坐标）；给 window 就后台读那个窗口，不抢前台',
      hand: 'desktop',
      schema: { type: 'object', properties: { window: { type: 'string', description: '窗口标题的一部分，省略=当前前台' } }, required: [] },
      run: async ({ window }) => hand.uia(window),
    },
    {
      id: 'desktop.clickText',
      description: '按名字点击窗口里的按钮/菜单/输入框；给 window 就后台点，不抢前台、不吵主人',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '元素名字的一部分，比如“发送”“登录”' },
          window: { type: 'string', description: '窗口标题的一部分，省略=当前前台' },
        },
        required: ['name'],
      },
      run: async ({ name, window }) => hand.uiaClick(name, window),
    },
    {
      id: 'desktop.setValue',
      description: '往窗口里的输入框直接写内容（后台，不抢前台）；先 desktop.ui 找输入框名字',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '输入框名字的一部分' },
          value: { type: 'string' },
          window: { type: 'string', description: '窗口标题的一部分，省略=当前前台' },
        },
        required: ['name', 'value'],
      },
      run: async ({ name, value, window }) => hand.uiaSet(name, value, window),
    },
    {
      id: 'desktop.window',
      description: '把一个窗口移动/缩放到屏幕内，或最大化/还原；操作前先把窗口摆好，输入框才不会跑到屏幕外',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: {
          window: { type: 'string', description: '窗口标题的一部分' },
          x: { type: 'integer' }, y: { type: 'integer' },
          width: { type: 'integer' }, height: { type: 'integer' },
          maximize: { type: 'boolean' }, restore: { type: 'boolean' },
        },
        required: ['window'],
      },
      run: async (args) => hand.windowControl(args),
    },
    {
      id: 'desktop.screenshot',
      description: '截一张整屏图，存到 状态\\截图\\',
      hand: 'desktop',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => hand.screenshot(),
    },
    {
      id: 'desktop.click',
      description: '在屏幕坐标 (x, y) 点一下鼠标左键',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: { x: { type: 'integer' }, y: { type: 'integer' } },
        required: ['x', 'y'],
      },
      run: async ({ x, y }) => hand.click(x, y),
    },
    {
      id: 'desktop.drag',
      description: '按住左键从 (fromX, fromY) 拖到 (toX, toY)',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: {
          fromX: { type: 'integer' }, fromY: { type: 'integer' },
          toX: { type: 'integer' }, toY: { type: 'integer' },
        },
        required: ['fromX', 'fromY', 'toX', 'toY'],
      },
      run: async ({ fromX, fromY, toX, toY }) => hand.drag(fromX, fromY, toX, toY),
    },
    {
      id: 'desktop.type',
      description: '往当前窗口（或指定 pid 的窗口）打字，支持中文',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          pid: { type: 'integer', description: '可选：切到这个进程的窗口再打' },
          expectTitle: { type: 'string', description: '可选：窗口标题必须包含这个词，否则不打' },
        },
        required: ['text'],
      },
      run: async ({ text, pid, expectTitle }) => hand.type(text, { pid, expectTitle }),
    },
    {
      id: 'desktop.key',
      description: '发送按键，如 {ENTER}、^s（Ctrl+S）、^a^c；给了 pid 会先切窗口再按',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: {
          keys: { type: 'string' },
          pid: { type: 'integer', description: '可选：先切到这个进程的窗口' },
          expectTitle: { type: 'string', description: '可选：窗口标题必须包含这个词' },
        },
        required: ['keys'],
      },
      run: async ({ keys, pid, expectTitle }) => hand.key(keys, { pid, expectTitle }),
    },
    {
      id: 'desktop.focus',
      description: '把某个进程的窗口切到前台（pid 或标题片段）',
      hand: 'desktop',
      schema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
      run: async ({ target }) => hand.focus(target),
    },
    {
      id: 'desktop.launch',
      description: '启动一个程序（必须在 desktopApps 白名单里）',
      hand: 'desktop',
      schema: { type: 'object', properties: { app: { type: 'string', description: '如 notepad.exe' } }, required: ['app'] },
      run: async ({ app }) => hand.launch(app),
    },
  ]

  for (const tool of tools) {
    const result = registry.registerTool(tool)
    if (!result.ok) throw new Error(`注册 ${tool.id} 失败：${result.error}`)
  }
}
