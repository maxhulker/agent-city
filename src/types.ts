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
  flushedAt: number
}
