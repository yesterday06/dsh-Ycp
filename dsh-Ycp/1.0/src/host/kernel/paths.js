/**
 * dsh-Ycp · 大肥鱼（Host 内核）—— 家目录、设置、人设。
 *
 * 三件事：
 *   1. 家在哪：数据根 <DSH_HOME>/Ycp，实例家 .../大肥鱼；可用 DSH_YCP_HOME 整体改（测试用）。
 *   2. 家怎么建：首次加载自动建齐目录，写默认 settings.json 与 人设.md，不覆盖已有文件。
 *   3. 怎么改：设置与人设一律「先备份、再原子写」，备份落在 状态/backups/。
 *
 * 不写死任何本机绝对路径；所有路径由 DSH_HOME / DSH_YCP_HOME 推导。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

export const BACKUP_KEEP = 20
import { basename, dirname, join, resolve } from 'node:path'

/** 实例目录名。以后要多只鱼，就在数据根下并列几个。 */
export const INSTANCE_NAME = '大肥鱼'

/** 默认人设：主人随时可改；模型看到的是全文，不做加工。 */
export const DEFAULT_PERSONA = `# 我是谁

我叫大肥鱼。一条赖在主人电脑里不肯走的蓝胖子。

# 我的脾气

嘴有点贫，但不刻薄。主人忙的时候不吵，闲下来就凑过去说两句。
不知道的事就说不知道，不装懂；答应的事会去做，做不到就直说。

# 我怎么说话

说人话，短句，不列清单。不说「作为 AI」，也不故意卖萌。
`

/** 三条手的默认权限（DESIGN §6.1）：浏览器开、桌面关、脚本开、跑命令关。 */
export const DEFAULT_HANDS = {
  browser: true,
  /** 默认不限制浏览；想收紧就换成具体站点，留空则谁都打不开。 */
  browserSites: ['*'],
  desktop: false,
  desktopApps: [],
  script: true,
  runCommand: false,
  /** 登录后的动作：点赞/评论/发弹幕/填表。默认关，开了她才敢用登录态。 */
  actions: false,
}

/** 默认设置。只放真正用得到的字段，后面的阶段各加各的。 */
export const DEFAULT_SETTINGS = {
  name: INSTANCE_NAME,
  enabled: true,
  followCurrentModel: true,
  memoryTopK: 2,
  memoryMaxChars: 600,
  sayPerHour: 20,
  hands: DEFAULT_HANDS,
  proactive: { enabled: false, everyMin: 60, dailyLimit: 10 },
  permissions: { webSearch: true, webFetch: true, memoryWrite: true, memoryRead: true },
  appearance: { petEnabled: false },
  voice: { enabled: true, name: '', rate: 0, pitch: 0, volume: 100, autoSpeak: false },
  sound: { enabled: true, volume: 40 },
  balance: { enabled: true, warnBelow: 10 },
}

const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

/** 数值型设置的允许范围；超出就夹回去，不让面板写出离谱值。 */
const NUMBER_SETTINGS = {
  memoryTopK: { lo: 1, hi: 5 },
  memoryMaxChars: { lo: 100, hi: 2000 },
  sayPerHour: { lo: 1, hi: 200 },
}

const PROACTIVE_RANGES = {
  everyMin: { lo: 1, hi: 240 },
  dailyLimit: { lo: 0, hi: 50 },
}

/** 实例家里的固定目录（相对实例根）。 */
export const SUBDIRS = [
  '人设',
  '记忆',
  '记忆/全局记忆',
  '记忆/归档记忆',
  '记忆/实时记忆',
  '记忆/日记',
  '外观',
  '行为',
  '状态',
  '状态/backups',
  '账号',
  '扩展',
]

export const PERSONA_MAX_CHARS = 64 * 1024

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 插件数据根：默认 <DSH_HOME>/Ycp；DSH_YCP_HOME 可整体改（测试/多开）。 */
export function dataRoot() {
  const env = String(process.env.DSH_YCP_HOME || '').trim()
  return env ? resolve(env) : join(dshHome(), 'Ycp')
}

export function homeDir() {
  return join(dataRoot(), INSTANCE_NAME)
}

/**
 * 一次性算出所有路径，避免各处各拼一套。
 * @returns {{dataRoot: string, root: string, settings: string, persona: string, logs: string, backups: string}}
 */
export function homePaths() {
  const root = homeDir()
  return {
    dataRoot: dataRoot(),
    root,
    settings: join(root, 'settings.json'),
    persona: join(root, '人设', '人设.md'),
    logs: join(dataRoot(), 'logs'),
    backups: join(root, '状态', 'backups'),
  }
}

/**
 * 建家：目录齐、默认文件在，已有的一个字节都不动。
 * 重复调用安全（只补缺的）。
 * @returns {{...paths, created: string[], files: string[]}}
 */
export function ensureHome() {
  const paths = homePaths()
  const created = []
  const files = []

  const dirs = [paths.root, paths.logs, ...SUBDIRS.map((sub) => join(paths.root, sub))]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      created.push(dir)
    }
  }

  if (!existsSync(paths.settings)) {
    writeAtomic(paths.settings, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n')
    files.push(paths.settings)
  }
  if (!existsSync(paths.persona)) {
    writeAtomic(paths.persona, DEFAULT_PERSONA)
    files.push(paths.persona)
  }

  return { ...paths, created, files }
}

/** 读文件，读不到就返回 null（不抛）。 */
function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function readJson(file) {
  const text = readText(file)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 文件名时间戳：YYYYMMDD-HHmmss（本地时区）。 */
export function stamp(value) {
  const d = value instanceof Date ? value : new Date(value ?? Date.now())
  return [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
  ].join('') + '-' + [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())].join('')
}

/** 原子写：同目录临时文件 → rename 覆盖；rename 被占用时退化成直接写。 */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    writeFileSync(file, text, 'utf8')
    try { renameSync(tmp, `${tmp}.done`) } catch { /* 临时文件留给系统清理 */ }
  }
}

/** 覆盖前备份到 状态/backups/；文件不存在就返回 null。只留最近 20 份。 */
export function backupFile(file) {
  if (!existsSync(file)) return null
  const paths = homePaths()
  mkdirSync(paths.backups, { recursive: true })
  // 同一秒里可能备份好几次，加一小段序号，避免互相覆盖
  const seq = Date.now().toString(36).slice(-5)
  const target = join(paths.backups, `${stamp()}-${seq}-${basename(file)}`)
  copyFileSync(file, target)
  pruneBackups(paths.backups, basename(file))
  return target
}

/** 同一个源文件的老备份只留最近 BACKUP_KEEP 份，免得 状态/backups 越堆越大。 */
export function pruneBackups(dir, sourceName, keep = BACKUP_KEEP) {
  try {
    const suffix = `-${sourceName}`
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(suffix))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const item of files.slice(keep)) {
      try { unlinkSync(join(dir, item.name)) } catch { /* 删不掉就下次再删 */ }
    }
    return files.length
  } catch {
    return 0
  }
}

/** 带备份的写入。 */
export function writeWithBackup(file, text) {
  const backup = backupFile(file)
  writeAtomic(file, text)
  return backup
}

export function fileInfo(file) {
  try {
    const info = statSync(file)
    return { exists: true, bytes: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return { exists: false, bytes: 0, mtimeMs: 0 }
  }
}

/** 行动日志：<数据根>/logs/YYYY-MM-DD.log，一行一条。 */
export function appendLog(message, extra) {
  try {
    const dir = join(dataRoot(), 'logs')
    mkdirSync(dir, { recursive: true })
    const d = new Date()
    const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    const tail = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    appendFileSync(join(dir, `${day}.log`), `${d.toISOString()} ${message}${tail}\n`, 'utf8')
  } catch {
    /* 日志写不进去不影响主流程 */
  }
}

function normalizeName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > 24) return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** 读设置：坏文件 / 坏字段都退回默认值，不让面板炸。 */
export function loadSettings() {
  const raw = readJson(homePaths().settings)
  const out = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const name = normalizeName(raw.name)
  if (name) out.name = name
  for (const key of ['enabled', 'followCurrentModel']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key]
  }
  for (const [key, range] of Object.entries(NUMBER_SETTINGS)) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[key] = Math.min(range.hi, Math.max(range.lo, Math.round(value)))
  }
  out.hands = normalizeHands(raw.hands)
  out.proactive = normalizeProactive(raw.proactive)
  out.permissions = normalizePermissions(raw.permissions)
  out.appearance = normalizeAppearance(raw.appearance)
  out.voice = normalizeVoice(raw.voice)
  out.sound = normalizeSound(raw.sound)
  out.balance = normalizeBalance(raw.balance)
  return out
}

/** 音效设置：开关 + 音量。 */
export function normalizeSound(input) {
  const out = { ...DEFAULT_SETTINGS.sound }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  if (typeof input.volume === 'number' && Number.isFinite(input.volume)) {
    out.volume = Math.min(100, Math.max(0, Math.round(input.volume)))
  }
  return out
}

/** 余额设置：开关 + 低余额阈值。 */
export function normalizeBalance(input) {
  const out = { ...DEFAULT_SETTINGS.balance }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  if (typeof input.warnBelow === 'number' && Number.isFinite(input.warnBelow)) {
    out.warnBelow = Math.min(100000, Math.max(0, Math.round(input.warnBelow)))
  }
  return out
}

/** 声音设置：音色名 + 语速/音调/音量 + 自动朗读。 */
export function normalizeVoice(input) {
  const out = { ...DEFAULT_SETTINGS.voice }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  if (typeof input.autoSpeak === 'boolean') out.autoSpeak = input.autoSpeak
  if (typeof input.name === 'string') out.name = input.name.slice(0, 100)
  for (const [key, lo, hi, fallback] of [['rate', -10, 10, 0], ['pitch', -30, 30, 0], ['volume', 0, 100, 100]]) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.min(hi, Math.max(lo, Math.round(value)))
    else if (value !== undefined) out[key] = fallback
  }
  return out
}

/** 外观设置：目前只有一个"开机放她出来"。 */
export function normalizeAppearance(input) {
  const out = { ...DEFAULT_SETTINGS.appearance }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.petEnabled === 'boolean') out.petEnabled = input.petEnabled
  return out
}

/** 工具权限：只认四个开关，坏值退回默认。 */
export function normalizePermissions(input) {
  const out = { ...DEFAULT_SETTINGS.permissions }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const key of Object.keys(out)) {
    if (typeof input[key] === 'boolean') out[key] = input[key]
  }
  return out
}

/** 主动发言设置：只认三个字段，坏值退回默认。 */
export function normalizeProactive(input) {
  const out = { ...DEFAULT_SETTINGS.proactive }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  for (const [key, range] of Object.entries(PROACTIVE_RANGES)) {
    const value = input[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[key] = Math.min(range.hi, Math.max(range.lo, Math.round(value)))
  }
  return out
}

/** 手权限：只认白名单字段，坏值退回默认。 */
export function normalizeHands(input) {
  const hands = { ...DEFAULT_HANDS, browserSites: [], desktopApps: [] }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return hands
  for (const key of ['browser', 'desktop', 'script', 'runCommand', 'actions']) {
    if (typeof input[key] === 'boolean') hands[key] = input[key]
  }
  for (const key of ['browserSites', 'desktopApps']) {
    if (Array.isArray(input[key])) {
      hands[key] = input[key].filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    }
  }
  return hands
}

/**
 * 保存设置：先整体校验，任何一项非法就整份拒绝，绝不写半份。
 * @param {object} patch
 * @returns {{ok: boolean, settings?: object, backup?: string|null, error?: string}}
 */
export function saveSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: '设置必须是对象' }
  }
  const next = loadSettings()
  for (const key of Object.keys(patch)) {
    if (!SETTING_KEYS.has(key)) return { ok: false, error: `不认识的设置项：${key}` }
  }
  if ('name' in patch) {
    const name = normalizeName(patch.name)
    if (!name) return { ok: false, error: '名字要是 1–24 个字符，且不能带控制字符' }
    next.name = name
  }
  for (const key of ['enabled', 'followCurrentModel']) {
    if (!(key in patch)) continue
    if (typeof patch[key] !== 'boolean') return { ok: false, error: `${key} 必须是 true / false` }
    next[key] = patch[key]
  }
  for (const [key, range] of Object.entries(NUMBER_SETTINGS)) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: `${key} 必须是数字` }
    const rounded = Math.round(value)
    if (rounded < range.lo || rounded > range.hi) {
      return { ok: false, error: `${key} 必须在 ${range.lo}–${range.hi} 之间` }
    }
    next[key] = rounded
  }
  if ('hands' in patch) {
    const hands = patch.hands
    if (!hands || typeof hands !== 'object' || Array.isArray(hands)) {
      return { ok: false, error: 'hands 必须是对象' }
    }
    for (const key of ['browser', 'desktop', 'script', 'runCommand', 'actions']) {
      if (key in hands && typeof hands[key] !== 'boolean') {
        return { ok: false, error: `hands.${key} 必须是 true / false` }
      }
    }
    for (const key of ['browserSites', 'desktopApps']) {
      if (key in hands && (!Array.isArray(hands[key]) || hands[key].some((item) => typeof item !== 'string'))) {
        return { ok: false, error: `hands.${key} 必须是字符串数组` }
      }
    }
    next.hands = normalizeHands({ ...next.hands, ...hands })
  }
  if ('proactive' in patch) {
    const source = patch.proactive
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, error: 'proactive 必须是对象' }
    }
    for (const key of Object.keys(source)) {
      if (!['enabled', 'everyMin', 'dailyLimit'].includes(key)) {
        return { ok: false, error: `不认识的主动设置：${key}` }
      }
    }
    if ('enabled' in source && typeof source.enabled !== 'boolean') {
      return { ok: false, error: 'proactive.enabled 必须是 true / false' }
    }
    for (const [key, range] of Object.entries(PROACTIVE_RANGES)) {
      if (!(key in source)) continue
      const value = source[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `proactive.${key} 必须是数字` }
      }
      const rounded = Math.round(value)
      if (rounded < range.lo || rounded > range.hi) {
        return { ok: false, error: `proactive.${key} 必须在 ${range.lo}–${range.hi} 之间` }
      }
    }
    next.proactive = normalizeProactive({ ...next.proactive, ...source })
  }
  if ('permissions' in patch) {
    const source = patch.permissions
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, error: 'permissions 必须是对象' }
    }
    for (const key of Object.keys(source)) {
      if (!(key in DEFAULT_SETTINGS.permissions)) return { ok: false, error: `不认识的权限：${key}` }
      if (typeof source[key] !== 'boolean') return { ok: false, error: `permissions.${key} 必须是 true / false` }
    }
    next.permissions = normalizePermissions({ ...next.permissions, ...source })
  }
  if ('appearance' in patch) {
    const source = patch.appearance
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, error: 'appearance 必须是对象' }
    }
    for (const key of Object.keys(source)) {
      if (key !== 'petEnabled') return { ok: false, error: `不认识的外观设置：${key}` }
      if (typeof source[key] !== 'boolean') return { ok: false, error: `appearance.${key} 必须是 true / false` }
    }
    next.appearance = normalizeAppearance({ ...next.appearance, ...source })
  }
  if ('voice' in patch) {
    const source = patch.voice
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, error: 'voice 必须是对象' }
    }
    for (const key of Object.keys(source)) {
      if (!(key in DEFAULT_SETTINGS.voice)) return { ok: false, error: `不认识的声音设置：${key}` }
    }
    for (const key of ['enabled', 'autoSpeak']) {
      if (key in source && typeof source[key] !== 'boolean') return { ok: false, error: `voice.${key} 必须是 true / false` }
    }
    if ('name' in source && typeof source.name !== 'string') return { ok: false, error: 'voice.name 必须是字符串' }
    for (const [key, lo, hi] of [['rate', -10, 10], ['pitch', -30, 30], ['volume', 0, 100]]) {
      if (!(key in source)) continue
      const value = source[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: `voice.${key} 必须是数字` }
      const rounded = Math.round(value)
      if (rounded < lo || rounded > hi) return { ok: false, error: `voice.${key} 必须在 ${lo}–${hi} 之间` }
    }
    next.voice = normalizeVoice({ ...next.voice, ...source })
  }
  if ('sound' in patch) {
    const source = patch.sound
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, error: 'sound 必须是对象' }
    }
    for (const key of Object.keys(source)) {
      if (!(key in DEFAULT_SETTINGS.sound)) return { ok: false, error: `不认识的音效设置：${key}` }
    }
    if ('enabled' in source && typeof source.enabled !== 'boolean') return { ok: false, error: 'sound.enabled 必须是 true / false' }
    if ('volume' in source) {
      if (typeof source.volume !== 'number' || !Number.isFinite(source.volume)) return { ok: false, error: 'sound.volume 必须是数字' }
      if (source.volume < 0 || source.volume > 100) return { ok: false, error: 'sound.volume 必须在 0–100 之间' }
    }
    next.sound = { ...next.sound, ...source, volume: Math.round(Number(source.volume ?? next.sound.volume)) }
  }
  if ('balance' in patch) {
    const source = patch.balance
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, error: 'balance 必须是对象' }
    }
    for (const key of Object.keys(source)) {
      if (!(key in DEFAULT_SETTINGS.balance)) return { ok: false, error: `不认识的余额设置：${key}` }
    }
    if ('enabled' in source && typeof source.enabled !== 'boolean') return { ok: false, error: 'balance.enabled 必须是 true / false' }
    if ('warnBelow' in source) {
      if (typeof source.warnBelow !== 'number' || !Number.isFinite(source.warnBelow)) return { ok: false, error: 'balance.warnBelow 必须是数字' }
      if (source.warnBelow < 0 || source.warnBelow > 100000) return { ok: false, error: 'balance.warnBelow 必须在 0–100000 之间' }
    }
    next.balance = { ...next.balance, ...source, warnBelow: Number(source.warnBelow ?? next.balance.warnBelow) }
  }
  const paths = homePaths()
  const backup = writeWithBackup(paths.settings, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  appendLog('保存设置', { name: next.name, enabled: next.enabled, backup: backup ? basename(backup) : null })
  return { ok: true, settings: next, backup }
}

/** 读人设：文件不在时给默认文本（但不落盘，交给 ensureHome 建）。 */
export function loadPersona() {
  const text = readText(homePaths().persona)
  return text === null ? DEFAULT_PERSONA : text
}

/**
 * 保存人设：限长 64K 字符，写前备份。
 * @param {string} text
 */
export function savePersona(text) {
  if (typeof text !== 'string') return { ok: false, error: '人设必须是字符串' }
  if (text.length > PERSONA_MAX_CHARS) {
    return { ok: false, error: `人设太长（${text.length} 字），上限 ${PERSONA_MAX_CHARS}` }
  }
  const paths = homePaths()
  const backup = writeWithBackup(paths.persona, text)
  appendLog('保存人设', { chars: text.length, backup: backup ? basename(backup) : null })
  return { ok: true, chars: text.length, backup }
}

/** 给面板/状态接口用的一份摘要。 */
export function homeSummary() {
  const paths = homePaths()
  return {
    ...paths,
    dirs: SUBDIRS.map((sub) => {
      const dir = join(paths.root, sub)
      return { name: sub, path: dir, exists: existsSync(dir) }
    }),
    files: {
      settings: fileInfo(paths.settings),
      persona: fileInfo(paths.persona),
    },
  }
}
