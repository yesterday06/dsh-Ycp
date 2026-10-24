/**
 * dsh-Ycp · 大肥鱼（外观层）—— 余额（P17，平替 whale 挂件）。
 *
 * 数据来源和 whale 一样：DSH 的 credentials 服务取 DEEPSEEK_API_KEY，
 * 再打 https://api.deepseek.com/user/balance。密钥不落盘、不进日志。
 *
 * 缓存 5 分钟；刷新失败时退回上次读到的值，并标 stale，不让界面突然空白。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths, loadSettings, writeAtomic } from '../kernel/paths.js'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CACHE_MS = 5 * 60 * 1000
const TIMEOUT_MS = 8000

function balanceFile() {
  return join(homePaths().root, '状态', '余额.json')
}

function readPersisted() {
  const file = balanceFile()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function createBalance({ ctx, fetchImpl = globalThis.fetch } = {}) {
  let cache = null

  async function apiKey() {
    try {
      const credentials = ctx?.get?.('credentials')
      const resolved = await credentials?.resolve?.('DEEPSEEK_API_KEY')
      return resolved?.value || ''
    } catch {
      return ''
    }
  }

  function view(data) {
    const settings = loadSettings().balance ?? { enabled: true, warnBelow: 10 }
    const warnBelow = Number(settings.warnBelow) || 0
    const total = data ? Number(data.total) : NaN
    return {
      ok: Boolean(data) && Number.isFinite(total),
      enabled: settings.enabled !== false,
      currency: data?.currency ?? 'CNY',
      total: Number.isFinite(total) ? total : null,
      granted: data?.granted ?? null,
      toppedUp: data?.toppedUp ?? null,
      available: data?.available ?? null,
      at: data?.at ?? null,
      stale: data ? Date.now() - Number(data.at || 0) > CACHE_MS : false,
      warnBelow,
      low: Number.isFinite(total) && total < warnBelow,
    }
  }

  async function refresh() {
    const key = await apiKey()
    if (!key) {
      return { ok: false, reason: 'no-key', error: '没配置 DEEPSEEK_API_KEY（在 DSH 设置里填）' }
    }
    if (typeof fetchImpl !== 'function') {
      return { ok: false, reason: 'no-fetch', error: '当前运行时没有 fetch' }
    }
    try {
      const response = await fetchImpl(BALANCE_URL, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        return { ok: false, reason: 'http', error: `余额接口返回 ${response.status}` }
      }
      const payload = await response.json()
      const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
      const picked = infos.find((item) => item?.currency === 'CNY') || infos[0]
      if (!picked) return { ok: false, reason: 'empty', error: '余额接口没返回钱包信息' }
      const data = {
        at: Date.now(),
        currency: picked.currency || 'CNY',
        total: Number(picked.total_balance ?? 0),
        granted: Number(picked.granted_balance ?? 0),
        toppedUp: Number(picked.topped_up_balance ?? 0),
        available: Boolean(payload?.is_available),
      }
      cache = { at: data.at, data }
      try {
        writeAtomic(balanceFile(), JSON.stringify(data, null, 2) + '\n')
      } catch (error) {
        appendLog('余额落盘失败', { error: String(error?.message ?? error) })
      }
      return { ok: true, ...view(data) }
    } catch (error) {
      const message = String(error?.message ?? error)
      appendLog('查余额失败', { error: message })
      return { ok: false, reason: 'network', error: message }
    }
  }

  async function status({ force = false } = {}) {
    const settings = loadSettings().balance
    if (settings && settings.enabled === false) return { ...view(readPersisted()), ok: false, disabled: true }
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return view(cache.data)
    const persisted = readPersisted()
    if (!force && persisted && Date.now() - Number(persisted.at || 0) < CACHE_MS) return view(persisted)
    const fresh = await refresh()
    if (fresh.ok) return fresh
    const fallback = view(persisted)
    return { ...fallback, error: fresh.error, reason: fresh.reason }
  }

  return { status, refresh }
}
