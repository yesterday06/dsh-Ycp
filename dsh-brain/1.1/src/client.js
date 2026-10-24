/**
 * dsh-brain · 记忆大脑（Client 半）。
 *
 * 左侧边栏一个「记忆大脑」入口 + 一个主面板：
 *   - 全局 3 张卡 / 当前工作区项目卡 / 实时卡预览
 *   - 查看、编辑、删除、打开目录
 *   - 自动接续开关、阈值、top-k、单卡上限
 *   - 立即接续 / 立即消化
 *   - 自动接续完成后由 shell.overlay 里的 watcher 导航到新会话并提示
 *
 * 数据全部走 Host 的 /api/dsh-brain/*，不在浏览器里读文件。
 */
window.__ModuleLoader__.load({
  id: 'dsh-brain',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/api/dsh-brain'
    const CSS = `
      .db-panel { height:100%; overflow:auto; padding:20px 22px 40px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font-size:13px; line-height:1.55; }
      .db-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:6px; }
      .db-title { font-size:18px; font-weight:650; letter-spacing:.2px; }
      .db-sub { color:var(--dsw-alias-label-secondary); font-size:12px; }
      .db-toolbar { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 18px; }
      .db-btn { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:7px; padding:5px 11px; font-size:12px; cursor:pointer; }
      .db-btn:hover { border-color:var(--dsw-alias-brand-primary); }
      .db-btn[disabled] { opacity:.5; cursor:not-allowed; }
      .db-btn.primary { background:#247bbf; border-color:#247bbf; color:#fff; font-weight:600; }
      .db-btn.primary:hover { background:#2c8fd0; border-color:#2c8fd0; }
      .db-btn.danger { color:var(--dsw-alias-state-error-primary); }
      .db-btn.small { padding:2px 8px; font-size:11px; }
      .db-section { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:12px 14px; margin-bottom:14px; }
      .db-section-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:8px; }
      .db-section-title { font-size:13px; font-weight:650; }
      .db-path { color:var(--dsw-alias-label-secondary); font-size:11px; word-break:break-all; }
      .db-row { display:flex; align-items:flex-start; gap:10px; padding:9px 0; border-top:1px solid var(--dsw-alias-border-l1); }
      .db-row:first-of-type { border-top:0; }
      .db-row-main { flex:1; min-width:0; }
      .db-row-title { font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .db-row-desc { color:var(--dsw-alias-label-secondary); font-size:12px; margin-top:2px; word-break:break-word; }
      .db-row-meta { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:3px; }
      .db-row-actions { display:flex; gap:6px; flex-shrink:0; }
      .db-badge { font-size:10px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; padding:0 6px; color:var(--dsw-alias-label-secondary); }
      .db-badge.on { color:var(--dsw-alias-state-success-primary); border-color:currentColor; }
      .db-empty { color:var(--dsw-alias-label-secondary); font-size:12px; padding:6px 0; }
      .db-editor { border:1px solid var(--dsw-alias-brand-primary); border-radius:10px; background:var(--dsw-alias-bg-layer-2); padding:12px 14px; margin-bottom:14px; }
      .db-editor textarea { width:100%; min-height:220px; resize:vertical; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:10px; font-family:ui-monospace,Consolas,monospace; font-size:12px; line-height:1.5; }
      .db-editor-actions { display:flex; gap:8px; margin-top:8px; }
      .db-settings { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px 14px; }
      .db-field { display:flex; flex-direction:column; gap:3px; }
      .db-field label { font-size:11px; color:var(--dsw-alias-label-secondary); }
      .db-field input[type=number] { width:100%; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:5px 8px; font-size:12px; }
      .db-switch { display:flex; align-items:center; gap:8px; font-size:12px; }
      .db-error { color:var(--dsw-alias-state-error-primary); font-size:12px; margin:8px 0; white-space:pre-wrap; }
      .db-ok { color:var(--dsw-alias-state-success-primary); font-size:12px; }
      .db-status { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px 18px; font-size:12px; }
      .db-status b { font-weight:600; }
      .db-pending { border:1px solid var(--dsw-alias-state-warn-primary); border-radius:8px; padding:8px 10px; margin-bottom:12px; font-size:12px; color:var(--dsw-alias-state-warn-primary); }
      .db-toast { position:fixed; right:22px; bottom:22px; z-index:2147483000; background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:10px 14px; box-shadow:0 8px 28px rgba(0,0,0,.28); font-size:13px; }
      .db-pre { white-space:pre-wrap; word-break:break-word; font-size:12px; color:var(--dsw-alias-label-secondary); max-height:140px; overflow:auto; }
    `

    async function api(path, options) {
      const response = await fetch(API + path, {
        cache: 'no-store',
        ...options,
        headers: {
          ...(options && options.body ? { 'content-type': 'application/json' } : {}),
          ...((options && options.headers) || {}),
        },
      })
      let data = null
      try { data = await response.json() } catch { data = null }
      if (!response.ok || !data || data.ok === false) {
        throw new Error((data && data.error) || `HTTP ${response.status}`)
      }
      return data
    }

    const getState = () => api('/state')
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

    function fmt(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }

    function num(value, fallback) {
      const n = Number(value)
      return Number.isFinite(n) ? n : fallback
    }

    function Button(props) {
      return h('button', {
        type: 'button',
        className: `db-btn${props.kind ? ` ${props.kind}` : ''}${props.small ? ' small' : ''}`,
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title,
      }, props.children)
    }

    function BrainIcon(props) {
      const size = props.size || 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block', opacity: props.active ? 1 : 0.82 },
      },
        h('path', {
          d: 'M12 4.4c-1.3 0-2.4.7-3 1.7-1.4.1-2.5 1.3-2.5 2.8 0 .4.1.8.3 1.2-.7.5-1.1 1.3-1.1 2.2 0 1.5 1.2 2.7 2.7 2.7h.2c.4 1.1 1.4 1.9 2.6 1.9.6 0 1.2-.2 1.6-.6.4.4 1 .6 1.6.6 1.2 0 2.2-.8 2.6-1.9h.2c1.5 0 2.7-1.2 2.7-2.7 0-.9-.4-1.7-1.1-2.2.2-.4.3-.8.3-1.2 0-1.5-1.1-2.7-2.5-2.8-.6-1-1.7-1.7-3-1.7z',
          stroke: 'currentColor',
          strokeWidth: 1.45,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M12 6.2v11.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: 0.65 }),
        h('circle', { cx: 9.2, cy: 10.2, r: 1.05, fill: 'currentColor' }),
        h('circle', { cx: 14.8, cy: 9.4, r: 1.05, fill: 'currentColor' }),
        h('circle', { cx: 12, cy: 14.6, r: 1.05, fill: 'currentColor' }),
        h('path', { d: 'M9.2 10.2l5.6-.8M9.2 10.2l2.8 4.4M14.8 9.4l-2.8 5.2', stroke: 'currentColor', strokeWidth: 0.9, opacity: 0.55 }),
      )
    }

    function CardRow(props) {
      const card = props.card
      return h('div', { className: 'db-row' },
        h('div', { className: 'db-row-main' },
          h('div', { className: 'db-row-title' },
            card.title || card.file,
            h('span', { className: 'db-badge' }, card.layer),
            card.baseline ? h('span', { className: 'db-badge on' }, 'baseline') : null,
          ),
          card.description ? h('div', { className: 'db-row-desc' }, card.description) : null,
          h('div', { className: 'db-row-meta' },
            `${card.file} · ${card.chars} 字 · ${card.mtime || fmt(card.mtimeMs)}`,
            card.layer === 'global' ? '' : null,
          ),
        ),
        h('div', { className: 'db-row-actions' },
          h(Button, { small: true, onClick: () => props.onRead(card) }, '查看'),
          h(Button, { small: true, onClick: () => props.onEdit(card) }, '编辑'),
          h(Button, { small: true, kind: 'danger', onClick: () => props.onDelete(card) }, '删除'),
        ),
      )
    }

    function Editor(props) {
      const [text, setText] = React.useState(props.editor.content)
      React.useEffect(() => { setText(props.editor.content) }, [props.editor])
      const dirty = text !== props.editor.content
      return h('div', { className: 'db-editor' },
        h('div', { className: 'db-section-head' },
          h('div', { className: 'db-section-title' }, `${props.editor.layer} / ${props.editor.file}`),
          h('div', { className: 'db-row-actions' },
            h(Button, { small: true, onClick: props.onClose }, '关闭'),
            h(Button, { small: true, kind: 'primary', disabled: props.busy || !dirty, onClick: () => props.onSave(text) }, props.busy ? '保存中…' : '保存'),
          ),
        ),
        h('textarea', {
          value: text,
          spellCheck: false,
          onChange: (event) => setText(event.target.value),
        }),
        props.editor.readOnly ? h('div', { className: 'db-row-meta' }, '只读预览；点「保存」会整份覆盖。') : null,
      )
    }

    function Settings(props) {
      const settings = props.settings
      return h('div', null,
        h('div', { className: 'db-settings' },
          h('div', { className: 'db-field' },
            h('label', null, '自动接续'),
            h('label', { className: 'db-switch' },
              h('input', {
                type: 'checkbox',
                checked: settings.autopilot === true,
                onChange: (event) => props.onChange({ ...settings, autopilot: event.target.checked }),
              }),
              settings.autopilot ? '开（到阈值自动开新会话）' : '关（只手动）',
            ),
          ),
          h('div', { className: 'db-field' },
            h('label', null, '阈值（%）'),
            h('input', {
              type: 'number', min: 1, max: 100, value: settings.threshold,
              onChange: (event) => props.onChange({ ...settings, threshold: num(event.target.value, settings.threshold) }),
            }),
          ),
          h('div', { className: 'db-field' },
            h('label', null, '每轮 top-k'),
            h('input', {
              type: 'number', min: 1, max: 5, value: settings.topK,
              onChange: (event) => props.onChange({ ...settings, topK: num(event.target.value, settings.topK) }),
            }),
          ),
          h('div', { className: 'db-field' },
            h('label', null, '单卡上限（字）'),
            h('input', {
              type: 'number', min: 100, max: 3000, value: settings.maxChars,
              onChange: (event) => props.onChange({ ...settings, maxChars: num(event.target.value, settings.maxChars) }),
            }),
          ),
          h('div', { className: 'db-field' },
            h('label', null, '每轮总预算（字）'),
            h('input', {
              type: 'number', min: 400, max: 8000, value: settings.maxRoundChars,
              onChange: (event) => props.onChange({ ...settings, maxRoundChars: num(event.target.value, settings.maxRoundChars) }),
            }),
          ),
        ),
        h('div', { className: 'db-editor-actions' },
          h(Button, { kind: 'primary', disabled: props.busy, onClick: props.onSave }, props.busy ? '保存中…' : '保存设置'),
          h(Button, { onClick: () => props.onChange(null) }, '恢复当前值'),
        ),
      )
    }

    function Status(props) {
      const status = props.status || {}
      const last = status.lastInjection
      const handoff = status.lastHandoff
      return h('div', { className: 'db-status' },
        h('div', null, h('b', null, '注入：'), last ? `${fmt(last.at)} · 约 ${last.tokens} token · ${(last.files || []).join('、') || '仅 baseline'}` : '还没有注入记录'),
        h('div', null, h('b', null, '上次接续：'), handoff ? `${fmt(handoff.at)} · ${String(handoff.from).slice(0, 12)} → ${String(handoff.to).slice(0, 12)}` : '无'),
        h('div', null, h('b', null, '上次封存：'), handoff && handoff.kind === 'seal'
          ? `${fmt(handoff.at)} · ${handoff.seal?.task ?? '（未命名任务）'}${handoff.seal?.summary ? ' · 摘要已写' : ' · 摘要缺失'}`
          : '无'),
        h('div', null, h('b', null, '归档旧会话：'), handoff ? (handoff.archived ? '成功' : '未成功（不阻塞）') : '—'),
        h('div', null, h('b', null, '卡片总数：'), `${status.cardCount ?? 0}`),
        h('div', null, h('b', null, '模型继承：'), handoff && handoff.model ? `${handoff.model.provider}/${handoff.model.model}` : '—'),
        h('div', null, h('b', null, '权限继承：'), handoff && handoff.permission ? [handoff.permission.preset, handoff.permission.sandbox, handoff.permission.approval].filter(Boolean).join(' · ') || '—' : '—'),
      )
    }

    function Panel(props) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [editor, setEditor] = React.useState(null)
      const [draft, setDraft] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const next = await getState()
          setData(next)
          setError('')
          setDraft((current) => current || { ...next.settings })
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        const tick = () => { if (alive) load() }
        tick()
        const timer = setInterval(tick, 6000)
        return () => { alive = false; clearInterval(timer) }
      }, [load])

      const withBusy = async (label, fn) => {
        setBusy(label)
        setError('')
        setNotice('')
        try {
          await fn()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy('')
        }
      }

      const openCard = (card) => withBusy('read', async () => {
        const result = await post('/card', { action: 'read', layer: card.layer, file: card.file })
        setEditor({ layer: card.layer, file: card.file, content: result.content, readOnly: false })
      })

      const saveCard = (content) => withBusy('save', async () => {
        await post('/card', { action: 'write', layer: editor.layer, file: editor.file, content })
        setEditor(null)
        setNotice(`已保存 ${editor.file}`)
        await load()
      })

      const deleteCard = (card) => {
        if (typeof window !== 'undefined' && !window.confirm(`删除 ${card.file}？\n旧内容会备份到 DSH 状态目录。`)) return
        withBusy('delete', async () => {
          await post('/card', { action: 'delete', layer: card.layer, file: card.file })
          setNotice(`已删除 ${card.file}（可回滚：备份在 brain/backups）`)
          await load()
        })
      }

      const saveSettings = (next) => withBusy('settings', async () => {
        const result = await post('/settings', next)
        setDraft({ ...result.settings })
        setData((current) => current ? { ...current, settings: result.settings } : current)
        setNotice('设置已生效')
        await load()
      })

      const doSeal = () => withBusy('seal', async () => {
        if (typeof window !== 'undefined') {
          if (!window.confirm('封存并开新会话？\n会写任务卡（≤800 字）+ 会话摘要，建新会话并归档当前会话。')) return
        }
        const result = await post('/seal', {})
        const to = String((result.handoff && result.handoff.to) || '').slice(0, 16)
        setNotice(`已封存${to ? `：${to}` : ''} · 任务卡 ${result.card?.chars ?? 0} 字${result.summary ? ' · 摘要已写' : ''}`)
        await load()
      })

      const doAction = (action, extra) => withBusy(action, async () => {
        if (action === 'handoff' && typeof window !== 'undefined') {
          if (!window.confirm('立即接续？会写实时记忆、建新会话并归档当前会话。')) return
        }
        const result = await post('/action', { action, ...(extra || {}) })
        if (action === 'handoff') setNotice(`已接续：${String(result.handoff && result.handoff.to).slice(0, 16)}`)
        else if (action === 'digest') setNotice(`已消化到 ${result.target || '项目卡'}`)
        else if (action === 'openDir') setNotice(`已打开：${result.dir || ''}`)
        await load()
      })

      if (!data) {
        return h('div', { className: 'db-panel' },
          h('div', { className: 'db-title' }, '记忆大脑'),
          error ? h('div', { className: 'db-error' }, error) : h('div', { className: 'db-empty' }, '读取中…'),
        )
      }

      const status = data.status || {}
      return h('div', { className: 'db-panel' },
        h('div', { className: 'db-head' },
          h('div', { className: 'db-title' }, '记忆大脑'),
          h('div', { className: 'db-sub' }, `v${data.version || '0.1.0'} · 全局 ${data.globalSource}`),
        ),
        h('div', { className: 'db-toolbar' },
          h(Button, { kind: 'primary', disabled: Boolean(busy), onClick: doSeal }, busy === 'seal' ? '封存中…' : '封存并开新会话'),
          h(Button, { disabled: Boolean(busy), onClick: () => doAction('handoff') }, '立即接续'),
          h(Button, { disabled: Boolean(busy), onClick: () => doAction('digest') }, '立即消化'),
          h(Button, { onClick: () => doAction('openDir', { target: 'global' }) }, '打开记忆目录'),
          h(Button, { onClick: () => doAction('openDir', { target: 'workspace' }) }, '打开工作区'),
          h(Button, { onClick: load }, '刷新'),
        ),
        error ? h('div', { className: 'db-error' }, error) : null,
        notice ? h('div', { className: 'db-ok' }, notice) : null,
        status.pendingHandoff ? h('div', { className: 'db-pending' },
          `待切换：${String(status.pendingHandoff.from).slice(0, 14)} → ${String(status.pendingHandoff.to).slice(0, 14)}。若页面没自动跳转，点此处。`,
          h('button', {
            className: 'db-btn small', style: { marginLeft: 8 }, type: 'button',
            onClick: () => {
              try { props.brainCtx && props.brainCtx.uiWorkspace && props.brainCtx.uiWorkspace.openSession(status.pendingHandoff.to) } catch { /* 忽略 */ }
            },
          }, '去新会话'),
        ) : null,
        editor ? h(Editor, {
          editor,
          busy: busy === 'save',
          onClose: () => setEditor(null),
          onSave: saveCard,
        }) : null,
        h('section', { className: 'db-section' },
          h('div', { className: 'db-section-head' },
            h('div', { className: 'db-section-title' }, `全局卡片（${data.global.length}）`),
            h('div', { className: 'db-path' }, data.globalDir),
          ),
          data.global.length === 0
            ? h('div', { className: 'db-empty' }, '全局目录里还没有 .md 卡片')
            : data.global.map((card) => h(CardRow, { key: card.file, card, onRead: openCard, onEdit: openCard, onDelete: deleteCard })),
        ),
        h('section', { className: 'db-section' },
          h('div', { className: 'db-section-head' },
            h('div', { className: 'db-section-title' }, `项目卡片（${data.project.length}）`),
            h('div', { className: 'db-path' }, data.workspace),
          ),
          data.project.length === 0
            ? h('div', { className: 'db-empty' }, '当前工作区没有 工作记忆/项目记忆/ 卡片')
            : data.project.map((card) => h(CardRow, { key: card.file, card, onRead: openCard, onEdit: openCard, onDelete: deleteCard })),
        ),
        h('section', { className: 'db-section' },
          h('div', { className: 'db-section-head' },
            h('div', { className: 'db-section-title' }, '实时卡（只读预览）'),
            h('div', { className: 'db-path' }, data.realtime ? data.realtime.file : '当前任务.md'),
          ),
          data.realtime
            ? h('div', null,
                h('div', { className: 'db-row-meta' }, `${data.realtime.chars} 字 · ${data.realtime.mtime || ''}`),
                h('div', { className: 'db-pre' }, data.realtime.preview || '（空）'),
                h('div', { className: 'db-row-actions', style: { marginTop: 8 } },
                  h(Button, { small: true, onClick: () => openCard(data.realtime) }, '查看全文'),
                ),
              )
            : h('div', { className: 'db-empty' }, '还没有实时卡（当前任务.md）'),
        ),
        h('section', { className: 'db-section' },
          h('div', { className: 'db-section-head' }, h('div', { className: 'db-section-title' }, '设置')),
          draft ? h(Settings, {
            settings: draft,
            busy: busy === 'settings',
            onChange: (next) => setDraft(next ? { ...next } : { ...data.settings }),
            onSave: () => saveSettings(draft),
          }) : null,
        ),
        h('section', { className: 'db-section' },
          h('div', { className: 'db-section-head' }, h('div', { className: 'db-section-title' }, '状态')),
          h(Status, { status }),
        ),
      )
    }

    function HandoffWatcher(props) {
      const [toast, setToast] = React.useState(null)
      const acked = React.useRef(new Set())
      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const data = await getState()
            const pending = data.status && data.status.pendingHandoff
            if (!alive || !pending || !pending.to || acked.current.has(pending.to)) return
            acked.current.add(pending.to)
            try {
              const ws = props.brainCtx && props.brainCtx.uiWorkspace
              if (ws && typeof ws.openSession === 'function') ws.openSession(pending.to)
            } catch { /* 导航失败不阻塞提示 */ }
            setToast({ text: '记忆大脑：已接续到新会话', at: Date.now() })
            try { await post('/action', { action: 'ackHandoff', to: pending.to }) } catch { /* 下轮再确认 */ }
          } catch { /* Host 未就绪时静默重试 */ }
        }
        tick()
        timer = setInterval(tick, 3000)
        return () => { alive = false; if (timer) clearInterval(timer) }
      }, [props.brainCtx])
      React.useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 5200)
        return () => clearTimeout(timer)
      }, [toast])
      if (!toast) return null
      return h('div', { className: 'db-toast' }, toast.text)
    }

    return {
      inject: ['slots', 'uiWorkspace', 'layout'],
      apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          const id = 'dsh-brain/panel.css'
          if (document.querySelector(`style[data-plugin-css="${id}"]`)) return undefined
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-brain'
          tag.dataset.pluginCss = id
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'dsh-brain: styles')

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-brain',
          order: 2,
          label: () => '记忆大脑',
        }, BrainIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-brain',
          label: () => '记忆大脑',
          inject: () => ({ brainCtx: ctx }),
        }, Panel))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-brain-handoff',
          label: () => '记忆大脑接续',
        }, () => h(HandoffWatcher, { brainCtx: ctx })))
      },
    }
  },
})
