import type { Blueprint, Census } from './types.ts'

// Blueprints: the folders a project is about to get, drawn on its borough's
// empty plots before they are built. A plan presented from plan mode names
// files and folders; a session writing a file into a folder the repository
// doesn't have yet is building one. A blueprint goes when the census has
// the folder (its files committed: the houses stand), or after a few days.

export const BLUEPRINT_MS = 3 * 24 * 3600_000
const MAX = 8
// Folders that are never a house of their own.
const IGNORED = /^(node_modules|\.git|dist|build|out|coverage|\.next|\.cache|target|vendor|__pycache__)$/

const norm = (p: string) => p.replace(/\\/g, '/')

// A path's place in the repository at root, or undefined when it lies outside.
export function relativeTo(root: string, path: string): string | undefined {
  const r = norm(root).replace(/\/+$/, '').toLowerCase()
  const p = norm(path)
  if (!/^([a-z]:)?\//i.test(p)) return p.replace(/^\.\//, '')
  return p.toLowerCase().startsWith(r + '/') ? p.slice(r.length + 1) : undefined
}

// The folder a path would be a house of: its first folder ('' for a file at the top).
export function folderOf(rel: string): string {
  const i = rel.indexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

// Whether a census already has a folder: a block of that name, or the
// folder split into blocks of its own subfolders.
export function censusHas(census: Census | undefined, folder: string): boolean {
  return !!census?.blocks.some(b => b.path === folder || b.path.startsWith(folder + '/'))
}

// The paths a plan names: `src/app.ts`, docs/, public/index.html (a word
// with a slash and either a file's extension or a closing slash, so "and/or"
// is not one). URLs are left out; absolute paths are taken relative to root.
export function pathsInPlan(plan: string, root: string): string[] {
  const out = new Set<string>()
  const text = plan.replace(/[a-z][\w+.-]*:\/\/\S+/gi, ' ')
  for (const m of text.matchAll(/(?:^|[\s`'"(\[<*])((?:[A-Za-z]:)?[\w./\\-]*[\\/][\w.\\/-]*)/g)) {
    const raw = m[1]!.replace(/[.,;:)\]]+$/, '')
    if (!/\/$|\\$|\.[A-Za-z0-9]{1,8}$/.test(raw)) continue
    const rel = relativeTo(root, raw)
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) out.add(rel)
  }
  return [...out]
}

// The new folders among paths: not in the census, not ignored, not the top.
export function newFolders(paths: string[], census: Census | undefined): string[] {
  const out = new Set<string>()
  for (const p of paths) {
    const f = folderOf(p)
    if (!f || IGNORED.test(f) || f.startsWith('.') || censusHas(census, f)) continue
    out.add(f)
  }
  return [...out]
}

// Adds blueprints for new folders, returning the ones that weren't there.
export function addBlueprints(list: Blueprint[] | undefined, folders: string[], from: Blueprint['from'], now: number): { list: Blueprint[]; added: string[] } {
  const next = (list ?? []).map(b => ({ ...b }))
  const added: string[] = []
  for (const path of folders) {
    const had = next.find(b => b.path === path)
    if (had) {
      had.at = now
      continue
    }
    next.push({ path, at: now, from })
    added.push(path)
  }
  return { list: next.slice(-MAX), added }
}

// The blueprints still standing: not built yet, not stale.
export function unbuilt(list: Blueprint[] | undefined, census: Census | undefined, now: number): Blueprint[] {
  return (list ?? []).filter(b => now - b.at < BLUEPRINT_MS && !censusHas(census, b.path))
}
