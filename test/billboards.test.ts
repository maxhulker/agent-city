import test from 'node:test'
import assert from 'node:assert/strict'

import { devCommand, hostOf, localUrls, portOf, titleOf, watchedTool } from '../src/billboards.ts'
import { renderFrame } from '../src/city.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Billboards: a session's local server (a front end on localhost) goes up as
// a billboard in its project's part of the city while it answers, glowing
// until the person first opens it.

test('local addresses are found in a server\'s output, one per port', () => {
  const vite = '  VITE v6.0.0  ready in 300 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose'
  assert.deepEqual(localUrls(vite), [{ url: 'http://localhost:5173/', port: 5173 }])
  assert.deepEqual(localUrls('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...'), [{ url: 'http://localhost:8000/', port: 8000 }])
  assert.deepEqual(localUrls('ready - started server on http://127.0.0.1:3000.'), [{ url: 'http://localhost:3000/', port: 3000 }], 'no trailing dot')
  assert.deepEqual(localUrls('open http://[::1]:4321/docs/intro and http://localhost:4321/'), [{ url: 'http://localhost:4321/docs/intro', port: 4321 }], 'first seen, once per port')
  assert.deepEqual(localUrls('https://localhost/app'), [{ url: 'https://localhost:443/app', port: 443 }])
  assert.deepEqual(localUrls('see https://example.com:3000/ or localhost:3000'), [], 'only a full local URL')
})

test('dev commands are recognised, with their port when they name one', () => {
  assert.deepEqual(devCommand('npm run dev'), {})
  assert.deepEqual(devCommand('cd web && pnpm dev'), {})
  assert.deepEqual(devCommand('npx vite --port 4000'), { port: 4000 })
  assert.deepEqual(devCommand('PORT=3005 npm start'), { port: 3005 })
  assert.deepEqual(devCommand('python -m http.server 8000'), { port: 8000 })
  assert.deepEqual(devCommand('python manage.py runserver 0.0.0.0:8001'), { port: 8001 })
  assert.deepEqual(devCommand('next dev -p 3100'), { port: 3100 })
  assert.equal(devCommand('git status'), undefined)
  assert.equal(devCommand('npm test'), undefined)
  assert.equal(devCommand('npm install vite'), undefined)
})

test('the helpers: which tools are watched, hosts, ports and titles', () => {
  for (const t of ['Bash', 'PowerShell', 'BashOutput', 'mcp__Claude_Preview__preview_start', 'mcp__claude-in-chrome__navigate', 'WebFetch']) assert.ok(watchedTool(t), t)
  for (const t of ['Read', 'Grep', 'Edit', 'Write', 'Glob']) assert.ok(!watchedTool(t), t)
  assert.equal(hostOf('http://localhost:5173/x'), 'localhost:5173')
  assert.equal(portOf('http://localhost:5173/x'), 5173)
  assert.equal(portOf('https://localhost/'), 443)
  assert.equal(titleOf('<html><head><title>\n  My &amp; App </title>'), 'My & App')
  assert.equal(titleOf('<p>no title</p>'), '')
})

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/web'

function ev(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: 'S1', cwd: HOME, ...extra }
}
function run(city: City, tool: string, input: Record<string, unknown>, response: unknown, now: number) {
  const extra = { tool_name: tool, tool_use_id: `t-${now}`, tool_input: input }
  city.apply(ev('PreToolUse', extra), now)
  city.apply(ev('PostToolUse', { ...extra, tool_response: response }), now + 10)
}
function started(): City {
  const city = new City()
  city.buildAll(T0 - 60_000)
  city.ignorePorts.add(4777)
  city.apply(ev('SessionStart'), T0)
  run(city, 'Read', { file_path: `${HOME}/a.ts` }, 'ok', T0 + 10)
  return city
}
const boards = (city: City, now: number) => renderFrame(city.world, now).overlay.filter(i => i.k.startsWith('billboard:'))

test('a server a session starts goes up as a billboard once it answers, glows until opened, and comes down when it stops', () => {
  const city = started()
  run(city, 'Bash', { command: 'npm run dev', run_in_background: true }, '  ➜  Local:   http://localhost:5173/', T0 + 100)
  const probe = city.billboardsToProbe(T0 + 200)
  assert.deepEqual(probe.map(b => b.url), ['http://localhost:5173/'])
  assert.equal(boards(city, T0 + 200).length, 0, 'nothing stands until it answers')

  const id = probe[0]!.id
  city.billboardProbed(id, true, T0 + 300, 'My App')
  const b = city.world.billboards![0]!
  assert.equal(b.up, T0 + 300)
  assert.equal(b.builtAt, T0 + 300)
  assert.equal(b.title, 'My App')
  assert.ok(city.toasts.some(t => /billboard went up for web: localhost:5173/.test(t)))
  let svg = boards(city, T0 + 400)[0]!.svg
  assert.match(svg, /data-url="http:\/\/localhost:5173\/"/)
  assert.match(svg, /NEW · CLICK TO OPEN/)
  assert.match(svg, /My App/)

  assert.equal(city.openBillboard(id, T0 + 500), true)
  svg = boards(city, T0 + 600)[0]!.svg
  assert.doesNotMatch(svg, /NEW · CLICK TO OPEN/, 'no glow once opened')
  assert.doesNotMatch(svg, /<animate/)
  assert.equal(city.openBillboard('nope', T0 + 500), false)

  for (let i = 0; i < 2; i++) city.billboardProbed(id, false, T0 + 700 + i)
  assert.equal(boards(city, T0 + 800).length, 1, 'a miss or two is not enough')
  city.billboardProbed(id, false, T0 + 900)
  assert.equal(boards(city, T0 + 1000).length, 0, 'down after three')
  assert.ok(city.billboardsToProbe(T0 + 1000).length, 'still tried a while')

  const toastsBefore = city.toasts.length
  city.billboardProbed(id, true, T0 + 1100)
  assert.equal(boards(city, T0 + 1200).length, 1, 'back up when it answers again')
  assert.equal(city.world.billboards![0]!.builtAt, T0 + 300, 'built once')
  assert.equal(city.toasts.length, toastsBefore, 'no new toast for a return')
  assert.doesNotMatch(boards(city, T0 + 1200)[0]!.svg, /NEW/)
})

test('only real servers count: no file tools, not Crosswalk\'s own port, and a long-dark one is forgotten', () => {
  const city = started()
  run(city, 'Read', { file_path: `${HOME}/README.md` }, 'Open http://localhost:3000/ to see it', T0 + 100)
  run(city, 'Bash', { command: 'curl -s http://127.0.0.1:4777/state.json' }, '{}', T0 + 200)
  assert.equal(city.world.billboards?.length ?? 0, 0)
  run(city, 'Bash', { command: 'python -m http.server 8000' }, '', T0 + 300)
  assert.deepEqual(city.world.billboards!.map(b => b.url), ['http://localhost:8000/'], 'a port named in the command')
  assert.equal(city.billboardsToProbe(T0 + 3 * 60_000 + 400).length, 0, 'not tried once it has had its chance')
  assert.equal(city.billboardsToProbe(T0 + 25 * 3600_000).length, 0)
  assert.equal(city.world.billboards!.length, 0, 'forgotten after a day dark')
})

test('a dev command with no address in sight is a hint for the server to watch the usual ports, handed out once', () => {
  const city = started()
  run(city, 'Bash', { command: 'npm run dev', run_in_background: true }, 'Command running in background with ID: b1', T0 + 100)
  const hints = city.takeDevHints(T0 + 200)
  assert.equal(hints.length, 1)
  assert.equal(hints[0]!.root, HOME)
  assert.equal(city.takeDevHints(T0 + 300).length, 0)
  city.spotBillboard(HOME, 'http://localhost:5174/', T0 + 400)
  assert.deepEqual(city.billboardsToProbe(T0 + 500).map(b => b.url), ['http://localhost:5174/'])
})
