import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { norm } from './world.ts'

// Breaking ground: a project that starts in the city. The person drags out a
// borough (or picks an empty one), names the project and says what it is
// for; Crosswalk makes its folder, a git repository with the brief in
// CLAUDE.md, moves it into the borough, and starts a session to lay its
// foundations. Its houses go up as its files are committed.

const BRIEF_MAX = 8000
const LEVELS = ['read', 'ask', 'edit', 'run']
// Names Windows keeps for devices, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

// A folder name for a project: its name, lower case, words joined by hyphens.
export function slugFor(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
}

// Where new projects go when the person hasn't said: beside Manhattan's
// repository, or inside Manhattan's folder when it is a folder of projects
// rather than a repository itself.
export function projectsDir(homeRoot: string | undefined, home: string): string {
  if (homeRoot && existsSync(homeRoot)) return norm(existsSync(join(homeRoot, '.git')) ? dirname(homeRoot) : homeRoot)
  return norm(home)
}

export type Ground = { name: string; path: string; brief: string; level: string }

// Checks what the page sent; throws with a message for the page. Nothing is
// made on disk here.
export function checkGround(args: Record<string, unknown>, fallbackParent: string): Ground {
  const name = typeof args.name === 'string' ? args.name.trim().slice(0, 40) : ''
  if (!name) throw new Error('Name the project')
  const brief = typeof args.brief === 'string' ? args.brief.trim() : ''
  if (!brief) throw new Error('Say what the project is for: Claude starts from the brief')
  if (brief.length > BRIEF_MAX) throw new Error(`The brief is longer than ${BRIEF_MAX} characters`)
  const level = typeof args.level === 'string' ? args.level : ''
  if (!LEVELS.includes(level)) throw new Error('level must be read, ask, edit or run')

  const parentIn = typeof args.parent === 'string' && args.parent.trim() ? args.parent.trim() : fallbackParent
  if (!isAbsolute(parentIn)) throw new Error('Give the full path of the folder the project goes in')
  const parent = norm(resolve(parentIn))
  let isDir = false
  try {
    isDir = statSync(parent).isDirectory()
  } catch {}
  if (!isDir) throw new Error(`${parent} is not a folder`)

  const folder = typeof args.folder === 'string' && args.folder.trim() ? args.folder.trim() : slugFor(name)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(folder) || folder.endsWith('.') || RESERVED.test(folder)) {
    throw new Error('The folder name may have letters, digits, dots, hyphens and underscores, and starts with a letter or digit')
  }
  const path = norm(join(parent, folder))
  if (existsSync(path)) throw new Error(`${path} already exists: pick another folder name`)
  return { name, path, brief, level }
}

const claudeMd = (g: Ground) => `# ${g.name}\n\n${g.brief}\n`

// Makes the folder, the repository and its CLAUDE.md, and commits it when git
// knows who the person is (the borough's first house goes up with it).
// Returns whether it committed; throws, leaving nothing behind, when the
// folder or the repository can't be made.
export function breakGround(g: Ground): { committed: boolean } {
  mkdirSync(g.path)
  const git = (args: string[]) => execFileSync('git', args, { cwd: g.path, stdio: 'ignore', windowsHide: true, timeout: 15_000 })
  try {
    git(['init', '-q'])
    writeFileSync(join(g.path, 'CLAUDE.md'), claudeMd(g))
  } catch (err) {
    rmSync(g.path, { recursive: true, force: true })
    throw new Error(`Could not make the repository: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    git(['add', 'CLAUDE.md'])
    git(['commit', '-q', '-m', 'Break ground'])
    return { committed: true }
  } catch {
    return { committed: false }
  }
}

// Takes back what breakGround made, when the borough can't be laid out after all.
export function unbreak(g: Ground) {
  rmSync(g.path, { recursive: true, force: true })
}

// The first message of the session that lays the foundations.
export function foundationsPrompt(g: Ground): string {
  return [
    `This is a brand-new project, "${g.name}", started from Crosswalk. This folder is a fresh git repository; CLAUDE.md holds the brief, which is also below.`,
    '',
    "Lay its foundations: pick a sensible stack if the brief doesn't name one, set up the project's structure and a first version that works, and keep it small. Update CLAUDE.md with how to run it. Commit once the first version works.",
    '',
    'The brief:',
    '',
    g.brief,
  ].join('\n')
}
