/**
 * dsh-Ycp · 大肥鱼（Client 半）—— P03：人设、试说、状态行。
 *
 * 三块：
 *   1. 状态行：她现在什么状态、用哪个模型、人设多少字
 *   2. 人设：textarea 直接改、保存落盘、可恢复默认（填回默认要手动点保存）
 *   3. 试说：一句话发给她，看话风对不对
 * 底下留着 P02 的设置（名字 / 启用）和她的家。
 */
window.__ModuleLoader__.load({
  id: 'dsh-Ycp',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/api/dsh-Ycp'

    const CSS = `
      .ycp-panel { height:100%; overflow:auto; padding:32px 28px 56px; color:var(--dsw-alias-label-primary); background:radial-gradient(900px 420px at 12% -12%, rgba(96,196,235,.16), transparent 62%), var(--dsw-alias-bg-base); font-size:13px; line-height:1.65; }
      .ycp-wrap { max-width:820px; margin:0 auto; }
      .ycp-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
      .ycp-title { font-size:26px; font-weight:700; letter-spacing:-.3px; }
      .ycp-sub { color:var(--dsw-alias-label-secondary); font-size:12px; margin-top:4px; }
      .ycp-pill { flex-shrink:0; display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-state-success-primary); color:var(--dsw-alias-state-success-primary); border-radius:999px; padding:4px 11px; font-size:11px; background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
      .ycp-pill.bad { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
      .ycp-pill.wait { border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
      .ycp-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
      .ycp-status { display:flex; gap:18px; flex-wrap:wrap; align-items:center; margin:16px 0 14px; padding:11px 16px; border-radius:14px; background:var(--dsw-alias-bg-layer-1); box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1), 0 8px 24px rgba(20,70,110,.05); font-size:12px; color:var(--dsw-alias-label-secondary); }
      .ycp-status b { color:var(--dsw-alias-label-primary); font-weight:600; }
      .ycp-section { border:0; border-radius:18px; background:var(--dsw-alias-bg-layer-1); padding:18px 20px; margin-bottom:14px; box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1), 0 10px 30px rgba(20,70,110,.06); transition:box-shadow .2s, transform .2s; }
      .ycp-section:hover { box-shadow:inset 0 0 0 1px rgba(96,196,235,.38), 0 14px 34px rgba(20,70,110,.10); }
      .ycp-section-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:11px; }
      .ycp-section-title { font-size:13px; font-weight:700; letter-spacing:0; color:var(--dsw-alias-label-primary); display:flex; align-items:center; gap:8px; }
      .ycp-section-title::before { content:''; width:3px; height:14px; border-radius:2px; background:linear-gradient(#6fd2f3,#2a7fb6); }
      .ycp-count { font-size:11px; color:var(--dsw-alias-label-secondary); }
      .ycp-textarea { width:100%; min-height:190px; resize:vertical; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:10px 12px; font-size:13px; line-height:1.7; font-family:inherit; }
      .ycp-textarea:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
      .ycp-actions { display:flex; gap:8px; margin-top:9px; flex-wrap:wrap; }
      .ycp-btn { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); border-radius:9px; padding:7px 15px; font-size:12px; cursor:pointer; transition:transform .15s, box-shadow .15s, border-color .15s; }
      .ycp-btn:hover:not([disabled]) { border-color:rgba(96,196,235,.7); transform:translateY(-1px); box-shadow:0 6px 14px rgba(20,70,110,.08); }
      .ycp-btn.primary { background:linear-gradient(135deg,#3aa6e0,#247bbf); border-color:transparent; color:#fff; font-weight:600; box-shadow:0 8px 18px rgba(36,123,191,.24); }
      .ycp-btn[disabled] { opacity:.55; cursor:not-allowed; }
      .ycp-msg { font-size:12px; margin-top:8px; }
      .ycp-msg.ok { color:var(--dsw-alias-state-success-primary); }
      .ycp-msg.bad { color:var(--dsw-alias-state-error-primary); white-space:pre-wrap; }
      .ycp-say { display:flex; gap:8px; }
      .ycp-input { flex:1; min-width:0; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:9px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:8px 11px; font-size:13px; }
      .ycp-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary); box-shadow:0 0 0 3px rgba(58,166,224,.12); }
      .ycp-input.small { width:100px; flex:none; }
      .ycp-bubble { margin-top:10px; border:1px solid var(--dsw-alias-border-l1); border-radius:14px; background:var(--dsw-alias-bg-base); padding:12px 15px; font-size:13px; line-height:1.75; white-space:pre-wrap; box-shadow:0 6px 16px rgba(20,70,110,.05); }
      .ycp-bubble-name { font-weight:600; margin-right:4px; }
      .ycp-bubble-meta { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:6px; }
.ycp-chatlog { max-height:420px; overflow-y:auto; margin-bottom:10px; padding-right:4px; }
.ycp-bubble.me { background:rgba(47,158,110,.06); }
.ycp-perms { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:10px 0; }
.ycp-perm { text-align:left; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-base); padding:10px 12px; cursor:pointer; }
.ycp-perm.on { border-color:#2f9e6e; box-shadow:0 0 0 2px rgba(47,158,110,.15); background:rgba(47,158,110,.05); }
.ycp-perm-name { font-weight:600; margin-bottom:4px; }
.ycp-perm-desc { font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary); }
.ycp-perm-warn { margin-top:6px; font-size:12px; color:#d9534f; }
      .ycp-typing { display:flex; align-items:center; gap:5px; }
      .ycp-dot { width:6px; height:6px; border-radius:50%; background:#2f8fce; display:inline-block; animation:ycp-blink 1.2s infinite ease-in-out; }
      .ycp-dot:nth-child(3) { animation-delay:.2s; }
      .ycp-dot:nth-child(4) { animation-delay:.4s; }
      @keyframes ycp-blink { 0%,100% { opacity:.25; transform:translateY(0) } 50% { opacity:1; transform:translateY(-2px) } }
      .ycp-row { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
      .ycp-field { display:flex; flex-direction:column; gap:4px; }
      .ycp-field label { font-size:11px; color:var(--dsw-alias-label-secondary); }
      .ycp-field .ycp-input { width:180px; flex:none; }
      .ycp-check { display:flex; align-items:center; gap:7px; font-size:12px; padding-bottom:7px; }
      .ycp-path { font-family:ui-monospace,Consolas,monospace; font-size:11px; color:var(--dsw-alias-label-secondary); word-break:break-all; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l1); border-radius:7px; padding:7px 9px; }
      .ycp-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
      .ycp-tab { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-secondary); border-radius:999px; padding:3px 12px; font-size:12px; cursor:pointer; }
      .ycp-tab.on { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); font-weight:600; }
      .ycp-memrow { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-top:1px solid var(--dsw-alias-border-l1); }
      .ycp-memrow:first-of-type { border-top:0; }
      .ycp-mem-main { flex:1; min-width:0; }
      .ycp-mem-title { font-weight:600; font-size:13px; word-break:break-word; }
      .ycp-mem-desc { color:var(--dsw-alias-label-secondary); font-size:12px; margin-top:2px; word-break:break-word; }
      .ycp-mem-meta { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:3px; }
      .ycp-mem-actions { display:flex; gap:6px; flex-shrink:0; }
      .ycp-btn.small { padding:3px 9px; font-size:11px; }
      .ycp-empty { color:var(--dsw-alias-label-secondary); font-size:12px; padding:8px 0; }
      .ycp-editor { border:1px solid var(--dsw-alias-brand-primary); border-radius:10px; background:var(--dsw-alias-bg-base); padding:10px 12px; margin-top:10px; }
      .ycp-editor .ycp-textarea { min-height:170px; font-family:ui-monospace,Consolas,monospace; font-size:12px; }
      .ycp-editor-head { font-size:12px; color:var(--dsw-alias-label-secondary); margin-bottom:7px; word-break:break-all; }
      .ycp-diary-box { display:flex; gap:8px; align-items:flex-start; margin-bottom:10px; }
      .ycp-diary-box .ycp-input { padding:8px 10px; }
      .ycp-subrow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:7px 0; font-size:12px; }
      .ycp-subrow .label { width:56px; color:var(--dsw-alias-label-secondary); flex-shrink:0; }
      .ycp-time { width:92px; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:5px 8px; font-size:12px; }
      .ycp-time:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
      .ycp-choice { display:flex; gap:6px; }
      .ycp-choice button { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-secondary); border-radius:999px; padding:2px 11px; font-size:12px; cursor:pointer; }
      .ycp-choice button.on { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); font-weight:600; }
      .ycp-hint { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:8px; }
      .ycp-bar-row { display:flex; align-items:center; gap:10px; margin:5px 0; font-size:12px; }
      .ycp-bar-label { width:34px; flex-shrink:0; color:var(--dsw-alias-label-secondary); }
      .ycp-bar-track { flex:1; height:8px; border-radius:999px; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l1); overflow:hidden; }
      .ycp-bar-fill { height:100%; border-radius:999px; transition:width .3s ease; }
      .ycp-bar-fill.energy { background:#3BA3DC; }
      .ycp-bar-fill.mood { background:#E08BB6; }
      .ycp-bar-fill.hunger { background:#E0A050; }
      .ycp-bar-fill.satiety { background:#5FBF8F; }
      .ycp-bar-value { width:30px; text-align:right; flex-shrink:0; color:var(--dsw-alias-label-secondary); }
      .ycp-stats { display:flex; gap:16px; flex-wrap:wrap; margin-top:9px; font-size:12px; color:var(--dsw-alias-label-secondary); }
      .ycp-stats b { color:var(--dsw-alias-label-primary); font-weight:600; }
      .ycp-banner { border:1px solid var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); background:var(--dsw-alias-bg-layer-1); border-radius:10px; padding:9px 12px; margin:0 0 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; font-size:12px; }
      .ycp-banner b { font-weight:650; }
      .ycp-select { border:1px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:5px 8px; font-size:12px; max-width:260px; }
      .ycp-range { width:110px; accent-color:#247bbf; }
      .ycp-num { width:52px; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:3px 6px; font-size:12px; }
      .ycp-audio { width:100%; height:34px; margin-top:8px; }
      .ycp-balance { margin-top:12px; }
      .ycp-balance-head { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--dsw-alias-label-secondary); }
      .ycp-balance-head b { color:var(--dsw-alias-label-primary); font-size:15px; font-weight:600; }
      .ycp-balance-head b.low { color:#d9534f; }
      .ycp-low { color:#d9534f; }
      .ycp-meter { height:6px; border-radius:3px; background:var(--dsw-alias-border-l1); overflow:hidden; margin-top:6px; }
      .ycp-meter i { display:block; height:100%; border-radius:3px; transition:width .5s ease, background .3s; }
      .ycp-ledger-form { display:grid; grid-template-columns:88px 84px 1fr 74px; gap:8px; margin-top:10px; align-items:center; }
      .ycp-ledger-form .ycp-input, .ycp-ledger-form .ycp-select { width:100%; min-width:0; }
      .ycp-ledger-list { margin-top:10px; display:flex; flex-direction:column; gap:5px; }
      .ycp-ledger-row { display:grid; grid-template-columns:52px 1fr auto 38px; gap:8px; align-items:center; padding:6px 9px; border-radius:10px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); font-size:12px; }
      .ycp-ledger-cat { color:var(--dsw-alias-label-secondary); }
      .ycp-ledger-note { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ycp-ledger-row .in { color:#2f9e6e; }
      .ycp-ledger-row .out { color:#c65a4a; }
      .ycp-ledger-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; margin-top:10px; }
      .ycp-stat-card { display:flex; flex-direction:column; gap:2px; padding:9px 12px; border-radius:12px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
      .ycp-stat-card span { font-size:11px; color:var(--dsw-alias-label-secondary); }
      .ycp-stat-card b { font-size:15px; }
      .ycp-check { display:inline-flex; align-items:center; gap:6px; font-size:12px; }
      .ycp-stat-card i { font-style:normal; font-size:11px; color:var(--dsw-alias-label-secondary); }      .ycp-money-card { margin-top:14px; padding-top:12px; border-top:1px dashed var(--dsw-alias-border-l1); }
      .ycp-foot { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:14px; }
      .ycp-hero { display:flex; align-items:center; gap:18px; margin:18px 0 14px; padding:14px 18px; border:1px solid var(--dsw-alias-border-l1); border-radius:18px; background:linear-gradient(135deg, rgba(96,196,235,.16), rgba(255,255,255,0) 62%), var(--dsw-alias-bg-layer-1); box-shadow:0 10px 26px rgba(22,86,128,.08); }
      .ycp-hero-main { display:flex; flex-direction:column; gap:6px; min-width:0; }
      .ycp-hero-name { font-size:24px; font-weight:700; letter-spacing:1px; }
      .ycp-hero-sub { font-size:13px; color:var(--dsw-alias-label-secondary); }
      .ycp-hero-sign { font-size:13px; color:#2a7fb6; font-style:italic; }
      .ycp-chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
      .ycp-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:12px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
      .ycp-chip.energy { border-color:rgba(59,163,220,.45); }
      .ycp-chip.mood { border-color:rgba(224,139,182,.45); }
      .ycp-chip.satiety { border-color:rgba(95,191,143,.45); }
      .ycp-chip b { font-size:13px; }      .ycp-portrait { width:128px; height:128px; flex-shrink:0; display:block; border-radius:22px; filter:drop-shadow(0 10px 16px rgba(21,84,124,.22)); animation:ycp-float 4.5s ease-in-out infinite; }
      @keyframes ycp-float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-5px) } }
      .ycp-quote { font-size:14px; line-height:1.7; }
      .ycp-quote b { font-weight:600; }
      .ycp-note { color:var(--dsw-alias-label-secondary); font-size:12px; margin-top:4px; }
    `

    async function call(path, options) {
      const response = await fetch(API + path, {
        cache: 'no-store',
        ...options,
        headers: {
          ...(options && options.body ? { 'content-type': 'application/json' } : {}),
          ...((options && options.headers) || {}),
        },
      })
      let data = null
      try { data = await response.json() } catch { /* 非 JSON 响应 */ }
      if (!response.ok || (data && data.ok === false)) {
        const error = new Error((data && data.error) || `HTTP ${response.status}`)
        error.reason = data && data.reason
        throw error
      }
      return data
    }

    function clock(ms) {
      const d = ms ? new Date(ms) : new Date()
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    /** 刚才 / N 分钟前 / N 小时前，让对话有"刚发生"的感觉。 */
    function timeAgo(ms) {
      if (!ms) return ''
      const gap = Math.max(0, Date.now() - Number(ms))
      if (gap < 60_000) return '刚刚'
      if (gap < 3_600_000) return `${Math.floor(gap / 60_000)} 分钟前`
      if (gap < 86_400_000) return `${Math.floor(gap / 3_600_000)} 小时前`
      return `${Math.floor(gap / 86_400_000)} 天前`
    }

    /** 今天只显示时分，其它日子显示 月-日 时:分。 */
    function shortTime(ms) {
      if (!ms) return ''
      const d = new Date(ms)
      const now = new Date()
      const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
      const pad = (n) => String(n).padStart(2, '0')
      return sameDay
        ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
        : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /** 侧边栏小图标：一条朝右的鱼，线条跟随主题色。 */
    function FishIcon(props) {
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
          d: 'M4.2 12c2.8-3.2 5.9-4.8 9-4.8 3.9 0 6.8 1.9 8.2 4.8-1.4 2.9-4.3 4.8-8.2 4.8-3.1 0-6.2-1.6-9-4.8z',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M4.2 12 1.8 9.3v5.4L4.2 12z', fill: 'currentColor' }),
        h('circle', { cx: 16.4, cy: 11.1, r: 1.15, fill: 'currentColor' }),
      )
    }

    /** 面板里的鲸鱼娘：和 icon.svg / 桌宠同一张图，宿主从 /character.svg 发。 */
    function BigFish(props = {}) {
      return h('img', {
        className: props.className || 'ycp-portrait',
        src: '/api/dsh-Ycp/character.png',
        alt: '阿闷',
        draggable: false,
      })
    }

    /** 一条状态条：体力 / 心情 / 饿。 */
    function Bar(props) {
      const value = Math.max(0, Math.min(100, Number(props.value) || 0))
      return h('div', { className: 'ycp-bar-row' },
        h('span', { className: 'ycp-bar-label' }, props.label),
        h('div', { className: 'ycp-bar-track' },
          h('div', { className: `ycp-bar-fill ${props.tone || ''}`, style: { width: `${value}%` } }),
        ),
        h('span', { className: 'ycp-bar-value' }, String(value)),
      )
    }

    function Panel() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [name, setName] = React.useState('')
      const [enabled, setEnabled] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [saved, setSaved] = React.useState('')

      const [persona, setPersona] = React.useState('')
      const [defaultPersona, setDefaultPersona] = React.useState('')
      const [personaMsg, setPersonaMsg] = React.useState('')
      const [personaBusy, setPersonaBusy] = React.useState(false)

      const [draft, setDraft] = React.useState('')
      const [reply, setReply] = React.useState(null)
      const [sayError, setSayError] = React.useState('')
      const [saying, setSaying] = React.useState(false)
      const [chatLog, setChatLog] = React.useState([])
      const [chatHasMore, setChatHasMore] = React.useState(false)
      const [chatBusy, setChatBusy] = React.useState(false)
      const chatBoxRef = React.useRef(null)

      React.useEffect(() => {
        const el = chatBoxRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [chatLog.length, saying])

      const [memory, setMemory] = React.useState(null)
      const [memTab, setMemTab] = React.useState('global')
      const [memCard, setMemCard] = React.useState(null)
      const [memMsg, setMemMsg] = React.useState('')
      const [memBusy, setMemBusy] = React.useState(false)
      const [diaryDraft, setDiaryDraft] = React.useState('')

      const [schedule, setSchedule] = React.useState(null)
      const [scheduleMsg, setScheduleMsg] = React.useState('')
      const [scheduleBusy, setScheduleBusy] = React.useState(false)

      const [proactive, setProactive] = React.useState(null)
      const [proactiveForm, setProactiveForm] = React.useState({ enabled: false, everyMin: 60, dailyLimit: 10 })
      const [proactiveMsg, setProactiveMsg] = React.useState('')
      const [proactiveBusy, setProactiveBusy] = React.useState(false)

      const [petInfo, setPetInfo] = React.useState(null)
      const [petBusy, setPetBusy] = React.useState(false)
      const [petMsg, setPetMsg] = React.useState('')

      const [voiceInfo, setVoiceInfo] = React.useState(null)
      const [voiceForm, setVoiceForm] = React.useState(null)
      const [voiceBusy, setVoiceBusy] = React.useState(false)
      const [voiceMsg, setVoiceMsg] = React.useState('')
      const [previewUrl, setPreviewUrl] = React.useState('')

      const [soundInfo, setSoundInfo] = React.useState(null)
      const [soundForm, setSoundForm] = React.useState(null)
      const [soundBusy, setSoundBusy] = React.useState(false)
      const [soundMsg, setSoundMsg] = React.useState('')

      const [balanceInfo, setBalanceInfo] = React.useState(null)
      const [balanceBusy, setBalanceBusy] = React.useState(false)
      const [balanceMsg, setBalanceMsg] = React.useState('')
      const [diaryBusy, setDiaryBusy] = React.useState(false)
      const [diaryMsg, setDiaryMsg] = React.useState('')
      const [ledger, setLedger] = React.useState(null)
      const [ledgerBusy, setLedgerBusy] = React.useState(false)
      const [ledgerMsg, setLedgerMsg] = React.useState('')
      const [ledgerType, setLedgerType] = React.useState('expense')
      const [ledgerAmount, setLedgerAmount] = React.useState('')
      const [ledgerCategory, setLedgerCategory] = React.useState('吃饭')
      const [ledgerNote, setLedgerNote] = React.useState('')
      const [moneyAmount, setMoneyAmount] = React.useState('')
      const [moneyNote, setMoneyNote] = React.useState('')
      const [moneyType, setMoneyType] = React.useState('expense')
      const [ledgerTab, setLedgerTab] = React.useState('expense')
      const [apiForm, setApiForm] = React.useState({ baseUrl: '', apiKey: '', model: '' })
      const [apiBusy, setApiBusy] = React.useState(false)
      const [apiMsg, setApiMsg] = React.useState('')
      const [signature, setSignature] = React.useState('')
      const [sigMsg, setSigMsg] = React.useState('')
      const [coreChars, setCoreChars] = React.useState(1200)
      const [recallChars, setRecallChars] = React.useState(900)
      const [historyChars, setHistoryChars] = React.useState(16000)
      const [autoReflect, setAutoReflect] = React.useState(true)
      const [permLevel, setPermLevel] = React.useState('jail')
      const [permMsg, setPermMsg] = React.useState('')
      const [permBusy, setPermBusy] = React.useState(false)
      const lowSoundPlayed = React.useRef(false)

      const load = React.useCallback(async () => {
        try {
          const data = await call('/state')
          setState(data)
          setName(data.settings.name)
          setEnabled(data.settings.enabled)
          if (data.permission && data.permission.level) setPermLevel(data.permission.level)
          setCoreChars(Number(data.settings.memoryCoreChars) || 1200)
          setRecallChars(Number(data.settings.memoryRecallChars) || 900)
          setHistoryChars(Number(data.settings.historyChars) || 16000)
          setAutoReflect(data.settings.autoReflect !== false)
          if (data.settings.model) setApiForm({ baseUrl: data.settings.model.baseUrl || '', apiKey: data.settings.model.apiKey || '', model: data.settings.model.model || '' })
          setSignature(data.settings.signature || '')
          setError('')
        } catch (cause) {
          setError(String((cause && cause.message) || cause))
        } finally {
          setLoading(false)
        }
        try {
          const data = await call('/persona')
          setPersona(data.content)
          setDefaultPersona(data.default)
        } catch { /* 人设读不到不挡主状态 */ }
        try {
          const data = await call('/memory')
          setMemory(data)
        } catch (cause) {
          setMemMsg(`记忆读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/history?limit=30')
          setChatLog(Array.isArray(data.messages) ? data.messages : [])
          setChatHasMore(Boolean(data.hasMore))
        } catch (cause) {
          setSayError(`聊天记录读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/schedule')
          setSchedule(data.schedule)
        } catch (cause) {
          setScheduleMsg(`作息读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/proactive')
          setProactive(data)
          setProactiveForm({ enabled: data.enabled, everyMin: data.everyMin, dailyLimit: data.dailyLimit })
        } catch (cause) {
          setProactiveMsg(`主动状态读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/pet')
          setPetInfo(data)
        } catch (cause) {
          setPetMsg(`桌宠状态读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/voice')
          setVoiceInfo(data)
          setVoiceForm({ ...data.settings })
        } catch (cause) {
          setVoiceMsg(`声音状态读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/sound')
          setSoundInfo(data)
          setSoundForm({ enabled: data.enabled, volume: data.volume })
        } catch (cause) {
          setSoundMsg(`音效读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/balance')
          setBalanceInfo(data)
        } catch { /* 余额读不到不影响别的 */ }
      }, [])

      React.useEffect(() => { load() }, [load])

      // 主动发言是后台发生的：每 10 秒问一次，有新话就挂到面板上。
      React.useEffect(() => {
        const timer = setInterval(async () => {
          try {
            const data = await call('/proactive')
            setProactive(data)
            if (data.unread > 0) await call('/proactive/read', { method: 'POST', body: '{}' })
          } catch { /* 面板没开时静默 */ }
        }, 10000)
        return () => clearInterval(timer)
      }, [])

      React.useEffect(() => {
        if (!balanceInfo || !balanceInfo.low) return
        if (lowSoundPlayed.current) return
        lowSoundPlayed.current = true
        playSound('low')
      }, [balanceInfo])

      React.useEffect(() => { loadLedger() }, [])

      const saveSettings = async () => {
        setBusy(true)
        setSaved('')
        try {
          const result = await call('/settings', {
            method: 'PUT',
            body: JSON.stringify({
              name,
              enabled,
              memoryCoreChars: Number(coreChars) || 1200,
              memoryRecallChars: Number(recallChars) || 900,
              historyChars: Number(historyChars) || 16000,
              autoReflect,
            }),
          })
          setState((prev) => (prev ? { ...prev, settings: result.settings, name: result.settings.name } : prev))
          setSaved(`已保存 · ${clock()}`)
          setError('')
        } catch (cause) {
          setError(String((cause && cause.message) || cause))
        } finally {
          setBusy(false)
        }
      }

      const savePersona = async () => {
        setPersonaBusy(true)
        setPersonaMsg('')
        try {
          const result = await call('/persona', { method: 'PUT', body: JSON.stringify({ content: persona }) })
          setState((prev) => (prev ? { ...prev, persona: { ...prev.persona, chars: result.chars } } : prev))
          setPersonaMsg(`已保存 · ${result.chars} 字 · ${clock()}（下一句话就用新的人设）`)
        } catch (cause) {
          setPersonaMsg(`保存失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setPersonaBusy(false)
        }
      }

      const savePermissionLevel = async () => {
        if (permBusy) return
        if (permLevel === 'full') {
          const ua = typeof window === 'undefined' ? null : window
          const ok = ua && typeof ua.confirm === 'function'
            ? ua.confirm('完整权限会放开系统目录和所有软件，出事可能救不回来。确定要开吗？')
            : false
          if (!ok) return
        }
        setPermBusy(true)
        setPermMsg('')
        try {
          const data = await call('/permission', {
            method: 'POST',
            headers: { 'x-ycp-user': 'panel' },
            body: JSON.stringify({ level: permLevel, confirm: permLevel === 'full' ? 'FULL' : '' }),
          })
          setState((prev) => (prev ? { ...prev, permission: data } : prev))
          const info = data && data.levelInfo ? data.levelInfo : null
          setPermMsg(`已切到「${info ? info.name : permLevel}」· ${clock()}`)
        } catch (cause) {
          setPermMsg(`改不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setPermBusy(false)
        }
      }

      const loadChat = async (before = 0) => {
        setChatBusy(true)
        try {
          const data = await call(`/history?limit=30${before ? `&before=${before}` : ''}`)
          const list = Array.isArray(data.messages) ? data.messages : []
          if (before) {
            setChatLog((prev) => {
              const seen = new Set((prev || []).map((item) => `${item.at}|${item.role}|${item.text}`))
              const older = list.filter((item) => !seen.has(`${item.at}|${item.role}|${item.text}`))
              return [...older, ...(prev || [])]
            })
          } else {
            setChatLog(list)
          }
          setChatHasMore(Boolean(data.hasMore))
        } catch (cause) {
          setSayError(`聊天记录读不到：${String((cause && cause.message) || cause)}`)
        } finally {
          setChatBusy(false)
        }
      }

      const loadMoreChat = () => {
        const first = Array.isArray(chatLog) && chatLog.length ? Number(chatLog[0].at || 0) : 0
        if (first) loadChat(first)
        else loadChat()
      }

      const sendSay = async () => {
        const text = draft.trim()
        if (!text || saying) return
        setSaying(true)
        setSayError('')
        try {
          const result = await call('/say', { method: 'POST', body: JSON.stringify({ text }) })
          setReply({
            text: result.text,
            model: result.model,
            ms: result.ms,
            at: Date.now(),
            recalled: result.recalled || [],
            voiceUrl: result.voice ? result.voice.url : '',
            voiceMs: result.voice ? result.voice.ms : 0,
          })
          if (!result.voice) playSound('speak')
          setDraft('')
          setState((prev) => (prev ? { ...prev, model: result.model || prev.model, mood: result.mood || prev.mood } : prev))
          loadChat()
        } catch (cause) {
          setSayError(String((cause && cause.message) || cause))
        } finally {
          setSaying(false)
        }
      }

      const loadMemory = async () => {
        try {
          const data = await call('/memory')
          setMemory(data)
          setMemMsg('')
        } catch (cause) {
          setMemMsg(`读不到记忆：${String((cause && cause.message) || cause)}`)
        }
      }

      const openCard = async (layer, file) => {
        setMemBusy(true)
        try {
          const data = await call(`/memory/card?layer=${encodeURIComponent(layer)}&file=${encodeURIComponent(file)}`)
          setMemCard({ layer, file, content: data.card.content })
        } catch (cause) {
          setMemMsg(`打不开：${String((cause && cause.message) || cause)}`)
        } finally {
          setMemBusy(false)
        }
      }

      const newCard = () => {
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const tag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
        const file = `新卡片-${tag}.md`
        setMemCard({
          layer: memTab === 'diary' ? 'diary' : memTab,
          file,
          content: `---\nname: 新卡片\ndescription: \ntags: []\n---\n\n# 新卡片\n\n`,
        })
      }

      const runCheck = async () => {
        setMemBusy(true)
        try {
          const data = await call('/memory/check')
          const issues = (data && data.issues) || {}
          const parts = []
          const dupes = Array.isArray(issues.duplicates) ? issues.duplicates : []
          if (dupes.length) {
            parts.push(`重复 ${dupes.length} 对（${dupes.slice(0, 3).map((item) => `${item.a.replace(/\\.md$/, '')}↔${item.b.replace(/\\.md$/, '')}`).join('、')}${dupes.length > 3 ? '…' : ''}）`)
          }
          if (Array.isArray(issues.empty) && issues.empty.length) parts.push(`空卡 ${issues.empty.length}`)
          if (Array.isArray(issues.long) && issues.long.length) parts.push(`超长 ${issues.long.length}`)
          if (Array.isArray(issues.stale) && issues.stale.length) parts.push(`久未用 ${issues.stale.length}`)
          setMemMsg(parts.length ? `体检：共 ${data.total} 张，${parts.join('；')}` : `体检：共 ${data.total} 张，没有毛病`)
        } catch (cause) {
          setMemMsg(`体检失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setMemBusy(false)
        }
      }

      const runReflect = async () => {
        setMemBusy(true)
        setMemMsg('她在回看今天的原始记忆…')
        try {
          const result = await call('/memory/reflect', { method: 'POST', body: '{}' })
          const changed = Number(result && result.cards) || 0
          setMemMsg(result && result.ok
            ? `回看完成：${changed ? `长出/合并 ${changed} 张卡` : '没有新的值得记的'}${result.growth ? '，成长 +1' : ''}`
            : `这次没回看：${(result && (result.error || result.reason)) || '未知原因'}`)
          if (result && result.ok) await loadMemory()
        } catch (cause) {
          setMemMsg(`回看失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setMemBusy(false)
        }
      }

      const saveCard = async () => {
        if (!memCard) return
        setMemBusy(true)
        try {
          await call('/memory/card', { method: 'PUT', body: JSON.stringify(memCard) })
          setMemMsg(`已保存 ${memCard.file}`)
          setMemCard(null)
          await loadMemory()
        } catch (cause) {
          setMemMsg(`保存失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setMemBusy(false)
        }
      }

      const removeCard = async (layer, file) => {
        const ua = typeof window === 'undefined' ? null : window
        if (ua && typeof ua.confirm === 'function' && !ua.confirm(`删掉「${file}」？会先备份到 状态\\backups\\。`)) return
        setMemBusy(true)
        try {
          await call('/memory/delete', { method: 'POST', body: JSON.stringify({ layer, file }) })
          setMemMsg(`已删 ${file}（有备份）`)
          if (memCard && memCard.file === file) setMemCard(null)
          await loadMemory()
        } catch (cause) {
          setMemMsg(`删不掉：${String((cause && cause.message) || cause)}`)
        } finally {
          setMemBusy(false)
        }
      }

      const saveDiary = async () => {
        const text = diaryDraft.trim()
        if (!text) return
        setMemBusy(true)
        try {
          const result = await call('/memory/diary', { method: 'POST', body: JSON.stringify({ text }) })
          setDiaryDraft('')
          setMemMsg(`已记到 ${result.file}`)
          await loadMemory()
        } catch (cause) {
          setMemMsg(`记不进去：${String((cause && cause.message) || cause)}`)
        } finally {
          setMemBusy(false)
        }
      }

      const patchSlot = (slot, part) => setSchedule((prev) => (prev ? { ...prev, [slot]: { ...prev[slot], ...part } } : prev))
      const patchSchedule = (part) => setSchedule((prev) => (prev ? { ...prev, ...part } : prev))

      const saveScheduleToServer = async () => {
        if (!schedule) return
        setScheduleBusy(true)
        setScheduleMsg('')
        try {
          const result = await call('/schedule', { method: 'PUT', body: JSON.stringify(schedule) })
          setSchedule(result.schedule)
          setState((prev) => (prev ? { ...prev, rhythm: result.status } : prev))
          setScheduleMsg(`已保存 · ${result.status.label}`)
        } catch (cause) {
          setScheduleMsg(`保存失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setScheduleBusy(false)
        }
      }

      const reloadProactive = async () => {
        try {
          const data = await call('/proactive')
          setProactive(data)
          setProactiveForm({ enabled: data.enabled, everyMin: data.everyMin, dailyLimit: data.dailyLimit })
        } catch { /* 读不到就保持旧值 */ }
      }

      const saveProactive = async () => {
        setProactiveBusy(true)
        setProactiveMsg('')
        try {
          await call('/settings', { method: 'PUT', body: JSON.stringify({ proactive: proactiveForm }) })
          await reloadProactive()
          setProactiveMsg('已保存')
        } catch (cause) {
          setProactiveMsg(`保存失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setProactiveBusy(false)
        }
      }

      const REASON_TEXT = {
        off: '主动开关没开',
        sleep: '她睡着了',
        quiet: '现在是安静时段',
        'daily-limit': '今天说够了',
        low: '状态太差，不想说话',
        cooldown: '还没到下次开口的时间',
        'provider-missing': '当前对话没选模型',
        'llm-missing': 'LLM 服务不可用',
        'generate-error': '生成失败，原因见下方',
      }

      const tickProactive = async () => {
        setProactiveBusy(true)
        setProactiveMsg('')
        try {
          const result = await call('/proactive/tick', { method: 'POST', body: '{}' })
          if (result.fired) {
            setProactiveMsg(`她说了：${result.message.text}`)
            await reloadProactive()
          } else {
            setProactiveMsg(`这次没说：${REASON_TEXT[result.reason] || result.reason}${result.error ? `（${result.error}）` : ''}`)
          }
        } catch (cause) {
          setProactiveMsg(`试不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setProactiveBusy(false)
        }
      }

      const startPet = async () => {
        setPetBusy(true)
        setPetMsg('')
        try {
          const result = await call('/pet/start', { method: 'POST', body: '{}' })
          setPetInfo(result)
          setPetMsg('她出来了，在右下角')
        } catch (cause) {
          setPetMsg(`放不出来：${String((cause && cause.message) || cause)}`)
        } finally {
          setPetBusy(false)
        }
      }

      const stopPet = async () => {
        setPetBusy(true)
        setPetMsg('')
        try {
          const result = await call('/pet/stop', { method: 'POST', body: '{}' })
          setPetInfo(result.status)
          setPetMsg(result.closed ? '她回电脑里了' : '她本来就没出来')
        } catch (cause) {
          setPetMsg(`收不起来：${String((cause && cause.message) || cause)}`)
        } finally {
          setPetBusy(false)
        }
      }

      const toggleAutoPet = async () => {
        setPetBusy(true)
        try {
          const current = Boolean(state && state.settings && state.settings.appearance && state.settings.appearance.petEnabled)
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ appearance: { petEnabled: !current } }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          setPetMsg(result.settings.appearance.petEnabled ? '以后开 DSH 就放她出来' : '以后开 DSH 不自动放她出来')
        } catch (cause) {
          setPetMsg(`改不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setPetBusy(false)
        }
      }

      const saveVoice = async (patch) => {
        const next = { ...(voiceForm || {}), ...patch }
        setVoiceForm(next)
        setVoiceBusy(true)
        setVoiceMsg('')
        try {
          const result = await call('/voice', { method: 'PUT', body: JSON.stringify(next) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          setVoiceForm({ ...result.settings.voice })
        } catch (cause) {
          setVoiceMsg(`存不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setVoiceBusy(false)
        }
      }

      const previewVoice = async () => {
        setVoiceBusy(true)
        setVoiceMsg('')
        try {
          const result = await call('/voice/preview', { method: 'POST', body: '{}' })
          setPreviewUrl(`${result.url}?t=${Date.now()}`)
          setVoiceMsg(`试听已生成 · ${Math.round(result.bytes / 1024)}KB · ${result.voice}`)
        } catch (cause) {
          setVoiceMsg(`试听失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setVoiceBusy(false)
        }
      }

      const deriveVoice = async () => {
        setVoiceBusy(true)
        setVoiceMsg('')
        try {
          const result = await call('/voice/derive', { method: 'POST', body: '{}' })
          setVoiceForm({ ...result.settings.voice })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          setVoiceMsg(`按人设配好了：${result.derived.name} · 语速 ${result.derived.rate} · 音调 ${result.derived.pitch}（${result.derived.why}）`)
        } catch (cause) {
          setVoiceMsg(`配不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setVoiceBusy(false)
        }
      }

      const playSound = (name) => {
        if (!soundForm || !soundForm.enabled) return
        try {
          const audio = new Audio(`/api/dsh-Ycp/sound/file/${name}.wav?t=${Date.now()}`)
          audio.volume = Math.max(0, Math.min(1, (Number(soundForm.volume) || 0) / 100))
          audio.play().catch(() => { /* 浏览器可能拦自动播放 */ })
        } catch { /* 没有声音也继续 */ }
      }

      const saveSound = async (patch) => {        const next = { ...(soundForm || {}), ...patch }
        setSoundForm(next)
        setSoundBusy(true)
        setSoundMsg('')
        try {
          const result = await call('/sound', { method: 'PUT', body: JSON.stringify(next) })
          setSoundForm({ enabled: result.settings.sound.enabled, volume: result.settings.sound.volume })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
        } catch (cause) {
          setSoundMsg(`存不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setSoundBusy(false)
        }
      }

      const writeDiary = async () => {
        setDiaryBusy(true)
        setDiaryMsg('')
        try {
          const result = await call('/diary/auto', { method: 'POST', body: '{}' })
          setDiaryMsg(`她写完了：${result.chars || 0} 字，存到 ${result.file || '今天的日记'}`)
          await loadMemory()
        } catch (cause) {
          setDiaryMsg(`没写成：${String((cause && cause.message) || cause)}`)
        } finally {
          setDiaryBusy(false)
        }
      }

      const loadLedger = async () => {
        try {
          const data = await call('/ledger')
          setLedger(data.summary)
        } catch { /* 账本读取失败不挡别的 */ }
      }

      const addLedger = async () => {
        const tokens = Number(ledgerAmount)
        if (!Number.isFinite(tokens) || tokens <= 0) { setLedgerMsg('先填个大于 0 的 token 数'); return }
        setLedgerBusy(true)
        setLedgerMsg('')
        try {
          const data = await call('/ledger', { method: 'POST', body: JSON.stringify({ tokens, kind: ledgerCategory, note: ledgerNote }) })
          setLedger(data.summary)
          setLedgerAmount('')
          setLedgerNote('')
          setLedgerMsg('喂了她一顿')
        } catch (cause) {
          setLedgerMsg(`没记上：${String((cause && cause.message) || cause)}`)
        } finally {
          setLedgerBusy(false)
        }
      }

      const removeLedger = async (id) => {
        try {
          const data = await call('/ledger', { method: 'POST', body: JSON.stringify({ remove: id }) })
          setLedger(data.summary)
        } catch { /* 删失败就算了 */ }
      }

      const saveBudget = async (value) => {
        const amount = Number(value)
        if (!Number.isFinite(amount) || amount <= 0) return
        try {
          const data = await call('/ledger', { method: 'PUT', body: JSON.stringify({ daily: amount }) })
          setLedger(data.summary)
        } catch { /* 预算没存上 */ }
      }

      const addMoney = async () => {
        const amount = Number(moneyAmount)
        if (!Number.isFinite(amount) || amount <= 0) { setLedgerMsg('先填个大于 0 的金额'); return }
        setLedgerBusy(true)
        setLedgerMsg('')
        try {
          const data = await call('/ledger', { method: 'POST', body: JSON.stringify({ amount, type: moneyType, note: moneyNote, category: '其他' }) })
          setLedger(data.summary)
          setMoneyAmount('')
          setMoneyNote('')
          setLedgerMsg(moneyType === 'income' ? '记了一笔收入' : '记了一笔支出')
        } catch (cause) {
          setLedgerMsg(`没记上：${String((cause && cause.message) || cause)}`)
        } finally {
          setLedgerBusy(false)
        }
      }

      const addTokenIncome = async () => {
        const tokens = Number(moneyAmount)
        if (!Number.isFinite(tokens) || tokens <= 0) { setLedgerMsg('先填个大于 0 的 token 数'); return }
        setLedgerBusy(true)
        setLedgerMsg('')
        try {
          const data = await call('/ledger', { method: 'POST', body: JSON.stringify({ tokens, type: 'income', note: moneyNote }) })
          setLedger(data.summary)
          setMoneyAmount('')
          setMoneyNote('')
          setLedgerMsg('记了一笔收入')
        } catch (cause) {
          setLedgerMsg(`没记上：${String((cause && cause.message) || cause)}`)
        } finally {
          setLedgerBusy(false)
        }
      }

      const saveMonthlyBudget = async (value) => {
        const amount = Number(value)
        if (!Number.isFinite(amount) || amount <= 0) return
        try {
          const data = await call('/ledger', { method: 'PUT', body: JSON.stringify({ monthly: amount }) })
          setLedger(data.summary)
        } catch { /* 预算没存上 */ }
      }
      const saveMoneyBudget = async (value) => {
        const amount = Number(value)
        if (!Number.isFinite(amount) || amount <= 0) return
        try {
          const data = await call('/ledger', { method: 'PUT', body: JSON.stringify({ budget: amount }) })
          setLedger(data.summary)
        } catch { /* 预算没存上 */ }
      }
      const saveBalanceWarn = async (value) => {
        const amount = Number(value)
        if (!Number.isFinite(amount) || amount < 0) return
        try {
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ balance: { enabled: true, warnBelow: amount } }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          setBalanceInfo((prev) => (prev ? { ...prev, warnBelow: amount } : prev))
        } catch { /* 阈值没存上 */ }
      }
      const saveApi = async () => {
        setApiBusy(true)
        setApiMsg('')
        try {
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ model: apiForm }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          setApiMsg('接口已保存')
        } catch (cause) {
          setApiMsg(`没存上：${String((cause && cause.message) || cause)}`)
        } finally {
          setApiBusy(false)
        }
      }

      const saveSignature = async () => {
        try {
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ signature }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          setSigMsg('签名已更新')
        } catch (cause) {
          setSigMsg(`没存上：${String((cause && cause.message) || cause)}`)
        }
      }

      const setAutonomySetting = async (key, value) => {
        try {
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ autonomy: { ...(state?.settings?.autonomy || {}), [key]: value } }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
        } catch { /* 开关没存上 */ }
      }
      const refreshBalance = async () => {        setBalanceBusy(true)
        lowSoundPlayed.current = false
        try {
          const data = await call('/balance?refresh=1')
          setBalanceInfo(data)
        } catch (cause) {
          setBalanceMsg(`查不到：${String((cause && cause.message) || cause)}`)
        } finally {
          setBalanceBusy(false)
        }
      }

      const modelLabel = state && state.model ? `${state.model.provider}/${state.model.model}` : '当前对话未选模型'
      const canSpeak = Boolean(state && state.settings.enabled && state.model)
      const asleep = Boolean(state && state.rhythm && state.rhythm.asleep)
      const tabs = memory && Array.isArray(memory.tabs) ? memory.tabs : [
        { key: 'global', label: '全局记忆' },
        { key: 'archive', label: '归档记忆' },
        { key: 'realtime', label: '实时记忆' },
        { key: 'diary', label: '日记' },
      ]
      const cards = memory && memory.layers && Array.isArray(memory.layers[memTab]) ? memory.layers[memTab] : []
      const cardTotal = memory && memory.layers
        ? Object.keys(memory.layers).reduce((sum, key) => sum + memory.layers[key].length, 0)
        : 0
      const permLevels = (state && state.permission && Array.isArray(state.permission.levels) && state.permission.levels.length)
        ? state.permission.levels
        : [
            { key: 'jail', name: '禁足', summary: '只能在自己家读写，不能删；不能上网、不能碰电脑。' },
            { key: 'normal', name: '普通', summary: '能看整台电脑（管理员区域除外）；自己家随便删改；OpenAI 目录可建项目。' },
            { key: 'full', name: '完整', summary: '全部放开，包括系统目录。' },
          ]
      const permNow = state && state.permission && state.permission.levelInfo ? state.permission.levelInfo : null
      const pill = error
        ? h('span', { className: 'ycp-pill bad' }, h('span', { className: 'ycp-dot' }), '未连接')
        : loading
          ? h('span', { className: 'ycp-pill wait' }, h('span', { className: 'ycp-dot' }), '加载中')
          : asleep
            ? h('span', { className: 'ycp-pill wait' }, h('span', { className: 'ycp-dot' }), '睡着')
            : canSpeak
              ? h('span', { className: 'ycp-pill' }, h('span', { className: 'ycp-dot' }), '能说话')
              : h('span', { className: 'ycp-pill wait' }, h('span', { className: 'ycp-dot' }), '还不会说话')

      return h('div', { className: 'ycp-panel' },
        h('div', { className: 'ycp-wrap' },
          h('div', { className: 'ycp-head' },
            h('div', null,
              h('div', { className: 'ycp-title' }, '记忆智能'),
              h('div', { className: 'ycp-sub' }, `${state ? state.name : '阿闷'} · v${state ? state.version : ''} · 鲸鱼娘`),
            ),
            pill,
          ),

          h('div', { className: 'ycp-hero' },
            h(BigFish),
            h('div', { className: 'ycp-hero-main' },
              h('div', { className: 'ycp-hero-name' }, state ? state.settings.name : '阿闷'),
              h('div', { className: 'ycp-hero-sub' },
                state && state.mood ? state.mood.label : '正在读取状态',
                state && state.rhythm ? ` · ${state.rhythm.label}` : '',
              ),
              h('div', { className: 'ycp-chips' },
                h('span', { className: 'ycp-chip energy' }, '体力 ', h('b', null, state && state.mood ? state.mood.energy : '—')),
                h('span', { className: 'ycp-chip mood' }, '心情 ', h('b', null, state && state.mood ? state.mood.mood : '—')),
                h('span', { className: 'ycp-chip satiety' }, '饱食 ', h('b', null, state && state.mood ? (state.mood.satiety ?? 100 - state.mood.hunger) : '—')),
              ),
              h('div', { className: 'ycp-hero-sign' }, state && state.settings && state.settings.signature ? state.settings.signature : '（还没写签名）'),
            ),
          ),

          h('div', { className: 'ycp-status' },
            h('span', null, '现在 ', h('b', null, state && state.rhythm ? state.rhythm.label : '—')),
            h('span', null, '模型 ', h('b', null, modelLabel)),
            h('span', null, '人设 ', h('b', null, `${state ? state.persona.chars : 0} 字`)),
            h('span', null, '上次说话 ', h('b', null, reply ? clock(reply.at) : '还没说过')),
          ),

          error ? h('div', { className: 'ycp-msg bad' }, `出错了：${error}`) : null,

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '模型接口'),
              h('div', { className: 'ycp-count' }, state && state.settings.model && state.settings.model.model ? state.settings.model.model : '用 DSH 当前模型'),
            ),
            h('div', { className: 'ycp-subrow' },
              h('span', { className: 'label' }, 'API 地址'),
              h('input', { className: 'ycp-input', placeholder: 'https://api.openai.com/v1', value: apiForm.baseUrl, onChange: (event) => setApiForm({ ...apiForm, baseUrl: event.target.value }) }),
            ),
            h('div', { className: 'ycp-subrow' },
              h('span', { className: 'label' }, 'API Key'),
              h('input', { className: 'ycp-input', type: 'password', placeholder: 'sk-...', value: apiForm.apiKey, onChange: (event) => setApiForm({ ...apiForm, apiKey: event.target.value }) }),
            ),
            h('div', { className: 'ycp-subrow' },
              h('span', { className: 'label' }, '模型名'),
              h('input', { className: 'ycp-input', placeholder: 'gpt-4o-mini / deepseek-chat', value: apiForm.model, onChange: (event) => setApiForm({ ...apiForm, model: event.target.value }) }),
            ),
            h('div', { className: 'ycp-actions' },
              h('button', { className: 'ycp-btn primary', disabled: apiBusy, onClick: saveApi }, apiBusy ? '保存中…' : '保存接口'),
              h('span', { className: 'ycp-note' }, '留空就用 DSH 里选的模型；记忆和人设不变。'),
            ),
            apiMsg ? h('div', { className: 'ycp-msg' }, apiMsg) : null,
            h('div', { className: 'ycp-subrow' },
              h('span', { className: 'label' }, '作息'),
              h('label', { className: 'ycp-check' }, h('input', { type: 'checkbox', checked: state?.settings?.autonomy?.schedule !== false, onChange: (event) => setAutonomySetting('schedule', event.target.checked) }), ' AI 自己调'),
            ),
            h('div', { className: 'ycp-subrow' },
              h('span', { className: 'label' }, '主动性'),
              h('label', { className: 'ycp-check' }, h('input', { type: 'checkbox', checked: state?.settings?.autonomy?.proactive !== false, onChange: (event) => setAutonomySetting('proactive', event.target.checked) }), ' AI 自己调'),
            ),
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '她的今天'),
              h('div', { className: 'ycp-count' }, state && state.mood ? state.mood.label : ''),
            ),
            state && state.mood
              ? h('div', null,
                  h(Bar, { label: '体力', value: state.mood.energy, tone: 'energy' }),
                  h(Bar, { label: '心情', value: state.mood.mood, tone: 'mood' }),
                  h(Bar, { label: '饱食', value: state.mood.satiety ?? (100 - state.mood.hunger), tone: 'satiety' }),
                  state.mood.balance != null
                    ? h('div', { className: 'ycp-count' }, `余额 ¥${Number(state.mood.balance).toFixed(2)} · ${Number(state.mood.balance) < (Number(state.settings?.balance?.warnBelow) || 10) ? '低于阈值，饱食持续掉' : '高于阈值，饱食快速回满'}`)
                    : null,
                  h('div', { className: 'ycp-stats' },
                    h('span', null, '说了 ', h('b', null, `${state.mood.stats.said} 句`)),
                    h('span', null, '主动 ', h('b', null, `${state.mood.stats.proactive} 次`)),
                    h('span', null, '查网 ', h('b', null, `${state.mood.stats.web} 次`)),
                  ),
                )
              : h('div', { className: 'ycp-empty' }, '状态读取中…'),

            h('div', { className: 'ycp-balance' },
              h('div', { className: 'ycp-balance-head' },
                h('span', null, '余额 ',
                  h('b', { className: balanceInfo && balanceInfo.low ? 'low' : '' },
                    balanceInfo && balanceInfo.total !== null && balanceInfo.total !== undefined
                      ? `${balanceInfo.currency === 'CNY' ? '¥' : balanceInfo.currency + ' '}${Number(balanceInfo.total).toFixed(2)}`
                      : '—')),
                balanceInfo && balanceInfo.low
                  ? h('span', { className: 'ycp-low' }, `低于 ${balanceInfo.warnBelow}，该充了`)
                  : null,
                h('button', {
                  className: 'ycp-btn tiny',
                  disabled: balanceBusy,
                  onClick: refreshBalance,
                }, balanceBusy ? '查…' : '刷新'),
              ),
              h('div', { className: 'ycp-meter' },
                h('i', {
                  style: {
                    width: `${balanceInfo && Number(balanceInfo.total) > 0 ? Math.min(100, Math.max(2, (Number(balanceInfo.total) / 50) * 100)) : 0}%`,
                    background: balanceInfo && balanceInfo.low ? '#d9534f' : '#2f9e6e',
                  },
                }),
              ),
              h('div', { className: 'ycp-subrow' },
                h('span', { className: 'label' }, '饱食阈值（元）'),
                h('input', { className: 'ycp-input', type: 'number', min: '0', step: '1', defaultValue: String(balanceInfo?.warnBelow ?? 10), onBlur: (event) => saveBalanceWarn(event.target.value) }),
              ),
              balanceMsg
                ? h('div', { className: 'ycp-msg bad' }, balanceMsg)
                : (balanceInfo && balanceInfo.error && !balanceInfo.total
                    ? h('div', { className: 'ycp-msg' }, balanceInfo.error)
                    : null),
            ),
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '吃饭账本'),
              h('div', { className: 'ycp-count' }, ledger ? `总消耗 ${Number(ledger.totalTokens || 0).toLocaleString()} tokens` : '读取中…'),
            ),
            ledger
              ? h('div', null,
                  h('div', { className: 'ycp-tabs' },
                    h('button', { className: ledgerTab === 'expense' ? 'ycp-tab on' : 'ycp-tab', onClick: () => setLedgerTab('expense') }, '支出'),
                    h('button', { className: ledgerTab === 'income' ? 'ycp-tab on' : 'ycp-tab', onClick: () => setLedgerTab('income') }, '收入'),
                  ),
                  ledgerTab === 'expense'
                    ? h('div', null,
                        h('div', { className: 'ycp-ledger-grid' },
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '今日预算'), h('b', null, `¥${Number(ledger.dailyBudgetCny || 0).toFixed(2)}`), h('i', null, `${Number(ledger.todayBudgetTokens || 0).toLocaleString()} tok`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '今日已用'), h('b', { className: Number(ledger.todayOver || 0) > 0 ? 'low' : '' }, `¥${Number(ledger.todayExpense || 0).toFixed(2)}`), h('i', { className: Number(ledger.todayOver || 0) > 0 ? 'low' : '' }, Number(ledger.todayOver || 0) > 0 ? `超 ¥${Number(ledger.todayOver).toFixed(2)} · ${Number(ledger.todayTokens || 0).toLocaleString()} tok` : `${Number(ledger.todayTokens || 0).toLocaleString()} tok`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '本月预算'), h('b', null, `¥${Number(ledger.monthlyBudgetCny || 0).toFixed(2)}`), h('i', null, `${Number(ledger.monthlyBudgetTokens || 0).toLocaleString()} tok`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '本月已用'), h('b', null, `¥${Number(ledger.monthExpense || 0).toFixed(2)}`), h('i', null, `${Number(ledger.monthTokens || 0).toLocaleString()} tok`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '总共消耗'), h('b', null, `¥${Number(ledger.totalCost || 0).toFixed(2)}`), h('i', null, `${Number(ledger.totalTokens || 0).toLocaleString()} tok`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '总共剩余'), h('b', { className: 'low' }, ledger.balance != null ? `¥${Number(ledger.balance).toFixed(2)}` : `¥${Number(ledger.remaining || 0).toFixed(2)}`), h('i', null, ledger.remainingTokens != null ? `${Number(ledger.remainingTokens).toLocaleString()} tok` : '账户实际余额')),
                        ),
                        h('div', { className: 'ycp-meter' },
                          h('i', { style: { width: `${Math.min(100, Math.round((Number(ledger.monthExpense || 0) / Number(ledger.budget || 1)) * 100) || 0)}%`, background: Number(ledger.monthExpense) > Number(ledger.budget) ? '#d9534f' : '#2f9e6e' } }),
                        ),
                        h('div', { className: 'ycp-actions' },
                          h('button', { className: 'ycp-btn primary', onClick: () => window.open('https://platform.deepseek.com/top_up', '_blank') }, '喂食 / 去充值'),
                          h('button', { className: 'ycp-btn', onClick: () => loadLedger() }, '刷新'),
                        ),
                        h('div', { className: 'ycp-ledger-form' },
                          h('input', { className: 'ycp-input', type: 'number', min: '0', step: '1', placeholder: 'tokens', value: ledgerAmount, onChange: (event) => setLedgerAmount(event.target.value) }),
                          h('select', { className: 'ycp-select', value: ledgerCategory, onChange: (event) => setLedgerCategory(event.target.value) },
                            h('option', { value: 'chat' }, '聊天'),
                            h('option', { value: 'web' }, '上网'),
                            h('option', { value: 'post' }, '发帖'),
                            h('option', { value: 'play' }, '玩耍'),
                            h('option', { value: 'other' }, '其他'),
                          ),
                          h('input', { className: 'ycp-input', placeholder: '备注（可选）', value: ledgerNote, onChange: (event) => setLedgerNote(event.target.value) }),
                          h('button', { className: 'ycp-btn primary', disabled: ledgerBusy, onClick: addLedger }, ledgerBusy ? '记…' : '记一笔'),
                        ),
                        ledgerMsg ? h('div', { className: 'ycp-msg' }, ledgerMsg) : null,
                        h('div', { className: 'ycp-ledger-list' },
                          ledger.recent.filter((entry) => entry.type === 'token' || entry.type === 'meal').length
                            ? ledger.recent.filter((entry) => entry.type === 'token' || entry.type === 'meal').slice(0, 6).map((entry) => h('div', { key: entry.id, className: 'ycp-ledger-row' },
                                h('span', { className: 'ycp-ledger-cat' }, entry.kind || '聊天'),
                                h('span', { className: 'ycp-ledger-note' }, entry.note || ''),
                                h('b', { className: 'out' }, `🍚 ${Number(entry.tokens).toLocaleString()} tok`),
                                h('button', { className: 'ycp-btn tiny', onClick: () => removeLedger(entry.id) }, '删'),
                              ))
                            : h('div', { className: 'ycp-empty' }, '还没消耗过 tokens'),
                        ),
                        h('div', { className: 'ycp-subrow' },
                          h('span', { className: 'label' }, '钱预算（元）'),
                          h('input', { className: 'ycp-input', type: 'number', min: '0', step: '1', defaultValue: String(ledger.budget ?? 0), onBlur: (event) => saveMoneyBudget(event.target.value) }),
                        ),
                        h('div', { className: 'ycp-subrow' },
                          h('span', { className: 'label' }, '每日预算'),
                          h('input', { className: 'ycp-input', type: 'number', defaultValue: String(ledger.dailyBudget), onBlur: (event) => saveBudget(event.target.value) }),
                        ),
                        h('div', { className: 'ycp-subrow' },
                          h('span', { className: 'label' }, '每月预算'),
                          h('input', { className: 'ycp-input', type: 'number', defaultValue: String(ledger.monthlyBudget), onBlur: (event) => saveMonthlyBudget(event.target.value) }),
                        ),
                      )
                    : h('div', null,
                        h('div', { className: 'ycp-ledger-grid' },
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '今日收入'), h('b', null, `${Number(ledger.todayIncomeTokens).toLocaleString()} tok`), h('i', null, `≈ ¥${(ledger.todayIncomeTokens / 1e6 * 4).toFixed(2)}`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '本月收入'), h('b', null, `${Number(ledger.monthIncomeTokens).toLocaleString()} tok`), h('i', null, `≈ ¥${Number(ledger.incomeCost || 0).toFixed(2)}`)),
                          h('div', { className: 'ycp-stat-card' }, h('span', null, '总收入'), h('b', null, `${Number(ledger.totalIncomeTokens || 0).toLocaleString()} tok`), h('i', null, `≈ ¥${Number(ledger.totalIncomeCost || 0).toFixed(2)}`)),
                        ),
                        h('div', { className: 'ycp-ledger-form' },
                          h('input', { className: 'ycp-input', type: 'number', min: '0', step: '1', placeholder: 'tokens', value: moneyAmount, onChange: (event) => setMoneyAmount(event.target.value) }),
                          h('input', { className: 'ycp-input', placeholder: '来源（可选）', value: moneyNote, onChange: (event) => setMoneyNote(event.target.value) }),
                          h('button', { className: 'ycp-btn primary', disabled: ledgerBusy, onClick: addTokenIncome }, ledgerBusy ? '记…' : '记收入'),
                        ),
                        h('div', { className: 'ycp-ledger-list' },
                          ledger.recent.filter((entry) => entry.type === 'token-income').length
                            ? ledger.recent.filter((entry) => entry.type === 'token-income').slice(0, 6).map((entry) => h('div', { key: entry.id, className: 'ycp-ledger-row' },
                                h('span', { className: 'ycp-ledger-cat' }, '收入'),
                                h('span', { className: 'ycp-ledger-note' }, entry.note || ''),
                                h('b', { className: 'in' }, `+${Number(entry.tokens).toLocaleString()} tok`),
                                h('button', { className: 'ycp-btn tiny', onClick: () => removeLedger(entry.id) }, '删'),
                              ))
                            : h('div', { className: 'ycp-empty' }, '还没有收入'),
                        ),
                      ),
                )
              : h('div', { className: 'ycp-empty' }, '账本读取中…'),
          ),
          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '她的人设'),
              h('div', { className: 'ycp-count' }, `${persona.length} 字`),
            ),
            h('textarea', {
              className: 'ycp-textarea',
              value: persona,
              spellCheck: false,
              disabled: personaBusy,
              onChange: (event) => setPersona(event.target.value),
              placeholder: '写她是谁、什么脾气、怎么说话……',
            }),
            h('div', { className: 'ycp-note' }, '人设会和「成长.md」一起交给模型；原始参考在 人设/参考/。'),
            h('div', { className: 'ycp-actions' },
              h('button', { className: 'ycp-btn primary', disabled: personaBusy || !state, onClick: savePersona },
                personaBusy ? '保存中…' : '保存人设'),
              h('button', {
                className: 'ycp-btn',
                disabled: personaBusy || !defaultPersona,
                onClick: () => { setPersona(defaultPersona); setPersonaMsg('已填回默认，点「保存人设」才生效') },
              }, '恢复默认'),
            ),
            personaMsg ? h('div', { className: 'ycp-msg ok' }, personaMsg) : null,
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '和她说话'),
              h('div', { className: 'ycp-count' }, `最近 ${chatLog.length} 条${chatHasMore ? ' · 还有更早的' : ''}`),
              h('button', { className: 'ycp-btn small', disabled: chatBusy, onClick: () => loadChat() }, chatBusy ? '读…' : '刷新'),
            ),
            h('div', { className: 'ycp-chatlog', ref: chatBoxRef },
              chatHasMore
                ? h('button', { className: 'ycp-btn tiny', disabled: chatBusy, onClick: loadMoreChat, style: { marginBottom: '8px' } },
                    chatBusy ? '读更早的…' : '读更早的')
                : null,
              chatLog.length === 0
                ? h('div', { className: 'ycp-empty' }, '还没有聊天记录，说一句试试。')
                : null,
              chatLog.map((item, index) => h('div', {
                key: `${item.at}-${index}`,
                className: item.role === 'assistant' ? 'ycp-bubble' : 'ycp-bubble me',
              },
                h('div', null,
                  h('span', { className: 'ycp-bubble-name' }, item.role === 'assistant' ? (state ? state.name : '阿闷') : '主人'),
                  '：', item.text,
                ),
                item.at ? h('div', { className: 'ycp-bubble-meta' }, `${clock(item.at)} · ${timeAgo(item.at)}`) : null,
              )),
              saying
                ? h('div', { className: 'ycp-bubble ycp-typing' },
                    h('span', { className: 'ycp-bubble-name' }, `${state ? state.name : '阿闷'}：`),
                    h('i', { className: 'ycp-dot' }), h('i', { className: 'ycp-dot' }), h('i', { className: 'ycp-dot' }),
                  )
                : null,
            ),
            h('div', { className: 'ycp-say' },
              h('input', {
                className: 'ycp-input',
                value: draft,
                maxLength: 500,
                disabled: saying,
                placeholder: '比如：今晚吃啥？',
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') sendSay() },
              }),
              h('button', { className: 'ycp-btn primary', disabled: saying || !state, onClick: sendSay },
                saying ? '她在想…' : '发给她'),
            ),
            sayError ? h('div', { className: 'ycp-msg bad' }, sayError) : null,
            reply && reply.recalled && reply.recalled.length
              ? h('div', { className: 'ycp-note' }, `刚才想起：${reply.recalled.map((item) => item.title).join('、')}`)
              : null,
            reply && reply.voiceUrl
              ? h('audio', {
                  className: 'ycp-audio',
                  controls: true,
                  autoPlay: Boolean(voiceForm && voiceForm.autoSpeak),
                  src: reply.voiceUrl,
                })
              : null,
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '记忆'),
              h('div', { className: 'ycp-count' }, memory ? `${cardTotal} 张卡` : '读取中…'),
              h('button', {
                className: 'ycp-btn small',
                disabled: diaryBusy,
                onClick: writeDiary,
              }, diaryBusy ? '她在写…' : '让她写今天的日记'),
            ),
            diaryMsg ? h('div', { className: 'ycp-msg ok' }, diaryMsg) : null,
            h('div', { className: 'ycp-tabs' },
              tabs.map((tab) => h('button', {
                key: tab.key,
                className: memTab === tab.key ? 'ycp-tab on' : 'ycp-tab',
                onClick: () => { setMemTab(tab.key); setMemCard(null) },
              }, `${tab.label} ${memory && memory.layers && memory.layers[tab.key] ? memory.layers[tab.key].length : 0}`)),
            ),
            memTab === 'diary'
              ? h('div', { className: 'ycp-diary-box' },
                  h('textarea', {
                    className: 'ycp-input',
                    value: diaryDraft,
                    placeholder: '今天想记一句什么……',
                    rows: 2,
                    disabled: memBusy,
                    style: { minHeight: '52px', resize: 'vertical' },
                    onChange: (event) => setDiaryDraft(event.target.value),
                  }),
                  h('button', {
                    className: 'ycp-btn primary',
                    disabled: memBusy || !diaryDraft.trim(),
                    onClick: saveDiary,
                  }, '记到今天'),
                )
              : null,
            h('div', { className: 'ycp-actions', style: { marginTop: '0', marginBottom: '6px' } },
              h('button', { className: 'ycp-btn small', disabled: memBusy, onClick: newCard }, '新建卡'),
              h('button', { className: 'ycp-btn small', disabled: memBusy, onClick: loadMemory }, '刷新'),
              h('button', { className: 'ycp-btn small', disabled: memBusy, onClick: runCheck }, '体检'),
              h('button', { className: 'ycp-btn small', disabled: memBusy, onClick: runReflect }, '让她回看今天'),
            ),
            cards.length === 0
              ? h('div', { className: 'ycp-empty' },
                  memTab === 'diary' ? '还没有日记，先写一句。' : '这一层还没有卡，点「新建卡」。')
              : null,
            cards.map((card) => h('div', { key: card.file, className: 'ycp-memrow' },
              h('div', { className: 'ycp-mem-main' },
                h('div', { className: 'ycp-mem-title' }, card.title || card.file),
                card.description ? h('div', { className: 'ycp-mem-desc' }, card.description) : null,
                h('div', { className: 'ycp-mem-meta' }, `${card.importance ? `重要度 ${card.importance} · ` : ''}${card.file} · ${card.chars} 字 · ${shortTime(card.mtimeMs)}`),
              ),
              h('div', { className: 'ycp-mem-actions' },
                h('button', { className: 'ycp-btn small', disabled: memBusy, onClick: () => openCard(card.layer, card.file) }, '打开'),
                h('button', { className: 'ycp-btn small', disabled: memBusy, onClick: () => removeCard(card.layer, card.file) }, '删'),
              ),
            )),
            memCard
              ? h('div', { className: 'ycp-editor' },
                  h('div', { className: 'ycp-editor-head' }, `编辑 · ${memCard.file}`),
                  h('textarea', {
                    className: 'ycp-textarea',
                    value: memCard.content,
                    spellCheck: false,
                    disabled: memBusy,
                    onChange: (event) => setMemCard({ ...memCard, content: event.target.value }),
                  }),
                  h('div', { className: 'ycp-actions' },
                    h('button', { className: 'ycp-btn primary', disabled: memBusy, onClick: saveCard }, '保存卡'),
                    h('button', { className: 'ycp-btn', disabled: memBusy, onClick: () => setMemCard(null) }, '取消'),
                  ),
                )
              : null,
            memMsg ? h('div', { className: 'ycp-msg ok' }, memMsg) : null,
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '作息'),
              h('div', { className: 'ycp-count' }, state && state.rhythm ? state.rhythm.label : ''),
            ),
            schedule
              ? h('div', null,
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '工作日'),
                    '起床', h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.weekday.wake, disabled: scheduleBusy,
                      onChange: (event) => patchSlot('weekday', { wake: event.target.value }),
                    }),
                    '睡觉', h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.weekday.sleep, disabled: scheduleBusy,
                      onChange: (event) => patchSlot('weekday', { sleep: event.target.value }),
                    }),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '周末'),
                    '起床', h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.weekend.wake, disabled: scheduleBusy,
                      onChange: (event) => patchSlot('weekend', { wake: event.target.value }),
                    }),
                    '睡觉', h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.weekend.sleep, disabled: scheduleBusy,
                      onChange: (event) => patchSlot('weekend', { sleep: event.target.value }),
                    }),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('label', { className: 'ycp-check' },
                      h('input', {
                        type: 'checkbox', checked: schedule.nap.enabled, disabled: scheduleBusy,
                        onChange: (event) => patchSlot('nap', { enabled: event.target.checked }),
                      }),
                      '午睡',
                    ),
                    h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.nap.from, disabled: scheduleBusy || !schedule.nap.enabled,
                      onChange: (event) => patchSlot('nap', { from: event.target.value }),
                    }),
                    '–',
                    h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.nap.to, disabled: scheduleBusy || !schedule.nap.enabled,
                      onChange: (event) => patchSlot('nap', { to: event.target.value }),
                    }),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('label', { className: 'ycp-check' },
                      h('input', {
                        type: 'checkbox', checked: schedule.quiet.enabled, disabled: scheduleBusy,
                        onChange: (event) => patchSlot('quiet', { enabled: event.target.checked }),
                      }),
                      '安静时段',
                    ),
                    h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.quiet.from, disabled: scheduleBusy || !schedule.quiet.enabled,
                      onChange: (event) => patchSlot('quiet', { from: event.target.value }),
                    }),
                    '–',
                    h('input', {
                      type: 'time', className: 'ycp-time', value: schedule.quiet.to, disabled: scheduleBusy || !schedule.quiet.enabled,
                      onChange: (event) => patchSlot('quiet', { to: event.target.value }),
                    }),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '睡着时'),
                    h('div', { className: 'ycp-choice' },
                      h('button', {
                        className: schedule.sleepReply === 'reply' ? 'on' : '',
                        disabled: scheduleBusy,
                        onClick: () => patchSchedule({ sleepReply: 'reply' }),
                      }, '回一句困的'),
                      h('button', {
                        className: schedule.sleepReply === 'silent' ? 'on' : '',
                        disabled: scheduleBusy,
                        onClick: () => patchSchedule({ sleepReply: 'silent' }),
                      }, '完全不理'),
                    ),
                  ),
                  h('div', { className: 'ycp-actions' },
                    h('button', { className: 'ycp-btn primary', disabled: scheduleBusy, onClick: saveScheduleToServer },
                      scheduleBusy ? '保存中…' : '保存作息'),
                  ),
                  h('div', { className: 'ycp-hint' },
                    '「完全不理」时，试说会直接被闸门挡回来；「回一句困的」会带着困意回，都很短。'),
                  scheduleMsg ? h('div', { className: 'ycp-msg ok' }, scheduleMsg) : null,
                )
              : h('div', { className: 'ycp-empty' }, '作息读取中…'),
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '主动'),
              h('div', { className: 'ycp-count' }, proactive ? `今天 ${proactive.usedToday}/${proactive.dailyLimit} 次` : ''),
            ),
            h('div', { className: 'ycp-subrow' },
              h('label', { className: 'ycp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: proactiveForm.enabled,
                  disabled: proactiveBusy,
                  onChange: (event) => setProactiveForm({ ...proactiveForm, enabled: event.target.checked }),
                }),
                '主动开口',
              ),
              '每隔',
              h('input', {
                type: 'number', className: 'ycp-time', min: 1, max: 240,
                value: proactiveForm.everyMin, disabled: proactiveBusy,
                onChange: (event) => setProactiveForm({ ...proactiveForm, everyMin: Number(event.target.value) }),
              }),
              '分钟',
              '每天最多',
              h('input', {
                type: 'number', className: 'ycp-time', min: 0, max: 50,
                value: proactiveForm.dailyLimit, disabled: proactiveBusy,
                onChange: (event) => setProactiveForm({ ...proactiveForm, dailyLimit: Number(event.target.value) }),
              }),
              '次',
              h('button', { className: 'ycp-btn small', disabled: proactiveBusy, onClick: saveProactive }, '保存'),
            ),
            proactive && proactive.messages && proactive.messages.length
              ? h('div', { className: 'ycp-bubble' },
                  h('div', null,
                    h('span', { className: 'ycp-bubble-name' }, `${state ? state.name : '阿闷'}：`),
                    proactive.messages[0].text,
                  ),
                  h('div', { className: 'ycp-bubble-meta' },
                    `主动 · ${clock(proactive.messages[0].at)}${proactive.nextAt ? ` · 下次最早 ${clock(proactive.nextAt)}` : ''}`),
                )
              : h('div', { className: 'ycp-empty' }, '还没有主动说过话。'),
            h('div', { className: 'ycp-actions' },
              h('button', { className: 'ycp-btn', disabled: proactiveBusy, onClick: tickProactive },
                proactiveBusy ? '她在想…' : '现在试一次'),
            ),
            proactiveMsg ? h('div', { className: 'ycp-msg ok' }, proactiveMsg) : null,
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '音效'),
              h('div', { className: 'ycp-count' }, soundForm && soundForm.enabled ? `音量 ${soundForm.volume}` : '关着'),
            ),
            soundForm
              ? h('div', null,
                  h('div', { className: 'ycp-subrow' },
                    h('label', { className: 'ycp-check' },
                      h('input', {
                        type: 'checkbox', checked: soundForm.enabled, disabled: soundBusy,
                        onChange: (event) => saveSound({ enabled: event.target.checked }),
                      }),
                      '开',
                    ),
                    h('span', { className: 'label' }, '音量'),
                    h('input', {
                      type: 'range', className: 'ycp-range', min: 0, max: 100, step: 5,
                      value: soundForm.volume, disabled: soundBusy,
                      onChange: (event) => setSoundForm({ ...soundForm, volume: Number(event.target.value) }),
                      onMouseUp: () => saveSound({ volume: soundForm.volume }),
                    }),
                    h('span', { className: 'ycp-count' }, String(soundForm.volume)),
                  ),
                  h('div', { className: 'ycp-actions' },
                    ...((soundInfo && soundInfo.events) || []).map((event) => h('button', {
                      key: event.id,
                      className: 'ycp-btn small',
                      onClick: () => playSound(event.id),
                    }, event.label)),
                  ),
                  soundMsg ? h('div', { className: 'ycp-msg bad' }, soundMsg) : null,
                )
              : h('div', { className: 'ycp-empty' }, '音效读取中…'),
          ),

          h('div', { className: 'ycp-section', style: { display: 'none' } },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '声音'),
              h('div', { className: 'ycp-count' },
                voiceInfo && voiceInfo.error
                  ? `系统语音不可用：${voiceInfo.error}`
                  : (voiceForm && voiceForm.enabled ? '会出声' : '静音')),
            ),
            voiceForm
              ? h('div', null,
                  h('div', { className: 'ycp-subrow' },
                    h('label', { className: 'ycp-check' },
                      h('input', {
                        type: 'checkbox', checked: voiceForm.enabled, disabled: voiceBusy,
                        onChange: (event) => saveVoice({ enabled: event.target.checked }),
                      }),
                      '出声',
                    ),
                    h('label', { className: 'ycp-check' },
                      h('input', {
                        type: 'checkbox', checked: voiceForm.autoSpeak, disabled: voiceBusy,
                        onChange: (event) => saveVoice({ autoSpeak: event.target.checked }),
                      }),
                      '回复自动朗读',
                    ),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '音色'),
                    h('select', {
                      className: 'ycp-select',
                      value: voiceForm.name || '',
                      disabled: voiceBusy,
                      onChange: (event) => saveVoice({ name: event.target.value }),
                    },
                      h('option', { value: '' }, '（跟随系统默认）'),
                      ...(voiceInfo && Array.isArray(voiceInfo.voices) ? voiceInfo.voices : []).map((item) => h('option', {
                        key: item.name,
                        value: item.name,
                      }, `${item.name} · ${item.culture} · ${item.gender}`)),
                    ),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '语速'),
                    h('input', {
                      type: 'range', className: 'ycp-range', min: -10, max: 10, step: 1,
                      value: voiceForm.rate, disabled: voiceBusy,
                      onChange: (event) => setVoiceForm({ ...voiceForm, rate: Number(event.target.value) }),
                    }),
                    h('span', { className: 'ycp-count' }, String(voiceForm.rate)),
                    h('span', { className: 'label' }, '音调'),
                    h('input', {
                      type: 'range', className: 'ycp-range', min: -30, max: 30, step: 2,
                      value: voiceForm.pitch, disabled: voiceBusy,
                      onChange: (event) => setVoiceForm({ ...voiceForm, pitch: Number(event.target.value) }),
                    }),
                    h('span', { className: 'ycp-count' }, String(voiceForm.pitch)),
                    h('span', { className: 'label' }, '音量'),
                    h('input', {
                      type: 'range', className: 'ycp-range', min: 0, max: 100, step: 5,
                      value: voiceForm.volume, disabled: voiceBusy,
                      onChange: (event) => setVoiceForm({ ...voiceForm, volume: Number(event.target.value) }),
                    }),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '语气'),
                    h('select', {
                      className: 'ycp-select',
                      value: voiceForm.style || '',
                      disabled: voiceBusy,
                      onChange: (event) => saveVoice({ style: event.target.value }),
                    },
                      h('option', { value: '' }, '自然'),
                      h('option', { value: 'soft' }, '软一点'),
                      h('option', { value: 'cheerful' }, '雀跃'),
                      h('option', { value: 'calm' }, '平静'),
                      h('option', { value: 'sharp' }, '嘴贫'),
                    ),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '音色'),
                    h('select', {
                      className: 'ycp-select',
                      value: voiceForm.timbre || 'natural',
                      disabled: voiceBusy,
                      onChange: (event) => saveVoice({ timbre: event.target.value }),
                    },
                      h('option', { value: 'soft-loli' }, '软萌萝莉'),
                      h('option', { value: 'tsundere-loli' }, '傲娇萝莉'),
                      h('option', { value: 'natural' }, '自然'),
                    ),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '神经语音'),
                    h('input', {
                      className: 'ycp-input',
                      placeholder: 'OpenAI 兼容 /v1/audio/speech 地址，留空用本地',
                      value: voiceForm.neuralUrl || '',
                      disabled: voiceBusy,
                      onChange: (event) => setVoiceForm({ ...voiceForm, neuralUrl: event.target.value }),
                    }),
                    h('input', {
                      className: 'ycp-input',
                      placeholder: 'tts-1',
                      value: voiceForm.neuralModel || '',
                      disabled: voiceBusy,
                      onChange: (event) => setVoiceForm({ ...voiceForm, neuralModel: event.target.value }),
                    }),
                  ),
                  h('div', { className: 'ycp-hint' },
                    '想更真人：填一个神经语音地址（key 放环境变量 YCP_TTS_KEY），她就会优先用神经音色；不填就用本地语音。'),
                  h('div', { className: 'ycp-actions' },
                    h('button', { className: 'ycp-btn primary', disabled: voiceBusy, onClick: () => saveVoice({}) }, '保存'),
                    h('button', { className: 'ycp-btn', disabled: voiceBusy, onClick: previewVoice }, '试听'),
                    h('button', { className: 'ycp-btn', disabled: voiceBusy, onClick: deriveVoice }, '按人设配声音'),
                  ),
                  previewUrl
                    ? h('audio', { className: 'ycp-audio', controls: true, autoPlay: true, src: previewUrl })
                    : null,
                  voiceMsg ? h('div', { className: 'ycp-msg ok' }, voiceMsg) : null,
                )
              : h('div', { className: 'ycp-empty' }, '声音读取中…'),
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '外观'),
              h('div', { className: 'ycp-count' }, petInfo ? (petInfo.available ? 'Electron 可用' : 'Electron 不可用') : ''),
            ),
            h('div', { className: 'ycp-subrow' },
              h('span', { className: 'label' }, '桌宠'),
              h('span', { className: 'ycp-count' },
                petInfo ? (petInfo.running ? '在桌面上跑着' : '还没出来') : '读取中…'),
              petInfo && petInfo.running
                ? h('button', { className: 'ycp-btn small', disabled: petBusy, onClick: stopPet }, '收起来')
                : h('button', { className: 'ycp-btn small', disabled: petBusy, onClick: startPet }, '放她出来'),
              h('label', { className: 'ycp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(state && state.settings && state.settings.appearance && state.settings.appearance.petEnabled),
                  disabled: petBusy,
                  onChange: toggleAutoPet,
                }),
                '开 DSH 时自动',
              ),
            ),
            petInfo && petInfo.window && petInfo.window.bounds
              ? h('div', { className: 'ycp-mem-meta' },
                  `窗口 ${Math.round(petInfo.window.bounds.width)}×${Math.round(petInfo.window.bounds.height)}` +
                  ` · 位置 ${Math.round(petInfo.window.bounds.x)},${Math.round(petInfo.window.bounds.y)}` +
                  ` · 被点 ${petInfo.window.reactions || 0} 次`)
              : null,
            h('div', { className: 'ycp-hint' }, '拖着她走、点她一下、右键有菜单（聊天 / 动画 / 设置）。'),
            petMsg ? h('div', { className: 'ycp-msg ok' }, petMsg) : null,
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '设置'),
              h('div', { className: 'ycp-count' }, saved || ''),
            ),
            h('div', { className: 'ycp-row' },
              h('div', { className: 'ycp-field' },
                h('label', null, '名字'),
                h('input', {
                  className: 'ycp-input',
                  value: name,
                  maxLength: 24,
                  disabled: busy,
                  onChange: (event) => setName(event.target.value),
                  placeholder: '阿闷',
                }),
              ),
              h('label', { className: 'ycp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: enabled,
                  disabled: busy,
                  onChange: (event) => setEnabled(event.target.checked),
                }),
                '启用',
              ),
              h('button', { className: 'ycp-btn', disabled: busy || !state, onClick: saveSettings },
                busy ? '保存中…' : '保存设置'),
            ),
            h('div', { className: 'ycp-row', style: { marginTop: '8px' } },
              h('div', { className: 'ycp-field' },
                h('label', null, '记忆核心（每轮必带的字数）'),
                h('input', {
                  className: 'ycp-input',
                  type: 'number',
                  min: 400,
                  max: 3000,
                  value: coreChars,
                  disabled: busy,
                  onChange: (event) => setCoreChars(event.target.value),
                }),
              ),
              h('div', { className: 'ycp-field' },
                h('label', null, '相关记忆（按问题检索的字数）'),
                h('input', {
                  className: 'ycp-input',
                  type: 'number',
                  min: 200,
                  max: 2000,
                  value: recallChars,
                  disabled: busy,
                  onChange: (event) => setRecallChars(event.target.value),
                }),
              ),
              h('div', { className: 'ycp-field' },
                h('label', null, '对话上下文（字，最多 512000）'),
                h('input', {
                  className: 'ycp-input',
                  type: 'number',
                  min: 2000,
                  max: 512000,
                  step: 1000,
                  value: historyChars,
                  disabled: busy,
                  onChange: (event) => setHistoryChars(event.target.value),
                }),
              ),
              h('label', { className: 'ycp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: autoReflect,
                  disabled: busy,
                  onChange: (event) => setAutoReflect(event.target.checked),
                }),
                '每天自己回看记忆',
              ),
            ),
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '权限'),
              h('div', { className: 'ycp-count' }, `当前：${permNow ? permNow.name : '禁足'}`),
            ),
            h('div', { className: 'ycp-note' }, '只有你能改；她自己的工具没有改权限的入口。'),
            h('div', { className: 'ycp-perms' },
              permLevels.map((level) => h('button', {
                key: level.key,
                className: permLevel === level.key ? 'ycp-perm on' : 'ycp-perm',
                disabled: permBusy,
                onClick: () => setPermLevel(level.key),
              },
                h('div', { className: 'ycp-perm-name' }, `${level.name}${state && state.permission && state.permission.level === level.key ? ' · 现在' : ''}`),
                h('div', { className: 'ycp-perm-desc' }, level.summary),
                level.key === 'full' ? h('div', { className: 'ycp-perm-warn' }, '⚠ 会放开系统目录') : null,
              )),
            ),
            h('div', { className: 'ycp-actions', style: { marginTop: '0' } },
              h('button', { className: 'ycp-btn', disabled: permBusy, onClick: savePermissionLevel },
                permBusy ? '改…' : '保存权限'),
              permMsg ? h('span', { className: 'ycp-note' }, permMsg) : null,
            ),
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '她的家'),
              h('div', { className: 'ycp-count' }, state ? `目录 ${state.dirs.filter((d) => d.exists).length}/${state.dirs.length}` : ''),
            ),
            h('div', { className: 'ycp-path' }, state ? state.paths.root : '（读不到路径）'),
          ),

          h('div', { className: 'ycp-foot' },
            '人设是她唯一的性格来源，模型看到全文原样，不总结、不加工。',
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          const id = 'dsh-Ycp/panel.css'
          if (document.querySelector(`style[data-plugin-css="${id}"]`)) return undefined
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-Ycp'
          tag.dataset.pluginCss = id
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'dsh-Ycp: styles')

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-Ycp',
          order: 3,
          label: () => '记忆智能',
        }, FishIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-Ycp',
        }, Panel))
      },
    }
  },
})
