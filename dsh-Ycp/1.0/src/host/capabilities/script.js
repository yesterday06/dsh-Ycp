/**
 * dsh-Ycp · 大肥鱼（能力层）—— 脚本之手（P13）。
 *
 * 她能读写自己家的文件、写小工具、跑小工具。
 * 边界：
 *   - 所有路径都相对「大肥鱼」家目录，绝对路径和 .. 越界一律拒；
 *   - 写文件前若已存在，先备份到 状态\backups\；
 *   - fs.* 和 script.* 归 script 这条手（默认开）；
 *   - cmd.run 归 runCommand 这条手（默认关），开了也强制 cwd 在家目录，并挡掉常见越界写法。
 *
 * 「护栏不是沙箱」：runCommand 仍然是本机 shell，真正的边界是主人开不开这条手。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { homePaths, writeAtomic, backupFile } from '../kernel/paths.js'

const MAX_READ = 100 * 1024
const MAX_WRITE = 256 * 1024
const MAX_ENTRIES = 200
const RUN_TIMEOUT_MS = 20_000
const MAX_OUTPUT = 1024 * 1024

function inside(home, target) {
  const rel = relative(home, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 把用户给的相对路径钉在家目录里。 */
export function resolveInside(home, input) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('路径不能为空')
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) {
    throw new Error('只接受家目录里的相对路径，不要给绝对路径')
  }
  const target = resolve(home, raw)
  if (!inside(home, target)) throw new Error('不能跑到家目录外面')
  return target
}

/** 脚本文件名：只留安全字符。 */
export function safeScriptName(input) {
  return String(input ?? '')
    .trim()
    .replace(/\.(mjs|js|ps1|cmd|bat)$/i, '')
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function runProcess(file, args, cwd, timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now()
    execFile(file, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, YCP_HOME: homePaths().root },
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error?.code ?? 0,
        killed: Boolean(error?.killed),
        stdout: String(stdout ?? '').trim().slice(0, MAX_OUTPUT),
        stderr: String(stderr ?? '').trim().slice(0, MAX_OUTPUT),
        error: error ? String(error.message ?? error).slice(0, 500) : null,
        ms: Date.now() - started,
      })
    })
  })
}

export function createScriptHand(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({})
  const log = typeof options.log === 'function' ? options.log : () => {}

  function home() {
    const root = homePaths().root
    mkdirSync(root, { recursive: true })
    return root
  }

  function scriptsDir() {
    const dir = join(home(), '扩展', '脚本')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  async function read({ path, maxChars }) {
    const file = resolveInside(home(), path)
    if (!existsSync(file)) throw new Error(`文件不存在：${String(path)}`)
    const info = statSync(file)
    if (info.isDirectory()) throw new Error('这是一个目录，用 fs.list 看里面')
    const limit = Math.min(MAX_READ, Math.max(1, Number(maxChars) || MAX_READ))
    const raw = readFileSync(file, 'utf8')
    const content = raw.length > limit ? raw.slice(0, limit) : raw
    log('脚本手读文件', { path: String(path), chars: content.length })
    return { path: String(path), chars: raw.length, truncated: raw.length > limit, content }
  }

  async function write({ path, content }) {
    const target = resolveInside(home(), path)
    const text = String(content ?? '')
    if (text.length > MAX_WRITE) throw new Error(`一次最多写 ${MAX_WRITE} 字`)
    if (existsSync(target) && statSync(target).isDirectory()) throw new Error('目标是目录，不能当文件写')
    const backup = existsSync(target) ? backupFile(target) : null
    writeAtomic(target, text)
    log('脚本手写文件', { path: String(path), chars: text.length, backup: backup ? basename(backup) : null })
    return { path: String(path), chars: text.length, backup: backup ? basename(backup) : null }
  }

  async function list({ path, maxEntries }) {
    const dir = resolveInside(home(), path || '.')
    if (!existsSync(dir)) throw new Error(`目录不存在：${String(path ?? '.')}`)
    if (!statSync(dir).isDirectory()) throw new Error('这不是目录')
    const limit = Math.min(MAX_ENTRIES, Math.max(1, Number(maxEntries) || MAX_ENTRIES))
    const entries = readdirSync(dir).slice(0, limit).map((name) => {
      const full = join(dir, name)
      let info = null
      try { info = statSync(full) } catch { info = null }
      return {
        name,
        type: info?.isDirectory() ? 'dir' : 'file',
        bytes: info?.isFile() ? info.size : 0,
      }
    })
    const total = readdirSync(dir).length
    return { path: String(path ?? '.'), entries, total, truncated: total > limit }
  }

  /** 写一段脚本并运行；成功后留在 扩展\脚本\ 复用。 */
  async function run({ code, name }) {
    const source = String(code ?? '')
    if (!source.trim()) throw new Error('脚本内容不能为空')
    if (source.length > 64 * 1024) throw new Error('脚本太长（上限 64KB）')
    const dir = scriptsDir()
    const safe = name ? safeScriptName(name) : ''
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
    const fileName = `${safe || `auto-${stamp}`}.mjs`
    const file = join(dir, fileName)
    writeAtomic(file, source.endsWith('\n') ? source : `${source}\n`)
    const result = await runProcess(process.execPath, [file], home())
    if (!result.ok) {
      log('脚本手运行失败', { file: fileName, error: result.error })
      return { ...result, file: relative(home(), file), kept: false }
    }
    log('脚本手运行成功', { file: fileName, ms: result.ms })
    return { ...result, file: relative(home(), file), kept: true }
  }

  /** 跑一条系统命令：默认关；开了也强制在家目录里跑，并挡掉常见越界写法。 */
  async function command({ command, timeoutMs }) {
    const text = String(command ?? '').trim()
    if (!text) throw new Error('命令不能为空')
    const denied = [
      /\.\./, /[a-zA-Z]:[\\/]/, /^\\\\/, /\bcd\s+\.\./, /\bpushd\b/i, /\bstart\b/i, /\brunas\b/i,
      /%USERPROFILE%/i, /%APPDATA%/i, /%SYSTEMROOT%/i, /\$env:/i, /\bdel\b/i, /\brmdir\b/i, /\bformat\b/i,
    ]
    if (denied.some((rule) => rule.test(text))) {
      throw new Error('这条命令带了越界写法（绝对路径 / 上级目录 / 系统目录 / 危险动作），在家目录里只跑简单命令')
    }
    const limit = Math.min(RUN_TIMEOUT_MS, Math.max(1000, Number(timeoutMs) || RUN_TIMEOUT_MS))
    const result = await runProcess('cmd.exe', ['/d', '/s', '/c', text], home(), limit)
    log('脚本手跑命令', { command: text.slice(0, 80), ok: result.ok })
    return result
  }

  return { read, write, list, run, command, paths: { home, scriptsDir } }
}

/** 挂进注册表。 */
export function installScriptTools(registry, hand) {
  const tools = [
    {
      id: 'fs.read',
      description: '读自己家里的一个文本文件（家目录相对路径）',
      hand: 'script',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, maxChars: { type: 'integer' } },
        required: ['path'],
      },
      run: async ({ path, maxChars }) => hand.read({ path, maxChars }),
    },
    {
      id: 'fs.write',
      description: '写自己家里的一个文本文件（家目录相对路径；覆盖前自动备份）',
      hand: 'script',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      run: async ({ path, content }) => hand.write({ path, content }),
    },
    {
      id: 'fs.list',
      description: '列自己家里某个目录（默认家目录根）',
      hand: 'script',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, maxEntries: { type: 'integer' } },
        required: [],
      },
      run: async ({ path, maxEntries }) => hand.list({ path, maxEntries }),
    },
    {
      id: 'script.run',
      description: '写一段 Node 脚本并运行（cwd 是家目录）；成功的脚本留在 扩展\\脚本\\',
      hand: 'script',
      schema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Node ESM 脚本内容' },
          name: { type: 'string', description: '可选：脚本名，方便以后复用' },
        },
        required: ['code'],
      },
      run: async ({ code, name }) => hand.run({ code, name }),
    },
    {
      id: 'cmd.run',
      description: '跑一条简单系统命令（默认关；只在家目录里跑，越界写法会被拒）',
      hand: 'runCommand',
      schema: {
        type: 'object',
        properties: { command: { type: 'string' }, timeoutMs: { type: 'integer' } },
        required: ['command'],
      },
      run: async ({ command, timeoutMs }) => hand.command({ command, timeoutMs }),
    },
  ]

  for (const tool of tools) {
    const result = registry.registerTool(tool)
    if (!result.ok) throw new Error(`注册 ${tool.id} 失败：${result.error}`)
  }
}
