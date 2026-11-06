import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderFrame } from '../src/city.ts'
import { CensusTaker, REST, censusFrom, groupFolders, parseLog, parseStatus, parseTree, sameCensus } from '../src/census.ts'
import { heightOf, placeBlocks, plotsFor, runsOf, signLine, slotsOf } from '../src/draw/blocks.ts'
import { findSite } from '../src/layout.ts'
import { City } from '../src/world.ts'
import { cityWith, layoutWith, stationDoor } from './whole.ts'
import type { HookEvent } from '../src/world.ts'
import type { Census } from '../src/types.ts'

// A borough's houses as its repository (src/census.ts, src/draw/blocks.ts):
// each folder a run of houses, as tall as its size, lit when worked on in the
// last two weeks, scaffolded while it has uncommitted changes.

const T0 = 1_700_000_000_000
const DAY = 86_400_000
const HOME = 'C:/fake/home'
const OTHER = 'C:/fake/api'

const tree = (files: [string, number][]) => files.map(([path, bytes]) => `100644 blob ${'a'.repeat(40)} ${String(bytes).padStart(7)}\t${path}`).join('\0') + '\0'
const entries = (files: [string, number][]) => files.map(([path, bytes]) => ({ path, bytes }))

test('git answers parse: the tree with sizes, the log with its files, the status', () => {
  const t = parseTree(tree([['README.md', 120], ['src/a.ts', 4000]]) + `160000 commit ${'b'.repeat(40)}       -\tvendor/lib\0`)
  assert.deepEqual(t, [{ path: 'README.md', bytes: 120 }, { path: 'src/a.ts', bytes: 4000 }], 'a submodule is left out')

  const log = '\x01' + '1700000000\tAda\tFix the thing\0\nsrc/a.ts\0README.md\0' + '\x01' + '1699990000\tBob\tTabs\tin a subject\0\nsrc/b.ts\0'
  assert.deepEqual(parseLog(log), [
    { at: 1_700_000_000_000, who: 'Ada', subject: 'Fix the thing', files: ['src/a.ts', 'README.md'] },
    { at: 1_699_990_000_000, who: 'Bob', subject: 'Tabs\tin a subject', files: ['src/b.ts'] },
  ])
  assert.deepEqual(parseLog(''), [])

  assert.deepEqual(parseStatus(' M src/a.ts\0R  new.ts\0old.ts\0?? docs/x.md\0'), ['src/a.ts', 'new.ts', 'docs/x.md'])
})

test('folders: the top level, with the biggest split while there are few or it holds most', () => {
  // Everything in src: src splits into its folders, its own files staying as src.
  const one = groupFolders(entries([['package.json', 500], ['src/main.ts', 3000], ['src/ui/a.ts', 9000], ['src/ui/b.ts', 9000], ['src/db/q.ts', 7000], ['test/a.test.ts', 2000]]))
  assert.deepEqual([...one.keys()].sort(), ['', 'src', 'src/db', 'src/ui', 'test'])

  // Enough folders, none holding most: left as they are.
  const many = groupFolders(entries([['a/x', 10], ['b/x', 10], ['c/x', 10], ['d/x', 10], ['e/y/x', 10], ['e/z/x', 10]]))
  assert.deepEqual([...many.keys()].sort(), ['a', 'b', 'c', 'd', 'e'])

  // A folder with a single thing in it splits no further.
  const deep = groupFolders(entries([['pkg/only/a.ts', 100], ['pkg/only/b.ts', 100]]))
  assert.ok(deep.size >= 1 && [...deep.values()].flat().length === 2)
})

test('a census counts each folder: files, size, the fortnight\'s commits, and what is uncommitted', () => {
  const files: [string, number][] = [
    ['README.md', 2000],
    ['src/a.ts', 50_000],
    ['src/b.ts', 50_000],
    ['test/a.test.ts', 8000],
    ['docs/guide.md', 3000],
    ['assets/logo.png', 40_000],
  ]
  const commits = [
    { at: T0 - DAY, who: 'Ada', subject: 'src work', files: ['src/a.ts', 'src/b.ts', 'README.md'] },
    { at: T0 - 2 * DAY, who: 'Ada', subject: 'tests', files: ['test/a.test.ts'] },
    { at: T0 - 30 * DAY, who: 'Bob', subject: 'old', files: ['docs/guide.md'] },
  ]
  const c = censusFrom(entries(files), commits, ['src/a.ts', 'src/new.ts', 'docs/guide.md'], { branch: 'main', ahead: 2, behind: 0 }, T0)
  assert.equal(c.files, 6)
  assert.equal(c.commits, 2, 'only the last two weeks count')
  assert.equal(c.dirty, 3)
  const by = Object.fromEntries(c.blocks.map(b => [b.path, b]))
  assert.equal(c.blocks[0]!.path, 'src', 'biggest first')
  assert.deepEqual([by.src!.files, by.src!.bytes, by.src!.commits, by.src!.dirty, by.src!.ext], [2, 100_000, 1, 2, 'ts'])
  assert.equal(by.src!.lastAt, T0 - DAY)
  assert.equal(by.test!.commits, 1)
  assert.equal(by.docs!.commits, 0, 'a month ago is outside the window')
  assert.equal(by.docs!.dirty, 1)
  assert.equal(by['']!.commits, 1, "the root's own files")
  assert.deepEqual(signLine(c), ['main ↑2 · 2 commits/2 wks', '3 uncommitted'])
})

test('more folders than the limit: the smallest make one more block', () => {
  const files: [string, number][] = Array.from({ length: 20 }, (_, i) => [`f${String(i).padStart(2, '0')}/x.ts`, 1000 * (20 - i)])
  const c = censusFrom(entries(files), [{ at: T0, who: 'A', subject: 's', files: ['f19/x.ts'] }], ['f18/x.ts'], {}, T0)
  assert.equal(c.blocks.length, 12)
  const rest = c.blocks.at(-1)!
  assert.equal(rest.path, REST)
  assert.equal(rest.files, 9)
  assert.equal(rest.commits, 1, "a commit to one of the rest's files")
  assert.equal(rest.dirty, 1)
})

const census = (blocks: [string, number, number, number, number][], extra: Partial<Census> = {}): Census => ({
  at: T0,
  files: blocks.reduce((s, b) => s + b[1], 0),
  bytes: blocks.reduce((s, b) => s + b[2], 0),
  commits: blocks.reduce((s, b) => s + b[3], 0),
  dirty: blocks.reduce((s, b) => s + b[4], 0),
  branch: 'main',
  blocks: blocks.map(([path, files, bytes, commits, dirty]) => ({ path, files, bytes, commits, dirty, ...(commits ? { lastAt: T0 - DAY } : {}) })),
  ...extra,
})

test('houses: each folder a run, by its share of the files, the front plots first, the biggest at the back', () => {
  const slots = slotsOf(layoutWith('Brooklyn'), 'brooklyn')
  const c = census([['src', 300, 900_000, 5, 0], ['test', 80, 120_000, 0, 0], ['docs', 20, 30_000, 1, 0]])
  const placed = placeBlocks(slots, c)
  assert.equal(placed.length, slots.length)
  const used = plotsFor(c, slots.length)
  assert.equal(placed.filter(s => s.block >= 0).length, used)
  // The empty plots are at the back, the folders in order after them.
  const firstUsed = placed.findIndex(s => s.block >= 0)
  assert.equal(firstUsed, slots.length - used)
  const order = placed.filter(s => s.block >= 0).map(s => s.block)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'one run per folder, biggest first')
  const count = (i: number) => placed.filter(s => s.block === i).length
  assert.ok(count(0) > count(1) && count(1) > count(2) && count(2) >= 1, `${count(0)} ${count(1)} ${count(2)}`)
  assert.ok(placed.find(s => s.block === 0)!.lit, 'src was worked on')
  assert.ok(!placed.find(s => s.block === 1)!.lit, 'test was not')
  assert.equal(placed.find(s => s.block === 1)!.pal, 'r', 'tests in red brick')
  assert.equal(placed.find(s => s.block === 2)!.pal, 's', 'docs in stone')
  assert.ok(heightOf(900_000) > heightOf(30_000))

  // A tiny repository fills a few plots and leaves the rest to grow into.
  const tiny = placeBlocks(slots, census([['', 3, 2000, 1, 0]]))
  assert.equal(tiny.filter(s => s.block >= 0).length, plotsFor(census([['', 3, 2000, 1, 0]]), slots.length))
  assert.ok(tiny.filter(s => s.block < 0).length > slots.length / 2)

  // Runs: one box per row a folder runs along.
  for (const r of runsOf(placed)) assert.ok(r.box[2] > r.box[0] && r.h > 0)
})

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

function withBrooklyn(): City {
  const city = cityWith('Brooklyn')
  city.buildAll(T0 - 60_000)
  city.apply(ev('SessionStart', 'S1'), T0)
  city.world.repos.push({ root: OTHER, name: 'api', burb: 'brooklyn', lastSeen: T0 })
  return city
}

test('a borough draws its census: the map follows the folders, the overlay the sign and scaffolding, the zones name each folder', () => {
  const city = withBrooklyn()
  const before = renderFrame(city.world, T0 + 1000)
  const c = census([['src', 300, 900_000, 5, 2], ['test', 80, 120_000, 0, 0]], { ahead: 1, behind: 0 })
  assert.deepEqual(city.censusWanted(), [{ root: OTHER, busy: false }])
  city.isDirty = false
  city.setCensus(OTHER, c)
  assert.ok(city.isDirty, 'a new census redraws')
  const after = renderFrame(city.world, T0 + 2000)
  assert.notEqual(after.map.hash, before.map.hash, 'the houses changed')

  const lit = after.overlay.find(i => i.k === 'burb:brooklyn')!.svg
  assert.ok(lit.includes('main ↑1 · 5 commits/2 wks') && lit.includes(' · 2 uncommitted'), lit)
  assert.ok(lit.includes('class="scaf"'), 'scaffolding on src, which has uncommitted changes')
  const zones = after.overlay.find(i => i.k === 'zones')!.svg
  assert.ok(zones.includes('data-tip-title="api: src/"'), 'a house names its folder')
  assert.ok(zones.includes('data-tip-title="api: test/"'))
  assert.ok(zones.includes('No commits in the last 14 days'), 'and says why test is dark')
  assert.ok(zones.includes('On main, 1 ahead.'), "the borough's own hover sums it up")

  // The same census again changes nothing; uncommitted changes alone leave the map be.
  city.isDirty = false
  city.setCensus(OTHER, { ...c, at: T0 + 5000 })
  assert.ok(!city.isDirty)
  const clean = census([['src', 300, 900_000, 5, 0], ['test', 80, 120_000, 0, 0]], { ahead: 1, behind: 0 })
  city.setCensus(OTHER, clean)
  const later = renderFrame(city.world, T0 + 3000)
  assert.equal(later.map.hash, after.map.hash, 'committing nothing new keeps the map')
  assert.ok(!later.overlay.find(i => i.k === 'burb:brooklyn')!.svg.includes('class="scaf"'), 'the scaffolding comes down')
  assert.ok(sameCensus(clean, { ...clean, at: 1 }))
})

test("a drawn borough's zoned lots take its folders, whatever the population", () => {
  const city = cityWith()
  city.buildAll(T0 - 60_000)
  city.apply(ev('SessionStart', 'S1'), T0)
  city.world.population = 0
  city.apply(ev('SessionStart', 'S2', { cwd: OTHER }), T0 + 100)
  const [x, y] = findSite(city.world.layout!, 6, 6, stationDoor(city.world.layout!))!
  assert.ok('ok' in city.build({ op: 'borough', x, y, w: 6, h: 6, name: 'Red Hook', root: OTHER, fill: true }, T0 + 200))
  const bo = city.world.layout!.boroughs.find(b => b.name === 'Red Hook')!
  const slots = slotsOf(city.world.layout!, bo.id)
  assert.ok(slots.length > 0, 'its streets and lots laid, so it has plots')
  const before = renderFrame(city.world, T0 + 300)
  city.setCensus(OTHER, census([['src', 40, 200_000, 3, 1], ['docs', 5, 9000, 0, 0]]))
  const after = renderFrame(city.world, T0 + 400)
  assert.notEqual(after.map.hash, before.map.hash)
  const zones = after.overlay.find(i => i.k === 'zones')!.svg
  assert.ok(zones.includes('data-tip-title="api: src/"'))
  assert.ok(after.overlay.find(i => i.k === `burb:${bo.id}`)!.svg.includes('class="scaf"'))
})

test('the census taker reads a real repository: this one', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const taker = new CensusTaker()
  assert.ok(taker.due(root, undefined, false, T0))
  const c = await taker.take(root)
  assert.ok(c, 'a census')
  assert.ok(c.files > 20 && c.bytes > 10_000, `${c.files} files, ${c.bytes} bytes`)
  assert.ok(c.blocks.some(b => b.path === 'test'), c.blocks.map(b => b.path).join(' '))
  assert.ok(c.blocks.some(b => b.path.startsWith('src')))
  assert.equal(c.blocks.reduce((s, b) => s + b.files, 0), c.files, 'every file in one block')
  assert.ok(!taker.due(root, c, false, c.at + 60_000), 'quiet: not again for a while')
  assert.ok(taker.due(root, c, true, c.at + 60_000), 'busy: again soon')
  // Not a repository: nothing, and not tried again straight away.
  const none = await taker.take('C:/definitely/not/a/repo/here')
  assert.equal(none, undefined)
  assert.ok(!taker.due('C:/definitely/not/a/repo/here', undefined, true, Date.now()))
})
