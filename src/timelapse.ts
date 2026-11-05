import { execFile } from 'node:child_process'

import { censusFrom, parseTree } from './census.ts'
import type { Commit } from './census.ts'
import type { Census } from './types.ts'

// A borough's time-lapse: its repository's history replayed as the borough
// it would have been, commit by commit, from the first to HEAD. Each frame is
// the census of the tree at one commit along the main line (first parents),
// with its windows lit by the fortnight's commits before it, as the census
// lights them today. A long history is sampled evenly, the first and the
// latest commits always in.

export const FRAMES_MAX = 60

export type Moment = { sha: string; at: number; who: string; subject: string; files: string[] }

export type Frame = {
  sha: string
  at: number
  who: string
  subject: string
  // Its place in the whole history (1 is the first commit) and the history's length.
  n: number
  total: number
  census: Census
  // The folders that grew, shrank or appeared since the frame before: they go up in scaffolding.
  changed: string[]
}

function git(root: string, args: string[], timeout = 30_000): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { timeout, maxBuffer: 128 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout) =>
      resolve(err ? null : stdout),
    )
  })
}

// `git log --first-parent --reverse -z --name-only --format=%x01%H%x09%ct%x09%an%x09%s`:
// each commit opens with \x01, its line ends in \0, then its files, each ending in \0.
export function parseHistory(out: string): Moment[] {
  const list: Moment[] = []
  for (const chunk of out.split('\x01')) {
    const end = chunk.indexOf('\0')
    const head = end < 0 ? chunk : chunk.slice(0, end)
    const [sha, ct, who, ...subject] = head.split('\t')
    const at = Number(ct) * 1000
    if (!sha || !at) continue
    const files = end < 0 ? [] : chunk.slice(end + 1).split('\0').map(f => f.replace(/^\n/, '')).filter(Boolean)
    list.push({ sha, at, who: who ?? '', subject: subject.join('\t').trim(), files })
  }
  return list
}

// Which commits make the frames: all of a short history, else max of them
// spread evenly, the first and the last always in.
export function sample(count: number, max = FRAMES_MAX): number[] {
  if (count <= max) return [...Array(count).keys()]
  const out = new Set<number>()
  for (let i = 0; i < max; i++) out.add(Math.round((i * (count - 1)) / (max - 1)))
  return [...out]
}

// How many grown folders a frame puts in scaffolding, besides the new ones: a
// merge touches most of them, and a borough all in scaffolding says nothing.
const BUSIEST = 2

// The folders that went up since the frame before: every new one, and the
// ones whose size moved most.
export function changedBlocks(before: Census | undefined, after: Census): string[] {
  const was = new Map((before?.blocks ?? []).map(b => [b.path, b]))
  const fresh = after.blocks.filter(b => !was.has(b.path)).map(b => b.path)
  const moved = after.blocks
    .map(b => ({ path: b.path, w: was.get(b.path), b }))
    .filter(({ w, b }) => w && (w.bytes !== b.bytes || w.files !== b.files))
    .sort((x, y) => Math.abs(y.b.bytes - y.w!.bytes) - Math.abs(x.b.bytes - x.w!.bytes))
    .slice(0, BUSIEST)
    .map(x => x.path)
  return [...fresh, ...moved]
}

// The frames, from the moments and each sampled commit's tree.
export function framesFrom(moments: Moment[], picked: number[], trees: Map<string, string>): Frame[] {
  const out: Frame[] = []
  const commits: Commit[] = moments.map(m => ({ at: m.at, who: m.who, subject: m.subject, files: m.files }))
  let prev: Census | undefined
  for (const i of picked) {
    const m = moments[i]!
    const tree = trees.get(m.sha)
    if (tree === undefined) continue
    const subject = m.subject.length > 72 ? m.subject.slice(0, 71) + '…' : m.subject
    const census = censusFrom(parseTree(tree), commits.slice(0, i + 1), [], { head: m.sha, last: { at: m.at, who: m.who, subject } }, m.at)
    out.push({ sha: m.sha.slice(0, 7), at: m.at, who: m.who, subject, n: i + 1, total: moments.length, census, changed: changedBlocks(prev, census) })
    prev = census
  }
  // The last frame is the borough as it stands today: finished, scaffolding down.
  if (out.length > 1) out[out.length - 1]!.changed = []
  return out
}

// Reads a repository's history and makes its frames; undefined when it has
// no commits (or isn't a repository). Kept per HEAD, so a replay of the same
// history doesn't read it again.
export class Timelapses {
  private kept = new Map<string, { head: string; frames: Frame[] }>()

  async of(root: string): Promise<Frame[] | undefined> {
    const key = root.toLowerCase()
    const head = (await git(root, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim()
    if (!head) return undefined
    const had = this.kept.get(key)
    if (had?.head === head) return had.frames
    const log = await git(root, ['log', '--first-parent', '--reverse', '-z', '--name-only', '--format=%x01%H%x09%ct%x09%an%x09%s', 'HEAD'])
    if (log === null) return undefined
    const moments = parseHistory(log)
    if (!moments.length) return undefined
    const picked = sample(moments.length)
    const trees = new Map<string, string>()
    // A few trees at a time.
    for (let k = 0; k < picked.length; k += 6) {
      await Promise.all(
        picked.slice(k, k + 6).map(async i => {
          const sha = moments[i]!.sha
          const tree = await git(root, ['ls-tree', '-r', '-l', '-z', sha])
          if (tree !== null) trees.set(sha, tree)
        }),
      )
    }
    const frames = framesFrom(moments, picked, trees)
    this.kept.set(key, { head, frames })
    if (this.kept.size > 12) this.kept.delete(this.kept.keys().next().value!)
    return frames
  }
}
