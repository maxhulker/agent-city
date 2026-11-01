import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import { AGENT_COLORS, BURBS, BURB_ORDER, districtFor } from './city.ts'
import type { Agent, Burb, District, Message, Place, Session, World } from './types.ts'

// Turns Claude Code hook events, from any number of sessions, into one world.

export type HookEvent = Record<string, unknown> & {
  hook_event_name: string
  session_id: string
  cwd?: string
  agent_id?: string
  agent_type?: string
}

export type LogLine = { at: number; color: string; who: string; text: string }

// Subway lines a session can be: one letter or number each, in a circle.
const BULLETS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'L', 'M', 'N', 'Q', 'R', 'W', 'Z', '1', '2', '3', '4', '5', '6', '7']

// One line of the news ticker.
export type TickerItem = { at: number; bullet: string; color: string; who: string; text: string }

const LEAD_COLORS = ['#fbbf24', '#f472b6', '#38bdf8', '#a3e635', '#fb7185', '#c084fc', '#2dd4bf', '#fdba74']

const CONFLICT =
  /CONFLICT \(|Automatic merge failed|Merge conflict in|could not apply|needs merge|You have unmerged paths|Unmerged paths:|fix conflicts and then/i
const RESOLVED =
  /\bgit\s+(commit|merge\s+--(continue|abort)|rebase\s+--(continue|abort|skip)|cherry-pick\s+--(continue|abort)|reset\s+--(hard|merge))\b/
const ASKS = /^(AskUserQuestion|ExitPlanMode)$/
// git commit / git push, with any -C <dir> or -c key=value options before the verb.
const COMMIT = /\bgit(?:\s+-[cC]\s+\S+)*\s+commit\b/
const PUSH = /\bgit(?:\s+-[cC]\s+\S+)*\s+push\b/
const SPAWNS = /^(Agent|Task)$/
// The first directory a shell command works in: a leading cd, or git -C.
const CD = /(?:^|&&|;|\|\|)\s*(?:cd|Set-Location|pushd)\s+(?:-(?:Literal)?Path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/
const GIT_C = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/

export function emptyWorld(): World {
  return { home: '', homeRoot: '', repos: [], sessions: [], agents: [], conflicts: [], asks: [], flushedAt: 0 }
}

// ---- paths and repositories -----------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function short(text: string, n = 48): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

export function base(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// Forward slashes, no trailing one, Git Bash's /c/ as C:/.
export function norm(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/([a-zA-Z])\//, (_, d: string) => `${d.toUpperCase()}:/`)
    .replace(/\/+$/, '')
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function isAbsolute(path: string): boolean {
  return /^([a-zA-Z]:\/|\/)/.test(path)
}

// Directory → the repository root above it, or null for none.
const roots = new Map<string, string | null>()

export function forgetRoots() {
  roots.clear()
}

export function repoRoot(path: string): string | null {
  let dir = norm(path)
  const seen: string[] = []
  let found: string | null = null
  for (let i = 0; i < 40 && dir; i++) {
    const key = dir.toLowerCase()
    const known = roots.get(key)
    if (known !== undefined) {
      found = known
      break
    }
    seen.push(key)
    if (existsSync(`${dir}/.git`)) {
      found = dir
      break
    }
    const up = dir.replace(/\/[^/]*$/, '')
    if (up === dir) break
    dir = up
  }
  for (const key of seen) roots.set(key, found)
  return found
}

// The path a tool call works on, when it names one.
function pathOf(tool: string, input: Record<string, unknown>, cwd: string): string | undefined {
  const named = str(input.file_path) || str(input.notebook_path) || str(input.path)
  const command = str(input.command)
  let path = named
  if (!path && (tool === 'Bash' || tool === 'PowerShell') && command) {
    const m = command.match(CD) ?? command.match(GIT_C)
    path = m ? (m[1] ?? m[2] ?? m[3] ?? '') : cwd
  }
  if (!path || path.startsWith('~')) return undefined
  const p = norm(path)
  return isAbsolute(p) ? p : `${norm(cwd)}/${p}`
}

// An MCP tool by its own name: mcp__Claude_Browser__browser_batch → browser batch.
function toolName(tool: string): string {
  return tool.startsWith('mcp__') ? tool.replace(/^mcp__.+?__/, '').replace(/_/g, ' ') : tool
}

function activityFor(name: string, input: Record<string, unknown>): string {
  const tool = toolName(name)
  const file = str(input.file_path) || str(input.notebook_path)
  if (file) return `${tool} ${base(file)}`
  if (input.command) return short(str(input.command))
  if (input.pattern) return `${tool} ${short(str(input.pattern), 30)}`
  if (input.url) return `${tool} ${short(str(input.url).replace(/^https?:\/\//, ''), 36)}`
  if (input.query) return `${tool} ${short(str(input.query), 36)}`
  if (input.description) return `${tool}: ${short(str(input.description), 36)}`
  return tool
}

// A shell command without its quoted strings and heredoc bodies, so a commit
// message that mentions "git push" reads as text, not as a push.
function shellCode(command: string): string {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, '<<heredoc')
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
}

// The ticker's verb phrase for a tool call, if it earns one.
function tickerFor(tool: string, input: Record<string, unknown>): string | undefined {
  const file = str(input.file_path) || str(input.notebook_path)
  const url = str(input.url)
  const host = () => {
    try {
      return new URL(url).host
    } catch {
      return short(url.replace(/^https?:\/\//, ''), 30)
    }
  }
  if (tool === 'Read') return `READ ${base(file)}`
  if (tool === 'Grep' || tool === 'Glob') return `SEARCHED ${short(str(input.pattern), 30)}`
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return `EDITED ${base(file)}`
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = str(input.command)
    const code = shellCode(command)
    // Commits and pushes are announced when they go through, not when they start.
    if (PUSH.test(code) || COMMIT.test(code)) return undefined
    return `RAN ${short(command, 30)}`
  }
  if (tool === 'WebFetch') return url ? `BROWSED ${host()}` : 'BROWSED THE WEB'
  if (tool === 'WebSearch') return 'SEARCHED THE WEB'
  if (/^mcp__.*(browser|chrome|playwright|puppeteer)/i.test(tool)) return url ? `BROWSED ${host()}` : 'BROWSED THE WEB'
  if (SPAWNS.test(tool)) return `DISPATCHED A SUBAGENT: ${short(str(input.description) || str(input.subagent_type) || 'Subagent', 40)}`
  if (tool === 'SendMessage') return 'SENT A MESSAGE'
  if (ASKS.test(tool)) return 'NEEDS YOU'
  return undefined
}

function placeOf(a: Agent): Place {
  return a.burb ? { at: a.at, burb: a.burb } : { at: a.at }
}

function resultText(value: unknown): string {
  try {
    return (typeof value === 'string' ? value : JSON.stringify(value ?? '')).replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}

// ---- the city -------------------------------------------------------------

const ACTIVITY_WINDOW = 10 * 60_000

// Messages for a session: how long one may be, how many may wait, how long a
// delivered one stays listed.
export const MESSAGE_MAX = 4000
const MESSAGES_QUEUED = 10
const MESSAGE_KEPT = 10 * 60_000

// What a hook reply carries: Claude reads it as a note from the person.
function frame(m: Message): string {
  return `Message from the user, sent through Agent City (a dashboard on their machine): ${m.text}`
}

// A hook's answer to Claude Code: {} decides nothing.
export type HookReply = Record<string, unknown>

export class City {
  world: World
  isDirty = true
  toasts: string[] = []
  log: LogLine[] = []
  // Per session, descriptions of Agent calls not yet matched to a SubagentStart.
  private spawns = new Map<string, string[]>()
  // Tool-call times per repository root (lower-cased), for the last ten minutes. Not saved.
  private activity = new Map<string, number[]>()
  private activityRoots = new Map<string, string>()
  private lastFollow = 0
  // The last 40 ticker items, oldest first. Not saved.
  ticker: TickerItem[] = []

  private touch(root: string | undefined, now: number) {
    if (!root) return
    const key = root.toLowerCase()
    const hits = (this.activity.get(key) ?? []).filter(t => now - t < ACTIVITY_WINDOW)
    hits.push(now)
    this.activity.set(key, hits)
    this.activityRoots.set(key, root)
  }

  constructor(world?: World) {
    this.world = world ?? emptyWorld()
  }

  private say(a: Agent | undefined, text: string, now: number) {
    this.log.push({ at: now, color: a?.color ?? '#94a3b8', who: a?.name ?? 'City', text })
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60)
  }

  // Adds a ticker line; a repeat of the last one within ten seconds is dropped.
  private tick(a: Agent | undefined, text: string, now: number) {
    const s = a && this.world.sessions.find(one => one.id === a.session)
    this.announce(a?.name ?? 'CITY HALL', text, s?.bullet ?? '★', a?.color ?? '#94a3b8', now)
  }

  // A ticker line from anyone, the person included.
  announce(who: string, text: string, bullet: string, color: string, now: number) {
    const t = text.toUpperCase()
    if (this.ticker.some(i => i.who === who && i.text === t && now - i.at < 10_000)) return
    this.ticker.push({ at: now, bullet, color, who, text: t })
    if (this.ticker.length > 40) this.ticker.splice(0, this.ticker.length - 40)
    this.isDirty = true
  }

  // ---- messages to sessions ------------------------------------------------

  // Queues text for a session's lead; it goes out with the next hook reply that can carry it.
  queueMessage(sessionId: unknown, text: unknown, now: number): { id: string } | { error: string } {
    const s = this.world.sessions.find(one => one.id === sessionId)
    if (!s) return { error: 'No such session' }
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return { error: 'The message is empty' }
    if (body.length > MESSAGE_MAX) return { error: `The message is longer than ${MESSAGE_MAX} characters` }
    s.messages ??= []
    if (s.messages.filter(m => m.status === 'queued').length >= MESSAGES_QUEUED) {
      return { error: `${MESSAGES_QUEUED} messages are already waiting for this session` }
    }
    const m: Message = { id: randomUUID(), text: body, at: now, status: 'queued' }
    s.messages.push(m)
    this.isDirty = true
    return { id: m.id }
  }

  // Takes back a message not yet delivered.
  cancelMessage(sessionId: unknown, id: unknown): boolean {
    const s = this.world.sessions.find(one => one.id === sessionId)
    const m = s?.messages?.find(one => one.id === id && one.status === 'queued')
    if (!s || !m) return false
    s.messages = s.messages!.filter(one => one !== m)
    this.isDirty = true
    return true
  }

  // The reply that hands a lead its queued messages, when this event can carry them.
  private deliver(ev: HookEvent, s: Session, now: number): HookReply {
    const queued = (s.messages ?? []).filter(m => m.status === 'queued')
    // Subagents' events would hand the note to the wrong reader.
    if (!queued.length || ev.agent_id) return {}
    const event = ev.hook_event_name
    let via: Message['via']
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') via = 'tool'
    else if (event === 'UserPromptSubmit') via = 'prompt'
    // stop_hook_active: Claude is already carrying on because of a Stop hook; blocking again could loop.
    else if (event === 'Stop' && ev.stop_hook_active !== true) via = 'stop'
    else return {}
    const text = queued.map(frame).join('\n\n')
    const lead = this.lead(s, now)
    for (const m of queued) {
      m.status = 'delivered'
      m.deliveredAt = now
      m.via = via
      this.announce('YOU', `TO ${lead.name}: ${short(m.text, 40)}`, s.bullet ?? '★', s.color, now)
    }
    this.say(lead, `got ${queued.length === 1 ? 'your message' : `${queued.length} messages from you`}`, now)
    this.isDirty = true
    if (via === 'stop') {
      // It carries on instead of stopping.
      lead.status = 'working'
      lead.activity = 'Reading your message'
      return { decision: 'block', reason: text }
    }
    return { hookSpecificOutput: { hookEventName: event, additionalContext: text } }
  }

  private ride(from: Place, to: Place, color: string, kind: 'report' | 'message', now: number) {
    const w = this.world
    w.rides = [...(w.rides ?? []), { at: now, from, to, color, kind }].slice(-12)
  }

  // The first line not yet taken by a session; all taken, it wraps around.
  private bulletFor(): string {
    const used = this.world.sessions.map(s => s.bullet)
    return BULLETS.find(b => !used.includes(b)) ?? BULLETS[this.world.sessions.length % BULLETS.length]!
  }

  // The borough of the repository at root, moving it in if it is new.
  private burbFor(root: string | null, now: number): Burb | undefined {
    const w = this.world
    if (!root) return undefined
    if (!w.homeRoot) {
      w.homeRoot = root
      w.home = base(root)
    }
    if (same(root, w.homeRoot)) return undefined
    let repo = w.repos.find(r => same(r.root, root))
    if (!repo) {
      let burb = BURB_ORDER.find(b => !w.repos.some(r => r.burb === b))
      if (!burb) {
        // Every borough is taken: the one used longest ago moves out.
        const oldest = [...w.repos].sort((a, b) => a.lastSeen - b.lastSeen)[0]!
        burb = oldest.burb
        w.repos = w.repos.filter(r => r !== oldest)
      }
      repo = { root, name: base(root), burb, lastSeen: now }
      w.repos.push(repo)
      this.toasts.push(`${repo.name} moved into ${BURBS[burb].name}`)
      this.say(undefined, `${repo.name} moved into ${BURBS[burb].name}`, now)
      this.tick(undefined, `${repo.name} moved into ${BURBS[burb].name}`, now)
    }
    repo.lastSeen = now
    return repo.burb
  }

  private session(ev: HookEvent, now: number): Session {
    const w = this.world
    let s = w.sessions.find(one => one.id === ev.session_id)
    if (!s) {
      const cwd = norm(str(ev.cwd) || '.')
      const root = repoRoot(cwd) ?? cwd
      const twins = w.sessions.filter(one => same(one.root, root)).length
      s = {
        id: ev.session_id,
        name: twins ? `${base(root)} #${twins + 1}` : base(root),
        cwd,
        root,
        color: LEAD_COLORS[w.sessions.length % LEAD_COLORS.length]!,
        bullet: this.bulletFor(),
        startedAt: now,
        updatedAt: now,
      }
      w.sessions.push(s)
    }
    // Sessions saved before bullets existed get one now.
    if (!s.bullet) s.bullet = this.bulletFor()
    s.updatedAt = now
    return s
  }

  private homeOf(s: Session, now: number): Burb | undefined {
    return this.burbFor(s.root, now)
  }

  private lead(s: Session, now: number): Agent {
    const id = `lead:${s.id}`
    let a = this.world.agents.find(one => one.id === id)
    if (!a) {
      const burb = this.homeOf(s, now)
      a = {
        id,
        session: s.id,
        name: s.name,
        kind: 'session',
        color: s.color,
        isMain: true,
        status: 'idle',
        at: 'hall',
        ...(burb ? { burb } : {}),
        shown: burb ? { at: 'hall', burb } : { at: 'hall' },
        activity: 'Session started',
        tools: 0,
        inFlight: 0,
        startedAt: now,
        updatedAt: now,
      }
      this.world.agents.push(a)
      this.say(a, 'arrived in the city', now)
    }
    return a
  }

  // The agent an event comes from: a subagent when it carries agent_id.
  private agent(ev: HookEvent, s: Session, now: number): Agent {
    const lead = this.lead(s, now)
    if (!ev.agent_id) return lead
    const id = `${s.id}:${ev.agent_id}`
    let a = this.world.agents.find(one => one.id === id)
    if (!a) {
      const pending = this.spawns.get(s.id) ?? []
      const subs = this.world.agents.filter(one => !one.isMain).length
      a = {
        id,
        session: s.id,
        name: short(pending.shift() ?? str(ev.agent_type) ?? 'Subagent', 28) || 'Subagent',
        kind: str(ev.agent_type) || 'subagent',
        color: AGENT_COLORS[subs % AGENT_COLORS.length]!,
        isMain: false,
        status: 'working',
        at: 'relay',
        ...(lead.burb ? { burb: lead.burb } : {}),
        shown: lead.burb ? { at: 'relay', burb: lead.burb } : { at: 'relay' },
        activity: 'Just arrived',
        tools: 0,
        inFlight: 0,
        startedAt: now,
        updatedAt: now,
      }
      this.world.agents.push(a)
      this.say(a, `started for ${s.name}`, now)
    }
    return a
  }

  private goTo(a: Agent, at: District, burb: Burb | undefined) {
    a.at = at
    if (burb) a.burb = burb
    else delete a.burb
  }

  // Applies one hook event; the answer goes back to Claude Code as the hook's reply.
  apply(ev: HookEvent, now: number): HookReply {
    if (!ev || typeof ev.session_id !== 'string' || typeof ev.hook_event_name !== 'string') return {}
    const w = this.world
    const s = this.session(ev, now)
    const input = (ev.tool_input ?? {}) as Record<string, unknown>
    const tool = str(ev.tool_name)
    this.isDirty = true

    switch (ev.hook_event_name) {
      case 'SessionStart': {
        const lead = this.lead(s, now)
        lead.status = 'idle'
        lead.activity = str(ev.source) === 'resume' ? 'Resumed' : 'Session started'
        break
      }
      case 'UserPromptSubmit': {
        const lead = this.lead(s, now)
        const title = str(ev.session_title)
        if (title) lead.name = short(title, 26)
        lead.status = 'working'
        this.goTo(lead, 'hall', this.homeOf(s, now))
        lead.activity = `Thinking: ${short(str(ev.prompt), 40)}`
        lead.updatedAt = now
        this.say(lead, 'got a new prompt', now)
        break
      }
      case 'PreToolUse': {
        const a = this.agent(ev, s, now)
        const cwd = str(ev.cwd) || s.cwd
        const path = pathOf(tool, input, cwd)
        let burb = a.burb
        let worked: string | undefined
        if (path) {
          worked = repoRoot(path) ?? s.root
          burb = this.burbFor(worked, now)
        } else {
          worked = a.burb ? w.repos.find(r => r.burb === a.burb)?.root : w.homeRoot
        }
        this.touch(worked, now)
        const before = placeOf(a)
        const isAsk = ASKS.test(tool)
        this.goTo(a, isAsk ? 'hall' : districtFor(tool, str(input.command)), isAsk ? this.homeOf(s, now) : burb)
        a.status = isAsk ? 'waiting' : 'working'
        a.activity = activityFor(tool, input)
        a.tools += 1
        a.inFlight += 1
        a.updatedAt = now
        if (isAsk) {
          w.asks.push({ id: str(ev.tool_use_id), agentId: a.id, label: tool === 'ExitPlanMode' ? 'Plan approval' : 'Question', at: now })
          this.toasts.push(`${a.name} needs you`)
        }
        const news = tickerFor(tool, input)
        if (news) this.tick(a, news, now)
        if (tool === 'SendMessage') {
          const to = str(input.to).toLowerCase()
          const peer = to
            ? w.agents.find(
                one => one !== a && one.session === s.id && (one.name.toLowerCase() === to || one.id.toLowerCase().endsWith(to)),
              )
            : undefined
          this.ride(before, peer ? placeOf(peer) : a.burb ? { at: 'relay', burb: a.burb } : { at: 'relay' }, a.color, 'message', now)
        }
        if (SPAWNS.test(tool)) {
          const list = this.spawns.get(s.id) ?? []
          list.push(str(input.description) || str(input.subagent_type) || 'Subagent')
          this.spawns.set(s.id, list.slice(-10))
        }
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const a = this.agent(ev, s, now)
        a.inFlight = Math.max(0, a.inFlight - 1)
        a.updatedAt = now
        w.asks = w.asks.filter(q => q.id !== str(ev.tool_use_id) && q.id !== `perm:${a.id}`)
        if (a.status === 'waiting') a.status = 'working'
        const command = str(input.command)
        const isGitish = ((tool === 'Bash' || tool === 'PowerShell') && /\b(git|gh)\b/.test(command)) || /merge|sync|rebase|pull/i.test(tool)
        if (isGitish) {
          const text = resultText(ev.tool_response ?? ev.error)
          if (CONFLICT.test(text)) {
            const files = [
              ...new Set(
                [...text.matchAll(/(?:Merge conflict in |CONFLICT \([^)]*\): (?:Merge conflict in )?)([^\s"\\]+)/g)].map(m => m[1] ?? ''),
              ),
            ].slice(0, 12)
            const where = a.burb ? w.repos.find(r => r.burb === a.burb)?.name : w.home
            w.conflicts = w.conflicts.filter(c => c.agentId !== a.id)
            w.conflicts.push({
              id: str(ev.tool_use_id) || `${a.id}:${now}`,
              agentId: a.id,
              agentName: where ? `${a.name} in ${where}` : a.name,
              files,
              command: short(command || tool, 60),
              at: now,
            })
            a.activity = `Hit a merge conflict${files.length ? ` in ${files.length} file${files.length === 1 ? '' : 's'}` : ''}`
            this.toasts.push(`${a.name} hit a merge conflict${where ? ` in ${where}` : ''}`)
            this.say(a, `hit a merge conflict${where ? ` in ${where}` : ''}`, now)
            this.tick(a, `⚠ hit a merge conflict${where ? ` in ${where}` : ''}`, now)
          } else if (RESOLVED.test(command) && ev.hook_event_name === 'PostToolUse') {
            w.conflicts = w.conflicts.filter(c => c.agentId !== a.id)
          }
        }
        // A commit or push that went through: liftoff. A push outranks a commit in one command.
        const code = shellCode(command)
        const kind = PUSH.test(code) ? 'push' : COMMIT.test(code) ? 'commit' : undefined
        if (kind && ev.hook_event_name === 'PostToolUse' && (tool === 'Bash' || tool === 'PowerShell')) {
          const repo = (a.burb ? w.repos.find(r => r.burb === a.burb)?.name : w.home) ?? ''
          w.launch = { kind, at: now, who: a.name, repo }
          this.say(a, `${kind === 'push' ? 'pushed' : 'committed'}${repo ? ` in ${repo}` : ''}`, now)
          this.tick(a, kind === 'push' ? `🚀 pushed${repo ? ` ${repo}` : ''}` : `committed${repo ? ` in ${repo}` : ''}`, now)
          if (kind === 'push') this.toasts.push(`🚀 ${a.name} pushed${repo ? ` ${repo}` : ''}`)
        }
        break
      }
      case 'SubagentStart': {
        const a = this.agent(ev, s, now)
        a.status = 'working'
        this.tick(a, 'started work', now)
        break
      }
      case 'SubagentStop': {
        const a = this.agent(ev, s, now)
        const burb = this.homeOf(s, now)
        const from = placeOf(a)
        a.status = 'done'
        a.inFlight = 0
        // Manhattan's finished agents rest in Central Park; a borough's in its square.
        this.goTo(a, burb ? 'hall' : 'plaza', burb)
        a.activity = 'Finished'
        a.updatedAt = now
        w.asks = w.asks.filter(q => q.agentId !== a.id)
        this.say(a, 'finished', now)
        this.tick(a, 'filed its report', now)
        // The report rides back to the lead.
        if (!a.isMain) this.ride(from, placeOf(this.lead(s, now)), a.color, 'report', now)
        break
      }
      case 'Stop':
      case 'StopFailure': {
        const lead = this.lead(s, now)
        lead.status = ev.hook_event_name === 'Stop' ? 'idle' : 'failed'
        lead.inFlight = 0
        this.goTo(lead, 'hall', this.homeOf(s, now))
        lead.activity = ev.hook_event_name === 'Stop' ? 'Waiting for your next message' : 'Stopped with an error'
        lead.updatedAt = now
        w.asks = w.asks.filter(q => q.agentId !== lead.id || q.id.startsWith('perm:'))
        break
      }
      case 'Notification': {
        if (str(ev.notification_type) !== 'permission_prompt') break
        const a = this.agent(ev, s, now)
        a.status = 'waiting'
        a.updatedAt = now
        const id = `perm:${a.id}`
        if (!w.asks.some(q => q.id === id)) {
          w.asks.push({ id, agentId: a.id, label: short(str(ev.message) || 'Permission needed', 60), at: now })
        }
        this.toasts.push(`${a.name} is waiting for permission`)
        this.say(a, 'is waiting for permission', now)
        this.tick(a, 'is waiting for permission', now)
        break
      }
      case 'SessionEnd': {
        for (const a of w.agents.filter(one => one.session === s.id)) {
          a.status = 'done'
          a.updatedAt = now
        }
        w.asks = w.asks.filter(q => !w.agents.some(a => a.id === q.agentId && a.session === s.id))
        w.sessions = w.sessions.filter(one => one.id !== s.id)
        this.spawns.delete(s.id)
        this.say(undefined, `${s.name} left the city`, now)
        break
      }
      default:
        this.isDirty = false
    }
    // SessionEnd has just removed the session; nothing is left to deliver to.
    return w.sessions.includes(s) ? this.deliver(ev, s, now) : {}
  }

  resolve(id?: string) {
    this.world.conflicts = id ? this.world.conflicts.filter(c => c.id !== id) : []
    this.isDirty = true
  }

  // Makes the repository at root Manhattan; the old home takes its borough.
  makeHome(root: string, now: number, pinned = true) {
    const w = this.world
    const repo = w.repos.find(r => same(r.root, root))
    if (!repo) return
    w.homePinned = pinned
    const old = { root: w.homeRoot, name: w.home }
    w.homeRoot = repo.root
    w.home = repo.name
    w.repos = w.repos.filter(r => r !== repo)
    if (old.root) w.repos.push({ root: old.root, name: old.name, burb: repo.burb, lastSeen: now })
    for (const a of w.agents) {
      if (a.burb === repo.burb) delete a.burb
      else if (!a.burb) a.burb = repo.burb
    }
    this.isDirty = true
  }

  // Ends the sessions a stopped task started: a killed session never posts its
  // SessionEnd. Matched by folder and by starting after the task did.
  endSessionsIn(cwd: string, since: number, now: number) {
    for (const s of this.world.sessions.filter(one => same(one.cwd, norm(cwd)) && one.startedAt >= since - 2_000)) {
      this.apply({ hook_event_name: 'SessionEnd', session_id: s.id }, now)
    }
  }

  // Lets the busiest repository take Manhattan again.
  autoHome() {
    this.world.homePinned = false
    this.isDirty = true
  }

  // Manhattan follows the work: the busiest borough takes over once it clearly is.
  private followWork(now: number) {
    const w = this.world
    if (w.homePinned || now - this.lastFollow < 60_000) return
    this.lastFollow = now
    const counts = new Map<string, { root: string; n: number }>()
    for (const [key, hits] of this.activity) {
      const recent = hits.filter(t => now - t < ACTIVITY_WINDOW)
      if (recent.length) this.activity.set(key, recent)
      else {
        this.activity.delete(key)
        this.activityRoots.delete(key)
      }
    }
    for (const [key, hits] of this.activity) counts.set(key, { root: this.activityRoots.get(key) ?? key, n: hits.length })
    let top: { root: string; n: number } | undefined
    for (const c of counts.values()) if (!top || c.n > top.n) top = c
    if (!top || top.n < 8 || same(top.root, w.homeRoot)) return
    if (counts.has(w.homeRoot.toLowerCase())) return
    const repo = w.repos.find(r => same(r.root, top.root))
    if (!repo) return
    this.makeHome(repo.root, now, false)
    this.toasts.push(`${repo.name} became Manhattan`)
    this.say(undefined, `${repo.name} became Manhattan`, now)
  }

  // Readies the world for a frame: who walks where, who has left.
  flush(now: number): World {
    const w = this.world
    this.followWork(now)
    for (const s of w.sessions) if (!s.bullet) s.bullet = this.bulletFor()
    w.rides = (w.rides ?? []).filter(r => now - r.at < 8_000).slice(-12)
    const live = new Set(w.sessions.map(s => s.id))
    // Sessions quiet for six hours have closed without saying so.
    w.sessions = w.sessions.filter(s => now - s.updatedAt < 6 * 3600_000)
    for (const s of w.sessions) {
      if (!s.messages) continue
      s.messages = s.messages.filter(m => m.status === 'queued' || now - (m.deliveredAt ?? m.at) < MESSAGE_KEPT)
      if (!s.messages.length) delete s.messages
    }
    w.agents = w.agents
      // An ended session's agents fade for a few seconds, then leave.
      .filter(a => live.has(a.session) || now - a.updatedAt < 8_000)
      .filter(a => a.isMain || a.status !== 'done' || now - a.updatedAt < 600_000)
      .slice(-60)
    for (const a of w.agents) {
      // Ten quiet minutes while "working" means the session went away unannounced.
      if ((a.status === 'working' || a.status === 'waiting') && now - a.updatedAt > 10 * 60_000) {
        a.status = 'idle'
        a.inFlight = 0
        a.activity = 'Quiet for a while'
      }
      const moved = a.shown.at !== a.at || a.shown.burb !== a.burb
      a.walkFrom = moved ? a.shown : undefined
      a.shown = a.burb ? { at: a.at, burb: a.burb } : { at: a.at }
    }
    w.flushedAt = now
    this.isDirty = false
    return w
  }
}

export type { Place }
