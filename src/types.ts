import type { Layout } from './layout.ts'

export type District =
  | 'hall'
  | 'library'
  | 'workshop'
  | 'foundry'
  | 'harbor'
  | 'observatory'
  | 'relay'
  | 'plaza'

// What the onboarding game builds: each district's landmark, the Statue's
// torch, and the Empire State Building as the capstone.
export type Landmark = District | 'torch' | 'empire'

// The Manhattan preset's four hand-drawn boroughs.
export type PresetBurb = 'brooklyn' | 'queens' | 'bronx' | 'jersey'

// Where a repository other than Manhattan's lives: a borough's id in the
// layout (the preset's four keep their names as ids), or, while it has none,
// `@<root>`: its agents wait on Grand Central's forecourt (`waitingId` in
// src/layout.ts).
export type Burb = string

export type View = 'island' | 'uptown' | 'midtown' | 'downtown'

// 'leaving': on its way to Grand Central for the train home; it is gone once
// the train pulls out (Agent.leaving).
export type AgentStatus = 'working' | 'idle' | 'waiting' | 'done' | 'failed' | 'leaving'

// Where an agent is: a district of Manhattan (the home repository), or a
// borough when it works in another one.
export type Place = { at: District; burb?: Burb }

export type Agent = {
  id: string
  // The Claude Code session it belongs to.
  session: string
  name: string
  kind: string
  color: string
  // A session's lead: the main agent, crowned.
  isMain: boolean
  status: AgentStatus
  at: District
  burb?: Burb
  // Where the last drawn frame showed it, and where it walks from in this one.
  shown: Place
  walkFrom?: Place
  // The walk under way: from where, and when it set off. Kept until the walk
  // is over, so every frame can give the page the whole route.
  walk?: { from: Place; at: number }
  activity: string
  tools: number
  inFlight: number
  startedAt: number
  updatedAt: number
  // A finished subagent rests until then (its report has arrived, plus a while).
  restUntil?: number
  // When its train leaves Grand Central; set once it is on its way there.
  leaving?: number
  // When it steps off the train it arrived on (a brand-new city's first lead).
  arriving?: number
  // A subagent's work order: the brief its lead gave it (the Agent tool's
  // prompt, cut to 2 KB), numbered by session, with who issued it and when.
  order?: WorkOrder
  // Its last eight stops, oldest first, for its route line.
  stops?: Stop[]
}

// A usage window: how much of it is used (percent) and when it resets.
export type LimitWindow = { used: number; resetsAt: number }
export type Limits = {
  fiveHour?: LimitWindow
  sevenDay?: LimitWindow
  spend?: LimitWindow & { usedUsd?: number; limitUsd?: number; period?: string }
  at: number
}

export type Feat = 'answer' | 'telegram' | 'worksite' | 'zoning' | 'borough' | 'train'
export type PlanItem = { id: string; subject: string; state: 'todo' | 'doing' | 'done' }

export type WorkOrder = { no: string; title: string; brief: string; issuedBy: string; at: number }
export type Stop = { at: District; burb?: Burb; t: number }

// A train at Grand Central. Departing: it waits while its passengers walk
// over, pulls out at leaveAt, and is gone a few seconds later. Arriving: it
// comes in from the east at `at`, stands at the platform, and leaves empty at
// leaveAt.
export type Train = {
  id: string
  kind?: 'arrive' | 'freight'
  at: number
  leaveAt: number
  color: string
  bullet?: string
  // Who is aboard, for the tooltip.
  who: string
}

// What a lead wears on its head (src/draw/agents.ts draws each); 'crown' unless picked.
export type Hat = 'crown' | 'none' | 'tophat' | 'cap' | 'hardhat' | 'beanie' | 'wizard' | 'cowboy' | 'party' | 'chef'

// How a session started from the page looks, as the person chose it: its
// name, colour and hat. Anything left out is the city's usual pick.
export type Look = { name?: string; color?: string; hat?: Hat }

export type Session = {
  id: string
  name: string
  cwd: string
  // The repository root it started in, or its folder when that is none.
  root: string
  color: string
  // Its lead's hat, when the person picked one (else the crown).
  hat?: Hat
  // Its subway bullet: a letter in a circle of its color, shared by its agents.
  bullet?: string
  // How many work orders its lead has issued (subagents started).
  orders?: number
  // What it has spent: Claude Code's running estimate, in US dollars.
  costUsd?: number
  // Its site plan: the task checklist Claude Code keeps for it (TaskCreated
  // and TaskCompleted, or the TodoWrite and TaskUpdate tools).
  plan?: PlanItem[]
  startedAt: number
  updatedAt: number
  // What the person typed for it in the page: queued until its next hook event
  // can carry them, then kept for a while as delivered.
  messages?: Message[]
  // Its transcript (JSONL), from the hook events: the page's conversation view.
  transcriptPath?: string
  // Subagents' own transcripts, by agent id (from SubagentStop).
  agentTranscripts?: Record<string, string>
}

// What the city keeps of a session after it leaves: where its conversation
// and its repository are.
export type PastSession = {
  root: string
  transcriptPath?: string
  agentTranscripts?: Record<string, string>
  leftAt: number
}

// A local server as a billboard (src/billboards.ts). It stands while its port
// answers; the first time it goes up it is built, and it glows until the
// person first opens it.
export type Billboard = {
  // The repository and the port, so a server restarted comes back as itself.
  id: string
  // What a click opens: http://localhost:5173/ and the like.
  url: string
  // The repository whose session started it, and its name.
  root: string
  name: string
  // The page's <title>, once read.
  title?: string
  // When it was last spotted in a session's work (a probe tries it from then).
  at: number
  // Since when it answers; none while it doesn't.
  up?: number
  // The first time it answered: the billboard went up.
  builtAt?: number
  // When the person last opened it: it stops glowing until it is updated.
  openedAt?: number
  // When what it shows last changed while it stood: a session edited a file
  // in its repository, its server came back up, or its page's title changed.
  // It lights up and glows again until the person opens it.
  updatedAt?: number
  // Probes in a row that found it closed.
  misses?: number
  // Where the person moved it (grid cell, in halves), and which way its
  // screen faces: 'l' the front-left face (along gx), 'r' the front-right
  // (along gy). None: placed for them, facing left.
  pos?: [number, number]
  face?: 'l' | 'r'
  // The person took it down: it stays down while its server keeps running,
  // and goes up again the next time the server starts.
  destroyedAt?: number
}

export type DevHint = { id: string; root: string; at: number }

// A power line between two projects (src/draw/links.ts): sessions that
// started in one worked in the other. a and b are repository roots (or
// Manhattan's folder), a sorting before b; the sessions that crossed, the
// latest 20; when work last crossed.
export type Link = { a: string; b: string; sessions: string[]; lastAt: number }

// A project's construction site (src/sites.ts): its building permit (the
// pull request filed for its branch), its last inspection (a test run, or a
// pull request's checks) and its last ribbon cutting (a pull request merged).
export type Site = {
  root: string
  permit?: { pr: number; url: string; branch?: string; at: number }
  inspection?: { at: number; passed: boolean; what: string; detail?: string }
  opened?: { at: number; pr?: number; url?: string }
  // The last deploy (src/deploys.ts): where to, whether to production, and the address.
  shipped?: { at: number; target: string; prod: boolean; url?: string; version?: string }
}

// A permission prompt, question or plan approval held open for the page to
// decide (the PermissionRequest hook waits for the answer).
export type Pending = {
  id: string
  session: string
  agentId?: string
  kind: 'permission' | 'question' | 'plan'
  tool: string
  // One line: the command, the file, the URL…
  summary: string
  // The tool's input, trimmed for display.
  input: Record<string, unknown>
  // For AskUserQuestion: what it asks, as the tool gives it.
  questions?: { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean }[]
  // For ExitPlanMode: the plan, in Markdown.
  plan?: string
  // For a permission Claude Code offers to remember: what "Always allow"
  // would add ("Bash(npm test:*) in this project"). Absent, only Allow.
  always?: string
  at: number
  // After this the hook gives up and the session asks in its own window.
  expiresAt: number
}

// The page's answer to a Pending.
export type Decision = {
  behavior: 'allow' | 'deny'
  // Shown to Claude with a deny ("Try a different approach…").
  message?: string
  // For a question: question text → the chosen label(s), joined with ", ".
  answers?: Record<string, string>
  // With an allow: also apply the prompt's "always allow" suggestions.
  always?: boolean
}

// A session's account in the City Treasury's ledger: what it has spent, by
// day, and who it was when it last spent (it may have left the city since).
export type LedgerEntry = {
  name: string
  // Its repository root or folder, when the city knew it.
  root: string
  color: string
  bullet?: string
  usd: number
  // Local dates, as in the books.
  days: Record<string, number>
  // When it first and last spent.
  first: number
  last: number
}

// One line of a session's conversation, read from its transcript.
export type Entry = {
  kind: 'user' | 'assistant' | 'tool' | 'result' | 'system'
  text: string
  at?: number
  // For tool calls and their results.
  tool?: string
  isError?: boolean
}

// What a session has changed in its repository.
export type Changes = {
  root: string
  files: { path: string; status: string; added?: number; removed?: number }[]
  diff: string
  truncated: boolean
}

export type Message = {
  id: string
  text: string
  at: number
  status: 'queued' | 'delivered'
  deliveredAt?: number
  // The hook reply that carried it: after a tool call, with a prompt, or instead of stopping.
  via?: 'tool' | 'prompt' | 'stop'
}

// 'ask': reads freely; anything more becomes an Allow/Deny card in the page.
export type TaskLevel = 'read' | 'ask' | 'edit' | 'run'
// 'default', a family alias ('opus' = its latest) or a full model ID.
export type TaskModel = string
export type TaskEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// A headless Claude Code session started from the page.
export type Task = {
  id: string
  cwd: string
  prompt: string
  level: TaskLevel
  model: TaskModel
  effort?: TaskEffort
  // The models that actually answered, from claude's own report.
  usedModels?: string[]
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  result?: string
  error?: string
  sessionId?: string
  costUsd?: number
  // Follow-ups after the first answer, each resuming the same session.
  turns?: TaskTurn[]
}

// A Claude Code session that lives in the app: one long-running claude process
// in streaming mode (stream-json in and out, permissions through the app), so
// a message reaches it at any time, idle or busy.
export type AppSession = {
  // Ours; stable across restarts of the claude process.
  id: string
  // Claude Code's session id, once its first message arrives (changes on a fork).
  sessionId?: string
  cwd: string
  // What the page shows: the first prompt, cut, or the folder.
  title: string
  // The name, colour and hat picked for it in the New session form.
  look?: Look
  level: TaskLevel
  model: TaskModel
  effort?: TaskEffort
  // starting → working ⇄ idle; asleep = no process (it wakes on the next
  // message by resuming); ended = stopped by you; failed = it couldn't run.
  status: 'starting' | 'working' | 'idle' | 'asleep' | 'ended' | 'failed'
  startedAt: number
  lastAt: number
  costUsd?: number
  usedModels?: string[]
  // Claude's reply as it streams, until the turn's message is complete.
  live?: string
  // Messages sent while it was busy, waiting for the next turn.
  queued?: number
  error?: string
  // The session it was forked from by "Continue in the app".
  forkedFrom?: string
}

export type TaskTurn = {
  prompt: string
  at: number
  endedAt?: number
  result?: string
  error?: string
  costUsd?: number
}

// A repository other than Manhattan's and the borough it lives in (or `@<root>`
// while it waits at the station for one). One that has packed up (`left`) is
// still known: it moves straight back in, to the same borough when nobody else
// has, as soon as a session works there again. Its census is what its
// borough's buildings show.
export type Repo = {
  root: string
  name: string
  burb: Burb
  lastSeen: number
  left?: number
  census?: Census
  // Folders the person moved, by path: the grid point (a plot's middle) their
  // houses stand from. Reset when the repository moves to another borough.
  pins?: Pins
  // Folders it is about to get, drawn as blueprints (src/blueprints.ts).
  blueprints?: Blueprint[]
  // The project it belongs to: git's common directory, lowercased, which
  // every worktree of one repository shares. '' when it isn't in git. The
  // server fills it in; until then it is absent.
  project?: string
}

// A planned folder: named in a plan, or being written by a session; when it
// was last named or worked on.
export type Blueprint = { path: string; at: number; from: 'plan' | 'work' }

export type Pins = Record<string, [number, number]>

// What a borough's repository holds and what is going on in it, from git
// (src/census.ts). Each block is a folder ('' for the root's own files, '…'
// for the smallest ones together), drawn as a run of the borough's houses.
export type Block = {
  path: string
  files: number
  bytes: number
  // Commits that touched it in the last two weeks, and the latest of them.
  commits: number
  lastAt?: number
  // Files in it with uncommitted changes.
  dirty: number
  // The latest commit that touched it, ever: a folder quiet for months weathers.
  touchedAt?: number
  // Its most common file extension.
  ext?: string
}

export type Census = {
  at: number
  head?: string
  branch?: string
  // Commits ahead of and behind the branch's upstream, when it has one.
  ahead?: number
  behind?: number
  files: number
  bytes: number
  // Commits in the last two weeks, and files with uncommitted changes.
  commits: number
  dirty: number
  last?: { at: number; who: string; subject: string }
  blocks: Block[]
  // The repository's pins (Repo.pins), carried along for placing its houses.
  pins?: Pins
}

export type Conflict = {
  id: string
  agentId: string
  agentName: string
  files: string[]
  command: string
  at: number
}

export type Ask = { id: string; agentId: string; label: string; at: number }

// A taxi across town: a finished subagent's report going back to its lead, or
// a message from one agent to another.
export type Ride = { at: number; from: Place; to: Place; color: string; kind: 'report' | 'message' }

// The latest commit or push: the Statue of Liberty hops for one, launches for the other.
export type Launch = { kind: 'commit' | 'push'; at: number; who: string; repo: string }

export type World = {
  // Home: the first repository the city saw. Its agents work on the island,
  // at the landmarks; every other repository gets a borough. It never moves.
  home: string
  homeRoot: string
  repos: Repo[]
  sessions: Session[]
  agents: Agent[]
  conflicts: Conflict[]
  asks: Ask[]
  launch?: Launch
  // Taxis on the road now (each lasts a few seconds).
  rides?: Ride[]
  // Trains boarding or pulling out of Grand Central.
  trains?: Train[]
  // Tasks started from the page, newest last (the last 20).
  tasks?: Task[]
  // Sessions that live in the app, newest last.
  appSessions?: AppSession[]
  // The onboarding game: when each landmark went up. Absent in a city saved
  // before the game existed, which counts as fully built.
  built?: Partial<Record<Landmark, number>>
  // When each landmark was first used after it went up ("opened its doors"),
  // and when the person laid their first road: the quests read them.
  opened?: Partial<Record<Landmark, number>>
  firstRoad?: number
  // When Liberty's torch was lit (the first push): the one landmark with no
  // building of its own.
  torch?: number
  // Act two of the onboarding (docs/onboarding.md): when each of the app's
  // own features was first used.
  feats?: Partial<Record<Feat, number>>
  // The plan last approved from plan mode, posted at City Hall.
  zoning?: { title: string; plan: string; by: string; at: number }
  // The City Treasury's books: what was spent each day (local dates), in all,
  // and each cost report's last running total (to take only what it adds).
  // The ledger is each session's account, kept after the session leaves.
  treasury?: { days: Record<string, number>; total: number; last: Record<string, number>; ledger?: Record<string, LedgerEntry> }
  // The plan's usage limits as Claude Code last reported them (Pro, Max and
  // Ultra plans, or a gateway's spend limit), from the status line.
  limits?: Limits
  // Where the conversations of sessions that have left the city are, by
  // session id, so the page can still read them (the most recent 200).
  pastSessions?: Record<string, PastSession>
  // Local servers a session started (a front end on localhost): each is a
  // billboard in its project's part of the city while it answers.
  billboards?: Billboard[]
  // Dev servers started with no address in sight (`npm run dev` in the
  // background): the server watches the usual ports for one to open.
  devHints?: DevHint[]
  // Each project's construction site, by repository root.
  sites?: Site[]
  // Power lines between projects worked on together.
  links?: Link[]
  // Cumulative tool calls: the filler blocks grow with it.
  population?: number
  // What stands where (docs/city-builder.md). A city saved before layouts
  // existed gets the Manhattan preset on load.
  layout?: Layout
  // Once the boroughs were moved off the hub island and each project's
  // worktrees gathered into one borough (2026-11-05): done once per city.
  regrouped?: true
  flushedAt: number
}
