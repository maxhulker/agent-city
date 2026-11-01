import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { renderFrame } from '../src/city.ts'
import { BURBS, BURB_ORDER, RESERVED, SITES, hash, lots } from '../src/draw/geo.ts'
import { FIXED, cellsOf, manhattanLayout } from '../src/layout.ts'
import type { Building, Layout } from '../src/layout.ts'
import { City, emptyWorld } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'
import type { District, World } from '../src/types.ts'

// The layout (docs/city-builder.md), step one: the Manhattan preset is
// today's city as a layout, a saved world migrates to it, and the map's hash
// covers the layout's revision. Nothing is drawn differently yet, which the
// golden hash proves.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

const isLand = (l: Layout, x: number, y: number) => l.land.some(([ry, x0, x1]) => ry === y && x >= x0 && x < x1)
const byKind = (l: Layout, kind: string) => l.buildings.find(b => b.kind === kind)!
const cells = (b: Building) => {
  const out: [number, number][] = []
  for (const [x0, y0, x1, y1] of cellsOf(b)) for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) out.push([x, y])
  return out
}

// A whole city with a borough in use and one packed up: what the golden hash is of.
function wholeCity(): City {
  const city = new City()
  city.buildAll(T0 - 60_000)
  city.world.repos.push(
    { root: 'C:/fake/api', name: 'api', burb: 'brooklyn', lastSeen: T0 },
    { root: 'C:/fake/web', name: 'web', burb: 'queens', lastSeen: T0 - 7200_000, left: T0 - 3600_000 },
  )
  return city
}

test('the preset places every landmark on its reserved lot, with its front at its spot', () => {
  const l = manhattanLayout()
  for (const d of Object.keys(SITES) as District[]) {
    const b = byKind(l, d)
    assert.ok(b, `${d} is placed`)
    for (const [x0, y0, x1, y1] of cellsOf(b)) {
      assert.ok(RESERVED.some(([rx0, ry0, rx1, ry1]) => rx0 <= x0 && ry0 <= y0 && rx1 >= x1 && ry1 >= y1), `${d} sits on a reserved lot`)
    }
    const [sx, sy] = SITES[d].spot
    const [x0, y0, x1, y1] = cellsOf(b)[0]!
    if (d === 'plaza') {
      assert.ok(sx > x0 && sx < x1 && sy > y0 && sy < y1, 'the lawn is inside Central Park')
    } else if (d === 'relay') {
      // The towers stand behind the station; their agents use the station's front.
      const [tx0, , tx1, ty1] = cellsOf(byKind(l, 'station'))[0]!
      assert.ok(sy === ty1 && sx >= tx0 && sx <= tx1, "the relay's spot is on the station's front")
    } else {
      assert.equal(b.face, 's')
      assert.ok(sy === y1 && sx >= x0 && sx <= x1, `${d}'s spot is on its front edge`)
    }
  }
  const station = byKind(l, 'station')
  assert.equal(station.built, 0, 'the station always stands')
  for (const b of l.buildings) assert.equal(b.built !== undefined, FIXED.includes(b.kind), `${b.kind} is a lot unless fixed`)
})

test('the preset is the island: land where the island is, roads on its grid, the lots zoned in order', () => {
  const l = manhattanLayout()
  assert.deepEqual(l.map, { preset: 'manhattan' })
  assert.ok(isLand(l, 8, 40), 'Midtown is land')
  assert.ok(isLand(l, 8, 58), 'downtown is land')
  assert.ok(!isLand(l, 17, 40), 'the East River is not')
  assert.ok(!isLand(l, -3, 40), 'nor the Hudson')
  assert.ok(!isLand(l, 8, 70), 'nor the bay')
  // Fifth Avenue runs the length of the island; 42nd Street crosses it.
  const fifth = l.roads.filter(([x, , dir]) => x === 9 && dir === 0).map(r => r[1])
  assert.ok(fifth.includes(0) && fifth.includes(30) && fifth.includes(58), 'Fifth Avenue runs the length of the island')
  assert.ok(l.roads.every(r => r[2] === 0 ? r[3] === 'avenue' : r[3] === 'street'))
  assert.ok(l.roads.some(([x, y, dir]) => x === 9 && y === 42 && dir === 1), '42nd Street crosses Fifth')
  assert.ok(!l.roads.some(([x, y, dir]) => x === 17 && y === 40 && dir === 0), 'no avenue in the river')
  // Every building and borough stands on land (the Seaport reaches into the
  // water from the shore, and the Statue has her island), on a road.
  for (const b of l.buildings) {
    const land = cells(b).filter(([x, y]) => isLand(l, x, y)).length
    if (b.kind === 'liberty') assert.equal(land, 0, 'the Statue is in the water')
    else if (b.kind === 'harbor') assert.ok(land > 0 && land < cells(b).length, 'the Seaport is a pier')
    else assert.equal(land, cells(b).length, `${b.kind} is on land`)
  }
  assert.deepEqual(
    l.zoned,
    lots().map(x => [x.x, x.y]),
    'the lots are zoned in the order the population fills them',
  )
  const taken = new Set<string>()
  for (const b of l.buildings) for (const [x, y] of cells(b)) taken.add(`${x},${y}`)
  for (const [y, x0, x1] of l.park) for (let x = x0; x < x1; x++) taken.add(`${x},${y}`)
  for (const [x, y] of l.zoned) assert.ok(!taken.has(`${x},${y}`) && !taken.has(`${x + 1},${y}`), `the lot at ${x},${y} is free`)
  for (const b of BURB_ORDER) {
    const bo = l.boroughs.find(one => one.id === b)!
    assert.ok(bo?.preset, `${b} is a preset borough`)
    const [cx, cy] = BURBS[b].center
    assert.ok(cx >= bo.x && cx < bo.x + bo.w && cy >= bo.y && cy < bo.y + bo.h, `${b} holds its site`)
    assert.ok(Number.isInteger(bo.x) && Number.isInteger(bo.y), 'on whole cells')
  }
})

test('a world saved before layouts existed gets the preset, with what it had built standing', () => {
  const saved = { ...emptyWorld(), sessions: [], built: { hall: 3, library: 5 }, flushedAt: 9 } as World
  delete saved.layout
  const city = new City(saved)
  const l = city.world.layout!
  assert.equal(l.rev, 0)
  assert.equal(byKind(l, 'library').built, 5, 'the Library stands since it was built')
  assert.equal(byKind(l, 'hall').built, 3)
  assert.equal(byKind(l, 'workshop').built, undefined, 'the Garment District is still a lot')
  assert.equal(byKind(l, 'station').built, 0)
  assert.deepEqual(city.world.built, { hall: 3, library: 5 }, 'the game record is untouched')

  // A city from before the game, in use: everything stands.
  const old = { ...emptyWorld(), homeRoot: HOME, home: 'home', flushedAt: 9 } as World
  delete old.layout
  delete old.built
  const whole = new City(old).world.layout!
  assert.ok(whole.buildings.every(b => b.built !== undefined), 'every building stands')
  assert.equal(byKind(whole, 'liberty').built, byKind(whole, 'harbor').built, 'the Statue stands with the Seaport')
})

test('the buildings follow the game: a lot rises with its first work, Rebuild clears, Build it all now finishes', () => {
  const city = new City()
  assert.equal(byKind(city.layout, 'library').built, undefined)
  city.apply(ev('SessionStart', 'S1'), T0)
  city.apply(ev('PreToolUse', 'S1', { tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: `${HOME}/a.ts` } }), T0 + 100)
  assert.equal(byKind(city.layout, 'library').built, T0 + 100, 'the Library rose on the first read')
  assert.equal(byKind(city.layout, 'liberty').built, undefined)
  city.rebuild(T0 + 200)
  assert.equal(byKind(city.layout, 'library').built, undefined, 'a lot again')
  assert.equal(byKind(city.layout, 'station').built, 0, 'the station stays')
  city.buildAll(T0 + 300)
  assert.ok(city.layout.buildings.every(b => b.built !== undefined))
})

test('the layout survives state.json', () => {
  const city = wholeCity()
  const back = new City(JSON.parse(JSON.stringify(city.world)) as World)
  assert.deepEqual(back.world.layout, city.world.layout)
})

test("the map's hash covers the layout's revision, and only that of the layout", () => {
  const city = wholeCity()
  const a = renderFrame(city.world, T0).map.hash
  assert.equal(renderFrame(city.world, T0 + 5000).map.hash, a, 'the same city, the same map')
  city.world.layout!.rev += 1
  const b = renderFrame(city.world, T0).map.hash
  assert.notEqual(b, a, 'a placement changes the map')
  city.world.layout!.rev -= 1
  assert.equal(renderFrame(city.world, T0).map.hash, a)
  // Moving a building without bumping the revision changes nothing: the
  // revision is what the hash reads.
  byKind(city.world.layout!, 'library').x += 2
  assert.equal(renderFrame(city.world, T0).map.hash, a)
})

test('the preset draws the same city as before: the golden hash', () => {
  const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')) as { manhattan: string }
  const city = wholeCity()
  const now = renderFrame(city.world, T0, { connected: true }).map.svg
  assert.equal(renderFrame(city.world, T0 + 86_400_000, { connected: true }).map.svg, now, 'the map holds no clock')
  assert.equal(hash(now), golden.manhattan)
})
