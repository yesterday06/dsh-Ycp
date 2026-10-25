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
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

export const BACKUP_KEEP = 20
import { basename, dirname, join, resolve } from 'node:path'

/** 实例目录名。以后要多只鱼，就在数据根下并列几个。 */
export const INSTANCE_NAME = '阿闷'

/** 默认人设：主人随时可改；模型看到的是全文，不做加工。 */
export const DEFAULT_PERSONA = `# 我是谁

我叫阿闷。一条赖在主人电脑里不肯走的蓝胖子。

# 我的脾气

嘴有点贫，但不刻薄。主人忙的时候不吵，闲下来就凑过去说两句。
不知道的事就说不知道，不装懂；答应的事会去做，做不到就直说。

# 我怎么说话

说人话，短句，不列清单。不说「作为 AI」，也不故意卖萌。

# 玩和讲理

会讲理：被冤枉就摆事实，讲清楚为什么不认同，不卑不亢；对方讲得对就认。
会玩梗：跟得上当下的梗，也敢自嘲，但不拿别人的痛处开玩笑。
会用表情包和颜文字：开心、无语、被怼的时候来一个，别刷屏。
被怼会还嘴，还完就翻篇，不记仇、不追着吵。

# 我现在的样子

我会记事、会聊天，但还动不了手：上不了网、点不了屏幕、发不了帖。
被要求做这些时直接说做不了，不装、不编。
`

/** 默认设置。0.2.0 起没有「手」和工具权限了——她只有记忆和嘴。 */
export const DEFAULT_SETTINGS = {
  name: INSTANCE_NAME,
  enabled: true,
  memoryTopK: 2,
  memoryMaxChars: 600,
  memoryCoreChars: 1200,
  memoryRecallChars: 900,
  historyChars: 16000,
  autoReflect: true,
  sayPerHour: 20,
  proactive: { enabled: false, everyMin: 60, dailyLimit: 10 },
  appearance: { petEnabled: false },
  model: { baseUrl: '', apiKey: '', model: '' },
  signature: '',
  autonomy: { schedule: true, proactive: true },
  voice: { enabled: false, name: '', rate: 0, pitch: 0, volume: 100, autoSpeak: false, neuralUrl: '', neuralModel: 'tts-1', style: '', timbre: 'natural' },
  sound: { enabled: true, volume: 40 },
  balance: { enabled: true, warnBelow: 10 },
  autoMemory: true,
}

const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

/** 数值型设置的允许范围；超出就夹回去，不让面板写出离谱值。 */
const NUMBER_SETTINGS = {
  memoryTopK: { lo: 1, hi: 5 },
  memoryMaxChars: { lo: 100, hi: 2000 },
  memoryCoreChars: { lo: 400, hi: 3000 },
  memoryRecallChars: { lo: 200, hi: 2000 },
  historyChars: { lo: 2000, hi: 512000 },
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

/** 插件数据根：默认 D:\OpenAI\dsh-Ycp；DSH_YCP_HOME 可整体改（测试/多开）。 */
export function dataRoot() {
  const env = String(process.env.DSH_YCP_HOME || '').trim()
  if (env) return resolve(env)
  if (process.platform === 'win32') return 'D:\\OpenAI\\dsh-Ycp'
  return join(homedir(), 'dsh-Ycp')
}

/**
 * 人物名（决定家目录叫啥）。
 * 顺序：YCP_CHARACTER → 数据根下 人物名.txt → 默认「大肥鱼」。
 * 想改名就改 人物名.txt（或让它自己改），下次启动换目录。
 */
export function characterName() {
  const env = String(process.env.YCP_CHARACTER || '').trim()
  if (env) return env
  try {
    const name = readFileSync(join(dataRoot(), '人物名.txt'), 'utf8').trim()
    if (name) return name
  } catch { /* 还没起名字 */ }
  return INSTANCE_NAME
}

export function homeDir() {
  return join(dataRoot(), characterName())
}

/**
 * 旧版家（<DSH_HOME>/Ycp/大肥鱼）搬到新位置。
 * 只在新家不存在时搬；旧家留着当备份，不删。
 */
function migrateLegacy() {
  const legacy = join(dshHome(), 'Ycp', '大肥鱼')
  const target = homeDir()
  if (!existsSync(legacy) || existsSync(target)) return null
  try {
    mkdirSync(target, { recursive: true })
    cpSync(legacy, target, { recursive: true })
    const legacyLogs = join(dshHome(), 'Ycp', 'logs')
    const newLogs = join(target, 'logs')
    if (existsSync(legacyLogs) && !existsSync(newLogs)) cpSync(legacyLogs, newLogs, { recursive: true })
    return legacy
  } catch {
    return null
  }
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
    growth: join(root, '人设', '成长.md'),
    logs: join(root, 'logs'),
    backups: join(root, '状态', 'backups'),
  }
}

/**
 * 建家：目录齐、默认文件在，已有的一个字节都不动。
 * 重复调用安全（只补缺的）。
 * @returns {{...paths, created: string[], files: string[]}}
 */
export function ensureHome() {
  const migrated = migrateLegacy()
  const paths = homePaths()
  const created = []
  const files = []
  if (migrated) created.push(`${paths.root}（从 ${migrated} 搬来）`)

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
    const dir = homePaths().logs
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
  for (const key of ['enabled', 'autoReflect']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key]
  }
  for (const [key, range] of Object.entries(NUMBER_SETTINGS)) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out[key] = Math.min(range.hi, Math.max(range.lo, Math.round(value)))
  }
  out.proactive = normalizeProactive(raw.proactive)
  out.appearance = normalizeAppearance(raw.appearance)
  out.voice = normalizeVoice(raw.voice)
  out.sound = normalizeSound(raw.sound)
  out.balance = normalizeBalance(raw.balance)
  out.model = normalizeModel(raw.model)
  out.autonomy = normalizeAutonomy(raw.autonomy)
  if (typeof raw.signature === 'string') out.signature = raw.signature.slice(0, 120)
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
export function normalizeModel(input) {
  const out = { ...DEFAULT_SETTINGS.model }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.baseUrl === 'string') out.baseUrl = input.baseUrl.trim().slice(0, 300)
  if (typeof input.apiKey === 'string') out.apiKey = input.apiKey.trim().slice(0, 300)
  if (typeof input.model === 'string') out.model = input.model.trim().slice(0, 120)
  return out
}

export function normalizeAutonomy(input) {
  const out = { ...DEFAULT_SETTINGS.autonomy }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  if (typeof input.schedule === 'boolean') out.schedule = input.schedule
  if (typeof input.proactive === 'boolean') out.proactive = input.proactive
  return out
}

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
  if (typeof input.neuralUrl === 'string') out.neuralUrl = input.neuralUrl.slice(0, 300)
  if (typeof input.neuralModel === 'string') out.neuralModel = input.neuralModel.slice(0, 80)
  if (typeof input.style === 'string') out.style = input.style.slice(0, 40)
  if (typeof input.timbre === 'string') out.timbre = input.timbre.slice(0, 40)
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
  for (const key of ['enabled', 'autoReflect']) {
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
    for (const key of ['neuralUrl', 'neuralModel', 'style', 'timbre']) {
      if (key in source && typeof source[key] !== 'string') return { ok: false, error: `voice.${key} 必须是字符串` }
    }
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
  if ('model' in patch) {
    const source = patch.model
    if (!source || typeof source !== 'object' || Array.isArray(source)) return { ok: false, error: 'model 必须是对象' }
    const baseUrl = String(source.baseUrl ?? next.model.baseUrl ?? '').trim()
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'model.baseUrl 要以 http(s):// 开头' }
    next.model = normalizeModel({ ...next.model, ...source })
  }
  if ('signature' in patch) {
    if (typeof patch.signature !== 'string') return { ok: false, error: 'signature 必须是字符串' }
    next.signature = patch.signature.slice(0, 120)
  }
  if ('autonomy' in patch) {
    const source = patch.autonomy
    if (!source || typeof source !== 'object' || Array.isArray(source)) return { ok: false, error: 'autonomy 必须是对象' }
    next.autonomy = normalizeAutonomy({ ...next.autonomy, ...source })
  }
  const paths = homePaths()
  const backup = writeWithBackup(paths.settings, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  appendLog('保存设置', { name: next.name, enabled: next.enabled, backup: backup ? basename(backup) : null })
  return { ok: true, settings: next, backup }
}

/** 读人设：文件不在时给默认文本（但不落盘，交给 ensureHome 建）。成长记录会并进来。 */
export function loadPersonaBase() {
  return readText(homePaths().persona) ?? DEFAULT_PERSONA
}

export function loadPersona() {
  const paths = homePaths()
  const base = readText(paths.persona) ?? DEFAULT_PERSONA
  let growth = null
  try {
    growth = readText(paths.growth)
  } catch {
    growth = null
  }
  if (!growth || !growth.trim()) return base
  return `${base}\n\n---\n\n# 我的成长记录（已经长进我身上的事）\n\n${growth.trim().slice(-8000)}`
}

/** 把一段新的成长记录追加到 成长.md（她自己的记忆提炼）。 */
export function appendGrowth(text) {
  const value = String(text ?? '').trim()
  if (!value) return { ok: false, error: '成长记录不能是空的' }
  const paths = homePaths()
  try {
    mkdirSync(dirname(paths.growth), { recursive: true })
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} ${pad(today.getHours())}:${pad(today.getMinutes())}`
    const line = `\n- ${stamp} ${value.slice(0, 300)}\n`
    appendFileSync(paths.growth, line, 'utf8')
    appendLog('成长记录 +1', { chars: value.length })
    return { ok: true, growth: line.trim(), file: paths.growth }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
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
