/**
 * dsh-Ycp · 大肥鱼（外观层）—— 声音（P16）。
 *
 * 用 Windows 自带的 SAPI（System.Speech）做 TTS：
 *   - 列出系统音色（中文的通常是 Microsoft Huihui Desktop）；
 *   - 合成到 WAV 文件，面板用 <audio> 播——这就是"语音条"；
 *   - 语速/音调走 SSML prosody，音量走 SAPI Volume；
 *   - 「跟着人设走」：POST /voice/derive 读人设，
 *       有模型时让模型从已安装音色里挑一个并给语速/音调；
 *       没模型时用关键词兜底（软萌→偏高偏慢、嘴贫→偏快、凶→偏低）。
 *
 * 声音文件落在 状态\语音\，只留最近 50 个。
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLog, homePaths, loadPersona, loadSettings } from '../kernel/paths.js'

const SCRIPT_SOURCE = fileURLToPath(new URL('../../../assets/voice/tts.ps1', import.meta.url))
const MAX_KEEP = 50
const MAX_CHARS = 2000
const RUN_TIMEOUT_MS = 30_000

export const DEFAULT_SAMPLE = '你好呀，我是大肥鱼。今天食堂的番茄炒蛋三块钱一份，要不要一起去？'

export const DEFAULT_VOICE = {
  enabled: true,
  name: '',
  rate: 0,
  pitch: 0,
  volume: 100,
  autoSpeak: false,
}

function service(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

export function currentModel(ctx) {
  try {
    const selection = service(ctx, 'agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
  } catch {
    /* 服务未就绪 */
  }
  return null
}

function voicePaths() {
  const dir = join(homePaths().root, '状态', '语音')
  return { dir, script: join(dir, 'tts.ps1') }
}

function ensureScript() {
  const { dir, script } = voicePaths()
  mkdirSync(dir, { recursive: true })
  const sourceTime = statSync(SCRIPT_SOURCE).mtimeMs
  const copyTime = existsSync(script) ? statSync(script).mtimeMs : 0
  if (sourceTime > copyTime) copyFileSync(SCRIPT_SOURCE, script)
  return script
}

function run(payload) {
  return new Promise((resolve, reject) => {
    const script = ensureScript()
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', encoded],
      { timeout: RUN_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const text = String(stdout ?? '').trim()
        const line = text.split(/\r?\n/).filter(Boolean).pop() ?? ''
        let parsed = null
        try {
          parsed = JSON.parse(line)
        } catch {
          parsed = null
        }
        if (parsed?.ok === false) return reject(new Error(parsed.error || '语音合成失败'))
        if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 400)))
        if (!parsed) return reject(new Error(`语音脚本没有返回结果：${text.slice(0, 200)}`))
        resolve(parsed)
      },
    )
  })
}

/** 音色列表（缓存 5 分钟）。 */
let voiceCache = null
export async function listVoices() {
  if (voiceCache && Date.now() - voiceCache.at < 5 * 60 * 1000) return voiceCache.voices
  const result = await run({ action: 'list' })
  const voices = Array.isArray(result.voices) ? result.voices : []
  voiceCache = { at: Date.now(), voices }
  return voices
}

/** 挑一个能用的音色：设置里的 → 中文 → 第一个。 */
export function pickVoice(voices, wanted) {
  const list = Array.isArray(voices) ? voices : []
  if (!list.length) return ''
  const exact = list.find((voice) => voice.name === wanted)
  if (exact) return exact.name
  const zh = list.find((voice) => String(voice.culture).toLowerCase().startsWith('zh'))
  return zh ? zh.name : list[0].name
}

/** 清理旧语音文件，只留最近 MAX_KEEP 个。 */
function prune(dir) {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.wav'))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const item of files.slice(MAX_KEEP)) rmSync(join(dir, item.name), { force: true })
  } catch {
    /* 清理失败不影响合成 */
  }
}

export function createVoice({ ctx } = {}) {
  function settingsOf() {
    return loadSettings().voice ?? { ...DEFAULT_VOICE }
  }

  function withDefaults(value) {
    return { ...DEFAULT_VOICE, ...(value && typeof value === 'object' ? value : {}) }
  }

  async function synth(text, overrides = {}) {
    const settings = withDefaults(settingsOf())
    const merged = { ...settings, ...overrides }
    const body = String(text ?? '').trim()
    if (!body) throw new Error('要读什么？')
    if (body.length > MAX_CHARS) throw new Error(`一次最多读 ${MAX_CHARS} 字`)
    const voices = await listVoices()
    const voice = pickVoice(voices, merged.name)
    const { dir } = voicePaths()
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
    const file = join(dir, `voice-${stamp}.wav`)
    const result = await run({
      action: 'speak',
      text: body,
      voice,
      rate: Number(merged.rate) || 0,
      pitch: Number(merged.pitch) || 0,
      volume: Math.max(0, Math.min(100, Number(merged.volume) ?? 100)),
      out: file,
    })
    prune(dir)
    appendLog('合成语音', { chars: body.length, bytes: result.bytes, voice })
    return {
      file,
      name: basename(file),
      url: `/api/dsh-Ycp/voice/file/${basename(file)}`,
      bytes: result.bytes,
      ms: result.ms,
      voice,
    }
  }

  /** 按人设给一套声音参数：优先让模型挑，没模型就关键词兜底。 */
  async function derive() {
    const persona = loadPersona()
    const voices = await listVoices()
    const current = withDefaults(settingsOf())
    const fallback = heuristic(persona, voices)
    const llm = service(ctx, 'llm')
    const model = currentModel(ctx)
    if (!llm || typeof llm.stream !== 'function' || !model) {
      return { ...fallback, why: `${fallback.why}（没有可用模型，按关键词猜的）`, source: 'heuristic' }
    }
    try {
      const list = voices.map((voice) => `${voice.name}（${voice.culture}，${voice.gender}）`).join('\n')
      const pieces = []
      const stream = llm.stream({
        provider: model.provider,
        model: model.model,
        system: '你只输出一个 JSON，不要解释、不要代码块。',
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text: [
              '下面是一份角色人设，请替她挑一个说话的声音。',
              '',
              '【人设】',
              persona.slice(0, 3000),
              '',
              '【可用音色】',
              list,
              '',
              '从里面挑一个最贴人设的，并给语速（-10 到 10，0 是正常）、音调（-30 到 30，正数偏高）。',
              '只回：{"voice":"音色全名","rate":0,"pitch":0,"why":"一句话"}',
            ].join('\n'),
          }],
        }],
        temperature: 0.3,
        sessionId: 'dsh-Ycp',
        signal: AbortSignal.timeout(30_000),
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') pieces.push(chunk.text)
      }
      const parsed = parseJson(pieces.join(''))
      if (parsed && typeof parsed.voice === 'string') {
        const matched = voices.find((voice) => voice.name === parsed.voice)
        if (matched) {
          return {
            name: matched.name,
            rate: clampInt(parsed.rate, -10, 10, 0),
            pitch: clampInt(parsed.pitch, -30, 30, 0),
            why: String(parsed.why ?? '按人设挑的').slice(0, 100),
            source: 'model',
          }
        }
      }
    } catch (error) {
      appendLog('按人设配声音失败', { error: String(error?.message ?? error) })
    }
    return { ...fallback, why: `${fallback.why}（模型这次没挑出来，按关键词猜的）`, source: 'heuristic' }
  }

  return { synth, derive, listVoices, settingsOf }
}

function clampInt(value, lo, hi, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(number)))
}

/** 关键词兜底：软萌偏高偏慢，嘴贫偏快，凶/冷偏低。 */
export function heuristic(persona, voices) {
  const text = String(persona ?? '')
  const zh = (Array.isArray(voices) ? voices : []).find((voice) => String(voice.culture).toLowerCase().startsWith('zh'))
  const male = /(男|他\b|小子|汉子)/.test(text)
  const maleVoice = (Array.isArray(voices) ? voices : []).find((voice) => voice.gender === 'Male')
  let rate = 0
  let pitch = 0
  let why = '按关键词估的'
  if (/(软|奶|萌|可爱|撒娇)/.test(text)) { pitch += 10; rate -= 2; why = '人设偏软萌：音调高一点、慢一点' }
  if (/(嘴贫|活泼|快|吵|跳脱)/.test(text)) { rate += 2; why = '人设偏活泼：语速快一点' }
  if (/(安静|慢|困|懒|蔫)/.test(text)) { rate -= 3; why = '人设偏安静：语速慢一点' }
  if (/(凶|冷|低|沙哑|沉稳)/.test(text)) { pitch -= 8; why = '人设偏冷：音调低一点' }
  const name = male && maleVoice ? maleVoice.name : (zh ? zh.name : '')
  return { name, rate, pitch, why }
}

export function parseJson(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}
