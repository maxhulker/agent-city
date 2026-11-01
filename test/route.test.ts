import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { p, walk } from '../src/draw/geo.ts'
import { applyOp, doorOf, hasRoad, manhattanLayout, route, spotFor } from '../src/layout.ts'
import type { Layout } from '../src/layout.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Walking the roads (docs/city-builder.md, step five): a route follows the
// roads the person laid and turns at corners, no road means a straight walk,
// and a kind with no building sends its agents to the station's forecourt.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

function field(): Layout {
  const land: Layout['land'] = []
  for (let y = 0; y < 12; y++) land.push([y, 0, 12])
  return { rev: 0, map: { seed: 1 }, land, park: [], roads: [], zoned: [], buildings: [], boroughs: [] }
}

const ok = (r: ReturnType<typeof applyOp>): Layout => {
  assert.ok('layout' in r, 'error' in r ? r.error : '')
  return r.layout
}

// Every leg runs along one axis, over road segments.
function onRoads(l: Layout, pts: [number, number][]) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!
    const [bx, by] = pts[i]!
    assert.ok(ax === bx || ay === by, `leg ${i} runs along one axis: ${ax},${ay} to ${bx},${by}`)
    if (ax === bx) for (let y = Math.min(ay, by); y < Math.max(ay, by); y++) assert.ok(hasRoad(l, ax, Math.floor(y), 0) || y % 1 !== 0, `avenue at ${ax},${y}`)
    else for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) assert.ok(hasRoad(l, Math.floor(x), ay, 1) || x % 1 !== 0, `street at ${x},${ay}`)
  }
}

test('a route follows the roads and turns at their corners; it prefers fewer corners', () => {
  let l = field()
  // An L: a street along y 0 from x 0 to 6, an avenue at x 6 from y 0 to 6.
  l = ok(applyOp(l, { op: 'road', x: 0, y: 0, dir: 1, len: 6 }))
  l = ok(applyOp(l, { op: 'road', x: 6, y: 0, dir: 0, len: 6 }))
  assert.deepEqual(route(l, [0, 0], [6, 6]), [[0, 0], [6, 0], [6, 6]], 'along the street, round the corner, down the avenue')
  // A grid: with every block open, the way with the fewest corners wins among the shortest.
  for (let y = 2; y <= 6; y += 2) l = ok(applyOp(l, { op: 'road', x: 0, y, dir: 1, len: 6 }))
  for (let x = 0; x < 6; x += 2) l = ok(applyOp(l, { op: 'road', x, y: 0, dir: 0, len: 6 }))
  const r = route(l, [0, 0], [6, 6])!
  assert.equal(r.length, 3, `one corner: ${JSON.stringify(r)}`)
  onRoads(l, r)
  // A door off the road joins it at the nearest point.
  const off = route(l, [0.4, 2], [6, 5.5])!
  assert.deepEqual(off[0], [0.4, 2])
  assert.deepEqual(off[off.length - 1], [6, 5.5])
  onRoads(l, off.slice(1, -1))
  // Nothing joins two roads apart: no route.
  let apart = field()
  apart = ok(applyOp(apart, { op: 'road', x: 0, y: 0, dir: 1, len: 3 }))
  apart = ok(applyOp(apart, { op: 'road', x: 0, y: 8, dir: 1, len: 3 }))
  assert.equal(route(apart, [1, 0], [1, 8]), undefined)
  assert.equal(route(field(), [1, 0], [1, 8]), undefined, 'no roads at all')
})

test('a walk follows the roads between two buildings; with no road it goes straight', () => {
  let l = field()
  l = ok(applyOp(l, { op: 'road', x: 0, y: 2, dir: 1, len: 10 }))
  l = ok(applyOp(l, { op: 'road', x: 10, y: 2, dir: 0, len: 6 }))
  l = ok(applyOp(l, { op: 'road', x: 2, y: 8, dir: 1, len: 8 }))
  l = ok(applyOp(l, { op: 'place', kind: 'library', x: 1, y: 1 })) // its front on the street at y 2
  l = ok(applyOp(l, { op: 'place', kind: 'hall', x: 3, y: 7 })) // its front on the street at y 8
  const lib = l.buildings[0]!
  const hall = l.buildings[1]!
  // A door keeps the hand-drawn spot's place along the front (City Hall's is half a cell east of its lot's middle).
  assert.deepEqual(doorOf(lib), [2, 2])
  assert.deepEqual(doorOf(hall), [4.5, 8])
  assert.deepEqual(spotFor(l, 'library'), [2, 2])
  const w = walk({ at: 'library' }, { at: 'hall' }, [4.5, 8], l)
  // Grid points back from the SVG ones.
  const pts = w.pts.map(([x, y]) => [Math.round(((x / 10 + y / 5) / 2) * 10) / 10, Math.round(((y / 5 - x / 10) / 2) * 10) / 10] as [number, number])
  assert.deepEqual(pts, [[2, 2], [10, 2], [10, 8], [4.5, 8]], `along the street, down the avenue, back along the street: ${JSON.stringify(pts)}`)
  assert.ok(w.dur > 1 && w.dur <= 4.5)
  // The road between them lifted: the walk goes straight, as the crow flies.
  l = ok(applyOp(l, { op: 'unroad', x: 10, y: 2, dir: 0, len: 6 }))
  const straight = walk({ at: 'library' }, { at: 'hall' }, [4.5, 8], l)
  assert.equal(straight.pts.length, 2, JSON.stringify(straight.pts))
  assert.deepEqual(straight.pts[0], p(2, 2).map(v => Math.round(v * 10) / 10))
  assert.deepEqual(straight.pts[1], p(4.5, 8).map(v => Math.round(v * 10) / 10))
})

test('an agent whose kind has no building waits at the station, and moves when the lot is placed', () => {
  const city = new City()
  city.buildAll(T0 - 60_000)
  assert.ok('ok' in city.build({ op: 'remove', id: 'library' }, T0))
  city.apply(ev('SessionStart', 'S1'), T0)
  city.apply(ev('PreToolUse', 'S1', { tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: `${HOME}/a.ts` } }), T0 + 100)
  city.flush(T0 + 100)
  const at = (f: ReturnType<typeof renderFrame>) => {
    const s = f.agents.find(a => a.id === 'lead:S1')!
    return { x: s.x, y: s.y, title: /<title>([^<]*)<\/title>/.exec(s.fig.svg)![1]! }
  }
  const waiting = at(renderFrame(city.world, T0 + 200))
  const station = p(...spotFor(city.world.layout!, 'relay'))
  assert.deepEqual([waiting.x, waiting.y], [Math.round(station[0] * 10) / 10, Math.round(station[1] * 10) / 10], 'on the forecourt')
  assert.ok(waiting.title.includes('no Public Library yet'), waiting.title)
  // The lot goes down (the city: it stands at once), and the reader walks over.
  assert.ok('ok' in city.build({ op: 'place', kind: 'library', x: 7, y: 39 }, T0 + 300))
  city.flush(T0 + 300)
  const there = at(renderFrame(city.world, T0 + 400))
  const door = p(8, 40)
  assert.deepEqual([there.x, there.y], [Math.round(door[0] * 10) / 10, Math.round(door[1] * 10) / 10], 'in front of the Library')
  assert.ok(!there.title.includes('no Public Library yet'))
})

test('on the preset the walks run along its streets and avenues', () => {
  const l = manhattanLayout()
  const w = walk({ at: 'library' }, { at: 'hall' }, [8.5, 56], l)
  const pts = w.pts.map(([x, y]) => [Math.round(((x / 10 + y / 5) / 2) * 10) / 10, Math.round(((y / 5 - x / 10) / 2) * 10) / 10] as [number, number])
  assert.ok(pts.length >= 3, 'it turns at least once')
  onRoads(l, pts)
  // Into Brooklyn, over the bridge.
  const b = walk({ at: 'library' }, { at: 'library', burb: 'brooklyn' }, [24, 58.5], l)
  assert.ok(b.pts.length >= 4)
})
