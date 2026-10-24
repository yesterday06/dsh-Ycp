/**
 * dsh-brain · 路径、设置与状态文件。
 *
 * 三条硬规则：
 *   1. 不写死本机路径 —— 全局记忆目录可由配置 / 环境变量改，默认沿用 sage-mem 的目录。
 *   2. 改名 / 覆盖前先备份，备份落在 <DSH_HOME>/brain/backups/。
 *   3. 设置与运行状态都是普通 JSON，面板改完立即生效，不依赖重启。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const VERSION = '0.2.0'

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function stateRoot() {
  const dir = process.env.DSH_BRAIN_STATE_DIR || join(dshHome(), 'brain')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function settingsPath() {
  return join(stateRoot(), 'settings.json')
}

export function statePath() {
  return join(stateRoot(), 'state.json')
}

/**
 * 全局记忆目录的解析顺序：
 *   显式配置 → DSH_BRAIN_GLOBAL_DIR → SAGE_MEM_DIR → ~/.sage-mem/memory
 *   → <DSH_HOME>/brain/memory（新建）。
 * 后两条保证「没配也不会崩」，同时兼容 sage-mem 的旧目录。
 */
export function resolveGlobalDir(configured) {
  const explicit = typeof configured === 'string' ? configured.trim() : ''
  if (explicit) return { dir: resolve(explicit), source: 'config' }
  const env = (process.env.DSH_BRAIN_GLOBAL_DIR || process.env.SAGE_MEM_DIR || '').trim()
  if (env) return { dir: resolve(env), source: 'env' }
  const sage = join(homedir(), '.sage-mem', 'memory')
  if (existsSync(sage)) return { dir: sage, source: 'sage-mem' }
  const fallback = join(dshHome(), 'brain', 'memory')
  mkdirSync(fallback, { recursive: true })
  return { dir: fallback, source: 'fallback' }
}

export function workspacePaths(cwd) {
  const root = typeof cwd === 'string' && cwd.trim() ? resolve(cwd) : process.cwd()
  return {
    root,
    memory: join(root, '工作记忆'),
    projectDir: join(root, '工作记忆', '项目记忆'),
    realtimeDir: join(root, '工作记忆', '实时记忆'),
    logDir: join(root, '工作记忆', '实时记忆', '日志'),
  }
}

/** 会话摘要目录（DESIGN-1.1 第十一节）：<工作区>/工作记忆/实时记忆/日志/会话摘要/ */
export function sessionSummaryDir(cwd) {
  return join(workspacePaths(cwd).logDir, '会话摘要')
}

/** 文件名时间戳：YYYYMMDD-HHmm，本地时区。 */
export function stampMinutes(value) {
  const d = value instanceof Date ? value : new Date(value ?? Date.now())
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 把任务名压成安全的文件名片段：去非法字符、空白折成 -、截 24 字。 */
export function safeFileName(input, fallback = '任务') {
  const raw = String(input ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 24)
    .replace(/[-.]+$/g, '')
  return raw || fallback
}

/**
 * 会话摘要路径（DESIGN-1.1 第十一节）：
 *   <cwd>/工作记忆/实时记忆/日志/会话摘要/<YYYYMMDD-HHmm>-<任务名>.md
 * options.task 给任务名，options.at 给时间（默认现在），options.index 处理同名序号。
 */
export function sessionSummaryPath(cwd, options = {}) {
  const at = options.at instanceof Date ? options.at : options.at ? new Date(Number(options.at) || options.at) : new Date()
  const task = safeFileName(options.task)
  const index = Number(options.index) > 0 ? `-${Math.round(Number(options.index))}` : ''
  return join(sessionSummaryDir(cwd), `${stampMinutes(at)}-${task}${index}.md`)
}

/** 状态里找「这个会话是由封存创建的」（DESIGN-1.1 第五节的 sealedFrom）。 */
export function sealRecordFor(state, sessionId) {
  if (!state || !sessionId) return null
  const handoffs = Array.isArray(state.handoffs) ? state.handoffs : []
  const id = String(sessionId)
  return handoffs.find((h) => h && h.kind === 'seal' && String(h.to) === id) || null
}

export const DEFAULT_SETTINGS = Object.freeze({
  autopilot: true,
  threshold: 80,
  topK: 2,
  maxChars: 600,
  baselineChars: 1300,
  summaryChars: 120,
  maxRoundChars: 2400,
  // 封存后的新会话首步预算（任务卡 + 画像 + 概况），DESIGN-1.1 第五节。
  firstStepChars: 1500,
})

const SETTING_SPECS = {
  threshold: { lo: 1, hi: 100 },
  topK: { lo: 1, hi: 5 },
  maxChars: { lo: 100, hi: 3000 },
  baselineChars: { lo: 200, hi: 4000 },
  summaryChars: { lo: 40, hi: 600 },
  maxRoundChars: { lo: 400, hi: 8000 },
  firstStepChars: { lo: 600, hi: 6000 },
}

function clampInt(value, spec, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(spec.lo, Math.min(spec.hi, Math.round(value)))
}

function readJson(file) {
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function loadSettings() {
  const raw = readJson(settingsPath())
  const out = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  if (typeof raw.autopilot === 'boolean') out.autopilot = raw.autopilot
  for (const [key, spec] of Object.entries(SETTING_SPECS)) {
    out[key] = clampInt(raw[key], spec, DEFAULT_SETTINGS[key])
  }
  return out
}

/**
 * 面板保存设置。全部字段先校验，任何一项非法就整体拒绝，绝不写半份。
 * @returns {{ok: boolean, settings?: object, error?: string}}
 */
export function saveSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: '设置必须是对象' }
  }
  const current = loadSettings()
  const next = { ...current }
  if ('autopilot' in patch) {
    if (typeof patch.autopilot !== 'boolean') return { ok: false, error: 'autopilot 必须是 true / false' }
    next.autopilot = patch.autopilot
  }
  for (const [key, spec] of Object.entries(SETTING_SPECS)) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `${key} 必须是数字` }
    }
    const rounded = Math.round(value)
    if (rounded < spec.lo || rounded > spec.hi) {
      return { ok: false, error: `${key} 必须在 ${spec.lo}–${spec.hi} 之间` }
    }
    next[key] = rounded
  }
  writeAtomic(settingsPath(), JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  return { ok: true, settings: next }
}

export function loadState() {
  const raw = readJson(statePath())
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  return { lastHandoff: null, lastInjection: null, pendingHandoff: null, handoffs: [] }
}

export function saveState(state) {
  writeAtomic(statePath(), JSON.stringify(state, null, 2) + '\n')
}

/** 原子写：先写同目录临时文件，再 rename 覆盖。 */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    // Windows 上目标被占用时 rename 可能失败；退化成直接覆盖，内容仍然完整。
    writeFileSync(file, text, 'utf8')
    try { renameSync(tmp, `${tmp}.done`) } catch { /* 临时文件留给系统清理 */ }
  }
}

export function backupFile(file) {
  if (!existsSync(file)) return null
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  const dir = join(stateRoot(), 'backups')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `${stamp}-${basename(file)}`)
  copyFileSync(file, target)
  return target
}

export function fileInfo(file) {
  try {
    const st = statSync(file)
    return { exists: true, mtimeMs: st.mtimeMs, bytes: st.size }
  } catch {
    return { exists: false, mtimeMs: 0, bytes: 0 }
  }
}

export function appendLog(message, extra) {
  try {
    const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`
    appendFileSync(join(stateRoot(), 'brain.log'), line, 'utf8')
  } catch {
    /* 日志写不进去不能反过来影响主流程。 */
  }
}

/** 只在 DSH_BRAIN_DEBUG=1 时写的高频调试日志。 */
export function debugLog(message, extra) {
  if (process.env.DSH_BRAIN_DEBUG !== '1') return
  appendLog(message, extra)
}

export function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
