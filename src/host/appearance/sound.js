/**
 * dsh-Ycp · 大肥鱼（外观层）—— 音效（P17）。
 *
 * 五个短音，全部用代码生成 WAV（22050Hz / 16bit / 单声道），不下载素材、不依赖库：
 *   click 点击 / speak 说话 / sleep 睡觉 / eat 吃饭 / low 低余额
 *
 * 文件落在 状态\音效\，按"版本号"判断要不要重生成（改配方就 +1）。
 * 面板用 <audio> 播；桌宠拿同一个 click.wav 的 file:// 地址自己播。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homePaths } from '../kernel/paths.js'

const SAMPLE_RATE = 22050
const RECIPE_VERSION = 1

export const SOUND_EVENTS = [
  { id: 'click', label: '点击', recipe: [{ freq: 880, ms: 60, volume: 0.5 }] },
  { id: 'speak', label: '说话', recipe: [{ freq: 520, to: 620, ms: 130, volume: 0.4 }] },
  { id: 'sleep', label: '睡觉', recipe: [{ freq: 320, to: 200, ms: 520, volume: 0.35 }] },
  { id: 'eat', label: '吃饭', recipe: [{ freq: 700, ms: 70, volume: 0.45 }, { freq: 940, ms: 70, volume: 0.45, gap: 50 }] },
  { id: 'low', label: '低余额', recipe: [{ freq: 260, ms: 420, volume: 0.4, tremolo: 12 }] },
]

export function soundDir() {
  return join(homePaths().root, '状态', '音效')
}

function envelope(index, total) {
  // 20ms 淡入，后 60% 指数淡出，避免爆音
  const fadeIn = Math.min(1, index / (SAMPLE_RATE * 0.02))
  const progress = index / total
  const fadeOut = progress < 0.4 ? 1 : Math.max(0, 1 - (progress - 0.4) / 0.6)
  return fadeIn * fadeOut * fadeOut
}

function renderRecipe(recipe) {
  const chunks = []
  for (const note of recipe) {
    const total = Math.floor((SAMPLE_RATE * note.ms) / 1000)
    const from = note.freq
    const to = note.to ?? note.freq
    const data = Buffer.alloc(total * 2)
    for (let i = 0; i < total; i++) {
      const t = i / SAMPLE_RATE
      const freq = from + (to - from) * (i / total)
      let value = Math.sin(2 * Math.PI * freq * t)
      if (note.tremolo) value *= 0.75 + 0.25 * Math.sin(2 * Math.PI * note.tremolo * t)
      const sample = Math.max(-1, Math.min(1, value * (note.volume ?? 0.4) * envelope(i, total)))
      data.writeInt16LE(Math.round(sample * 32767), i * 2)
    }
    chunks.push(data)
    if (note.gap) chunks.push(Buffer.alloc(Math.floor((SAMPLE_RATE * note.gap) / 1000) * 2))
  }
  return Buffer.concat(chunks)
}

export function wavFromPcm(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 生成/补齐音效文件；配方版本变了就重生成。 */
export function ensureSounds() {
  const dir = soundDir()
  mkdirSync(dir, { recursive: true })
  const marker = join(dir, '.version')
  let current = 0
  try {
    current = Number(readFileSync(marker, 'utf8').trim()) || 0
  } catch {
    current = 0
  }
  const files = []
  for (const event of SOUND_EVENTS) {
    const file = join(dir, `${event.id}.wav`)
    if (current !== RECIPE_VERSION || !existsSync(file)) {
      writeFileSync(file, wavFromPcm(renderRecipe(event.recipe)))
    }
    files.push({ ...event, file, bytes: statSync(file).size })
  }
  if (current !== RECIPE_VERSION) writeFileSync(marker, String(RECIPE_VERSION), 'utf8')
  return files
}

export function soundStatus(settings) {
  let files = []
  try {
    files = ensureSounds()
  } catch {
    files = []
  }
  const sound = settings?.sound ?? { enabled: true, volume: 40 }
  return {
    enabled: Boolean(sound.enabled),
    volume: Number(sound.volume) || 0,
    events: files.map((event) => ({
      id: event.id,
      label: event.label,
      bytes: event.bytes,
      url: `/api/dsh-Ycp/sound/file/${event.id}.wav`,
    })),
  }
}

/** 给桌宠用的本地 file URL（Electron 页面是 file://，直接播本地文件）。 */
export function clickSoundFile() {
  try {
    ensureSounds()
    return join(soundDir(), 'click.wav')
  } catch {
    return null
  }
}
