/**
 * dsh-Ycp · 提示词拼装（纯函数，不碰文件、不碰网络）。
 *
 * 模型看到的 system 顺序固定：
 *   【人设】   —— 全文原样，不总结、不加工
 *   【你的名字】
 *   【当下】   —— 日期、时段、工作日/周末；明确告诉她「不必刻意报时」
 *
 * 为什么最后那句必须留：不留的话模型会每句话都带「现在是晚上」，一眼机器人。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const RULES_FILE = fileURLToPath(new URL('../../../RULES.md', import.meta.url))

function loadRules() {
  try {
    return readFileSync(RULES_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/** 一天里的时段，只用于给模型一个语感。 */
export function partOfDay(hour) {
  if (hour >= 0 && hour < 5) return '深夜'
  if (hour >= 5 && hour < 8) return '清晨'
  if (hour >= 8 && hour < 11) return '上午'
  if (hour >= 11 && hour < 14) return '中午'
  if (hour >= 14 && hour < 17) return '下午'
  if (hour >= 17 && hour < 19) return '傍晚'
  if (hour >= 19 && hour < 23) return '晚上'
  return '深夜'
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * 当下这一段的文本。
 * @param {Date} [now]
 */
export function timeContext(now = new Date()) {
  const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日星期${WEEKDAYS[now.getDay()]} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  const weekend = now.getDay() === 0 || now.getDay() === 6
  return `现在是${date}，${partOfDay(now.getHours())}，${weekend ? '周末' : '工作日'}。\n这只是背景，不必刻意报时，也别句句都提节日。`
}

/**
 * 拼 system。
 * @param {{persona?: string, name?: string, now?: Date, memories?: string, extra?: string}} input
 *   memories 是 search.memoryBlock() 的产物；空串就整段省略，省 token。
 *   extra 是临时的状态提示（比如「这会儿困得厉害」），放在最后。
 */
export function buildSystem({ persona, name, now = new Date(), memories = '', extra = '', rules = loadRules() } = {}) {
  const body = String(persona ?? '').trim() || '（人设还是空的，按你自己的样子说话。）'
  const who = String(name ?? '').trim() || '大肥鱼'
  const memory = String(memories ?? '').trim()
  const tail = String(extra ?? '').trim()
  const parts = [
    '【人设】',
    body,
    '',
    '【你的名字】',
    who,
  ]
  if (rules) parts.push('', '【使用规则】', rules, '', '（规则是操作层面的，别用规则的口吻说话。）')
  if (memory) parts.push('', memory)
  parts.push('', '【当下】', timeContext(now))
  if (tail) parts.push('', tail)
  return parts.join('\n')
}
