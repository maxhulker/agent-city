import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import { AGENT_COLORS, districtFor } from './city.ts'
import { BLUEPRINTS, FIREWORKS_MS, LANDMARKS, SCAFFOLD_MS, TRAIN_MS, dayOf, fullPopulation, placeAt, usd, walk } from './draw/geo.ts'
import { FIXED, applyOp, boroughSizeFor, builtOf, burbGeo, cityBuildings, connectBorough, fillBorough, findSite, generateMap, clearBuilt, isWaiting, lotsWanted, manhattanLayout, markBuilt, parseOp, waitingId } from './layout.ts'
import { sameCensus } from './census.ts'
import { devCommand, hostOf, litFor, localUrls, portOf, watchedTool } from './billboards.ts'
import type { Agent, Billboard, Burb, Census, DevHint, District, Feat, Landmark, LedgerEntry, LimitWindow, Limits, Look, Message, Place, PlanItem, Repo, Session, WorkOrder, World } from './types.ts'
import type { Kind } from './layout.ts'

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
  return { home: '', homeRoot: '', repos: [], sessions: [], agents: [], conflicts: [], asks: [], built: {}, population: 0, layout: manhattanLayout(), flushedAt: 0 }
}

// Tools that build each landmark the first time any session uses one.
const READS = /^(Read|Grep|Glob|NotebookRead)$/
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/
const SHELLS = /^(Bash|PowerShell)$/
// The districts whose landmarks must all stand before the Empire State goes up.
const DISTRICT_LANDMARKS: District[] = ['hall', 'library', 'workshop', 'foundry', 'observatory', 'relay', 'harbor', 'plaza']

// One of the first district's quests, as the Blueprints card and the
// catalogue show it: done (with when), the suggested next, still to do, or
// locked (the Empire State, until every district stands). `opened` is when a
// landmark was first used.
export type Quest = { id: string; name: string; hint: string; state: 'done' | 'next' | 'todo' | 'locked'; at?: number; opened?: number }

// The landmarks' quests after the road, with what each is for.
const QUESTS: [Kind, string][] = [
  ['hall', 'Where your sessions think and wait for you'],
  ['library', 'Where your sessions read files'],
  ['workshop', 'Where your sessions edit files'],
  ['foundry', 'Where your sessions run commands'],
  ['observatory', 'Where your sessions search and fetch the web'],
  ['relay', 'Where subagents set off and report back'],
  ['harbor', 'Where commits ship out and pushes launch: on a shore'],
  ['plaza', 'Where finished subagents come to rest'],
  ['liberty', 'In the water; her torch lights on a push'],
]

// Act two: run the city (docs/onboarding.md), once it stands. A checklist
// with hints that gates nothing.
const FEATS: [Feat, string, string][] = [
  ['answer', 'Answer at City Hall', 'Approve a permission or answer a question from the page'],
  ['telegram', 'Send a telegram', "Message a running session from its card"],
  ['worksite', 'Open a work site', 'Start a task from the New task form'],
  ['zoning', 'File a zoning plan', 'Approve a plan from plan mode: it is posted at City Hall'],
  ['borough', 'Lay out a borough', 'The Borough tool: a home for another repository'],
  ['train', 'Last train home', 'Send a session home from its card'],
]
export type ActTwo = { id: Feat; name: string; hint: string; state: 'done' | 'todo'; at?: number }

// ---- paths and repositories -----------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Two task ids for the same task: equal, or the same number ("task-003", "3").
function sameTask(a: string, b: string): boolean {
  if (a === b) return true
  const n = (x: string) => /\d+/.exec(x)?.[0]?.replace(/^0+/, '')
  return !!n(a) && n(a) === n(b)
}

// A long text cut to n characters, marked where it was cut.
function cut(text: string, n: number): string {
  return text.length > n ? text.slice(0, n - 1) + '…' : text
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
// Billboards (src/billboards.ts): a spotted address is tried for a few
// minutes; one that stands comes down after this many closed probes in a
// row; one dark this long is forgotten; at most this many are kept.
const SPOT_MS = 3 * 60_000
const HINT_MS = 2 * 60_000
const BILLBOARD_MISSES = 3
const BILLBOARD_FORGET_MS = 24 * 60 * 60_000
const BILLBOARDS_MAX = 40

// Departures, all through Grand Central: an idle agent that has heard nothing
// for this long boards the train home; a finished subagent rests this long
// after its report has arrived; a borough nobody has worked in for this long
// packs up; above the cap the longest-idle leave first, whatever the timers say.
export const IDLE_LEAVE = 30 * 60_000
export const REST_LEAVE = 2 * 60_000
export const BURB_LEAVE = 60 * 60_000
export const AGENT_CAP = 24
export { TRAIN_MS, SCAFFOLD_MS, FIREWORKS_MS }
// An agent's walk to the station lasts this long at most (the SVG walk is capped at 4.5 s).
const BOARDING_MS = 5_000
// A walk is carried in the frames this long after it started, which outlasts
// the longest one.
export const WALK_MS = 5_000
// An arriving train stands at the platform this long before it leaves empty.
const DWELL_MS = 4_000
// Sessions quiet for this long have closed without saying so (a backstop).
const SESSION_LEAVE = 6 * 3600_000
const STATION: Place = { at: 'relay' }

// Messages for a session: how long one may be, how many may wait, how long a
// delivered one stays listed.
export const MESSAGE_MAX = 4000
const MESSAGES_QUEUED = 10
const MESSAGE_KEPT = 10 * 60_000

// The Treasury's ledger keeps the accounts of this many sessions (the ones
// that spent last), and the page is sent the costliest of them.
const LEDGER_MAX = 200
const LEDGER_SHOWN = 100
// Sessions that have left whose conversations the city can still find.
const PAST_MAX = 200

// What a hook reply carries: Claude reads it as a note from the person.
function frame(m: Message): string {
  return `Message from the user, sent through Crosswalk (a dashboard on their machine): ${m.text}`
}

// A hook's answer to Claude Code: {} decides nothing.
export type HookReply = Record<string, unknown>

export class City {
  world: World
  isDirty = true
  toasts: string[] = []
  log: LogLine[] = []
  // Per session, the work orders of Agent calls not yet matched to a SubagentStart.
  private spawns = new Map<string, WorkOrder[]>()
  // Tool-call times per repository root (lower-cased), for the last ten minutes. Not saved.
  private activity = new Map<string, number[]>()
  private activityRoots = new Map<string, string>()
  private lastFollow = 0
  // The last 40 ticker items, oldest first. Not saved.
  ticker: TickerItem[] = []
  // Ports that are never a session's server (Crosswalk's own): no billboard.
  ignorePorts = new Set<number>()
  // What the person picked for sessions started in the app, by Claude Code
  // session id; worn as soon as the session turns up. Not saved: the server
  // dresses them again from the app sessions it loads.
  private looks = new Map<string, Look>()

  // A session started from the page wears its name, colour and hat: on its
  // card, its bullet, its trains and its lead. One not seen yet wears them
  // when it arrives.
  dress(sessionId: string, look: Look) {
    this.looks.set(sessionId, look)
    const s = this.world.sessions.find(one => one.id === sessionId)
    if (s) this.wear(s, look)
  }

  private wear(s: Session, look: Look) {
    if (look.name) s.name = look.name
    if (look.color) s.color = look.color
    if (look.hat) s.hat = look.hat
    const lead = this.world.agents.find(a => a.id === `lead:${s.id}`)
    if (lead) {
      lead.name = s.name
      lead.color = s.color
    }
    this.isDirty = true
  }

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
    const w = this.world
    const legacy = w.built
    if (legacy?.torch !== undefined) w.torch ??= legacy.torch
    w.population ??= 0
    // A city saved before layouts existed is today's Manhattan, with the
    // landmarks it had built standing and the rest still lots.
    w.layout ??= manhattanLayout(legacy ?? {})
    if (!legacy) {
      // A city saved before the game existed. Anyone who has used theirs keeps
      // it whole; only a city that never saw a session starts as bare land.
      const used = w.sessions.length || w.agents.length || w.repos.length || w.homeRoot || w.tasks?.length || w.appSessions?.length
      if (used) this.buildAll(w.flushedAt)
    }
    this.sync()
    // A city that has seen sessions already knows its landmarks: no burst of
    // "opened its doors" for them.
    w.opened ??= w.homeRoot ? { ...w.built } : {}
  }

  // The game's record of what stands, read from the buildings (and the torch).
  private sync() {
    this.world.built = builtOf(this.layout, this.world.torch)
  }

  // The layout (docs/city-builder.md); the constructor makes sure there is one.
  get layout() {
    return this.world.layout!
  }

  // ---- the onboarding game -------------------------------------------------

  // Raises a landmark the first time its kind of work is done; the Empire
  // State follows the last district, and the city is complete.
  private raise(id: Landmark, a: Agent | undefined, now: number) {
    const w = this.world
    // In a borough, the first such work by its repository's agents raises
    // the lots of that kind the person placed there (docs/city-builder.md).
    if (a?.burb) {
      for (const b of this.layout.buildings) {
        if (b.burb !== a.burb || b.kind !== id || b.built !== undefined) continue
        b.built = now
        this.layout.rev += 1
        const where = this.layout.boroughs.find(bo => bo.id === a.burb)?.name ?? a.burb
        const text = `${BLUEPRINTS[id].name} opened in ${where}`
        this.toasts.push(text)
        this.say(a, text, now)
        this.tick(a, text, now)
      }
    }
    w.built ??= {}
    // What stands for it in the city (the Statue carries the torch).
    const here = cityBuildings(this.layout, id === 'torch' ? 'liberty' : id)
    if (a) {
      // Work of a kind nothing stands for changes nothing: its agents wait at
      // the station until the person places one (docs/city-builder.md).
      if (!here.length || (id === 'torch' && !here.some(b => b.built !== undefined))) return
      // One placed and standing: its first use opens its doors.
      if (w.built[id] !== undefined) {
        this.open(id, a, now)
        return
      }
    }
    if (w.built[id] !== undefined) return
    if (id === 'torch') w.torch = now
    else markBuilt(this.layout, id, now)
    this.sync()
    // A lot risen by its own first work is open already.
    if (a) (w.opened ??= {})[id] = now
    const name = BLUEPRINTS[id].name
    const text = id === 'torch' ? `${name} is lit` : id === 'plaza' && a ? `${name} is green` : a ? `${name} opened` : `${name} went up`
    this.toasts.push(text)
    this.say(a, text, now)
    this.tick(a, text, now)
    if (id === 'empire') {
      this.toasts.push('The city is complete')
      this.tick(undefined, 'the city is complete', now)
    } else if (DISTRICT_LANDMARKS.every(d => w.built![d] !== undefined)) {
      // The old game's Empire State lot rises after the last district; a
      // laid-out city places its own.
      if (cityBuildings(this.layout, 'empire').some(b => b.built === undefined)) this.raise('empire', a, now)
    }
  }

  // The first use of a landmark the person placed: the ticker says so, and
  // the legend is learnt by watching the work.
  private open(id: Landmark, a: Agent, now: number) {
    const w = this.world
    w.opened ??= {}
    if (w.opened[id] !== undefined || id === 'torch' || id === 'empire') return
    w.opened[id] = now
    const text = `${BLUEPRINTS[id].name} opened its doors`
    this.toasts.push(text)
    this.say(a, text, now)
    this.tick(a, text, now)
  }

  // ---- the City Treasury -------------------------------------------------------

  // A cost report: `key`'s running total so far (a session's, from its status
  // line or its app process; a task turn's). Only what it adds since the last
  // report goes into the books; a total that drops (a /clear) starts again.
  spend(key: string, totalUsd: unknown, now: number, sessionId = key) {
    if (typeof totalUsd !== 'number' || !Number.isFinite(totalUsd) || totalUsd < 0) return
    const w = this.world
    const t = (w.treasury ??= { days: {}, total: 0, last: {} })
    const before = t.last[key] ?? 0
    const added = totalUsd >= before ? totalUsd - before : totalUsd
    t.last[key] = totalUsd
    const s = w.sessions.find(one => one.id === sessionId)
    const had = s?.costUsd ?? 0
    if (s) s.costUsd = had + added
    if (added <= 0) return
    const day = dayOf(now)
    t.days[day] = (t.days[day] ?? 0) + added
    t.total += added
    // The session's account. One opened for a session already here starts
    // with what it spent before there was a ledger.
    const ledger = (t.ledger ??= {})
    const e = (ledger[sessionId] ??= { name: '', root: '', color: '', usd: had, days: {}, first: s?.startedAt ?? now, last: now })
    e.usd += added
    e.days[day] = (e.days[day] ?? 0) + added
    e.last = now
    if (s) this.ledgerName(e, s)
    // The books keep two months of days, the last few hundred reports, and
    // the accounts of the few hundred sessions that spent last.
    for (const d of Object.keys(t.days).sort().slice(0, -62)) delete t.days[d]
    for (const d of Object.keys(e.days).sort().slice(0, -62)) delete e.days[d]
    const keys = Object.keys(t.last)
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete t.last[k]
    const accounts = Object.keys(ledger)
    if (accounts.length > LEDGER_MAX) for (const k of accounts.sort((a, b) => ledger[a]!.last - ledger[b]!.last).slice(0, accounts.length - LEDGER_MAX)) delete ledger[k]
    this.isDirty = true
  }

  // Who a session is, as its account remembers it: its lead's name, folder and colours.
  private ledgerName(e: LedgerEntry, s: Session) {
    e.name = this.world.agents.find(a => a.id === `lead:${s.id}`)?.name ?? s.name
    e.root = s.root
    e.color = s.color
    if (s.bullet) e.bullet = s.bullet
  }

  // What Claude Code gives a status line: the session's cost, and the plan's
  // usage limits. The reply is the line the terminal shows.
  statusLine(raw: unknown, now: number): string {
    const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const sid = str(j.session_id)
    const cost = (j.cost && typeof j.cost === 'object' ? j.cost : {}) as Record<string, unknown>
    if (sid) this.spend(sid, cost.total_cost_usd, now)
    const rl = j.rate_limits
    if (rl && typeof rl === 'object') {
      const r = rl as Record<string, Record<string, unknown> | undefined>
      const win = (x?: Record<string, unknown>): LimitWindow | undefined =>
        x && typeof x.used_percentage === 'number' && typeof x.resets_at === 'number' ? { used: x.used_percentage, resetsAt: x.resets_at * 1000 } : undefined
      const limits: Limits = { at: now }
      const five = win(r.five_hour)
      const seven = win(r.seven_day)
      const spend = win(r.spend_limit)
      if (five) limits.fiveHour = five
      if (seven) limits.sevenDay = seven
      if (spend) {
        const x = r.spend_limit!
        limits.spend = {
          ...spend,
          ...(typeof x.used_usd === 'number' ? { usedUsd: x.used_usd } : {}),
          ...(typeof x.limit_usd === 'number' ? { limitUsd: x.limit_usd } : {}),
          ...(typeof x.period === 'string' ? { period: x.period } : {}),
        }
      }
      if (five || seven || spend) {
        this.world.limits = limits
        this.isDirty = true
      }
    }
    const v = this.treasuryView(now)
    const s = this.world.sessions.find(one => one.id === sid)
    // A session the city has not seen yet shows its own report.
    const own = typeof cost.total_cost_usd === 'number' ? cost.total_cost_usd : 0
    const parts = [`🏦 ${usd(s?.costUsd ?? own)} this session`, `${usd(v.today)} today`]
    for (const l of v.limits) parts.push(`${l.name} ${Math.round(l.left)}% left`)
    return parts.join(' · ')
  }

  // The Treasury's report for the page: spend today, this week and in all, the
  // last two weeks by day, the sessions here by what they have spent, and what
  // is left of the plan's limits (a window past its reset is full again).
  treasuryView(now: number) {
    const w = this.world
    const t = w.treasury ?? { days: {}, total: 0, last: {} }
    const days: [string, number][] = []
    for (let i = 13; i >= 0; i--) {
      const d = dayOf(now - i * 86_400_000)
      days.push([d, t.days[d] ?? 0])
    }
    const lim = w.limits
    const limits: { id: string; name: string; used: number; left: number; resetsAt: number; usedUsd?: number; limitUsd?: number }[] = []
    const add = (id: string, name: string, x?: LimitWindow & { usedUsd?: number; limitUsd?: number }) => {
      if (!x) return
      const used = x.resetsAt <= now ? 0 : x.used
      limits.push({ id, name, used, left: Math.max(0, 100 - used), resetsAt: x.resetsAt, ...(x.usedUsd !== undefined ? { usedUsd: x.usedUsd } : {}), ...(x.limitUsd !== undefined ? { limitUsd: x.limitUsd } : {}) })
    }
    add('fiveHour', '5h', lim?.fiveHour)
    add('sevenDay', '7d', lim?.sevenDay)
    add('spend', lim?.spend?.period ?? 'spend', lim?.spend)
    // Every session's account, here or gone: a session here is as it is now,
    // and one here from before the ledger counts what it has spent.
    const ledger = t.ledger ?? {}
    const ids = new Set([...Object.keys(ledger), ...w.sessions.filter(s => (s.costUsd ?? 0) > 0).map(s => s.id)])
    const lastWeek = days.slice(7).map(([d]) => d)
    const sessions = [...ids].map(id => {
      const s = w.sessions.find(one => one.id === id)
      const e: LedgerEntry = { ...(ledger[id] ?? { name: '', root: '', color: '', usd: s?.costUsd ?? 0, days: {}, first: s?.startedAt ?? 0, last: s?.updatedAt ?? 0 }) }
      if (s) this.ledgerName(e, s)
      const on = (d: string) => e.days[d] ?? 0
      return {
        id,
        name: e.name,
        root: e.root,
        color: e.color,
        ...(e.bullet ? { bullet: e.bullet } : {}),
        usd: e.usd,
        today: on(days[13]![0]),
        week: lastWeek.reduce((a, d) => a + on(d), 0),
        // The last two weeks, as the card's chart has them.
        days: days.map(([d]) => on(d)),
        first: e.first,
        last: e.last,
        here: !!s,
        agents: s ? w.agents.filter(a => a.session === id).length : 0,
      }
    })
    return {
      today: days[13]![1],
      week: days.slice(7).reduce((a, [, v]) => a + v, 0),
      total: t.total,
      days,
      sessions: sessions.sort((a, b) => b.usd - a.usd).slice(0, LEDGER_SHOWN),
      count: sessions.length,
      limits,
      ...(lim ? { limitsAt: lim.at } : {}),
    }
  }

  // ---- act two: run the city -------------------------------------------------

  // The first use of one of the app's own features: recorded once, and
  // announced while act two is showing.
  achieve(feat: Feat, now: number) {
    const w = this.world
    w.feats ??= {}
    if (w.feats[feat] !== undefined) return
    w.feats[feat] = now
    this.isDirty = true
    if (w.built?.empire === undefined) return
    const name = FEATS.find(f => f[0] === feat)![1]
    this.toasts.push(`Act two: ${name}`)
    this.tick(undefined, `${name}: done`, now)
  }

  // Act two's checklist, once the city stands (its Empire State is up).
  actTwo(): ActTwo[] | undefined {
    const w = this.world
    if (w.built?.empire === undefined) return undefined
    return FEATS.map(([id, name, hint]) => {
      const at = w.feats?.[id]
      return { id, name, hint, state: at !== undefined ? 'done' : 'todo', ...(at !== undefined ? { at } : {}) }
    })
  }

  // A plan approved from the page is posted at City Hall as the zoning plan.
  fileZoningPlan(p: { session: string; agentId?: string; plan?: string; summary: string }, now: number) {
    const w = this.world
    const plan = cut(p.plan ?? '', 8000)
    const title = short((plan.split('\n').find(l => l.trim()) ?? p.summary).replace(/^#+\s*/, ''), 80) || 'A plan'
    const who = w.agents.find(a => a.id === p.agentId || a.id === `lead:${p.session}`)
    w.zoning = { title, plan, by: who?.name ?? 'a session', at: now }
    this.tick(who, `filed a zoning plan at City Hall: ${title}`, now)
    this.achieve('zoning', now)
    this.isDirty = true
  }

  // ---- site plans (handoff B3) ------------------------------------------------

  // A task the session's checklist gained; one of the same subject is the same task.
  private addTask(s: Session, id: string, subject: string) {
    if (!id || !subject) return
    const plan = (s.plan ??= [])
    if (plan.some(t => sameTask(t.id, id) || t.subject === subject)) return
    plan.push({ id, subject, state: 'todo' })
    s.plan = plan.slice(-40)
    this.isDirty = true
  }

  private setTask(s: Session, id: string, subject: string, state: PlanItem['state']) {
    const t = s.plan?.find(one => sameTask(one.id, id) || (subject && one.subject === subject))
    if (!t || t.state === state) return
    t.state = state
    this.isDirty = true
  }

  // The checklist tools: TodoWrite gives the whole list; TaskUpdate one
  // task's state; TaskCreate's reply its number ("Task #3 created").
  private planTool(s: Session, tool: string, input: Record<string, unknown>, response?: unknown) {
    if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
      s.plan = (input.todos as Record<string, unknown>[]).slice(0, 40).map((t, i) => ({
        id: `todo-${i + 1}`,
        subject: short(str(t.content) || str(t.subject), 80),
        state: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo',
      }))
      this.isDirty = true
    } else if (tool === 'TaskUpdate') {
      const id = str(input.taskId)
      if (input.status === 'deleted') s.plan = (s.plan ?? []).filter(t => !sameTask(t.id, id))
      else if (input.status === 'completed' || input.status === 'in_progress' || input.status === 'pending') {
        this.setTask(s, id, '', input.status === 'completed' ? 'done' : input.status === 'in_progress' ? 'doing' : 'todo')
      }
    } else if (tool === 'TaskCreate' && response !== undefined) {
      const id = /#(\d+)/.exec(typeof response === 'string' ? response : JSON.stringify(response))?.[1]
      if (id) this.addTask(s, id, short(str(input.subject), 80))
    }
  }

  // The first district's quests (docs/city-builder.md), in their suggested
  // order, which nothing enforces; only on a laid-out (generated) map. The
  // next one is the first not done; the Empire State waits for every district.
  quests(): Quest[] | undefined {
    if ('preset' in this.layout.map) return undefined
    const w = this.world
    const stands = (k: Kind) => cityBuildings(this.layout, k).some(b => b.built !== undefined)
    const allUp = DISTRICT_LANDMARKS.every(d => stands(d))
    const list: Omit<Quest, 'state'>[] = [
      { id: 'road', name: 'Lay a road from the station', hint: 'The Road tool: drag along a line from the station street', ...(w.firstRoad ? { at: w.firstRoad } : {}) },
      ...QUESTS.map(([k, hint]) => {
        const id = k === 'liberty' ? undefined : (k as Landmark)
        const at = stands(k) ? (cityBuildings(this.layout, k).find(b => b.built !== undefined)!.built ?? 0) : undefined
        const opened = id ? w.opened?.[id] : undefined
        return { id: k, name: k === 'liberty' ? 'Statue of Liberty' : k === 'harbor' ? 'Seaport' : BLUEPRINTS[k as Landmark].name, hint, ...(at !== undefined ? { at } : {}), ...(opened !== undefined ? { opened } : {}) }
      }),
      { id: 'zone', name: 'Zone some blocks', hint: 'The Zone tool, beside a road: the population fills them in', ...(this.layout.zoned.length ? { at: 0 } : {}) },
      { id: 'empire', name: BLUEPRINTS.empire.name, hint: 'Placeable once every district stands; it goes up with fireworks', ...(stands('empire') ? { at: w.built?.empire ?? 0 } : {}) },
    ]
    let next = false
    return list.map(q => {
      if (q.at !== undefined) return { ...q, state: 'done' as const }
      if (q.id === 'empire' && !allUp) return { ...q, state: 'locked' as const }
      if (!next) {
        next = true
        return { ...q, state: 'next' as const }
      }
      return { ...q, state: 'todo' as const }
    })
  }

  // "Rebuild the city" with one of the two starts: a generated map to lay out
  // (the seed's), or Manhattan, whole. The sessions and their agents stay;
  // a repository whose borough has gone waits at the station for another.
  restart(start: number | 'manhattan', now: number) {
    const w = this.world
    const rev = this.layout.rev + 1
    w.opened = {}
    delete w.firstRoad
    delete w.torch
    w.population = 0
    w.layout = start === 'manhattan' ? manhattanLayout() : generateMap(start)
    w.layout.rev = rev
    if (start === 'manhattan') this.buildAll(now)
    this.sync()
    for (const repo of w.repos) {
      if (isWaiting(repo.burb) || burbGeo(this.layout, repo.burb)) continue
      const was = repo.burb
      repo.burb = waitingId(repo.root)
      for (const a of w.agents) if (a.burb === was) a.burb = repo.burb
    }
    for (const a of w.agents) delete a.arriving
    const text = start === 'manhattan' ? 'Manhattan stands whole again' : 'New land: lay out your first district'
    this.toasts.push(text)
    this.say(undefined, text, now)
    this.isDirty = true
  }

  // The old game's Rebuild: the preset island bare again, its landmarks
  // rising as sessions do each kind of work.
  rebuild(now: number) {
    const w = this.world
    w.population = 0
    delete w.torch
    clearBuilt(this.layout)
    this.sync()
    for (const a of w.agents) delete a.arriving
    this.toasts.push('The island is bare again: build it by working')
    this.say(undefined, 'the island is bare again', now)
    this.isDirty = true
  }

  // "Build it all now": every landmark stands, the fabric is full, no ceremony.
  buildAll(now: number) {
    const w = this.world
    // Only what has a building stands: a laid-out city has nothing to raise
    // until it is placed. The torch needs a Statue.
    for (const id of LANDMARKS) {
      if (id === 'torch') {
        if (cityBuildings(this.layout, 'liberty').length) w.torch ??= now - SCAFFOLD_MS
      } else markBuilt(this.layout, id, now - SCAFFOLD_MS)
    }
    this.sync()
    w.population = Math.max(w.population ?? 0, fullPopulation())
    this.isDirty = true
  }

  // The city builder (docs/city-builder.md): one placement from the page,
  // checked by the layout's rules. In the city, placing a landmark builds it
  // (the game's record and ceremony follow); in a borough it is a lot until
  // that repository's first such work. The fixed kinds always stand, and the
  // Statue stands once the Seaport does.
  build(raw: unknown, now: number): { ok: true } | { error: string } {
    const w = this.world
    if (raw && typeof raw === 'object' && (raw as { op?: unknown }).op === 'movein') {
      const { id, root } = raw as { id?: unknown; root?: unknown }
      if (typeof id !== 'string' || typeof root !== 'string' || !root.trim()) return { error: 'Not a placement' }
      return this.moveIn(root.trim(), id, now)
    }
    if (raw && typeof raw === 'object' && (raw as { op?: unknown }).op === 'autoborough') return this.autoBorough(raw as Record<string, unknown>, now)
    if (raw && typeof raw === 'object' && (raw as { op?: unknown }).op === 'fill') {
      const { id } = raw as { id?: unknown }
      const bo = typeof id === 'string' ? this.layout.boroughs.find(b => b.id === id) : undefined
      if (!bo || bo.preset) return { error: 'No such borough' }
      const f = fillBorough(this.layout, bo.id)
      if (!f.added) return { error: f.lots ? `${bo.name} has no room for more lots` : `There is no room for lots in ${bo.name}` }
      w.layout = connectBorough(f.layout, bo.id)
      this.news(`Streets and ${f.added} lots laid out in ${bo.name}`, now)
      this.sync()
      this.isDirty = true
      return { ok: true }
    }
    const op = parseOp(raw)
    if (!op) return { error: 'Not a placement' }
    if (op.op === 'borough' && op.root && w.homeRoot && same(op.root, w.homeRoot)) return { error: `${w.home} is Manhattan's` }
    const bulldozed = op.op === 'remove' ? this.layout.boroughs.find(bo => bo.id === op.id) : undefined
    if (op.op === 'place' && op.kind === 'empire' && DISTRICT_LANDMARKS.some(d => w.built?.[d] === undefined)) {
      return { error: 'Build every district first' }
    }
    const r = applyOp(this.layout, op)
    if ('error' in r) return r
    w.layout = r.layout
    if (op.op === 'road') w.firstRoad ??= now
    if (op.op === 'place') {
      const b = r.layout.buildings[r.layout.buildings.length - 1]!
      if (!b.burb) {
        if (b.kind === 'liberty') {
          // She goes up as she is placed (with the Seaport's time when it stands).
          b.built = w.built?.harbor ?? now
        } else if (!FIXED.includes(b.kind)) {
          // What is left is a landmark of the game's.
          this.raise(b.kind as Landmark, undefined, now)
          markBuilt(r.layout, b.kind as Landmark, now)
        }
      }
    }
    if (op.op === 'borough') this.achieve('borough', now)
    // Drawn with "lay streets and lots for me": they go in at once.
    if (op.op === 'borough' && op.fill) {
      const id = r.layout.boroughs[r.layout.boroughs.length - 1]!.id
      w.layout = connectBorough(fillBorough(r.layout, id).layout, id)
    }
    // The sheet's repository moves into the borough just drawn.
    if (op.op === 'borough' && op.root) this.moveIn(op.root, r.layout.boroughs[r.layout.boroughs.length - 1]!.id, now)
    this.sync()
    // A bulldozed borough frees its repository, which waits at the station again.
    if (bulldozed) {
      for (const repo of w.repos.filter(one => one.burb === bulldozed.id)) {
        if (repo.left) repo.burb = waitingId(repo.root)
        else {
          this.waitForBorough(repo, now)
          for (const a of w.agents) if (a.burb === bulldozed.id) a.burb = repo.burb
        }
      }
    }
    this.isDirty = true
    return { ok: true }
  }

  // "Build it for me" on a New arrival card: a borough sized to the
  // repository (files and folders, counted by the server) on the free land
  // nearest Grand Central, named after it, with its streets and lots laid
  // and a road to the city, and the repository moved in.
  private autoBorough(raw: Record<string, unknown>, now: number): { ok: true } | { error: string } {
    const w = this.world
    const root = typeof raw.root === 'string' ? raw.root.trim() : ''
    if (!root) return { error: 'Which repository?' }
    if (w.homeRoot && same(root, w.homeRoot)) return { error: `${w.home} is Manhattan's` }
    const repo = w.repos.find(r => same(r.root, root))
    const has = repo && !repo.left && !isWaiting(repo.burb) ? burbGeo(this.layout, repo.burb) : undefined
    if (has) return { error: `${repo!.name} lives in ${has.name} already` }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
    const want = lotsWanted(num(raw.files) || 60, num(raw.folders))
    const station = cityBuildings(this.layout, 'station')[0]
    const near: [number, number] = station ? [station.x + 1, station.y + 2] : [64, 64]
    // The size it wants, else smaller ones down to a small borough.
    let [bw, bh] = boroughSizeFor(want)
    let site = findSite(this.layout, bw, bh, near)
    while (!site && (bw > 6 || bh > 4)) {
      if (bh > 4) bh--
      else bw -= 4
      site = findSite(this.layout, bw, bh, near)
    }
    if (!site) return { error: 'No free land is big enough: lay one out yourself' }
    const name = (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : repo?.name ?? base(root)).slice(0, 40)
    const r = applyOp(this.layout, { op: 'borough', name, root, x: site[0], y: site[1], w: bw, h: bh })
    if ('error' in r) return r
    const id = r.layout.boroughs[r.layout.boroughs.length - 1]!.id
    w.layout = connectBorough(fillBorough(r.layout, id, want).layout, id)
    this.achieve('borough', now)
    const moved = this.moveIn(root, id, now)
    if ('error' in moved) return moved
    this.sync()
    this.isDirty = true
    return { ok: true }
  }

  // The welcome's map picker (docs/city-builder.md, step seven): a city that
  // has seen no session yet starts again on the map of a seed, or on the
  // hand-drawn Manhattan ('manhattan'). Once work has begun the map stays.
  newMap(seed: unknown, now: number): { ok: true } | { error: string } {
    if (!this.isNew) return { error: 'The city is under way: its map stays' }
    // The revision runs on, so every page takes the new layout.
    const rev = this.layout.rev + 1
    if (seed === 'manhattan') {
      // Start from Manhattan: the preset, whole.
      this.world.layout = manhattanLayout()
      this.buildAll(now)
    } else if (typeof seed === 'number' && Number.isInteger(seed) && seed > 0 && seed < 2 ** 31) this.world.layout = generateMap(seed)
    else return { error: 'Not a map' }
    this.world.layout.rev = rev
    if (seed !== 'manhattan') delete this.world.torch
    this.sync()
    this.isDirty = true
    return { ok: true }
  }

  // True while nothing is built and no session has ever been seen: the page
  // shows its welcome.
  // The welcome shows until the first session is seen; its map picker only
  // while the city is new.
  get isWelcome(): boolean {
    return !this.world.sessions.length && !this.world.homeRoot
  }

  get isNew(): boolean {
    const w = this.world
    return !Object.keys(w.built ?? {}).length && !w.sessions.length && !w.homeRoot
  }

  // A brand-new city's first lead comes in by train: it steps off at Grand
  // Central once the train is in, and the train leaves again empty.
  private arrive(lead: Agent, s: Session, now: number) {
    const w = this.world
    this.goTo(lead, 'relay', undefined)
    lead.shown = { at: 'relay' }
    lead.arriving = now + TRAIN_MS
    lead.activity = 'Just off the train'
    this.tick(lead, 'arrived at Grand Central', now)
    w.trains = [
      ...(w.trains ?? []),
      {
        id: randomUUID(),
        kind: 'arrive' as const,
        at: now,
        leaveAt: now + TRAIN_MS + DWELL_MS,
        color: s.color,
        ...(s.bullet ? { bullet: s.bullet } : {}),
        who: lead.name,
      },
    ].slice(-8)
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
    this.achieve('telegram', now)
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

  // The repository living in a borough now, if any (one that has packed up doesn't count).
  private holder(b: Burb): Repo | undefined {
    return this.world.repos.find(r => r.burb === b && !r.left)
  }

  // The repository a borough's (or the forecourt's) agents work for: the one
  // living there, else the last to have.
  private repoAt(b: Burb | undefined): Repo | undefined {
    if (!b) return undefined
    return this.holder(b) ?? this.world.repos.find(r => r.burb === b)
  }

  // A borough's name, or Grand Central's for a repository waiting for one.
  burbName(b: Burb): string {
    return burbGeo(this.layout, b)?.name ?? 'Grand Central'
  }

  private news(text: string, now: number) {
    this.toasts.push(text)
    this.say(undefined, text, now)
    this.tick(undefined, text, now)
  }

  // A repository with no borough: its agents wait on the station's forecourt
  // while the page's New arrival card asks for one (docs/city-builder.md).
  private waitForBorough(repo: Repo, now: number) {
    repo.burb = waitingId(repo.root)
    this.news(`${repo.name} arrived at Grand Central. Lay out a borough for it.`, now)
  }

  // The borough of the repository at root. A new one waits at the station; one
  // that had packed up moves straight back into its borough if nobody else
  // has, and waits otherwise, as does one whose borough was bulldozed.
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
      repo = { root, name: base(root), burb: waitingId(root), lastSeen: now }
      w.repos.push(repo)
      this.waitForBorough(repo, now)
    } else if (repo.left) {
      const geo = burbGeo(this.layout, repo.burb)
      const free = !!geo && !this.holder(repo.burb)
      delete repo.left
      if (free) this.news(`${repo.name} moved back into ${geo!.name}`, now)
      else this.waitForBorough(repo, now)
    } else if (!isWaiting(repo.burb) && !burbGeo(this.layout, repo.burb)) {
      this.waitForBorough(repo, now)
    }
    repo.lastSeen = now
    return repo.burb
  }

  // A repository's census (src/census.ts) for its borough's buildings. The
  // map redraws only when it says something new.
  setCensus(root: string, census: Census) {
    const repo = this.world.repos.find(r => same(r.root, root))
    if (!repo) return
    const changed = !sameCensus(repo.census, census)
    repo.census = census
    if (changed) this.isDirty = true
  }

  // The repositories whose census is wanted: those with a borough, and
  // whether their agents are at work there now.
  // ---- billboards: the local servers sessions start (src/billboards.ts) ----

  // A local address in a shell's or a browser tool's work, or a dev server
  // started: the address becomes a billboard to probe; a dev command with no
  // port in sight becomes a hint the server watches the usual ports for.
  private spotServers(a: Agent, tool: string, input: Record<string, unknown>, response: unknown, now: number) {
    if (!watchedTool(tool)) return
    const w = this.world
    const root = (a.burb ? this.repoAt(a.burb)?.root : undefined) ?? w.homeRoot
    if (!root) return
    const command = str(input.command)
    const found = localUrls([command, str(input.url), resultText(response)].join('\n'))
    for (const { url } of found) this.spotBillboard(root, url, now)
    const dev = tool === 'Bash' || tool === 'PowerShell' ? devCommand(command) : undefined
    if (dev?.port) this.spotBillboard(root, `http://localhost:${dev.port}/`, now)
    else if (dev && !found.length) {
      w.devHints = [...(w.devHints ?? []).filter(h => now - h.at < HINT_MS), { id: `${root}|${now}`, root, at: now }].slice(-8)
    }
  }

  // A server at url, spotted in the work on root: a billboard to probe, new
  // or tried again.
  spotBillboard(root: string, url: string, now: number) {
    const w = this.world
    const port = portOf(url)
    if (!port || this.ignorePorts.has(port)) return
    const id = `${root.toLowerCase()}|${port}`
    const list = (w.billboards ??= [])
    const b = list.find(x => x.id === id)
    if (b) {
      b.at = now
      if (!b.up) b.url = url
      return
    }
    const name = same(root, w.homeRoot) ? w.home : (w.repos.find(r => same(r.root, root))?.name ?? base(root))
    list.push({ id, url, root, name, at: now })
    // Over the limit, the dark ones longest unseen go.
    if (list.length > BILLBOARDS_MAX) {
      const drop = list.filter(x => !x.up).sort((x, y) => x.at - y.at).slice(0, list.length - BILLBOARDS_MAX)
      w.billboards = list.filter(x => !drop.includes(x))
    }
  }

  // What the server should knock on: billboards standing, and ones spotted
  // lately that haven't answered yet. Ones dark a day are forgotten.
  billboardsToProbe(now: number): { id: string; url: string; title?: string }[] {
    const w = this.world
    if (w.billboards?.some(b => !b.up && now - b.at > BILLBOARD_FORGET_MS)) w.billboards = w.billboards.filter(b => b.up || now - b.at <= BILLBOARD_FORGET_MS)
    return (w.billboards ?? []).filter(b => b.up || now - b.at < SPOT_MS).map(b => ({ id: b.id, url: b.url, ...(b.title ? { title: b.title } : {}) }))
  }

  // A probe's answer. The first time a server answers, its billboard is
  // built (and glows until opened); after a few misses in a row it comes down.
  billboardProbed(id: string, ok: boolean, now: number, title?: string) {
    const b = this.world.billboards?.find(x => x.id === id)
    if (!b) return
    if (title && title !== b.title) {
      // A new title on a page already showing is an update.
      if (b.title && b.up) this.billboardUpdated(b, now, 'its page has a new title')
      b.title = title
      this.isDirty = true
    }
    if (ok) {
      b.misses = 0
      if (b.up) return
      b.up = now
      const host = hostOf(b.url)
      if (b.builtAt === undefined) {
        b.builtAt = now
        this.news(`A billboard went up for ${b.name}: ${host}. Click it to open the page`, now)
      } else this.billboardUpdated(b, now, 'its server is back up')
      this.isDirty = true
      return
    }
    if (!b.up) return
    b.misses = (b.misses ?? 0) + 1
    if (b.misses < BILLBOARD_MISSES) return
    delete b.up
    b.misses = 0
    // One the person took down was only down while this server ran: the next
    // time it starts, it goes up again.
    if (b.destroyedAt !== undefined) delete b.destroyedAt
    else this.tick(undefined, `${b.name}'s billboard went dark: ${hostOf(b.url)} stopped`, now)
    this.isDirty = true
  }

  // The person moved, turned or took down a billboard: { id, x, y } puts it
  // at a grid cell (to the half), { face } turns its screen ('l' or 'r'),
  // { destroy: true } takes it down while its server keeps running.
  editBillboard(raw: unknown, now: number): { ok: true } | { error: string } {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const b = typeof r.id === 'string' ? this.world.billboards?.find(x => x.id === r.id) : undefined
    if (!b) return { error: 'No such billboard' }
    if (r.destroy === true) {
      b.destroyedAt = now
      this.tick(undefined, `${b.name}'s billboard came down: ${hostOf(b.url)}`, now)
      this.isDirty = true
      return { ok: true }
    }
    const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= -60 && v <= 140 ? Math.round(v * 2) / 2 : undefined)
    if (r.x !== undefined || r.y !== undefined) {
      const x = coord(r.x)
      const y = coord(r.y)
      if (x === undefined || y === undefined) return { error: 'Not a place on the map' }
      b.pos = [x, y]
    }
    if (r.face !== undefined) {
      if (r.face !== 'l' && r.face !== 'r') return { error: 'face must be l or r' }
      b.face = r.face
    }
    this.isDirty = true
    return { ok: true }
  }

  // The person opened it: it stops glowing until it is next updated.
  openBillboard(id: unknown, now: number): boolean {
    const b = typeof id === 'string' ? this.world.billboards?.find(x => x.id === id) : undefined
    if (!b) return false
    if (litFor(b)) this.isDirty = true
    b.openedAt = Math.max(now, (b.updatedAt ?? 0) + 1)
    return true
  }

  // What a billboard shows changed: it lights up and glows until opened. The
  // ticker says so when it starts glowing, not at every edit after.
  private billboardUpdated(b: Billboard, now: number, why: string) {
    const was = litFor(b)
    b.updatedAt = now
    if (!was) this.tick(undefined, `${b.name}'s billboard lit up: ${why}. Click it to see ${hostOf(b.url)}`, now)
    this.isDirty = true
  }

  // A session edited a file: the billboards of that file's repository that
  // stand light up, since the page they show is likely to have changed.
  private editedFor(path: string | undefined, now: number) {
    if (!path) return
    const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const file = key(path)
    for (const b of this.world.billboards ?? []) {
      if (b.up === undefined || b.destroyedAt !== undefined || !file.startsWith(key(b.root) + '/')) continue
      this.billboardUpdated(b, now, `${b.name} changed`)
    }
  }

  // The dev servers started with no address in sight, for the server to
  // watch the usual ports for; each is handed out once.
  takeDevHints(now: number): DevHint[] {
    const w = this.world
    const out = (w.devHints ?? []).filter(h => now - h.at < HINT_MS)
    if (w.devHints?.length) w.devHints = []
    return out
  }

  censusWanted(): { root: string; census?: Census; busy: boolean }[] {
    return this.world.repos
      .filter(r => !r.left && !isWaiting(r.burb))
      .map(r => ({ root: r.root, ...(r.census ? { census: r.census } : {}), busy: this.world.agents.some(a => a.burb === r.burb && a.status === 'working') }))
  }

  // Breaking ground (src/groundbreak.ts): a new project at root gets a
  // borough, one drawn now (x, y, w, h, with its streets and lots when `fill`)
  // or one nobody lives in (id), and moves in.
  groundFor(root: string, name: string, at: Record<string, unknown>, now: number): { ok: true; borough: string } | { error: string } {
    let id = typeof at.id === 'string' ? at.id : ''
    if (id) {
      if (!burbGeo(this.layout, id)) return { error: 'No such borough' }
    } else {
      const { x, y, w, h, fill } = at
      const r = this.build({ op: 'borough', name, x, y, w, h, ...(fill ? { fill: true } : {}) }, now)
      if ('error' in r) return r
      id = this.layout.boroughs[this.layout.boroughs.length - 1]!.id
    }
    const geo = burbGeo(this.layout, id)!
    const say = geo.name.toLowerCase() === name.toLowerCase() ? `Ground broken for ${name}` : `Ground broken for ${name} in ${geo.name}`
    const moved = this.moveIn(root, id, now, say)
    if ('error' in moved) return moved
    this.sync()
    return { ok: true, borough: geo.name }
  }

  // Moves the repository at root into a borough the person picked (the
  // arrival card, or the Borough tool's sheet); its agents walk over.
  // `say` replaces the ticker's "moved into" line (breaking ground has its own).
  moveIn(root: string, id: Burb, now: number, say?: string): { ok: true } | { error: string } {
    const w = this.world
    const geo = burbGeo(this.layout, id)
    if (!geo) return { error: 'No such borough' }
    if (w.homeRoot && same(root, w.homeRoot)) return { error: `${w.home} is Manhattan's` }
    const there = this.holder(id)
    if (there && !same(there.root, root)) return { error: `${geo.name} is ${there.name}'s` }
    let repo = w.repos.find(r => same(r.root, root))
    if (!repo) {
      repo = { root, name: base(root), burb: id, lastSeen: now }
      w.repos.push(repo)
    }
    const was = repo.burb
    const moving = was !== id || !!repo.left
    repo.burb = id
    delete repo.left
    if (was !== id) for (const a of w.agents) if (a.burb === was) a.burb = id
    if (say) this.news(say, now)
    else if (moving) this.news(`${repo.name} moved into ${geo.name}`, now)
    this.isDirty = true
    return { ok: true }
  }

  private session(ev: HookEvent, now: number): Session {
    const w = this.world
    let s = w.sessions.find(one => one.id === ev.session_id)
    if (!s) {
      // A session that speaks again after being sent home arrives fresh; agents
      // of its still waiting for their train are gone at once.
      w.agents = w.agents.filter(a => !(a.session === ev.session_id && a.status === 'leaving'))
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
      const look = this.looks.get(s.id)
      if (look) this.wear(s, look)
    }
    // Sessions saved before bullets existed get one now.
    if (!s.bullet) s.bullet = this.bulletFor()
    // Every event names the transcript; a subagent's stop names its own.
    const transcript = str(ev.transcript_path)
    if (transcript && !ev.agent_id) s.transcriptPath = transcript
    const agentTranscript = str(ev.agent_transcript_path)
    if (agentTranscript && ev.agent_id) s.agentTranscripts = { ...s.agentTranscripts, [ev.agent_id]: agentTranscript }
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
    // One already on its way to the train is gone; this event starts it afresh.
    this.world.agents = this.world.agents.filter(one => !(one.id === id && one.status === 'leaving'))
    let a = this.world.agents.find(one => one.id === id)
    if (!a) {
      const pending = this.spawns.get(s.id) ?? []
      const subs = this.world.agents.filter(one => !one.isMain).length
      const order = pending.shift()
      a = {
        id,
        session: s.id,
        name: short(order?.title ?? str(ev.agent_type) ?? 'Subagent', 28) || 'Subagent',
        ...(order ? { order } : {}),
        stops: [{ at: 'relay', ...(lead.burb ? { burb: lead.burb } : {}), t: now }],
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
        // The first session of a brand-new city arrives by train.
        const byTrain = !w.agents.some(a => a.id === `lead:${s.id}`) && w.sessions.length === 1 && !Object.keys(w.built ?? {}).length
        const lead = this.lead(s, now)
        lead.status = 'idle'
        lead.activity = str(ev.source) === 'resume' ? 'Resumed' : 'Session started'
        if (byTrain) this.arrive(lead, s, now)
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
        this.raise('hall', lead, now)
        break
      }
      case 'PreToolUse': {
        const a = this.agent(ev, s, now)
        this.planTool(s, tool, input)
        const cwd = str(ev.cwd) || s.cwd
        const path = pathOf(tool, input, cwd)
        let burb = a.burb
        let worked: string | undefined
        if (path) {
          worked = repoRoot(path) ?? s.root
          burb = this.burbFor(worked, now)
        } else {
          worked = a.burb ? this.repoAt(a.burb)?.root : w.homeRoot
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
          // A work order: the brief, numbered by the session's bullet.
          s.orders = (s.orders ?? 0) + 1
          const list = this.spawns.get(s.id) ?? []
          list.push({
            no: `${s.bullet ?? 'S'}-${s.orders}`,
            title: str(input.description) || str(input.subagent_type) || 'Subagent',
            brief: cut(str(input.prompt), 2048),
            issuedBy: a.name,
            at: now,
          })
          this.spawns.set(s.id, list.slice(-10))
        }
        // The game: the first of each kind of work raises its landmark, and
        // every tool call adds to the population.
        w.population = (w.population ?? 0) + 1
        if (READS.test(tool)) this.raise('library', a, now)
        else if (EDITS.test(tool)) this.raise('workshop', a, now)
        else if (SHELLS.test(tool)) this.raise('foundry', a, now)
        else if (districtFor(tool) === 'observatory') this.raise('observatory', a, now)
        else if (SPAWNS.test(tool)) this.raise('relay', a, now)
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const a = this.agent(ev, s, now)
        if (ev.hook_event_name === 'PostToolUse') this.planTool(s, tool, input, ev.tool_response ?? '')
        a.inFlight = Math.max(0, a.inFlight - 1)
        a.updatedAt = now
        w.asks = w.asks.filter(q => q.id !== str(ev.tool_use_id) && q.id !== `perm:${a.id}`)
        if (a.status === 'waiting') a.status = 'working'
        const command = str(input.command)
        if (ev.hook_event_name === 'PostToolUse') {
          this.spotServers(a, tool, input, ev.tool_response, now)
          if (EDITS.test(tool)) this.editedFor(pathOf(tool, input, str(ev.cwd) || s.cwd), now)
        }
        const isGitish = ((tool === 'Bash' || tool === 'PowerShell') && /\b(git|gh)\b/.test(command)) || /merge|sync|rebase|pull/i.test(tool)
        if (isGitish) {
          const text = resultText(ev.tool_response ?? ev.error)
          if (CONFLICT.test(text)) {
            const files = [
              ...new Set(
                [...text.matchAll(/(?:Merge conflict in |CONFLICT \([^)]*\): (?:Merge conflict in )?)([^\s"\\]+)/g)].map(m => m[1] ?? ''),
              ),
            ].slice(0, 12)
            const where = a.burb ? this.repoAt(a.burb)?.name : w.home
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
          const repo = (a.burb ? this.repoAt(a.burb)?.name : w.home) ?? ''
          w.launch = { kind, at: now, who: a.name, repo }
          this.say(a, `${kind === 'push' ? 'pushed' : 'committed'}${repo ? ` in ${repo}` : ''}`, now)
          this.tick(a, kind === 'push' ? `🚀 pushed${repo ? ` ${repo}` : ''}` : `committed${repo ? ` in ${repo}` : ''}`, now)
          if (kind === 'push') this.toasts.push(`🚀 ${a.name} pushed${repo ? ` ${repo}` : ''}`)
          // The first commit builds the Seaport and the Statue; the first push lights her torch.
          this.raise('harbor', a, now)
          if (kind === 'push') this.raise('torch', a, now)
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
        const from = placeOf(a)
        a.status = 'done'
        a.inFlight = 0
        // Finished agents rest in Central Park, whichever borough they worked in.
        this.goTo(a, 'plaza', undefined)
        a.activity = 'Finished'
        a.updatedAt = now
        w.asks = w.asks.filter(q => q.agentId !== a.id)
        this.say(a, 'finished', now)
        this.tick(a, 'filed its report', now)
        // The report rides back to the lead; the agent rests a while after it has arrived.
        if (!a.isMain) {
          const to = placeOf(this.lead(s, now))
          this.ride(from, to, a.color, 'report', now)
          a.restUntil = now + walk(from, to, placeAt(to, 0, this.layout), this.layout).dur * 1000 + REST_LEAVE
          // The first subagent to finish and go to rest greens Central Park.
          this.raise('plaza', a, now)
        }
        break
      }
      case 'Stop':
      case 'StopFailure': {
        const lead = this.lead(s, now)
        lead.status = ev.hook_event_name === 'Stop' ? 'idle' : 'failed'
        lead.inFlight = 0
        // An idle lead hangs out in Central Park until your next prompt calls it
        // back to City Hall; one that failed waits at City Hall with its "!".
        if (ev.hook_event_name === 'Stop') this.goTo(lead, 'plaza', undefined)
        else this.goTo(lead, 'hall', this.homeOf(s, now))
        lead.activity = ev.hook_event_name === 'Stop' ? 'Hanging out in Central Park, waiting for you' : 'Stopped with an error'
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
      // The session's task checklist: its site plan.
      case 'TaskCreated': {
        this.addTask(s, str(ev.task_id), short(str(ev.task_subject), 80))
        break
      }
      case 'TaskCompleted': {
        this.setTask(s, str(ev.task_id), short(str(ev.task_subject), 80), 'done')
        break
      }
      case 'SessionEnd': {
        this.departSession(s, now, 'ended')
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

  // Makes the repository at root Manhattan; the old home takes its borough
  // (or another, when the new home had packed up and its old borough is taken).
  makeHome(root: string, now: number, pinned = true) {
    const w = this.world
    const repo = w.repos.find(r => same(r.root, root))
    if (!repo) return
    w.homePinned = pinned
    const old = { root: w.homeRoot, name: w.home }
    w.homeRoot = repo.root
    w.home = repo.name
    w.repos = w.repos.filter(r => r !== repo)
    // The old home takes the borough the new one leaves, or waits at the station.
    const theirs = !repo.left && !isWaiting(repo.burb) && burbGeo(this.layout, repo.burb) ? repo.burb : undefined
    const burb = theirs ?? waitingId(old.root ?? '')
    if (old.root) w.repos.push({ root: old.root, name: old.name, burb, lastSeen: now })
    for (const a of w.agents) {
      if (a.burb === repo.burb && !repo.left) delete a.burb
      else if (!a.burb) a.burb = burb
    }
    this.isDirty = true
  }

  // ---- departures: the last train home --------------------------------------

  // Sends agents to Grand Central to board one train; they are gone when it leaves.
  private depart(list: Agent[], now: number, why: string) {
    const w = this.world
    const going = list.filter(a => a.status !== 'leaving')
    if (!going.length) return
    let leaveAt = now
    for (const a of going) {
      // The train waits for the longest walk.
      const dur = walk(placeOf(a), STATION, placeAt(STATION, 0, this.layout), this.layout).dur * 1000 + 400
      leaveAt = Math.max(leaveAt, Math.min(now + BOARDING_MS, now + dur))
    }
    const first = going[0]!
    const s = w.sessions.find(one => one.id === first.session)
    for (const a of going) {
      a.status = 'leaving'
      a.inFlight = 0
      a.leaving = leaveAt
      this.goTo(a, 'relay', undefined)
      a.activity = `Boarding the last train home (${why})`
      this.say(a, `took the last train home (${why})`, now)
    }
    this.tick(first, going.length === 1 ? 'took the last train home' : `and ${going.length - 1} more took the last train home`, now)
    w.asks = w.asks.filter(q => !going.some(a => a.id === q.agentId))
    w.trains = [
      ...(w.trains ?? []),
      {
        id: randomUUID(),
        at: now,
        leaveAt,
        color: s?.color ?? first.color,
        ...(s?.bullet ? { bullet: s.bullet } : {}),
        who: going.map(a => a.name).join(', '),
      },
    ].slice(-8)
    this.isDirty = true
  }

  // A whole session leaves: its agents board, and it is forgotten, so that it
  // arrives fresh if it ever speaks again. Where its conversation is stays
  // known, so the page can still show it.
  private departSession(s: Session, now: number, why: string) {
    const w = this.world
    this.depart(w.agents.filter(a => a.session === s.id), now, why)
    w.sessions = w.sessions.filter(one => one !== s)
    const past = { ...w.pastSessions }
    delete past[s.id]
    past[s.id] = { root: s.root, leftAt: now, ...(s.transcriptPath ? { transcriptPath: s.transcriptPath } : {}), ...(s.agentTranscripts ? { agentTranscripts: s.agentTranscripts } : {}) }
    const ids = Object.keys(past)
    for (const id of ids.slice(0, Math.max(0, ids.length - PAST_MAX))) delete past[id]
    w.pastSessions = past
    this.spawns.delete(s.id)
    this.isDirty = true
  }

  // "Send home" on a session's card: its agents leave now.
  sendHome(sessionId: unknown, now: number): boolean {
    const s = this.world.sessions.find(one => one.id === sessionId)
    if (!s) return false
    this.departSession(s, now, 'sent home')
    this.achieve('train', now)
    return true
  }

  // "Last call" in the header: everyone idle leaves now. Returns how many went.
  lastCall(now: number): number {
    const w = this.world
    let n = 0
    for (const s of [...w.sessions]) {
      const lead = w.agents.find(a => a.id === `lead:${s.id}`)
      if (lead && (lead.status === 'idle' || lead.status === 'failed')) {
        n += w.agents.filter(a => a.session === s.id && a.status !== 'leaving').length
        this.departSession(s, now, 'last call')
      }
    }
    const rest = w.agents.filter(a => !a.isMain && (a.status === 'done' || a.status === 'idle'))
    n += rest.length
    this.depart(rest, now, 'last call')
    if (n) this.achieve('train', now)
    return n
  }

  // True when a train is due to leave or to be gone, a passenger to step off,
  // a scaffold to come down or the fireworks to end: the server redraws then
  // even if nothing else has happened.
  due(now: number): boolean {
    const w = this.world
    if (w.agents.some(a => (a.leaving && now >= a.leaving) || (a.arriving && now >= a.arriving))) return true
    if ((w.trains ?? []).some(t => now >= t.leaveAt + TRAIN_MS)) return true
    // The 800 ms tick lands in a 900 ms window at least once.
    const within = (at: number, after: number) => now >= at + after && now < at + after + 900
    for (const [id, at] of Object.entries(w.built ?? {}) as [Landmark, number][]) {
      if (within(at, SCAFFOLD_MS) || (id === 'empire' && within(at, FIREWORKS_MS))) return true
    }
    return false
  }

  // The departure rules, in order of urgency: ended app sessions, the idle
  // timers, quiet sessions, then the cap.
  private departures(now: number) {
    const w = this.world
    const leadOf = (s: Session) => w.agents.find(a => a.id === `lead:${s.id}`)
    const quiet = (a: Agent) => now - a.updatedAt
    const hasQueued = (s: Session) => (s.messages ?? []).some(m => m.status === 'queued')
    // An ended or failed app session's lead leaves at once (the app session
    // itself stays listed). One resumed in a new, living app session stays.
    const apps = w.appSessions ?? []
    for (const s of [...w.sessions]) {
      const mine = apps.filter(a => a.sessionId === s.id)
      if (mine.length && mine.every(a => a.status === 'ended' || a.status === 'failed')) this.departSession(s, now, 'ended')
    }
    for (const s of [...w.sessions]) {
      const lead = leadOf(s)
      // Quiet for six hours: it closed without saying so.
      if (now - s.updatedAt > SESSION_LEAVE) {
        this.departSession(s, now, 'quiet for six hours')
        continue
      }
      // An idle lead that has heard nothing for half an hour, unless a message
      // of yours is still waiting for it.
      if (lead && (lead.status === 'idle' || lead.status === 'failed') && quiet(lead) > IDLE_LEAVE && !hasQueued(s)) {
        this.departSession(s, now, 'idle for half an hour')
      }
    }
    // Finished subagents whose report has arrived a while ago; idle ones after half an hour.
    this.depart(
      w.agents.filter(a => !a.isMain && a.status === 'done' && now >= (a.restUntil ?? a.updatedAt + REST_LEAVE)),
      now,
      'finished',
    )
    this.depart(
      w.agents.filter(a => !a.isMain && a.status === 'idle' && quiet(a) > IDLE_LEAVE),
      now,
      'idle for half an hour',
    )
    // The cap: above it, the longest-idle leave first, a lead with its whole session.
    const staying = () => w.agents.filter(a => a.status !== 'leaving')
    const idle = (a: Agent) => a.status === 'idle' || a.status === 'failed' || a.status === 'done'
    while (staying().length > AGENT_CAP) {
      const next = staying()
        .filter(idle)
        .sort((a, b) => a.updatedAt - b.updatedAt)[0]
      if (!next) break
      const s = w.sessions.find(one => one.id === next.session)
      if (next.isMain && s) this.departSession(s, now, 'the city is full')
      else this.depart([next], now, 'the city is full')
    }
    // Boroughs nobody has worked in for an hour pack up; the houses stay.
    for (const repo of w.repos) {
      if (repo.left || now - repo.lastSeen < BURB_LEAVE) continue
      if (w.agents.some(a => a.burb === repo.burb && a.status !== 'leaving')) continue
      repo.left = now
      // One that never had a borough just stops waiting.
      if (!isWaiting(repo.burb)) this.news(`${repo.name} moved out of ${this.burbName(repo.burb)}`, now)
    }
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
    for (const s of w.sessions) {
      if (!s.messages) continue
      s.messages = s.messages.filter(m => m.status === 'queued' || now - (m.deliveredAt ?? m.at) < MESSAGE_KEPT)
      if (!s.messages.length) delete s.messages
    }
    for (const a of w.agents) {
      // Ten quiet minutes while "working" means the session went away unannounced.
      if ((a.status === 'working' || a.status === 'waiting') && now - a.updatedAt > 10 * 60_000) {
        a.status = 'idle'
        a.inFlight = 0
        a.activity = 'Quiet for a while'
        this.goTo(a, 'plaza', undefined)
      }
    }
    this.departures(now)
    // An ask outlives nothing: not its agent, and a permission notice not half an hour.
    w.asks = w.asks.filter(
      q =>
        w.agents.some(a => a.id === q.agentId && a.status !== 'done' && a.status !== 'leaving') &&
        !(q.id.startsWith('perm:') && now - q.at > 30 * 60_000),
    )
    const live = new Set(w.sessions.map(s => s.id))
    w.agents = w.agents
      // Whoever's train has left is gone; so is anyone whose session is, a few seconds on (a backstop).
      .filter(a => !(a.leaving && now >= a.leaving))
      .filter(a => a.status === 'leaving' || live.has(a.session) || now - a.updatedAt < 8_000)
      .slice(-60)
    // A train is gone a few seconds after it leaves; it never leaves before its passengers are aboard.
    w.trains = (w.trains ?? []).filter(t => now < t.leaveAt + TRAIN_MS)
    if (!w.trains.length) delete w.trains
    for (const a of w.agents) {
      const moved = a.shown.at !== a.at || a.shown.burb !== a.burb
      a.walkFrom = moved ? a.shown : undefined
      // A move starts a walk, which the frames carry until it is over (the
      // longest walk is 4.5 s); a move mid-walk starts a new one from here.
      if (moved) {
        a.walk = { from: a.shown, at: now }
        // A new stop on its route; the first is where it was first drawn.
        const stops = a.stops ?? [{ ...a.shown, t: a.startedAt }]
        stops.push({ at: a.at, ...(a.burb ? { burb: a.burb } : {}), t: now })
        a.stops = stops.slice(-8)
      }
      else if (a.walk && now - a.walk.at > WALK_MS) delete a.walk
      a.shown = a.burb ? { at: a.at, burb: a.burb } : { at: a.at }
      if (a.arriving && now >= a.arriving) delete a.arriving
    }
    w.flushedAt = now
    this.isDirty = false
    return w
  }
}

export type { Place }
