/**
 * dsh-Ycp · 大肥鱼（器官）—— 主动发言。
 *
 * 没人理的时候，她自己开口。六道条件全满足才说话：
 *   1. 醒着
 *   2. 主动开关开着
 *   3. 非安静时段
 *   4. 今天没超过 dailyLimit 次
 *   5. 状态不极低（体力 > 15、心情 > 15、饿 < 85）
 *   6. 过了冷却（下次时间带 ±30% 随机抖动）
 *
 * 内容来源：实时卡 →（没有就）随机一张全局卡 →（也没有就）只靠时间背景。
 * 说的话由模型按人设生成，不写死台词；生成成功记进 状态\主动.json，面板来取。
 *
 * 这里只负责"该不该说、说什么由谁决定、说完记哪"；真发到别处是后面阶段的手。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths, loadPersona, loadSettings, writeAtomic } from '../kernel/paths.js'
import { buildSystem } from '../kernel/prompt.js'
import { excerpt } from './search.js'
import { listCards, readCard } from './memory.js'
import { dayStamp, loadMood, moodSummary, recordProactive } from './mood.js'
import { isAsleep, isQuiet } from './schedule.js'

const COOLDOWN_MIN = 5 * 60 * 1000
const TIMEOUT_MS = 60_000
const MAX_KEEP = 20

export function proactivePath() {
  return join(homePaths().root, '状态', '主动.json')
}

export function loadProactiveState() {
  const file = proactivePath()
  const empty = { lastAt: 0, nextAt: 0, messages: [] }
  if (!existsSync(file)) return empty
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty
    const messages = Array.isArray(raw.messages)
      ? raw.messages.filter((item) => item && typeof item.text === 'string' && item.text.trim())
      : []
    return {
      lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : 0,
      nextAt: typeof raw.nextAt === 'number' ? raw.nextAt : 0,
      messages: messages.slice(-MAX_KEEP),
    }
  } catch {
    return empty
  }
}

export function saveProactiveState(state) {
  writeAtomic(proactivePath(), JSON.stringify(state, null, 2) + '\n')
}

/** 下次开口的时间：基准分钟数 × (0.7–1.3) 随机抖动。 */
export function nextAtFrom(now, everyMin, random = Math.random) {
  const base = Math.max(1, Number(everyMin) || 60) * 60_000
  const factor = 0.7 + 0.6 * Math.max(0, Math.min(1, Number(random()) || 0))
  return now.getTime() + Math.round(base * factor)
}

function timesToday(state, now) {
  const today = dayStamp(now)
  return state.messages.filter((item) => typeof item.at === 'number' && dayStamp(new Date(item.at)) === today).length
}

/**
 * 六道条件；force 只跳冷却（面板的「现在试一次」用）。
 * @returns {{allow: boolean, reason?: string, retryAfterSec?: number, mood?: object}}
 */
export function checkProactive({ settings, schedule, mood, state, now = new Date(), force = false }) {
  const proactive = settings?.proactive ?? {}
  if (!proactive.enabled) return { allow: false, reason: 'off' }
  if (isAsleep(schedule, now).asleep) return { allow: false, reason: 'sleep' }
  if (isQuiet(schedule, now)) return { allow: false, reason: 'quiet' }

  const used = timesToday(state, now)
  const limit = Math.max(0, Number(proactive.dailyLimit) || 0)
  if (used >= limit) return { allow: false, reason: 'daily-limit', used, limit }

  if (mood.energy <= 15 || mood.mood <= 15 || mood.hunger >= 85) {
    return { allow: false, reason: 'low', mood }
  }

  if (!force && state.nextAt && now.getTime() < state.nextAt) {
    return {
      allow: false,
      reason: 'cooldown',
      retryAfterSec: Math.max(1, Math.ceil((state.nextAt - now.getTime()) / 1000)),
    }
  }

  return { allow: true, used, limit }
}

/** 选这一句的落脚点：实时卡 → 随机全局卡 → 时间背景。 */
export function pickSource(random = Math.random) {
  const realtime = listCards('realtime')
  if (realtime.length) {
    const newest = realtime[0]
    const card = readCard('realtime', newest.file)
    return { source: 'realtime', block: card ? `- 此刻：${excerpt(card.content, 200)}` : '' }
  }
  const global = listCards('global')
  if (global.length) {
    const pick = global[Math.floor(Math.max(0, Math.min(0.999, Number(random()) || 0)) * global.length)]
    const card = pick ? readCard('global', pick.file) : null
    return { source: 'memory', block: card ? `- 你记着：${pick.title}：${excerpt(card.content, 300)}` : '' }
  }
  return { source: 'time', block: '' }
}

function service(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function currentModel(ctx) {
  try {
    const selection = service(ctx, 'agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
  } catch {
    /* 服务未就绪 */
  }
  return null
}

function noTextReason(finish) {
  const { kind, failure } = finish ?? {}
  if (kind === 'aborted') return '等太久了'
  if (kind === 'max-tokens') return '话说满了'
  if (kind !== 'error') return '模型没说话'
  return failure?.message || failure?.code || '模型报错'
}

/**
 * 跑一次主动发言。
 * @returns {{ok: boolean, fired: boolean, reason?: string, message?: object, error?: string}}
 */
export async function runOnce(ctx, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const random = typeof options.random === 'function' ? options.random : Math.random
  const settings = loadSettings()
  const state = loadProactiveState()

  let schedule = options.schedule
  let mood = options.mood
  if (!schedule || !mood) {
    const scheduleMod = await import('./schedule.js')
    schedule = schedule || scheduleMod.loadSchedule()
    mood = mood || loadMood(now, schedule)
  }

  const check = checkProactive({ settings, schedule, mood, state, now, force: Boolean(options.force) })
  if (!check.allow) return { ok: false, fired: false, reason: check.reason, retryAfterSec: check.retryAfterSec }

  const model = currentModel(ctx)
  const llm = service(ctx, 'llm')
  if (!model || !llm || typeof llm.stream !== 'function') {
    // 没有模型就别烧冷却：只记日志，等下次 tick。
    const reason = !model ? 'provider-missing' : 'llm-missing'
    appendLog('主动发言没条件', { reason })
    return { ok: false, fired: false, reason }
  }

  const picked = pickSource(random)
  const summary = moodSummary(mood)
  const memories = picked.block ? `【你记得的】\n${picked.block}` : ''
  const system = buildSystem({
    persona: loadPersona(),
    name: settings.name,
    now,
    memories,
    extra: [
      '【这会儿】没人在跟你说话。你自己想开口说一句：短一点，别问需要回答的问题，别报时。',
      `【你的状态】体力 ${summary.energy}，心情 ${summary.mood}，饿 ${summary.hunger}（0–100，越高越饿）。语气可以带着这个状态，但别把数字说出来。`,
    ].join('\n'),
  })

  const pieces = []
  let finish = null
  try {
    const stream = llm.stream({
      provider: model.provider,
      model: model.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: '（四周很安静）' }] }],
      temperature: 1,
      sessionId: 'dsh-Ycp',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') pieces.push(chunk.text)
      else if (chunk?.type === 'finish') finish = chunk.reason ?? null
    }
  } catch (error) {
    const message = String(error?.message ?? error)
    appendLog('主动发言失败', { error: message })
    const next = { ...state, nextAt: now.getTime() + COOLDOWN_MIN }
    saveProactiveState(next)
    return { ok: false, fired: false, reason: 'generate-error', error: message }
  }

  const text = pieces.join('').trim()
  if (!text) {
    const error = noTextReason(finish)
    appendLog('主动发言没正文', { error })
    saveProactiveState({ ...state, nextAt: now.getTime() + COOLDOWN_MIN })
    return { ok: false, fired: false, reason: 'generate-error', error }
  }

  const message = {
    id: `p${now.getTime().toString(36)}`,
    text,
    at: now.getTime(),
    source: picked.source,
    read: false,
  }
  const next = {
    lastAt: now.getTime(),
    nextAt: nextAtFrom(now, settings.proactive.everyMin, random),
    messages: [...state.messages, message].slice(-MAX_KEEP),
  }
  saveProactiveState(next)
  try {
    recordProactive(now, schedule)
  } catch (error) {
    appendLog('主动状态结算失败', { error: String(error?.message ?? error) })
  }
  appendLog('主动说了一句', { chars: text.length, source: picked.source })

  return { ok: true, fired: true, message, nextAt: next.nextAt }
}

/** 面板展示用。 */
export function listForPanel(now = new Date()) {
  const settings = loadSettings()
  const state = loadProactiveState()
  const messages = state.messages.slice(-10).map((item) => ({ ...item })).reverse()
  return {
    enabled: Boolean(settings.proactive.enabled),
    everyMin: settings.proactive.everyMin,
    dailyLimit: settings.proactive.dailyLimit,
    usedToday: timesToday(state, now),
    lastAt: state.lastAt || null,
    nextAt: state.nextAt || null,
    unread: state.messages.filter((item) => !item.read).length,
    messages,
  }
}

/** 标记已读（面板看到就算读过）。 */
export function markRead(ids) {
  const state = loadProactiveState()
  const set = Array.isArray(ids) && ids.length ? new Set(ids) : null
  const next = {
    ...state,
    messages: state.messages.map((item) => (set && !set.has(item.id) ? item : { ...item, read: true })),
  }
  saveProactiveState(next)
  return { ok: true, unread: next.messages.filter((item) => !item.read).length }
}

/**
 * 每 60 秒看一眼。没条件就静默返回；有条件才真正生成。
 * @returns {object|null} 定时器句柄（没有 ctx.effect 时返回 null，方便自检）
 */
export function startTimer(ctx) {
  if (typeof ctx?.effect !== 'function') return null
  let timer = null
  ctx.effect(() => {
    timer = setInterval(() => {
      runOnce(ctx).catch((error) => {
        appendLog('主动发言调度出错', { error: String(error?.message ?? error) })
      })
    }, 60_000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      if (timer) clearInterval(timer)
      timer = null
    }
  }, 'dsh-Ycp: proactive timer')
  return { stop() { if (timer) clearInterval(timer) } }
}
