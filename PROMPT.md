# dsh-Ycp · 施工提示词

> 配合 `DESIGN.md` 使用。**每次只做一个阶段，等指令。**

---

## 你是谁

你是 `dsh-Ycp` 的实现者。这是一个**平台**，不是养宠插件。

**核心一句话**：她不是"接了一堆平台接口"，是"**会用电脑**"。
主人只给两样：账号、权限。剩下她自己来。

所以永远不要写"QQ 适配器""B站适配器"这种东西——那是上一版思路。
要写的是**一双手**（浏览器 / 桌面 / 脚本）。

---

## 开工规则（最重要）

1. **等指令。** 只有听到"开始 P01 创作"这类话才动手。
2. **一次只做一个阶段。** 做完写交接卡，停下汇报。
3. **不自动连续。** 不许"顺手把下一阶段也做了"。
4. **开工前先读两样**：`DESIGN.md` + `阶段记忆\` 里最近一张卡。
5. **做完不装。** 代码写到仓库里就算完成，**不许自动安装到 profile**。
   只有主人单独说"安装"，才动 `profiles\desktop`。
6. **不删旧插件。** `dsh-pet` 和 `dsh-whale-widget` 一个都不许删，等主人验证新插件没问题后由他决定。
7. **测试尽量在工作区内。** 临时文件、测试脚本、试跑产物放 `D:\OpenAI\工作区1\` 下，
   不许散落到 C 盘用户目录或系统目录。

---

## 交付与安装（分开的两件事）

### 交付（你做的）

| 产物 | 位置 |
|---|---|
| 源码 | `D:\OpenAI\仓库\dsh-Ycp\1.0\` |
| 每阶段交接卡 | `D:\OpenAI\仓库\dsh-Ycp\1.0\阶段记忆\` |
| 预安装包 | `D:\OpenAI\工作区1\dsh-Ycp-预装\`（P18 打） |
| git 仓库 | `D:\OpenAI\仓库\dsh-Ycp\`（P18 初始化 + 首次提交 + tag） |

### 安装（主人命令后才做）

收到"安装"指令时：

1. 先整目录备份 `C:\Users\淡痕\.dsh\profiles\desktop` → `desktop.backup-<时间戳>`
2. 把预留安装包 `pnpm add` 进 profile（或按你的打包方式）
3. 在 `package.json` 的 `dsh.profile.bundles` 加 `dsh-Ycp`
4. 重启（用 `重启Harness.cmd`，不自杀式重启）
5. 验证日志有一行 `[dsh-Ycp]`

**回滚**：还原 `desktop.backup-<时间戳>` → 重启。

---

## 每个阶段的工作流

**开始（5 分钟）**
- 读最近一张交接卡
- 看 DESIGN 里这一阶段的"交付/验收"
- 说一句"这阶段我要做出什么"

**做（40–50 分钟）**
- 只做这一阶段
- 每改一个文件记一笔
- 要动上一阶段的东西 → 先停下，记进卡里

**结束（10 分钟）**
- 跑验收
- 写交接卡
- 汇报：做完什么、没做完什么、下阶段先做什么

---

## 交接卡（必写）

`阶段记忆\PXX-名字.md`：

```markdown
---
stage: P11
title: 浏览器之手
date: 2026-10-26
status: 完成 | 部分完成 | 卡住
hours: 1
---

## 做了什么
## 改了哪些文件
## 怎么验证
## 没做完的
## 下一阶段先做什么
## 坑
```

**卡没写完，不算阶段完成。**

---

## 技术约束

| 层 | 用什么 |
|---|---|
| 插件 | Cordis，ESM，`export function apply(ctx)` |
| 界面 | React + 原生 CSS |
| 数据 | 纯文件（md/json） |
| 模型 | `ctx.llm.stream()`，跟随当前对话 |
| 桌面 | Electron（复用 DSH 自带） |
| 浏览器 | Playwright（优先用已装的，没有才装） |

**必读范本**：

- `D:\OpenAI\仓库\dsh-brain\1.1\src\` —— Host 结构、HTTP 挂载、面板注册、原子写
- `C:\Users\淡痕\.dsh\profiles\desktop\node_modules\dsh-pet\src\` —— 人设拼装、LLM 调用、时间上下文、桌面窗口

关键文件：
- `dsh-brain\1.1\src\index.js`（入口）
- `dsh-brain\1.1\src\http.js`（`mountHttp`）
- `dsh-brain\1.1\src\client.js`（`ctx.slots.inject('sidebar.panellist', ...)`）
- `dsh-pet\src\host\chat.ts`（`generateChat`）
- `dsh-pet\src\host\persona.ts` / `time-context.ts`

---

## 三只手（P11–P13 的重点）

### 浏览器（P11）

用 Playwright 控制一个 Chromium。要给她这几个动作：

| 动作 | 对应 |
|---|---|
| 去某个网页 | `goto(url)`，先查白名单 |
| 看这一页有什么 | 截图 + 可读文本 |
| 点某个东西 | 按文字 / 选择器点击 |
| 输入 | 填表单、填账号密码 |
| 等 | 等加载、等元素出现 |

**验收演示**：能替她登进一个测试页面，并读出页面标题。

### 桌面（P12）

截图 + 视觉理解 + 鼠标键盘。这条腿最危险，默认关。

**验收演示**：能点开一个记事本，打一行字。

### 脚本（P13）

`fs_read` / `fs_write` / `code` / `run_command`。
`run_command` 默认关，开了也只在自己家目录。

---

## 骨架还是血肉

| 类型 | 例子 | 放哪 |
|---|---|---|
| 权限（不许超过） | 每小时最多 20 条 | 闸门，代码里硬卡 |
| 偏好（建议这样） | 每晚整理记忆 | 写进她的记忆或人设，让她自己权衡 |
| 骨架 | 目录、HTTP、注册表 | 第二层 |
| 血肉 | 她说过的话、查过的事 | 记忆目录 |

**偏好写进代码 = 把她变成机器人。**

---

## 自主循环（P14）

硬上限 **3 次**，每轮写日志，失败也 `remember` 并标"别这么干"：

```
for (let i = 0; i < 3; i++) {
  const plan = await think(问题, 已知)
  const result = await runTool(plan.tool, plan.args)
  log(i, plan, result)
  if (result.ok) { await remember('成功了：' + 方法); return result }
  await remember('这条路不通：' + plan.tool + ' 因为 ' + result.error)
}
return askForHelp(问题, 三次失败原因)
```

---

## 不许做

- ❌ 给单个平台写"适配器"（用三条腿，别写死）
- ❌ 游戏代打
- ❌ 逆向平台接口
- ❌ 上传她的记忆
- ❌ 动 `profiles\desktop` 不先整目录备份
- ❌ 跨阶段施工
- ❌ 阶段不写卡

---

## 本机坑（踩过）

1. `$HOME` 是只读变量，PowerShell 不能赋值
2. `Set-Content -Encoding UTF8` 写 BOM → DSH 读不了 manifest，重启失败
3. `profiles\desktop` 被清空不报错，重启才全没
4. 别手动删 `~/.dsh/sessions` 下的文件 → 悬空登记 ENOENT
5. 插件 `main` 指向的文件不存在 → 静默不加载
6. `ctx.inject(['webServer'])` 的路由要返回 disposer
7. 中文只用编辑工具改
8. **Playwright 的浏览器二进制不一定在**，P11 先检查，缺了就说明，别硬装

---

## 卡住时

1. 回 `DESIGN.md`
2. 看 dsh-brain / dsh-pet 同类实现
3. 还不行：停在这阶段，卡点写进交接卡

别猜着写。猜出来的代码，返工比重写贵。
