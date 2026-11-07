import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { renderFrame } from '../src/city.ts'
import { hash } from '../src/draw/geo.ts'
import { FIXED, ORIGINS, generateMap } from '../src/layout.ts'
import type { Layout } from '../src/layout.ts'
import { City, emptyWorld } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'
import type { World } from '../src/types.ts'
import { addBorough, missing, wholeLayout } from './whole.ts'

// The layout (docs/city-builder.md): every city stands on a generated map;
// one saved before layouts existed, or on the retired hand-drawn island,
// moves to new land. The map's hash covers the layout's revision, and the
// golden hash pins the drawing of a whole city.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

const byKind = (l: Layout, kind: string) => l.buildings.find(b => b.kind === kind)!

// A whole city with a borough in use and one packed up: what the golden hash is of.
function wholeCity(): City {
  const layout = wholeLayout()
  addBorough(layout, 'api', 'api')
  addBorough(layout, 'web', 'web')
  const city = new City({ ...emptyWorld(), layout })
  city.buildAll(T0 - 60_000)
  city.world.repos.push(
    { root: 'C:/fake/api', name: 'api', burb: 'api', lastSeen: T0 },
    { root: 'C:/fake/web', name: 'web', burb: 'web', lastSeen: T0 - 7200_000, left: T0 - 3600_000 },
  )
  return city
}

test('the test city has every kind placed, the station standing and the rest lots', () => {
  for (const seed of [1, 2, 3, 7, 42]) assert.deepEqual(missing(wholeLayout(seed)), [], `seed ${seed}`)
  const l = wholeLayout()
  assert.ok(l.zoned.length > 50, 'lots zoned')
  for (const b of l.buildings) assert.equal(b.built !== undefined, FIXED.includes(b.kind), `${b.kind} is a lot unless fixed`)
})

test('a world saved before layouts existed, or on the hand-drawn island, moves to new land', () => {
  const saved = { ...emptyWorld(), sessions: [], built: { hall: 3, library: 5 }, flushedAt: 9 } as World
  delete saved.layout
  const city = new City(saved)
  const l = city.world.layout!
  assert.ok('seed' in l.map, 'a generated map')
  assert.deepEqual(l.buildings.map(b => b.kind), ['station'], 'bare land with its station')
  assert.deepEqual(city.toasts, [], 'nothing to say: it never had a city')

  // On the retired hand-drawn island, with a repository in one of its boroughs.
  const old = {
    ...emptyWorld(),
    homeRoot: HOME,
    home: 'home',
    repos: [{ root: 'C:/fake/api', name: 'api', burb: 'brooklyn', lastSeen: 5 }],
    agents: [{ id: 'a1', session: 'S2', name: 'x', color: '#fff', status: 'idle', at: 'library', burb: 'brooklyn' }],
    layout: { rev: 4, map: { preset: 'manhattan' }, land: [], park: [], roads: [], zoned: [[1, 2]], buildings: [], boroughs: [{ id: 'brooklyn', name: 'Brooklyn', x: 20, y: 51, w: 8, h: 9, preset: true }] },
    torch: 7,
  } as unknown as World
  const moved = new City(old)
  const ml = moved.world.layout!
  assert.ok('seed' in ml.map)
  assert.equal(ml.rev, 5, 'the revision runs on, so every page takes the new map')
  assert.deepEqual(ml.boroughs, [])
  assert.equal(moved.world.repos[0]!.burb, '@c:/fake/api', 'api waits at the station for a borough')
  assert.equal(moved.world.agents[0]!.burb, '@c:/fake/api', 'and its agents with it')
  assert.equal(moved.world.torch, undefined)
  assert.equal(moved.world.homeRoot, HOME, 'home stays home')
  assert.ok(moved.toasts.some(t => t.includes('island is retired')))
})

test('a lot rises with its first work; Build it all now finishes the rest', () => {
  const city = new City({ ...emptyWorld(), layout: wholeLayout() })
  assert.equal(byKind(city.layout, 'library').built, undefined)
  city.apply(ev('SessionStart', 'S1'), T0)
  city.apply(ev('PreToolUse', 'S1', { tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: `${HOME}/a.ts` } }), T0 + 100)
  assert.equal(byKind(city.layout, 'library').built, T0 + 100, 'the Library rose on the first read')
  assert.equal(byKind(city.layout, 'liberty').built, undefined)
  city.buildAll(T0 + 300)
  assert.ok(city.layout.buildings.every(b => b.built !== undefined))
})

test('a new map and Rebuild take only a seed', () => {
  const city = new City()
  assert.deepEqual(city.newMap('manhattan', T0), { error: 'Not a map' })
  assert.deepEqual(city.newMap(9, T0), { ok: true })
  assert.deepEqual(city.world.layout!.map, { seed: 9 })
  city.restart(11, T0)
  assert.deepEqual(city.world.layout!.map, { seed: 11 })
  assert.deepEqual(city.world.layout!.land, generateMap(11).land)
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

test('a building draws where it stands: moved by its shift, keyed by its id, a lot while unbuilt', () => {
  const city = wholeCity()
  const l = city.world.layout!
  const lib = byKind(l, 'library')
  // Stood at its kind's drawing origin first, where it needs no shift.
  ;[lib.x, lib.y] = ORIGINS.library
  l.rev += 1
  const at = (f: ReturnType<typeof renderFrame>) => f.overlay.find(i => i.k === 'lm:library')
  // The Library's lights, lit by a read, are drawn at its origin: no translate.
  city.apply(ev('SessionStart', 'S1'), T0)
  city.apply(ev('PreToolUse', 'S1', { tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: `${HOME}/a.ts` } }), T0 + 100)
  city.flush(T0 + 100)
  const home = renderFrame(city.world, T0 + 200)
  assert.ok(at(home)?.svg.includes('<animate'), 'the reading room is lit')
  assert.ok(!at(home)!.svg.includes('<g transform="translate('), 'at its origin, nothing is shifted')
  // Moved six cells south and two east, it is drawn there: one translate, in
  // screen units ((dx - dy) * 10, (dx + dy) * 5), and its hover zone and its
  // readers' pad move with it.
  lib.x += 2
  lib.y += 6
  l.rev += 1
  const moved = renderFrame(city.world, T0 + 200)
  assert.ok(at(moved)!.svg.startsWith('<g transform="translate(-40,40)">'), 'the lights are shifted')
  assert.ok(moved.map.svg.includes('<g transform="translate(-40,40)">'), 'and so is the building on the map')
  assert.notEqual(moved.map.hash, home.map.hash)
  const zone = (f: ReturnType<typeof renderFrame>) => f.overlay.find(i => i.k === 'zones')!.svg.split('<polygon').find(z => z.includes('data-tip-title="Public Library"'))!
  assert.notEqual(zone(moved), zone(home), 'the hover zone moved')
  assert.equal(zone(moved).replace(/points="[^"]*"/, ''), zone(home).replace(/points="[^"]*"/, ''), 'and says the same')
  const lead = (f: ReturnType<typeof renderFrame>) => f.agents.find(a => a.id === 'lead:S1')!
  assert.equal(lead(moved).x, lead(home).x - 40, 'the reader stands in front of the new place')
  assert.equal(lead(moved).y, lead(home).y + 40)

  // A second Library, placed as a lot: both draw, the lot as a blueprint.
  l.buildings.push({ id: 'library-2', kind: 'library', x: ORIGINS.library[0] + 4, y: ORIGINS.library[1] + 11, face: 's' })
  l.rev += 1
  const two = renderFrame(city.world, T0 + 200)
  const caption = (two.map.svg.match(/PUBLIC LIBRARY</g) ?? []).length
  assert.equal(caption, 1, 'one blueprint caption: the lot')
  // Its dashed lot is ground, shifted in cells; its caption is an item, shifted in screen units.
  assert.ok(two.map.svg.includes('<g transform="translate(4,11)"><rect'), 'the lot is drawn at its place')
  assert.ok(two.map.svg.includes('<g transform="translate(-70,75)"><g class="bp'), 'with its caption')
  assert.ok(two.map.svg.includes('<g transform="translate(-40,40)">'), 'and the built one at its')
  assert.ok(two.overlay.find(i => i.k === 'zones')!.svg.includes('data-tip-title="Public Library: blueprint"'))
  assert.ok(!two.overlay.some(i => i.k === 'lm:library-2'), 'a lot has no lights')
})

test('the whole city draws as it did: the golden hash', () => {
  const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')) as { city: string }
  const city = wholeCity()
  const now = renderFrame(city.world, T0, { connected: true }).map.svg
  assert.equal(renderFrame(city.world, T0 + 86_400_000, { connected: true }).map.svg, now, 'the map holds no clock')
  assert.equal(hash(now), golden.city)
})
