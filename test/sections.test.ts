import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyOp, boroughRect, cityBuildings, findSite, generateMap, groupOf, hubOf, mapShape, partName, seamCrossings, sectionSite, shownName } from '../src/layout.ts'
import type { Borough, Layout, Rect } from '../src/layout.ts'
import { renderFrame } from '../src/city.ts'
import { City, SECTION_LOOK } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// The hub island in the middle of a generated map is the city's own: every
// borough goes on the mainland. And a project is one place: another
// worktree of it is built onto its borough as a section.

const SEED = 1511622721
const T0 = 1_700_000_000_000
const near = (l: Layout): [number, number] => {
  const st = cityBuildings(l, 'station')[0]!
  return [st.x + 1, st.y + 2]
}
const cells = ([x0, y0, x1, y1]: Rect) => {
  const out: [number, number][] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push([x, y])
  return out
}
const shared = ([a0, b0, c0, d0]: Rect, [a1, b1, c1, d1]: Rect) =>
  (c0 === a1 || c1 === a0 ? Math.max(0, Math.min(d0, d1) - Math.max(b0, b1)) : 0) + (d0 === b1 || d1 === b0 ? Math.max(0, Math.min(c0, c1) - Math.max(a0, a1)) : 0)
const apart = ([a0, b0, c0, d0]: Rect, [a1, b1, c1, d1]: Rect) => c0 <= a1 || c1 <= a0 || d0 <= b1 || d1 <= b0
const built = (l: Layout, op: Parameters<typeof applyOp>[1]) => {
  const r = applyOp(l, op)
  assert.ok('layout' in r, 'error' in r ? r.error : '')
  return r.layout
}

test('the hub is the island in the middle of a generated map, and no borough goes on it', () => {
  for (const seed of [1, 2, 3, 7, 42, SEED]) {
    const l = generateMap(seed)
    const hub = hubOf(l)
    const { cx, cy } = mapShape(seed)
    const st = cityBuildings(l, 'station')[0]!
    assert.ok(hub(Math.floor(cx), Math.floor(cy)) && hub(st.x, st.y), `seed ${seed}: the middle and the station are the hub`)
    const site = findSite(l, 10, 6, near(l))
    assert.ok(site, `seed ${seed}: room on the mainland`)
    assert.ok(cells(site).every(([x, y]) => !hub(x, y)), `seed ${seed}: the site is off the hub`)
  }
})

test('a section is built onto its project borough: sharing an edge, off the hub, clear of the rest', () => {
  let l = generateMap(SEED)
  const site = findSite(l, 10, 6, near(l))!
  l = built(l, { op: 'borough', name: 'agent-city', x: site[0], y: site[1], w: 10, h: 6 })
  // Someone else's borough near it, which the section keeps a cell from.
  const other = findSite(l, 6, 4, near(l))!
  l = built(l, { op: 'borough', name: 'other', x: other[0], y: other[1], w: 6, h: 4 })
  const s1 = sectionSite(l, 'agent-city', 8)!
  assert.ok(s1, 'a place for it')
  assert.ok(shared(s1, site) >= 2, 'sharing an edge with the borough')
  assert.ok(apart(s1, site), 'not over it')
  const hub = hubOf(l)
  assert.ok(cells(s1).every(([x, y]) => !hub(x, y)), 'off the hub')
  const [o0, o1, o2, o3] = other
  assert.ok(apart(s1, [o0 - 1, o1 - 1, o2 + 1, o3 + 1]), "a cell from someone else's")
  l = built(l, { op: 'borough', name: 'agent-city-terrain', x: s1[0], y: s1[1], w: s1[2] - s1[0], h: s1[3] - s1[1], of: 'agent-city' })
  const sec = l.boroughs.at(-1)!
  assert.equal(sec.of, 'agent-city')
  // A section of a section is a section of the main one; the next touches the group.
  const s2 = sectionSite(l, sec.id, 8)!
  l = built(l, { op: 'borough', name: 'agent-city-cmp', x: s2[0], y: s2[1], w: s2[2] - s2[0], h: s2[3] - s2[1], of: sec.id })
  assert.equal(l.boroughs.at(-1)!.of, 'agent-city')
  assert.deepEqual(groupOf(l, 'agent-city-cmp').map(b => b.id), ['agent-city', 'agent-city-terrain', 'agent-city-cmp'])
  assert.ok(shared(s2, site) + shared(s2, s1) >= 2, 'touching the group')
  // Named as part of the project.
  assert.equal(partName('agent-city-terrain', 'agent-city'), 'terrain')
  assert.equal(partName('elsewhere', 'agent-city'), 'elsewhere')
  assert.equal(shownName(l, sec), 'agent-city · terrain')
  assert.equal(shownName(l, l.boroughs.find(b => b.id === 'agent-city')!), 'agent-city')
  // Bulldoze the main one: the first section takes over.
  const after = built(l, { op: 'remove', id: 'agent-city' })
  const left = (id: string) => after.boroughs.find(b => b.id === id)!
  assert.equal(left('agent-city-terrain').of, undefined)
  assert.equal(left('agent-city-cmp').of, 'agent-city-terrain')
})

// ---- the city: arrivals, and the one-time regroup ----------------------------

function ev(name: string, sid: string, cwd: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd, ...extra }
}
function work(city: City, sid: string, cwd: string, now: number) {
  city.apply(ev('SessionStart', sid, cwd), now)
  const extra = { tool_name: 'Read', tool_use_id: `${sid}-${now}`, tool_input: { file_path: `${cwd}/a.ts` } }
  city.apply(ev('PreToolUse', sid, cwd, extra), now + 1)
  city.apply(ev('PostToolUse', sid, cwd, { ...extra, tool_response: 'ok' }), now + 2)
}
const size = () => ({ files: 40, folders: 5 })

function folders() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sections-'))
  const at = (name: string) => {
    const p = join(dir, name).split('\\').join('/')
    mkdirSync(p, { recursive: true })
    return p
  }
  return { dir, home: at('home'), main: at('agent-city'), wt: at('agent-city-terrain'), other: at('api') }
}

test('a worktree whose project has a borough builds its section there as soon as git names its project', () => {
  const f = folders()
  try {
    const city = new City()
    assert.deepEqual(city.newMap(SEED, T0 - 1000), { ok: true })
    work(city, 'S0', f.home, T0)
    work(city, 'S1', f.main, T0 + 100)
    assert.deepEqual(city.build({ op: 'autoborough', root: f.main, files: 60, folders: 6 }, T0 + 200), { ok: true })
    const project = (f.main + '/.git').toLowerCase()
    city.setProject(f.main, project, size, T0 + 300)
    work(city, 'S2', f.wt, T0 + 400)
    const wt = () => city.world.repos.find(r => r.root === f.wt)!
    assert.ok(wt().burb.startsWith('@'), 'waiting until its project is known')
    city.setProject(f.wt, project, size, T0 + 500)
    const sec = city.world.layout!.boroughs.find(b => b.id === wt().burb)!
    assert.ok(sec, 'it has a borough')
    assert.equal(sec.of, 'agent-city', 'a section of its project')
    assert.ok(shared(boroughRect(sec), boroughRect(city.world.layout!.boroughs[0]!)) >= 2)
    // Another project's repository still waits for a click.
    work(city, 'S3', f.other, T0 + 600)
    city.setProject(f.other, (f.other + '/.git').toLowerCase(), size, T0 + 700)
    assert.ok(city.world.repos.find(r => r.root === f.other)!.burb.startsWith('@'))
    // A branch off its project: smaller than the main borough, half its lots at most.
    const l = city.world.layout!
    const main = l.boroughs.find(b => b.id === 'agent-city')!
    const lotsIn = (bo: Borough) => {
      const [x0, y0, x1, y1] = boroughRect(bo)
      return l.zoned.filter(([x, y]) => x >= x0 && x < x1 && y >= y0 && y < y1).length
    }
    assert.ok(sec.w * sec.h < main.w * main.h, `smaller: ${sec.w}x${sec.h} beside ${main.w}x${main.h}`)
    assert.ok(lotsIn(sec) <= Math.ceil(lotsIn(main) / 2), `${lotsIn(sec)} lots beside ${lotsIn(main)}`)
    // Joined to it by a spur street across the seam: two cells of road.
    assert.equal(seamCrossings(l, sec.id).length, 2, 'a spur onto the project')
    // The map draws it in a colour of its own, the spur painted, named by its own part.
    const frame = renderFrame(city.world, T0 + 800)
    const map = frame.map.svg
    const over = frame.overlay.map(o => o.svg).join('')
    assert.ok(over.includes('↳ TERRAIN'), 'the section is named by its own part, over its houses')
    assert.ok(!map.includes('TERRAIN'), 'and not under them')
    assert.ok(map.includes('class="spur"'), 'its spur is painted')
    assert.ok(map.includes('stroke="#2dd4bf"'), 'in the first branch colour')
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test('regroup, once: boroughs leave the hub, worktrees gather into their project, a vanished worktree is taken up', () => {
  const f = folders()
  try {
    const city = new City()
    assert.deepEqual(city.newMap(SEED, T0 - 1000), { ok: true })
    work(city, 'S0', f.home, T0)
    for (const [i, root] of [f.main, f.wt, f.other].entries()) work(city, `S${i + 1}`, root, T0 + 100 * (i + 1))
    const gone = f.dir.split('\\').join('/') + '/agent-city-cmp'
    work(city, 'S9', gone, T0 + 450)
    // Laid out the old way: agent-city on the hub, the worktrees each a borough of their own.
    const l0 = city.world.layout!
    const { cx, cy } = mapShape(SEED)
    const hubAt = (w: number, h: number): Rect => {
      for (let dy = -6; dy < 6; dy++) for (let dx = -6; dx < 6; dx++) {
        const r: Rect = [Math.floor(cx) + dx, Math.floor(cy) + 3 + dy, Math.floor(cx) + dx + w, Math.floor(cy) + 3 + dy + h]
        if (cells(r).every(([x, y]) => hubOf(l0)(x, y)) && !cityBuildings(l0, 'station').some(s => !apart(r, [s.x - 1, s.y - 1, s.x + 6, s.y + 3]))) return r
      }
      throw new Error('no room on the hub')
    }
    const onHub = hubAt(6, 4)
    // The old rules let this through; lay it straight into the layout.
    const old: Borough = { id: 'agent-city', name: 'agent-city', root: f.main, x: onHub[0], y: onHub[1], w: 6, h: 4 }
    city.world.layout = { ...l0, boroughs: [...l0.boroughs, old], rev: l0.rev + 1 }
    assert.ok('ok' in city.moveIn(f.main, 'agent-city', T0 + 500))
    for (const [root, name] of [[f.wt, 'agent-city-terrain'], [gone, 'agent-city-cmp'], [f.other, 'api']] as const) {
      const l = city.world.layout!
      const s = findSite(l, 6, 4, near(l))!
      assert.ok('ok' in city.build({ op: 'borough', name, root, x: s[0], y: s[1], w: 6, h: 4, fill: true }, T0 + 600))
    }
    const project = (f.main + '/.git').toLowerCase()
    assert.equal(city.regroup(size, T0 + 700), false, 'waits for every project')
    // git can't name a vanished folder's project: it is ''.
    for (const root of [f.main, f.wt, gone]) city.setProject(root, root === gone ? '' : project, size, T0 + 700)
    city.setProject(f.other, (f.other + '/.git').toLowerCase(), size, T0 + 700)
    const apiBefore = boroughRect(city.world.layout!.boroughs.find(b => b.id === 'api')!)
    assert.equal(city.regroup(size, T0 + 800), true)
    const l = city.world.layout!
    const hub = hubOf(l)
    for (const bo of l.boroughs) assert.ok(cells(boroughRect(bo)).every(([x, y]) => !hub(x, y)), `${bo.id} is off the hub`)
    const repo = (root: string) => city.world.repos.find(r => r.root === root)!
    const main = l.boroughs.find(b => b.id === repo(f.main).burb)!
    const sec = l.boroughs.find(b => b.id === repo(f.wt).burb)!
    assert.equal(main.of, undefined, 'agent-city is still the main one')
    assert.equal(sec.of, main.id, 'the worktree is its section')
    assert.ok(shared(boroughRect(sec), boroughRect(main)) >= 2, 'built onto it')
    assert.ok(repo(gone).burb.startsWith('@') && repo(gone).left, 'the vanished worktree packed up')
    assert.ok(!l.boroughs.some(b => b.name === 'agent-city-cmp'), 'and its borough was taken up')
    assert.deepEqual(boroughRect(l.boroughs.find(b => b.id === 'api')!), apiBefore, 'an unrelated borough off the hub stays put')
    assert.ok(city.world.regrouped)
    assert.equal(city.world.sectionLook, SECTION_LOOK)
    assert.equal(city.regroup(size, T0 + 900), false, 'only once')
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

// A city whose sections were laid out before the branch look: flush, the
// size of their project's borough, no spur.
function oldLook() {
  const f = folders()
  const city = new City()
  assert.deepEqual(city.newMap(SEED, T0 - 1000), { ok: true })
  work(city, 'S0', f.home, T0)
  for (const [i, root] of [f.main, f.wt].entries()) work(city, `S${i + 1}`, root, T0 + 100 * (i + 1))
  const project = (f.main + '/.git').toLowerCase()
  for (const root of [f.main, f.wt]) city.setProject(root, project, size, T0 + 300)
  const l = city.world.layout!
  const s = findSite(l, 10, 6, near(l))!
  assert.ok('ok' in city.build({ op: 'borough', name: 'agent-city', root: f.main, x: s[0], y: s[1], w: 10, h: 6, fill: true }, T0 + 400))
  const l2 = city.world.layout!
  assert.ok('ok' in city.build({ op: 'borough', name: 'agent-city-terrain', root: f.wt, x: s[0], y: s[3], w: 10, h: 6, fill: true }, T0 + 500))
  const sec = city.world.layout!.boroughs.at(-1)!
  city.world.layout = { ...city.world.layout!, boroughs: city.world.layout!.boroughs.map(b => (b === sec ? { ...b, of: 'agent-city' } : b)), rev: l2.rev + 5 }
  city.world.regrouped = true
  delete city.world.sectionLook
  return { f, city: new City(JSON.parse(JSON.stringify(city.world))) }
}

test('a city laid out before the branch look regroups once more: its sections are built again, smaller, with a spur', () => {
  const { f, city } = oldLook()
  try {
    assert.equal(city.world.regrouped, undefined, 'loading it asks for a regroup')
    assert.equal(city.regroup(size, T0 + 600), true)
    const l = city.world.layout!
    const main = l.boroughs.find(b => b.id === 'agent-city')!
    const sec = l.boroughs.find(b => b.id === city.world.repos.find(r => r.root === f.wt)!.burb)!
    assert.equal(sec.of, 'agent-city')
    assert.ok(sec.w * sec.h < main.w * main.h, 'smaller than its project now')
    assert.equal(seamCrossings(l, sec.id).length, 2, 'with a spur')
    assert.equal(city.world.sectionLook, SECTION_LOOK)
    assert.equal(new City(JSON.parse(JSON.stringify(city.world))).world.regrouped, true, 'and not again')
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test('a section whose worktree is removed is taken up with its spur; a borough of its own is not', () => {
  const { f, city } = oldLook()
  try {
    city.regroup(size, T0 + 600)
    const secId = city.world.repos.find(r => r.root === f.wt)!.burb
    const roadsBefore = city.world.layout!.roads.length
    const spur = seamCrossings(city.world.layout!, secId)
    assert.equal(city.pruneSections(T0 + 700), false, 'nothing gone yet')
    rmSync(f.wt, { recursive: true, force: true })
    // The main worktree's folder gone too: its borough stays all the same.
    rmSync(f.main, { recursive: true, force: true })
    assert.equal(city.pruneSections(T0 + 800), true)
    const l = city.world.layout!
    assert.ok(!l.boroughs.some(b => b.id === secId), 'the section is gone')
    assert.ok(l.boroughs.some(b => b.id === 'agent-city'), 'its project stays')
    assert.ok(spur.every(r => !l.roads.includes(r)), 'its spur went with it')
    assert.ok(l.roads.length < roadsBefore)
    const wt = city.world.repos.find(r => r.root === f.wt)!
    assert.ok(wt.burb.startsWith('@') && wt.left, 'its repository packed up')
    assert.equal(city.pruneSections(T0 + 900), false, 'once')
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})
