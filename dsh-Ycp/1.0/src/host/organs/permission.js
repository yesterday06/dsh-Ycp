/**
 * dsh-Ycp · 权限（器官）
 *
 * 三档，只有主人能在面板里改；她自己的任何工具都改不了（没有暴露写入入口）。
 *
 *   禁足 jail   ：只能在自己家读写记忆/日记，不能删；不能调用任何「动手」工具。
 *   普通 normal ：能读整台电脑（管理员区域除外）；自己家随便删改；
 *                 D:\OpenAI 下可新建/写入，但「DeepSeek Harness」「工作区1」只读；
 *                 可以用软件和网页（能力另算）。
 *   完整 full   ：全部放开。开的时候面板要二次确认。
 *
 * 权限文件：<家>/状态/权限.json；默认禁足。
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { appendLog, homePaths, writeAtomic } from '../kernel/paths.js'

export const LEVELS = [
  {
    key: 'jail',
    name: '禁足',
    summary: '只能在自己家读写记忆和日记，不能删；不能上网、不能碰电脑。',
  },
  {
    key: 'normal',
    name: '普通',
    summary: '能看整台电脑（管理员区域除外）；自己家随便删改；OpenAI 目录可建项目；能用软件和网页。',
  },
  {
    key: 'full',
    name: '完整',
    summary: '全部放开，包括系统目录。只有你明确知道后果时才开。',
  },
]

const LEVEL_KEYS = new Set(LEVELS.map((item) => item.key))

/** 权限跟她的家走，不放进 settings（防止被普通设置接口顺手改掉）。 */
export function permissionFile() {
  return join(homePaths().root, '状态', '权限.json')
}

export function loadPermission() {
  try {
    const data = JSON.parse(readFileSync(permissionFile(), 'utf8'))
    const level = String(data?.level || 'jail')
    return {
      level: LEVEL_KEYS.has(level) ? level : 'jail',
      updatedAt: String(data?.updatedAt || ''),
    }
  } catch {
    return { level: 'jail', updatedAt: '' }
  }
}

/**
 * 只有面板的「用户操作」能调这个函数；她自己的工具不要接。
 * @param {'jail'|'normal'|'full'} level
 * @param {{by?: string}} [options]
 */
export function savePermission(level, options = {}) {
  const key = String(level || '').trim()
  if (!LEVEL_KEYS.has(key)) return { ok: false, error: '只认 jail / normal / full' }
  const by = String(options.by || 'user')
  const next = { level: key, updatedAt: new Date().toISOString(), by }
  try {
    mkdirSync(dirname(permissionFile()), { recursive: true })
    writeAtomic(permissionFile(), JSON.stringify(next))
    appendLog('权限变更', { level: key, by })
    return { ok: true, ...next }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

// ---------------------------------------------------------------- 路径

function normalize(target) {
  const text = String(target ?? '').trim()
  if (!text) return ''
  try {
    return resolve(text)
  } catch {
    return ''
  }
}

function inside(child, parent) {
  if (!child || !parent) return false
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 她家、OpenAI 根、只读区、系统区。 */
export function zones() {
  const home = normalize(homePaths().root)
  const openai = normalize(dirname(homePaths().dataRoot))
  return {
    home,
    openai,
    readOnly: [join(openai, 'DeepSeek Harness'), join(openai, '工作区1')].map(normalize),
    system: [
      process.env.SystemRoot || 'C:\\Windows',
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env.ProgramData || 'C:\\ProgramData',
    ].map(normalize),
  }
}

export function classifyPath(target) {
  const path = normalize(target)
  const z = zones()
  if (!path) return 'none'
  if (inside(path, z.home)) return 'home'
  if (z.readOnly.some((dir) => inside(path, dir))) return 'protected'
  if (z.system.some((dir) => inside(path, dir))) return 'system'
  if (inside(path, z.openai)) return 'openai'
  return 'other'
}

/**
 * 路径能不能动。
 * @param {string} target 绝对路径
 * @param {'read'|'write'|'delete'} mode
 * @returns {{ok: boolean, zone: string, reason?: string, error?: string}}
 */
export function checkPath(target, mode = 'read') {
  const path = normalize(target)
  if (!path) return { ok: false, zone: 'none', reason: 'bad-path', error: '路径不合法' }
  const zone = classifyPath(path)
  const level = loadPermission().level
  const deny = (reason, error) => ({ ok: false, zone, reason, error })

  if (level === 'full') return { ok: true, zone }

  if (zone === 'system') return deny('system', '系统目录要「完整」权限才能碰')

  if (level === 'jail') {
    if (mode === 'delete') return deny('jail-delete', '禁足权限不能删任何东西')
    if (zone !== 'home') return deny('jail-zone', '禁足权限只能在自己家里读写')
    return { ok: true, zone }
  }

  // normal
  if (mode === 'read') return { ok: true, zone }
  if (zone === 'home') return { ok: true, zone }
  if (zone === 'protected') return deny('protected', '「DeepSeek Harness」和「工作区1」只能看，不能改')
  if (zone === 'openai') return mode === 'delete' ? deny('normal-delete', '普通权限只能删自己家的东西') : { ok: true, zone }
  if (zone === 'other') return mode === 'delete' ? deny('normal-delete', '普通权限只能删自己家的东西') : { ok: true, zone }
  return deny('unknown', '这个位置说不好，先别动')
}

// ---------------------------------------------------------------- 工具

const MEMORY_TOOLS = /^(memory\.|diary\.|persona\.|name\.|signature\.|schedule\.|proactive\.)/

/**
 * 工具能不能调。
 * 禁足：只放记忆和自我工具；普通/完整：按工具自己的能力走（能力层再做细）。
 * @param {{id: string, capability?: boolean}} tool
 */
export function checkTool(tool) {
  const level = loadPermission().level
  if (level === 'full') return { ok: true, level }
  if (level === 'normal') return { ok: true, level }
  if (!tool || !tool.id) return { ok: false, level, error: '没有这个工具' }
  if (tool.capability || !MEMORY_TOOLS.test(tool.id)) {
    return { ok: false, level, error: '现在是禁足权限，只能记东西、不能动手；要动手请在面板里升权限' }
  }
  return { ok: true, level }
}

/** 面板展示用。 */
export function permissionState() {
  const current = loadPermission()
  return {
    ...current,
    levelInfo: LEVELS.find((item) => item.key === current.level) || LEVELS[0],
    levels: LEVELS,
    home: zones().home,
  }
}
