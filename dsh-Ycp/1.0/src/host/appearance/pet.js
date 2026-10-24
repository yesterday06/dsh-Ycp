/**
 * dsh-Ycp · 大肥鱼（外观层）—— 桌面窗口（P15）。
 *
 * 插件宿主没有 Electron 主进程权限，所以桌宠是**独立的 Electron 进程**：
 *  - 优先用环境变量 YCP_ELECTRON 指定的 electron.exe；
 *  - 否则用 dsh-pet 已经装好的 ~/.dsh/electron/electron.exe（不重复下载）；
 *  - 都没有就明确说"装个 Electron 才能放她出来"，不自己偷偷下 200MB。
 *
 * 窗口本身在 assets/pet/：透明、无边框、置顶、可拖拽抛掷、右键菜单。
 * 进程把窗口状态写到 状态\宠物\窗口.json，宿主和面板读它。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appendLog, homePaths } from '../kernel/paths.js'

const PET_APP_DIR = fileURLToPath(new URL('../../../assets/pet/', import.meta.url))
const READY_TIMEOUT_MS = 20_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 找可用的 Electron：环境变量 → dsh-pet 的运行时。 */
export function detectElectron(env = process.env) {
  const custom = String(env.YCP_ELECTRON ?? '').trim()
  if (custom && existsSync(custom)) return { ok: true, path: custom, source: 'env' }
  const petOwned = join(homedir(), '.dsh', 'electron', 'electron.exe')
  if (existsSync(petOwned)) return { ok: true, path: petOwned, source: 'dsh-pet' }
  return {
    ok: false,
    error: '没找到 Electron（可设 YCP_ELECTRON，或让 dsh-pet 先下载一份到 ~/.dsh/electron）',
  }
}

export function createPet({ getSettings = () => ({}), url = process.env.DSH_WEB_URL || '', clickSound = null, soundVolume = 40 } = {}) {
  let child = null

  function paths() {
    const dir = join(homePaths().root, '状态', '宠物')
    return { dir, status: join(dir, '窗口.json'), config: join(dir, '窗口配置.json') }
  }

  function readStatus() {
    const { status } = paths()
    if (!existsSync(status)) return null
    try {
      return JSON.parse(readFileSync(status, 'utf8'))
    } catch {
      return null
    }
  }

  function alive() {
    return Boolean(child && child.exitCode === null && !child.killed)
  }

  function status() {
    const electron = detectElectron()
    const file = readStatus()
    return {
      available: electron.ok,
      electron: electron.ok ? electron.path : null,
      source: electron.ok ? electron.source : null,
      error: electron.ok ? null : electron.error,
      running: alive(),
      pid: alive() ? child.pid : null,
      appDir: PET_APP_DIR,
      window: file,
    }
  }

  async function start() {
    if (alive()) return { ok: true, already: true, ...status() }
    const electron = detectElectron()
    if (!electron.ok) return { ok: false, error: electron.error }
    if (!existsSync(PET_APP_DIR)) return { ok: false, error: `桌宠程序目录不见了：${PET_APP_DIR}` }

    const { status: statusFile } = paths()
    try {
      rmSync(statusFile, { force: true })
    } catch {
      /* 删不掉就等新状态覆盖 */
    }

    // 音效配置走环境变量：把 file:// 地址当命令行参数会让 Electron 直接退出。
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    env.YCP_CLICK_URL = clickSound && existsSync(clickSound) ? pathToFileURL(clickSound).href : ''
    env.YCP_SOUND_VOLUME = String(Math.max(0, Math.min(100, Number(soundVolume) || 0)))
    env.YCP_BALANCE_FILE = join(homePaths().root, '状态', '余额.json')
    env.YCP_NAME = String(getSettings().name || '大肥鱼')
    const args = [PET_APP_DIR, '--ycp-state', statusFile, '--ycp-config', paths().config, '--ycp-url', url]
    child = spawn(electron.path, args, {
      cwd: PET_APP_DIR,
      env,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.on('exit', () => {
      appendLog('桌宠窗口退出', {})
      child = null
    })
    appendLog('桌宠窗口启动', { electron: electron.path, pid: child.pid })

    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const file = readStatus()
      if (file?.ready) return { ok: true, ...status() }
      if (!alive()) return { ok: false, error: '桌宠进程启动后马上退出了' }
      await sleep(250)
    }
    return { ok: false, error: '等不到桌宠窗口就绪（可能被安全软件拦了）', ...status() }
  }

  async function stop() {
    const pid = alive() ? child.pid : readStatus()?.pid
    if (!pid) return { ok: true, closed: false }
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(pid, 'SIGTERM')
      }
    } catch {
      /* 已经退了 */
    }
    child = null
    appendLog('桌宠窗口关闭', { pid })
    return { ok: true, closed: true }
  }

  return { status, start, stop, paths }
}
