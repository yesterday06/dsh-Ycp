/**
 * dsh-Ycp · 大肥鱼（器官）—— 闸门。
 *
 * 说话前按固定顺序过五道闸，任何一道不过就闭嘴，并给出固定 reason：
 *   1. 总开关        disabled
 *   2. 睡眠          sleep      （睡着且"完全不理"；"回一句困的"放行但带困意）
 *   3. 安静时段      quiet
 *   4. 手权限        permission （说话不需要手；这一道留给工具调用 checkHand）
 *   5. 频率          rate-limit （一小时最多 settings.sayPerHour 句）
 *
 * 频率记录落在 大肥鱼\状态\频率.json，只保留最近一小时的时间戳；
 * 每次放行的尝试都记一条（失败也算，因为模型请求已经花出去了）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths, writeAtomic } from '../kernel/paths.js'
import { describeStatus, isQuiet } from './schedule.js'

export const WINDOW_MS = 60 * 60 * 1000

/** 固定 reason 全集；改这里要同步文档与面板文案。 */
export const REASONS = {
  disabled: '总开关关着',
  sleep: '睡着了',
  quiet: '安静时段',
  permission: '没有这个权限',
  'rate-limit': '说太多了',
}

export function ratePath() {
  return join(homePaths().root, '状态', '频率.json')
}

export function loadRateState() {
  const file = ratePath()
  if (!existsSync(file)) return { events: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const events = Array.isArray(raw?.events) ? raw.events.filter((item) => typeof item === 'number' && Number.isFinite(item)) : []
    return { events }
  } catch {
    return { events: [] }
  }
}

export function saveRateState(state) {
  writeAtomic(ratePath(), JSON.stringify({ events: state.events }, null, 2) + '\n')
}

/** 窗口内的时间戳（按时间升序）。 */
export function recentEvents(state, now = Date.now(), windowMs = WINDOW_MS) {
  const floor = now - windowMs
  return (state?.events ?? []).filter((item) => item > floor && item <= now).sort((a, b) => a - b)
}

/** 记一次放行的尝试；顺手把窗口外的清掉。 */
export function recordEvent(state, now = Date.now()) {
  const events = recentEvents(state, now)
  events.push(now)
  return { events }
}

/**
 * 手权限（P11–P13 用）：
 * 每只手有自己的开关，关着就直接拒，不认识的手也拒。
 */
export function checkHand(hands, hand) {
  const known = ['browser', 'desktop', 'script', 'runCommand']
  if (!known.includes(hand)) return { allow: false, reason: 'permission', error: `不认识的手：${String(hand)}` }
  if (hands?.[hand] === true) return { allow: true }
  return { allow: false, reason: 'permission', error: `「${hand}」这条手是关着的` }
}

/**
 * 说话前过闸。
 * @returns {{allow: boolean, reason?: string, error?: string, retryAfterSec?: number, sleepy?: boolean, status?: object, used?: number, limit?: number}}
 */
export function checkSay({ settings, schedule, now = new Date(), rate = { events: [] } }) {
  if (!settings?.enabled) {
    return { allow: false, reason: 'disabled', error: '她现在是关着的，先打开「启用」' }
  }

  const status = describeStatus(schedule, now)
  if (status.asleep && schedule.sleepReply === 'silent') {
    return { allow: false, reason: 'sleep', error: status.label }
  }
  if (!status.asleep && isQuiet(schedule, now)) {
    return { allow: false, reason: 'quiet', error: '现在是安静时段，先不说话' }
  }

  // 第 4 道（手权限）对"说话"不适用：她开口不用手；工具调用走 checkHand。

  const limit = Math.max(1, Number(settings.sayPerHour) || 20)
  const events = recentEvents(rate, now.getTime())
  if (events.length >= limit) {
    const oldest = events[0]
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now.getTime()) / 1000))
    return { allow: false, reason: 'rate-limit', error: `一小时最多 ${limit} 句，歇会儿再说`, retryAfterSec, used: events.length, limit }
  }

  return { allow: true, sleepy: Boolean(status.asleep), status, used: events.length, limit }
}

/** 放行后记账；写盘失败只记日志，不影响这次说话。 */
export function commitSay(rate, now = new Date()) {
  const next = recordEvent(rate, now.getTime())
  try {
    saveRateState(next)
  } catch (error) {
    appendLog('频率记录写入失败', { error: String(error?.message ?? error) })
  }
  return next
}
