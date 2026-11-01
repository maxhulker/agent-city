import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { City, WALK_MS } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// The frame contract (docs/frames.md): the still map keeps its hash while
// only activity changes, overlay items keep theirs while they look the same,
// and agents carry their whole walk until it is over.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'
const OTHER = 'C:/fake/other'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

function tool(city: City, sid: string, tool: string, input: Record<string, unknown>, now: number, cwd = HOME) {
  city.apply(ev('PreToolUse', sid, { cwd, tool_name: tool, tool_use_id: `${sid}-${now}`, tool_input: input }), now)
  city.apply(ev('PostToolUse', sid, { cwd, tool_name: tool, tool_use_id: `${sid}-${now}`, tool_input: input, tool_response: {} }), now + 10)
}

// A built city with one session mid-turn at City Hall.
function builtCity(now = T0): City {
  const city = new City()
  city.buildAll(now - 60_000)
  city.apply(ev('SessionStart', 'S1'), now)
  city.apply(ev('UserPromptSubmit', 'S1', { prompt: 'hello' }), now)
  city.flush(now)
  return city
}

const byKey = (f: ReturnType<typeof renderFrame>, k: string) => f.overlay.find(i => i.k === k)

test('the map is the still city and keeps its hash while only the work changes', () => {
  const city = builtCity()
  const quiet = renderFrame(city.world, T0 + 100)
  assert.ok(quiet.map.svg.startsWith('<svg'), 'a whole SVG')
  assert.ok(quiet.map.svg.includes('class="city map"'))
  assert.ok(!quiet.map.svg.includes('<animate'), 'nothing in the map animates')
  assert.ok(quiet.map.svg.includes('<defs>') && quiet.map.svg.includes('url(#sea)'))

  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 1000)
  city.flush(T0 + 1000)
  const busy = renderFrame(city.world, T0 + 1100)
  assert.equal(busy.map.hash, quiet.map.hash, 'reading in the Library leaves the map alone')
  assert.equal(busy.map.svg, quiet.map.svg)
  assert.ok(byKey(busy, 'lm:library')?.svg.includes('<animate'), 'the Library lights up in the overlay instead')
  assert.equal(byKey(quiet, 'lm:library'), undefined, 'and was dark before')
})

test('the map changes when something still changes: a landmark, a borough, the rails', () => {
  const city = new City()
  city.apply(ev('SessionStart', 'S1'), T0)
  city.flush(T0)
  const bare = renderFrame(city.world, T0 + 10, { connected: false })
  const rails = renderFrame(city.world, T0 + 10, { connected: true })
  assert.notEqual(rails.map.hash, bare.map.hash, 'laying the rails')
  assert.ok(rails.map.svg.includes('class="rails"') && !bare.map.svg.includes('class="rails"'))

  city.apply(ev('UserPromptSubmit', 'S1', { prompt: 'hi' }), T0 + 100)
  city.flush(T0 + 100)
  const hall = renderFrame(city.world, T0 + 200, { connected: true })
  assert.notEqual(hall.map.hash, rails.map.hash, 'City Hall went up')
  assert.ok(byKey(hall, 'lm:hall')?.svg.includes('class="scaf"'), 'in scaffolding, which is the overlay\u2019s')
  assert.ok(!hall.map.svg.includes('class="scaf"'))

  // A second session working in another repository moves it into a borough.
  city.apply(ev('SessionStart', 'S2', { cwd: OTHER }), T0 + 1000)
  city.apply(ev('UserPromptSubmit', 'S2', { cwd: OTHER, prompt: 'hi' }), T0 + 1000)
  tool(city, 'S2', 'Read', { file_path: `${OTHER}/a.ts` }, T0 + 1000, OTHER)
  city.flush(T0 + 1000)
  const borough = renderFrame(city.world, T0 + 1100, { connected: true })
  assert.notEqual(borough.map.hash, hall.map.hash, 'a borough moved in')
  assert.ok(byKey(borough, 'burb:brooklyn')?.svg.includes('other'), 'its sign is the overlay\u2019s')
})

test('overlay items are keyed and keep their hash while they look the same', () => {
  const city = builtCity()
  const a = renderFrame(city.world, T0 + 100)
  const b = renderFrame(city.world, T0 + 900)
  const keys = a.overlay.map(i => i.k)
  assert.equal(new Set(keys).size, keys.length, 'keys are unique')
  for (const k of ['cars', 'twinkle', 'spires', 'haze', 'labels', 'zones', 'statue', 'lm:hall']) assert.ok(keys.includes(k), k)
  for (const it of a.overlay) {
    if (it.k === 'zones') continue // the hover text carries "ago" times
    assert.equal(byKey(b, it.k)?.h, it.h, `${it.k} is unchanged by a quiet frame`)
  }
  // The hover zones say who is where; the tooltip markup is theirs.
  assert.ok(byKey(a, 'zones')?.svg.includes('data-tip-title'))
})

test('the Statue is keyed on her launch, not on the clock in her markup', () => {
  const city = builtCity()
  tool(city, 'S1', 'Bash', { command: 'git push' }, T0 + 1000)
  city.flush(T0 + 1000)
  const early = byKey(renderFrame(city.world, T0 + 1500), 'statue')!
  const later = byKey(renderFrame(city.world, T0 + 3500), 'statue')!
  assert.notEqual(early.svg, later.svg, 'the begin offsets count from now')
  assert.equal(early.h, later.h, 'but it is the same launch, so the page keeps it running')
  const rest = byKey(renderFrame(city.world, T0 + 20_000), 'statue')!
  assert.notEqual(rest.h, early.h, 'at rest again')
  assert.ok(rest.svg.includes('class="statue lit"'))
})

test('taxis and fireworks are drawn above the agents', () => {
  const city = builtCity()
  tool(city, 'S1', 'Agent', { prompt: 'look', description: 'Looker' }, T0 + 1000)
  city.apply(ev('SubagentStart', 'S1', { agent_id: 'A1', agent_type: 'Explore' }), T0 + 1100)
  city.apply(ev('SubagentStop', 'S1', { agent_id: 'A1', agent_type: 'Explore' }), T0 + 2000)
  city.flush(T0 + 2000)
  const f = renderFrame(city.world, T0 + 2100)
  const ride = f.overlay.find(i => i.k.startsWith('ride:'))
  assert.ok(ride, 'the report rides back by taxi')
  assert.equal(ride!.top, true)
  city.world.built!.empire = T0 + 2000
  assert.equal(byKey(renderFrame(city.world, T0 + 2100), 'fireworks')?.top, true)
})

test('an agent is a sprite carrying its whole walk until the walk is over', () => {
  const city = builtCity()
  const standing = renderFrame(city.world, T0 + 100)
  const lead = standing.agents.find(a => a.id === 'lead:S1')!
  assert.equal(lead.cls, 'agent working')
  assert.equal(lead.session, 'S1')
  assert.ok(lead.fig.svg.includes('<title>'), 'the figure is the sprite\u2019s')
  assert.equal(lead.walk, undefined, 'it stands at City Hall')

  // A read sends it to the Library: the next flush starts the walk.
  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 1000)
  city.flush(T0 + 1000)
  const walking = renderFrame(city.world, T0 + 1200).agents.find(a => a.id === 'lead:S1')!
  assert.ok(walking.walk, 'the walk is sent')
  assert.equal(walking.walk!.t0, T0 + 1000, 'from when the server saw the move')
  assert.ok(walking.walk!.dur > 1000 && walking.walk!.dur <= 4500)
  const pts = walking.walk!.pts
  assert.ok(pts.length >= 3, 'the grid way, with corners')
  assert.deepEqual(pts[pts.length - 1], [walking.x, walking.y], 'the route ends where the agent stands')
  assert.notDeepEqual(pts[0], [walking.x, walking.y])
  assert.notEqual(walking.fig.h, lead.fig.h, 'the figure changed: it holds a book now')

  // Frames in the middle of the walk still carry the whole route.
  city.flush(T0 + 2000)
  const mid = renderFrame(city.world, T0 + 2000).agents.find(a => a.id === 'lead:S1')!
  assert.deepEqual(mid.walk, walking.walk, 'the same walk, every frame')
  // Once it is over, it is gone.
  city.flush(T0 + 1000 + WALK_MS + 100)
  const arrived = renderFrame(city.world, T0 + 1000 + WALK_MS + 200).agents.find(a => a.id === 'lead:S1')!
  assert.equal(arrived.walk, undefined)
  assert.deepEqual([arrived.x, arrived.y], [walking.x, walking.y])
})

test('a move mid-walk starts a new walk from the move, not from the old start', () => {
  const city = builtCity()
  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 1000)
  city.flush(T0 + 1000)
  tool(city, 'S1', 'Bash', { command: 'ls' }, T0 + 1800)
  city.flush(T0 + 1800)
  const a = renderFrame(city.world, T0 + 1900).agents.find(x => x.id === 'lead:S1')!
  assert.equal(a.walk!.t0, T0 + 1800)
  assert.equal(a.cls, 'agent working')
  // The route is drawn from the Library (where the frame last showed it): the
  // page swaps its first point for where the agent is drawn now.
  const lib = renderFrame(builtLibrary(), T0).agents[0]!
  assert.deepEqual(a.walk!.pts[0], [lib.x, lib.y])
})

// A built city whose lead stands in the Library.
function builtLibrary(): import('../src/types.ts').World {
  const city = builtCity()
  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 1000)
  city.flush(T0 + 1000)
  city.flush(T0 + 1000 + WALK_MS + 100)
  return city.world
}

test('a quiet frame sends the same sprites, so the page redraws nothing', () => {
  const city = builtCity()
  const a = renderFrame(city.world, T0 + 100).agents
  const b = renderFrame(city.world, T0 + 900).agents
  assert.deepEqual(a, b)
})
