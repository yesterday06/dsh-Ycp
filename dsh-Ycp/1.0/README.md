# dsh-Ycp · 大肥鱼

一个**会用电脑、能自己上网做事**的 DSH 个体。不是接了一堆平台接口，是给她一双手：浏览器、桌面、脚本。

> 当前进度：**P18 收尾完成**。断网能活、备份只留 20 份、离线包与 git 都在。

## 现在有什么

| 阶段 | 内容 | 状态 |
|---|---|---|
| P01 | 包与入口：manifest、补丁、图标、Host/Client 入口 | ✅ 完成 |
| P02 | 实例与设置：家目录自动建、settings / 人设读写、HTTP 接口 | ✅ 完成 |
| P03 | 面板骨架：状态行、人设编辑、试说一句（`/say`） | ✅ 完成 |
| P04 | 记忆读写：frontmatter、四类目录、面板记忆页、日记追加 | ✅ 完成 |
| P05 | 检索与实时：标题×3 / tags×2 / 正文×1、top-2、实时必读、日记不检索 | ✅ 完成 |
| P06 | 作息与闸门：工作日/周末/午睡、五道闸、固定 reason、面板作息页 | ✅ 完成 |
| P07 | 心情与统计：体力 / 心情 / 饿、今日句数与次数、面板「她的今天」 | ✅ 完成 |
| P08 | 主动发言：六道触发、冷却抖动 ±30%、内容来源、面板投递 | ✅ 完成 |
| P09 | 工具注册表：registerTool / registerHand / registerAppearance、面板「手」页 | ✅ 完成 |
| P10 | 上网四件套：`web.search` / `web.fetch` / `memory.remember` / `memory.recall` | ✅ 完成 |
| P11 | 浏览器之手：`browser.*`、默认不限制浏览 | ✅ 完成 |
| P12 | 桌面之手：截屏、鼠标、键盘、程序白名单，默认关 | ✅ 完成 |
| P13 | 脚本之手：`fs.read/write/list`、`script.run`、`cmd.run`（默认关） | ✅ 完成 |
| P14 | 自主解决：看→想→试→记→换，3 次上限，卡住求助 | ✅ 完成 |
| P15 | 桌面窗口与形象：透明置顶窗口、拖拽抛掷、动画、右键菜单、新图标 | ✅ 完成 |
| P16 | 语音：系统音色、按人设配音、试听、回复语音条 | ✅ 完成 |
| P17 | 音效与余额：五个短音、余额进度条、低余额提醒 | ✅ 完成 |
| P18 | 收尾：断网降级、备份只留 20 份、离线安装包、git | ✅ 完成 |

安装看 [安装说明.md](安装说明.md)。

### 她的家在 `%USERPROFILE%\.dsh\Ycp\大肥鱼\`

```text
Ycp\
├─ logs\                    行动日志（一天一个 .log）
└─ 大肥鱼\
   ├─ settings.json         名字 / 启用 / 模型跟随 / 检索 / 每小时上限 / 手权限
   ├─ 行为\作息.json        工作日与周末的起床睡觉、午睡、安静时段、睡着时理不理人
   ├─ 状态\心情.json        体力 / 心情 / 饿 + 今天的统计
   ├─ 状态\主动.json        主动说过的话（最近 20 条）、上次与下次时间
   ├─ 人设\人设.md          模型看到的全文，不加工
   ├─ 记忆\{全局记忆,归档记忆,实时记忆,日记}\
   ├─ 外观\  行为\  账号\  扩展\
   └─ 状态\{backups\}\       覆盖 / 删除前的备份（设置、人设、记忆卡）
```

首次加载自动建齐，**已有的一个字节都不动**。

### 接口（挂在宿主 webServer 上，不另开端口）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/dsh-Ycp/state` | 家在哪、目录齐不齐、设置、人设字数、当前模型 |
| GET | `/api/dsh-Ycp/settings` | 读设置 |
| PUT / POST | `/api/dsh-Ycp/settings` | 改设置（写前备份） |
| GET | `/api/dsh-Ycp/persona` | 读人设全文 + 默认人设 |
| PUT / POST | `/api/dsh-Ycp/persona` | 改人设（限 64K 字符，写前备份） |
| POST | `/api/dsh-Ycp/say` | 试说一句：人设全文 + 名字 + 当下 → 当前对话的模型 |
| GET | `/api/dsh-Ycp/memory` | 四层列卡 + 标签 + 今天的日记名 |
| GET | `/api/dsh-Ycp/memory/card?layer=&file=` | 读一张卡全文 |
| PUT / POST | `/api/dsh-Ycp/memory/card` | 新建或覆盖一张卡（写前备份） |
| POST | `/api/dsh-Ycp/memory/delete` | 删卡（先备份，软删） |
| POST | `/api/dsh-Ycp/memory/diary` | 往今天的日记追加一段 |
| GET | `/api/dsh-Ycp/memory/search?q=` | 调试用：这次会想起哪几张卡 |
| GET | `/api/dsh-Ycp/schedule` | 读作息 + 现在的状态（醒着 / 夜里睡着 / 午睡中） |
| PUT / POST | `/api/dsh-Ycp/schedule` | 改作息（写前备份） |
| GET | `/api/dsh-Ycp/mood` | 体力 / 心情 / 饿 + 今天的统计 |
| GET | `/api/dsh-Ycp/proactive` | 主动开关、今天几次、最近说过的话 |
| POST | `/api/dsh-Ycp/proactive/tick` | 现在试一次（跳过冷却，面板按钮用） |
| POST | `/api/dsh-Ycp/proactive/read` | 把主动消息标记已读 |
| GET | `/api/dsh-Ycp/tools` | 已注册的工具、四条手、外观挂件 |
| POST | `/api/dsh-Ycp/tools/invoke` | 调一个工具（`{id, args}`） |
| GET | `/api/dsh-Ycp/browser` | 浏览器可用性、运行状态、白名单、最近动作 |
| POST | `/api/dsh-Ycp/browser/stop` | 关掉 headless 浏览器 |
| GET | `/api/dsh-Ycp/desktop` | 桌面手是否可用、开关、程序白名单、最近动作 |
| GET | `/api/dsh-Ycp/autonomy` | 有没有卡住的求助、最近几次自主尝试 |
| POST | `/api/dsh-Ycp/autonomy/run` | 手动让她解一件事（`{goal}`） |
| POST | `/api/dsh-Ycp/autonomy/resolve` | 「知道了」，清掉求助 |
| GET | `/api/dsh-Ycp/pet` | 桌宠窗口：能不能用、开着没、窗口位置 |
| POST | `/api/dsh-Ycp/pet/start` | 放她出来 |
| POST | `/api/dsh-Ycp/pet/stop` | 收起来 |
| GET | `/api/dsh-Ycp/voice` | 系统音色 + 当前声音设置 |
| PUT | `/api/dsh-Ycp/voice` | 改音色 / 语速 / 音调 / 音量 / 自动朗读 |
| POST | `/api/dsh-Ycp/voice/preview` | 合成一段试听 |
| POST | `/api/dsh-Ycp/voice/derive` | 按人设配声音 |
| GET | `/api/dsh-Ycp/voice/file/<名字>` | 取语音 WAV（语音条用） |
| GET | `/api/dsh-Ycp/sound` | 音效清单 + 开关/音量 |
| PUT | `/api/dsh-Ycp/sound` | 改音效开关/音量 |
| GET | `/api/dsh-Ycp/sound/file/<名字>` | 取音效 WAV |
| GET | `/api/dsh-Ycp/balance` | 余额（`?refresh=1` 强制查） |

`/say` 不另配 key：用 `agentDefaultModel.currentSelection()` 当前对话的模型；模型声明支持 `off` 时才关深度思考，避免花钱推理。失败给结构化原因（`disabled` / `provider-missing` / `generate-error`），不编文案。

检索参数在 `settings.json`：`memoryTopK`（默认 2，1–5）、`memoryMaxChars`（默认 600，100–2000）。实时卡每次必读，日记永远不参与检索。

### 五道闸（说话前按顺序过）

| # | 闸 | 不过时返回 |
|---|---|---|
| 1 | 总开关 | `disabled` |
| 2 | 睡眠（夜里 / 午睡） | `sleep`（选「完全不理」时）；选「回一句困的」则放行，但只回很短、带困意 |
| 3 | 安静时段 | `quiet` |
| 4 | 手权限（说话不需要手，留给工具调用） | `permission` |
| 5 | 频率（`sayPerHour`，默认 20） | `rate-limit` + `retryAfterSec` |

频率记录在 `状态\频率.json`，只留最近一小时；**放行的尝试**都记一条（模型请求已经花出去了）。

### 三个数（本地算，不调模型）

| 数 | 醒着 | 睡着 | 说话 |
|---|---|---|---|
| 体力 | 每小时 −6 | 每小时 +6 | 每句 −2 |
| 心情 | 每小时往 50 漂 1 | 每小时 +2 | 每句 +2 |
| 饿 | 每小时 +5 | 基本不动 | 每句 +1 |

跨天只重置「今天说了几句 / 主动几次 / 查网几次」，三个数照常带过去。数值封顶 100、触底 0。

### 主动发言（六道条件全满足才开口）

1. 醒着（不在夜里睡或午睡）
2. `proactive.enabled` 开着
3. 不在安静时段
4. 今天主动次数 < `proactive.dailyLimit`
5. 状态不极低（体力 > 15、心情 > 15、饿 < 85）
6. 过了冷却：间隔 `proactive.everyMin` 分钟，实际在 **±30%** 里随机

来源优先级：实时卡 → 随机一张全局卡 → 只靠时间背景。说的话由模型按人设生成，不为省事写死台词；生成成功才记进 `状态\主动.json`，面板每 10 秒来取一次。生成失败不存消息，只把下次时间推后 5 分钟。

### 工具与手

能力不写死在代码里，注册进注册表：

| 注册 | 用途 | 现在有谁 |
|---|---|---|
| `registerTool({id, description, schema, run, hand?, permission?})` | 一个能被调用的动作 | `demo.echo`、`demo.time`、`web.search`、`web.fetch`、`memory.remember`、`memory.recall` |
| `registerHand({id, name, description, risk})` | 一条手（能力通道） | 内置 `browser / desktop / script / runCommand / actions` |
| `registerAppearance({id, name})` | 外观 / 音效挂件 | `placeholder`（占位） |

工具声明了 `hand` 时，调用前先查手权限；声明了 `permission` 时查 `settings.permissions`（联网搜索 / 网页读取 / 记忆写入 / 记忆检索，四个开关，默认全开）。参数只做最小校验（必填 + 基础类型）。面板「手」区列出全部工具与手、四个权限开关，`demo.echo` 可以直接输入一句话试跑。

### 上网四件套

| 工具 | 干什么 | 权限 | 备注 |
|---|---|---|---|
| `web.search` | 上网搜，返回标题 / 链接 / 摘要 | `webSearch` | 走宿主 `ctx.web.search` |
| `web.fetch` | 读一个网页，HTML 去标签后给正文 | `webFetch` | 走宿主 `ctx.web.fetch`；只收 http/https |
| `memory.remember` | 把刚知道的写成一张全局记忆卡 | `memoryWrite` | 同名覆盖，覆盖前备份 |
| `memory.recall` | 从记忆里检索 | `memoryRead` | 标题×3 / tags×2 / 正文×1 |

查和读成功会掉 1 点体力，并把「今天查网」+1。

### 浏览器之手（P11）

本机**没装 Playwright**，按规矩不硬装；改用系统已装的 **Edge + Chrome DevTools Protocol**（Node 自带 WebSocket，无依赖）。只在你调用浏览器动作时起一个 headless 进程，用专属 profile，闲置 5 分钟自动关。

| 工具 | 干什么 |
|---|---|
| `browser.goto` | 打开白名单里的网址，返回标题与正文预览 |
| `browser.text` | 读当前页正文（≤8000 字） |
| `browser.click` | 按页面上的文字点可见链接 / 按钮 |
| `browser.type` | 往输入框打字 |
| `browser.screenshot` | 截图存到 `状态\截图\` |
| `browser.wait` | 等 100–5000 毫秒 |

**默认不限制浏览**（`browserSites: ["*"]`）；想收紧就把 `*` 换成具体站点，留空则全拒。

- 白名单：`settings.hands.browserSites`。默认 `["*"]` = **不限制浏览**；填具体站点就只许这些（支持子域）；留空则谁都打不开。`file:` / `javascript:` 这类协议永远不放行。
- 受限模式下，重定向与点击后跳转都会再查一次落地网址，跑出白名单就退回 `about:blank` 并报错；不限模式只查协议。
- 每次动作都记进 `状态\浏览器\最近动作.json`（最近 20 条），面板「手」区能看到状态、白名单和最近动作。
- 浏览器进程可以手动关（面板按钮 / `POST /api/dsh-Ycp/browser/stop`）。

### 桌面之手（P12，默认关）

`settings.hands.desktop = false`，关着时所有桌面动作一律 `permission` 拒绝。实现是 Windows 自带 PowerShell + user32，不装依赖；脚本首次使用时写到 `状态\桌面\desktop.ps1`。

| 工具 | 干什么 |
|---|---|
| `desktop.info` | 屏幕尺寸、当前窗口列表（标题 / 进程 / pid） |
| `desktop.screenshot` | 整屏截图存到 `状态\截图\` |
| `desktop.click` | 在 (x, y) 点左键 |
| `desktop.drag` | 从 (fromX, fromY) 拖到 (toX, toY) |
| `desktop.type` | 打字（剪贴板粘贴，支持中文）；给 pid 会先切窗口，标题不对就拒打 |
| `desktop.key` | 发送按键，如 `{ENTER}`、`^s`、`^a^c`；给 pid 会先切窗口 |
| `desktop.focus` | 把某个窗口切到前台 |
| `desktop.launch` | 启动程序，必须在 `desktopApps` 白名单里 |

程序白名单 `settings.hands.desktopApps`：写 `notepad.exe` 或完整路径；空名单谁都不许启动。每次动作记 `状态\桌面\最近动作.json`。

### 脚本之手（P13）

| 工具 | 干什么 | 归哪条手 |
|---|---|---|
| `fs.read` | 读自己家的文本文件（≤100KB） | `script`（默认开） |
| `fs.write` | 写自己家的文本文件（≤256KB，覆盖前备份） | `script` |
| `fs.list` | 列自己家里某个目录 | `script` |
| `script.run` | 写一段 Node 脚本并运行，cwd 是家目录；成功的留在 `扩展\脚本\` | `script` |
| `cmd.run` | 跑一条简单系统命令 | `runCommand`（默认关） |

边界：**只接受家目录里的相对路径**，绝对路径、`..`、UNC 一律拒；`cmd.run` 开了也强制在家目录里跑，并挡掉绝对路径、上级目录、系统目录变量与 `start`/`del`/`format` 这类写法。注意这是**护栏不是沙箱**——真正的边界是 `runCommand` 这条手开不开。

### 自主解决（P14）

她自己能调 `self.solve({goal})`：看有哪些工具 → 想一个计划 → 试 → 记 → 换办法，**最多 3 次**。

- 成功：写进运行日志，返回结果。
- 失败：try 的每个办法都写进一张 `此路不通-<时间>.md`（标签 `此路不通`），下次别重复。
- 3 次都不行：写一条求助（`状态\自主\求助.json`），面板顶部弹出「我卡住了：<目标> —— <原因>」，点「知道了」清掉。
- 每轮都进行动日志；真动手仍走注册表，手权限与白名单照常生效。

### 登录与登录后的动作

- `browser.login({url})`：开一个**可见**的 Edge 窗口（用她自己的 profile），你登录 B站/抖音/小黑盒，关掉窗口后登录态就留下了。
- 「登录后的动作」这条手默认**关**；打开后才有：
  - `browser.eval({expression})`：在她当前页面执行 JS——点没有文字的按钮、填表、读状态。
  - `bili.like` / `bili.follow` / `bili.comment`：点赞、关注、评论（选择器有多个备选，找不到会明确说「页面结构变了/要登录」）。
- 登录态存在 `状态\浏览器\profile\`；失效时工具提示重新登录，不会硬来。
- 自己的账号：
  - `bili.me`：看登录态、uid、昵称、签名、等级。
  - `bili.api({path, method, body})`：用登录态直接调 B站网页接口，自动带 cookie 与 csrf——改资料、换签名、发动态、回评论都走它。
  - `browser.upload({selector, path})`：把家目录里的图片塞进文件输入框——换背景、传头像、发表情包。
  - 平台改版导致接口/选择器失效时，她可以先用 `browser.eval` 看页面自己改，试三次不行再求助。
- **反风控只做"像人"的部分，不做绕过**：两个写动作至少隔 8 秒、一天最多 30 次写动作（`YCP_ACTION_MIN_MS` / `YCP_ACTION_DAILY_CAP` 可调）；遇到 `-352/-412/-509` 风控码立即停手并报错，不换 IP、不破验证码。

### 桌面窗口与形象（P15）

插件宿主没有 Electron 主进程权限，所以桌宠是**独立 Electron 进程**（`assets/pet/`）：

- Electron 来源：`YCP_ELECTRON` → `~/.dsh/electron/electron.exe`（dsh-pet 已经装过的那份），都没有就明确报错，不自己下载 200MB。
- 窗口：200×200、透明、无边框、置顶、不进任务栏；默认位置在右下角。
- 能做的：按住拖动、松手按速度抛出去（重力 + 碰边反弹 + 摩擦）；点一下有反应（弹一下 + 气泡台词）；右键菜单：聊天 / 动画（待机、游两圈、打个盹）/ 设置 / 收起。
- 面板「外观」区：放她出来 / 收起来 / 开 DSH 时自动；显示窗口位置与被点次数（读 `状态\宠物\窗口.json`）。
- 新形象：`icon.svg` 与面板插图、桌宠都用同一条鱼（大眼、腮红、鳍、气泡）。

### 语音（P16）

用 Windows 自带 SAPI（`System.Speech`）本地合成 WAV，**不联网、不花钱**：

- 音色：系统里有什么列什么（本机是 `Microsoft Huihui Desktop` 中文女声，另有 Zira / David 英文）。
- 语速（−10–10）、音调（−30–30）、音量（0–100）走 SSML `prosody`，全部存 `settings.voice`。
- **声音跟着人设走**：面板「按人设配声音」会读人设——有模型时让模型从已装音色里挑并给语速/音调；没模型时按关键词兜底（软萌→偏高偏慢、嘴贫→偏快、凶→偏低）。
- **语音条**：`/say` 成功后会顺手合成一条 WAV，回复下面出现播放器；打开「回复自动朗读」就自动播。
- 试听、单独音量、静音都在面板「声音」区。
- 文件在 `状态\语音\`，只留最近 50 条；`/voice/file/<名字>` 只认 `voice-*.wav`，目录穿越拿不到。

### 音效与余额（P17）

音效五个，全部**代码生成**（22050Hz/16bit/单声道 WAV，不下载素材），落在 `状态\音效\`：

| 事件 | 什么时候响 |
|---|---|
| `click` | 点桌宠 |
| `speak` | 她回话（没开语音时） |
| `sleep` | 睡觉 |
| `eat` | 吃饭（留给以后） |
| `low` | 余额低于阈值（每次打开面板提示一次） |

面板「音效」区：总开关、音量滑条、五个试听按钮。桌宠自己播 `click`（通过环境变量把 file:// 地址交给它，不走命令行参数）。

**余额**：和 whale 一样从 DSH 凭据取 `DEEPSEEK_API_KEY`，打 `https://api.deepseek.com/user/balance`，取 CNY 钱包；5 分钟缓存，断网时退回上次的值并标明错误。面板「她的今天」下方显示 `¥xx.xx` + 进度条（按 50 元满格），低于 `balance.warnBelow`（默认 10 元）变红并响 `low`。

写操作只认同源；`DSH_YCP_HOME` 可整体换数据根（测试用）。

## 装（等主人下「安装」命令才做）

这一版**不自动安装**。手动装的话：

```text
1. 备份 profile
   %USERPROFILE%\.dsh\profiles\desktop  →  desktop.backup-<时间戳>

2. 链进 profile
   cd %USERPROFILE%\.dsh\profiles\desktop
   pnpm add link:D:\OpenAI\仓库\dsh-Ycp\1.0

3. 加 bundle
   package.json 的 dsh.profile.bundles 加 "dsh-Ycp"

4. 重启
   双击 D:\OpenAI\工作区1\重启Harness.cmd

5. 验证
   日志里出现 [dsh-Ycp] v0.1.0 已加载 · 家 <路径>，左侧边栏出现「大肥鱼」
```

**回滚**：还原 `desktop.backup-<时间戳>` 整个目录 → 重启。

## 目录

```
dsh-Ycp\1.0\
├─ package.json            包清单（bundle 补丁 + client 半）
├─ cordis.patch.yml        Host 行插入
├─ icon.svg                插件图标
├─ locale\{zh,en}.json     插件管理页显示的名字与说明
├─ src\host\index.js       Host 入口：建家、挂接口、打日志
├─ src\host\http.js        6 个接口 + 挂载
├─ src\host\say.js         试说一句：选模型、拼 system、收流
├─ src\host\organs\memory.js  四类记忆：解析 frontmatter、列/读/写/删卡、追加日记
├─ src\host\organs\search.js  检索：打分、top-k、截断、实时必读、拼「你记得的」
├─ src\host\organs\schedule.js  作息：校验、跨夜睡眠、午睡、安静时段、状态文案
├─ src\host\organs\gate.js    五道闸：开关/睡眠/安静/手权限/频率
├─ src\host\organs\mood.js    体力 / 心情 / 饿 + 今日统计
├─ src\host\organs\proactive.js  主动发言：六道闸、抖动、来源、生成与投递
├─ src\host\capabilities\registry.js  工具注册表：注册 / 权限 / 参数校验 / 调用
├─ src\host\capabilities\builtin.js   内置演示工具与占位外观
├─ src\host\capabilities\web.js       上网四件套：查 / 读 / 记 / 想
├─ src\host\capabilities\browser.js   浏览器之手：Edge + CDP、白名单、截图、动作留痕
├─ src\host\capabilities\desktop.js   桌面之手：PowerShell + user32、程序白名单、默认关
├─ src\host\capabilities\desktop.ps1  桌面动作脚本（首次使用时拷到 状态\桌面\）
├─ src\host\capabilities\script.js    脚本之手：读写家目录、跑脚本、跑简单命令
├─ src\host\organs\autonomy.js        自主解决：3 次循环、此路不通、求助
├─ src\host\appearance\pet.js         桌宠：找 Electron、起停窗口、读窗口状态
├─ src\host\appearance\voice.js       声音：音色、合成、按人设配音
├─ src\host\appearance\sound.js       音效：五个短音由代码生成 WAV
├─ src\host\appearance\balance.js     余额：凭据取 key、查 DeepSeek、缓存
├─ assets\pet\                        桌宠窗口（Electron 主进程 / preload / 页面）
├─ assets\voice\tts.ps1               SAPI 合成脚本（首次使用时拷到 状态\语音\）
├─ src\host\kernel\paths.js   路径、默认值、原子写、备份
├─ src\host\kernel\prompt.js  人设 / 名字 / 当下 的 system 拼装
├─ src\client\index.js     Client：侧边栏入口 + 人设 / 试说 / 设置面板
└─ 阶段记忆\               每阶段的交接卡
```

## 设计文档

`DESIGN.md`（总纲）· `PROMPT.md`（施工规矩）· `指令.md`（18 条阶段指令）· `GUIDE.md`（功能总览）

## 许可

MIT
