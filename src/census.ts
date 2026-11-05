import { execFile } from 'node:child_process'
import type { Block, Census } from './types.ts'

// The census of a borough's repository: what it holds and what is going on
// in it, read with a few cheap git commands, so the borough's buildings can
// stand for its folders (src/draw/blocks.ts). Each block is a folder: its
// files and size (from HEAD's tree, without reading a file), the commits that
// touched it in the last two weeks, and its uncommitted changes. The parsing
// is pure; `CensusTaker` runs git and keeps a repository's tree until HEAD
// moves.

// How far back a folder's commits count, and so how long its windows stay lit.
export const WINDOW_DAYS = 14
// At most this many blocks; the smallest folders beyond it make one more.
export const MAX_BLOCKS = 12
// A repository with fewer top-level folders than this, or one holding most of
// it, has its biggest folder split into its own.
const FEW = 5
const MOST = 0.6
const SPLIT_UPTO = 9

// The block of the files outside the biggest folders.
export const REST = '…'

type Entry = { path: string; bytes: number }

// `git ls-tree -r -l -z HEAD`: "<mode> <type> <hash> <size>\t<path>\0" per
// file; a submodule has no size and is left out.
export function parseTree(out: string): Entry[] {
  const list: Entry[] = []
  for (const line of out.split('\0')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const [, type, , size] = line.slice(0, tab).split(/\s+/)
    if (type !== 'blob' || !size || size === '-') continue
    list.push({ path: line.slice(tab + 1), bytes: Number(size) || 0 })
  }
  return list
}

export type Commit = { at: number; who: string; subject: string; files: string[] }

// `git log --name-only -z --format=%x01%ct%x09%an%x09%s`: each commit opens
// with \x01, its line ends in \0, then a newline and its files, each ending in \0.
export function parseLog(out: string): Commit[] {
  const list: Commit[] = []
  for (const chunk of out.split('\x01')) {
    const end = chunk.indexOf('\0')
    const head = end < 0 ? chunk : chunk.slice(0, end)
    const [ct, who, ...subject] = head.split('\t')
    const at = Number(ct) * 1000
    if (!at) continue
    const files = end < 0 ? [] : chunk.slice(end + 1).split('\0').map(f => f.replace(/^\n/, '')).filter(Boolean)
    list.push({ at, who: who ?? '', subject: subject.join('\t').trim(), files })
  }
  return list
}

// `git status --porcelain=v1 -uall -z`: the paths with uncommitted changes.
export function parseStatus(out: string): string[] {
  const list: string[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]!
    if (e.length < 4) continue
    list.push(e.slice(3))
    // A rename or copy carries its old path as the next field.
    if (e[0] === 'R' || e[0] === 'C') i++
  }
  return list
}

// Files grouped into folders: the top-level ones (the root's own files make
// a block of their own, ''), with the biggest split into its subfolders while
// there are few of them or it holds most of the repository.
export function groupFolders(entries: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>()
  const add = (key: string, e: Entry) => groups.set(key, [...(groups.get(key) ?? []), e])
  for (const e of entries) add(e.path.includes('/') ? e.path.split('/')[0]! : '', e)
  const bytes = (list: Entry[]) => list.reduce((sum, e) => sum + e.bytes, 0)
  const total = bytes(entries)
  const whole = new Set<string>([''])
  for (let round = 0; round < 6 && groups.size < SPLIT_UPTO; round++) {
    const biggest = [...groups].filter(([k]) => !whole.has(k)).sort((a, b) => bytes(b[1]) - bytes(a[1]))[0]
    if (!biggest) break
    const [key, list] = biggest
    if (groups.size >= FEW && bytes(list) <= total * MOST) break
    const parts = new Map<string, Entry[]>()
    for (const e of list) {
      const rest = e.path.slice(key.length + 1)
      const sub = rest.includes('/') ? `${key}/${rest.split('/')[0]}` : key
      parts.set(sub, [...(parts.get(sub) ?? []), e])
    }
    // A folder with only one thing in it says nothing more split.
    if (parts.size < 2) {
      whole.add(key)
      continue
    }
    groups.delete(key)
    for (const [k, v] of parts) groups.set(k, v)
    // Its own files stay as one block under its name.
    if (parts.has(key)) whole.add(key)
  }
  return groups
}

// The block a path falls in: the longest folder it lies under, else the
// root's own files or the rest.
export function blockFor(path: string, keys: string[]): string | undefined {
  let best: string | undefined
  for (const k of keys) {
    if (k === '' || k === REST) continue
    if ((path === k || path.startsWith(k + '/')) && (best === undefined || k.length > best.length)) best = k
  }
  if (best !== undefined) return best
  if (!path.includes('/') && keys.includes('')) return ''
  return keys.includes(REST) ? REST : undefined
}

function extOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// The most common extension among a block's files.
function commonExt(list: Entry[]): string | undefined {
  const count = new Map<string, number>()
  for (const e of list) {
    const x = extOf(e.path)
    if (x) count.set(x, (count.get(x) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export type Facts = { head?: string; branch?: string; ahead?: number; behind?: number; last?: Census['last'] }

// The census from git's answers: the folders as blocks, biggest first, with
// the window's commits and the uncommitted changes counted into each.
export function censusFrom(tree: Entry[], commits: Commit[], dirty: string[], facts: Facts, now: number): Census {
  const groups = [...groupFolders(tree)]
    .map(([path, list]) => ({ path, list, bytes: list.reduce((s, e) => s + e.bytes, 0) }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
  // The smallest beyond the limit make one block.
  if (groups.length > MAX_BLOCKS) {
    const rest = groups.splice(MAX_BLOCKS - 1)
    const list = rest.flatMap(g => g.list)
    groups.push({ path: REST, list, bytes: list.reduce((s, e) => s + e.bytes, 0) })
  }
  const blocks: Block[] = groups.map(g => ({ path: g.path, files: g.list.length, bytes: g.bytes, commits: 0, dirty: 0, ...(commonExt(g.list) ? { ext: commonExt(g.list) } : {}) }))
  // The rest's files are known by name, not by folder.
  const restFiles = new Set(groups.find(g => g.path === REST)?.list.map(e => e.path) ?? [])
  const keys = blocks.map(b => b.path)
  const find = (path: string): Block | undefined => {
    if (restFiles.has(path)) return blocks.find(b => b.path === REST)
    const k = blockFor(path, keys.filter(one => one !== REST))
    return blocks.find(b => b.path === (k ?? REST))
  }
  const since = now - WINDOW_DAYS * 86_400_000
  let inWindow = 0
  for (const c of commits) {
    if (c.at < since) continue
    inWindow++
    const hit = new Set<Block>()
    for (const f of c.files) {
      const b = find(f)
      if (b) hit.add(b)
    }
    for (const b of hit) {
      b.commits++
      b.lastAt = Math.max(b.lastAt ?? 0, c.at)
    }
  }
  for (const f of dirty) {
    const b = find(f)
    if (b) b.dirty++
  }
  return {
    at: now,
    ...(facts.head ? { head: facts.head } : {}),
    ...(facts.branch ? { branch: facts.branch } : {}),
    ...(facts.ahead !== undefined ? { ahead: facts.ahead } : {}),
    ...(facts.behind !== undefined ? { behind: facts.behind } : {}),
    files: tree.length,
    bytes: tree.reduce((s, e) => s + e.bytes, 0),
    commits: inWindow,
    dirty: dirty.length,
    ...(facts.last ? { last: facts.last } : {}),
    blocks,
  }
}

// What the drawing depends on, for the map's hash: the folders, their sizes,
// and whether each has been worked on lately. Uncommitted changes and the
// counts go on the overlay instead, so they don't redraw the map.
export function censusShape(c: Census | undefined): unknown {
  if (!c) return null
  const shape: unknown[] = c.blocks.map(b => [b.path, b.files, b.bytes, b.commits > 0])
  // Where the person moved folders to: a move redraws the map.
  return c.pins && Object.keys(c.pins).length ? [...shape, c.pins] : shape
}

// Two censuses that would draw and read the same.
export function sameCensus(a: Census | undefined, b: Census | undefined): boolean {
  const strip = (c: Census | undefined) => (c ? JSON.stringify({ ...c, at: 0 }) : '')
  return strip(a) === strip(b)
}

// ---- running git ------------------------------------------------------------

function git(root: string, args: string[], timeout = 15_000): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout) =>
      resolve(err ? null : stdout),
    )
  })
}

// How often a census is taken: often while the borough's agents work, now
// and then otherwise; a folder git can't read is tried again rarely.
export const BUSY_MS = 15_000
export const QUIET_MS = 5 * 60_000
const FAILED_MS = 10 * 60_000

export class CensusTaker {
  private running = new Set<string>()
  private failed = new Map<string, number>()
  // Each repository's tree at the HEAD it was read at: ls-tree runs again only when HEAD moves.
  private trees = new Map<string, { head: string; entries: Entry[] }>()

  // Whether a repository's census is due: none yet, or older than its pace.
  due(root: string, census: Census | undefined, busy: boolean, now: number): boolean {
    const key = root.toLowerCase()
    if (this.running.has(key)) return false
    const failedAt = this.failed.get(key)
    if (failedAt !== undefined && now - failedAt < FAILED_MS) return false
    return !census || now - census.at >= (busy ? BUSY_MS : QUIET_MS)
  }

  // Takes the census, or undefined when the folder isn't a git repository (or git is missing).
  async take(root: string, now = Date.now()): Promise<Census | undefined> {
    const key = root.toLowerCase()
    this.running.add(key)
    try {
      const dir = root.replace(/\\/g, '/')
      const head = (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim()
      const [branch, counts, log, last, status] = await Promise.all([
        git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
        head ? git(dir, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']) : null,
        head ? git(dir, ['log', `--since=${WINDOW_DAYS}.days.ago`, '--no-merges', '--name-only', '-z', '--format=%x01%ct%x09%an%x09%s']) : '',
        head ? git(dir, ['log', '-1', '--format=%ct%x09%an%x09%s']) : null,
        git(dir, ['status', '--porcelain=v1', '-uall', '-z']),
      ])
      // Not a repository at all.
      if (status === null) {
        this.failed.set(key, now)
        return undefined
      }
      this.failed.delete(key)
      let entries: Entry[] = []
      if (head) {
        const kept = this.trees.get(key)
        if (kept?.head === head) entries = kept.entries
        else {
          const tree = await git(dir, ['ls-tree', '-r', '-l', '-z', 'HEAD'], 30_000)
          entries = tree ? parseTree(tree) : []
          this.trees.set(key, { head, entries })
        }
      }
      const facts: Facts = {}
      if (head) facts.head = head
      const br = branch?.trim()
      if (br && br !== 'HEAD') facts.branch = br
      const m = counts && /^(\d+)\s+(\d+)/.exec(counts.trim())
      if (m) {
        facts.behind = Number(m[1])
        facts.ahead = Number(m[2])
      }
      const [lc] = last ? parseLog('\x01' + last.trim()) : []
      if (lc) facts.last = { at: lc.at, who: lc.who, subject: lc.subject.length > 72 ? lc.subject.slice(0, 71) + '…' : lc.subject }
      const census = censusFrom(entries, parseLog(log ?? ''), parseStatus(status), facts, now)
      if (head) await this.touched(dir, key, head, census)
      return census
    } finally {
      this.running.delete(key)
    }
  }

  // When each folder was last committed to, at any time: what weathers a
  // quiet one (src/draw/map.ts). One `git log -1` a folder, kept per HEAD.
  private ages = new Map<string, { head: string; at: Map<string, number> }>()

  private async touched(dir: string, key: string, head: string, census: Census) {
    let kept = this.ages.get(key)
    if (kept?.head !== head) {
      kept = { head, at: new Map() }
      this.ages.set(key, kept)
    }
    const at = kept.at
    const missing = census.blocks.map(b => b.path).filter(p => p !== REST && !at.has(p))
    await Promise.all(
      missing.map(async path => {
        // The root's own files: those with no folder, as a pathspec.
        const spec = path === '' ? ':(glob)*' : `:(literal)${path}`
        const out = await git(dir, ['log', '-1', '--format=%ct', 'HEAD', '--', spec])
        const t = Number(out?.trim()) * 1000
        at.set(path, t > 0 ? t : 0)
      }),
    )
    for (const b of census.blocks) {
      const t = at.get(b.path)
      if (t) b.touchedAt = t
    }
  }
}
