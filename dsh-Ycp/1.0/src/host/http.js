/**
 * dsh-Ycp · 大肥鱼（Host 半）—— 面板与试说用的 HTTP 接口。
 *
 * 走宿主自己的 webServer，不另开端口：
 *   GET  /api/dsh-Ycp/state     一次拿全：家在哪、目录齐不齐、设置、人设、当前模型
 *   GET  /api/dsh-Ycp/settings  读设置
 *   PUT  /api/dsh-Ycp/settings  改设置（也收 POST）
 *   GET  /api/dsh-Ycp/persona   读人设全文 + 默认人设
 *   PUT  /api/dsh-Ycp/persona   改人设（也收 POST）
 *   POST /api/dsh-Ycp/say       试说一句（模型跟随当前对话）
 *
 * 写操作只接受同源请求；body 上限 256 KB。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLog, homePaths, homeSummary, loadPersonaBase, loadSettings, savePersona, saveSettings, DEFAULT_PERSONA } from './kernel/paths.js'
import { DEFAULT_SAMPLE } from './appearance/voice.js'
import { soundDir, soundStatus } from './appearance/sound.js'
import { appendDiary, deleteCard, isLayer, LAYERS, listAll, readCard, todayDiary, writeCard } from './organs/memory.js'
import { recordActivity, recordEvent, todaySummary } from './organs/mood.js'
import { listForPanel, markRead, runOnce } from './organs/proactive.js'
import { search } from './organs/search.js'
import { describeStatus, loadSchedule, saveSchedule } from './organs/schedule.js'
import { createSayService } from './say.js'

const MAX_BODY = 256 * 1024

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体超过 256 KB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${String(error?.message ?? error)}`))
      }
    })
    req.on('error', reject)
  })
}

export function createHttpApi({ version, ctx, registry, browser, desktop, autonomy, pet, voice, balance, diary, ledger, sayService: injectedSay }) {
  const sayService = injectedSay || createSayService(ctx)
  const tools = registry ?? null

  /** 面板要的整份状态。 */
  function panelState() {
    const paths = homePaths()
    const summary = homeSummary()
    const persona = loadPersonaBase()
    const settings = loadSettings()
    const schedule = loadSchedule()
    const mood = todaySummary(new Date(), schedule)
    return {
      ok: true,
      version,
      name: settings.name,
      ...summary,
      settings,
      model: sayService.currentModel(),
      rhythm: describeStatus(schedule),
      mood,
      persona: {
        chars: persona.length,
        preview: persona.slice(0, 120),
        mtimeMs: summary.files.persona.mtimeMs,
      },
      paths: {
        root: paths.root,
        dataRoot: paths.dataRoot,
        logs: paths.logs,
      },
    }
  }

  const handlerFor = (fn) => async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
      await fn(req, res, url)
    } catch (error) {
      appendLog('HTTP 接口异常', { url: req.url, error: String(error?.message ?? error) })
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      else try { res.end() } catch { /* 已断开 */ }
    }
  }

  const writeGate = (req, res) => {
    if (req.method !== 'PUT' && req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'PUT / POST only' })
      return false
    }
    if (!sameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'untrusted origin' })
      return false
    }
    return true
  }

  return {
    panelState,
    routes: [
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/state',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          sendJson(res, 200, panelState())
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/settings',
        handler: handlerFor(async (req, res) => {
          if (req.method === 'GET') return sendJson(res, 200, { ok: true, settings: loadSettings() })
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = saveSettings(body)
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/persona',
        handler: handlerFor(async (req, res) => {
          if (req.method === 'GET') {
            const text = loadPersonaBase()
            return sendJson(res, 200, { ok: true, content: text, chars: text.length, default: DEFAULT_PERSONA })
          }
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = savePersona(body?.content)
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/memory',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          sendJson(res, 200, {
            ok: true,
            layers: listAll(),
            tabs: Object.values(LAYERS).map((layer) => ({ key: layer.key, label: layer.label })),
            today: todayDiary(),
          })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/memory/card',
        handler: handlerFor(async (req, res, url) => {
          if (req.method === 'GET') {
            const layer = url.searchParams.get('layer') || ''
            const file = url.searchParams.get('file') || ''
            if (!isLayer(layer)) return sendJson(res, 400, { ok: false, error: 'layer 不合法' })
            const card = readCard(layer, file)
            if (!card) return sendJson(res, 404, { ok: false, error: '找不到这张卡' })
            return sendJson(res, 200, { ok: true, card })
          }
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = writeCard(body?.layer, body?.file, body?.content)
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/memory/delete',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = deleteCard(body?.layer, body?.file)
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/memory/diary',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = appendDiary(body?.text)
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/memory/search',
        handler: handlerFor(async (req, res, url) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          const query = url.searchParams.get('q') || ''
          const settings = loadSettings()
          const topK = Number(url.searchParams.get('topK')) || settings.memoryTopK
          const maxChars = Number(url.searchParams.get('maxChars')) || settings.memoryMaxChars
          const result = search(query, { topK, maxChars })
          sendJson(res, 200, { ok: true, query, ...result })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/mood',
        handler: handlerFor(async (req, res) => {
          if (req.method === 'GET') {
            const schedule = loadSchedule()
            return sendJson(res, 200, { ok: true, mood: todaySummary(new Date(), schedule) })
          }
          if (req.method === 'POST') {
            if (!writeGate(req, res)) return
            const body = await readBody(req)
            const schedule = loadSchedule()
            const summary = recordEvent(String(body?.kind || 'error'), String(body?.note || ''), new Date(), schedule)
            return sendJson(res, 200, { ok: true, mood: summary })
          }
          return sendJson(res, 405, { ok: false, error: '不支持的请求' })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/schedule',
        handler: handlerFor(async (req, res) => {
          if (req.method === 'GET') {
            const schedule = loadSchedule()
            return sendJson(res, 200, { ok: true, schedule, status: describeStatus(schedule) })
          }
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = saveSchedule(body)
          if (result.ok && loadSettings().autonomy?.schedule === false) {
            try { recordEvent('forced', '主人强制改了作息') } catch { /* 心情记不上不影响保存 */ }
          }
          sendJson(res, result.ok ? 200 : 400, {
            ...result,
            ...(result.ok ? { status: describeStatus(result.schedule) } : {}),
          })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/proactive',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          sendJson(res, 200, { ok: true, ...listForPanel() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/proactive/tick',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          const result = await runOnce(ctx, { force: true })
          sendJson(res, 200, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/proactive/read',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          sendJson(res, 200, { ok: true, ...markRead(body?.ids) })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/tools',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          if (!tools) return sendJson(res, 200, { ok: true, tools: [], hands: [], appearances: [] })
          sendJson(res, 200, {
            ok: true,
            tools: tools.listTools(),
            hands: tools.listHands(),
            appearances: tools.listAppearances(),
          })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/tools/invoke',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!tools) return sendJson(res, 503, { ok: false, error: '注册表没挂上' })
          const body = await readBody(req)
          const id = String(body?.id ?? '').trim()
          if (!id) return sendJson(res, 400, { ok: false, error: '缺少工具 id' })
          const result = await tools.invoke(id, body?.args ?? {})
          if (result?.ok) {
            try {
              if (/web|browser|search|fetch|bili|site|qq|post|publish|comment|dynamic|send|play/i.test(id)) {
                const kind = /post|publish|comment|dynamic|send/i.test(id) ? 'post' : /play|game/i.test(id) ? 'play' : 'web'
                recordActivity(kind, new Date(), loadSchedule())
              }
            } catch { /* 活动记不上不影响工具 */ }
          }
          sendJson(res, 200, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/browser',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          if (!browser) return sendJson(res, 200, { ok: true, available: false, error: '浏览器手没挂上' })
          sendJson(res, 200, { ok: true, ...browser.status() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/browser/stop',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!browser) return sendJson(res, 503, { ok: false, error: '浏览器手没挂上' })
          const result = await browser.close()
          sendJson(res, 200, { ok: true, ...result, status: browser.status() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/desktop',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          if (!desktop) return sendJson(res, 200, { ok: true, available: false, error: '桌面手没挂上' })
          sendJson(res, 200, { ok: true, ...desktop.status() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/autonomy',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          if (!autonomy) return sendJson(res, 200, { ok: true, pending: null, recent: [] })
          sendJson(res, 200, { ok: true, ...autonomy.status() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/autonomy/resolve',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!autonomy) return sendJson(res, 503, { ok: false, error: '自主解决没挂上' })
          sendJson(res, 200, { ok: true, ...autonomy.resolve() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/autonomy/run',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!autonomy) return sendJson(res, 503, { ok: false, error: '自主解决没挂上' })
          const body = await readBody(req)
          const goal = String(body?.goal ?? '').trim()
          if (!goal) return sendJson(res, 400, { ok: false, error: '缺少 goal' })
          const result = await autonomy.solve(goal)
          sendJson(res, 200, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/pet',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          if (!pet) return sendJson(res, 200, { ok: true, available: false, error: '桌宠没挂上' })
          sendJson(res, 200, { ok: true, ...pet.status() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/pet/start',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!pet) return sendJson(res, 503, { ok: false, error: '桌宠没挂上' })
          const result = await pet.start()
          sendJson(res, result.ok ? 200 : 500, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/pet/stop',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!pet) return sendJson(res, 503, { ok: false, error: '桌宠没挂上' })
          const result = await pet.stop()
          sendJson(res, 200, { ok: true, ...result, status: pet.status() })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/voice',
        handler: handlerFor(async (req, res) => {
          if (req.method === 'GET') {
            if (!voice) return sendJson(res, 200, { ok: true, enabled: false, voices: [] })
            let voices = []
            let error = null
            try {
              voices = await voice.listVoices()
            } catch (cause) {
              error = String(cause?.message ?? cause)
            }
            return sendJson(res, 200, {
              ok: true,
              settings: loadSettings().voice,
              voices,
              error,
            })
          }
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = saveSettings({ voice: body })
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/voice/preview',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!voice) return sendJson(res, 503, { ok: false, error: '声音没挂上' })
          const body = await readBody(req)
          try {
            const result = await voice.synth(body?.text || DEFAULT_SAMPLE)
            sendJson(res, 200, { ok: true, ...result })
          } catch (cause) {
            sendJson(res, 500, { ok: false, error: String(cause?.message ?? cause) })
          }
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/voice/speak',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!voice) return sendJson(res, 503, { ok: false, error: '声音没挂上' })
          const body = await readBody(req)
          try {
            const result = await voice.synth(body?.text)
            sendJson(res, 200, { ok: true, ...result })
          } catch (cause) {
            sendJson(res, 400, { ok: false, error: String(cause?.message ?? cause) })
          }
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/voice/derive',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!voice) return sendJson(res, 503, { ok: false, error: '声音没挂上' })
          try {
            const derived = await voice.derive()
            const saved = saveSettings({
              voice: { name: derived.name, rate: derived.rate, pitch: derived.pitch },
            })
            sendJson(res, saved.ok ? 200 : 400, { ok: saved.ok, derived, settings: saved.settings })
          } catch (cause) {
            sendJson(res, 500, { ok: false, error: String(cause?.message ?? cause) })
          }
        }),
      },
      {
        kind: 'prefix',
        path: '/api/dsh-Ycp/voice/file',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            return sendJson(res, 405, { ok: false, error: 'GET only' })
          }
          const url = new URL(req.url || '/', 'http://x')
          const name = decodeURIComponent(url.pathname.split('/').pop() || '')
          if (!/^voice-[0-9T-]+\.(wav|mp3)$/i.test(name) || basename(name) !== name) {
            return sendJson(res, 404, { ok: false, error: '没有这个语音' })
          }
          const file = join(homePaths().root, '状态', '语音', name)
          if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: '语音文件不在了' })
          const data = readFileSync(file)
          res.writeHead(200, {
            'content-type': name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
            'content-length': data.length,
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : data)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/sound',
        handler: handlerFor(async (req, res) => {
          if (req.method === 'GET') {
            return sendJson(res, 200, { ok: true, ...soundStatus(loadSettings()) })
          }
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = saveSettings({ sound: body })
          sendJson(res, result.ok ? 200 : 400, result)
        }),
      },
      {
        kind: 'prefix',
        path: '/api/dsh-Ycp/sound/file',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            return sendJson(res, 405, { ok: false, error: 'GET only' })
          }
          const url = new URL(req.url || '/', 'http://x')
          const name = decodeURIComponent(url.pathname.split('/').pop() || '')
          if (!/^(click|speak|sleep|eat|low)\.wav$/.test(name)) {
            return sendJson(res, 404, { ok: false, error: '没有这个音效' })
          }
          const file = join(soundDir(), name)
          if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: '音效文件不在了' })
          const data = readFileSync(file)
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'content-length': data.length,
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : data)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/ledger',
        handler: handlerFor(async (req, res) => {
          if (!ledger) return sendJson(res, 503, { ok: false, error: '账本没挂上' })
          if (req.method === 'GET') {
            return sendJson(res, 200, { ok: true, summary: ledger.summary(), categories: ledger.categories })
          }
          if (req.method === 'POST' || req.method === 'PUT') {
            if (!writeGate(req, res)) return
            const body = await readBody(req)
            try {
              if (body?.budget !== undefined) {
                const budget = ledger.setBudget(body.budget)
                return sendJson(res, 200, { ok: true, budget, summary: ledger.summary() })
              }
              if (body?.daily !== undefined || body?.monthly !== undefined) {
                const budget = ledger.setTokenBudget({ daily: body.daily, monthly: body.monthly })
                return sendJson(res, 200, { ok: true, budget, summary: ledger.summary() })
              }
              if (body?.remove) {
                const removed = ledger.remove(body.remove)
                return sendJson(res, removed ? 200 : 404, { ok: removed, summary: ledger.summary() })
              }
              if (body?.tokens !== undefined) {
                const entry = body.type === 'income'
                  ? ledger.addTokenIncome({ tokens: body.tokens, note: body.note })
                  : ledger.addToken({ tokens: body.tokens, kind: body.kind, note: body.note })
                return sendJson(res, 200, { ok: true, entry, summary: ledger.summary() })
              }
              const entry = ledger.add(body)
              return sendJson(res, 200, { ok: true, entry, summary: ledger.summary() })
            } catch (error) {
              return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
            }
          }
          return sendJson(res, 405, { ok: false, error: '不支持的请求' })
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/balance',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          if (!balance) return sendJson(res, 200, { ok: false, reason: 'missing', error: '余额没挂上' })
          const url = new URL(req.url || '/', 'http://x')
          const data = await balance.status({ force: url.searchParams.get('refresh') === '1' })
          sendJson(res, 200, data)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/character.png',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            return sendJson(res, 405, { ok: false, error: 'GET only' })
          }
          const file = fileURLToPath(new URL('../../assets/character/character.png', import.meta.url))
          if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: '形象文件不见了' })
          const data = readFileSync(file)
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': data.length,
            'cache-control': 'no-cache',
          })
          res.end(req.method === 'HEAD' ? undefined : data)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/character.svg',
        handler: handlerFor(async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            return sendJson(res, 405, { ok: false, error: 'GET only' })
          }
          const file = fileURLToPath(new URL('../../assets/character/whale-girl.svg', import.meta.url))
          if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: '形象文件不见了' })
          const data = readFileSync(file)
          res.writeHead(200, {
            'content-type': 'image/svg+xml; charset=utf-8',
            'content-length': data.length,
            'cache-control': 'no-cache',
          })
          res.end(req.method === 'HEAD' ? undefined : data)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/diary/auto',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          if (!diary) return sendJson(res, 503, { ok: false, error: '日记没挂上' })
          const body = await readBody(req)
          const result = await diary.write({ text: body?.text })
          sendJson(res, result.ok ? 200 : 500, result)
        }),
      },
      {
        kind: 'exact',
        path: '/api/dsh-Ycp/say',
        handler: handlerFor(async (req, res) => {
          if (!writeGate(req, res)) return
          const body = await readBody(req)
          const result = await sayService.say(body)
          if (result.ok && ledger && typeof ledger.addToken === 'function') {
            try {
              ledger.addToken({
                tokens: Math.ceil(((body?.text || '').length + (result.text || '').length) / 1.5),
                kind: 'chat',
                note: '面板聊天',
              })
            } catch { /* 记不上不影响说话 */ }
          }
          // 说话成功顺手合成一条语音条；合成失败不影响文字回复。
          if (result.ok && voice && loadSettings().voice?.enabled) {
            try {
              result.voice = await voice.synth(result.text)
            } catch (cause) {
              appendLog('回复语音合成失败', { error: String(cause?.message ?? cause) })
            }
          }
          sendJson(res, result.ok ? 200 : result.reason === 'empty' || result.reason === 'too-long' ? 400 : 200, result)
        }),
      },
    ],
  }
}

export function mountHttp(ctx, api) {
  const state = { mounted: false }
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (inner) => {
        inner.effect(() => {
          const disposers = api.routes.map((route) => inner.webServer.register(route))
          state.mounted = true
          appendLog('HTTP 接口已挂载', { routes: api.routes.map((route) => route.path) })
          return () => {
            for (const off of disposers) {
              try { off?.() } catch { /* 已卸载 */ }
            }
            state.mounted = false
          }
        })
      })
    }
  } catch (error) {
    appendLog('HTTP 接口挂载失败', { error: String(error?.message ?? error) })
  }
  return state
}
