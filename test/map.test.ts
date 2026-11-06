import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { FOOTPRINT, GEN, applyOp, canPlace, cellsOf, generateMap, landAt, spotFor, trackOf } from '../src/layout.ts'
import type { Kind, Layout } from '../src/layout.ts'
import { City, emptyWorld } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// The generated map (docs/city-builder.md, step seven): a pure function of its
// seed, with the station on its island, a shore within reach for the Seaport,
// and land enough for every footprint.

const T0 = 1_700_000_000_000
const SEEDS = [1, 2, 3, 7, 42]

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: 'C:/fake/home', ...extra }
}

// Whether a kind fits somewhere near the station: placeable, or wanting only the road along its front.
function fits(l: Layout, kind: Kind, near = 24): [number, number] | undefined {
  const st = l.buildings.find(b => b.kind === 'station')!
  for (let y = Math.max(0, st.y - near); y < Math.min(GEN, st.y + near); y++) {
    for (let x = Math.max(0, st.x - near); x < Math.min(GEN, st.x + near); x++) {
      const why = canPlace(l, kind, x, y)
      if (!why || why === 'No road along its front') return [x, y]
    }
  }
  return undefined
}

test('a seed gives the same map twice, and another seed another map', () => {
  assert.deepEqual(generateMap(7), generateMap(7))
  assert.notDeepEqual(generateMap(7).land, generateMap(8).land)
  const l = generateMap(7)
  assert.deepEqual(l.map, { seed: 7 })
  assert.equal(l.rev, 0)
  assert.deepEqual(l.boroughs, [])
  assert.deepEqual(l.zoned, [])
  // Every span lies on the map, sorted by row and start, with no two touching.
  for (let i = 0; i < l.land.length; i++) {
    const [y, x0, x1] = l.land[i]!
    assert.ok(y >= 0 && y < GEN && x0 >= 0 && x1 <= GEN && x0 < x1)
    const next = l.land[i + 1]
    if (next && next[0] === y) assert.ok(next[1] > x1)
  }
})

test('the station stands on its island with its street in front and the shore a road away', () => {
  for (const seed of SEEDS) {
    const l = generateMap(seed)
    const st = l.buildings.find(b => b.kind === 'station')!
    assert.ok(st && st.built !== undefined, `seed ${seed}: a station`)
    for (const [x0, y0, x1, y1] of cellsOf(st)) for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) assert.ok(landAt(l, x, y), `seed ${seed}: station on land at ${x},${y}`)
    assert.ok(l.roads.some(([x, y, dir]) => dir === 1 && y === st.y + 1 && x === st.x), `seed ${seed}: the street along its front`)
    const t = trackOf(l)
    assert.ok(t.mouth - st.x < 12, `seed ${seed}: the track meets the water ${t.mouth - st.x} cells on`)
    assert.ok(!landAt(l, Math.ceil(t.mouth), Math.floor(t.y)), `seed ${seed}: water at the tunnel mouth`)
    // The Seaport: a shore within a road's reach of the station.
    assert.ok(fits(l, 'harbor', 16), `seed ${seed}: somewhere for the Seaport`)
    // Its agents' forecourt is on the street.
    const [fx, fy] = spotFor(l, 'relay')
    assert.ok(Math.abs(fy - (st.y + 1)) < 1 && fx >= st.x && fx <= st.x + 4, `seed ${seed}: forecourt at ${fx},${fy}`)
  }
})

test('a few fixed seeds hold land for every footprint near the station', () => {
  for (const seed of SEEDS) {
    const l = generateMap(seed)
    for (const kind of Object.keys(FOOTPRINT) as Kind[]) {
      if (kind === 'station') continue
      assert.ok(fits(l, kind), `seed ${seed}: room for ${kind}`)
    }
    // And a first district really goes down: a street, then City Hall on it.
    const st = l.buildings.find(b => b.kind === 'station')!
    const at = fits(l, 'hall', 10)!
    const roaded = applyOp(l, { op: 'road', x: at[0], y: at[1] + 1, dir: 1, len: 2 })
    assert.ok('layout' in roaded, `seed ${seed}: ${'error' in roaded ? roaded.error : ''}`)
    assert.ok('layout' in applyOp(roaded.layout, { op: 'place', kind: 'hall', x: at[0], y: at[1] }), `seed ${seed}: City Hall near the station at ${at} (station ${st.x},${st.y})`)
  }
})

test("the map's hash changes with the seed, and a generated map draws its own land", () => {
  const frameOf = (seed: number) => {
    const w = emptyWorld()
    w.layout = generateMap(seed)
    return renderFrame(w, T0)
  }
  const a = frameOf(1)
  const b = frameOf(2)
  assert.notEqual(a.map!.hash, b.map!.hash)
  assert.equal(frameOf(1).map!.hash, a.map!.hash, 'and keeps it')
  assert.ok(a.map!.svg.includes('class="shore"'), 'its shore')
  assert.ok(a.map!.svg.includes('stroke="#a16207"'), "the station's clock")
})

test('a new city picks its map in the welcome; once work has begun the map stays', () => {
  const city = new City()
  assert.ok(city.isNew)
  assert.deepEqual(city.newMap('nowhere', T0), { error: 'Not a map' })
  assert.deepEqual(city.newMap(0, T0), { error: 'Not a map' })
  const rev = city.world.layout!.rev
  assert.ok('ok' in city.newMap(42, T0))
  assert.deepEqual(city.world.layout!.map, { seed: 42 })
  assert.equal(city.world.layout!.rev, rev + 1, 'the revision runs on, so the pages take it')
  assert.ok('ok' in city.newMap(7, T0))

  // The first session arrives by train, onto the generated island's forecourt.
  city.apply(ev('SessionStart', 'S1'), T0)
  city.flush(T0 + 10_000)
  const lead = renderFrame(city.world, T0 + 20_000).agents.find(s => s.id === 'lead:S1')!
  const [fx, fy] = spotFor(city.world.layout!, 'relay')
  const near = (v: number, w: number) => Math.abs(v - w) < 20
  assert.ok(near(lead.x, (fx - fy) * 10) && near(lead.y, (fx + fy) * 5), `the lead at the station: ${lead.x},${lead.y}`)
  assert.deepEqual(city.newMap(1, T0), { error: 'The city is under way: its map stays' })
  assert.deepEqual(city.world.layout!.map, { seed: 7 })
})
