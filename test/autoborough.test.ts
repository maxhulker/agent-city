import test from 'node:test'
import assert from 'node:assert/strict'

import { applyOp, boroughRect, boroughSizeFor, cityBuildings, connectBorough, fillBorough, findSite, frontOf, generateMap, landAt, lotsOf, lotsWanted, route } from '../src/layout.ts'
import type { Layout, Rect } from '../src/layout.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// "Build it for me" and "Lay streets and lots for me": a borough sized to its
// repository, on free land near the station, with streets and zoned lots
// laid in it and a road to the city.

const SEED = 1511622721
const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'
const OTHER = 'C:/fake/api'

const nearStation = (l: Layout): [number, number] => {
  const st = cityBuildings(l, 'station')[0]!
  return [st.x + 1, st.y + 2]
}
const inRect = ([x0, y0, x1, y1]: Rect, x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1

test('a repository wants lots by its size, and a borough is sized to hold them', () => {
  assert.equal(lotsWanted(0, 0), 4, 'a small one gets a few')
  assert.equal(lotsWanted(62, 8), 11)
  assert.equal(lotsWanted(1_000_000, 900), 80, 'capped')
  for (const n of [4, 11, 30, 80]) {
    const [w, h] = boroughSizeFor(n)
    const pairs = (w - 2) / 4
    assert.ok(Number.isInteger(pairs) && pairs >= 1)
    assert.ok(w <= 24 && h <= 24, 'within the borough limits')
    assert.ok(2 * pairs * (h - 2) >= Math.min(n, 2 * pairs * 22), `${n} lots fit in ${w}×${h}`)
  }
})

test('a free site is all land, clear of the station and of other boroughs', () => {
  const l = generateMap(SEED)
  const site = findSite(l, 10, 6, nearStation(l))!
  assert.ok(site)
  for (let y = site[1]; y < site[3]; y++) for (let x = site[0]; x < site[2]; x++) assert.ok(landAt(l, x, y), `land at ${x},${y}`)
  const st = cityBuildings(l, 'station')[0]!
  assert.ok(!inRect(site, st.x, st.y), 'not on the station')
  const r = applyOp(l, { op: 'borough', name: 'A', x: site[0], y: site[1], w: 10, h: 6 })
  assert.ok('layout' in r)
  const next = findSite(r.layout, 10, 6, nearStation(l))!
  const gap = next[0] >= site[2] + 1 || next[2] + 1 <= site[0] || next[1] >= site[3] + 1 || next[3] + 1 <= site[1]
  assert.ok(gap, 'a cell away from the first')
  assert.equal(findSite(l, 500, 500, [0, 0]), undefined, 'none that big')
})

test('a borough is filled with streets and lots, the front row left for its square, and joined to the city', () => {
  const l = generateMap(SEED)
  const [w, h] = boroughSizeFor(11)
  const site = findSite(l, w, h, nearStation(l))!
  const r = applyOp(l, { op: 'borough', name: 'api', x: site[0], y: site[1], w, h })
  assert.ok('layout' in r)
  const before = r.layout
  const f = fillBorough(before, 'api', 11)
  assert.equal(f.lots, 11)
  assert.equal(f.added, 11)
  assert.equal(before.zoned.length, l.zoned.length, 'the layout it was given is unchanged')
  assert.equal(f.layout.rev, before.rev + 1)
  const rect = boroughRect(f.layout.boroughs.at(-1)!)
  const mine = lotsOf(f.layout).filter(lot => inRect(rect, lot.x, lot.y))
  assert.equal(mine.length, 11, 'every zoned lot is a real lot')
  assert.ok(mine.every(lot => lot.y < rect[3] - 1), 'none on the front row')
  assert.ok(f.layout.roads.length > before.roads.length, 'streets were laid')

  const all = fillBorough(before, 'api')
  assert.equal(all.lots, 2 * ((w - 2) / 4) * (h - 2), 'with no number, every lot that fits')
  assert.equal(fillBorough(all.layout, 'api').added, 0, 'nothing more to add')

  const joined = connectBorough(f.layout, 'api')
  const st = cityBuildings(joined, 'station')[0]!
  const [sx, sy] = frontOf(st)[0]!
  const mid = Math.round(rect[0] + w / 2)
  assert.ok(route(joined, [mid, rect[3] - 1], [sx + 0.5, sy]), 'a road runs from its front street to the station')
})

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}
function read(city: City, sid: string, cwd: string, now: number) {
  const extra = { cwd, tool_name: 'Read', tool_use_id: `${sid}-${now}`, tool_input: { file_path: `${cwd}/a.ts` } }
  city.apply(ev('PreToolUse', sid, extra), now)
  city.apply(ev('PostToolUse', sid, { ...extra, tool_response: 'ok' }), now + 10)
}
function waitingCity(): City {
  const city = new City()
  assert.deepEqual(city.newMap(SEED, T0 - 1000), { ok: true })
  city.apply(ev('SessionStart', 'S1'), T0)
  read(city, 'S1', HOME, T0 + 10)
  city.apply(ev('SessionStart', 'S2', { cwd: OTHER }), T0 + 100)
  read(city, 'S2', OTHER, T0 + 200)
  return city
}
const lotsIn = (city: City, id: string) => {
  const bo = city.world.layout!.boroughs.find(b => b.id === id)!
  return city.world.layout!.zoned.filter(([x, y]) => inRect(boroughRect(bo), x, y)).length
}

test('"Build it for me": the waiting repository gets a borough of its own, laid out and moved into', () => {
  const city = waitingCity()
  const repo = () => city.world.repos.find(r => r.root === OTHER)!
  assert.ok(repo().burb.startsWith('@'), 'waiting at the station')
  assert.deepEqual(city.build({ op: 'autoborough', root: OTHER, files: 62, folders: 8 }, T0 + 300), { ok: true })
  const bo = city.world.layout!.boroughs.at(-1)!
  assert.equal(bo.name, 'api')
  assert.equal(repo().burb, bo.id, 'moved in')
  assert.equal(lotsIn(city, bo.id), 11)
  assert.match((city.build({ op: 'autoborough', root: OTHER }, T0 + 400) as { error: string }).error, /lives in api already/)
  assert.match((city.build({ op: 'autoborough', root: HOME }, T0 + 400) as { error: string }).error, /lives on the island/)
  assert.match((city.build({ op: 'autoborough' }, T0 + 400) as { error: string }).error, /Which repository/)
})

test('a borough drawn by hand gets its streets and lots at once, or later from its card', () => {
  const city = waitingCity()
  const l = city.world.layout!
  const site = findSite(l, 8, 6, nearStation(l))!
  assert.deepEqual(city.build({ op: 'borough', name: 'Filled', x: site[0], y: site[1], w: 8, h: 6, fill: true, root: OTHER }, T0 + 300), { ok: true })
  assert.ok(lotsIn(city, 'filled') > 0, 'lots at once')
  assert.equal(city.world.repos.find(r => r.root === OTHER)!.burb, 'filled')

  const l2 = city.world.layout!
  const site2 = findSite(l2, 8, 6, nearStation(l2))!
  assert.deepEqual(city.build({ op: 'borough', name: 'Bare', x: site2[0], y: site2[1], w: 8, h: 6 }, T0 + 400), { ok: true })
  assert.equal(lotsIn(city, 'bare'), 0, 'none unless asked')
  assert.deepEqual(city.build({ op: 'fill', id: 'bare' }, T0 + 500), { ok: true })
  assert.ok(lotsIn(city, 'bare') > 0)
  assert.match((city.build({ op: 'fill', id: 'bare' }, T0 + 600) as { error: string }).error, /no room for more lots/)
  assert.match((city.build({ op: 'fill', id: 'nowhere' }, T0 + 600) as { error: string }).error, /No such borough/)
})
