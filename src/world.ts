import { existsSync } from 'node:fs'

import { AGENT_COLORS, BURBS, BURB_ORDER, districtFor } from './city.ts'
import type { Agent, Burb, District, Place, Session, World } from './types.ts'

// Turns Claude Code hook events, from any number of sessions, into one world.

export type HookEvent = Record<string, unknown> & {
  hook_event_name: string
  session_id: string
  cwd?: string
  agent_id?: string
  agent_type?: string
}

export type LogLine = { at: number; color: string; who: string; text: string }

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

function activityFor(tool: string, input: Record<string, unknown>): string {
  const file = str(input.file_path) || str(input.notebook_path)
  if (file) return `${tool} ${base(file)}`
  if (input.command) return short(str(input.command))
  if (input.pattern) return `${tool} ${short(str(input.pattern), 30)}`
  if (input.url) return `${tool} ${short(str(input.url).replace(/^https?:\/\//, ''), 36)}`
  if (input.query) return `${tool} ${short(str(input.query), 36)}`
  if (input.description) return `${tool}: ${short(str(input.description), 36)}`
  return tool.replace(/^mcp__[^_]+__/, '')
}

// A shell command without its quoted strings and heredoc bodies, so a commit
// message that mentions "git push" reads as text, not as a push.
function shellCode(command: string): string {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, '<<heredoc')
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
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
        startedAt: now,
        updatedAt: now,
      }
      w.sessions.push(s)
    }
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

  apply(ev: HookEvent, now: number) {
    if (!ev || typeof ev.session_id !== 'string' || typeof ev.hook_event_name !== 'string') return
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
          if (kind === 'push') this.toasts.push(`🚀 ${a.name} pushed${repo ? ` ${repo}` : ''}`)
        }
        break
      }
      case 'SubagentStart': {
        const a = this.agent(ev, s, now)
        a.status = 'working'
        break
      }
      case 'SubagentStop': {
        const a = this.agent(ev, s, now)
        const burb = this.homeOf(s, now)
        a.status = 'done'
        a.inFlight = 0
        // Manhattan's finished agents rest in Central Park; a borough's in its square.
        this.goTo(a, burb ? 'hall' : 'plaza', burb)
        a.activity = 'Finished'
        a.updatedAt = now
        w.asks = w.asks.filter(q => q.agentId !== a.id)
        this.say(a, 'finished', now)
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
    const live = new Set(w.sessions.map(s => s.id))
    // Sessions quiet for six hours have closed without saying so.
    w.sessions = w.sessions.filter(s => now - s.updatedAt < 6 * 3600_000)
    w.agents = w.agents
      // An ended session's agents fade for a few seconds, then leave.
      .filter(a => live.has(a.session) || now - a.updatedAt < 8_000)
      .filter(a => a.isMain || a.status !== 'done' || now - a.updatedAt < 600_000)
      .slice(-60)
    for (const a of w.agents) {
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
