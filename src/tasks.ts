import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Task, TaskEffort, TaskLevel, TaskModel, TaskTurn } from './types.ts'
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
  // The rest goes through the PermissionRequest hook to the page; unanswered, it's denied.
  ask: ['--allowedTools', ...READ_TOOLS],
  edit: ['--permission-mode', 'acceptEdits', '--allowedTools', ...EDIT_TOOLS],
  run: ['--permission-mode', 'acceptEdits', '--allowedTools', ...EDIT_TOOLS, 'Bash', 'PowerShell'],
}
const ALIASES = ['default', 'fable', 'opus', 'sonnet', 'haiku']
// A full model ID, as the API names it (an optional [1m] asks for the long context).
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{2,60}(\[1m\])?$/
const EFFORTS: TaskEffort[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max']

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
  // What a city adds to its tasks' environment (src/cities.ts): AGENT_CITY,
  // so their hooks report to it, and a config folder of its own if it has one.
  private env: Record<string, string>

  constructor(saved: Task[] | undefined, changed: (task: Task, what: TaskEnd) => void, env: Record<string, string> = {}) {
    this.changed = changed
    this.env = env
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
  start(args: { cwd?: unknown; prompt?: unknown; level?: unknown; model?: unknown; effort?: unknown }, now: number): Task {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (!prompt) throw new Error('The prompt is empty')
    if (prompt.length > PROMPT_MAX) throw new Error(`The prompt is longer than ${PROMPT_MAX} characters`)
    const level = args.level as TaskLevel
    if (typeof level !== 'string' || !Object.hasOwn(LEVELS, level)) throw new Error('level must be read, ask, edit or run')
    const model: TaskModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : 'default'
    // Checked by shape, since it reaches a shell on Windows.
    if (!ALIASES.includes(model) && !MODEL_ID.test(model)) {
      throw new Error('model must be default, fable, opus, sonnet, haiku or a full model ID like claude-opus-5-5')
    }
    const effort = (typeof args.effort === 'string' && args.effort ? args.effort : 'default') as TaskEffort
    if (!EFFORTS.includes(effort)) throw new Error('effort must be default, low, medium, high, xhigh or max')
    if (typeof args.cwd !== 'string' || !args.cwd.trim()) throw new Error('No folder given')
    const cwd = norm(resolve(args.cwd.trim()))
    let isDir = false
    try {
      isDir = statSync(cwd).isDirectory()
    } catch {}
    if (!isDir) throw new Error(`${cwd} is not a folder`)
    if (this.running >= RUNNING_MAX) throw new Error(`${RUNNING_MAX} tasks are already running`)

    const task: Task = { id: randomUUID(), cwd, prompt, level, model, effort, status: 'running', startedAt: now }
    const argv = [
      '-p',
      '--output-format',
      'json',
      ...(model === 'default' ? [] : ['--model', model]),
      ...(effort === 'default' ? [] : ['--effort', effort]),
      ...LEVELS[level],
    ]
    // CLAUDECODE marks a shell inside a session; a server started from one shouldn't pass it on.
    const env = { ...process.env }
    delete env.CLAUDECODE
    Object.assign(env, this.env)
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
        if (res.modelUsage && typeof res.modelUsage === 'object') task.usedModels = Object.keys(res.modelUsage)
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

  // Sends a follow-up to a finished task by resuming its session; the task runs again.
  continue(id: unknown, prompt: unknown, now: number): Task {
    const task = this.list.find(t => t.id === id)
    if (!task) throw new Error('No such task')
    if (task.status === 'running') throw new Error('The task is still running')
    const sessionId = task.sessionId
    // Checked by shape, since it reaches a shell on Windows.
    if (!sessionId || !/^[A-Za-z0-9-]{1,100}$/.test(sessionId)) throw new Error('This task has no session to continue')
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (!text) throw new Error('The prompt is empty')
    if (text.length > PROMPT_MAX) throw new Error(`The prompt is longer than ${PROMPT_MAX} characters`)
    if (this.running >= RUNNING_MAX) throw new Error(`${RUNNING_MAX} tasks are already running`)

    const turn: TaskTurn = { prompt: text, at: now }
    const argv = [
      '-p',
      '--resume',
      sessionId,
      '--output-format',
      'json',
      ...(task.model === 'default' ? [] : ['--model', task.model]),
      ...(task.effort === 'default' ? [] : ['--effort', task.effort]),
      ...LEVELS[task.level],
    ]
    const env = { ...process.env }
    delete env.CLAUDECODE
    Object.assign(env, this.env)
    const child = spawn('claude', argv, { cwd: task.cwd, env, shell: IS_WINDOWS, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    task.turns = [...(task.turns ?? []), turn]
    task.status = 'running'
    delete task.endedAt
    delete task.error
    this.procs.set(task.id, child)

    let out = ''
    let err = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      if (out.length < 8 * 1024 * 1024) out += chunk.toString('utf8')
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString('utf8')).slice(-8000)
    })
    child.stdin!.on('error', () => {})
    child.stdin!.end(text)

    let isOver = false
    const finish = (code: number | null, failure?: string) => {
      if (isOver) return
      isOver = true
      this.procs.delete(task.id)
      turn.endedAt = task.endedAt = Date.now()
      if (task.status === 'stopped') {
        this.changed(task, 'stopped')
        return
      }
      try {
        const res = parseResult(out)
        if (typeof res.result === 'string') turn.result = res.result
        // Resuming may return the same session id or a new one; the next turn resumes the latest.
        if (typeof res.session_id === 'string') task.sessionId = res.session_id
        if (typeof res.total_cost_usd === 'number') {
          turn.costUsd = res.total_cost_usd
          task.costUsd = (task.costUsd ?? 0) + res.total_cost_usd
        }
        if (res.modelUsage && typeof res.modelUsage === 'object') {
          task.usedModels = [...new Set([...(task.usedModels ?? []), ...Object.keys(res.modelUsage)])]
        }
        const isError = res.is_error === true || code !== 0
        task.status = isError ? 'failed' : 'done'
        if (isError) turn.error = task.error = tail(err) || turn.result || `claude exited with code ${code}`
      } catch {
        task.status = 'failed'
        turn.error = task.error = failure ?? (tail(err) || tail(out) || `claude exited with code ${code}`)
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
