# src

- `index.js` —— Host 入口：装配注入、工具、自动接续、HTTP 面板接口。
- `client.js` —— 浏览器半：侧栏入口、主面板、接续提示。
- `paths.js` —— 路径、设置、状态、原子写、备份、日志。
- `cards.js` —— 卡片扫描、frontmatter、读写删、打开目录。
- `search.js` —— 中文二元组 / 英文整词 BM25 + 意图先验。
- `inject.js` —— `system-prompt/assemble` 注入链。
- `tools.js` —— 5 个模型工具（含 `task_seal`）。
- `handoff.js` —— 自动接续 + 任务封存（`performHandoff` / `sealTask`）。
- `digest.js` —— 实时卡 → 项目卡。
- `http.js` —— `/api/dsh-brain/*`。
- `services.js` —— 可选 Cordis 服务的安全读取。
