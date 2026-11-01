import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BLUEPRINTS, BURBS, LABELS, LANDMARKS, renderCity } from './city.ts'
import { Approvals } from './approvals.ts'
import { changesIn } from './changes.ts'
import { hooksInstalled } from './install.ts'
import { AppSessions } from './sessions.ts'
import { Tasks } from './tasks.ts'
import { readConversation } from './transcripts.ts'
import { Updates } from './updates.ts'
import type { Agent, Decision, District, Task, World } from './types.ts'
import { base, City, forgetRoots, SCAFFOLD_MS } from './world.ts'
import type { HookEvent, TickerItem } from './world.ts'

// Agent City: a local server Claude Code sessions post their hook events to,
// and a page that draws every session at work in one isometric Manhattan.

export const PORT = Number(process.env.AGENT_CITY_PORT ?? 4777)
const HOST = '127.0.0.1'
const STATE_DIR = join(homedir(), '.agent-city')
const STATE_FILE = join(STATE_DIR, 'state.json')
const PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html')
const ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`])

function loadWorld(): World | undefined {
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as World
    return Array.isArray(saved.sessions) && Array.isArray(saved.agents) ? saved : undefined
  } catch {
    return undefined
  }
}

// The page compares this to reload itself after a restart.
const BOOT = Date.now()
const city = new City(loadWorld())

// Tasks live in the world so state.json keeps them; the list itself is Tasks'.
const AMBER = '#fbbf24'
const ENDS = { done: 'FINISHED', failed: 'FAILED', stopped: 'STOPPED' } as const
const tasks = new Tasks(city.world.tasks, (task, what) => {
  city.world.tasks = tasks.list
  const folder = base(task.cwd)
  const text = what === 'start' ? `STARTED A TASK IN ${folder}` : `TASK IN ${folder} ${ENDS[what]}`
  city.announce('YOU', text, '★', AMBER, Date.now())
  // A finished task is worth keeping straight away, not at the next five-second save.
  if (what !== 'start') save()
})
city.world.tasks = tasks.list

// Permission prompts, questions and plans waiting on the page; any change redraws.
const approvals = new Approvals(() => {
  city.isDirty = true
})

// Sessions that live in the app: one streaming claude process each.
const appSessions = new AppSessions(city.world.appSessions, (_s, what) => {
  city.world.appSessions = appSessions.list()
  city.isDirty = true
  // Worth keeping straight away when a turn ends or a session starts or ends.
  if (what === 'result' || what === 'start' || what === 'ended' || what === 'failed') save()
})
city.world.appSessions = appSessions.list()

// New versions on GitHub's main: the page's Update button.
const updates = new Updates(join(dirname(fileURLToPath(import.meta.url)), '..'), () => {
  city.isDirty = true
})

// Whether Claude Code's settings carry our hooks: the welcome card says so,
// and the rails into Grand Central are laid when they do.
let connected = hooksInstalled()
setInterval(() => {
  const now = hooksInstalled()
  if (now !== connected) {
    connected = now
    city.isDirty = true
  }
}, 5_000)

function save() {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(city.world))
  } catch (err) {
    console.error('agent-city: could not save state:', err)
  }
}

// ---- streaming frames to the page -----------------------------------------

type Client = { res: ServerResponse }
const clients = new Set<Client>()

// Folders the page offers for a new task: Manhattan, the boroughs, and wherever sessions run.
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
function tickerNow(world: World, now: number): TickerItem[] {
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

// The onboarding game, for the Blueprints card, the welcome and the header.
function game(world: World, now: number) {
  const built = world.built ?? {}
  return {
    population: world.population ?? 0,
    complete: built.empire !== undefined,
    welcome: city.isNew,
    connected,
    landmarks: LANDMARKS.map(id => {
      const at = built[id]
      const state = at === undefined ? 'blueprint' : now - at < SCAFFOLD_MS ? 'building' : 'built'
      return { id, ...BLUEPRINTS[id], state, ...(at === undefined ? {} : { at }) }
    }),
  }
}

function meta(world: World) {
  return {
    home: world.home,
    homeRoot: world.homeRoot,
    homePinned: !!world.homePinned,
    boot: BOOT,
    repos: world.repos.map(r => ({ ...r, borough: BURBS[r.burb].name })),
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
            ? `${BURBS[a.burb].name} (${world.repos.find(r => r.burb === a.burb)?.name ?? 'another repo'})`
            : LABELS[a.at],
        })),
    })),
    ticker: tickerNow(world, Date.now()),
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
    pending: [...approvals.list(), ...appSessions.pending()],
    appSessions: appSessions.list(),
    update: updates.state,
    game: game(world, Date.now()),
  }
}

function send(client: Client, world: World, animateWalks: boolean, info: ReturnType<typeof meta>) {
  const u = updates.state
  const blocked = u.dirty ? 'this copy has local changes' : u.ahead > 0 ? "this copy has commits that aren't on main yet" : undefined
  const update = { available: u.available, behind: u.behind, ...(u.latest ? { latest: u.latest } : {}), ...(blocked ? { blocked } : {}) }
  const svg = renderCity(world, Date.now(), { animateWalks, update, connected })
  client.res.write(`data: ${JSON.stringify({ svg, meta: info })}\n\n`)
}

function broadcast(animateWalks: boolean) {
  const info = meta(city.world)
  for (const client of clients) send(client, city.world, animateWalks, info)
}

let lastSave = 0
setInterval(() => {
  const now = Date.now()
  // A train due to leave, or to be gone, is a change too.
  if (city.isDirty || city.due(now)) {
    city.flush(now)
    broadcast(true)
    if (now - lastSave > 5000) {
      save()
      lastSave = now
    }
  }
}, 800)
// Prunes quiet sessions, and keeps the page's clocks honest.
setInterval(() => {
  city.isDirty = true
}, 60_000)
setInterval(forgetRoots, 10 * 60_000)

// ---- http -----------------------------------------------------------------

function body(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
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

  try {
    if (req.method === 'POST' && url.pathname === '/hook') {
      // Claude Code posts with no Origin; a web page always sends one.
      if (origin) return reply(res, 403, '{}')
      const text = await body(req)
      // AGENT_CITY_DEBUG=1 keeps every event as it came, for checking what a session sends.
      if (process.env.AGENT_CITY_DEBUG) appendFileSync(join(STATE_DIR, 'events.log'), text.replace(/\n/g, ' ') + '\n')
      const ev = JSON.parse(text) as HookEvent
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
    if (req.method === 'POST' && (url.pathname.startsWith('/message') || url.pathname.startsWith('/task') || url.pathname.startsWith('/app/') || url.pathname === '/decide')) {
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
          return reply(res, 200, JSON.stringify({ ok: true, id: task.id }))
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err))
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
        const id = String(args.id)
        const done = id.startsWith('app:') ? appSessions.decide(id, decision) : approvals.decide(id, decision)
        return done ? reply(res, 200, '{"ok":true}') : fail('That request is no longer waiting')
      }
      if (url.pathname.startsWith('/app/')) {
        try {
          const now = Date.now()
          if (url.pathname === '/app/start') {
            const s = appSessions.start(args as Parameters<AppSessions['start']>[0], now)
            return reply(res, 200, JSON.stringify({ ok: true, id: s.id }))
          }
          if (url.pathname === '/app/send') appSessions.send(String(args.id), String(args.text ?? ''), now)
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
    if (
      req.method === 'POST' &&
      (url.pathname === '/resolve' || url.pathname === '/home' || url.pathname === '/sendhome' || url.pathname === '/lastcall' || url.pathname === '/rebuild' || url.pathname === '/buildall')
    ) {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 64 * 1024)) || '{}') as { id?: string; root?: string; auto?: boolean; session?: string }
      // Send home: that session's agents take the train now. Last call: everyone idle does.
      if (url.pathname === '/sendhome') {
        return city.sendHome(args.session, Date.now()) ? reply(res, 200, '{"ok":true}') : reply(res, 400, JSON.stringify({ error: 'No such session' }))
      }
      if (url.pathname === '/lastcall') return reply(res, 200, JSON.stringify({ ok: true, left: city.lastCall(Date.now()) }))
      // The onboarding game: back to bare land, or everything built at once.
      if (url.pathname === '/rebuild' || url.pathname === '/buildall') {
        if (url.pathname === '/rebuild') city.rebuild(Date.now())
        else city.buildAll(Date.now())
        save()
        return reply(res, 200, '{"ok":true}')
      }
      if (url.pathname === '/resolve') city.resolve(args.id)
      else if (args.auto) city.autoHome()
      else if (args.root) city.makeHome(args.root, Date.now(), true)
      return reply(res, 200, '{}')
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      const client: Client = { res }
      clients.add(client)
      send(client, city.world, false, meta(city.world))
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(client)
      })
      return
    }
    // A session's conversation, read from its transcript (a subagent's with &agent=).
    // Read-only, and a page on another site can't read the reply (no CORS headers).
    if (req.method === 'GET' && url.pathname === '/conversation') {
      const s = city.world.sessions.find(one => one.id === url.searchParams.get('session'))
      if (!s) return reply(res, 404, JSON.stringify({ error: 'No such session' }))
      const agent = url.searchParams.get('agent')
      const path = agent ? s.agentTranscripts?.[agent] : s.transcriptPath
      if (!path || !path.endsWith('.jsonl')) return reply(res, 200, JSON.stringify({ entries: [], updatedAt: s.updatedAt }))
      return reply(res, 200, JSON.stringify({ entries: readConversation(path, { limit: 300 }), updatedAt: s.updatedAt }))
    }
    // What a session has changed in its repository.
    if (req.method === 'GET' && url.pathname === '/changes') {
      const s = city.world.sessions.find(one => one.id === url.searchParams.get('session'))
      if (!s) return reply(res, 404, JSON.stringify({ error: 'No such session' }))
      return reply(res, 200, JSON.stringify(await changesIn(s.root)))
    }
    if (req.method === 'GET' && url.pathname === '/state.json') {
      return reply(res, 200, JSON.stringify(city.world, null, 2))
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return reply(res, 200, readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8')
    }
    return reply(res, 404, '{}')
  } catch (err) {
    return reply(res, 400, JSON.stringify({ error: String(err) }))
  }
})

server.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`agent-city: port ${PORT} is in use; is Agent City already running?`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  mkdirSync(STATE_DIR, { recursive: true })
  console.log(`Agent City is running: http://localhost:${PORT}`)
  if (!existsSync(STATE_FILE)) console.log('Waiting for the first Claude Code session to post an event.')
})

function shutdown() {
  tasks.stopAll()
  // App sessions go to sleep; the next message wakes them with their history.
  appSessions.shutdown()
  city.world.appSessions = appSessions.list()
  save()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown()
    process.exit(0)
  })
}

updates.watch()
