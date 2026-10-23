# 记忆大脑 · dsh-brain

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加一个「会记事」的大脑：
> **跨对话、跨工作区记住你；上下文快满时自动接班。**

## 它解决什么问题

| 痛点 | 记忆大脑的做法 |
|---|---|
| 每次开新对话，AI 都失忆 | 会话开头自动带上你的画像和项目摘要 |
| 聊久了越聊越贵、越聊越慢 | 只按需注入相关记忆，上下文到 80% 自动交接 |
| 手动整理笔记太麻烦 | 自动写卡、自动归档，全程不用管 |
| 记忆越存越多，检索变糊 | 四层分级 + 定期消化，每条都带来源 |

## 四层记忆

| 层 | 位置 | 作用 |
|---|---|---|
| **全局** | `memory/user-画像.md` 等 3 张卡 | 你是谁、怎么合作、有哪些项目 |
| **项目** | `<工作区>\工作记忆\项目记忆\` | 这个项目定过什么、踩过什么坑 |
| **实时** | `<工作区>\工作记忆\实时记忆\` | 当前任务、下一步，用完即清 |
| **日志** | 同上 `\日志\` | 原始操作记录，只索引不注入 |

**消化方向**：实时 → 项目 →（提炼）全局。记得越久，取用越准。

## 自动接续（核心）

当上下文占用 ≥80%、单轮输入 >150k 或会话超过 60 轮时，自动：

```
写实时记忆 → 建新会话 → 继承模型/模式/权限 → 归档旧会话 → 切过去
```

新会话一开就能接着干，旧会话自动归档（可恢复），列表不会越堆越多。

## 左侧面板

左栏「记忆大脑」里可以：查看/编辑/删除卡片、开关自动接续、调阈值、立即接续、打开记忆目录。

## 安装

```bash
pnpm add dsh-brain
```

在 DSH 设置 → 插件中启用，重启生效。

> 当前是 0.1.0 首个版本，桌面版也可用本地 link 安装。

## 使用

不需要记命令，正常聊天即可。想主动整理时说一句「整理一下记忆」，它会消化实时卡。

## 与 sage-mem 的关系

目录结构与卡片格式沿用 `sage-mem`，可以**直接接管现有记忆库**，不需要迁移；接管后建议卸载 sage-mem，避免重复注入。

## 仓库结构

```
仓库\
└─ dsh-brain\            项目
   ├─ 1.0\               版本 1.0（当前，源码 + 发布包）
   └─ 1.1\               下一版本（按需新建）
```

每个版本目录都是完整可安装的插件：`src/`、`package.json`、`cordis.patch.yml`、`locale/`、`release/`。新版本直接复制上一个版本目录再改。

## 许可

MIT

---

**English**：A memory brain plugin for DeepSeek Harness — layered memory (global / project / working / logs), on-demand injection, automatic hand-off to a new session at 80% context with model and permission inheritance, plus a sidebar panel for managing memory cards.
