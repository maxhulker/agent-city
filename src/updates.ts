import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'

// Keeps the app up to date with main on GitHub: checks every so often whether
// origin/main has commits this copy hasn't, and on request fast-forwards to
// them and restarts the server. Never merges: local changes or local commits
// that aren't on main make it say why instead.

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
}

const CHECK_EVERY = 10 * 60_000

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

  constructor(root: string, changed: () => void) {
    this.root = root
    this.changed = changed
  }

  // Checks now, then every ten minutes.
  watch() {
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_EVERY)
    this.timer.unref()
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
      }
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
  // its own titled "Agent City" (closing it stops the server, as before).
  relaunch() {
    const server = join(this.root, 'src', 'server.ts')
    if (process.platform === 'win32') {
      const line = `ping -n 3 127.0.0.1 >nul & start "Agent City" /min "${process.execPath}" "${server}"`
      spawn(process.env.ComSpec || 'cmd.exe', ['/c', line], { cwd: this.root, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref()
    } else {
      spawn('sh', ['-c', `sleep 2; exec "${process.execPath}" "${server}"`], { cwd: this.root, detached: true, stdio: 'ignore' }).unref()
    }
  }
}
