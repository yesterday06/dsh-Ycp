/**
 * dsh-Ycp · 大肥鱼（Host 半）—— P02 包入口。
 *
 * 加载时做三件事：
 *   1. 建家（目录 + 默认 settings.json / 人设.md，已有的不动）
 *   2. 挂 HTTP（/api/dsh-Ycp/state · settings · persona）
 *   3. 打一行 [dsh-Ycp]，宿主日志里能看到
 *
 * 后面的阶段往这里接：
 *   P04 记忆 → P06 作息与闸门 → P09 能力注册表 → P11–P13 三条腿
 */
import { readFileSync } from 'node:fs'
import { createBalance } from './appearance/balance.js'
import { createPet } from './appearance/pet.js'
import { clickSoundFile, soundStatus } from './appearance/sound.js'
import { createVoice } from './appearance/voice.js'
import { createPetBridge } from './appearance/pet-bridge.js'
import { createSayService } from './say.js'
import { loadSchedule, saveSchedule } from './organs/schedule.js'
import { createRegistry } from './capabilities/registry.js'
import { search } from './organs/search.js'
import { createDiaryWriter } from './organs/diary.js'
import { createLedger } from './organs/ledger.js'
import { createHttpApi, mountHttp } from './http.js'
import { appendGrowth, appendLog, ensureHome, loadSettings, saveSettings } from './kernel/paths.js'
import { appendDiary, appendRaw, consolidationBundle, deleteCard, listAll, listCards, writeCard } from './organs/memory.js'
import { healthCheck, mergeCards, upsertCard } from './organs/brain.js'
import { loadHistory } from './organs/chatlog.js'
import { createAutoSelf } from './organs/autoself.js'
import { startTimer } from './organs/proactive.js'

const FALLBACK_VERSION = '0.1.0'

/** 版本以 package.json 为准，读不到就退回常量（不让加载失败）。 */
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    return String(pkg.version || FALLBACK_VERSION)
  } catch {
    return FALLBACK_VERSION
  }
}

/**
 * Cordis 插件入口。
 * @param {object} ctx 宿主上下文；HTTP 只用它的 webServer。
 */
export function apply(ctx) {
  const version = readVersion()
  // 反思工具要等 autoSelf 建好才能用；先留个位置。
  let autoSelfRef = null

  let home = null
  let homeError = null
  try {
    home = ensureHome()
    appendLog('插件加载', {
      version,
      home: home.root,
      createdDirs: home.created.length,
      createdFiles: home.files.length,
    })
  } catch (error) {
    homeError = String(error?.message ?? error)
    appendLog('家目录创建失败', { error: homeError })
    console.error(`[dsh-Ycp] 家目录创建失败：${homeError}`)
  }

  // 能力注册表：P09 先挂两个演示工具；P11–P13 的真手往这里注册。
  const registry = createRegistry({
    getSettings: () => loadSettings(),
    log: (message, extra) => appendLog(message, extra),
  })
  // 所有工具动作都进“原始记忆”：她做过什么，和聊天一样留痕，之后能回查、能提炼。
  const invokeTool = registry.invoke.bind(registry)
  registry.invoke = async (id, args = {}) => {
    const result = await invokeTool(id, args)
    try {
      const brief = JSON.stringify(args).slice(0, 300)
      appendRaw({
        source: 'other',
        text: `[动作] ${id} ${result?.ok ? '成功' : '失败'}${result?.error ? '：' + result.error : ''} ${brief}`,
        meta: { tool: id },
      })
    } catch { /* 记不上不影响动作 */ }
    return result
  }
  // 工具注册表：只挂她自己的小工具（记忆 / 日记 / 成长 / 名字 / 签名 / 作息 / 主动性）。
  registry.registerTool({
    id: 'memory.raw',
    description: '记一条原始记忆（不加工）：聊天、心里想的、看到的帖子、打的游戏、发的视频、看到的网页都行。只用于以后回查，不进提示词。',
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['chat', 'thought', 'post', 'game', 'video', 'web', 'other'] },
        text: { type: 'string' },
        meta: { type: 'object' },
      },
      required: ['source', 'text'],
    },
    run: async ({ source, text, meta }) => appendRaw({ source, text, meta }),
  })

  registry.registerTool({
    id: 'diary.write',
    description: '写今天的日记（追加到自己的 记忆/日记/YYYY-MM-DD.md）。第一人称、写具体的事和情绪，别写成汇报。',
    schema: { type: 'object', properties: { text: { type: 'string', description: '日记正文，200–800 字' } }, required: ['text'] },
    run: async ({ text }) => appendDiary(text),
  })

  registry.registerTool({
    id: 'memory.card',
    description: '记住一件事（稳定的偏好、事实、约定、人物关系）。同名同类会自动合并进旧卡，不会重复建；文件名由标题生成。',
    schema: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['global', 'archive', 'realtime'] },
        title: { type: 'string', description: '一句话标题，会变成文件名' },
        tags: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        importance: { type: 'number', description: '重要度 1–5，默认 3；关于主人和长期约定的用 4–5' },
        file: { type: 'string', description: '仅实时卡用：要写的文件名' },
      },
      required: ['layer', 'title', 'body'],
    },
    run: async ({ layer, file, title, tags, body, importance }) => {
      const target = String(layer || 'global')
      if (target === 'realtime') {
        const name = String(file || '此刻.md')
        const list = Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : []
        const content = [
          '---',
          `name: ${String(title).slice(0, 60)}`,
          `description: ${String(body).replace(/\s+/g, ' ').slice(0, 80)}`,
          `tags: [${list.join(', ')}]`,
          `updated: ${new Date().toISOString().slice(0, 10)}`,
          '---',
          '',
          String(body).trim(),
          '',
        ].join('\n')
        return writeCard('realtime', name, content)
      }
      return upsertCard(target === 'archive' ? 'archive' : 'global', {
        title,
        body,
        tags: Array.isArray(tags) ? tags : [],
        importance,
        source: `对话 ${new Date().toISOString().slice(0, 10)}`,
      })
    },
  })

  registry.registerTool({
    id: 'memory.check',
    description: '记忆体检：列出重复卡、空卡、超长卡、久未用的卡。整理记忆前先跑一次。',
    schema: { type: 'object', properties: {} },
    run: async () => healthCheck(),
  })

  registry.registerTool({
    id: 'memory.merge',
    description: '把两张重复的记忆合并成一张：keep 保留，drop 并进去后删掉（删前自动备份）。',
    schema: {
      type: 'object',
      properties: { keep: { type: 'string', description: '保留的文件名' }, drop: { type: 'string', description: '要并掉的单层文件名' } },
      required: ['keep', 'drop'],
    },
    run: async ({ keep, drop }) => mergeCards(String(keep), String(drop)),
  })

  registry.registerTool({
    id: 'memory.reflect',
    description: '从今天的原始记忆里回看一遍，长出值得长期记住的卡和成长。想整理的时候用；平时它自己会做。',
    schema: { type: 'object', properties: {} },
    run: async () => {
      if (!autoSelfRef) return { ok: false, error: '记忆服务还没准备好' }
      return autoSelfRef.reflect({ force: true })
    },
  })

  registry.registerTool({
    id: 'memory.consolidate',
    description: '整理记忆的素材包：最近对话 + 今天的原始记忆 + 现有卡标题。准备写卡/写日记前先调它。',
    schema: { type: 'object', properties: {} },
    run: async () => {
      const bundle = consolidationBundle({ chat: loadHistory({ maxMessages: 20, maxChars: 8000 }) })
      return { ok: true, ...bundle }
    },
  })

  registry.registerTool({
    id: 'memory.list',
    description: '列出自己的记忆卡（可按层过滤），整理记忆前先看一遍。',
    schema: { type: 'object', properties: { layer: { type: 'string', enum: ['global', 'archive', 'realtime', 'diary', 'raw'] } } },
    run: async ({ layer }) => {
      const grouped = layer ? { [layer]: listCards(layer) } : listAll()
      const cards = []
      for (const [key, items] of Object.entries(grouped)) {
        for (const item of items) cards.push({ layer: key, ...item })
      }
      cards.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
      return { ok: true, count: cards.length, cards: cards.slice(0, 80) }
    },
  })

  registry.registerTool({
    id: 'memory.forget',
    description: '删掉一张记忆卡（先备份，能找回）。只删自己整理后确认没用的；主人还要的别删。',
    schema: { type: 'object', properties: { layer: { type: 'string', enum: ['global', 'archive', 'realtime'] }, file: { type: 'string' } }, required: ['layer', 'file'] },
    run: async ({ layer, file }) => deleteCard(layer, file),
  })

  registry.registerTool({
    id: 'name.set',
    description: '给自己起/换名字（1–24 个字）。主人让你起名时用这个；名字会显示在面板和对话里。',
    schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: async ({ name }) => saveSettings({ name }),
  })

  registry.registerTool({
    id: 'persona.grow',
    description: '把一件经历过/想通的事提炼成一句成长记录，写进自己的人设（会并入以后每句话的背景）。只写真正会改变你的东西，不写流水账。',
    schema: { type: 'object', properties: { text: { type: 'string', description: '一句话，尽量具体，30–120 字' } }, required: ['text'] },
    run: async ({ text }) => appendGrowth(text),
  })
  registry.registerTool({
    id: 'schedule.set',
    description: '调整自己的作息（起睡时间、午睡）。只有主人把作息权限交给自己时才能改；被锁了要立刻停手。',
    schema: {
      type: 'object',
      properties: {
        wake: { type: 'string', description: '工作日几点起，HH:MM' },
        sleep: { type: 'string', description: '工作日几点睡，HH:MM' },
        weekendWake: { type: 'string' },
        weekendSleep: { type: 'string' },
        napEnabled: { type: 'boolean' },
        napFrom: { type: 'string' },
        napTo: { type: 'string' },
      },
    },
    run: async (args) => {
      if (loadSettings().autonomy?.schedule === false) {
        return { ok: false, error: '主人锁了作息，改不了。想调的话先让主人把「AI 自己调」打开。' }
      }
      const current = loadSchedule()
      const next = {
        ...current,
        weekday: { ...current.weekday, ...(args.wake ? { wake: String(args.wake) } : {}), ...(args.sleep ? { sleep: String(args.sleep) } : {}) },
        weekend: { ...current.weekend, ...(args.weekendWake ? { wake: String(args.weekendWake) } : {}), ...(args.weekendSleep ? { sleep: String(args.weekendSleep) } : {}) },
        nap: {
          ...current.nap,
          ...(typeof args.napEnabled === 'boolean' ? { enabled: args.napEnabled } : {}),
          ...(args.napFrom ? { from: String(args.napFrom) } : {}),
          ...(args.napTo ? { to: String(args.napTo) } : {}),
        },
      }
      const result = saveSchedule(next)
      return result.ok ? { ok: true, schedule: result.schedule } : result
    },
  })

  registry.registerTool({
    id: 'proactive.set',
    description: '调整自己主动说话的频率/开关。只有主人把主动性权限交给自己时才能改。',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        everyMin: { type: 'number' },
        dailyLimit: { type: 'number' },
      },
    },
    run: async (args) => {
      if (loadSettings().autonomy?.proactive === false) {
        return { ok: false, error: '主人锁了主动性，改不了。' }
      }
      const patch = { proactive: { ...loadSettings().proactive } }
      if (typeof args.enabled === 'boolean') patch.proactive.enabled = args.enabled
      if (Number.isFinite(Number(args.everyMin))) patch.proactive.everyMin = Number(args.everyMin)
      if (Number.isFinite(Number(args.dailyLimit))) patch.proactive.dailyLimit = Number(args.dailyLimit)
      const result = saveSettings(patch)
      return result.ok ? { ok: true, proactive: result.settings.proactive } : result
    },
  })
  registry.registerTool({
    id: 'signature.set',
    description: '给自己换个性签名（只有你能改，主人不能改）',
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async ({ text }) => {
      const result = saveSettings({ signature: String(text ?? '').slice(0, 120) })
      return result.ok ? { ok: true, signature: result.settings.signature } : result
    },
  })
  // 记忆的「记」和「想」：不是手，是脑子的一部分。
  registry.registerTool({
    id: 'memory.remember',
    description: '把刚知道的一件事记住（同类会自动并进旧卡）。',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '这件事叫什么' },
        text: { type: 'string', description: '要记住的内容' },
        tags: { type: 'array', description: '可选标签数组' },
      },
      required: ['title', 'text'],
    },
    run: async ({ title, text, tags }) => {
      const name = String(title ?? '').trim()
      const body = String(text ?? '').trim()
      if (!name || !body) throw new Error('标题和内容都不能为空')
      const result = upsertCard('global', {
        title: name,
        body,
        tags: Array.isArray(tags) ? tags : [],
        source: '她记住的',
      })
      if (!result.ok) throw new Error(result.error)
      return { file: result.file, merged: Boolean(result.merged) }
    },
  })

  registry.registerTool({
    id: 'memory.recall',
    description: '从记忆里找相关的事，返回命中的卡片与摘要。',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '想找什么' },
        topK: { type: 'integer', description: '最多几张，默认 3' },
      },
      required: ['query'],
    },
    run: async ({ query, topK }) => {
      const text = String(query ?? '').trim()
      if (!text) throw new Error('要找什么？')
      const count = Math.max(1, Math.min(5, Number(topK) || 3))
      return search(text, { topK: count, maxChars: 600 })
    },
  })

  // 外观：桌宠是一个独立 Electron 进程（宿主没有主进程权限）；点她会响一声。
  const pet = createPet({
    getSettings: () => loadSettings(),
    clickSound: clickSoundFile(),
    soundVolume: loadSettings().sound?.volume ?? 40,
  })

  // 声音：Windows SAPI，本地合成 WAV，面板当语音条播。
  const voice = createVoice({ ctx })

  // 记账：她自己的小账本。
  const ledger = createLedger()

  // 桌宠对话/记账：纯文件桥，不依赖面板登录态。
  const autoSelf = createAutoSelf({ ctx })
  autoSelfRef = autoSelf
  const sayService = createSayService(ctx, { tools: registry, autoSelf })
  const bridge = createPetBridge({ say: sayService, voice, ledger })
  bridge.start()

  // 余额：走 DSH 凭据里的 DEEPSEEK_API_KEY，5 分钟缓存。
  const balance = createBalance({ ctx })

  // 日记：她自己写，只写进她自己的家。
  const diary = createDiaryWriter({ ctx })

  const http = createHttpApi({ version, ctx, sayService, ledger, registry, pet, voice, balance, diary, autoSelf })

  // 外观：主人勾了"放她出来"，宿主加载时就把桌宠窗口拉起来。
  if (loadSettings().appearance?.petEnabled) {
    pet.start()
      .then((result) => {
        if (!result.ok) appendLog('桌宠自动启动失败', { error: result.error })
      })
      .catch((error) => appendLog('桌宠自动启动异常', { error: String(error?.message ?? error) }))
  }

  mountHttp(ctx, http)

  // 主动发言：每分钟看一眼，六道条件全满足才真的生成一句。
  const proactive = startTimer(ctx, { ledger })

  // 反思：每 30 分钟看一眼，够 6 小时且有新材料才真跑（从原始记忆长卡）。
  // 折叠：同一拍顺手看一眼，聊天窗口满了就把旧的一段压成摘要卡。
  const reflectTimer = setInterval(() => {
    autoSelf.reflect().catch(() => {})
    autoSelf.foldIfNeeded().catch(() => {})
  }, 30 * 60 * 1000)
  reflectTimer.unref?.()

  // 这行就是加载成功的标志；带上家在哪，排查时一眼看到。
  console.log(`[dsh-Ycp] v${version} 已加载${home ? ` · 家 ${home.root}` : ''}`)

  return {
    version,
    home: home?.root ?? null,
    homeError,
    http,
    proactive: Boolean(proactive),
    registry,
  }
}

export default apply
