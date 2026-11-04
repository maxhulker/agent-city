import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Entry } from './types.ts'

// Claude Code session ids are UUIDs; checked by shape, since one becomes part of a path.
const SESSION_ID = /^[A-Za-z0-9-]{8,100}$/
const found = new Map<string, string>()

// A session's transcript in Claude Code's config folder
// (projects/<its folder>/<session id>.jsonl), for one that left the city
// before the city kept where it was. '' when there is none.
export function findTranscript(configDir: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) return ''
  const projects = join(configDir, 'projects')
  const name = sessionId + '.jsonl'
  const key = join(projects, name)
  const hit = found.get(key)
  if (hit && existsSync(hit)) return hit
  try {
    for (const dir of readdirSync(projects)) {
      const file = join(projects, dir, name)
      if (existsSync(file)) {
        found.set(key, file)
        return file
      }
    }
  } catch {}
  return ''
}

// Long sessions run to 50+ MB; the recent conversation is all the page shows.
const TAIL_BYTES = 4 * 1024 * 1024
const TOOL_LINE = 200
const RESULT_LINE = 300

type Cached = { size: number; mtime: number; limit: number; entries: Entry[] }
const cache = new Map<string, Cached>()

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// mcp__Server_Name__tool_name -> "tool name"
function shortTool(name: string): string {
  const m = /^mcp__.+?__(.+)$/.exec(name)
  return m ? m[1].replace(/_/g, ' ') : name
}

function toolLine(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const i = input as Record<string, unknown>
  for (const k of ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) {
    if (typeof i[k] === 'string' && i[k]) {
      // A pattern is more useful with its folder.
      const extra = k === 'pattern' && typeof i.path === 'string' ? ' in ' + i.path : ''
      return clip(i[k] + extra, TOOL_LINE)
    }
  }
  try { return clip(JSON.stringify(input), TOOL_LINE) } catch { return '' }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b?.type === 'image') parts.push('[image]')
  }
  return parts.join('\n')
}

// Prompt text with harness noise removed; '' means not something the person typed.
function cleanPrompt(raw: string): string {
  const t = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (!t) return ''
  if (/^<(local-command-(stdout|stderr|caveat)|task-notification|bash-(stdout|stderr)|user-prompt-submit-hook)/.test(t)) return ''
  const cmd = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(t)
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)
    return clip(cmd[1] + (args && args[1].trim() ? ' ' + args[1].trim() : ''), RESULT_LINE)
  }
  if (/^\[Image: source:/.test(t)) return ''
  return t
}

function parse(text: string): Entry[] {
  const out: Entry[] = []
  // tool_use id -> name, so a result can say which tool it answers.
  const names = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'user' && o.type !== 'assistant') continue
    const content = o.message?.content
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    const at = Number.isFinite(ts) ? ts : undefined
    if (o.type === 'user') {
      if (o.isMeta) continue
      if (typeof content === 'string') {
        const t = cleanPrompt(content)
        if (t) out.push({ kind: 'user', text: t, at })
        continue
      }
      if (!Array.isArray(content)) continue
      const texts: string[] = []
      for (const b of content) {
        if (b?.type === 'tool_result') {
          const t = clip(resultText(b.content), RESULT_LINE)
          const tool = names.get(b.tool_use_id)
          const e: Entry = { kind: 'result', text: t || (b.is_error ? 'error' : 'done'), at }
          if (tool) e.tool = tool
          if (b.is_error) e.isError = true
          out.push(e)
        } else if (b?.type === 'text' && typeof b.text === 'string') {
          const t = cleanPrompt(b.text)
          if (t) texts.push(t)
        }
      }
      if (texts.length) out.push({ kind: 'user', text: texts.join('\n'), at })
    } else {
      if (!Array.isArray(content)) continue
      for (const b of content) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          out.push({ kind: 'assistant', text: b.text.trim(), at })
        } else if (b?.type === 'tool_use' && typeof b.name === 'string') {
          const tool = shortTool(b.name)
          if (typeof b.id === 'string') names.set(b.id, tool)
          out.push({ kind: 'tool', tool, text: toolLine(b.input), at })
        }
        // thinking blocks are skipped on purpose
      }
    }
  }
  return out
}

// A session from Claude Code's folder, for the page's list of earlier sessions.
export type PastListing = {
  id: string
  cwd: string
  // Its title in Claude Code (named or generated), '' when it has none.
  title: string
  // The first thing the person asked.
  prompt: string
  at: number
}

// Where a title and the folder are found: the start of the file has the
// folder and the first prompt; Claude Code rewrites the title as it goes,
// so the latest one is near the end.
const HEAD_BYTES = 256 * 1024
const TITLE_BYTES = 256 * 1024
const PROMPT_LINE = 160

type Listed = { size: number; mtime: number; item: PastListing | null }
const listed = new Map<string, Listed>()

function describe(path: string, id: string, size: number, mtime: number): PastListing | null {
  const head = readRange(path, 0, Math.min(size, HEAD_BYTES))
  let cwd = ''
  for (const line of head.split('\n')) {
    if (!line.includes('"cwd"')) continue
    try {
      const o = JSON.parse(line)
      if (typeof o.cwd === 'string' && o.cwd) { cwd = o.cwd; break }
    } catch {}
  }
  const first = parse(head).find(e => e.kind === 'user')
  if (!cwd || !first) return null
  let title = ''
  const tail = size > HEAD_BYTES ? readRange(path, Math.max(HEAD_BYTES, size - TITLE_BYTES), size) : head
  for (const line of tail.split('\n')) {
    if (!line.includes('"custom-title"') && !line.includes('"ai-title"') && !line.includes('"summary"')) continue
    try {
      const o = JSON.parse(line)
      const t = o.customTitle ?? o.aiTitle ?? (o.type === 'summary' ? o.summary : undefined)
      if (typeof t === 'string' && t.trim()) title = t.trim()
    } catch {}
  }
  if (!title && size > HEAD_BYTES) {
    for (const line of head.split('\n')) {
      if (!line.includes('"custom-title"')) continue
      try { const o = JSON.parse(line); if (typeof o.customTitle === 'string' && o.customTitle.trim()) title = o.customTitle.trim() } catch {}
    }
  }
  return { id, cwd, title: clip(title, PROMPT_LINE), prompt: clip(first.text, PROMPT_LINE), at: mtime }
}

// The most recent sessions in Claude Code's folder (projects/<folder>/<id>.jsonl),
// newest first: those with something the person asked, outside the folders
// left out (the temp folder, where probes and spares run), and not in skip.
export function listTranscripts(configDir: string, opts?: { limit?: number; skip?: Set<string>; hideUnder?: string[] }): PastListing[] {
  const limit = Math.max(1, opts?.limit ?? 50)
  const hide = (opts?.hideUnder ?? []).filter(Boolean).map(h => h.toLowerCase().replace(/[\\/]+$/, ''))
  const projects = join(configDir, 'projects')
  const files: { path: string; id: string; size: number; mtime: number }[] = []
  let dirs: string[] = []
  try { dirs = readdirSync(projects) } catch { return [] }
  for (const dir of dirs) {
    let names: string[] = []
    try { names = readdirSync(join(projects, dir)) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -6)
      if (!SESSION_ID.test(id) || opts?.skip?.has(id)) continue
      const path = join(projects, dir, name)
      try {
        const st = statSync(path)
        if (st.isFile()) files.push({ path, id, size: st.size, mtime: st.mtimeMs })
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const out: PastListing[] = []
  const seen = new Set<string>()
  for (const f of files) {
    if (out.length >= limit) break
    if (seen.has(f.id)) continue
    seen.add(f.id)
    let hit = listed.get(f.path)
    if (!hit || hit.size !== f.size || hit.mtime !== f.mtime) {
      let item: PastListing | null = null
      try { item = describe(f.path, f.id, f.size, f.mtime) } catch {}
      hit = { size: f.size, mtime: f.mtime, item }
      if (listed.size > 2000) listed.clear()
      listed.set(f.path, hit)
      found.set(join(projects, f.id + '.jsonl'), f.path)
    }
    const item = hit.item
    if (!item) continue
    const cwd = item.cwd.toLowerCase().replace(/[\\/]+$/, '')
    if (hide.some(h => cwd === h || cwd.startsWith(h + '\\') || cwd.startsWith(h + '/'))) continue
    out.push(item)
  }
  return out
}

function readRange(path: string, start: number, end: number): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(Math.max(0, end - start))
    let got = 0
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got)
      if (n <= 0) break
      got += n
    }
    let text = buf.subarray(0, got).toString('utf8')
    // A line cut at either end is left out.
    if (start > 0) {
      const nl = text.indexOf('\n')
      text = nl < 0 ? '' : text.slice(nl + 1)
    }
    if (end < fstatSync(fd).size) {
      const nl = text.lastIndexOf('\n')
      text = nl < 0 ? '' : text.slice(0, nl)
    }
    return text
  } finally {
    closeSync(fd)
  }
}

function readTail(path: string, size: number): string {
  const fd = openSync(path, 'r')
  try {
    const start = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    let got = 0
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got)
      if (n <= 0) break
      got += n
    }
    let text = buf.subarray(0, got).toString('utf8')
    // The first line is cut mid-way when we started inside the file.
    if (start > 0) {
      const nl = text.indexOf('\n')
      text = nl < 0 ? '' : text.slice(nl + 1)
    }
    return text
  } finally {
    closeSync(fd)
  }
}

export function readConversation(path: string, opts?: { limit?: number }): Entry[] {
  const limit = Math.max(1, opts?.limit ?? 200)
  try {
    const fd = openSync(path, 'r')
    let size: number, mtime: number
    try {
      const st = fstatSync(fd)
      size = st.size
      mtime = st.mtimeMs
    } finally {
      closeSync(fd)
    }
    const hit = cache.get(path)
    if (hit && hit.size === size && hit.mtime === mtime && hit.limit === limit) return hit.entries
    const entries = parse(readTail(path, size)).slice(-limit)
    cache.set(path, { size, mtime, limit, entries })
    // Keep the cache small: a handful of live sessions at most.
    if (cache.size > 40) cache.delete(cache.keys().next().value as string)
    return entries
  } catch {
    return []
  }
}
