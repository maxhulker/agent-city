import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BURBS, LABELS, VIEWS, renderCity } from './city.ts'
import type { View, World } from './types.ts'
import { City, forgetRoots } from './world.ts'
import type { HookEvent } from './world.ts'

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

function save() {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(city.world))
  } catch (err) {
    console.error('agent-city: could not save state:', err)
  }
}

// ---- streaming frames to the page -----------------------------------------

type Client = { res: ServerResponse; view: View }
const clients = new Set<Client>()

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
    conflicts: world.conflicts,
    asks: world.asks.map(q => ({ ...q, who: world.agents.find(a => a.id === q.agentId)?.name ?? '' })),
    log: city.log.slice(-30).reverse(),
    toasts: city.toasts.splice(0),
  }
}

function send(client: Client, world: World, animateWalks: boolean, info: ReturnType<typeof meta>) {
  const svg = renderCity(world, Date.now(), { animateWalks, view: client.view })
  client.res.write(`data: ${JSON.stringify({ svg, meta: info })}\n\n`)
}

function broadcast(animateWalks: boolean) {
  const info = meta(city.world)
  for (const client of clients) send(client, city.world, animateWalks, info)
}

let lastSave = 0
setInterval(() => {
  const now = Date.now()
  if (city.isDirty) {
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
      city.apply(ev, Date.now())
      // An empty answer: the hook decides nothing, Claude Code carries on.
      return reply(res, 200, '{}')
    }
    if (req.method === 'POST' && (url.pathname === '/resolve' || url.pathname === '/home')) {
      if (!origin || !ORIGINS.has(origin)) return reply(res, 403, '{}')
      const args = JSON.parse((await body(req, 64 * 1024)) || '{}') as { id?: string; root?: string; auto?: boolean }
      if (url.pathname === '/resolve') city.resolve(args.id)
      else if (args.auto) city.autoHome()
      else if (args.root) city.makeHome(args.root, Date.now(), true)
      return reply(res, 200, '{}')
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      const view = (url.searchParams.get('view') ?? 'island') as View
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      const client: Client = { res, view: view in VIEWS ? view : 'island' }
      clients.add(client)
      send(client, city.world, false, meta(city.world))
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(client)
      })
      return
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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    save()
    process.exit(0)
  })
}
