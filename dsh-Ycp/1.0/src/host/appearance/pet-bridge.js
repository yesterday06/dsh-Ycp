/**
 * dsh-Ycp · 大肥鱼（外观层）—— 桌宠对话桥。
 *
 * 桌宠是独立 Electron 进程，拿不到面板的登录 token，所以对话不走 HTTP：
 * 她在 状态\宠物\对话请求.json 里放一句话，宿主轮询处理，把回复和语音写到
 * 状态\宠物\对话回复.json。纯文件通道，重启面板也不用重新登录。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLog, homePaths } from '../kernel/paths.js'
import { todaySummary } from '../organs/mood.js'
import { loadSchedule } from '../organs/schedule.js'

const MEME_DIR = fileURLToPath(new URL('../../../assets/memes/', import.meta.url))
const MEME_RULES = [
  { test: /吃|饭|饿|token|食/, name: '吃白饭的大肥鱼.png' },
  { test: /余额|钱|token|额度|充值/, name: 'token给妈妈保管.png' },
  { test: /睡|困|累|晚安/, name: '深度睡眠.png' },
  { test: /可爱|喜欢|摸摸|贴贴/, name: '可爱.png' },
  { test: /完蛋|错|坏|崩|死/, name: '死掉了.png' },
  { test: /厉害|强|牛|佩服/, name: '厉害了我的鲸.png' },
  { test: /压力|忙|加班/, name: '压力一只大肥鱼.png' },
]

function leaveNote(text) {
  try {
    const desktop = join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop')
    if (!existsSync(desktop)) return null
    const file = join(desktop, '大肥鱼留言.txt')
    const line = `[${new Date().toLocaleString('zh-CN')}] ${text}\n`
    appendFileSync(file, line, 'utf8')
    return file
  } catch {
    return null
  }
}
function shouldAskTokens(ledger) {
  try {
    const summary = ledger.summary()
    if (!summary || summary.dailyBudget <= 0) return false
    if (summary.remainingDaily > summary.dailyBudget * 0.1) return false
    const marker = join(homePaths().root, '状态', '要饭.txt')
    const today = new Date().toISOString().slice(0, 10)
    if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === today) return false
    writeFileSync(marker, today + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}
function pickMeme(text) {
  try {
    if (!existsSync(MEME_DIR)) return null
    const files = readdirSync(MEME_DIR).filter((name) => name.endsWith('.png'))
    if (files.length === 0) return null
    for (const rule of MEME_RULES) {
      if (rule.test.test(text) && files.includes(rule.name)) return join(MEME_DIR, rule.name)
    }
    return join(MEME_DIR, files[Math.floor(Math.random() * files.length)])
  } catch {
    return null
  }
}
export function createPetBridge({ say, voice, ledger, intervalMs = 1200 } = {}) {
  let timer = null
  let busy = false

  function dir() {
    return join(homePaths().root, '状态', '宠物')
  }

  const requestFile = () => join(dir(), '对话请求.json')
  const replyFile = () => join(dir(), '对话回复.json')

  async function tick() {
    if (busy || !say || !existsSync(requestFile())) return
    busy = true
    let request = null
    try {
      request = JSON.parse(readFileSync(requestFile(), 'utf8').replace(/^\uFEFF/, ''))
    } catch { /* 读到半截就下次再来 */ }
    if (!request) { busy = false; return }
    try { rmSync(requestFile(), { force: true }) } catch { /* 下次覆盖 */ }
    const id = String(request.id || Date.now())

    if (request.kind === 'ledger') {
      const reply = { kind: 'ledger', ok: false, id, error: null, summary: null, categories: [] }
      try {
        if (request.action === 'add') ledger.add({ type: request.type, amount: request.amount, category: request.category, note: request.note })
        reply.summary = ledger.summary()
        reply.categories = ledger.categories
        reply.ok = true
      } catch (error) {
        reply.error = String(error?.message ?? error)
      }
      writeFileSync(replyFile(), JSON.stringify(reply, null, 2) + '\n', 'utf8')
      busy = false
      return
    }

    if (!request.text) { busy = false; return }

    const reply = { ok: false, id, text: '', voiceFile: null, error: null }
    try {
      const result = await Promise.race([
        say.say({ text: request.text }),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: '想太久了，先歇会儿' }), 60000)),
      ])
      if (result?.ok) {
        reply.ok = true
        reply.text = result.text
        reply.meme = pickMeme(result.text)
        if (shouldAskTokens(ledger)) {
          reply.text += '\n\n（小声）主人，今天的 token 快见底了，能不能再给我充一点…我还能干活。'
        }
        const tokens = Math.ceil((request.text.length + result.text.length) / 1.5)
        if (ledger && typeof ledger.addToken === 'function') {
          try { ledger.addToken({ tokens, kind: 'chat', note: '聊天' }) } catch { /* 记不上不影响说话 */ }
        }
        try {
          const summary = todaySummary(new Date(), loadSchedule())
          reply.memeChance = summary.memeChance
          reply.mood = { energy: summary.energy, mood: summary.mood, hunger: summary.hunger, satiety: summary.satiety }
        } catch { /* 状态读不到就按默认概率 */ }
      } else {
        reply.error = result?.error || result?.reason || '没说出来'
        reply.note = leaveNote(`想跟你说「${request.text}」，但我这会儿说不出来（${reply.error}），先留张纸条。`)
      }
    } catch (error) {
      reply.error = String(error?.message ?? error)
    }
    try {
      writeFileSync(replyFile(), JSON.stringify(reply, null, 2) + '\n', 'utf8')
    } catch (error) {
      appendLog('桌宠回复写不进去', { error: String(error?.message ?? error) })
    }
    appendLog('桌宠对话', { chars: reply.text.length, ok: reply.ok })
    busy = false
  }

  function start() {
    if (timer) return
    timer = setInterval(() => { tick().catch(() => {}) }, intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop }
}
