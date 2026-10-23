/**
 * dsh-brain · 实时 → 项目 的消化。
 *
 * 不做模型总结：把实时卡原样归档到项目卡，并留下内容哈希，同一条内容不会
 * 被消化两次。目标卡优先 01-决定.md，没有就落到 00-概况.md。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cardBody, clip } from './cards.js'
import { workspacePaths, fmtTime } from './paths.js'

const DIGEST_MARK = '<!-- dsh-brain:digest:'

export function digestRealtime({ store, cwd, maxChars = 800 }) {
  const paths = workspacePaths(cwd)
  const realtime = store.readOne('realtime', '当前任务.md', cwd)
  if (!realtime) return { ok: false, error: '实时记忆不存在：当前任务.md' }
  const body = cardBody(realtime).trim()
  if (body.length < 12) return { ok: false, error: '实时记忆为空，没有可消化的内容' }

  const hash = createHash('sha1').update(body).digest('hex').slice(0, 12)
  const targetFile = existsSync(join(paths.projectDir, '01-决定.md')) ? '01-决定.md' : '00-概况.md'
  const target = store.readOne('project', targetFile, cwd)
  if (!target) return { ok: false, error: `项目卡不存在：${targetFile}` }
  const marker = `${DIGEST_MARK}${hash} -->`
  if (target.raw.includes(marker)) {
    return { ok: true, skipped: true, reason: '同一条实时内容已经消化过', target: targetFile, hash }
  }

  const now = new Date()
  const section = [
    '',
    '',
    `## 实时消化 ${fmtTime(now.getTime())}`,
    marker,
    clip(body, maxChars),
    '',
  ].join('\n')
  const nextRaw = `${target.raw.replace(/\s*$/, '')}${section}`
  const write = store.writeCard('project', targetFile, nextRaw, cwd)
  if (!write.ok) return { ok: false, error: write.error || '写入项目卡失败' }

  const stub = [
    '# 当前任务',
    '',
    `**最后更新**：${fmtTime(now.getTime())}`,
    '',
    `已消化到 \`${targetFile}\`（${marker}）。`,
    '',
    '## 下一步',
    '',
    '- 写下一条任务进展。',
    '',
  ].join('\n')
  const cleared = store.writeCard('realtime', '当前任务.md', stub, cwd)
  return {
    ok: true,
    target: targetFile,
    hash,
    backup: write.backup,
    cleared: cleared.ok,
    chars: body.length,
  }
}
