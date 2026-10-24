/**
 * dsh-Ycp · 大肥鱼（器官）—— 作息。
 *
 * 存在 大肥鱼\行为\作息.json。她什么时候睡、什么时候午睡、安静时段、睡着时理不理人。
 *
 * 时间都是 "HH:MM"，按本地时区算。
 * 跨夜的睡觉窗口（比如 23:30 → 08:00）要连着前一天一起看：
 *   周五 23:30 睡下，周六 00:30 仍然算睡着，不能因为"换了一天、周末作息不同"就醒了。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, backupFile, homePaths, writeAtomic } from '../kernel/paths.js'

export const DEFAULT_SCHEDULE = {
  weekday: { wake: '08:00', sleep: '23:30' },
  weekend: { wake: '10:00', sleep: '01:00' },
  nap: { enabled: false, from: '13:00', to: '13:40' },
  quiet: { enabled: false, from: '23:00', to: '07:00' },
  /** 睡着时：'reply' 回一句很困的 / 'silent' 完全不理 */
  sleepReply: 'reply',
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isTime(value) {
  return typeof value === 'string' && TIME_RE.test(value)
}

export function parseTime(value) {
  if (!isTime(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

/** 现在这一天的第几分钟。 */
export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes()
}

/** 时段判断：from–to，跨零点也对。from === to 视为空窗口。 */
export function inWindow(minutes, from, to) {
  const start = parseTime(from)
  const end = parseTime(to)
  if (start === null || end === null || start === end) return false
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

export function isWeekend(date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function schedulePath() {
  return join(homePaths().root, '行为', '作息.json')
}

function merge(base, patch) {
  const out = { ...base }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out
  for (const group of ['weekday', 'weekend', 'nap', 'quiet']) {
    if (patch[group] && typeof patch[group] === 'object' && !Array.isArray(patch[group])) {
      out[group] = { ...base[group], ...patch[group] }
    }
  }
  if (typeof patch.sleepReply === 'string') out.sleepReply = patch.sleepReply
  return out
}

/** 校验一份作息；任何一项不合法就整份拒绝。 */
export function validateSchedule(input) {
  const value = merge(DEFAULT_SCHEDULE, input)
  for (const group of ['weekday', 'weekend']) {
    const slot = value[group]
    if (!isTime(slot.wake)) return { ok: false, error: `${group}.wake 要是 HH:MM` }
    if (!isTime(slot.sleep)) return { ok: false, error: `${group}.sleep 要是 HH:MM` }
    if (slot.wake === slot.sleep) return { ok: false, error: `${group} 的起床和睡觉不能是同一时刻` }
  }
  for (const group of ['nap', 'quiet']) {
    const slot = value[group]
    if (typeof slot.enabled !== 'boolean') return { ok: false, error: `${group}.enabled 要是 true / false` }
    if (!isTime(slot.from)) return { ok: false, error: `${group}.from 要是 HH:MM` }
    if (!isTime(slot.to)) return { ok: false, error: `${group}.to 要是 HH:MM` }
    if (slot.from === slot.to) return { ok: false, error: `${group} 的起止不能相同` }
  }
  if (value.sleepReply !== 'reply' && value.sleepReply !== 'silent') {
    return { ok: false, error: 'sleepReply 只能是 reply 或 silent' }
  }
  return { ok: true, schedule: value }
}

export function loadSchedule() {
  const file = schedulePath()
  if (!existsSync(file)) return { ...DEFAULT_SCHEDULE }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const checked = validateSchedule(raw)
    return checked.ok ? checked.schedule : { ...DEFAULT_SCHEDULE }
  } catch {
    return { ...DEFAULT_SCHEDULE }
  }
}

export function saveSchedule(patch) {
  // 补丁语义：先叠在磁盘上的现有作息，再校验；只传一部分不会把别的字段打回默认。
  const checked = validateSchedule(merge(loadSchedule(), patch))
  if (!checked.ok) return { ok: false, error: checked.error }
  const file = schedulePath()
  const backup = existsSync(file) ? backupFile(file) : null
  writeAtomic(file, JSON.stringify(checked.schedule, null, 2) + '\n')
  appendLog('保存作息', { backup: backup ? 'yes' : null })
  return { ok: true, schedule: checked.schedule, backup }
}

/**
 * 某一天对应的睡觉窗口：开始 → 结束。
 * 睡觉时间早于起床时间（如 01:00 睡、10:00 起）时窗口在同一天；
 * 晚于起床时间（如 23:30 睡、08:00 起）时窗口跨到第二天。
 */
export function sleepWindow(schedule, date) {
  const slot = isWeekend(date) ? schedule.weekend : schedule.weekday
  const start = new Date(date)
  start.setHours(Math.floor(parseTime(slot.sleep) / 60), parseTime(slot.sleep) % 60, 0, 0)
  const end = new Date(date)
  end.setHours(Math.floor(parseTime(slot.wake) / 60), parseTime(slot.wake) % 60, 0, 0)
  if (parseTime(slot.sleep) >= parseTime(slot.wake)) end.setDate(end.getDate() + 1)
  return { start, end, slot }
}

/**
 * 现在是不是睡着/午睡。
 * 晚上看"昨天"和"今天"两个窗口，避免跨夜时按新一天的作息误判醒着。
 * @returns {{asleep: boolean, kind: 'night'|'nap'|null, until: Date|null}}
 */
export function isAsleep(schedule, now = new Date()) {
  for (const offset of [-1, 0]) {
    const day = new Date(now)
    day.setDate(day.getDate() + offset)
    const { start, end } = sleepWindow(schedule, day)
    if (now >= start && now < end) return { asleep: true, kind: 'night', until: end }
  }
  if (schedule.nap.enabled && inWindow(nowMinutes(now), schedule.nap.from, schedule.nap.to)) {
    const end = new Date(now)
    const to = parseTime(schedule.nap.to)
    end.setHours(Math.floor(to / 60), to % 60, 0, 0)
    if (end <= now) end.setDate(end.getDate() + 1)
    return { asleep: true, kind: 'nap', until: end }
  }
  return { asleep: false, kind: null, until: null }
}

/** 安静时段：只在醒着的时候单独算；睡着由睡眠闸先挡。 */
export function isQuiet(schedule, now = new Date()) {
  if (!schedule.quiet.enabled) return false
  return inWindow(nowMinutes(now), schedule.quiet.from, schedule.quiet.to)
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 面板状态行用：醒着 / 夜里睡着 / 午睡中 + 到几点。 */
export function describeStatus(schedule, now = new Date()) {
  const state = isAsleep(schedule, now)
  if (state.asleep) {
    const label = state.kind === 'nap' ? '午睡中' : '夜里睡着'
    return {
      asleep: true,
      kind: state.kind,
      until: state.until ? state.until.toISOString() : null,
      label: `${label}，到 ${state.until ? hhmm(state.until) : '?'} 起`,
      quiet: false,
    }
  }
  const quiet = isQuiet(schedule, now)
  return {
    asleep: false,
    kind: null,
    until: null,
    label: quiet ? '安静时段（醒着，但尽量别吵）' : '醒着',
    quiet,
  }
}
