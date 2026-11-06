import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { burbAt, p, waitAt } from '../src/draw/geo.ts'
import { lotStyle } from '../src/draw/map.ts'
import { doorOf, findSite, hubOf, landAt, mapShape } from '../src/layout.ts'
import { cityWith, layoutWith, stationDoor } from './whole.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Boroughs by the person (docs/city-builder.md, step six): a repository with
// no borough waits at the station until one is laid out for it, then gathers
// at its square; a packed-up borough keeps its layout and takes its
// repository back; a bulldozed one sends it back to the station, announced
// again.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'
const OTHER = 'C:/fake/api'
const THIRD = 'C:/fake/web'
// Free mainland near the station, beside Brooklyn.
const INWOOD = (() => {
  const l = layoutWith('Brooklyn')
  const [x, y] = findSite(l, 5, 5, stationDoor(l))!
  return { op: 'borough', x, y, w: 5, h: 5, name: 'Red Hook' } as const
})()

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

function read(city: City, sid: string, cwd: string, now: number) {
  const extra = { cwd, tool_name: 'Read', tool_use_id: `${sid}-${now}`, tool_input: { file_path: `${cwd}/a.ts` } }
  city.apply(ev('PreToolUse', sid, extra), now)
  city.apply(ev('PostToolUse', sid, { ...extra, tool_response: 'ok' }), now + 10)
}

// A built city with a home session, and a second session working in api.
function twoRepos(): City {
  const city = cityWith('Brooklyn')
  city.buildAll(T0 - 60_000)
  city.apply(ev('SessionStart', 'S1'), T0)
  read(city, 'S1', HOME, T0 + 10)
  city.apply(ev('SessionStart', 'S2', { cwd: OTHER }), T0 + 100)
  read(city, 'S2', OTHER, T0 + 200)
  return city
}

const round = ([x, y]: [number, number]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
// Where S2's lead stands once its walk is over.
function leadAt(city: City, now: number) {
  city.flush(now)
  const f = renderFrame(city.world, now + 10_000)
  const s = f.agents.find(a => a.id === 'lead:S2')!
  return { at: [s.x, s.y], title: /<title>([^<]*)<\/title>/.exec(s.fig.svg)![1]!, frame: f }
}
const sign = (f: ReturnType<typeof renderFrame>, key: string) => f.overlay.find(i => i.k === key)?.svg ?? ''

test('a new repository waits at the station until a borough is laid out for it, then gathers at its square', () => {
  const city = twoRepos()
  const repo = () => city.world.repos.find(r => r.root === OTHER)!
  assert.ok(repo().burb.startsWith('@'), 'no borough yet')
  assert.ok(city.toasts.includes('api arrived at Grand Central. Lay out a borough for it.'))
  const waiting = leadAt(city, T0 + 300)
  assert.deepEqual(waiting.at, round(p(...waitAt(city.world.layout, 0))), 'on the forecourt')
  assert.ok(waiting.title.includes('api has no borough yet'), waiting.title)
  assert.ok(sign(waiting.frame, 'waiting').includes('api'), 'its name on the sign')

  // The Borough tool's sheet names the repository: it moves in, and its agents walk over.
  city.toasts.length = 0
  assert.ok('ok' in city.build({ ...INWOOD, root: OTHER }, T0 + 400))
  const inwood = city.world.layout!.boroughs.find(b => b.name === 'Red Hook')!
  assert.equal(repo().burb, inwood.id)
  assert.ok(city.toasts.includes('api moved into Red Hook'))
  const there = leadAt(city, T0 + 500)
  assert.deepEqual(there.at, round(p(...burbAt(inwood.id, 0, city.world.layout))), 'on its square')
  const [sx, sy] = burbAt(inwood.id, 0, city.world.layout)
  assert.ok(sy === INWOOD.y + INWOOD.h - 1 && sx > INWOOD.x && sx < INWOOD.x + INWOOD.w, `along its front edge, a row in: ${sx},${sy}`)
  assert.equal(sign(there.frame, 'waiting'), '', 'nobody waits any more')
  assert.ok(sign(there.frame, `burb:${inwood.id}`).includes('api'), 'its sign')
  assert.ok(there.frame.map?.svg.includes('RED HOOK'), 'drawn on the map')

  // Its next read stays there.
  read(city, 'S2', OTHER, T0 + 600)
  assert.equal(city.world.agents.find(a => a.id === 'lead:S2')!.burb, inwood.id)
})

test('the arrival card moves a repository into a borough that is free, and nowhere else', () => {
  const city = twoRepos()
  assert.deepEqual(city.build({ op: 'movein', id: 'atlantis', root: OTHER }, T0), { error: 'No such borough' })
  assert.deepEqual(city.build({ op: 'movein', id: 'brooklyn', root: HOME }, T0), { error: 'home lives on the island' })
  assert.deepEqual(city.build({ ...INWOOD, root: HOME }, T0), { error: 'home lives on the island' })
  assert.ok('ok' in city.build({ op: 'movein', id: 'brooklyn', root: OTHER }, T0 + 300))
  city.apply(ev('SessionStart', 'S3', { cwd: THIRD }), T0 + 400)
  read(city, 'S3', THIRD, T0 + 500)
  assert.deepEqual(city.build({ op: 'movein', id: 'brooklyn', root: THIRD }, T0 + 600), { error: "Brooklyn is api's" })
  // A borough laid out with no repository named waits for one.
  assert.ok('ok' in city.build(INWOOD, T0 + 700))
  const inwood = city.world.layout!.boroughs.find(b => b.name === 'Red Hook')!
  assert.ok(city.world.repos.find(r => r.root === THIRD)!.burb.startsWith('@'))
  assert.ok('ok' in city.build({ op: 'movein', id: inwood.id, root: THIRD }, T0 + 800))
  assert.equal(city.world.repos.find(r => r.root === THIRD)!.burb, inwood.id)
})

test('a packed-up borough keeps its layout and takes its repository back', () => {
  const city = twoRepos()
  assert.ok('ok' in city.build({ ...INWOOD, root: OTHER }, T0 + 300))
  const inwood = city.world.layout!.boroughs.find(b => b.name === 'Red Hook')!
  // A Library inside it: a lot until api's first read, and where its reads go.
  const { x: ix, y: iy, w: iw, h: ih } = INWOOD
  for (const [x, y] of city.world.layout!.zoned.filter(([x, y]) => x >= ix - 1 && x < ix + iw && y >= iy && y < iy + ih)) {
    assert.ok('ok' in city.build({ op: 'unzone', x, y }, T0 + 340))
  }
  city.build({ op: 'road', x: ix, y: iy + ih, dir: 1, len: iw }, T0 + 345)
  const placed = city.build({ op: 'place', kind: 'library', x: ix + 1, y: iy + ih - 1 }, T0 + 350)
  assert.ok('ok' in placed, JSON.stringify(placed))
  const lib = city.world.layout!.buildings.find(b => b.burb === inwood.id)!
  assert.equal(lib.built, undefined)
  read(city, 'S2', OTHER, T0 + 400)
  assert.equal(lib.built, T0 + 400)
  const reading = leadAt(city, T0 + 500)
  assert.deepEqual(reading.at, round(p(...doorOf(lib))), 'at the Library door')

  // Everyone leaves; an hour on, api packs up. The borough and its Library stay.
  city.apply(ev('SessionEnd', 'S2', { cwd: OTHER }), T0 + 600)
  city.flush(T0 + 60_000)
  city.flush(T0 + 2 * 3600_000)
  const repo = () => city.world.repos.find(r => r.root === OTHER)!
  assert.ok(repo().left, 'packed up')
  assert.ok(city.world.layout!.boroughs.some(b => b.id === inwood.id))
  assert.ok(city.world.layout!.buildings.some(b => b.id === lib.id))
  const empty = renderFrame(city.world, T0 + 2 * 3600_000)
  assert.ok(!sign(empty, `burb:${inwood.id}`).includes('api'), 'the sign is down')

  // A session there again: straight back in.
  city.toasts.length = 0
  city.apply(ev('SessionStart', 'S4', { cwd: OTHER }), T0 + 3 * 3600_000)
  read(city, 'S4', OTHER, T0 + 3 * 3600_000 + 100)
  assert.equal(repo().left, undefined)
  assert.equal(repo().burb, inwood.id)
  assert.ok(city.toasts.includes('api moved back into Red Hook'))
})

test('a bulldozed borough sends its repository back to the station, announced again', () => {
  const city = twoRepos()
  assert.ok('ok' in city.build({ ...INWOOD, root: OTHER }, T0 + 300))
  const inwood = city.world.layout!.boroughs.find(b => b.name === 'Red Hook')!
  leadAt(city, T0 + 400)
  city.toasts.length = 0
  assert.ok('ok' in city.build({ op: 'remove', id: inwood.id }, T0 + 500))
  const repo = city.world.repos.find(r => r.root === OTHER)!
  assert.ok(repo.burb.startsWith('@'))
  assert.ok(city.toasts.includes('api arrived at Grand Central. Lay out a borough for it.'))
  const back = leadAt(city, T0 + 600)
  assert.deepEqual(back.at, round(p(...waitAt(city.world.layout, 0))), 'back on the forecourt')
  assert.ok(!back.frame.map?.svg.includes('RED HOOK'))
})

test('home stays on the island however busy another repository gets', () => {
  const city = twoRepos()
  assert.ok('ok' in city.build({ ...INWOOD, root: OTHER }, T0 + 300))
  // Far more work in api than the old follow-the-work rule needed, over minutes.
  for (let i = 0; i < 40; i++) {
    read(city, 'S2', OTHER, T0 + 1_000 + i * 20_000)
    city.flush(T0 + 1_100 + i * 20_000)
  }
  assert.equal(city.world.homeRoot, HOME)
  assert.ok(city.world.repos.some(r => r.root === OTHER && !r.burb.startsWith('@')), 'api keeps its borough')
  assert.ok(!city.toasts.some(t => t.includes('became')))
})

test('a city saved with a picked home loads with the pick gone and the home kept', () => {
  const saved = { ...twoRepos().world, homePinned: true }
  const city = new City(JSON.parse(JSON.stringify(saved)))
  assert.equal(city.world.homeRoot, HOME)
  assert.ok(!('homePinned' in city.world))
})

test("a drawn borough's zoned blocks fill with brownstones, the city's with towers", () => {
  const city = new City()
  assert.ok('ok' in city.newMap(7, T0))
  const l = () => city.world.layout!
  const st = l().buildings.find(b => b.kind === 'station')!
  // Not on the island: that is the city's own.
  const { cx, cy } = mapShape(7)
  const [hx, hy] = [Math.floor(cx) - 2, Math.floor(cy) + 2]
  assert.ok(hubOf(l())(hx, hy), 'the middle of the map is the hub')
  assert.match((city.build({ op: 'borough', x: hx, y: hy, w: 5, h: 4, name: 'Little Italy' }, T0) as { error: string }).error, /mainland/)
  // A borough on the mainland nearest the station, with a street through it.
  const site = findSite(l(), 5, 4, [st.x, st.y])
  assert.ok(site, 'room for a borough')
  const [x, y] = site
  assert.ok('ok' in city.build({ op: 'borough', x, y, w: 5, h: 4, name: 'Little Italy' }, T0))
  assert.ok('ok' in city.build({ op: 'road', x, y: y + 2, dir: 1, len: 5 }, T0))
  assert.ok('ok' in city.build({ op: 'zone', x: x + 1, y: y + 1 }, T0), 'a block inside it')
  assert.equal(lotStyle(l(), x + 1, y + 1), 'houses')
  assert.equal(lotStyle(l(), st.x, st.y + 3), 'towers')
  const draw = (population: number) => {
    city.world.population = population
    city.world.layout!.rev += 1
    return renderFrame(city.world, T0).map!.svg
  }
  assert.notEqual(draw(0), draw(1_000_000), 'the houses go up with the population')
})
