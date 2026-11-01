import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Task, TaskLevel, TaskModel } from './types.ts'
import { norm } from './world.ts'

// Headless Claude Code sessions started from the page. Each reports to the
// city by itself, through the same global hooks as any other session.

const PROMPT_MAX = 20_000
const RUNNING_MAX = 3
const KEPT = 20
const IS_WINDOWS = process.platform === 'win32'

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']
const EDIT_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']
// No word in these has a space or a quote: on Windows they pass through a shell.
const LEVELS: Record<TaskLevel, string[]> = {
  read: ['--allowedTools', ...READ_TOOLS],
  edit: ['--permission-mode', 'acceptEdits', '--allowedTools', ...EDIT_TOOLS],
  run: ['--permission-mode', 'acceptEdits', '--allowedTools', ...EDIT_TOOLS, 'Bash', 'PowerShell'],
}
const MODELS: TaskModel[] = ['default', 'haiku', 'sonnet', 'opus']

export type TaskEnd = 'start' | 'done' | 'failed' | 'stopped'

function tail(text: string, n = 2000): string {
  const t = text.trim()
  return t.length > n ? '…' + t.slice(-n) : t
}

// claude -p's JSON: one object, though a stray line may come before it.
function parseResult(out: string): Record<string, unknown> {
  const text = out.trim()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return JSON.parse(text.split('\n').pop() ?? '') as Record<string, unknown>
  }
}

export class Tasks {
  list: Task[]
  private procs = new Map<string, ChildProcess>()
  private changed: (task: Task, what: TaskEnd) => void

  constructor(saved: Task[] | undefined, changed: (task: Task, what: TaskEnd) => void) {
    this.changed = changed
    // A task saved as running lost its watcher when the server stopped.
    this.list = (saved ?? []).slice(-KEPT).map(t =>
      t.status === 'running'
        ? { ...t, status: 'failed', endedAt: t.endedAt ?? Date.now(), error: 'Agent City stopped while it ran; the session may have finished on its own.' }
        : t,
    )
  }

  get running(): number {
    return this.list.filter(t => t.status === 'running').length
  }

  // Starts claude -p in cwd; throws with a message for the page when it can't.
  start(args: { cwd?: unknown; prompt?: unknown; level?: unknown; model?: unknown }, now: number): Task {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (!prompt) throw new Error('The prompt is empty')
    if (prompt.length > PROMPT_MAX) throw new Error(`The prompt is longer than ${PROMPT_MAX} characters`)
    const level = args.level as TaskLevel
    if (typeof level !== 'string' || !Object.hasOwn(LEVELS, level)) throw new Error('level must be read, edit or run')
    const model = (args.model ?? 'default') as TaskModel
    if (!MODELS.includes(model)) throw new Error('model must be default, haiku, sonnet or opus')
    if (typeof args.cwd !== 'string' || !args.cwd.trim()) throw new Error('No folder given')
    const cwd = norm(resolve(args.cwd.trim()))
    let isDir = false
    try {
      isDir = statSync(cwd).isDirectory()
    } catch {}
    if (!isDir) throw new Error(`${cwd} is not a folder`)
    if (this.running >= RUNNING_MAX) throw new Error(`${RUNNING_MAX} tasks are already running`)

    const task: Task = { id: randomUUID(), cwd, prompt, level, model, status: 'running', startedAt: now }
    const argv = ['-p', '--output-format', 'json', ...(model === 'default' ? [] : ['--model', model]), ...LEVELS[level]]
    // CLAUDECODE marks a shell inside a session; a server started from one shouldn't pass it on.
    const env = { ...process.env }
    delete env.CLAUDECODE
    const child = spawn('claude', argv, { cwd, env, shell: IS_WINDOWS, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.procs.set(task.id, child)
    this.list = [...this.list, task].slice(-KEPT)

    let out = ''
    let err = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      if (out.length < 8 * 1024 * 1024) out += chunk.toString('utf8')
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString('utf8')).slice(-8000)
    })
    // The prompt goes on stdin: no quoting, no length limit from the command line.
    child.stdin!.on('error', () => {})
    child.stdin!.end(prompt)

    let isOver = false
    const finish = (code: number | null, failure?: string) => {
      if (isOver) return
      isOver = true
      this.procs.delete(task.id)
      task.endedAt = Date.now()
      if (task.status === 'stopped') {
        this.changed(task, 'stopped')
        return
      }
      try {
        const res = parseResult(out)
        if (typeof res.result === 'string') task.result = res.result
        if (typeof res.session_id === 'string') task.sessionId = res.session_id
        if (typeof res.total_cost_usd === 'number') task.costUsd = res.total_cost_usd
        const isError = res.is_error === true || code !== 0
        task.status = isError ? 'failed' : 'done'
        if (isError) task.error = tail(err) || task.result || `claude exited with code ${code}`
      } catch {
        task.status = 'failed'
        task.error = failure ?? (tail(err) || tail(out) || `claude exited with code ${code}`)
      }
      this.changed(task, task.status === 'done' ? 'done' : 'failed')
    }
    child.on('error', e => finish(null, `Could not start claude: ${e.message}`))
    child.on('close', code => finish(code))
    this.changed(task, 'start')
    return task
  }

  // Ends a running task, with everything it started.
  stop(id: unknown): boolean {
    const task = this.list.find(t => t.id === id && t.status === 'running')
    const child = task && this.procs.get(task.id)
    if (!task || !child) return false
    task.status = 'stopped'
    if (IS_WINDOWS && child.pid) {
      // With shell: true the pid is cmd.exe's; /T takes claude and its tools with it.
      // Waited for, so a server on its way out still takes them all down.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
    return true
  }

  // Leaves nothing running behind when the server exits.
  stopAll() {
    for (const t of this.list) if (t.status === 'running') this.stop(t.id)
  }
}
