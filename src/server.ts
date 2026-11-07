import { execFile, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connect as netConnect } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cityFor, citiesOf, defaultConfig, HOME, idFor, register, stateDir, stateFile, whoOf } from './cities.ts'
import type { CityConf, Who } from './cities.ts'
import { BLUEPRINTS, LABELS, LANDMARKS, renderFrame } from './city.ts'
import { boroughRect, burbGeo, isWaiting } from './layout.ts'
import { HATS } from './draw/agents.ts'
import { p, placeAt } from './draw/geo.ts'
import { Approvals } from './approvals.ts'
import { DEV_PORTS, portOf, titleOf } from './billboards.ts'
import { CensusTaker } from './census.ts'
import { changesIn } from './changes.ts'
import { IMAGE_MAX, listFolder, lookAt } from './folders.ts'
import { breakGround, checkGround, foundationsPrompt, projectsDir, unbreak } from './groundbreak.ts'
import type { Ground } from './groundbreak.ts'
import { Timelapses } from './timelapse.ts'
import { checkFreight, cloneProject } from './freight.ts'
import type { Freight } from './freight.ts'
import { framesHouses, stageOf } from './draw/timelapse.ts'
import { hooksInstalled, setHooks } from './install.ts'
import { AppSessions } from './sessions.ts'
import { Tasks } from './tasks.ts'
import { findTranscript, listTranscripts, readConversation } from './transcripts.ts'
import { Updates } from './updates.ts'
import { DEMO, DemoPlayer, demoConf, demoFolders, demoWorld } from './demo.ts'
import { imageBlocks, pruneUploads, saveUpload, UPLOAD_MAX } from './uploads.ts'
import { toast } from './notify.ts'
import type { Agent, Decision, District, Task, World } from './types.ts'
import { base, City, forgetRoots, SCAFFOLD_MS } from './world.ts'
import type { HookEvent, TickerItem } from './world.ts'

// Crosswalk: a local server Claude Code sessions post their hook events to,
// and a page that draws every session at work in one isometric city.
// One city per Claude Code config folder (src/cities.ts): the page shows one
// at a time, with a tab for each.

export const PORT = Number(process.env.AGENT_CITY_PORT ?? 4777)
const HOST = '127.0.0.1'
const STATE_DIR = stateDir()
// Files attached in the page (src/uploads.ts); a month's worth is kept.
const UPLOADS = join(STATE_DIR, 'uploads')
pruneUploads(UPLOADS)
const PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html')
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_FILES: Record<string, [string, string]> = {
  '/manifest.webmanifest': [join(APP_ROOT, 'public', 'manifest.webmanifest'), 'application/manifest+json'],
  '/sw.js': [join(APP_ROOT, 'public', 'sw.js'), 'text/javascript; charset=utf-8'],
  '/icon-192.png': [join(APP_ROOT, 'assets', 'icon-192.png'), 'image/png'],
  '/icon-512.png': [join(APP_ROOT, 'assets', 'icon-512.png'), 'image/png'],
  '/favicon.ico': [join(APP_ROOT, 'assets', 'agent-city.ico'), 'image/x-icon'],
}
const RULES = join(dirname(fileURLToPath(import.meta.url)), 'layout.ts')
// Node 22.13 and later strips types at runtime; the typings lag behind it.
const { stripTypeScriptTypes } = nodeModule as unknown as { stripTypeScriptTypes(code: string): string }
const ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`])

function loadWorld(file: string): World | undefined {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as World
    return Array.isArray(saved.sessions) && Array.isArray(saved.agents) ? saved : undefined
  } catch {
    return undefined
  }
}

// The page compares this to reload itself after a restart.
const BOOT = Date.now()
const AMBER = '#fbbf24'
const ENDS = { done: 'FINISHED', failed: 'FAILED', stopped: 'STOPPED' } as const

// Each client remembers which map it has, so the map goes out only when it
// changes (docs/frames.md).
type Client = { res: ServerResponse; mapHash?: string; rev?: number }

// One city and everything it keeps: its world, the tasks, prompts and app
// sessions of its Claude Code, and the pages watching it.
type Town = {
  conf: CityConf
  city: City
  tasks: Tasks
  approvals: Approvals
  appSessions: AppSessions
  // Whether its Claude Code's settings carry our hooks: the welcome card says
  // so, and the rails into Central Station are laid when they do.
  connected: boolean
  // The accounts its sessions have come from lately (email, else
  // organization), for the card that offers one a city of its own.
  accounts: Map<string, { email?: string; org?: string; sessions: Set<string>; lastAt: number }>
  clients: Set<Client>
  lastSave: number
  save(): void
}

const settingsOf = (conf: CityConf) => join(conf.config, 'settings.json')
// A city with a folder of its own has hooks of its own; the rest share the
// folder's plain ones, which must say who their session is for a city that
// claims an account to hear anything.
const isConnected = (conf: CityConf) =>
  conf.id === DEMO ||
  hooksInstalled(settingsOf(conf), conf.ownFolder ? conf.id : HOME, !conf.ownFolder && conf.accounts.length > 0)

function openTown(conf: CityConf): Town {
  const file = stateFile(conf.id)
  // The demo city starts afresh every time and is never saved (src/demo.ts).
  const isDemo = conf.id === DEMO
  const saved = isDemo ? demoWorld() : loadWorld(file)
  const city = new City(saved)
  // Crosswalk's own address is no session's front end.
  city.ignorePorts.add(PORT)
  // A brand-new city starts on land of its own to lay out; the welcome offers others.
  if (!saved) city.newMap(1 + Math.floor(Math.random() * 2147483000), Date.now())
  // The tasks and app sessions started here report here, whatever their
  // account; with a config folder of its own, they run with it.
  const env: Record<string, string> = { AGENT_CITY: conf.id }
  if (conf.ownFolder) env.CLAUDE_CONFIG_DIR = conf.config

  const save = () => {
    if (isDemo) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(city.world))
    } catch (err) {
      console.error('agent-city: could not save state:', err)
    }
  }

  // Tasks live in the world so state.json keeps them; the list itself is Tasks'.
  const tasks = new Tasks(
    city.world.tasks,
    (task, what) => {
      city.world.tasks = tasks.list
      // The Treasury: each turn of a task is its own claude process, its own running total.
      if (task.sessionId) city.spend(`task:${task.id}:${task.turns?.length ?? 0}`, task.costUsd, Date.now(), task.sessionId)
      const folder = base(task.cwd)
      const text = what === 'start' ? `STARTED A TASK IN ${folder}` : `TASK IN ${folder} ${ENDS[what]}`
      city.announce('YOU', text, '★', AMBER, Date.now())
      // A finished task is worth keeping straight away, not at the next five-second save.
      if (what !== 'start') save()
    },
    env,
  )
  city.world.tasks = tasks.list

  // Permission prompts, questions and plans waiting on the page; any change redraws.
  const approvals = new Approvals(() => {
    city.isDirty = true
  })

  // Sessions that live in the app: one streaming claude process each.
  const appSessions = new AppSessions(
    city.world.appSessions,
    (s, what) => {
      city.world.appSessions = appSessions.list()
      // The Treasury: an app session's cost runs on across its processes.
      if (s.sessionId) city.spend(`app:${s.id}`, s.costUsd, Date.now(), s.sessionId)
      // Its look goes on once Claude Code names the session (again after a fork).
      if (what === 'session' && s.sessionId && s.look) city.dress(s.sessionId, s.look)
      city.isDirty = true
      // Worth keeping straight away when a turn ends or a session starts or ends.
      if (what === 'result' || what === 'start' || what === 'ended' || what === 'failed') save()
    },
    env,
    UPLOADS,
  )
  city.world.appSessions = appSessions.list()
  for (const s of appSessions.list()) if (s.sessionId && s.look) city.dress(s.sessionId, s.look)

  return { conf, city, tasks, approvals, appSessions, connected: isConnected(conf), accounts: new Map(), clients: new Set(), lastSave: 0, save }
}

// Every city, home first. One added to ~/.agent-city/cities.json opens
// without a restart; one taken out stays until the next (but hears nothing
// routed by account).
const towns = new Map<string, Town>()
let listed: CityConf[] = []
// The demo city (src/demo.ts): on from the start with `npm run demo` or
// AGENT_CITY_DEMO=1, or from the welcome card; its tab comes after home's.
let demoOn = process.argv.includes('--demo') || process.env.AGENT_CITY_DEMO === '1'
let demoPlayer: DemoPlayer | undefined
function syncTowns() {
  listed = citiesOf()
  if (demoOn) listed.splice(1, 0, demoConf(STATE_DIR))
  for (const conf of listed) {
    const town = towns.get(conf.id)
    if (!town) {
      const opened = openTown(conf)
      towns.set(conf.id, opened)
      if (conf.id === DEMO) demoPlayer = new DemoPlayer(opened.city, demoFolders(join(STATE_DIR, 'demo')), Date.now())
      continue
    }
    if (JSON.stringify(town.conf) !== JSON.stringify(conf)) {
      town.conf = conf
      for (const t of towns.values()) t.city.isDirty = true
    }
  }
}
syncTowns()
setInterval(() => demoPlayer?.step(Date.now()), 250)
const dirtyAll = () => {
  for (const t of towns.values()) t.city.isDirty = true
}

// New versions on GitHub's main: the page's Update button.
const updates = new Updates(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
  dirtyAll,
  // A desktop notification, even with no window open; clicking it opens the city.
  (title, body) => toast(title, body, `http://localhost:${PORT}/`),
)

setInterval(() => {
  syncTowns()
  for (const town of towns.values()) {
    const now = isConnected(town.conf)
    if (now !== town.connected) {
      town.connected = now
      town.city.isDirty = true
    }
  }
}, 5_000)

// ---- streaming frames to the page -----------------------------------------

// What a city has waiting for you, for its tab's badge: prompts, questions,
// plans, agents asking, merge conflicts.
function needsOf(town: Town): number {
  const w = town.city.world
  return town.approvals.list().length + town.appSessions.pending().length + w.asks.length + w.conflicts.length
}

// The tabs: every city listed, with what it has waiting.
function cityTabs(here: Town) {
  return listed.flatMap(conf => {
    const t = towns.get(conf.id)
    return t ? [{ id: conf.id, name: conf.name, color: conf.color, needs: needsOf(t), here: t === here }] : []
  })
}

// When sessions signed in as more than one account have come here in the
// last two hours, the page offers each a city of its own.
const ACCOUNTS_MS = 2 * 60 * 60_000
function accountsHere(town: Town, now: number) {
  const recent = [...town.accounts.entries()].filter(([, a]) => now - a.lastAt < ACCOUNTS_MS)
  if (recent.length < 2) return []
  return recent.sort((a, b) => b[1].lastAt - a[1].lastAt).map(([key, a]) => ({ key, email: a.email, org: a.org, sessions: a.sessions.size, lastAt: a.lastAt }))
}

// Folders the page offers for a new task: home, the boroughs, and wherever sessions run.
function places(world: World): { path: string; name: string }[] {
  const seen = new Set<string>()
  const out: { path: string; name: string }[] = []
  for (const path of [world.homeRoot, ...world.repos.map(r => r.root), ...world.sessions.map(s => s.root)]) {
    if (!path || seen.has(path.toLowerCase())) continue
    seen.add(path.toLowerCase())
    out.push({ path, name: base(path) })
  }
  return out
}

function taskView(t: Task): Task {
  return t.result && t.result.length > 4000 ? { ...t, result: t.result.slice(0, 3999) + '…' } : t
}

// What each district's work is called while it's going on.
const DOING: Record<District, string> = {
  library: 'READING',
  workshop: 'EDITING',
  foundry: 'RUNNING',
  observatory: 'BROWSING',
  relay: 'DISPATCHING',
  harbor: 'RUNNING',
  hall: 'THINKING',
  plaza: 'RESTING',
}
// Routine actions; while their agent is still at work, its live line says it.
const ROUTINE = /^(READ|EDITED|RAN|SEARCHED|BROWSED|SENT A MESSAGE|DISPATCHED)\b/

// The ticker is the news as it happens: each working agent's current action,
// then whatever happened in the last minute. Nothing older.
function tickerNow(city: City, now: number): TickerItem[] {
  const world = city.world
  const live: TickerItem[] = []
  for (const a of world.agents) {
    if (a.status !== 'working' && a.status !== 'waiting') continue
    const s = world.sessions.find(one => one.id === a.session)
    const detail = a.activity
      .replace(/^Thinking:\s*/, '')
      .replace(/^(Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|WebFetch|WebSearch|Bash|PowerShell)\b:?\s*/, '')
    const text = a.status === 'waiting' ? 'NEEDS YOU' : `${DOING[a.at]} ${detail}`.replace(/\s+/g, ' ').trim()
    live.push({ at: a.updatedAt, bullet: s?.bullet ?? '', color: s?.color ?? a.color, who: a.name, text: text.length > 48 ? text.slice(0, 47) + '…' : text })
  }
  const busy = new Set(live.map(i => i.who))
  const recent = city.ticker.filter(i => now - i.at < 60_000 && !(busy.has(i.who) && ROUTINE.test(i.text))).reverse()
  return [...live.sort((a, b) => b.at - a.at), ...recent]
}

// An agent's last stops for its route line: where each was, by name, when,
// and the point on the map (the place's first standing spot).
function routeOf(world: World, a: Agent) {
  return (a.stops ?? []).map(st => {
    const place = st.burb ? { at: st.at, burb: st.burb } : { at: st.at }
    const name = !st.burb ? LABELS[st.at] : isWaiting(st.burb) ? 'Central Station' : `${burbGeo(world.layout, st.burb)?.name ?? 'a borough'}`
    const [x, y] = p(...placeAt(place, 0, world.layout))
    return { name, t: st.t, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  })
}

// The onboarding game, for the Blueprints card, the welcome and the header.
// Whether Claude Code is on this machine: its config folder, or `claude` on
// the PATH. Without it the welcome offers the demo city instead of Connect.
const claudeSeen = new Map<string, { at: number; here: boolean }>()
function claudeHere(conf: CityConf): boolean {
  const seen = claudeSeen.get(conf.config)
  if (seen && Date.now() - seen.at < 30_000) return seen.here
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude']
  const onPath = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').some(dir => dir && names.some(n => existsSync(join(dir, n))))
  const here = conf.id !== DEMO && (existsSync(conf.config) || onPath)
  claudeSeen.set(conf.config, { at: Date.now(), here })
  return here
}

function game({ city, connected, conf }: Town, now: number) {
  const world = city.world
  const built = world.built ?? {}
  return {
    population: world.population ?? 0,
    complete: built.empire !== undefined,
    welcome: city.isWelcome,
    pick: city.isNew,
    connected,
    claude: claudeHere(conf),
    // What Connect changes, said on the welcome before it is clicked.
    settings: join(conf.config, 'settings.json'),
    // A city that claims an account shares the folder's hooks: it connects from the command line.
    canConnect: conf.id !== DEMO && (conf.ownFolder || conf.id === HOME),
    quests: city.quests(),
    acttwo: city.actTwo(),
    treasury: city.treasuryView(now),
    zoning: world.zoning,
    landmarks: LANDMARKS.map(id => {
      const at = built[id]
      const state = at === undefined ? 'blueprint' : now - at < SCAFFOLD_MS ? 'building' : 'built'
      return { id, ...BLUEPRINTS[id], state, ...(at === undefined ? {} : { at }) }
    }),
  }
}

const sameRoot = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// A repository the city knows (one with a borough or waiting for one, or
// home), as the city has it; nothing for any other folder.
function knownRoot(world: World, root: string): string | undefined {
  if (!root) return undefined
  if (world.homeRoot && sameRoot(world.homeRoot, root)) return world.homeRoot
  return world.repos.find(r => sameRoot(r.root, root))?.root
}

function lotsInBorough(world: World, id: string): number {
  const bo = world.layout?.boroughs.find(b => b.id === id)
  if (!bo || !world.layout) return 0
  const [x0, y0, x1, y1] = boroughRect(bo)
  return world.layout.zoned.filter(([x, y]) => x >= x0 && x < x1 && y >= y0 && y < y1).length
}

function meta(town: Town) {
  const { city, tasks, approvals, appSessions } = town
  const world = city.world
  return {
    city: { id: town.conf.id, name: town.conf.name, color: town.conf.color, ownFolder: town.conf.ownFolder, accounts: town.conf.accounts },
    cities: cityTabs(town),
    accounts: accountsHere(town, Date.now()),
    home: world.home,
    homeRoot: world.homeRoot,
    boot: BOOT,
    // A repository waiting at the station for a borough gets the page's New arrival card.
    repos: world.repos.map(r => ({ ...r, borough: burbGeo(world.layout, r.burb)?.name ?? 'Central Station', waiting: isWaiting(r.burb) })),
    // The boroughs nobody lives in now, which the card offers to move into.
    free: (world.layout?.boroughs ?? []).filter(b => !world.repos.some(r => r.burb === b.id && !r.left)).map(b => ({ id: b.id, name: b.name, lots: lotsInBorough(world, b.id) })),
    // How many zoned lots each drawn borough has: none, and its houses have nowhere to go.
    lots: Object.fromEntries((world.layout?.boroughs ?? []).map(b => [b.id, lotsInBorough(world, b.id)])),
    sessions: world.sessions.map(s => ({
      ...s,
      agents: world.agents
        .filter(a => a.session === s.id)
        .map(a => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          color: a.color,
          isMain: a.isMain,
          status: a.status,
          tools: a.tools,
          activity: a.activity,
          where: a.burb
            ? `${burbGeo(world.layout, a.burb)?.name ?? 'Central Station'} (${world.repos.find(r => r.burb === a.burb && !r.left)?.name ?? 'another repo'})`
            : LABELS[a.at],
          ...(a.order ? { order: a.order } : {}),
          route: routeOf(world, a),
        })),
    })),
    ticker: tickerNow(city, Date.now()),
    counts: {
      sessions: world.sessions.length,
      working: world.agents.filter(a => a.status === 'working').length,
      subagents: world.agents.filter(a => !a.isMain && a.status !== 'done' && a.status !== 'failed' && a.status !== 'leaving').length,
    },
    conflicts: world.conflicts,
    asks: world.asks.map(q => ({ ...q, who: world.agents.find(a => a.id === q.agentId)?.name ?? '' })),
    log: city.log.slice(-30).reverse(),
    toasts: city.toasts.splice(0),
    tasks: tasks.list.slice().reverse().map(taskView),
    places: places(world),
    // Where Break ground puts a new project when the person doesn't say.
    projectsDir: projectsDir(world.homeRoot, homedir()),
    pending: [...approvals.list(), ...appSessions.pending()],
    appSessions: appSessions.list(),
    update: updates.state,
    game: game(town, Date.now()),
  }
}

// One frame for everyone watching a city: {map?, overlay, agents, meta}. The
// map rides along only for clients that don't have this one yet.
function broadcast(town: Town, only?: Client) {
  const { city, connected, clients } = town
  const info = meta(town)
  const u = updates.state
  const blocked = !u.available ? undefined : u.dirty ? 'this copy has local changes' : u.ahead > 0 ? "this copy has commits that aren't on main yet" : undefined
  // A pull from main, or (when only this folder moved on) a restart to apply what is here.
  const local = !u.available && !!u.restart
  const latest = u.latest ?? u.restart?.latest
  const update = {
    available: u.available || local,
    behind: u.available ? u.behind : (u.restart?.count ?? 0),
    ...(latest ? { latest } : {}),
    ...(blocked ? { blocked } : {}),
    ...(local ? { local } : {}),
  }
  const frame = renderFrame(city.world, Date.now(), { update, connected })
  const rest = `"overlay":${JSON.stringify(frame.overlay)},"agents":${JSON.stringify(frame.agents)},"meta":${JSON.stringify(info)}}\n\n`
  const map = `"map":${JSON.stringify(frame.map)},`
  // The layout likewise, for clients whose revision is behind.
  const layout = `"layout":${JSON.stringify(frame.layout)},`
  for (const client of only ? [only] : clients) {
    const withMap = client.mapHash !== frame.map.hash
    if (withMap) client.mapHash = frame.map.hash
    const withLayout = client.rev !== frame.layout.rev
    if (withLayout) client.rev = frame.layout.rev
    client.res.write(`data: {${withMap ? map : ''}${withLayout ? layout : ''}${rest}`)
  }
}

// What every city has waiting, as last sent: a change in one city's count
// redraws the others too, for the badge on its tab.
let lastNeeds = ''
setInterval(() => {
  const now = Date.now()
  const needs = [...towns.values()].map(needsOf).join()
  if (needs !== lastNeeds) {
    lastNeeds = needs
    dirtyAll()
  }
  for (const town of towns.values()) {
    const { city } = town
    // A train due to leave, or to be gone, is a change too.
    if (!city.isDirty && !city.due(now)) continue
    city.flush(now)
    broadcast(town)
    if (now - town.lastSave > 5000) {
      town.save()
      town.lastSave = now
    }
  }
}, 800)
// Each borough's repository is counted with git (src/census.ts), often while
// its agents work, so its houses follow its folders and what is happening in them.
const censusTaker = new CensusTaker()
const timelapses = new Timelapses()
setInterval(() => {
  const now = Date.now()
  for (const town of towns.values()) {
    for (const { root, census, busy } of town.city.censusWanted()) {
      if (!censusTaker.due(root, census, busy, now)) continue
      censusTaker
        .take(root, now)
        .then(c => {
          if (c) town.city.setCensus(root, c)
        })
        .catch(err => console.error('agent-city: census failed for', root, err))
    }
  }
}, 5_000)
// Which project each repository belongs to: git's common directory, shared
// by every worktree of one repository ('' outside git, or for a folder that
// is gone). A worktree whose project has a borough is built onto it; and
// once all are known, each city's boroughs are regrouped, once
// (City.regroup: off the hub island, each project's worktrees together).
function projectOf(root: string): Promise<string> {
  return new Promise(done => {
    execFile('git', ['-C', root, 'rev-parse', '--git-common-dir'], { timeout: 5000, windowsHide: true }, (err, out) => {
      if (err || !String(out).trim()) return done('')
      done(resolve(root, String(out).trim()).replace(/\\/g, '/').toLowerCase())
    })
  })
}
let naming = false
setInterval(async () => {
  if (naming) return
  naming = true
  try {
    for (const town of towns.values()) {
      for (const root of town.city.projectsWanted()) town.city.setProject(root, await projectOf(root), repoSize, Date.now())
      if (town.city.regroup(repoSize, Date.now())) town.save()
      if (town.city.pruneSections(Date.now())) town.save()
    }
  } catch (err) {
    console.error('agent-city: naming projects failed:', err)
  } finally {
    naming = false
  }
}, 5_000)
// The billboards' local servers (src/billboards.ts): every few seconds each
// one spotted lately or standing is knocked on, and its page's title read
// once. After a dev command with no address in sight, the usual dev ports
// are watched for two minutes for one that opens (one open before the
// command is not its server).
function portOpen(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const sock = netConnect({ port, host })
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(400, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}
// Dev servers listen on IPv4 or IPv6 localhost, whichever the system resolves first.
const answers = async (port: number) => (await portOpen(port, '127.0.0.1')) || (await portOpen(port, '::1'))
async function pageTitle(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'follow' })
    if (!/html/i.test(r.headers.get('content-type') ?? '')) return ''
    return titleOf((await r.text()).slice(0, 100_000))
  } catch {
    return ''
  }
}
const watches: { town: Town; root: string; until: number; before: Set<number> }[] = []
const openDevPorts = async () => new Set((await Promise.all(DEV_PORTS.map(async p => ((await answers(p)) ? p : 0)))).filter(p => p && p !== PORT))
let probing = false
setInterval(async () => {
  if (probing) return
  probing = true
  try {
    const now = Date.now()
    for (const town of towns.values()) {
      for (const hint of town.city.takeDevHints(now)) watches.push({ town, root: hint.root, until: now + 120_000, before: await openDevPorts() })
      for (const b of town.city.billboardsToProbe(now)) {
        const ok = await answers(portOf(b.url))
        town.city.billboardProbed(b.id, ok, Date.now(), ok && !b.title ? await pageTitle(b.url) : undefined)
      }
    }
    const open = watches.length ? await openDevPorts() : new Set<number>()
    for (let i = watches.length - 1; i >= 0; i--) {
      const wch = watches[i]!
      for (const port of open) {
        if (wch.before.has(port)) continue
        wch.before.add(port)
        wch.town.city.spotBillboard(wch.root, `http://localhost:${port}/`, Date.now())
      }
      if (Date.now() > wch.until) watches.splice(i, 1)
    }
  } catch (err) {
    console.error('agent-city: billboard probe failed:', err)
  } finally {
    probing = false
  }
}, 3_000)
// Prunes quiet sessions, and keeps the page's clocks honest.
setInterval(dirtyAll, 60_000)
setInterval(forgetRoots, 10 * 60_000)

// ---- http -----------------------------------------------------------------

// A repository's tracked files and top-level folders, for sizing its borough;
// nothing when git can't tell (then a middling size is used).
function repoSize(root: string): { files?: number; folders?: number } {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const files = out.split('\0').filter(Boolean)
    const folders = new Set(files.map(f => (f.includes('/') ? f.slice(0, f.indexOf('/')) : '')))
    return { files: files.length, folders: folders.size }
  } catch {
    return {}
  }
}

function body(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
  return bytes(req, limit).then(b => b.toString('utf8'))
}

function bytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function reply(res: ServerResponse, status: number, text: string, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(text)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  // Only this machine's own names: no DNS rebinding.
  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) return reply(res, 403, '{}')
  const origin = req.headers.origin
  // Which city (src/cities.ts). A hook's: the one its session names, its URL
  // names, or its account belongs to. The page's: ?city=<id>, home without one.
  const query = url.searchParams.get('city')
  let who: Who = {}
  let id: string | undefined = query || HOME
  if (url.pathname === '/hook' || url.pathname === '/statusline') {
    who = whoOf(req.headers, listed.find(c => c.id === query)?.config ?? defaultConfig())
    id = cityFor(listed, query, who)
  }
  const town = id ? towns.get(id) : undefined
  if (!town) {
    // A session of a city no longer listed carries on unheard; a page of one goes home.
    if (url.pathname === '/hook') return reply(res, 200, '{}')
    if (url.pathname === '/statusline') return reply(res, 200, '', 'text/plain; charset=utf-8')
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(302, { location: '/' })
      return res.end()
    }
    return reply(res, 404, JSON.stringify({ error: 'No such city' }))
  }
  const { city, tasks, approvals, appSessions } = town
  const save = () => town.save()

  try {
    // The status line Crosswalk installs posts what Claude Code gives it (the
    // session's cost, the plan's limits) and prints the Treasury's line.
    if (req.method === 'POST' && url.pathname === '/statusline') {
      if (origin) return reply(res, 403, '{}')
      let line = ''
      try {
        line = city.statusLine(JSON.parse(await body(req)), Date.now())
      } catch {
        line = '🏦 Crosswalk'
      }
      return reply(res, 200, line, 'text/plain; charset=utf-8')
    }
    if (req.method === 'POST' && url.pathname === '/hook') {
      // Claude Code posts with no Origin; a web page always sends one.
      if (origin) return reply(res, 403, '{}')
      const text = await body(req)
      // AGENT_CITY_DEBUG=1 keeps every event as it came, for checking what a session sends.
      if (process.env.AGENT_CITY_DEBUG) {
        appendFileSync(join(STATE_DIR, 'events.log'), (town.conf.id === HOME ? '' : `[${town.conf.id}] `) + text.replace(/\n/g, ' ') + '\n')
      }
      const ev = JSON.parse(text) as HookEvent
      // The accounts its sessions come from, unless one was placed here by name.
      const account = who.email ?? who.org
      if (account && !who.city && typeof ev.session_id === 'string') {
        const seen = town.accounts.get(account) ?? { ...(who.email ? { email: who.email } : {}), ...(who.org ? { org: who.org } : {}), sessions: new Set<string>(), lastAt: 0 }
        seen.sessions.add(ev.session_id)
        seen.lastAt = Date.now()
        town.accounts.set(account, seen)
      }
      // A prompt answered in the session's own window leaves its card here: clear it.
      approvals.seen(ev)
      if (ev.hook_event_name === 'PermissionRequest') {
        city.apply(ev, Date.now())
        // An app session asks the app directly; the hook stands aside, so no duplicate card.
        if (appSessions.owns(ev.session_id)) return reply(res, 200, '{}')
        // Held open until the page decides, the session goes away, or it expires
        // (then {} lets the session ask in its own window).
        const ac = new AbortController()
        res.on('close', () => {
          if (!res.writableEnded) ac.abort()
        })
        const out = await approvals.hold(ev, Date.now(), ac.signal)
        return reply(res, 200, JSON.stringify(out))
      }
      // Usually {}: the hook decides nothing. With messages waiting, it carries them to the lead.
      return reply(res, 200, JSON.stringify(city.apply(ev, Date.now())))
    }
    // A file attached in the page: the raw bytes, its name in ?name=. The
    // reply's path goes into the message (and, for an image sent to an app
    // session, the picture itself: /app/send's images).
    if (req.method === 'POST' && url.pathname === '/upload') {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      try {
        const data = await bytes(req, UPLOAD_MAX)
        return reply(res, 200, JSON.stringify({ ok: true, ...saveUpload(UPLOADS, url.searchParams.get('name') ?? 'file', data) }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply(res, msg === 'too large' ? 413 : 400, JSON.stringify({ error: msg === 'too large' ? `Files can be up to ${UPLOAD_MAX / 1024 / 1024} MB` : msg }))
      }
    }
    if (req.method === 'POST' && (url.pathname.startsWith('/message') || url.pathname.startsWith('/task') || url.pathname.startsWith('/app/') || url.pathname === '/decide' || url.pathname === '/groundbreak' || url.pathname === '/freight')) {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 256 * 1024)) || '{}') as Record<string, unknown>
      const fail = (error: string) => reply(res, 400, JSON.stringify({ error }))
      if (url.pathname === '/message') {
        const out = city.queueMessage(args.session, args.text, Date.now())
        return 'error' in out ? fail(out.error) : reply(res, 200, JSON.stringify({ ok: true, id: out.id }))
      }
      if (url.pathname === '/message/cancel') {
        return city.cancelMessage(args.session, args.id) ? reply(res, 200, '{"ok":true}') : fail('No such queued message')
      }
      if (url.pathname === '/task') {
        try {
          const task = tasks.start(args, Date.now())
          city.achieve('worksite', Date.now())
          return reply(res, 200, JSON.stringify({ ok: true, id: task.id }))
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
      // Break ground: a new project's folder and repository, its borough, and
      // a session to lay its foundations (src/groundbreak.ts).
      // Freight: a project brought in from its address (src/freight.ts). Its
      // borough is laid out and its train pulls in at once; it is cloned
      // meanwhile, and counted as soon as it is unloaded.
      if (url.pathname === '/freight') {
        let f: Freight
        try {
          f = checkFreight(args, projectsDir(city.world.homeRoot, homedir()))
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
        // Its borough is named as the person said, else after the repository.
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 40) : f.name
        const placed = city.freightArrives(f.path, name, args, Date.now())
        if ('error' in placed) return fail(placed.error)
        save()
        cloneProject(f, error => {
          censusTaker.forget(f.path)
          city.freightDone(f.path, name, placed, error, Date.now())
          save()
        })
        return reply(res, 200, JSON.stringify({ ok: true, root: f.path, borough: placed.borough }))
      }
      if (url.pathname === '/groundbreak') {
        const now = Date.now()
        let ground: Ground
        try {
          ground = checkGround(args, projectsDir(city.world.homeRoot, homedir()))
          breakGround(ground)
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
        const placed = city.groundFor(ground.path, ground.name, args, now)
        if ('error' in placed) {
          unbreak(ground)
          return fail(placed.error)
        }
        save()
        // The ground is broken either way; a session that can't start is said, not undone.
        try {
          const s = appSessions.start({ cwd: ground.path, prompt: foundationsPrompt(ground), level: ground.level, look: { name: ground.name.slice(0, 24), hat: 'hardhat' } }, now)
          city.achieve('worksite', now)
          return reply(res, 200, JSON.stringify({ ok: true, id: s.id, root: ground.path, borough: placed.borough }))
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err)
          return reply(res, 200, JSON.stringify({ ok: true, root: ground.path, borough: placed.borough, warning: `Ground broken at ${ground.path}, but no session started: ${why}` }))
        }
      }
      if (url.pathname === '/decide') {
        const behavior = args.behavior === 'allow' || args.behavior === 'deny' ? args.behavior : undefined
        if (!behavior) return fail('behavior must be allow or deny')
        const decision: Decision = { behavior }
        if (typeof args.message === 'string' && args.message.trim()) decision.message = args.message.trim().slice(0, 2000)
        if (args.answers && typeof args.answers === 'object') {
          decision.answers = Object.fromEntries(
            Object.entries(args.answers as Record<string, unknown>).map(([q, a]) => [q, String(a).slice(0, 2000)]),
          )
        }
        if (behavior === 'allow' && args.always === true) decision.always = true
        const id = String(args.id)
        // Look before deciding: an approved plan is posted at City Hall.
        const asked = [...approvals.list(), ...appSessions.pending()].find(p => p.id === id)
        const done = id.startsWith('app:') ? appSessions.decide(id, decision) : approvals.decide(id, decision)
        if (done) {
          const now = Date.now()
          city.achieve('answer', now)
          if (asked?.kind === 'plan' && behavior === 'allow') city.fileZoningPlan(asked, now)
          save()
        }
        return done ? reply(res, 200, '{"ok":true}') : fail('That request is no longer waiting')
      }
      if (url.pathname.startsWith('/app/')) {
        try {
          const now = Date.now()
          if (url.pathname === '/app/start') {
            const s = appSessions.start(args as Parameters<AppSessions['start']>[0], now, imageBlocks(UPLOADS, args.images))
            city.achieve('worksite', now)
            return reply(res, 200, JSON.stringify({ ok: true, id: s.id }))
          }
          if (url.pathname === '/app/send') appSessions.send(String(args.id), String(args.text ?? ''), now, imageBlocks(UPLOADS, args.images))
          else if (url.pathname === '/app/interrupt') {
            if (!appSessions.interrupt(String(args.id))) return fail('It is not working on anything')
          } else if (url.pathname === '/app/stop') appSessions.stop(String(args.id))
          else return reply(res, 404, '{}')
          return reply(res, 200, '{"ok":true}')
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
      if (url.pathname === '/task/continue') {
        try {
          tasks.continue(args.id, args.prompt, Date.now())
          return reply(res, 200, '{"ok":true}')
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
        }
      }
      if (url.pathname === '/task/stop') {
        const task = tasks.list.find(t => t.id === args.id && t.status === 'running')
        if (!task || !tasks.stop(args.id)) return fail('No such running task')
        // Its session was killed mid-turn and won't say goodbye itself.
        city.endSessionsIn(task.cwd, task.startedAt, Date.now())
        return reply(res, 200, '{"ok":true}')
      }
      return reply(res, 404, '{}')
    }
    // Update to main: check, or pull and restart. The page reloads itself on the new server.
    if (req.method === 'POST' && (url.pathname === '/update' || url.pathname === '/update/check')) {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      if (url.pathname === '/update/check') return reply(res, 200, JSON.stringify(await updates.check()))
      try {
        await updates.apply()
      } catch (err) {
        return reply(res, 400, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
      reply(res, 200, '{"ok":true}')
      // Let the reply go out, put everything away, then hand over to the new version.
      setTimeout(() => {
        shutdown()
        updates.relaunch()
        process.exit(0)
      }, 300)
      return
    }
    // The demo city, from the welcome card: on (its tab opens), or off again.
    // Connect (or disconnect) this city's Claude Code from the page: the same
    // as `npm run connect` (src/install.ts), so nobody needs a terminal.
    if (req.method === 'POST' && url.pathname === '/connect') {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 1024)) || '{}') as { on?: unknown }
      if (town.conf.id === DEMO) return reply(res, 400, JSON.stringify({ error: 'The demo city has no Claude Code to connect' }))
      try {
        const r = setHooks(town.conf, { uninstall: args.on === false })
        town.connected = isConnected(town.conf)
        dirtyAll()
        return reply(res, 200, JSON.stringify({ ok: true, message: r.message, ...(r.backup ? { backup: r.backup } : {}) }))
      } catch (err) {
        return reply(res, 400, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    }
    if (req.method === 'POST' && url.pathname === '/demo') {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 1024)) || '{}') as { on?: unknown }
      demoOn = args.on !== false
      if (!demoOn) {
        towns.delete(DEMO)
        demoPlayer = undefined
      }
      syncTowns()
      dirtyAll()
      return reply(res, 200, JSON.stringify({ ok: true, ...(demoOn ? { href: `/?city=${DEMO}` } : {}) }))
    }
    // Another account's sessions get a city of their own: listed in
    // cities.json, they go there from their next event, and their agents
    // here take the train home.
    if (req.method === 'POST' && url.pathname === '/cities/split') {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 16 * 1024)) || '{}') as { account?: unknown; name?: unknown }
      const account = typeof args.account === 'string' ? args.account : ''
      const seen = town.accounts.get(account)
      if (!seen) return reply(res, 400, JSON.stringify({ error: 'No sessions from that account here lately' }))
      const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 24) : 'Work'
      try {
        const conf = register(idFor(name, listed), { account, name })
        syncTowns()
        const now = Date.now()
        for (const sid of seen.sessions) city.sendHome(sid, now)
        town.accounts.delete(account)
        save()
        return reply(res, 200, JSON.stringify({ ok: true, id: conf.id }))
      } catch (err) {
        return reply(res, 400, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
      }
    }
    if (
      req.method === 'POST' &&
      (url.pathname === '/resolve' || url.pathname === '/sendhome' || url.pathname === '/lastcall' || url.pathname === '/rebuild' || url.pathname === '/buildall' || url.pathname === '/build' || url.pathname === '/newmap' || url.pathname === '/billboard/open' || url.pathname === '/billboard/edit' || url.pathname === '/house')
    ) {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 64 * 1024)) || '{}') as { id?: string; root?: string; auto?: boolean; session?: string }
      // A billboard was opened: it stops glowing.
      if (url.pathname === '/billboard/open') {
        return city.openBillboard(args.id, Date.now()) ? reply(res, 200, '{"ok":true}') : reply(res, 404, '{"error":"No such billboard"}')
      }
      // A house moved on the map (or let go): where its folder stands in its borough.
      if (url.pathname === '/house') {
        const r = city.moveHouse(args)
        if ('error' in r) return reply(res, 400, JSON.stringify(r))
        save()
        return reply(res, 200, '{"ok":true}')
      }
      // Moved, turned or taken down from its card.
      if (url.pathname === '/billboard/edit') {
        const r = city.editBillboard(args, Date.now())
        if ('error' in r) return reply(res, 400, JSON.stringify(r))
        save()
        return reply(res, 200, '{"ok":true}')
      }
      // The city builder: one placement, checked by the layout's rules.
      if (url.pathname === '/build') {
        // "Build it for me" sizes the borough to the repository: git counts it.
        if ((args as { op?: unknown }).op === 'autoborough' && typeof args.root === 'string') Object.assign(args, repoSize(args.root))
        const r = city.build(args, Date.now())
        if ('error' in r) return reply(res, 400, JSON.stringify(r))
        save()
        return reply(res, 200, '{"ok":true}')
      }
      // The welcome's map picker: a new city starts on the map of a seed.
      if (url.pathname === '/newmap') {
        const r = city.newMap((args as { seed?: unknown }).seed, Date.now())
        if ('error' in r) return reply(res, 400, JSON.stringify(r))
        save()
        return reply(res, 200, '{"ok":true}')
      }
      // Send home: that session's agents take the train now. Last call: everyone idle does.
      if (url.pathname === '/sendhome') {
        return city.sendHome(args.session, Date.now()) ? reply(res, 200, '{"ok":true}') : reply(res, 400, JSON.stringify({ error: 'No such session' }))
      }
      if (url.pathname === '/lastcall') return reply(res, 200, JSON.stringify({ ok: true, left: city.lastCall(Date.now()) }))
      // The onboarding game: back to bare land, or everything built at once.
      if (url.pathname === '/rebuild' || url.pathname === '/buildall') {
        // Rebuild starts again on a fresh map to lay out.
        if (url.pathname === '/rebuild') city.restart(1 + Math.floor(Math.random() * 2147483000), Date.now())
        else city.buildAll(Date.now())
        save()
        return reply(res, 200, '{"ok":true}')
      }
      if (url.pathname === '/resolve') city.resolve(args.id)
      return reply(res, 200, '{}')
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      const client: Client = { res }
      town.clients.add(client)
      broadcast(town, client)
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        town.clients.delete(client)
      })
      return
    }
    // A session's conversation, read from its transcript (a subagent's with &agent=).
    // Read-only, and a page on another site can't read the reply (no CORS headers).
    // A session that has left the city is still read: from where the city
    // kept its transcript, else from Claude Code's own folder.
    if (req.method === 'GET' && url.pathname === '/conversation') {
      const id = url.searchParams.get('session') ?? ''
      const agent = url.searchParams.get('agent')
      const s = city.world.sessions.find(one => one.id === id)
      const past = s ? undefined : city.world.pastSessions?.[id]
      const known = s ?? past
      let path = agent ? known?.agentTranscripts?.[agent] : known?.transcriptPath
      if (!s && !path && !agent) path = findTranscript(town.conf.config, id)
      if (!s && !path) return reply(res, 404, JSON.stringify({ error: 'No such session' }))
      const updatedAt = s ? s.updatedAt : past?.leftAt
      if (!path || !path.endsWith('.jsonl')) return reply(res, 200, JSON.stringify({ entries: [], updatedAt }))
      return reply(res, 200, JSON.stringify({ entries: readConversation(path, { limit: 300 }), updatedAt, ...(s ? {} : { gone: true }) }))
    }
    // Earlier sessions, newest first, from Claude Code's own folder: any
    // that are not in the city or the app now, so the page can reopen them.
    if (req.method === 'GET' && url.pathname === '/past') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 30))
      const skip = new Set<string>(city.world.sessions.map(s => s.id))
      for (const a of appSessions.list()) if (a.sessionId) skip.add(a.sessionId)
      return reply(res, 200, JSON.stringify({ sessions: listTranscripts(town.conf.config, { limit, skip, hideUnder: [tmpdir()] }) }))
    }
    // What is inside a house: its folder's files, a look inside one, and an
    // image's bytes (src/folders.ts). Only in the repositories the city
    // knows, and only for the page itself: it sends x-crosswalk, which
    // another site can't without a preflight this server never answers.
    if (req.method === 'GET' && (url.pathname === '/folder' || url.pathname === '/file' || url.pathname === '/file/raw')) {
      if (req.headers['x-crosswalk'] !== '1') return reply(res, 403, '{"error":"Not from the page"}')
      const root = knownRoot(city.world, url.searchParams.get('root') ?? '')
      if (!root) return reply(res, 404, '{"error":"Not a repository the city knows"}')
      const path = url.searchParams.get('path') ?? ''
      if (url.pathname === '/folder') {
        const census = city.world.repos.find(r => sameRoot(r.root, root))?.census
        const keys = census?.blocks.map(b => b.path) ?? []
        if (!keys.includes(path)) return reply(res, 404, '{"error":"No such folder in its census"}')
        return reply(res, 200, JSON.stringify({ root, ...(await listFolder(root, path, keys)) }))
      }
      const look = lookAt(root, path)
      if (!look) return reply(res, 404, '{"error":"No such file"}')
      if (url.pathname === '/file') return reply(res, 200, JSON.stringify(look))
      if (!look.image || look.bytes > IMAGE_MAX) return reply(res, 415, '{"error":"Not an image to show"}')
      res.writeHead(200, { 'content-type': look.image, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" })
      return res.end(readFileSync(look.abs))
    }
    // A borough's time-lapse (src/timelapse.ts): its stage, and its houses at
    // each sampled commit from the first to HEAD. Page only, as the files are.
    if (req.method === 'GET' && url.pathname === '/timelapse') {
      if (req.headers['x-crosswalk'] !== '1') return reply(res, 403, '{"error":"Not from the page"}')
      const repo = city.world.repos.find(r => sameRoot(r.root, url.searchParams.get('root') ?? '') && !r.left)
      const layout = city.world.layout
      const geo = repo && layout ? burbGeo(layout, repo.burb) : undefined
      const stage = repo && layout && geo ? stageOf(layout, repo.burb) : undefined
      if (!repo || !layout || !geo || !stage) return reply(res, 404, '{"error":"Not a repository with a borough"}')
      const frames = await timelapses.of(repo.root)
      if (!frames) return reply(res, 404, '{"error":"It has no commits yet"}')
      return reply(
        res,
        200,
        JSON.stringify({
          name: repo.name,
          borough: geo.name,
          ...stage,
          frames: frames.map(f => ({
            sha: f.sha,
            at: f.at,
            who: f.who,
            subject: f.subject,
            n: f.n,
            total: f.total,
            files: f.census.files,
            bytes: f.census.bytes,
            folders: f.census.blocks.length,
            changed: f.changed.length,
            // Where the person moved folders to holds in every frame.
            houses: framesHouses(layout, repo.burb, repo.pins ? { ...f.census, pins: repo.pins } : f.census, f.changed),
          })),
        }),
      )
    }
    // What a session has changed in its repository.
    if (req.method === 'GET' && url.pathname === '/changes') {
      const id = url.searchParams.get('session') ?? ''
      const root = city.world.sessions.find(one => one.id === id)?.root ?? city.world.pastSessions?.[id]?.root ?? appSessions.list().find(a => a.sessionId === id)?.cwd
      if (!root) return reply(res, 404, JSON.stringify({ error: 'No such session' }))
      return reply(res, 200, JSON.stringify(await changesIn(root)))
    }
    // The hats a new session's lead can wear, for the form's picker.
    if (req.method === 'GET' && url.pathname === '/hats') {
      return reply(res, 200, JSON.stringify(Object.entries(HATS).map(([id, h]) => ({ id, ...h }))))
    }
    if (req.method === 'GET' && url.pathname === '/state.json') {
      return reply(res, 200, JSON.stringify(city.world, null, 2))
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return reply(res, 200, readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8')
    }
    // What makes the page an installable app: its manifest, service worker and icons.
    const asset = APP_FILES[url.pathname]
    if (req.method === 'GET' && asset) {
      res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache' })
      return res.end(readFileSync(asset[0]))
    }
    // The layout's rules, for the page's build cursor: the same file the
    // server checks placements with, as JavaScript (docs/city-builder.md).
    if (req.method === 'GET' && url.pathname === '/layout.js') {
      return reply(res, 200, stripTypeScriptTypes(readFileSync(RULES, 'utf8')), 'text/javascript; charset=utf-8')
    }
    return reply(res, 404, '{}')
  } catch (err) {
    return reply(res, 400, JSON.stringify({ error: String(err) }))
  }
})

server.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`crosswalk: port ${PORT} is in use; is Crosswalk already running?`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  mkdirSync(STATE_DIR, { recursive: true })
  console.log(`Crosswalk is running: http://localhost:${PORT}`)
  if (towns.size > 1) console.log(`Cities: ${[...towns.values()].map(t => `${t.conf.name} (${t.conf.config})`).join(', ')}`)
  if (!existsSync(stateFile(HOME))) console.log('Waiting for the first Claude Code session to post an event.')
})

// How many pages are watching, in every city: the desktop app (src/app.ts)
// quits once its window has closed and nobody is.
export function watching(): number {
  let n = 0
  for (const t of towns.values()) n += t.clients.size
  return n
}

// Everything saved and every process this server started stopped: on a
// signal, and when the desktop app's window closes.
export function shutdown() {
  for (const { tasks, appSessions, city, save } of towns.values()) {
    tasks.stopAll()
    // App sessions go to sleep; the next message wakes them with their history.
    appSessions.shutdown()
    city.world.appSessions = appSessions.list()
    save()
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown()
    process.exit(0)
  })
}

updates.watch()
