import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { launchDetached } from './detached.ts'

// Keeps the app up to date with main on GitHub: checks every so often whether
// origin/main has commits this copy hasn't, and on request fast-forwards to
// them and restarts the server. Never merges: local changes or local commits
// that aren't on main make it say why instead. It also notices when this
// copy's own folder has moved on since the server started (commits made
// here): the code on disk is newer than the code running, and a restart
// applies it. Either way it says so once, with a desktop notification.

export type UpdateState = {
  // origin/main has commits this copy hasn't, and they can be pulled cleanly.
  available: boolean
  behind: number
  ahead: number
  // Tracked files changed here (uncommitted work would block a pull).
  dirty: boolean
  // What's new: the newest commit on origin/main, and how many there are.
  latest?: string
  checkedAt: number
  updating: boolean
  error?: string
  // This folder has commits the running server started before: a restart applies them.
  restart?: { count: number; latest: string }
}

// Says something to the person once (a desktop notification).
export type Notifier = (title: string, body: string) => void

const CHECK_EVERY = 10 * 60_000
// The folder's own commit is cheap to read: often.
const LOCAL_EVERY = 30_000

function git(root: string, args: string[], timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', root, ...args], { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) reject(new Error((errOut || err.message).trim().split('\n').pop() || 'git failed'))
      else resolve(out.trim())
    })
  })
}

export class Updates {
  state: UpdateState = { available: false, behind: 0, ahead: 0, dirty: false, checkedAt: 0, updating: false }
  private root: string
  private changed: () => void
  private timer?: ReturnType<typeof setInterval>
  private local?: ReturnType<typeof setInterval>
  private notify: Notifier
  // The commit the server started on, and what has been announced already.
  private bootHead?: string
  private told = new Set<string>()

  constructor(root: string, changed: () => void, notify: Notifier = () => {}) {
    this.root = root
    this.changed = changed
    this.notify = notify
  }

  // Checks now, then GitHub every ten minutes and this folder every half minute.
  watch() {
    void this.init().then(() => this.check())
    this.timer = setInterval(() => void this.check(), CHECK_EVERY)
    this.timer.unref()
    this.local = setInterval(() => void this.checkLocal(true), LOCAL_EVERY)
    this.local.unref()
  }

  // Remembers the commit the server started on.
  async init() {
    this.bootHead = await git(this.root, ['rev-parse', 'HEAD']).catch(() => undefined)
  }

  // Once per thing worth saying: a commit on main, a commit here.
  private announce(key: string, title: string, body: string) {
    if (this.told.has(key)) return
    this.told.add(key)
    this.notify(title, body)
  }

  // Whether this folder has moved on since the server started.
  async checkLocal(tell = false): Promise<void> {
    if (!this.bootHead || this.state.updating) return
    const head = await git(this.root, ['rev-parse', 'HEAD']).catch(() => undefined)
    if (!head) return
    let restart: UpdateState['restart']
    if (head !== this.bootHead) {
      const [count, latest] = await Promise.all([
        git(this.root, ['rev-list', '--count', `${this.bootHead}..${head}`]).catch(() => '1'),
        git(this.root, ['log', '-1', '--format=%s', head]).catch(() => ''),
      ])
      restart = { count: Math.max(1, Number(count) || 1), latest }
    }
    const was = JSON.stringify(this.state.restart)
    if (restart) this.state = { ...this.state, restart }
    else {
      const { restart: _, ...rest } = this.state
      this.state = rest
    }
    if (restart) {
      this.announce(
        `here:${head}`,
        'Crosswalk: restart to apply',
        `${restart.count} new commit${restart.count === 1 ? '' : 's'} in this copy${restart.latest ? `: ${restart.latest}` : ''}. Click the Empire State to restart.`,
      )
    }
    if (tell && JSON.stringify(this.state.restart) !== was) this.changed()
  }

  async check(): Promise<UpdateState> {
    if (this.state.updating) return this.state
    try {
      await git(this.root, ['fetch', '--quiet', 'origin', 'main'])
      const [behind, ahead, status] = await Promise.all([
        git(this.root, ['rev-list', '--count', 'HEAD..origin/main']),
        git(this.root, ['rev-list', '--count', 'origin/main..HEAD']),
        git(this.root, ['status', '--porcelain', '--untracked-files=no']),
      ])
      const latest = Number(behind) > 0 ? await git(this.root, ['log', '-1', '--format=%s', 'origin/main']) : undefined
      this.state = {
        available: Number(behind) > 0,
        behind: Number(behind),
        ahead: Number(ahead),
        dirty: status.length > 0,
        latest,
        checkedAt: Date.now(),
        updating: false,
        ...(this.state.restart ? { restart: this.state.restart } : {}),
      }
      if (this.state.available) {
        const tip = await git(this.root, ['rev-parse', 'origin/main']).catch(() => latest ?? '')
        this.announce(
          `main:${tip}`,
          'Crosswalk update ready',
          `${behind} new on main${latest ? `: ${latest}` : ''}. Click the Empire State to update.`,
        )
      }
      await this.checkLocal()
    } catch (err) {
      // Offline, or no origin: keep what we knew, and say why.
      this.state = { ...this.state, checkedAt: Date.now(), error: err instanceof Error ? err.message : String(err) }
    }
    this.changed()
    return this.state
  }

  // Fast-forwards to origin/main; the caller restarts the server after.
  async apply(): Promise<void> {
    const s = await this.check()
    // Only this folder moved on: nothing to pull, the restart applies it.
    if (!s.available && s.restart) return
    if (!s.available) throw new Error('Already up to date')
    if (s.dirty) throw new Error('This copy has local changes; commit or discard them first')
    if (s.ahead > 0) throw new Error(`This copy has ${s.ahead} commit${s.ahead === 1 ? '' : 's'} that ${s.ahead === 1 ? "isn't" : "aren't"} on main yet; push them first`)
    this.state = { ...s, updating: true }
    this.changed()
    try {
      await git(this.root, ['merge', '--ff-only', '--quiet', 'origin/main'], 60_000)
    } catch (err) {
      this.state = { ...this.state, updating: false, error: err instanceof Error ? err.message : String(err) }
      this.changed()
      throw err
    }
  }

  // Starts a fresh server once this one has let go of the port, in a window of
  // its own titled "Crosswalk" (closing it stops the server, as before). It is
  // started on its own (src/detached.ts), so it doesn't go down with whatever
  // started this one: a Claude Code session ending, say.
  relaunch() {
    launchDetached(relaunchLine(process.execPath, join(this.root, 'src', 'server.ts'), process.env, process.platform === 'win32'), this.root, 2)
  }
}

// The command that starts the server again. Started through WMI it inherits
// none of this one's environment, so Crosswalk's own settings (its port, no
// toasts, a config folder…) are set on the way; a value a shell would read
// as more than text is left out rather than quoted.
export function relaunchLine(execPath: string, server: string, env: Record<string, string | undefined>, isWindows: boolean): string {
  const keep = Object.entries(env).filter(([k, v]) => /^(AGENT_CITY\w*|CLAUDE_CONFIG_DIR)$/.test(k) && typeof v === 'string' && !/["%&|^<>`$\r\n]/.test(v)) as [string, string][]
  if (isWindows) return `cmd.exe /c ${keep.map(([k, v]) => `set "${k}=${v}" & `).join('')}title Crosswalk & "${execPath}" "${server}"`
  return `env ${keep.map(([k, v]) => `${k}='${v.replace(/'/g, '')}' `).join('')}"${execPath}" "${server}"`
}
