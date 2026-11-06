import { spawn } from 'node:child_process'
import { existsSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { slugFor } from './groundbreak.ts'
import { norm } from './world.ts'

// Freight: a project brought in from elsewhere. The person gives a
// repository's address; a freight train pulls into Central Station with its
// name on the boxcars and stands there while git clones it into the projects
// folder; its borough is laid out at once, and its houses go up once it is
// unloaded and counted.

const CLONE_MS = 15 * 60_000
// Windows' device names, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

// The addresses git may be given: https, or ssh as git@host:path. Nothing
// else, git's ext:: and file:// transports above all (ext:: runs a command).
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._~/-]+?(?:\.git)?\/?$/
const SSH = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+?(?:\.git)?$/

export type Freight = { url: string; name: string; path: string }

// A repository's name from its address: its last part, without .git.
export function nameOf(url: string): string {
  return url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() ?? ''
}

// Checks what the page sent; throws with a message for it. Nothing is made.
export function checkFreight(args: Record<string, unknown>, fallbackParent: string): Freight {
  let url = typeof args.url === 'string' ? args.url.trim() : ''
  // A GitHub page's address works too: github.com/owner/repo, with or without https://.
  if (/^github\.com\//i.test(url)) url = `https://${url}`
  const gh = /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+?)(?:\.git)?(?:\/(?:tree|blob)\/.*)?\/?$/i.exec(url)
  if (gh) url = gh[1]!
  if (!HTTPS.test(url) && !SSH.test(url)) throw new Error('Give a repository address: https://github.com/owner/repo or git@github.com:owner/repo.git')
  const name = nameOf(url)
  if (!name) throw new Error('That address names no repository')

  const parentIn = typeof args.parent === 'string' && args.parent.trim() ? args.parent.trim() : fallbackParent
  if (!isAbsolute(parentIn)) throw new Error('Give the full path of the folder the project goes in')
  const parent = norm(resolve(parentIn))
  let isDir = false
  try {
    isDir = statSync(parent).isDirectory()
  } catch {}
  if (!isDir) throw new Error(`${parent} is not a folder`)

  const want = typeof args.folder === 'string' && args.folder.trim() ? args.folder.trim() : /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) ? name : slugFor(name)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(want) || want.endsWith('.') || RESERVED.test(want)) {
    throw new Error('The folder name may have letters, digits, dots, hyphens and underscores, and starts with a letter or digit')
  }
  const path = norm(join(parent, want))
  if (existsSync(path)) throw new Error(`${path} already exists: pick another folder name`)
  return { url, name, path }
}

// Clones it, then calls done with nothing or what went wrong. Git asks for
// nothing (a private repository it can't reach fails rather than waiting
// for a password no one will type); a clone that takes too long is stopped.
export function cloneProject(f: Freight, done: (error?: string) => void) {
  let err = ''
  let over = false
  const finish = (error?: string) => {
    if (over) return
    over = true
    clearTimeout(timer)
    // A clone that failed leaves nothing behind.
    if (error) rmSync(f.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    done(error)
  }
  const child = spawn('git', ['clone', '--', f.url, f.path], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  child.stderr!.on('data', (chunk: Buffer) => {
    err = (err + chunk.toString('utf8')).slice(-4000)
  })
  const timer = setTimeout(() => {
    child.kill()
    finish('The clone took more than 15 minutes and was stopped')
  }, CLONE_MS)
  child.on('error', e => finish(`Could not run git: ${e.message}`))
  child.on('close', code => {
    if (code === 0) return finish()
    const last = err.trim().split('\n').filter(l => !/^(Cloning into|remote:|Receiving|Resolving)/.test(l)).pop() ?? ''
    finish(last.replace(/^fatal:\s*/, '') || `git clone exited with code ${code}`)
  })
}
