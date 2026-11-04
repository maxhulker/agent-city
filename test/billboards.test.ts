import test from 'node:test'
import assert from 'node:assert/strict'

import { devCommand, hostOf, litFor, localUrls, portOf, titleOf, watchedTool } from '../src/billboards.ts'
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

test('the person can move a billboard, turn it, and take it down until its server starts again', () => {
  const city = started()
  run(city, 'Bash', { command: 'npm run dev' }, 'Local: http://localhost:5173/', T0 + 100)
  const id = city.billboardsToProbe(T0 + 200)[0]!.id
  city.billboardProbed(id, true, T0 + 300, 'My App')
  const svg = () => boards(city, T0 + 400)[0]?.svg ?? ''
  assert.match(svg(), /data-bb-edit="1"/, 'its ⚙ for the card')
  assert.match(svg(), /data-face="l"/)
  assert.match(svg(), /skewY\(26\.565\)/, 'facing left by default')

  assert.deepEqual(city.editBillboard({ id, x: 40.3, y: 51.8 }, T0 + 500), { ok: true })
  assert.deepEqual(city.world.billboards![0]!.pos, [40.5, 52], 'to the half cell')
  assert.deepEqual(city.editBillboard({ id, face: 'r' }, T0 + 600), { ok: true })
  assert.match(svg(), /data-face="r"/)
  assert.match(svg(), /skewY\(-26\.565\)/, 'its words on the other face')
  assert.match((city.editBillboard({ id, face: 'up' }, T0) as { error: string }).error, /face/)
  assert.match((city.editBillboard({ id, x: 1e9, y: 0 }, T0) as { error: string }).error, /Not a place/)
  assert.match((city.editBillboard({ id: 'nope' }, T0) as { error: string }).error, /No such billboard/)

  assert.deepEqual(city.editBillboard({ id, destroy: true }, T0 + 700), { ok: true })
  assert.equal(boards(city, T0 + 800).length, 0, 'down while its server runs')
  city.billboardProbed(id, true, T0 + 900)
  assert.equal(boards(city, T0 + 1000).length, 0, 'still down while it keeps answering')
  for (let i = 0; i < 3; i++) city.billboardProbed(id, false, T0 + 1100 + i)
  city.billboardProbed(id, true, T0 + 1200)
  assert.equal(boards(city, T0 + 1300).length, 1, 'up again once the server has stopped and started')
  assert.match(svg(), /data-face="r"/, 'where and how the person left it')
})

test('a billboard placed by hand stands exactly there, and the others keep clear of it', () => {
  const city = started()
  run(city, 'Bash', { command: 'x' }, 'http://localhost:5173/ and http://localhost:5174/', T0 + 100)
  const [a, b] = city.billboardsToProbe(T0 + 200).map(x => x.id)
  city.billboardProbed(a!, true, T0 + 300)
  city.billboardProbed(b!, true, T0 + 310)
  const before = boards(city, T0 + 400).map(i => i.svg)
  city.editBillboard({ id: b, x: 10, y: 20 }, T0 + 500)
  const after = boards(city, T0 + 600)
  assert.equal(after.length, 2)
  assert.notEqual(after.find(i => i.k.endsWith('|5174'))!.svg, before[1], 'it moved')
  assert.equal(after.find(i => i.k.endsWith('|5173'))!.svg, before[0], 'the other stays where it was')
})

test('a billboard glows new until opened, and lights up again whenever it is updated', () => {
  assert.equal(litFor({}), 'new')
  assert.equal(litFor({ openedAt: 5 }), '')
  assert.equal(litFor({ openedAt: 5, updatedAt: 4 }), '')
  assert.equal(litFor({ openedAt: 5, updatedAt: 6 }), 'updated')

  const city = started()
  run(city, 'Bash', { command: 'npm run dev' }, 'Local: http://localhost:5173/', T0 + 100)
  const id = city.billboardsToProbe(T0 + 200)[0]!.id
  city.billboardProbed(id, true, T0 + 300, 'My App')
  const svg = (now: number) => boards(city, now)[0]!.svg
  assert.match(svg(T0 + 400), /NEW · CLICK TO OPEN/)
  city.openBillboard(id, T0 + 500)
  assert.doesNotMatch(svg(T0 + 600), /<animate/, 'plainly lit once opened')

  // A session edits a file in its project: the page has likely changed.
  run(city, 'Edit', { file_path: `${HOME}/src/App.tsx`, old_string: 'a', new_string: 'b' }, 'ok', T0 + 700)
  let s = svg(T0 + 800)
  assert.match(s, /UPDATED · CLICK TO SEE/)
  assert.match(s, /<animate/, 'glowing again')
  assert.doesNotMatch(s, /NEW · CLICK TO OPEN/)
  assert.ok(city.ticker.some(t => /billboard lit up: web changed/i.test(t.text)))
  const ticks = city.ticker.length
  run(city, 'Write', { file_path: `${HOME}/src/b.ts`, content: 'x' }, 'ok', T0 + 900)
  assert.equal(city.ticker.filter(t => /billboard lit up/i.test(t.text)).length, city.ticker.slice(0, ticks).filter(t => /billboard lit up/i.test(t.text)).length, 'one ticker line while it glows, not one per edit')

  city.openBillboard(id, T0 + 1000)
  assert.doesNotMatch(svg(T0 + 1100), /<animate/, 'opened: resting again')

  // Edits elsewhere, and reads here, leave it be.
  run(city, 'Edit', { file_path: 'C:/fake/other/a.ts', old_string: 'a', new_string: 'b' }, 'ok', T0 + 1200)
  run(city, 'Read', { file_path: `${HOME}/src/App.tsx` }, 'ok', T0 + 1300)
  assert.doesNotMatch(svg(T0 + 1400), /<animate/)

  // Its server restarting is an update; so is a new page title.
  for (let i = 0; i < 3; i++) city.billboardProbed(id, false, T0 + 1500 + i)
  city.billboardProbed(id, true, T0 + 1600)
  assert.match(svg(T0 + 1700), /UPDATED · CLICK TO SEE/)
  city.openBillboard(id, T0 + 1800)
  city.billboardProbed(id, true, T0 + 1900, 'My App v2')
  assert.match(svg(T0 + 2000), /UPDATED · CLICK TO SEE/)
  assert.match(svg(T0 + 2000), /My App v2/)
})
