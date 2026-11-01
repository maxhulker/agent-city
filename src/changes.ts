import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Changes } from './types.ts'

const MAX_DIFF = 400 * 1024
const MAX_NEW_FILE = 64 * 1024
// git's well-known empty tree, for a repo with no commits yet.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbf12ca0'

function git(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => resolve(err ? null : stdout))
  })
}

// --no-index exits 1 when the files differ, so the error is expected.
function gitDiffNoIndex(root: string, file: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, 'diff', '--no-index', '--', '/dev/null', file],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (_err, stdout) => resolve(stdout || ''))
  })
}

export async function changesIn(root: string): Promise<Changes> {
  const out: Changes = { root, files: [], diff: '', truncated: false }
  try {
    const dir = root.replace(/\\/g, '/')
    // -z keeps odd file names unquoted.
    const status = await git(dir, ['status', '--porcelain=v1', '-uall', '-z'])
    if (status === null) return out
    const untracked: string[] = []
    const parts = status.split('\0')
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i]
      if (e.length < 4) continue
      const code = e.slice(0, 2)
      const path = e.slice(3)
      // A rename carries its old path as the next field.
      if (code[0] === 'R' || code[0] === 'C') i++
      const st = code === '??' ? '??' : (code[1] !== ' ' ? code[1] : code[0])
      out.files.push({ path, status: st })
      if (code === '??') untracked.push(path)
    }
    if (!out.files.length) return out

    const hasHead = (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null
    const base = hasHead ? 'HEAD' : EMPTY_TREE
    const [num, diff] = await Promise.all([
      git(dir, ['diff', '--numstat', '-z', base]),
      git(dir, ['diff', base]),
    ])
    const counts = new Map<string, [number, number]>()
    if (num) {
      const f = num.split('\0')
      for (let i = 0; i < f.length; i++) {
        const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(f[i])
        if (!m) continue
        let path = m[3]
        // With -z a rename is "a\tr\t" followed by the old and new paths.
        if (path === '') { i += 2; path = f[i] ?? '' }
        counts.set(path, [m[1] === '-' ? 0 : +m[1], m[2] === '-' ? 0 : +m[2]])
      }
    }
    for (const f of out.files) {
      const c = counts.get(f.path)
      if (c) { f.added = c[0]; f.removed = c[1] }
    }

    let text = diff ?? ''
    for (const p of untracked) {
      if (text.length > MAX_DIFF) break
      try {
        const abs = join(dir, p)
        const s = await stat(abs)
        if (!s.isFile()) continue
        if (s.size > MAX_NEW_FILE) {
          text += `diff --git a/${p} b/${p}\nnew file\n(${s.size} bytes, too large to show)\n`
          continue
        }
        const buf = await readFile(abs)
        if (buf.includes(0)) {
          text += `diff --git a/${p} b/${p}\nnew file\nBinary file (${s.size} bytes)\n`
          continue
        }
        text += await gitDiffNoIndex(dir, p)
        const lines = buf.toString('utf8').split('\n')
        const f = out.files.find((x) => x.path === p)
        if (f) { f.added = lines.length - (lines[lines.length - 1] === '' ? 1 : 0); f.removed = 0 }
      } catch { /* a file that vanished mid-read is not worth failing for */ }
    }
    if (text.length > MAX_DIFF) {
      text = text.slice(0, MAX_DIFF)
      out.truncated = true
    }
    out.diff = text
    return out
  } catch {
    return out
  }
}
