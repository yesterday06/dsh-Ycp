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
import { installBuiltins } from './capabilities/builtin.js'
import { createBrowserHand, installBrowserTools } from './capabilities/browser.js'
import { createDesktopHand, installDesktopTools } from './capabilities/desktop.js'
import { createRegistry } from './capabilities/registry.js'
import { createScriptHand, installScriptTools } from './capabilities/script.js'
import { installWebTools } from './capabilities/web.js'
import { createPlatforms, installPlatformTools } from './capabilities/platforms.js'
import { createAutonomy, installAutonomyTool } from './organs/autonomy.js'
import { createHttpApi, mountHttp } from './http.js'
import { appendLog, ensureHome, loadSettings } from './kernel/paths.js'
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

  // 余额：走 DSH 凭据里的 DEEPSEEK_API_KEY，5 分钟缓存。
  const balance = createBalance({ ctx })

  const http = createHttpApi({ version, ctx, registry, browser, desktop, autonomy, pet, voice, balance })

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
