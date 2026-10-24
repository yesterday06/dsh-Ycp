/**
 * dsh-Ycp · 大肥鱼（能力层）—— 工具注册表。
 *
 * 骨架不变，能力挂上去：
 *   registerTool({ id, description, schema, run, hand? })
 *   registerHand({ id, name, description, risk? })
 *   registerAppearance({ id, name, description? })
 *
 * 规矩：
 *   - 工具必须有 id / description / schema / run，四样缺一样就注册失败；
 *   - id 不能重复，重复直接报错（不静默覆盖）；
 *   - 工具声明了 hand（browser / desktop / script / runCommand）时，调用前先查手权限，
 *     关着的手一律 permission 拒绝；
 *   - 参数只做最小校验（必填 + 基础类型），复杂校验交给工具自己。
 *
 * 这一层只负责"有什么、能不能用、怎么调"，不关心具体是浏览器还是脚本——那是 P11–P13 的手。
 */
import { checkHand } from '../organs/gate.js'

const TOOL_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i
const MAX_ID = 64

/** 内置的四条手（DESIGN §6.1）；真正能干什么由 P11–P13 的手模块补。 */
export const BUILTIN_HANDS = [
  { id: 'browser', name: '浏览器', description: '开网页、点东西、填表、截图', risk: '中' },
  { id: 'desktop', name: '桌面', description: '截屏 + 鼠标键盘，操作任何程序', risk: '高' },
  { id: 'script', name: '脚本', description: '读写自己家的文件、写小工具', risk: '低' },
  { id: 'runCommand', name: '跑命令', description: '执行系统命令', risk: '高' },
]

function checkId(id) {
  const value = String(id ?? '').trim()
  if (!value || value.length > MAX_ID) return null
  return TOOL_ID.test(value) ? value : null
}

/** 最小参数校验：必填项在不在、基础类型对不对。 */
export function validateArgs(schema, args) {
  const value = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') return { ok: true }
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (!(key in value)) return { ok: false, error: `缺少参数：${key}` }
  }
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  for (const [key, spec] of Object.entries(properties)) {
    if (!(key in value) || !spec || typeof spec !== 'object') continue
    const actual = value[key]
    if (spec.type === 'string' && typeof actual !== 'string') return { ok: false, error: `参数 ${key} 应该是字符串` }
    if (spec.type === 'boolean' && typeof actual !== 'boolean') return { ok: false, error: `参数 ${key} 应该是 true / false` }
    if (spec.type === 'number' && (typeof actual !== 'number' || !Number.isFinite(actual))) return { ok: false, error: `参数 ${key} 应该是数字` }
    if (spec.type === 'integer' && (!Number.isInteger(actual))) return { ok: false, error: `参数 ${key} 应该是整数` }
    if (spec.type === 'array' && !Array.isArray(actual)) return { ok: false, error: `参数 ${key} 应该是数组` }
  }
  return { ok: true }
}

/**
 * @param {{getSettings: () => object, log?: (message: string, extra?: object) => void}} options
 */
export function createRegistry({ getSettings, log } = {}) {
  const tools = new Map()
  const hands = new Map()
  const appearances = new Map()
  const settingsOf = typeof getSettings === 'function' ? getSettings : () => ({})

  for (const hand of BUILTIN_HANDS) hands.set(hand.id, { ...hand, builtin: true })

  function registerTool(spec) {
    if (!spec || typeof spec !== 'object') return { ok: false, error: '工具描述必须是对象' }
    const id = checkId(spec.id)
    if (!id) return { ok: false, error: '工具 id 不合法（字母开头，可含 . _ -，≤64 字）' }
    if (!String(spec.description ?? '').trim()) return { ok: false, error: '工具必须有 description' }
    if (!spec.schema || typeof spec.schema !== 'object') return { ok: false, error: '工具必须有 schema' }
    if (typeof spec.run !== 'function') return { ok: false, error: '工具必须有 run 函数' }
    if (tools.has(id)) return { ok: false, error: `工具 id 已存在：${id}` }
    if (spec.hand && !hands.has(spec.hand)) return { ok: false, error: `不认识的手：${spec.hand}` }
    if (spec.permission !== undefined && !String(spec.permission).trim()) {
      return { ok: false, error: 'permission 要是非空字符串' }
    }
    tools.set(id, {
      id,
      description: String(spec.description).trim(),
      schema: spec.schema,
      run: spec.run,
      hand: spec.hand ? String(spec.hand) : null,
      permission: spec.permission ? String(spec.permission).trim() : null,
    })
    log?.('注册工具', { id, hand: spec.hand ?? null })
    return { ok: true, id, dispose: () => tools.delete(id) }
  }

  function registerHand(spec) {
    const id = checkId(spec?.id)
    if (!id) return { ok: false, error: '手的 id 不合法' }
    if (!String(spec?.name ?? '').trim()) return { ok: false, error: '手必须有 name' }
    if (hands.has(id)) return { ok: false, error: `手 id 已存在：${id}` }
    hands.set(id, {
      id,
      name: String(spec.name).trim(),
      description: String(spec.description ?? '').trim(),
      risk: spec.risk ?? '未标注',
      builtin: false,
    })
    return { ok: true, id, dispose: () => hands.delete(id) }
  }

  function registerAppearance(spec) {
    const id = checkId(spec?.id)
    if (!id) return { ok: false, error: '外观 id 不合法' }
    if (!String(spec?.name ?? '').trim()) return { ok: false, error: '外观必须有 name' }
    if (appearances.has(id)) return { ok: false, error: `外观 id 已存在：${id}` }
    appearances.set(id, {
      id,
      name: String(spec.name).trim(),
      description: String(spec.description ?? '').trim(),
    })
    return { ok: true, id, dispose: () => appearances.delete(id) }
  }

  function listTools() {
    return [...tools.values()].map((tool) => ({
      id: tool.id,
      description: tool.description,
      hand: tool.hand,
      permission: tool.permission,
      schema: tool.schema,
    }))
  }

  function listHands() {
    const settings = settingsOf() ?? {}
    return [...hands.values()].map((hand) => ({
      ...hand,
      enabled: Boolean(settings.hands?.[hand.id]),
    }))
  }

  function listAppearances() {
    return [...appearances.values()]
  }

  /**
   * 调一个工具：查工具 → 查手权限 → 校验参数 → 执行。
   * @returns {Promise<{ok: boolean, result?: unknown, reason?: string, error?: string}>}
   */
  async function invoke(id, args = {}) {
    const tool = tools.get(String(id ?? ''))
    if (!tool) return { ok: false, reason: 'unknown-tool', error: `没有这个工具：${String(id)}` }

    if (tool.hand) {
      const permission = checkHand(settingsOf()?.hands, tool.hand)
      if (!permission.allow) {
        return { ok: false, reason: 'permission', error: permission.error }
      }
    }

    if (tool.permission) {
      const allowed = settingsOf()?.permissions?.[tool.permission] !== false
      if (!allowed) {
        return { ok: false, reason: 'permission', error: `「${tool.permission}」这个权限关着` }
      }
    }

    const checked = validateArgs(tool.schema, args)
    if (!checked.ok) return { ok: false, reason: 'bad-arguments', error: checked.error }

    try {
      const result = await tool.run(args, { settings: settingsOf() })
      return { ok: true, result }
    } catch (error) {
      log?.('工具执行失败', { id: tool.id, error: String(error?.message ?? error) })
      return { ok: false, reason: 'tool-error', error: String(error?.message ?? error) }
    }
  }

  return {
    registerTool,
    registerHand,
    registerAppearance,
    listTools,
    listHands,
    listAppearances,
    invoke,
    has: (id) => tools.has(String(id ?? '')),
  }
}
