import test from 'node:test'
import assert from 'node:assert/strict'

import { applyOp, canPlace, facesRoad, isBridge, manhattanLayout, parseOp } from '../src/layout.ts'
import type { Layout } from '../src/layout.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// The placement rules (docs/city-builder.md): pure, so each is fed a layout
// and an op and asserted on what comes back. A refused op changes nothing.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'
const OTHER = 'C:/fake/api'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

function read(city: City, sid: string, cwd: string, now: number) {
  const extra = { cwd, tool_name: 'Read', tool_use_id: `${sid}-${now}`, tool_input: { file_path: `${cwd}/a.ts` } }
  city.apply(ev('PreToolUse', sid, extra), now)
  city.apply(ev('PostToolUse', sid, { ...extra, tool_response: 'ok' }), now + 10)
}

// A small square of land, roads around a block in the middle, nothing on it.
function field(): Layout {
  const land: Layout['land'] = []
  for (let y = 0; y < 10; y++) land.push([y, 0, 10])
  return { rev: 0, map: { seed: 1 }, land, park: [], roads: [], zoned: [], buildings: [], boroughs: [] }
}

const ok = (r: ReturnType<typeof applyOp>): Layout => {
  assert.ok('layout' in r, 'error' in r ? r.error : '')
  return r.layout
}
const refused = (r: ReturnType<typeof applyOp>, why: string) => {
  assert.ok('error' in r, 'should be refused')
  assert.ok(r.error.length > 0, 'with a message')
  assert.ok(r.error.toLowerCase().includes(why.toLowerCase()), `${r.error} ~ ${why}`)
}

test('the preset could be placed as it stands: every building passes its own rules', () => {
  const l = manhattanLayout()
  for (const b of l.buildings) {
    const rest = { ...l, buildings: l.buildings.filter(one => one !== b) }
    assert.equal(canPlace(rest, b.kind, b.x, b.y, b.face), undefined, b.kind)
  }
})

test('a building needs land, free cells and a road along its front', () => {
  let l = field()
  assert.equal(canPlace(l, 'library', 4, 4), 'No road along its front')
  refused(applyOp(l, { op: 'place', kind: 'library', x: 4, y: 4 }), 'road')
  assert.equal(l.rev, 0, 'a refused op changes nothing')
  l = ok(applyOp(l, { op: 'road', x: 2, y: 5, dir: 1, len: 6 }))
  assert.equal(l.rev, 1)
  l = ok(applyOp(l, { op: 'place', kind: 'library', x: 4, y: 4 }))
  assert.equal(l.rev, 2)
  assert.equal(l.buildings[0]!.id, 'library')
  assert.equal(l.buildings[0]!.built, undefined, 'the layout alone leaves it a lot; the game decides')
  refused(applyOp(l, { op: 'place', kind: 'hall', x: 4, y: 4 }), 'already there')
  refused(applyOp(l, { op: 'place', kind: 'hall', x: 12, y: 4 }), 'land')
  refused(applyOp(l, { op: 'place', kind: 'hall', x: 500, y: 4 }), 'off the map')
  // Facing east, the road must run along the east side.
  assert.equal(canPlace(l, 'hall', 0, 4, 'e'), 'No road along its front')
  l = ok(applyOp(l, { op: 'road', x: 2, y: 3, dir: 0, len: 2 }))
  assert.equal(canPlace(l, 'hall', 0, 4, 'e'), undefined)
  // The Seaport is a pier on the shore; the Statue stands in the water.
  l = ok(applyOp(l, { op: 'road', x: 6, y: 1, dir: 1, len: 4 }))
  refused(applyOp(l, { op: 'place', kind: 'harbor', x: 2, y: 0 }), 'reaches into the water')
  ok(applyOp(l, { op: 'place', kind: 'harbor', x: 8, y: 0 }))
  refused(applyOp(l, { op: 'place', kind: 'liberty', x: 1, y: 1 }), 'in the water')
  ok(applyOp(l, { op: 'place', kind: 'liberty', x: 12, y: 12 }))
  // A second of a kind gets its own id.
  l = ok(applyOp(l, { op: 'place', kind: 'library', x: 6, y: 4 }))
  assert.equal(l.buildings.length, 2)
  assert.notEqual(l.buildings[1]!.id, 'library')
})

test('roads: any length, never through a building or a lot, a bridge over water', () => {
  let l = field()
  l = ok(applyOp(l, { op: 'road', x: 0, y: 5, dir: 1, len: 14 }))
  assert.equal(l.roads.length, 14)
  assert.ok(l.roads.every(r => r[3] === 'street'))
  assert.equal(isBridge(l, [3, 5, 1]), false, 'on land')
  assert.equal(isBridge(l, [12, 5, 1]), true, 'over the water')
  refused(applyOp(l, { op: 'road', x: 0, y: 5, dir: 1, len: 14 }), 'already')
  l = ok(applyOp(l, { op: 'road', x: 4, y: 0, dir: 0, len: 5, kind: 'avenue' }))
  assert.ok(l.roads.some(r => r[0] === 4 && r[1] === 4 && r[2] === 0 && r[3] === 'avenue'))
  l = ok(applyOp(l, { op: 'place', kind: 'foundry', x: 4, y: 3 })) // 4 by 2, facing the street at y 5
  refused(applyOp(l, { op: 'road', x: 6, y: 3, dir: 0 }), 'building is in the way')
  ok(applyOp(l, { op: 'road', x: 8, y: 3, dir: 0 })) // along its east edge: fine
  l = ok(applyOp(l, { op: 'zone', x: 0, y: 4 }))
  refused(applyOp(l, { op: 'road', x: 1, y: 4, dir: 0 }), 'lot is in the way')
  assert.equal(parseOp({ op: 'road', x: 0, y: 0, dir: 1, len: 999 }), undefined, 'a run has a limit')
})

test('bulldozing the road a building faces leaves the building, which then faces nothing', () => {
  let l = field()
  l = ok(applyOp(l, { op: 'road', x: 2, y: 5, dir: 1, len: 6 }))
  l = ok(applyOp(l, { op: 'place', kind: 'library', x: 4, y: 4 }))
  assert.equal(facesRoad(l, l.buildings[0]!), true)
  l = ok(applyOp(l, { op: 'unroad', x: 2, y: 5, dir: 1, len: 6 }))
  assert.equal(l.roads.length, 0)
  assert.equal(l.buildings.length, 1, 'the building stays')
  assert.equal(facesRoad(l, l.buildings[0]!), false)
  refused(applyOp(l, { op: 'unroad', x: 2, y: 5, dir: 1 }), 'no road')
  l = ok(applyOp(l, { op: 'remove', id: 'library' }))
  assert.equal(l.buildings.length, 0)
  refused(applyOp(l, { op: 'remove', id: 'library' }), 'nothing')
  refused(applyOp(manhattanLayout(), { op: 'remove', id: 'station' }), 'station')
})

test('zoning needs a road beside the lot and land under it; parks take free land', () => {
  let l = field()
  refused(applyOp(l, { op: 'zone', x: 2, y: 2 }), 'no road')
  l = ok(applyOp(l, { op: 'road', x: 0, y: 3, dir: 1, len: 10 }))
  l = ok(applyOp(l, { op: 'zone', x: 2, y: 2 }))
  assert.deepEqual(l.zoned, [[2, 2]])
  refused(applyOp(l, { op: 'zone', x: 2, y: 2 }), 'already')
  refused(applyOp(l, { op: 'zone', x: 3, y: 2 }), 'already there')
  refused(applyOp(l, { op: 'zone', x: 11, y: 3 }), 'land')
  refused(applyOp(l, { op: 'place', kind: 'library', x: 2, y: 2 }), 'already there')
  l = ok(applyOp(l, { op: 'unzone', x: 2, y: 2 }))
  assert.deepEqual(l.zoned, [])
  l = ok(applyOp(l, { op: 'paint', what: 'park', x: 0, y: 0, w: 3, h: 2 }))
  assert.deepEqual(l.park, [
    [0, 0, 3],
    [1, 0, 3],
  ])
  refused(applyOp(l, { op: 'zone', x: 1, y: 0 }), 'already there')
  refused(applyOp(l, { op: 'paint', what: 'park', x: 11, y: 0 }), 'land')
  l = ok(applyOp(l, { op: 'paint', what: 'none', x: 1, y: 0 }))
  assert.deepEqual(l.park, [
    [0, 0, 1],
    [0, 2, 3],
    [1, 0, 3],
  ])
})

test('a borough is a rectangle of land that overlaps no other; what is placed in it belongs to it', () => {
  let l = field()
  l = ok(applyOp(l, { op: 'borough', name: 'Red Hook', x: 0, y: 0, w: 5, h: 5 }))
  assert.equal(l.boroughs[0]!.id, 'red-hook')
  refused(applyOp(l, { op: 'borough', name: 'Other', x: 4, y: 4, w: 4, h: 4 }), 'overlaps')
  refused(applyOp(l, { op: 'borough', name: 'Tiny', x: 6, y: 6, w: 2, h: 2 }), 'at least')
  refused(applyOp(l, { op: 'borough', name: 'Sea', x: 20, y: 20, w: 4, h: 4 }), 'land')
  l = ok(applyOp(l, { op: 'road', x: 0, y: 3, dir: 1, len: 5 }))
  l = ok(applyOp(l, { op: 'place', kind: 'library', x: 1, y: 2 }))
  assert.equal(l.buildings[0]!.burb, 'red-hook')
  // A building may not straddle the borough's edge (x 5 is outside it).
  l = ok(applyOp(l, { op: 'road', x: 3, y: 5, dir: 1, len: 4 }))
  assert.equal(canPlace(l, 'hall', 4, 4), 'A building stands in one borough, or in the city')
  assert.equal(canPlace(l, 'hall', 3, 4), undefined)
  // Bulldozing the borough clears it.
  l = ok(applyOp(l, { op: 'remove', id: 'red-hook' }))
  assert.equal(l.boroughs.length, 0)
  assert.equal(l.buildings.length, 0)
})

test('the world: placing in the city builds at once; in a borough the first such work does', () => {
  const city = new City()
  city.apply(ev('SessionStart', 'S1'), T0)
  // The city: a second Library on Fifth Avenue, on a block the person unzones first.
  const l = () => city.world.layout!
  assert.deepEqual(city.build({ op: 'place', kind: 'library', x: 9, y: 46 }, T0 + 50), { error: 'Something is already there' })
  assert.ok('ok' in city.build({ op: 'unzone', x: 9, y: 46 }, T0 + 60))
  const r = city.build({ op: 'place', kind: 'library', x: 9, y: 46 }, T0 + 100)
  assert.ok('ok' in r, JSON.stringify(r))
  const lib2 = l().buildings.find(b => b.kind === 'library' && b.id !== 'library')!
  assert.ok(lib2, 'placed')
  assert.equal(lib2.built, T0 + 100, 'stands at once')
  assert.equal(city.world.built!.library, T0 + 100, 'the game counts it')
  assert.ok(city.toasts.includes('Public Library opened'))
  assert.equal(l().rev, 2)
  const refusal = city.build({ op: 'place', kind: 'library', x: 9, y: 46 }, T0 + 200)
  assert.ok('error' in refusal && refusal.error)
  assert.equal(l().rev, 2, 'a refused op leaves the revision')
  assert.deepEqual(city.build({ op: 'nonsense' }, T0), { error: 'Not a placement' })
  assert.deepEqual(city.build({ op: 'place', kind: 'empire', x: 9, y: 48 }, T0), { error: 'Build every district first' })

  // A borough: api moves into Brooklyn (a preset borough, on the mainland).
  city.apply(ev('SessionStart', 'S2', { cwd: OTHER }), T0 + 300)
  read(city, 'S2', OTHER, T0 + 400)
  assert.equal(city.world.repos[0]?.burb, 'brooklyn')
  assert.ok('ok' in city.build({ op: 'road', x: 21, y: 54, dir: 1, len: 4 }, T0 + 500))
  const placed = city.build({ op: 'place', kind: 'library', x: 22, y: 53 }, T0 + 600)
  assert.ok('ok' in placed, JSON.stringify(placed))
  const bk = l().buildings.find(b => b.burb === 'brooklyn')!
  assert.equal(bk.kind, 'library')
  assert.equal(bk.built, undefined, 'a lot until the first read there')
  const rev = l().rev
  read(city, 'S1', HOME, T0 + 700)
  assert.equal(l().buildings.find(b => b.burb === 'brooklyn')!.built, undefined, "the home session's read does not count")
  read(city, 'S2', OTHER, T0 + 800)
  assert.equal(l().buildings.find(b => b.burb === 'brooklyn')!.built, T0 + 800, 'the first read in Brooklyn raises it')
  assert.ok(city.toasts.includes('Public Library opened in Brooklyn'))
  assert.equal(l().rev, rev + 1, 'the map changes')
})
