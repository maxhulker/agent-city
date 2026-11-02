import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { HATS } from './draw/agents.ts'
import type { AppSession, Decision, Hat, Look, Pending, TaskEffort, TaskLevel, TaskModel } from './types.ts'
import { norm } from './world.ts'

// Claude Code sessions that live in the app: one long-running `claude -p` per
// session in streaming mode, so the page can message it at any time.
//
// Protocol (Claude Code 2.1, stream-json both ways, one JSON object per line):
// - in:  {"type":"user","uuid":U,"session_id":"","parent_tool_use_id":null,
//         "message":{"role":"user","content":"text"}}. Written while a turn
//         runs, it is folded into that turn at its next model request.
//         --replay-user-messages echoes each one back ({…,"uuid":U,
//         "isReplay":true}) when Claude takes it in: that is how `queued` drops.
// - out: system/init at the start of every turn; stream_event deltas
//        (--include-partial-messages); assistant/user messages; a `result`
//        at the end of every turn, whose total_cost_usd is the process's
//        running total. A process started with --resume begins that total at
//        the cost-state record Claude wrote into the resumed transcript when
//        its last process exited cleanly (none if it was killed), so we read
//        that record first and count only what this process adds.
// - permissions (--permission-prompt-tool stdio): out {"type":"control_request",
//   "request_id":R,"request":{"subtype":"can_use_tool","tool_name","input",…}};
//   in {"type":"control_response","response":{"subtype":"success",
//   "request_id":R,"response":{"behavior":"allow","updatedInput":{…}} or
//   {"behavior":"deny","message":"…"}}}. A PermissionRequest hook runs
//   alongside; when it decides first Claude sends {"type":"control_cancel_request","request_id":R}.
// - interrupt: in {"type":"control_request","request_id":I,"request":{"subtype":"interrupt"}};
//   out a control_response {"subtype":"success","request_id":I,"response":{"still_queued":[…]}},
//   then the turn's result (subtype error_during_execution). The process lives on.

const PROMPT_MAX = 20_000
// Processes alive at once.
const LIVE_MAX = 8
// Ended or failed sessions kept in the list.
const KEPT_DONE = 20
const STOP_GRACE_MS = 3000
const LIVE_EVERY_MS = 250
const INPUT_BUDGET = 2000
const DECLINED = 'The user declined this in Agent City.'
const READ_ONLY = 'This session can only read (Agent City level "read"); ask the user to raise its level for this.'
const IS_WINDOWS = process.platform === 'win32'

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']
const EDIT_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']
// No word in these has a space or a quote: on Windows they pass through a shell.
// Anything not allowed asks the app (stdio permission prompts); at 'read' the
// app denies it at once, at the others it becomes a card in the page.
const LEVELS: Record<TaskLevel, string[]> = {
  read: ['--allowedTools', ...READ_TOOLS],
  ask: ['--allowedTools', ...READ_TOOLS],
  edit: ['--permission-mode', 'acceptEdits', '--allowedTools', ...EDIT_TOOLS],
  run: ['--permission-mode', 'acceptEdits', '--allowedTools', ...EDIT_TOOLS, 'Bash', 'PowerShell'],
}
const ALIASES = ['default', 'fable', 'opus', 'sonnet', 'haiku']
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{2,60}(\[1m\])?$/
const EFFORTS: TaskEffort[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max']
// Claude Code session ids are UUIDs; checked by shape, since they reach a shell on Windows.
const SESSION_ID = /^[A-Za-z0-9-]{8,100}$/

type Held = { pending: Pending; toolInput: Record<string, unknown>; requestId: string; owner: string }

// What we keep beside each AppSession while it has a process.
type Proc = {
  child: ChildProcess
  buf: string
  err: string
  // Messages written and not yet taken in (by uuid): true when sent while busy.
  unread: Map<string, boolean>
  // The cost of the session's earlier processes; results add this one's running total…
  costBase: number
  // …less what Claude restored from the resumed transcript.
  restored: number
  gotInit: boolean
  interrupted: boolean
  stopping: boolean
  liveTimer?: ReturnType<typeof setTimeout>
  killTimer?: ReturnType<typeof setTimeout>
}

export type StartArgs = { cwd?: unknown; prompt?: unknown; level?: unknown; model?: unknown; effort?: unknown; resume?: unknown; look?: unknown }

const NAME_MAX = 24

// The look picked in the New session form, checked: a name (one line, no
// control characters), a #rrggbb colour and a hat the city can draw. Empty
// fields are left to the city; undefined when nothing was picked.
export function lookOf(v: unknown): Look | undefined {
  if (v == null) return undefined
  if (typeof v !== 'object') throw new Error('look must be an object')
  const { name, color, hat } = v as Record<string, unknown>
  const look: Look = {}
  if (name != null && name !== '') {
    if (typeof name !== 'string') throw new Error('name must be text')
    const t = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (t.length > NAME_MAX) throw new Error(`The name is longer than ${NAME_MAX} characters`)
    if (t) look.name = t
  }
  if (color != null && color !== '') {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('color must look like #38bdf8')
    look.color = color.toLowerCase()
  }
  if (hat != null && hat !== '') {
    if (typeof hat !== 'string' || !Object.hasOwn(HATS, hat)) throw new Error(`hat must be one of ${Object.keys(HATS).join(', ')}`)
    look.hat = hat as Hat
  }
  return Object.keys(look).length ? look : undefined
}

function oneLine(text: string, n = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function tail(text: string, n = 2000): string {
  const t = text.trim()
  return t.length > n ? '…' + t.slice(-n) : t
}

function summarize(tool: string, input: Record<string, unknown>): string {
  const first =
    str(input.command) ||
    str(input.file_path) ||
    str(input.notebook_path) ||
    str(input.url) ||
    str(input.path) ||
    str(input.pattern) ||
    str(input.query)
  return first ? oneLine(first) : tool
}

function trimInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let left = INPUT_BUDGET
  for (const [key, value] of Object.entries(input)) {
    if (left <= 0) {
      out[key] = '…'
      continue
    }
    if (typeof value === 'string') {
      out[key] = value.length > left ? value.slice(0, left) + '…' : value
      left -= Math.min(value.length, left)
      continue
    }
    const json = JSON.stringify(value) ?? ''
    if (json.length <= left) out[key] = value
    else out[key] = json.slice(0, left) + '…'
    left -= Math.min(json.length, left)
  }
  return out
}

function questionsOf(input: Record<string, unknown>): Pending['questions'] {
  if (!Array.isArray(input.questions)) return undefined
  return input.questions
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && typeof q.question === 'string')
    .map(q => ({
      question: q.question as string,
      header: typeof q.header === 'string' ? q.header : undefined,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof o.label === 'string')
        .map(o => ({ label: o.label as string, description: typeof o.description === 'string' ? o.description : undefined })),
      multiSelect: q.multiSelect === true,
    }))
}

// The cost Claude restores when it resumes a session: the last cost-state
// record in its transcript. 0 when there is none.
export function restoredCost(cwd: string, sessionId: string, configDir?: string): number {
  try {
    const projects = join(configDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
    const name = sessionId + '.jsonl'
    let file = join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'), name)
    if (!existsSync(file)) {
      // Long folder names are shortened; look everywhere.
      const dir = readdirSync(projects).find(d => existsSync(join(projects, d, name)))
      if (!dir) return 0
      file = join(projects, dir, name)
    }
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"cost-state"')) continue
      try {
        const rec = JSON.parse(lines[i]) as Record<string, unknown>
        if (rec.type === 'cost-state' && typeof rec.totalCostUSD === 'number') return rec.totalCostUSD
      } catch {}
    }
    return 0
  } catch {
    return 0
  }
}

function checkText(text: unknown): string {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) throw new Error('The message is empty')
  if (t.length > PROMPT_MAX) throw new Error(`The message is longer than ${PROMPT_MAX} characters`)
  return t
}

export class AppSessions {
  private sessions: AppSession[]
  private procs = new Map<string, Proc>()
  private held = new Map<string, Held>()
  private onChange: (s: AppSession, what: string) => void
  // What a city adds to its sessions' environment (src/cities.ts): AGENT_CITY,
  // so their hooks report to it, and a config folder of its own if it has one.
  private env: Record<string, string>

  constructor(saved: AppSession[] | undefined, onChange: (s: AppSession, what: string) => void, env: Record<string, string> = {}) {
    this.onChange = onChange
    this.env = env
    // Their processes went with the server; each wakes on its next message.
    this.sessions = (saved ?? []).map(s => {
      const out: AppSession = { ...s }
      if (out.status === 'starting' || out.status === 'working' || out.status === 'idle') out.status = 'asleep'
      delete out.live
      delete out.queued
      return out
    })
  }

  list(): AppSession[] {
    return this.sessions
  }

  pending(): Pending[] {
    return [...this.held.values()].map(h => h.pending).sort((a, b) => a.at - b.at)
  }

  // A Claude session id this app runs: the server's PermissionRequest hook
  // stands aside for it (the app answers through stdio instead).
  owns(claudeSessionId: string): boolean {
    return this.sessions.some(s => s.sessionId === claudeSessionId && this.procs.has(s.id))
  }

  get alive(): number {
    return this.procs.size
  }

  // Starts a session in cwd; throws with a message for the page when it can't.
  start(args: StartArgs, now: number): AppSession {
    const prompt = args.prompt == null || args.prompt === '' ? '' : checkText(args.prompt)
    const level = args.level as TaskLevel
    if (typeof level !== 'string' || !Object.hasOwn(LEVELS, level)) throw new Error('level must be read, ask, edit or run')
    const model: TaskModel = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : 'default'
    if (!ALIASES.includes(model) && !MODEL_ID.test(model)) {
      throw new Error('model must be default, fable, opus, sonnet, haiku or a full model ID like claude-opus-5-5')
    }
    const effort = (typeof args.effort === 'string' && args.effort ? args.effort : 'default') as TaskEffort
    if (!EFFORTS.includes(effort)) throw new Error('effort must be default, low, medium, high, xhigh or max')
    let resume: string | undefined
    if (args.resume != null && args.resume !== '') {
      if (typeof args.resume !== 'string' || !SESSION_ID.test(args.resume)) throw new Error('resume must be a Claude Code session id')
      resume = args.resume
    }
    const look = lookOf(args.look)
    if (typeof args.cwd !== 'string' || !args.cwd.trim()) throw new Error('No folder given')
    const cwd = norm(resolve(args.cwd.trim()))
    let isDir = false
    try {
      isDir = statSync(cwd).isDirectory()
    } catch {}
    if (!isDir) throw new Error(`${cwd} is not a folder`)
    if (this.procs.size >= LIVE_MAX) throw new Error(`${LIVE_MAX} sessions are already running in the app`)

    const s: AppSession = {
      id: randomUUID(),
      cwd,
      title: prompt ? oneLine(prompt, 60) : basename(cwd) || cwd,
      level,
      model,
      effort,
      status: prompt ? 'starting' : 'idle',
      startedAt: now,
      lastAt: now,
    }
    if (resume) s.forkedFrom = resume
    if (look) s.look = look
    this.sessions.push(s)
    this.prune()
    this.spawn(s, resume ? ['--resume', resume, '--fork-session'] : [])
    if (prompt) this.write(s, prompt)
    this.onChange(s, 'start')
    return s
  }

  // A message, idle or busy; an asleep session wakes for it.
  send(id: string, text: unknown, now: number): AppSession {
    const s = this.sessions.find(x => x.id === id)
    if (!s) throw new Error('No such session')
    const msg = checkText(text)
    if (s.status === 'ended') throw new Error('This session has ended')
    if (!this.procs.has(s.id)) {
      if (this.procs.size >= LIVE_MAX) throw new Error(`${LIVE_MAX} sessions are already running in the app`)
      // Its own history when it has one; a fork that never got going forks again.
      const how = s.sessionId ? ['--resume', s.sessionId] : s.forkedFrom ? ['--resume', s.forkedFrom, '--fork-session'] : []
      delete s.error
      this.spawn(s, how)
      s.status = 'starting'
    }
    s.lastAt = now
    this.write(s, msg)
    this.onChange(s, 'send')
    return s
  }

  // Stops the current turn; the session stays, idle.
  interrupt(id: string): boolean {
    const s = this.sessions.find(x => x.id === id)
    const p = s && this.procs.get(s.id)
    if (!s || !p || p.stopping) return false
    if (s.status !== 'working' && s.status !== 'starting') return false
    p.interrupted = true
    return this.line(p, { type: 'control_request', request_id: 'interrupt-' + randomUUID(), request: { subtype: 'interrupt' } })
  }

  // Ends it for good: stdin closes, and after a grace period the whole tree goes.
  stop(id: string): boolean {
    const s = this.sessions.find(x => x.id === id)
    if (!s || s.status === 'ended') return false
    const p = this.procs.get(s.id)
    const wasBusy = s.status === 'working' || s.status === 'starting'
    s.status = 'ended'
    delete s.live
    delete s.queued
    s.lastAt = Date.now()
    if (p && !p.stopping) {
      p.stopping = true
      this.dropHeld(s.id)
      // A turn in progress stops now rather than running on until the kill.
      if (wasBusy) this.line(p, { type: 'control_request', request_id: 'interrupt-' + randomUUID(), request: { subtype: 'interrupt' } })
      try {
        p.child.stdin?.end()
      } catch {}
      p.killTimer = setTimeout(() => this.kill(p), STOP_GRACE_MS)
    }
    this.onChange(s, 'ended')
    return true
  }

  // The page's answer to one of ours. False when it is gone.
  decide(pendingId: string, decision: Decision): boolean {
    const h = this.held.get(pendingId)
    if (!h) return false
    const p = this.procs.get(h.owner)
    let response: Record<string, unknown>
    if (decision.behavior === 'deny') {
      response = { behavior: 'deny', message: decision.message?.trim() || DECLINED }
    } else if (h.pending.kind === 'question') {
      // The tool reads the answers from its own input: question text → chosen label(s).
      response = { behavior: 'allow', updatedInput: { ...h.toolInput, answers: decision.answers ?? {} } }
    } else {
      response = { behavior: 'allow', updatedInput: h.toolInput }
    }
    const sent = !!p && this.line(p, { type: 'control_response', response: { subtype: 'success', request_id: h.requestId, response } })
    this.held.delete(pendingId)
    const s = this.sessions.find(x => x.id === h.owner)
    if (s) this.onChange(s, 'pending')
    return sent
  }

  // When the server exits: no process left behind. Statuses stay; the next
  // server marks them asleep.
  shutdown() {
    for (const p of this.procs.values()) {
      p.stopping = true
      this.kill(p)
    }
  }

  private prune() {
    const done = this.sessions.filter(s => s.status === 'ended' || s.status === 'failed')
    if (done.length <= KEPT_DONE) return
    const drop = new Set(done.slice(0, done.length - KEPT_DONE))
    this.sessions = this.sessions.filter(s => !drop.has(s))
  }

  private spawn(s: AppSession, how: string[]) {
    const argv = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--replay-user-messages',
      '--permission-prompt-tool',
      'stdio',
      ...(s.model === 'default' ? [] : ['--model', s.model]),
      ...(!s.effort || s.effort === 'default' ? [] : ['--effort', s.effort]),
      ...LEVELS[s.level],
      ...how,
    ]
    // CLAUDECODE marks a shell inside a session; a server started from one shouldn't pass it on.
    const env = { ...process.env }
    delete env.CLAUDECODE
    Object.assign(env, this.env)
    const child = spawn('claude', argv, { cwd: s.cwd, env, shell: IS_WINDOWS, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const resumed = how[0] === '--resume' ? how[1] : undefined
    const p: Proc = {
      child,
      buf: '',
      err: '',
      unread: new Map(),
      costBase: s.costUsd ?? 0,
      restored: resumed ? restoredCost(s.cwd, resumed, this.env.CLAUDE_CONFIG_DIR) : 0,
      gotInit: false, interrupted: false, stopping: false }
    this.procs.set(s.id, p)
    child.stdin!.on('error', () => {})
    child.stdout!.on('data', (chunk: Buffer) => {
      p.buf += chunk.toString('utf8')
      let i: number
      while ((i = p.buf.indexOf('\n')) >= 0) {
        const line = p.buf.slice(0, i).trim()
        p.buf = p.buf.slice(i + 1)
        if (!line) continue
        try {
          this.handle(s, p, JSON.parse(line) as Record<string, unknown>)
        } catch (e) {
          // One bad line never takes the server down.
          p.err = (p.err + `\n[agent-city] ${(e as Error).message}`).slice(-8000)
        }
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      p.err = (p.err + chunk.toString('utf8')).slice(-8000)
    })
    let isOver = false
    const finish = (code: number | null, failure?: string) => {
      if (isOver) return
      isOver = true
      if (p.liveTimer) clearTimeout(p.liveTimer)
      if (p.killTimer) clearTimeout(p.killTimer)
      if (this.procs.get(s.id) === p) this.procs.delete(s.id)
      this.dropHeld(s.id)
      delete s.live
      delete s.queued
      s.lastAt = Date.now()
      if (s.status === 'ended') return this.onChange(s, 'exit')
      // Taken down with the server: it wakes on its next message.
      if (p.stopping) {
        s.status = 'asleep'
        return this.onChange(s, 'asleep')
      }
      if (failure || (!p.gotInit && code !== 0)) {
        s.status = 'failed'
        s.error = failure ?? (tail(p.err) || `claude exited with code ${code}`)
      } else {
        s.status = 'asleep'
        if (code !== 0) s.error = tail(p.err) || `claude exited with code ${code}`
      }
      this.onChange(s, s.status)
    }
    child.on('error', e => finish(null, `Could not start claude: ${e.message}`))
    child.on('close', code => finish(code))
  }

  private line(p: Proc, obj: unknown): boolean {
    const stdin = p.child.stdin
    if (!stdin || stdin.destroyed || stdin.writableEnded) return false
    stdin.write(JSON.stringify(obj) + '\n')
    return true
  }

  private write(s: AppSession, text: string) {
    const p = this.procs.get(s.id)
    if (!p) throw new Error('This session has no process')
    const uuid = randomUUID()
    const busy = s.status === 'working' || p.unread.size > 0
    if (!this.line(p, { type: 'user', uuid, session_id: '', parent_tool_use_id: null, message: { role: 'user', content: text } })) {
      throw new Error('This session is not taking messages')
    }
    p.unread.set(uuid, busy)
    if (busy) s.queued = (s.queued ?? 0) + 1
    if (s.status === 'idle') s.status = 'working'
  }

  private handle(s: AppSession, p: Proc, m: Record<string, unknown>) {
    const sid = str(m.session_id)
    if (sid && sid !== s.sessionId) {
      s.sessionId = sid
      this.onChange(s, 'session')
    }
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          p.gotInit = true
          if (s.status === 'starting' || s.status === 'idle') {
            s.status = 'working'
            this.onChange(s, 'status')
          }
        }
        return
      case 'user': {
        // Our own message, taken in by Claude.
        const uuid = str(m.uuid)
        if (m.isReplay !== true || !p.unread.has(uuid)) return
        const wasQueued = p.unread.get(uuid)
        p.unread.delete(uuid)
        if (s.status === 'starting' || s.status === 'idle') s.status = 'working'
        if (wasQueued && s.queued) {
          s.queued -= 1
          if (!s.queued) delete s.queued
        }
        this.onChange(s, 'queued')
        return
      }
      case 'stream_event': {
        if (m.parent_tool_use_id) return
        const ev = m.event as Record<string, unknown> | undefined
        const delta = ev?.delta as Record<string, unknown> | undefined
        if (ev?.type !== 'content_block_delta' || delta?.type !== 'text_delta') return
        s.live = (s.live ?? '') + str(delta.text)
        if (!p.liveTimer) {
          p.liveTimer = setTimeout(() => {
            p.liveTimer = undefined
            this.onChange(s, 'live')
          }, LIVE_EVERY_MS)
        }
        return
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return
        const content = (m.message as Record<string, unknown> | undefined)?.content
        const hasText = Array.isArray(content) && content.some(c => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text')
        if (hasText || s.live) {
          if (p.liveTimer) clearTimeout(p.liveTimer)
          p.liveTimer = undefined
          delete s.live
          s.lastAt = Date.now()
          this.onChange(s, 'message')
        }
        return
      }
      case 'result': {
        if (typeof m.total_cost_usd === 'number') s.costUsd = p.costBase + Math.max(0, m.total_cost_usd - p.restored)
        if (m.modelUsage && typeof m.modelUsage === 'object') {
          s.usedModels = [...new Set([...(s.usedModels ?? []), ...Object.keys(m.modelUsage)])]
        }
        if (m.is_error === true && !p.interrupted) {
          const errors = Array.isArray(m.errors) ? m.errors.filter(e => typeof e === 'string').join('\n') : ''
          s.error = oneLine(str(m.result) || errors || `The turn ended with ${str(m.subtype) || 'an error'}`, 2000)
        } else if (m.is_error !== true) {
          delete s.error
        }
        // An interrupted turn asks nothing any more.
        if (p.interrupted) this.dropHeld(s.id)
        p.interrupted = false
        if (p.liveTimer) clearTimeout(p.liveTimer)
        p.liveTimer = undefined
        delete s.live
        s.lastAt = Date.now()
        // A message written after the turn took its last one starts the next turn.
        if (s.status !== 'ended') s.status = p.unread.size ? 'working' : 'idle'
        this.onChange(s, 'result')
        return
      }
      case 'control_request': {
        const requestId = str(m.request_id)
        const req = (m.request ?? {}) as Record<string, unknown>
        if (req.subtype !== 'can_use_tool') {
          // Nothing else is asked of a host here; an answer keeps Claude from waiting on it.
          this.line(p, { type: 'control_response', response: { subtype: 'error', request_id: requestId, error: `Agent City does not handle ${str(req.subtype) || 'this request'}` } })
          return
        }
        this.hold(s, p, requestId, req)
        return
      }
      case 'control_cancel_request': {
        // The PermissionRequest hook (or something else) decided first.
        const id = 'app:' + str(m.request_id)
        if (this.held.delete(id)) this.onChange(s, 'pending')
        return
      }
    }
  }

  private hold(s: AppSession, p: Proc, requestId: string, req: Record<string, unknown>) {
    const tool = str(req.tool_name) || 'tool'
    const toolInput = req.input && typeof req.input === 'object' ? (req.input as Record<string, unknown>) : {}
    const kind: Pending['kind'] = tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'permission'
    if (s.level === 'read' && kind === 'permission') {
      this.line(p, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'deny', message: READ_ONLY } } })
      return
    }
    const now = Date.now()
    const pending: Pending = {
      id: 'app:' + requestId,
      session: s.sessionId ?? '',
      kind,
      tool,
      summary: summarize(tool, toolInput),
      input: trimInput(toolInput),
      at: now,
      // No deadline: the session waits for the page.
      expiresAt: 0,
    }
    if (typeof req.agent_id === 'string') pending.agentId = req.agent_id
    if (kind === 'question') {
      pending.questions = questionsOf(toolInput)
      const first = pending.questions?.[0]?.question
      if (first) pending.summary = oneLine(first)
      delete pending.input.questions
    }
    if (kind === 'plan') {
      pending.plan = str(toolInput.plan)
      const title = pending.plan.split('\n').find(l => l.trim())
      if (title) pending.summary = oneLine(title.replace(/^#+\s*/, ''))
      delete pending.input.plan
    }
    this.held.set(pending.id, { pending, toolInput, requestId, owner: s.id })
    s.lastAt = now
    this.onChange(s, 'pending')
  }

  private dropHeld(owner: string) {
    for (const [id, h] of this.held) if (h.owner === owner) this.held.delete(id)
  }

  private kill(p: Proc) {
    if (p.child.exitCode !== null || p.child.signalCode !== null) return
    if (IS_WINDOWS && p.child.pid) {
      // With shell: true the pid is cmd.exe's; /T takes claude and its tools with it.
      spawnSync('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      p.child.kill('SIGTERM')
    }
  }
}
