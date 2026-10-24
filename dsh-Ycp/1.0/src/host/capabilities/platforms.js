/**
 * dsh-Ycp · 大肥鱼（能力层）—— 平台（B站 / 小黑盒 / 抖音 / QQ）。
 *
 * 说实话的部分：
 *   - B站：网页公开，无登录也能搜、能看排行榜——真能用。
 *   - 小黑盒：站内搜索要自家接口签名，这里用 Bing 的站内搜索绕过去，能拿到标题和摘要。
 *   - 抖音：无登录会被验证码/登录墙挡住，工具会明确告诉你"要登录"，不假装能刷。
 *   - QQ：没有公开网页接口；这里走桌面之手，在你已经打开的 QQ 窗口里把话打进去。
 *     用之前先在 QQ 里点开那个人的聊天框；工具会核对窗口标题，切错窗口就拒发。
 *
 * 所有平台动作都归各自的手：B站/小黑盒/抖音 = browser，QQ = desktop。
 */
import { appendLog } from '../kernel/paths.js'

const MAX_TEXT = 3000
const WAIT_MS = 2500

function clean(text) {
  return String(text ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** 从 B 站搜索结果页的正文里抠出「标题 + 日期/播放」这种行。 */
export function parseBiliLines(text) {
  const lines = clean(text).split('\n').map((line) => line.trim()).filter(Boolean)
  const results = []
  const dateLike = /^(刚刚|昨天|前天|\d+\s*(分钟|小时|天)前|\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2})$/
  const noise = /^(查看详情|下载|更多|收起|展开|官方动态|游戏|番剧|影视|直播|专栏|用户|综合排序|最多播放|最新发布|最多弹幕|最多收藏|更多筛选)$/
  const numberLike = /^[\d.]+万?$/
  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index]
    const next = lines[index + 1]
    if (!dateLike.test(next)) continue
    if (line.length < 4 || line.length > 90) continue
    if (noise.test(line) || numberLike.test(line) || /^\d{1,2}:\d{2}$/.test(line)) continue
    results.push({ title: line, date: next })
  }
  const ranked = lines
    .map((line) => line.match(/^(\d{1,3})\s+(.{4,80}?)\s+([\d.]+万?)\s+([\d.]+万?)$/))
    .filter(Boolean)
    .map((match) => ({ rank: Number(match[1]), title: match[2].trim(), play: match[3], danmaku: match[4] }))
  return [...results, ...ranked].slice(0, 12)
}

/** 排行榜是「名次 / 标题 / 作者 / 播放 / 弹幕」逐行排的，单独解析。 */
export function parseBiliRank(text) {
  const lines = clean(text).split('\n').map((line) => line.trim()).filter(Boolean)
  const items = []
  const numberLike = /^[\d.]+万?$/
  for (let index = 0; index < lines.length - 4; index++) {
    if (!/^\d{1,3}$/.test(lines[index])) continue
    const title = lines[index + 1]
    const author = lines[index + 2]
    const play = lines[index + 3]
    const danmaku = lines[index + 4]
    if (!title || title.length < 4 || title.length > 90) continue
    if (!numberLike.test(play) || !numberLike.test(danmaku)) continue
    items.push({ rank: Number(lines[index]), title, author, play, danmaku })
    index += 4
  }
  return items.slice(0, 10)
}

export function createPlatforms({ browser, desktop, log = appendLog } = {}) {
  function need(name) {
    if (!name) throw new Error('这个平台没挂上')
  }

  async function page(url, waitMs = WAIT_MS) {
    need(browser)
    await browser.goto(url)
    await browser.wait(waitMs)
    const info = await browser.text()
    return { url: info.url, title: info.title, text: clean(info.text).slice(0, MAX_TEXT) }
  }

  async function biliSearch({ keyword }) {
    const word = String(keyword ?? '').trim()
    if (!word) throw new Error('搜什么？')
    const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(word)}`
    const result = await page(url, 3000)
    const results = parseBiliLines(result.text)
    log('B站搜索', { keyword: word, results: results.length })
    return { ...result, keyword: word, results }
  }

  async function biliHot() {
    const result = await page('https://www.bilibili.com/v/popular/rank/all', 3000)
    const results = parseBiliRank(result.text)
    log('B站排行榜', { results: results.length })
    return { ...result, results }
  }

  async function heyboxSearch({ keyword }) {
    const word = String(keyword ?? '').trim()
    if (!word) throw new Error('搜什么？')
    const query = `site:xiaoheihe.cn ${word}`
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`
    const result = await page(url, 2500)
    log('小黑盒搜索', { keyword: word })
    return { ...result, keyword: word, note: '小黑盒站内接口要签名，这里用 Bing 站内搜索找它的页面' }
  }

  async function douyinSearch({ keyword }) {
    const word = String(keyword ?? '').trim()
    if (!word) throw new Error('搜什么？')
    const url = `https://www.douyin.com/search/${encodeURIComponent(word)}`
    const result = await page(url, 3000)
    const blocked = /验证码|验证|登录|安全/.test(`${result.title} ${result.text.slice(0, 200)}`)
    log('抖音搜索', { keyword: word, blocked })
    if (blocked || result.text.length < 40) {
      return {
        ...result,
        keyword: word,
        ok: false,
        needLogin: true,
        error: '抖音要登录/过验证码。先用 browser.login 打开她的浏览器窗口，你登录一次后关掉，她就能带着登录态再搜。',
      }
    }
    return { ...result, keyword: word }
  }

  async function qqSend({ text }) {
    const body = String(text ?? '').trim()
    if (!body) throw new Error('要发什么？')
    if (body.length > 500) throw new Error('一条最多 500 字')
    need(desktop)
    const result = await desktop.type(body, { expectTitle: 'QQ' })
    const keyed = await desktop.key('{ENTER}', { expectTitle: 'QQ' })
    log('QQ 发送', { chars: body.length, foreground: result.foreground })
    return { sent: body.length, foreground: result.foreground, enter: keyed.foreground }
  }

  async function qqStatus() {
    need(desktop)
    const info = await desktop.info()
    const windows = (info.windows || []).filter((item) => /QQ/i.test(item.title))
    return { running: windows.length > 0, windows }
  }

  // ---- 登录后的动作（都要 actions 这条手）----

  const SELECTORS = {
    like: ['.video-like', '.toolbar-left-item-wrap .like', '#arc_toolbar_report .like', '.like'],
    follow: ['.follow-btn', '.bili-follow-btn', '.default-btn.follow'],
    commentBox: ['.reply-box-textarea', '.comment-box textarea', 'textarea[placeholder*="评论"]'],
    commentSubmit: ['.comment-submit', '.submit-btn', '.reply-box .btn-send'],
  }

  async function clickFirst(selectors) {
    need(browser)
    if (typeof browser.evalJs !== 'function') throw new Error('当前浏览器手没有 eval 能力')
    const script = `(() => {
      const sels = ${JSON.stringify(selectors)};
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return sel; }
      }
      return null;
    })()`
    const result = await browser.evalJs(script)
    return result?.value ?? null
  }

  async function loginWall() {
    const { value } = await browser.evalJs(`Boolean(document.querySelector('.login-panel, .bili-login-card, .login-scan-box, [class*="login-dialog"]'))`)
    return Boolean(value)
  }

  async function biliAction({ url, kind }) {
    const target = String(url ?? '').trim()
    if (!/^https?:\/\/(www\.)?bilibili\.com\//i.test(target)) throw new Error('给一个 B站视频页网址')
    await browser.goto(target)
    await browser.wait(1800)
    const clicked = await clickFirst(SELECTORS[kind] || [])
    if (!clicked) {
      const wall = await loginWall()
      throw new Error(wall
        ? '点了没反应，弹了登录框——先用 browser.login 登录 B站，再打开「登录后的动作」'
        : `没找到${kind === 'like' ? '点赞' : '关注'}按钮（页面结构可能变了，或者这条视频/用户不支持）`)
    }
    await browser.wait(800)
    const wall = await loginWall()
    if (wall) return { ok: false, needLogin: true, clicked, url: target, error: '登录态失效了，重新 browser.login 一次' }
    log('B站动作', { kind, url: target, selector: clicked })
    return { ok: true, clicked, url: target }
  }

  async function biliLike({ url }) {
    return biliAction({ url, kind: 'like' })
  }

  async function biliFollow({ url }) {
    return biliAction({ url, kind: 'follow' })
  }

  async function biliComment({ url, text }) {
    const target = String(url ?? '').trim()
    const body = String(text ?? '').trim()
    if (!/^https?:\/\/(www\.)?bilibili\.com\//i.test(target)) throw new Error('给一个 B站视频页网址')
    if (!body) throw new Error('评论写什么？')
    if (body.length > 300) throw new Error('一条最多 300 字')
    await browser.goto(target)
    await browser.wait(2000)
    const script = `(() => {
      const box = ${JSON.stringify(SELECTORS.commentBox)}.map((sel) => document.querySelector(sel)).find(Boolean);
      if (!box) return { filled: false, reason: 'no-box' };
      box.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(box, ${JSON.stringify(body)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = ${JSON.stringify(SELECTORS.commentSubmit)}.map((sel) => document.querySelector(sel)).find(Boolean);
      if (btn) btn.click();
      return { filled: true, submitted: Boolean(btn) };
    })()`
    const { value } = await browser.evalJs(script)
    if (!value?.filled) {
      const wall = await loginWall()
      throw new Error(wall ? '要登录才能评论，先 browser.login' : '没找到评论框（页面结构可能变了）')
    }
    await browser.wait(1200)
    log('B站评论', { url: target, chars: body.length, submitted: value.submitted })
    return { ok: true, url: target, chars: body.length, submitted: Boolean(value.submitted) }
  }

  return {
    biliSearch,
    biliHot,
    heyboxSearch,
    douyinSearch,
    qqSend,
    qqStatus,
    biliLike,
    biliFollow,
    biliComment,
  }
}

export function installPlatformTools(registry, platforms) {
  const tools = [
    {
      id: 'bili.search',
      description: '在 B 站搜视频，返回页面标题、正文摘要和能认出来的条目',
      hand: 'browser',
      schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
      run: async ({ keyword }) => platforms.biliSearch({ keyword }),
    },
    {
      id: 'bili.hot',
      description: '看 B 站全站排行榜',
      hand: 'browser',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => platforms.biliHot(),
    },
    {
      id: 'heybox.search',
      description: '查小黑盒（用 Bing 站内搜索找它的页面）',
      hand: 'browser',
      schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
      run: async ({ keyword }) => platforms.heyboxSearch({ keyword }),
    },
    {
      id: 'douyin.search',
      description: '搜抖音（没登录会被验证码挡住，会如实说）',
      hand: 'browser',
      schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
      run: async ({ keyword }) => platforms.douyinSearch({ keyword }),
    },
    {
      id: 'bili.like',
      description: '给一个 B站视频点赞（需要登录态 + 「登录后的动作」手）',
      hand: 'actions',
      schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async ({ url }) => platforms.biliLike({ url }),
    },
    {
      id: 'bili.follow',
      description: '关注一个 B站 UP 主（需要登录态 + 「登录后的动作」手）',
      hand: 'actions',
      schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async ({ url }) => platforms.biliFollow({ url }),
    },
    {
      id: 'bili.comment',
      description: '在 B站视频下写一条评论（需要登录态 + 「登录后的动作」手）',
      hand: 'actions',
      schema: {
        type: 'object',
        properties: { url: { type: 'string' }, text: { type: 'string' } },
        required: ['url', 'text'],
      },
      run: async ({ url, text }) => platforms.biliComment({ url, text }),
    },
    {
      id: 'qq.send',
      description: '把一句话发到当前打开的 QQ 聊天窗口（先手动点开那个人的聊天框）',
      hand: 'desktop',
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      run: async ({ text }) => platforms.qqSend({ text }),
    },
    {
      id: 'qq.status',
      description: '看看 QQ 有没有开着、有哪些 QQ 窗口',
      hand: 'desktop',
      schema: { type: 'object', properties: {}, required: [] },
      run: async () => platforms.qqStatus(),
    },
  ]
  for (const tool of tools) {
    const result = registry.registerTool(tool)
    if (!result.ok) throw new Error(`注册 ${tool.id} 失败：${result.error}`)
  }
}
