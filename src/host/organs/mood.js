/**
 * dsh-Ycp · 大肥鱼（器官）—— 心情与统计。
 *
 * 三个数，全是本地算的，不调模型：
 *   体力 energy  0–100，说话会掉，睡觉会回
 *   心情 mood    0–100，被搭理会涨，醒着会慢慢往 50 漂
 *   饿   hunger  0–100，数字越大越饿，醒着每小时涨
 *
 * 存 大肥鱼\状态\心情.json。每次读写都先按经过的时间结一次账（补上离线期间的消耗/恢复），
 * 免得关一晚再打开，数字还停在昨天。
 *
 * 统计按天重置：今天说了几句、主动几次、查了几次网。
 * 跨天只重置统计，体力/心情/饿照常带过来——那是她自己的状态，不是当天的计数器。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths, writeAtomic } from '../kernel/paths.js'
import { isAsleep } from './schedule.js'

export const PER_HOUR = {
  awake: { energy: -6, hunger: 5, moodDrift: 1 },
  asleep: { energy: 6, hunger: 0.2, moodGain: 2 },
}

export const SAY_COST = { energy: 2, hunger: 1, mood: 2 }

function clamp(value, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, value))
}

export function dayStamp(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function moodPath() {
  return join(homePaths().root, '状态', '心情.json')
}

export function defaultMood(now = new Date()) {
  return {
    date: dayStamp(now),
    energy: 80,
    mood: 70,
    hunger: 20,
    updatedAt: now.getTime(),
    lastSayAt: null,
    stats: { said: 0, proactive: 0, web: 0 },
    events: [],
  }
}

function normalize(raw, now) {
  const base = defaultMood(now)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const out = { ...base }
  for (const key of ['energy', 'mood', 'hunger']) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) out[key] = clamp(raw[key])
  }
  if (typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)) out.updatedAt = raw.updatedAt
  if (typeof raw.lastSayAt === 'number' && Number.isFinite(raw.lastSayAt)) out.lastSayAt = raw.lastSayAt
  if (raw.stats && typeof raw.stats === 'object') {
    for (const key of ['said', 'proactive', 'web']) {
      if (typeof raw.stats[key] === 'number' && Number.isFinite(raw.stats[key])) {
        out.stats[key] = Math.max(0, Math.round(raw.stats[key]))
      }
    }
  }
  if (typeof raw.date === 'string') out.date = raw.date
  if (Array.isArray(raw.events)) {
    out.events = raw.events
      .filter((item) => item && typeof item.kind === 'string')
      .slice(-20)
      .map((item) => ({ kind: String(item.kind).slice(0, 24), note: String(item.note || '').slice(0, 60), at: Number(item.at) || Date.now() }))
  }
  return out
}

/** 按经过的时间结账：醒着掉体力涨饿，睡着回体力。最多补 24 小时，防止久关后数字乱跳。 */
export function decay(state, now = new Date(), schedule) {
  const next = { ...state, stats: { ...state.stats } }
  const minutes = Math.max(0, (now.getTime() - state.updatedAt) / 60000)
  if (minutes < 1) return next
  const hours = Math.min(minutes, 24 * 60) / 60
  const asleep = Boolean(schedule && isAsleep(schedule, now).asleep)
  const satiety = 100 - next.hunger
  const energyFactor = satiety >= 70 ? 1.25 : satiety <= 30 ? 0.6 : 1
  const moodFactor = satiety >= 70 ? 1.15 : satiety <= 30 ? 0.55 : 1

  if (asleep) {
    next.energy = clamp(next.energy + PER_HOUR.asleep.energy * hours * energyFactor)
    next.hunger = clamp(next.hunger + PER_HOUR.asleep.hunger * hours)
    next.mood = clamp(next.mood + PER_HOUR.asleep.moodGain * hours * moodFactor)
  } else {
    next.energy = clamp(next.energy + PER_HOUR.awake.energy * hours * energyFactor)
    next.hunger = clamp(next.hunger + PER_HOUR.awake.hunger * hours)
    // 清醒时心情往 50 漂：高了落一点，低了涨一点。
    const drift = PER_HOUR.awake.moodDrift * hours * moodFactor
    next.mood = clamp(next.mood > 50 ? next.mood - drift : next.mood + drift)
    // 长时间没人理：她自己歇着慢慢回体力；冷落太久心情会掉。
    if (hours >= 6) next.energy = clamp(next.energy + 2 * hours)
    if (hours >= 12) next.mood = clamp(next.mood - 0.8 * (hours - 12))
  }

  // 跨天：只重置统计
  const today = dayStamp(now)
  if (next.date !== today) {
    next.date = today
    next.stats = { said: 0, proactive: 0, web: 0 }
  }
  next.updatedAt = now.getTime()
  return next
}

export function loadMood(now = new Date(), schedule) {
  let raw = null
  const file = moodPath()
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      raw = null
    }
  }
  return decay(normalize(raw, now), now, schedule)
}

export function saveMood(state) {
  writeAtomic(moodPath(), JSON.stringify(state, null, 2) + '\n')
}

function touch(state, now) {
  const next = { ...state, stats: { ...state.stats }, updatedAt: now.getTime() }
  return next
}

/**
 * 说了一句：体力 −2、饿 +1、心情 +2，今天说过的句数 +1。
 * @returns {object} 结算后的状态
 */
export function recordSay(now = new Date(), schedule) {
  const state = loadMood(now, schedule)
  const next = touch(state, now)
  next.energy = clamp(next.energy - SAY_COST.energy)
  next.hunger = clamp(next.hunger + SAY_COST.hunger)
  next.mood = clamp(next.mood + SAY_COST.mood)
  next.stats.said += 1
  next.lastSayAt = now.getTime()
  saveMood(next)
  return next
}

/** 主动开口（P08 用）：体力 −2、心情 +1，主动次数 +1。 */
export function recordProactive(now = new Date(), schedule) {
  const state = loadMood(now, schedule)
  const next = touch(state, now)
  next.energy = clamp(next.energy - 2)
  next.mood = clamp(next.mood + 1)
  next.stats.proactive += 1
  saveMood(next)
  return next
}

/** 查了一次网（P10 用）：体力 −1，查网次数 +1。 */
export function recordWeb(now = new Date(), schedule) {
  const state = loadMood(now, schedule)
  const next = touch(state, now)
  next.energy = clamp(next.energy - 1)
  next.stats.web += 1
  saveMood(next)
  return next
}

/** 发生了一件事：被骂、吵架输了、被举报、被夸……直接影响心情，记进最近事件。 */
export const EVENT_EFFECTS = {
  praised: { mood: 6, energy: 1 },
  compliment: { mood: 5 },
  scolded: { mood: -8, energy: -2 },
  argument_lost: { mood: -10, energy: -3 },
  reported: { mood: -12, energy: -2 },
  ignored: { mood: -4 },
  forced: { mood: -2 },
  error: { mood: -3 },
  success: { mood: 4 },
}

export function recordEvent(kind, note = '', now = new Date(), schedule) {
  const effect = EVENT_EFFECTS[kind] || { mood: -2 }
  const state = loadMood(now, schedule)
  const next = touch(state, now)
  next.mood = clamp(next.mood + (effect.mood || 0))
  next.energy = clamp(next.energy + (effect.energy || 0))
  next.events = [...(next.events || []), { kind: String(kind).slice(0, 24), note: String(note).slice(0, 60), at: now.getTime() }].slice(-20)
  saveMood(next)
  return moodSummary(next)
}

/** 做了一件消耗体力的事：上网/发帖/玩耍/社交…… */
const ACTIVITY_COST = { web: 1, browse: 1, post: 3, play: 2, social: 2, work: 3 }

export function recordActivity(kind = 'web', now = new Date(), schedule) {
  const state = loadMood(now, schedule)
  const next = touch(state, now)
  next.energy = clamp(next.energy - (ACTIVITY_COST[kind] || 1))
  next.hunger = clamp(next.hunger + 1)
  next.mood = clamp(next.mood + 1)
  if (kind === 'web' || kind === 'browse') next.stats.web += 1
  saveMood(next)
  return next
}

/** 面板/接口用的一份摘要。 */
export function moodSummary(state) {
  const energy = Math.round(state.energy)
  const mood = Math.round(state.mood)
  const hunger = Math.round(state.hunger)
  const satiety = 100 - hunger
  let label = '还行'
  if (energy <= 20) label = '快没电了'
  else if (hunger >= 80) label = '饿得慌'
  else if (mood <= 30) label = '不太高兴'
  else if (mood >= 80 && energy >= 60) label = '心情不错'

  // 表情包概率：体力高、心情好、吃饱了更爱发；心情差明显收敛。
  let memeChance = 0.18 + energy / 500 + mood / 500 + (satiety - 50) / 600
  if (mood < 35) memeChance = Math.min(memeChance, 0.1)
  if (energy < 25) memeChance *= 0.5
  memeChance = Math.max(0.05, Math.min(0.65, memeChance))

  // 主动倾向：体力占一半，心情三成，饱食两成。
  let tendency = energy / 100 * 0.5 + mood / 100 * 0.3 + satiety / 100 * 0.2
  if (mood < 25) tendency *= 0.5
  if (energy < 20) tendency *= 0.4

  return {
    energy,
    mood,
    hunger,
    satiety,
    label,
    memeChance: Math.round(memeChance * 100) / 100,
    tendency: Math.round(tendency * 100) / 100,
    stats: { ...state.stats },
    events: Array.isArray(state.events) ? state.events.slice(-5) : [],
    lastSayAt: state.lastSayAt ?? null,
    updatedAt: state.updatedAt,
  }
}

/** 兼容旧调用：读一份摘要并落盘（把结账后的数字存下来，面板不会来回跳）。 */
export function todaySummary(now = new Date(), schedule) {
  const state = loadMood(now, schedule)
  try {
    saveMood(state)
  } catch (error) {
    appendLog('心情落盘失败', { error: String(error?.message ?? error) })
  }
  return moodSummary(state)
}
