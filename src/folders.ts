import { execFile } from 'node:child_process'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

import { blockFor, parseTree } from './census.ts'

// What is inside a house: the files of the folder (a census block) a
// borough's houses stand for, and a look inside one of them. Read with git
// like the census (src/census.ts), so the list matches the houses: the files
// at HEAD, and what `git status` says has changed since, new files included.

export type Change = 'modified' | 'new' | 'deleted' | 'renamed'
export type FileRow = { path: string; bytes: number; change?: Change }
export type FolderList = { folder: string; files: FileRow[]; total: number; bytes: number }
export type FileLook = { path: string; abs: string; bytes: number; text?: string; truncated?: boolean; binary?: true; image?: string }

const LIST_MAX = 3000
const TEXT_MAX = 256 * 1024
export const IMAGE_MAX = 10 * 1024 * 1024

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
}

function git(root: string, args: string[], timeout = 15_000): Promise<string | null> {
  return new Promise(done => {
    execFile('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, out) => done(err ? null : out))
  })
}

// `git status --porcelain=v1 -uall -z`: "XY path\0", a rename or copy
// followed by its old path as one more entry.
export function parseChanges(out: string): Map<string, Change> {
  const changes = new Map<string, Change>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') {
      changes.set(path, 'renamed')
      i++
    } else if (xy === '??' || xy.includes('A')) changes.set(path, 'new')
    else if (xy.includes('D')) changes.set(path, 'deleted')
    else changes.set(path, 'modified')
  }
  return changes
}

function sizeOf(root: string, path: string): number {
  try {
    return statSync(join(root, path)).size
  } catch {
    return 0
  }
}

// The files of a folder as the census groups them: `folder` is one of its
// block paths ('' for the top-level files, '…' for the smaller folders
// together), and `keys` all of them.
export function filesOf(entries: { path: string; bytes: number }[], changes: Map<string, Change>, folder: string, keys: string[], size: (path: string) => number): FolderList {
  const byPath = new Map<string, FileRow>(entries.map(e => [e.path, { path: e.path, bytes: e.bytes }]))
  for (const [path, change] of changes) {
    const row = byPath.get(path) ?? { path, bytes: 0 }
    row.change = change
    if (change !== 'deleted') row.bytes = size(path)
    byPath.set(path, row)
  }
  const mine = [...byPath.values()].filter(f => blockFor(f.path, keys) === folder).sort((a, b) => a.path.localeCompare(b.path))
  return {
    folder,
    files: mine.slice(0, LIST_MAX),
    total: mine.length,
    bytes: mine.reduce((s, f) => s + (f.change === 'deleted' ? 0 : f.bytes), 0),
  }
}

export async function listFolder(root: string, folder: string, keys: string[]): Promise<FolderList> {
  const dir = root.replace(/\\/g, '/')
  const [tree, status] = await Promise.all([git(dir, ['ls-tree', '-r', '-l', '-z', 'HEAD'], 30_000), git(dir, ['status', '--porcelain=v1', '-uall', '-z'])])
  return filesOf(tree ? parseTree(tree) : [], parseChanges(status ?? ''), folder, keys, path => sizeOf(root, path))
}

// A file of root by its repository path, or nothing when the path leaves
// the repository (or is not a file).
export function fileIn(root: string, path: string): string | undefined {
  if (typeof path !== 'string' || !path || path.includes('\0')) return undefined
  const abs = resolve(root, path)
  const rel = relative(resolve(root), abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || /(^|[\\/])\.git([\\/]|$)/.test(rel)) return undefined
  try {
    return statSync(abs).isFile() ? abs : undefined
  } catch {
    return undefined
  }
}

// A look inside a file: its text (the start of a long one), or that it is an
// image (served raw), or that it is binary.
export function lookAt(root: string, path: string): FileLook | undefined {
  const abs = fileIn(root, path)
  if (!abs) return undefined
  const bytes = statSync(abs).size
  const base: FileLook = { path, abs, bytes }
  const image = IMAGE_TYPES[extname(abs).toLowerCase()]
  if (image) return { ...base, image }
  const fd = openSync(abs, 'r')
  try {
    const buf = Buffer.alloc(Math.min(bytes, TEXT_MAX))
    const got = buf.length ? readSync(fd, buf, 0, buf.length, 0) : 0
    const head = buf.subarray(0, got)
    if (head.subarray(0, 8000).includes(0)) return { ...base, binary: true }
    return { ...base, text: head.toString('utf8'), ...(bytes > got ? { truncated: true } : {}) }
  } finally {
    closeSync(fd)
  }
}
