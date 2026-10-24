/**
 * dsh-Ycp · 大肥鱼（器官）—— 自主解决（P14）。
 *
 * 遇到一件事：
 *   看（有哪些工具）→ 想（模型给一个计划）→ 试（调工具）→ 记（成功记方法 / 失败记"此路不通"）
 *   → 换办法，最多 3 次。
 * 3 次都不行：写一条「我卡住了」，面板弹出来，等人搭手。
 *
 * 三道刹车（DESIGN §7）：3 次硬上限 / 每轮写日志 / 失败也进记忆。
 * 这里只决定"试什么"，真正动手还是走注册表，手权限与白名单照样生效。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, homePaths, loadPersona, loadSettings, stamp, writeAtomic } from '../kernel/paths.js'
import { writeCard } from './memory.js'
import { buildSystem } from '../kernel/prompt.js'

export const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 60_000

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

/** 流没有正文时，把终止原因翻成人话。 */
function noTextReason(finish) {
  const { kind, failure } = finish ?? {}
  if (kind === 'aborted') return '等太久了，没想出办法'
  if (kind === 'max-tokens') return '想太长了，没给出结论'
  if (kind !== 'error') return '模型没给出可执行的计划'
  return failure?.message || failure?.code || '模型报错'
}

/** 从模型输出里抠出计划 JSON；抠不出来返回 null。 */
export function parsePlan(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let value
  try {
    value = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.giveUp === true) return { giveUp: true, reason: String(value.reason ?? '想不出办法') }
  const tool = String(value.tool ?? '').trim()
  if (!tool) return null
  const args = value.args && typeof value.args === 'object' && !Array.isArray(value.args) ? value.args : {}
  return { tool, args, why: String(value.why ?? '').slice(0, 200) }
}

export function autonomyPaths() {
  const dir = join(homePaths().root, '状态', '自主')
  return { dir, stuck: join(dir, '求助.json'), runs: join(dir, '日志.json') }
}

export function createAutonomy({ ctx, registry, getSettings = loadSettings }) {
  function loadState() {
    const { stuck, runs } = autonomyPaths()
    const read = (file) => {
      if (!existsSync(file)) return null
      try {
        return JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        return null
      }
    }
    return {
      stuck: read(stuck)?.pending ?? null,
      history: Array.isArray(read(runs)?.runs) ? read(runs).runs : [],
    }
  }

  function saveState(state) {
    const { stuck, runs } = autonomyPaths()
    writeAtomic(stuck, JSON.stringify({ pending: state.stuck ?? null }, null, 2) + '\n')
    writeAtomic(runs, JSON.stringify({ runs: (state.history ?? []).slice(-20) }, null, 2) + '\n')
  }

  async function think(goal, attempts, tools) {
    const llm = service(ctx, 'llm')
    const model = currentModel(ctx)
    if (!llm || typeof llm.stream !== 'function') throw new Error('LLM 服务不可用')
    if (!model) throw new Error('当前对话还没选模型')
    const settings = getSettings()
    const toolLines = tools.map((tool) => `- ${tool.id}：${tool.description}${tool.hand ? `（手：${tool.hand}）` : ''}`).join('\n')
    const tried = attempts.length
      ? attempts.map((item, index) => `${index + 1}) ${item.tool} ${JSON.stringify(item.args)} → 失败：${item.error}`).join('\n')
      : '（还没试过）'
    const system = buildSystem({
      persona: loadPersona(),
      name: settings.name,
      now: new Date(),
      extra: [
        '【你在自己解决问题】先想清楚，再挑一个工具去试。',
        `最多试 ${MAX_ATTEMPTS} 次；失败要换办法，不要重复同一个动作。`,
        '只输出一个 JSON，不要解释、不要代码块：',
        '{"tool":"工具id","args":{...},"why":"一句话"}',
        '如果判断这件事根本做不了，输出：{"giveUp":true,"reason":"为什么做不了"}',
      ].join('\n'),
    })
    const userText = [
      `目标：${goal}`,
      '',
      '可用的工具：',
      toolLines || '（一个都没有）',
      '',
      '已经试过：',
      tried,
    ].join('\n')

    const pieces = []
    let finish = null
    const stream = llm.stream({
      provider: model.provider,
      model: model.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      temperature: 0.6,
      sessionId: 'dsh-Ycp',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') pieces.push(chunk.text)
      else if (chunk?.type === 'finish') finish = chunk.reason ?? null
    }
    const text = pieces.join('').trim()
    if (!text) throw new Error(noTextReason(finish))
    return parsePlan(text)
  }

  function rememberFailure(goal, attempts) {
    const file = `此路不通-${stamp()}.md`
    const lines = [
      '---',
      `name: 此路不通 ${stamp()}`,
      'description: 试过但没走通的办法，别再重复',
      'tags: [此路不通, 自主解决]',
      '---',
      '',
      `# 此路不通：${goal}`,
      '',
      ...attempts.map((item, index) => `${index + 1}. ${item.tool} ${JSON.stringify(item.args)} → ${item.error}`),
      '',
    ]
    try {
      writeCard('global', file, lines.join('\n'))
    } catch (error) {
      appendLog('记下此路不通失败', { error: String(error?.message ?? error) })
    }
  }

  /**
   * 解决一件事：最多试 MAX_ATTEMPTS 次。
   * @param {string} goal
   * @returns {Promise<object>}
   */
  async function solve(goal) {
    const target = String(goal ?? '').trim()
    if (!target) return { ok: false, error: '要解决什么？' }
    const tools = registry.listTools()
    const attempts = []
    const started = Date.now()

    for (let round = 1; round <= MAX_ATTEMPTS; round++) {
      let plan
      try {
        plan = await think(target, attempts, tools)
      } catch (error) {
        const message = String(error?.message ?? error)
        attempts.push({ round, tool: '（想不出）', args: {}, error: message })
        appendLog('自主解决：思考失败', { round, error: message })
        break
      }
      if (!plan || plan.giveUp) {
        attempts.push({ round, tool: '（放弃）', args: {}, error: plan?.reason ?? '模型没给出可执行的计划' })
        appendLog('自主解决：主动放弃', { round, reason: plan?.reason ?? null })
        break
      }

      const result = await registry.invoke(plan.tool, plan.args)
      const ok = Boolean(result.ok)
      attempts.push({
        round,
        tool: plan.tool,
        args: plan.args,
        why: plan.why,
        ok,
        error: ok ? null : result.error ?? result.reason ?? '失败',
      })
      appendLog('自主解决：试了一次', { round, tool: plan.tool, ok })
      if (ok) {
        const state = loadState()
        const record = { at: Date.now(), goal: target, ok: true, attempts, ms: Date.now() - started }
        state.history = [...state.history, record]
        saveState(state)
        return { ok: true, goal: target, attempts, result: result.result, ms: record.ms }
      }
    }

    const realAttempts = attempts.filter((item) => item.tool && !item.tool.startsWith('（'))
    if (realAttempts.length) rememberFailure(target, realAttempts)
    const stuck = {
      id: `s${Date.now().toString(36)}`,
      goal: target,
      at: Date.now(),
      attempts,
      reason: attempts[attempts.length - 1]?.error ?? '试了三次都不行',
    }
    const state = loadState()
    state.stuck = stuck
    state.history = [...state.history, { at: Date.now(), goal: target, ok: false, attempts, ms: Date.now() - started }]
    saveState(state)
    appendLog('自主解决：卡住了', { goal: target, attempts: attempts.length })
    return { ok: false, stuck: true, goal: target, attempts, stuckRequest: stuck }
  }

  function status() {
    const state = loadState()
    return {
      pending: state.stuck,
      recent: state.history.slice(-5).reverse().map((run) => ({
        at: run.at,
        goal: run.goal,
        ok: run.ok,
        rounds: Array.isArray(run.attempts) ? run.attempts.length : 0,
      })),
      maxAttempts: MAX_ATTEMPTS,
    }
  }

  function resolve() {
    const state = loadState()
    const had = Boolean(state.stuck)
    state.stuck = null
    saveState(state)
    if (had) appendLog('主人看到了求助', {})
    return { ok: true, cleared: had }
  }

  return { solve, status, resolve, maxAttempts: MAX_ATTEMPTS }
}

/** 挂进注册表：她自己可以主动调用"解决一件事"。 */
export function installAutonomyTool(registry, autonomy) {
  const result = registry.registerTool({
    id: 'self.solve',
    description: '遇到做不了的事时调用：自己想办法、试工具，最多 3 次；不行会记下来并求助',
    schema: {
      type: 'object',
      properties: { goal: { type: 'string', description: '要解决什么' } },
      required: ['goal'],
    },
    run: async ({ goal }) => autonomy.solve(goal),
  })
  if (!result.ok) throw new Error(`注册 self.solve 失败：${result.error}`)
}
