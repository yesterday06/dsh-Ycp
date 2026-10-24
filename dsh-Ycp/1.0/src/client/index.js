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

    const VERSION = '0.1.0'
    const API = '/api/dsh-Ycp'

    const CSS = `
      .ycp-panel { height:100%; overflow:auto; padding:26px 24px 44px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font-size:13px; line-height:1.6; }
      .ycp-wrap { max-width:780px; margin:0 auto; }
      .ycp-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
      .ycp-title { font-size:20px; font-weight:650; letter-spacing:.3px; }
      .ycp-sub { color:var(--dsw-alias-label-secondary); font-size:12px; margin-top:3px; }
      .ycp-pill { flex-shrink:0; display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-state-success-primary); color:var(--dsw-alias-state-success-primary); border-radius:999px; padding:3px 10px; font-size:11px; }
      .ycp-pill.bad { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
      .ycp-pill.wait { border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
      .ycp-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
      .ycp-status { display:flex; gap:18px; flex-wrap:wrap; align-items:center; margin:16px 0 14px; padding:10px 14px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); font-size:12px; color:var(--dsw-alias-label-secondary); }
      .ycp-status b { color:var(--dsw-alias-label-primary); font-weight:600; }
      .ycp-section { border:1px solid var(--dsw-alias-border-l1); border-radius:16px; background:var(--dsw-alias-bg-layer-1); padding:16px 18px; margin-bottom:12px; box-shadow:0 6px 18px rgba(22,86,128,.05); transition:border-color .2s, box-shadow .2s; }
      .ycp-section:hover { border-color:rgba(96,196,235,.45); box-shadow:0 8px 22px rgba(22,86,128,.09); }
      .ycp-section-title { font-weight:650; display:flex; align-items:center; gap:8px; }
      .ycp-section-title::before { content:''; width:3px; height:13px; border-radius:2px; background:linear-gradient(#6fd2f3,#2a7fb6); }
      .ycp-section-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:9px; }
      .ycp-section-title { font-size:12px; font-weight:650; letter-spacing:.4px; color:var(--dsw-alias-label-secondary); text-transform:uppercase; }
      .ycp-count { font-size:11px; color:var(--dsw-alias-label-secondary); }
      .ycp-textarea { width:100%; min-height:190px; resize:vertical; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:10px 12px; font-size:13px; line-height:1.7; font-family:inherit; }
      .ycp-textarea:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
      .ycp-actions { display:flex; gap:8px; margin-top:9px; flex-wrap:wrap; }
      .ycp-btn { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); border-radius:7px; padding:6px 14px; font-size:12px; cursor:pointer; }
      .ycp-btn.primary { background:#247bbf; border-color:#247bbf; color:#fff; font-weight:600; }
      .ycp-btn[disabled] { opacity:.55; cursor:not-allowed; }
      .ycp-msg { font-size:12px; margin-top:8px; }
      .ycp-msg.ok { color:var(--dsw-alias-state-success-primary); }
      .ycp-msg.bad { color:var(--dsw-alias-state-error-primary); white-space:pre-wrap; }
      .ycp-say { display:flex; gap:8px; }
      .ycp-input { flex:1; min-width:0; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:7px 10px; font-size:13px; }
      .ycp-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
      .ycp-bubble { margin-top:10px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-base); padding:10px 13px; font-size:13px; line-height:1.7; white-space:pre-wrap; }
      .ycp-bubble-name { font-weight:600; margin-right:4px; }
      .ycp-bubble-meta { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:6px; }
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
      .ycp-foot { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:14px; }
      .ycp-hero { display:flex; align-items:center; gap:18px; margin:18px 0 14px; padding:14px 18px; border:1px solid var(--dsw-alias-border-l1); border-radius:18px; background:linear-gradient(135deg, rgba(96,196,235,.16), rgba(255,255,255,0) 62%), var(--dsw-alias-bg-layer-1); box-shadow:0 10px 26px rgba(22,86,128,.08); }
      .ycp-portrait { width:112px; height:112px; flex-shrink:0; display:block; border-radius:22px; filter:drop-shadow(0 10px 16px rgba(21,84,124,.22)); animation:ycp-float 4.5s ease-in-out infinite; }
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
        src: '/api/dsh-Ycp/character.svg',
        alt: '大肥鱼',
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

      const [toolsData, setToolsData] = React.useState(null)
      const [toolText, setToolText] = React.useState('你好')
      const [toolMsg, setToolMsg] = React.useState('')
      const [toolBusy, setToolBusy] = React.useState(false)
      const [permBusy, setPermBusy] = React.useState(false)

      const [browserInfo, setBrowserInfo] = React.useState(null)
      const [sitesText, setSitesText] = React.useState('')
      const [browserMsg, setBrowserMsg] = React.useState('')
      const [browserBusy, setBrowserBusy] = React.useState(false)

      const [desktopInfo, setDesktopInfo] = React.useState(null)
      const [appsText, setAppsText] = React.useState('')
      const [desktopMsg, setDesktopMsg] = React.useState('')
      const [desktopBusy, setDesktopBusy] = React.useState(false)

      const [autonomy, setAutonomy] = React.useState(null)
      const [autonomyBusy, setAutonomyBusy] = React.useState(false)

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
      const lowSoundPlayed = React.useRef(false)

      const load = React.useCallback(async () => {
        try {
          const data = await call('/state')
          setState(data)
          setName(data.settings.name)
          setEnabled(data.settings.enabled)
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
          const data = await call('/tools')
          setToolsData(data)
        } catch (cause) {
          setToolMsg(`工具读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/browser')
          setBrowserInfo(data)
          setSitesText(Array.isArray(data.sites) ? data.sites.join(', ') : '')
        } catch (cause) {
          setBrowserMsg(`浏览器状态读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/desktop')
          setDesktopInfo(data)
          setAppsText(Array.isArray(data.apps) ? data.apps.join(', ') : '')
        } catch (cause) {
          setDesktopMsg(`桌面状态读不到：${String((cause && cause.message) || cause)}`)
        }
        try {
          const data = await call('/autonomy')
          setAutonomy(data)
        } catch { /* 自主状态读不到不影响面板 */ }
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
          try {
            const data = await call('/autonomy')
            setAutonomy(data)
          } catch { /* 同上 */ }
        }, 10000)
        return () => clearInterval(timer)
      }, [])

      React.useEffect(() => {
        if (!balanceInfo || !balanceInfo.low) return
        if (lowSoundPlayed.current) return
        lowSoundPlayed.current = true
        playSound('low')
      }, [balanceInfo])

      const saveSettings = async () => {
        setBusy(true)
        setSaved('')
        try {
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ name, enabled }) })
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

      const invokeDemo = async (id, args) => {
        setToolBusy(true)
        setToolMsg('')
        try {
          const result = await call('/tools/invoke', { method: 'POST', body: JSON.stringify({ id, args }) })
          if (result.ok) {
            const value = result.result
            setToolMsg(`返回：${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
          } else {
            setToolMsg(`失败（${result.reason}）：${result.error}`)
          }
        } catch (cause) {
          setToolMsg(`调用失败：${String((cause && cause.message) || cause)}`)
        } finally {
          setToolBusy(false)
        }
      }

      const togglePermission = async (key) => {
        setPermBusy(true)
        setToolMsg('')
        try {
          const current = (state && state.settings && state.settings.permissions) || {}
          const result = await call('/settings', {
            method: 'PUT',
            body: JSON.stringify({ permissions: { ...current, [key]: !current[key] } }),
          })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          try {
            const data = await call('/tools')
            setToolsData(data)
          } catch { /* 列表刷不出来不影响开关 */ }
          setToolMsg(`「${key}」已${result.settings.permissions[key] ? '打开' : '关掉'}`)
        } catch (cause) {
          setToolMsg(`改不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setPermBusy(false)
        }
      }

      const reloadBrowser = async () => {
        try {
          const data = await call('/browser')
          setBrowserInfo(data)
          setSitesText(Array.isArray(data.sites) ? data.sites.join(', ') : '')
        } catch { /* 保持旧值 */ }
      }

      const toggleHand = async (id) => {        setBrowserBusy(true)
        setBrowserMsg('')
        try {
          const hands = (state && state.settings && state.settings.hands) || {}
          const result = await call('/settings', {
            method: 'PUT',
            body: JSON.stringify({ hands: { [id]: !hands[id] } }),
          })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          await reloadBrowser()
          setBrowserMsg(`「${id}」这条手已${result.settings.hands[id] ? '打开' : '关掉'}`)
        } catch (cause) {
          setBrowserMsg(`改不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setBrowserBusy(false)
        }
      }

      const loginBrowser = async () => {
        setBrowserBusy(true)
        setBrowserMsg('')
        try {
          const result = await call('/tools/invoke', {
            method: 'POST',
            body: JSON.stringify({ id: 'browser.login', args: { url: 'https://www.bilibili.com' } }),
          })
          if (!result.ok) throw new Error(result.error || '打不开')
          setBrowserMsg('登录窗口已打开：登录完直接关掉窗口，登录态会留在她的浏览器里')
          await reloadBrowser()
        } catch (cause) {
          setBrowserMsg(`打不开：${String((cause && cause.message) || cause)}`)
        } finally {
          setBrowserBusy(false)
        }
      }

      const saveSites = async () => {
        setBrowserBusy(true)
        setBrowserMsg('')
        try {
          const sites = sitesText.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ hands: { browserSites: sites } }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          await reloadBrowser()
          setBrowserMsg(`白名单已存：${sites.length ? sites.join('、') : '（空，谁都打不开）'}`)
        } catch (cause) {
          setBrowserMsg(`存不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setBrowserBusy(false)
        }
      }

      const stopBrowser = async () => {
        setBrowserBusy(true)
        setBrowserMsg('')
        try {
          const result = await call('/browser/stop', { method: 'POST', body: '{}' })
          setBrowserInfo(result.status)
          setBrowserMsg(result.closed ? '浏览器已关' : '浏览器本来就没开')
        } catch (cause) {
          setBrowserMsg(`关不掉：${String((cause && cause.message) || cause)}`)
        } finally {
          setBrowserBusy(false)
        }
      }

      const reloadDesktop = async () => {
        try {
          const data = await call('/desktop')
          setDesktopInfo(data)
          setAppsText(Array.isArray(data.apps) ? data.apps.join(', ') : '')
        } catch { /* 保持旧值 */ }
      }

      const saveApps = async () => {
        setDesktopBusy(true)
        setDesktopMsg('')
        try {
          const apps = appsText.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)
          const result = await call('/settings', { method: 'PUT', body: JSON.stringify({ hands: { desktopApps: apps } }) })
          setState((prev) => (prev ? { ...prev, settings: result.settings } : prev))
          await reloadDesktop()
          setDesktopMsg(`程序白名单已存：${apps.length ? apps.join('、') : '（空，谁都不许启动）'}`)
        } catch (cause) {
          setDesktopMsg(`存不了：${String((cause && cause.message) || cause)}`)
        } finally {
          setDesktopBusy(false)
        }
      }

      const resolveStuck = async () => {
        setAutonomyBusy(true)
        try {
          await call('/autonomy/resolve', { method: 'POST', body: '{}' })
          const data = await call('/autonomy')
          setAutonomy(data)
        } catch { /* 清不掉就等下次轮询 */ }
        finally { setAutonomyBusy(false) }
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

      const refreshBalance = async () => {
        setBalanceBusy(true)
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
              h('div', { className: 'ycp-title' }, state ? state.name : '大肥鱼'),
              h('div', { className: 'ycp-sub' }, `v${VERSION} · 鲸鱼娘`),
            ),
            pill,
          ),

          h('div', { className: 'ycp-hero' },
            h(BigFish),
            h('div', null,
              h('div', { className: 'ycp-quote' }, '一条赖在主人电脑里不肯走的', h('b', null, '鲸鱼娘'), '。'),
              h('div', { className: 'ycp-note' }, '下面的人设是她全部的性格来源；改完保存，下一句话立刻换嘴。'),
            ),
          ),

          h('div', { className: 'ycp-status' },
            h('span', null, '现在 ', h('b', null, state && state.rhythm ? state.rhythm.label : '—')),
            h('span', null, '模型 ', h('b', null, modelLabel)),
            h('span', null, '人设 ', h('b', null, `${state ? state.persona.chars : 0} 字`)),
            h('span', null, '上次说话 ', h('b', null, reply ? clock(reply.at) : '还没说过')),
          ),

          autonomy && autonomy.pending
            ? h('div', { className: 'ycp-banner' },
                h('div', null,
                  h('b', null, '我卡住了：'),
                  autonomy.pending.goal,
                  ' —— ',
                  autonomy.pending.reason,
                ),
                h('button', { className: 'ycp-btn small', disabled: autonomyBusy, onClick: resolveStuck }, '知道了'),
              )
            : null,

          error ? h('div', { className: 'ycp-msg bad' }, `出错了：${error}`) : null,

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '她的今天'),
              h('div', { className: 'ycp-count' }, state && state.mood ? state.mood.label : ''),
            ),
            state && state.mood
              ? h('div', null,
                  h(Bar, { label: '体力', value: state.mood.energy, tone: 'energy' }),
                  h(Bar, { label: '心情', value: state.mood.mood, tone: 'mood' }),
                  h(Bar, { label: '饿', value: state.mood.hunger, tone: 'hunger' }),
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
              balanceMsg
                ? h('div', { className: 'ycp-msg bad' }, balanceMsg)
                : (balanceInfo && balanceInfo.error && !balanceInfo.total
                    ? h('div', { className: 'ycp-msg' }, balanceInfo.error)
                    : null),
            ),
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
              h('div', { className: 'ycp-section-title' }, '试说一句'),
              h('div', { className: 'ycp-count' }, '只用来验话风，不发送到任何地方'),
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
                saying ? '她在想…' : '让她回'),
            ),
            sayError ? h('div', { className: 'ycp-msg bad' }, sayError) : null,
            saying
              ? h('div', { className: 'ycp-bubble ycp-typing' },
                  h('span', { className: 'ycp-bubble-name' }, `${state ? state.name : '大肥鱼'}：`),
                  h('i', { className: 'ycp-dot' }), h('i', { className: 'ycp-dot' }), h('i', { className: 'ycp-dot' }),
                )
              : null,
            reply
              ? h('div', { className: 'ycp-bubble' },
                  h('div', null,
                    h('span', { className: 'ycp-bubble-name' }, `${state ? state.name : '大肥鱼'}：`),
                    reply.text,
                  ),
                  h('div', { className: 'ycp-bubble-meta' },
                    `${reply.model ? reply.model.provider + '/' + reply.model.model : ''} · ${reply.ms} ms · ${clock(reply.at)} · ${timeAgo(reply.at)}`),
                  reply.recalled && reply.recalled.length
                    ? h('div', { className: 'ycp-bubble-meta' },
                        `想起：${reply.recalled.map((item) => item.title).join('、')}`)
                    : null,
                  reply.voiceUrl
                    ? h('audio', {
                        className: 'ycp-audio',
                        controls: true,
                        autoPlay: Boolean(voiceForm && voiceForm.autoSpeak),
                        src: reply.voiceUrl,
                      })
                    : null,
                )
              : null,
          ),

          h('div', { className: 'ycp-section' },
            h('div', { className: 'ycp-section-head' },
              h('div', { className: 'ycp-section-title' }, '记忆'),
              h('div', { className: 'ycp-count' }, memory ? `${cardTotal} 张卡` : '读取中…'),
            ),
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
            ),
            cards.length === 0
              ? h('div', { className: 'ycp-empty' },
                  memTab === 'diary' ? '还没有日记，先写一句。' : '这一层还没有卡，点「新建卡」。')
              : null,
            cards.map((card) => h('div', { key: card.file, className: 'ycp-memrow' },
              h('div', { className: 'ycp-mem-main' },
                h('div', { className: 'ycp-mem-title' }, card.title || card.file),
                card.description ? h('div', { className: 'ycp-mem-desc' }, card.description) : null,
                h('div', { className: 'ycp-mem-meta' }, `${card.file} · ${card.chars} 字 · ${shortTime(card.mtimeMs)}`),
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
                    h('span', { className: 'ycp-bubble-name' }, `${state ? state.name : '大肥鱼'}：`),
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
              h('div', { className: 'ycp-section-title' }, '手'),
              h('div', { className: 'ycp-count' }, toolsData ? `工具 ${toolsData.tools.length} · 手 ${toolsData.hands.length}` : ''),
            ),
            toolsData
              ? h('div', null,
                  toolsData.tools.map((tool) => h('div', { key: tool.id, className: 'ycp-memrow' },
                    h('div', { className: 'ycp-mem-main' },
                      h('div', { className: 'ycp-mem-title' }, tool.id),
                      h('div', { className: 'ycp-mem-desc' }, tool.description),
                      h('div', { className: 'ycp-mem-meta' }, tool.hand ? `用「${tool.hand}」这条手` : '不需要手'),
                    ),
                    h('div', { className: 'ycp-mem-actions' },
                      tool.id === 'demo.echo' || tool.id === 'demo.time'
                        ? h('button', {
                            className: 'ycp-btn small',
                            disabled: toolBusy,
                            onClick: () => invokeDemo(tool.id, tool.id === 'demo.echo' ? { text: toolText } : {}),
                          }, '试一下')
                        : null,
                    ),
                  )),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '手'),
                    toolsData.hands.map((hand) => h('button', {
                      key: hand.id,
                      className: hand.enabled ? 'ycp-tab on' : 'ycp-tab',
                      disabled: browserBusy,
                      title: hand.description,
                      onClick: () => toggleHand(hand.id),
                    }, `${hand.name} ${hand.enabled ? '开' : '关'}`)),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '权限'),
                    [['webSearch', '联网搜索'], ['webFetch', '网页读取'], ['memoryWrite', '记忆写入'], ['memoryRead', '记忆检索']]
                      .map(([key, label]) => {
                        const on = state && state.settings && state.settings.permissions
                          ? state.settings.permissions[key] !== false
                          : true
                        return h('button', {
                          key,
                          className: on ? 'ycp-tab on' : 'ycp-tab',
                          disabled: permBusy,
                          onClick: () => togglePermission(key),
                        }, `${label} ${on ? '开' : '关'}`)
                      }),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '浏览器'),
                    h('span', { className: 'ycp-count' },
                      browserInfo
                        ? (browserInfo.available
                          ? `${browserInfo.browser.name}${browserInfo.running ? ' · 运行中' : ' · 待命'}`
                          : `不可用：${browserInfo.error}`)
                        : '读取中…'),
                    browserInfo && browserInfo.running
                      ? h('button', { className: 'ycp-btn small', disabled: browserBusy, onClick: stopBrowser }, '关掉浏览器')
                      : null,
                    h('button', { className: 'ycp-btn small', disabled: browserBusy, onClick: loginBrowser }, '打开登录窗口'),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '白名单'),
                    h('input', {
                      className: 'ycp-input',
                      value: sitesText,
                      disabled: browserBusy,
                      placeholder: '* 表示不限制；或填 example.com, bilibili.com',
                      onChange: (event) => setSitesText(event.target.value),
                    }),
                    h('button', { className: 'ycp-btn small', disabled: browserBusy, onClick: saveSites }, '保存'),
                  ),
                  h('div', { className: 'ycp-hint' },
                    browserInfo && browserInfo.unrestricted
                      ? '现在不限制：任何 http/https 网站都能开。'
                      : '填 * 表示不限制浏览；留空则谁都打不开。'),
                  browserInfo && browserInfo.recent && browserInfo.recent.length
                    ? h('div', { className: 'ycp-mem-meta' },
                        `最近：${browserInfo.recent.slice(0, 3).map((item) => `${item.action} ${item.detail}`).join(' · ')}`)
                    : null,
                  browserMsg ? h('div', { className: 'ycp-msg ok' }, browserMsg) : null,
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '桌面'),
                    h('span', { className: 'ycp-count' },
                      desktopInfo
                        ? (desktopInfo.available
                          ? `Windows 桌面 · 这条手${desktopInfo.enabled ? '开着' : '关着'}`
                          : `不可用：${desktopInfo.error}`)
                        : '读取中…'),
                  ),
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '程序'),
                    h('input', {
                      className: 'ycp-input',
                      value: appsText,
                      disabled: desktopBusy,
                      placeholder: '允许启动的程序，如 notepad.exe（逗号分隔）',
                      onChange: (event) => setAppsText(event.target.value),
                    }),
                    h('button', { className: 'ycp-btn small', disabled: desktopBusy, onClick: saveApps }, '保存'),
                  ),
                  h('div', { className: 'ycp-hint' },
                    '桌面手默认关；关着时点击、打字、启动程序都会被拒。'),
                  desktopMsg ? h('div', { className: 'ycp-msg ok' }, desktopMsg) : null,
                  h('div', { className: 'ycp-subrow' },
                    h('span', { className: 'label' }, '试跑'),
                    h('input', {
                      className: 'ycp-input',
                      value: toolText,
                      disabled: toolBusy,
                      placeholder: '给 demo.echo 一句话',
                      onChange: (event) => setToolText(event.target.value),
                    }),
                  ),
                  toolMsg ? h('div', { className: 'ycp-msg ok' }, toolMsg) : null,
                )
              : h('div', { className: 'ycp-empty' }, '读取中…'),
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

          h('div', { className: 'ycp-section' },
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
                  placeholder: '大肥鱼',
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
          label: () => '大肥鱼',
        }, FishIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-Ycp',
        }, Panel))
      },
    }
  },
})
