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
import { installBuiltins } from './capabilities/builtin.js'
import { createBrowserHand, installBrowserTools } from './capabilities/browser.js'
import { createDesktopHand, installDesktopTools } from './capabilities/desktop.js'
import { createRegistry } from './capabilities/registry.js'
import { createScriptHand, installScriptTools } from './capabilities/script.js'
import { installWebTools } from './capabilities/web.js'
import { createPlatforms, installPlatformTools } from './capabilities/platforms.js'
import { createAutonomy, installAutonomyTool } from './organs/autonomy.js'
import { createDiaryWriter } from './organs/diary.js'
import { createLedger } from './organs/ledger.js'
import { createHttpApi, mountHttp } from './http.js'
import { appendGrowth, appendLog, ensureHome, loadSettings, saveSettings } from './kernel/paths.js'
import { appendDiary, deleteCard, listAll, listCards, writeCard } from './organs/memory.js'
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
  installBuiltins(registry)
  registry.registerTool({
    id: 'diary.write',
    description: '写今天的日记（追加到自己的 记忆/日记/YYYY-MM-DD.md）。第一人称、写具体的事和情绪，别写成汇报。',
    schema: { type: 'object', properties: { text: { type: 'string', description: '日记正文，200–800 字' } }, required: ['text'] },
    run: async ({ text }) => appendDiary(text),
  })

  registry.registerTool({
    id: 'memory.card',
    description: '新建或覆盖一张记忆卡（稳定的偏好、事实、约定、人物关系）。同类信息合并进一张卡，别记流水账；文件名用中文短语，如「主人的口味.md」。',
    schema: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['global', 'archive', 'realtime'] },
        file: { type: 'string', description: '单层 .md 文件名' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
      },
      required: ['layer', 'file', 'title', 'body'],
    },
    run: async ({ layer, file, title, tags, body }) => {
      const list = Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : []
      const content = [
        '---',
        `name: ${String(title).slice(0, 60)}`,
        `description: ${String(body).replace(/\s+/g, ' ').slice(0, 80)}`,
        'metadata:',
        `  type: ${String(layer)}`,
        `  tags: [${list.map((tag) => JSON.stringify(tag)).join(', ')}]`,
        `  updated: ${new Date().toISOString().slice(0, 10)}`,
        '---',
        '',
        String(body).trim(),
        '',
      ].join('\n')
      return writeCard(layer, file, content)
    },
  })

  registry.registerTool({
    id: 'memory.list',
    description: '列出自己的记忆卡（可按层过滤），整理记忆前先看一遍。',
    schema: { type: 'object', properties: { layer: { type: 'string', enum: ['global', 'archive', 'realtime', 'diary'] } } },
    run: async ({ layer }) => {
      const cards = layer ? listCards(layer) : listAll()
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
  installWebTools(registry, { ctx })

  // 浏览器之手：本机没装 Playwright，用系统 Edge/Chrome + CDP；懒启动，闲置自动关。
  const browser = createBrowserHand({
    getSettings: () => loadSettings(),
    log: (message, extra) => appendLog(message, extra),
  })
  installBrowserTools(registry, browser)

  // 桌面之手：PowerShell + user32，默认关；开之前谁也别想动鼠标键盘。
  const desktop = createDesktopHand({
    getSettings: () => loadSettings(),
    log: (message, extra) => appendLog(message, extra),
  })
  installDesktopTools(registry, desktop)

  // 平台：B站 / 小黑盒 / 抖音走浏览器手，QQ 走桌面手。
  const platforms = createPlatforms({ browser, desktop })
  installPlatformTools(registry, platforms)

  // 脚本之手：读写自己家、写小工具、跑小工具；runCommand 默认关。
  const script = createScriptHand({
    getSettings: () => loadSettings(),
    log: (message, extra) => appendLog(message, extra),
  })
  installScriptTools(registry, script)

  // 自主解决：看 → 想 → 试 → 记 → 换，最多 3 次；不行就写一条求助。
  const autonomy = createAutonomy({ ctx, registry, getSettings: () => loadSettings() })
  installAutonomyTool(registry, autonomy)

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
  const sayService = createSayService(ctx, { tools: registry })
  const bridge = createPetBridge({ say: sayService, voice, ledger })
  bridge.start()

  // 余额：走 DSH 凭据里的 DEEPSEEK_API_KEY，5 分钟缓存。
  const balance = createBalance({ ctx })

  // 日记：她自己写，只写进她自己的家。
  const diary = createDiaryWriter({ ctx })

  const http = createHttpApi({ version, ctx, sayService, ledger, registry, browser, desktop, autonomy, pet, voice, balance, diary })

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
  const proactive = startTimer(ctx)

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
