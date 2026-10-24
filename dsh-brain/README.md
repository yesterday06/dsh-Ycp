<p align="center">
  <img src="1.1/icon.svg" width="88" alt="dsh-brain">
</p>

<h1 align="center">dsh-brain · 记忆大脑</h1>

<p align="center">
  <b>给 DeepSeek Harness 的四层记忆系统</b><br>
  按需检索、自动接续、任务封存——让每个新会话都从「结论」开始，而不是从「历史」开始。
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.2.0-2f81f7">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-3fb950">
  <img alt="dsh" src="https://img.shields.io/badge/DSH-%E2%89%A5%200.2.1--rc.2-8b5cf6">
</p>

---

## 它解决什么问题

| 问题 | 常见做法 | dsh-brain |
|---|---|---|
| 会话越聊越长，每次请求都在为历史付费 | 手动开新对话，靠人复述 | 任务干完就 **封存**：上下文从 36 万 token 降到 1 万左右 |
| 记忆散落在聊天记录里，找不回来 | 全文塞进系统提示 | **四层卡片 + BM25 检索**，每轮只注入相关的 2 张 |
| 换个会话就「失忆」 | 复制粘贴摘要 | 自动接续 + 任务卡，新会话首步就知道干到哪了 |
| 已有 sage-mem 记忆库不想迁移 | 重写迁移脚本 | 目录和卡片格式**完全沿用**，换插件不用动数据 |

一句话：**记忆是本体，会话是工作台。** 工作台用完就换，本体一直留着。

## 核心功能

### 1. 四层记忆

| 层 | 位置 | 用途 |
|---|---|---|
| 全局 | `~/.sage-mem/memory/`（可用 `SAGE_MEM_DIR` / `DSH_BRAIN_GLOBAL_DIR` 改） | 用户画像、机器环境、跨项目索引 |
| 项目 | `<工作区>/工作记忆/项目记忆/` | `00-概况` / `01-决定` / `02-坑` |
| 实时 | `<工作区>/工作记忆/实时记忆/当前任务.md` | 当前任务进展 |
| 日志 | `<工作区>/工作记忆/实时记忆/日志/` | 操作留痕、会话摘要，不参与注入 |

### 2. 按需注入，不烧 token

- 每个会话首步：`baseline: true` 的卡（通常是用户画像）全文（默认 ≤1300 字）+ 当前工作区概况（≤120 字）。
- 之后每步：中文二元组 + 英文整词的 BM25，取 top-2，单卡 ≤600 字，0 命中不注入。
- 每轮总预算 2400 字（约 800 token），超了截断并在 `brain.log` 记一笔。

### 3. 自动接续（兜底）

上下文 ≥ 阈值（默认 80%）、单轮 >150k token、或会话 >60 轮时自动触发：
写任务卡 → 建新会话 → 继承模型与权限 → 归档旧会话 → 面板跳转。
不删会话、不代发消息、生成中不切换。

### 4. 任务封存 `task_seal`（0.2.0 新增，主路径）

agent 在任务收尾时主动调用，一次做完三件事：

1. 写 **任务卡**（≤800 字，固定结构：任务 / 已完成 / 关键决定 / 涉及文件 / 下一步 / 坑 / 恢复命令）；
2. 写 **会话摘要**（不限长度，保留原始需求、过程、报错原文、回滚方法，不注入、不占上下文）；
3. 建新会话并归档旧的，新会话首步直接注入任务卡全文（预算 1500 字）。

> 实测：36 万 token 的会话每次请求约 ¥0.014；封存后新会话约 1 万 token，每次 ¥0.001–0.004。
> 封存本身约 ¥0.002。

安全阀：有未完成的工具调用、轮次 < 2、5 秒内重复调用，都会被拒绝；写卡失败则旧会话保持不变。

### 5. 侧栏面板「记忆大脑」

查看 / 编辑 / 删除全局卡与项目卡，实时卡只读预览；
开关自动接续，调阈值、top-k、单卡上限、每轮预算；
按钮：立即接续、立即封存、打开记忆目录。

![记忆大脑面板](docs/panel.png)

## 快速开始

**前置**：DSH ≥ `0.2.1-rc.2`，Node ≥ 22.19。

```powershell
git clone https://github.com/yesterday06/dsh-brain.git
```

装进桌面 profile（先备份 `package.json`）：

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add link:D:\path\to\dsh-brain\1.1
```

然后把 `"dsh-brain"` 加进 `package.json` 的 `dsh.profile.bundles`，重启 DSH。

> 手动装插件时不要用 `dsh plugin --profile desktop`；桌面 profile 需要 `pnpm add` + 改 bundles。

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

| 环境变量 | 作用 |
|---|---|
| `SAGE_MEM_DIR` / `DSH_BRAIN_GLOBAL_DIR` | 全局记忆目录 |
| `DSH_BRAIN_STATE_DIR` | 状态、备份、日志目录（默认 `~/.dsh/brain`） |
| `DSH_BRAIN_DEBUG=1` | 高频调试日志 |

## 仓库结构

```
dsh-brain/
├─ 1.0/          0.1.0：首个公开版
└─ 1.1/          0.2.0：当前版（任务封存 + 会话摘要 + 5 个工具）
   ├─ src/       Host 与 Client 源码
   ├─ locale/    zh / en
   ├─ tests/     单元、接续、封存、回归、面板验证
   ├─ release/   打包产物与构建记录
   ├─ DESIGN.md      1.0 设计
   └─ DESIGN-1.1.md  任务封存设计
```

每个版本目录都是**完整可安装插件**：`package.json`、`src/`、`locale/`、`cordis.patch.yml`、`README.md`、`LICENSE`。

## 版本

| 目录 | 版本 | 日期 | 主要变化 |
|---|---|---|---|
| `1.0/` | 0.1.0 | 2026-10-23 | 四层记忆、检索注入、自动接续、面板 |
| `1.1/` | 0.2.0 | 2026-10-24 | `task_seal` 任务封存、会话摘要、5 个工具、首步任务卡注入 |

变更明细见 [CHANGELOG.md](CHANGELOG.md)。

## 设计文档

- [1.1/DESIGN.md](1.1/DESIGN.md) —— 1.0 的四层记忆、注入、接续设计
- [1.1/DESIGN-1.1.md](1.1/DESIGN-1.1.md) —— 任务封存（为什么、任务卡结构、失败处理、成本）
- [1.1/src/README.md](1.1/src/README.md) —— 模块职责

## 开发与测试

```powershell
cd 1.1
node tests/unit-smoke.mjs      # 卡片存储 + 工具 + 注入链
node tests/handoff-smoke.mjs   # 自动接续
node tests/seal-smoke.mjs      # 任务封存（0.2.0）
```

回归对照（10 问）：`tests/compare-10.mjs`，历史结果在 `tests/p3-regression.txt`（dsh-brain 10/10，sage-mem 基线 7/10）。

## 兼容性

- DSH：`>= 0.2.1-rc.2`（`package.json` 的 `dsh.compatibility` 已声明）
- 平台：Windows / macOS / Linux（纯 Node，无原生依赖）
- 与 sage-mem 共存：**不要同时启用**（会双份注入、写冲突）；切换只需改 `dsh.profile.bundles`

## 许可

[MIT](1.1/LICENSE)

---

<details>
<summary>English</summary>

**dsh-brain** is a memory plugin for [DeepSeek Harness](https://github.com/deepseek-ai). It keeps a four-layer
markdown card store (global / project / live / log), injects only the relevant cards each turn via BM25
(Chinese bigrams + English words), hands off long sessions automatically, and — new in 0.2.0 — seals a finished
task into a compact card plus a full session summary before opening a clean session. Card format and directory
layout are compatible with `sage-mem`, so existing memory stores work without migration.

</details>
