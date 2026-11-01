export type District =
  | 'hall'
  | 'library'
  | 'workshop'
  | 'foundry'
  | 'harbor'
  | 'observatory'
  | 'relay'
  | 'plaza'

// The boroughs a repository other than Manhattan's moves into.
export type Burb = 'brooklyn' | 'queens' | 'bronx' | 'jersey'

export type View = 'island' | 'uptown' | 'midtown' | 'downtown'

export type AgentStatus = 'working' | 'idle' | 'waiting' | 'done' | 'failed'

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
  activity: string
  tools: number
  inFlight: number
  startedAt: number
  updatedAt: number
}

export type Session = {
  id: string
  name: string
  cwd: string
  // The repository root it started in, or its folder when that is none.
  root: string
  color: string
  // Its subway bullet: a letter in a circle of its color, shared by its agents.
  bullet?: string
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

export type TaskTurn = {
  prompt: string
  at: number
  endedAt?: number
  result?: string
  error?: string
  costUsd?: number
}

export type Repo = { root: string; name: string; burb: Burb; lastSeen: number }

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
  // The repository drawn as Manhattan.
  home: string
  homeRoot: string
  // True once the person picked Manhattan themselves.
  homePinned?: boolean
  repos: Repo[]
  sessions: Session[]
  agents: Agent[]
  conflicts: Conflict[]
  asks: Ask[]
  launch?: Launch
  // Taxis on the road now (each lasts a few seconds).
  rides?: Ride[]
  // Tasks started from the page, newest last (the last 20).
  tasks?: Task[]
  flushedAt: number
}
