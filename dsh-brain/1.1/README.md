# dsh-brain · 记忆大脑

DeepSeek Harness 插件：**四层记忆 + 每轮检索注入 + 自动接续 + 任务封存 + 左侧边栏记忆面板**。
目录与卡片格式沿用 `sage-mem`，可以直接接管现有记忆库，不需要迁移。

- 包名：`dsh-brain`
- 面板名：**记忆大脑**
- 版本：**0.2.0**（对应仓库 `1.1/`）
- 兼容：DSH `>= 0.2.1-rc.2`，Node `>= 22.19`
- 许可：MIT

## 功能

### 1. 四层记忆

| 层 | 位置 | 用途 |
|---|---|---|
| 全局 | `~/.sage-mem/memory/`（默认，可用 `SAGE_MEM_DIR` / `DSH_BRAIN_GLOBAL_DIR` 改） | 用户画像、项目索引、机器环境等跨项目卡 |
| 项目 | `<工作区>/工作记忆/项目记忆/` | `00-概况` / `01-决定` / `02-坑` |
| 实时 | `<工作区>/工作记忆/实时记忆/当前任务.md` | 当前任务进展 |
| 日志 | `<工作区>/工作记忆/实时记忆/日志/` | 操作留痕、会话摘要，不参与注入 |

### 2. 注入

- 每个会话首步：`baseline: true` 的卡（通常是用户画像）全文，默认 ≤1300 字；再带当前工作区 `00-概况` 摘要 ≤120 字。
- 之后每步：中文二元组 + 英文整词的 BM25，取 top-2，单卡 ≤600 字；0 命中不注入。
- 每轮总预算默认 2400 字（约 800 token），超了截断并在 `brain.log` 记一笔。
- 压缩 / 清空后 baseline 允许重新注入一次。

### 3. 5 个工具

| 工具 | 作用 |
|---|---|
| `memory_search` | 检索全局 / 项目 / 实时卡，返回层级、文件名、分数、片段 |
| `memory_read` | 按文件名读全文，支持 `from` / `lines` 分页 |
| `memory_write` | 写全局 / 项目 / 实时卡，写前自动备份旧内容 |
| `memory_digest` | 实时卡 → 项目卡（优先 `01-决定.md`），同内容哈希判重 |
| `task_seal` | **任务封存**：写任务卡 + 会话摘要 → 建新会话 → 归档旧的（0.2.0） |

### 4. 任务封存（0.2.0）

任务收尾时调用 `task_seal`，把「这次干完了什么」炼成卡片，然后开一个干净会话。

参数：

```js
{
  task: "一句话任务名",
  done: ["已完成 3–6 条，带结果"],
  decisions: ["为什么这么做，备选是什么"],
  files: [{ path: "绝对路径", change: "改了什么" }],
  next: ["下一步 1–3 条"],
  pitfalls: ["踩过的坑"],
  commands: ["关键命令原文"]
}
```

动作：写 `当前任务.md`（≤800 字）→ 写会话摘要（不限长度，`日志/会话摘要/`）→
建新会话并继承 provider / model / reasoningEffort 与三项权限 → 归档旧会话 → 面板跳转。

新会话首步注入任务卡全文（预算 `firstStepChars`，默认 1500 字），所以它一开口就知道前情和下一步。

拒绝条件（任一即拒绝）：有未完成工具调用、上一轮有未完成 tool_call、会话轮次 < 2、5 秒内重复调用。
失败处理：写卡失败中止；建会话失败保留卡片并标 `封存失败`；归档失败不阻塞。

### 5. 自动接续（兜底）

触发（任一，同一个会话只触发一次）：

- 上下文 ≥ 阈值（默认 80%）；
- 单轮 input > 150k token；
- 会话 > 60 轮。

动作顺序：写 `当前任务.md` → 建新会话 → 继承 provider / model / reasoningEffort → 继承 `permission/preset`、`sandbox/mode`、`approval/policy` → 归档旧会话 → 通知面板导航。
不删会话，不代发首条消息，正在生成时等本轮结束。

### 6. 左侧边栏「记忆大脑」

- 全局卡片列表：名称、描述、字数、时间；查看 / 编辑 / 删除。
- 当前工作区项目卡：三张卡的查看 / 编辑。
- 实时卡只读预览。
- 开关：自动接续、阈值、top-k、单卡上限、每轮总预算。
- 按钮：立即接续、立即封存、立即消化、打开记忆目录、打开工作区。
- 状态：上次注入 token、上次接续、上次封存、卡片总数。

## 安装

在 profile 目录里：

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add link:D:\path\to\dsh-brain\1.1
```

把 `D:\path\to\dsh-brain\1.1` 换成本仓库所在目录。然后把 `"dsh-brain"` 加进 `package.json` 的 `dsh.profile.bundles`，重启 DSH。
改 profile 前先备份 `package.json`。

> 桌面 profile 不要用 `dsh plugin --profile desktop` 安装；必须 `pnpm add` + 改 bundles。

## 配置

设置存在 `%USERPROFILE%\.dsh\brain\settings.json`，面板改完立即生效：

```json
{
  "autopilot": true,
  "threshold": 80,
  "topK": 2,
  "maxChars": 600,
  "baselineChars": 1300,
  "summaryChars": 120,
  "maxRoundChars": 2400,
  "firstStepChars": 1500
}
```

环境变量：

| 变量 | 作用 |
|---|---|
| `SAGE_MEM_DIR` / `DSH_BRAIN_GLOBAL_DIR` | 全局记忆目录 |
| `DSH_BRAIN_STATE_DIR` | 插件状态、备份、日志目录（默认 `~/.dsh/brain`） |
| `DSH_BRAIN_DEBUG=1` | 写高频调试日志 |

## 架构

```
src/index.js    Host 半：装配注入、工具、自动接续、HTTP 面板接口
src/client.js   Client 半：sidebar.panellist + main 面板 + shell.overlay 接续提示
src/paths.js    路径、设置、状态、原子写、备份、日志
src/cards.js    卡片扫描、frontmatter、读写删、打开目录
src/search.js   中文二元组 / 英文整词 BM25 + 少量意图先验
src/inject.js   system-prompt/assemble 注入链（含封存首步任务卡）
src/tools.js    5 个模型工具
src/handoff.js  自动接续 + 任务封存
src/digest.js   实时 → 项目
src/http.js     /api/dsh-brain/* 面板与动作接口
```

面板数据走 Host 的 `/api/dsh-brain/*`，浏览器不直接读文件。

## 回滚

1. 从 `dsh.profile.bundles` 移除 `dsh-brain`；
2. `pnpm remove dsh-brain`；
3. 需要回到 0.1.0 或 sage-mem：把 profile 的 link 指回 `1.0`，或还原备份的 `package.json` 后 `pnpm add sage-mem@1.6.1`，重启。

记忆文件不受影响：插件只读写原有 markdown 目录，覆盖 / 删除前都会在 `~/.dsh/brain/backups/` 留备份。

## 开发

- 模块职责见 `src/README.md`。
- 测试见 `tests/README.md`；封存流程用 `node tests/seal-smoke.mjs`。
- 发布包只带运行所需文件（见 `package.json` 的 `files`），开发文件不进包。
