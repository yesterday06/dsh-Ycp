/**
 * dsh-Ycp · 大肥鱼（器官）—— 记账。
 *
 * 只记她自己家里的账：<家>\状态\记账.json。
 * 支持记一笔（支出/收入）、删一笔、月度预算、按类别统计；面板和桌宠共用。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths, writeAtomic } from '../kernel/paths.js'

export const LEDGER_CATEGORIES = ['吃饭', '交通', '购物', '学习', '娱乐', '房租', '人情', '其他']

export const TOKEN_PRICE_PER_M = Number(process.env.YCP_TOKEN_PRICE_PER_M) || 4
export const DEFAULT_TOKEN_BUDGET = { daily: 200000, monthly: 4000000 }

function ledgerFile() {
  return join(homePaths().root, '状态', '记账.json')
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

function normalizeEntry(input, now) {
  const amount = Number(input?.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额要大于 0')
  const type = input?.type === 'income' ? 'income' : 'expense'
  const category = LEDGER_CATEGORIES.includes(input?.category) ? input.category : '其他'
  const at = input?.at ? new Date(input.at) : now
  if (Number.isNaN(at.getTime())) throw new Error('时间不对')
  return {
    id: `${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type,
    amount: Math.round(amount * 100) / 100,
    category,
    note: String(input?.note ?? '').slice(0, 80),
    at: at.toISOString(),
  }
}

export function createLedger() {
  function load() {
    try {
      const data = JSON.parse(readFileSync(ledgerFile(), 'utf8').replace(/^\uFEFF/, ''))
      return {
        entries: Array.isArray(data.entries) ? data.entries : [],
        budget: Number(data.budget) > 0 ? Number(data.budget) : 1500,
        dailyBudget: Number(data.dailyBudget) > 0 ? Number(data.dailyBudget) : DEFAULT_TOKEN_BUDGET.daily,
        monthlyBudget: Number(data.monthlyBudget) > 0 ? Number(data.monthlyBudget) : DEFAULT_TOKEN_BUDGET.monthly,
      }
    } catch {
      return { entries: [], budget: 1500, dailyBudget: DEFAULT_TOKEN_BUDGET.daily, monthlyBudget: DEFAULT_TOKEN_BUDGET.monthly }
    }
  }

  function save(data) {
    writeAtomic(ledgerFile(), JSON.stringify(data, null, 2) + '\n')
  }

  function add(input, now = new Date()) {
    const entry = normalizeEntry(input, now)
    const data = load()
    data.entries.push(entry)
    if (data.entries.length > 5000) data.entries = data.entries.slice(-5000)
    save(data)
    appendLog('记了一笔账', { type: entry.type, amount: entry.amount, category: entry.category })
    return entry
  }

  function addMeal(tokens, note = '聊天') {
    const value = Math.max(0, Math.round(Number(tokens) || 0))
    if (!value) return null
    const data = load()
    const entry = { id: 'meal-' + Date.now().toString(36), type: 'meal', tokens: value, category: '饭', note: String(note).slice(0, 40), at: new Date().toISOString() }
    data.entries.push(entry)
    save(data)
    return entry
  }

  function addToken(input, now = new Date()) {
    const tokens = Math.max(0, Math.round(Number(input?.tokens) || 0))
    if (!tokens) return null
    const data = load()
    const entry = {
      id: 'tok-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 5),
      type: 'token',
      tokens,
      kind: String(input?.kind || 'chat').slice(0, 20),
      note: String(input?.note || '').slice(0, 60),
      model: String(input?.model || '').slice(0, 40),
      at: now.toISOString(),
    }
    data.entries.push(entry)
    const cost = Math.round((tokens / 1e6) * TOKEN_PRICE_PER_M * 100) / 100
    if (cost > 0) {
      data.entries.push({
        id: 'cny-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 5),
        type: 'expense',
        amount: cost,
        category: 'token',
        note: 'token 折算',
        source: 'token',
        at: now.toISOString(),
      })
    }
    if (data.entries.length > 5000) data.entries = data.entries.slice(-5000)
    save(data)
    return entry
  }

  function addTokenIncome(input, now = new Date()) {
    const tokens = Math.max(0, Math.round(Number(input?.tokens) || 0))
    if (!tokens) return null
    const data = load()
    const entry = {
      id: 'in-' + now.getTime().toString(36),
      type: 'token-income',
      tokens,
      kind: 'income',
      note: String(input?.note || '自己挣的').slice(0, 60),
      at: now.toISOString(),
    }
    data.entries.push(entry)
    save(data)
    return entry
  }

  function setTokenBudget(input) {
    const data = load()
    if (Number(input?.daily) > 0) data.dailyBudget = Math.round(Number(input.daily))
    if (Number(input?.monthly) > 0) data.monthlyBudget = Math.round(Number(input.monthly))
    save(data)
    return { daily: data.dailyBudget, monthly: data.monthlyBudget }
  }
  function remove(id) {
    const data = load()
    const before = data.entries.length
    data.entries = data.entries.filter((entry) => entry.id !== String(id))
    if (data.entries.length === before) return false
    save(data)
    return true
  }

  function setBudget(amount) {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) throw new Error('预算要大于 0')
    const data = load()
    data.budget = Math.round(value * 100) / 100
    save(data)
    return data.budget
  }

  function summary(now = new Date()) {
    const data = load()
    const today = dayKey(now)
    const month = monthKey(now)
    let todayExpense = 0
    let todayIncome = 0
    let monthExpense = 0
    let monthIncome = 0
    let todayTokens = 0
    let monthTokens = 0
    let todayIncomeTokens = 0
    let monthIncomeTokens = 0
    let totalTokens = 0
    let totalIncomeTokens = 0
    const byCategory = {}
    const recent = []
    for (const entry of data.entries) {
      const at = new Date(entry.at)
      if (Number.isNaN(at.getTime())) continue
      if (entry.type === 'meal' || entry.type === 'token') {
        const tokens = Number(entry.tokens) || 0
        totalTokens += tokens
        if (dayKey(at) === today) todayTokens += tokens
        if (monthKey(at) === month) monthTokens += tokens
        recent.push(entry)
        continue
      }
      if (entry.type === 'token-income') {
        const tokens = Number(entry.tokens) || 0
        totalIncomeTokens += tokens
        if (dayKey(at) === today) todayIncomeTokens += tokens
        if (monthKey(at) === month) monthIncomeTokens += tokens
        recent.push(entry)
        continue
      }
      const amount = Number(entry.amount) || 0
      if (dayKey(at) === today) {
        if (entry.type === 'income') todayIncome += amount
        else todayExpense += amount
      }
      if (monthKey(at) === month) {
        if (entry.type === 'income') monthIncome += amount
        else {
          monthExpense += amount
          byCategory[entry.category] = (byCategory[entry.category] || 0) + amount
        }
      }
      recent.push(entry)
    }
    recent.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const budget = data.budget
    const remaining = Math.round((budget - monthExpense) * 100) / 100
    return {
      todayTokens: Math.round(todayTokens),
      monthTokens: Math.round(monthTokens),
      todayIncomeTokens: Math.round(todayIncomeTokens),
      monthIncomeTokens: Math.round(monthIncomeTokens),
      totalTokens: Math.round(totalTokens),
      totalIncomeTokens: Math.round(totalIncomeTokens),
      totalCost: Math.round((totalTokens / 1e6) * TOKEN_PRICE_PER_M * 100) / 100,
      totalIncomeCost: Math.round((totalIncomeTokens / 1e6) * TOKEN_PRICE_PER_M * 100) / 100,
      todayCost: Math.round((todayTokens / 1e6) * TOKEN_PRICE_PER_M * 100) / 100,
      monthCost: Math.round((monthTokens / 1e6) * TOKEN_PRICE_PER_M * 100) / 100,
      incomeCost: Math.round((monthIncomeTokens / 1e6) * TOKEN_PRICE_PER_M * 100) / 100,
      dailyBudget: data.dailyBudget,
      monthlyBudget: data.monthlyBudget,
      remainingDaily: Math.round(data.dailyBudget - todayTokens),
      remainingMonthly: Math.round(data.monthlyBudget - monthTokens),
      percentDaily: data.dailyBudget > 0 ? Math.min(100, Math.round((todayTokens / data.dailyBudget) * 100)) : 0,
      todayExpense: Math.round(todayExpense * 100) / 100,
      todayIncome: Math.round(todayIncome * 100) / 100,
      monthExpense: Math.round(monthExpense * 100) / 100,
      monthIncome: Math.round(monthIncome * 100) / 100,
      budget,
      remaining,
      percent: budget > 0 ? Math.min(100, Math.round((monthExpense / budget) * 100)) : 0,
      byCategory: Object.entries(byCategory)
        .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount),
      recent: recent.slice(0, 8),
      categories: LEDGER_CATEGORIES,
    }
  }

  return { add, addMeal, addToken, addTokenIncome, remove, setBudget, setTokenBudget, summary, categories: LEDGER_CATEGORIES }
}
