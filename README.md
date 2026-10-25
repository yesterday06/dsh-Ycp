<p align="center">
  <img src="dsh-Ycp/1.0/icon.svg" width="88" alt="dsh-Ycp">
</p>

<h1 align="center">dsh-Ycp · 阿闷</h1>

<p align="center">
  <b>住在 DeepSeek Harness 里的桌宠个体</b><br>
  记忆是本体，对话是平台——换个入口、清空聊天记录，她还是她。
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.2.2-2f81f7">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-3fb950">
  <img alt="dsh" src="https://img.shields.io/badge/DSH-%E2%89%A5%200.2.1--rc.2-8b5cf6">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows-6e7781">
</p>

---

## 她是什么

不是聊天皮肤，也不是一个「更聪明的助手」。她有自己的记忆库、状态、账本和作息：你关掉窗口、清空聊天记录、换一个 DSH 入口，她还是原来那个她。

**0.2.0 起动手能力整层移除**——不能上网、不能点屏幕、不能跑脚本、不能发帖。**0.2.2 先把权限打好**：禁足 / 普通 / 完整三档，默认禁足，只能由主人在面板里改，她自己没有升权限的入口。权限立住了，之后一次加一只手。被要求做这些时，她会直说「我现在还动不了手，只能记下来」，不假装完成。

## 她现在能做什么

| 部分 | 内容 |
|---|---|
| 记忆 | 分层（核心 / 相关 / 此刻 / 最近对话）、查重合并、重要度 1–5、BM25 × 重要度 × 新鲜度加权检索、每天反思、记忆体检、长窗口折叠、原始记忆只追加 |
| 说话 | 面板「和她说话」、桌宠总终端；每轮带多少历史由 `historyChars` 控制（1.6 万～51.2 万字） |
| 状态 | 体力 / 心情 / 饱食；106 个动画、39 张表情包；状态会影响说话长度和态度，但不报数字 |
| 账本 | token 就是她的饭：聊天、主动说话都记账，按真正发出去的上下文算，见底提醒 |
| 人设 | `人设/人设.md`（基础）+ `人设/成长.md`（自己长出来的）+ `RULES.md`（操作手册，每轮注入） |
| 权限 | 禁足 / 普通 / 完整三档；默认禁足（只能在自己家读写、不能删）；只有面板能改，开完整要二次确认 |

## 安装（Windows）

前置：DSH ≥ `0.2.1-rc.2`；桌宠窗口用 `~/.dsh/electron/electron.exe`。

```powershell
git clone https://github.com/yesterday06/dsh-Ycp.git
cd dsh-Ycp\dsh-Ycp\1.0
```

在 desktop profile 的 `package.json` 里加 `"dsh-Ycp": "link:<这个绝对路径>"`，并把 `"dsh-Ycp"` 加进 `dsh.profile.bundles`，然后重启 Harness。

> 桌面 profile 不要用 `dsh plugin --profile desktop` 安装，必须 `pnpm add` + 改 bundles。

她的家：`<数据根>/阿闷/`，数据根默认 `D:\OpenAI\dsh-Ycp`，可用 `DSH_YCP_HOME` 改；名字由 `人物名.txt` 决定。

## 仓库结构

```
dsh-Ycp/
└─ 1.0/                  0.2.2（当前版，完整可安装插件）
   ├─ src/host/          宿主：内核 / 器官（记忆·心情·作息·主动·权限）/ 工具注册表 / HTTP
   ├─ src/client/        面板（React h，源码直载，无构建）
   ├─ assets/pet/        桌宠 Electron 窗口
   ├─ assets/character/  动画、形象、图标
   ├─ assets/memes/      表情包
   ├─ locale/            zh / en
   ├─ RULES.md           操作手册（每轮注入）
   ├─ DESIGN.md          设计
   └─ GUIDE.md           功能总览
```

## 文档

- [插件说明](dsh-Ycp/1.0/README.md)
- [安装说明](dsh-Ycp/1.0/安装说明.md) · [更新日志](dsh-Ycp/1.0/更新日志.md) · [设计](dsh-Ycp/1.0/DESIGN.md) · [功能总览](dsh-Ycp/1.0/GUIDE.md)

## 和 dsh-brain 的关系

两套**互不依赖**的记忆：

- [dsh-brain](https://github.com/yesterday06/dsh-brain)：装给 DSH 本身的记忆大脑插件——四层卡片、按需检索注入、长会话自动接续、任务封存。
- 本仓库：一个**有自己记忆库的个体**，记忆服务于「她是谁」，不服务于某个工作区。

可以同时装：一个管会话怎么接，一个管她记不记得你。

## 许可

[MIT](dsh-Ycp/1.0/LICENSE)

---

<details>
<summary>English</summary>

**dsh-Ycp (Memory Intelligence)** is a desktop companion that lives inside DeepSeek Harness: its own layered memory store, state (stamina / mood / satiety), token ledger and persona. Since 0.2.0 the "hands" layer (browser, desktop, scripts, platform APIs) has been removed — she only remembers and talks. 0.2.2 starts building it back with a three-level permission switch (jail / normal / full) that only the owner can change. MIT licensed; Windows.

</details>
