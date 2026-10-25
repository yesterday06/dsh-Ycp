/**
 * dsh-Ycp · 工具注册表（纯记忆时代）
 *
 * 0.2.0 起能力层整层移除：没有浏览器、桌面、脚本、平台这些「手」。
 * 这里只挂她自己能用的小工具——记忆、日记、成长、名字、签名、作息、主动性。
 * 骨架保留，以后重做能力层时再往这里接。
 */
const TOOL_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i
const MAX_ID = 64

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
    if (spec.type === 'integer' && !Number.isInteger(actual)) return { ok: false, error: `参数 ${key} 应该是整数` }
    if (spec.type === 'array' && !Array.isArray(actual)) return { ok: false, error: `参数 ${key} 应该是数组` }
  }
  return { ok: true }
}

export function createRegistry({ getSettings, log } = {}) {
  const tools = new Map()
  const settingsOf = typeof getSettings === 'function' ? getSettings : () => ({})

  function registerTool(spec) {
    if (!spec || typeof spec !== 'object') return { ok: false, error: '工具描述必须是对象' }
    const id = checkId(spec.id)
    if (!id) return { ok: false, error: '工具 id 不合法（字母开头，可含 . _ -，≤64 字）' }
    if (!String(spec.description ?? '').trim()) return { ok: false, error: '工具必须有 description' }
    if (!spec.schema || typeof spec.schema !== 'object') return { ok: false, error: '工具必须有 schema' }
    if (typeof spec.run !== 'function') return { ok: false, error: '工具必须有 run 函数' }
    if (tools.has(id)) return { ok: false, error: `工具 id 已存在：${id}` }
    tools.set(id, {
      id,
      description: String(spec.description).trim(),
      schema: spec.schema,
      run: spec.run,
    })
    log?.('注册工具', { id })
    return { ok: true, id, dispose: () => tools.delete(id) }
  }

  function listTools() {
    return [...tools.values()].map((tool) => ({
      id: tool.id,
      description: tool.description,
      schema: tool.schema,
    }))
  }

  /**
   * 调一个工具：查工具 → 校验参数 → 执行。
   * @returns {Promise<{ok: boolean, result?: unknown, reason?: string, error?: string}>}
   */
  async function invoke(id, args = {}) {
    const tool = tools.get(String(id ?? ''))
    if (!tool) return { ok: false, reason: 'unknown-tool', error: `没有这个工具：${String(id)}` }
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
    listTools,
    invoke,
    has: (id) => tools.has(String(id ?? '')),
  }
}
