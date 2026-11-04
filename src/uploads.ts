import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'

// Files the person attaches to a message in the page. Each is saved under
// <state>/uploads/<day>/<random>-<name>, and the message lists their paths:
// any session can open them with its Read tool (images, PDFs, notebooks,
// text). Sessions that live in the app are started with --add-dir on this
// folder, so reading one never asks; their images also go in with the
// message itself, as Claude sees a pasted image.

export const UPLOAD_MAX = 30 * 1024 * 1024
// The API takes an image of up to 5 MB once encoded; base64 adds a third.
const INLINE_MAX = Math.floor((5 * 1024 * 1024 * 3) / 4) - 1024
const KEEP_DAYS = 30
const DAY = /^\d{4}-\d{2}-\d{2}$/

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export type Upload = { path: string; name: string; size: number; image: boolean }

// A file name that is safe on every system and in a shell: letters, digits
// and a few marks; anything else becomes _.
export function safeName(name: string): string {
  const base = basename(String(name ?? '').replace(/\\/g, '/'))
  const clean = base.replace(/[^\w.\-()+ ]+/g, '_').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim()
  const ext = extname(clean).slice(0, 12)
  const stem = clean.slice(0, clean.length - extname(clean).length).slice(0, 100)
  return stem ? stem + ext : 'file' + ext
}

const isImage = (path: string) => Object.hasOwn(IMAGE_TYPES, extname(path).toLowerCase())

export function saveUpload(root: string, name: string, bytes: Buffer, now = Date.now()): Upload {
  if (!bytes.length) throw new Error('The file is empty')
  if (bytes.length > UPLOAD_MAX) throw new Error(`Files can be up to ${UPLOAD_MAX / 1024 / 1024} MB`)
  const dir = join(root, new Date(now).toISOString().slice(0, 10))
  mkdirSync(dir, { recursive: true })
  const safe = safeName(name)
  const path = join(dir, `${randomBytes(4).toString('hex')}-${safe}`)
  writeFileSync(path, bytes, { flag: 'wx' })
  return { path, name: safe, size: bytes.length, image: isImage(path) }
}

// True for a file this module saved: the page may only point at those.
export function isUpload(root: string, path: unknown): path is string {
  if (typeof path !== 'string' || !path) return false
  const rel = relative(resolve(root), resolve(path))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// Message content blocks for the attached images small enough to send inline.
export function imageBlocks(root: string, paths: unknown): Record<string, unknown>[] {
  if (!Array.isArray(paths)) return []
  const out: Record<string, unknown>[] = []
  for (const p of paths.slice(0, 20)) {
    if (!isUpload(root, p) || !isImage(p)) continue
    try {
      if (statSync(p).size > INLINE_MAX) continue
      out.push({ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[extname(p).toLowerCase()], data: readFileSync(p).toString('base64') } })
    } catch {}
  }
  return out
}

// Days older than KEEP_DAYS go; returns how many folders were removed.
export function pruneUploads(root: string, now = Date.now(), keepDays = KEEP_DAYS): number {
  const cutoff = new Date(now - keepDays * 86_400_000).toISOString().slice(0, 10)
  let n = 0
  let days: string[] = []
  try { days = readdirSync(root) } catch { return 0 }
  for (const d of days) {
    if (!DAY.test(d) || d >= cutoff) continue
    try {
      rmSync(join(root, d), { recursive: true, force: true })
      n++
    } catch {}
  }
  return n
}
