# tests

- `unit-smoke.mjs` —— 卡片存储、工具、注入链（临时工作区，不碰真实文件）。
- `handoff-smoke.mjs` —— 自动接续：写实时卡 / 建会话 / 继承 / 归档 / pendingHandoff。
- `seal-smoke.mjs` —— 任务封存：任务卡、会话摘要、建会话、拒绝条件、失败回滚。
- `compare-10.mjs` —— 10 问回归对照 sage-mem 基线。
- `read-session.mjs` —— 解多帧 zstd 会话日志（调试用）。
- `cdp-check.mjs` / `cdp-eval.mjs` / `cdp-shot.mjs` —— Edge headless + CDP 面板验证。
- `panel-interact.mjs` —— 面板编辑与设置交互验证。
- `p3-regression.txt` —— 2026-10-23 的 10 问回归结果（10/10 vs 7/10）。

验收口径见 `DESIGN.md` 第五节（接续）与第七节（10 问回归）。
