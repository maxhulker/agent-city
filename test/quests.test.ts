import test from 'node:test'
import assert from 'node:assert/strict'

import { GEN, canPlace, cellsOf } from '../src/layout.ts'
import { cityWith } from './whole.ts'
import type { Building, Kind } from '../src/layout.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Build your first district (docs/city-builder.md, step eight): on a laid-out
// map the quests go road, City Hall, the districts, zoning, the Empire State;
// placing builds, and the first use of a landmark opens its doors.

const T0 = 1_700_000_000_000
const SEED = 7

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: 'C:/fake/home', ...extra }
}

function laidOut(): City {
  const city = new City()
  assert.ok('ok' in city.newMap(SEED, T0))
  return city
}

const state = (city: City, id: string) => city.quests()!.find(q => q.id === id)!.state

// Places a kind near the station, laying a street along its front when it needs one.
function place(city: City, kind: Kind, now: number): Building {
  const l = () => city.world.layout!
  const st = l().buildings.find(b => b.kind === 'station')!
  for (let y = Math.max(0, st.y - 20); y < Math.min(GEN, st.y + 20); y++) {
    for (let x = Math.max(0, st.x - 20); x < Math.min(GEN, st.x + 20); x++) {
      const why = canPlace(l(), kind, x, y)
      if (why && why !== 'No road along its front') continue
      if (why) {
        const [x0, , x1, y1] = cellsOf({ id: '', kind, x, y, face: 's' })[0]!
        if (!('ok' in city.build({ op: 'road', x: x0, y: y1, dir: 1, len: x1 - x0 }, now))) continue
        if (canPlace(l(), kind, x, y)) continue
      }
      assert.ok('ok' in city.build({ op: 'place', kind, x, y }, now), `placing ${kind}`)
      return l().buildings[l().buildings.length - 1]!
    }
  }
  assert.fail(`nowhere for ${kind}`)
}

test("a new city's first quest is the road, then City Hall, which placing completes with no work", () => {
  const city = laidOut()
  const q = city.quests()!
  assert.deepEqual(q.map(x => x.id), ['road', 'hall', 'library', 'workshop', 'foundry', 'observatory', 'relay', 'harbor', 'plaza', 'liberty', 'zone', 'empire'])
  assert.equal(q[0]!.state, 'next')
  assert.ok(q.slice(1, -1).every(x => x.state === 'todo'))
  assert.equal(state(city, 'empire'), 'locked')

  const st = city.world.layout!.buildings.find(b => b.kind === 'station')!
  assert.ok('ok' in city.build({ op: 'road', x: st.x + 5, y: st.y + 1, dir: 1, len: 2 }, T0 + 100))
  assert.equal(state(city, 'road'), 'done')
  assert.equal(state(city, 'hall'), 'next')

  city.toasts.length = 0
  place(city, 'hall', T0 + 200)
  assert.equal(state(city, 'hall'), 'done', 'no work needed')
  assert.equal(city.world.built?.hall, T0 + 200)
  assert.ok(city.toasts.includes('City Hall went up'))
  assert.equal(state(city, 'library'), 'next')
  // Placing is a choice of the map: the picker is over.
  assert.deepEqual(city.newMap(1, T0 + 300), { error: 'The city is under way: its map stays' })
})

test('work of a kind nothing stands for builds nothing; the first use of a placed one opens its doors, once', () => {
  const city = laidOut()
  city.apply(ev('SessionStart', 'S1'), T0)
  const read = (now: number) => {
    const extra = { tool_name: 'Read', tool_use_id: `r${now}`, tool_input: { file_path: 'C:/fake/home/a.ts' } }
    city.apply(ev('PreToolUse', 'S1', extra), now)
    city.apply(ev('PostToolUse', 'S1', { ...extra, tool_response: 'ok' }), now + 10)
  }
  read(T0 + 100)
  assert.equal(city.world.built?.library, undefined, 'no Library: nothing rises')
  assert.equal(state(city, 'library'), 'todo')
  place(city, 'library', T0 + 200)
  assert.equal(state(city, 'library'), 'done')
  city.toasts.length = 0
  read(T0 + 300)
  assert.ok(city.toasts.includes('Public Library opened its doors'))
  assert.equal(city.quests()!.find(q => q.id === 'library')!.opened, T0 + 300)
  city.toasts.length = 0
  read(T0 + 400)
  assert.ok(!city.toasts.some(t => t.includes('opened')), 'once')
})

test('the Empire State is placeable only once every district stands', () => {
  const city = laidOut()
  let now = T0
  for (const k of ['hall', 'library', 'workshop', 'foundry', 'observatory', 'relay', 'harbor'] as Kind[]) place(city, k, (now += 100))
  assert.equal(state(city, 'empire'), 'locked')
  assert.deepEqual(city.build({ op: 'place', kind: 'empire', x: 0, y: 0 }, now), { error: 'Build every district first' })
  place(city, 'plaza', (now += 100))
  assert.notEqual(state(city, 'empire'), 'locked')
  assert.equal(city.world.built?.empire, undefined, 'a laid-out city places its own')
  city.toasts.length = 0
  place(city, 'empire', (now += 100))
  assert.equal(state(city, 'empire'), 'done')
  assert.ok(city.toasts.includes('The city is complete'))
})

test('Rebuild starts again on new land: a repository with a borough waits for another', () => {
  const city = cityWith('Brooklyn')
  city.buildAll(T0)
  city.apply(ev('SessionStart', 'S1'), T0 + 100)
  city.apply(ev('SessionStart', 'S2', { cwd: 'C:/fake/api' }), T0 + 200)
  city.apply(ev('UserPromptSubmit', 'S2', { cwd: 'C:/fake/api', prompt: 'hi' }), T0 + 300)
  assert.ok('ok' in city.build({ op: 'movein', id: 'brooklyn', root: 'C:/fake/api' }, T0 + 400))
  const rev = city.world.layout!.rev
  city.restart(SEED, T0 + 500)
  assert.deepEqual(city.world.layout!.map, { seed: SEED })
  assert.equal(city.world.layout!.rev, rev + 1)
  assert.deepEqual(city.world.built, {})
  assert.equal(state(city, 'road'), 'next')
  assert.ok(city.world.repos[0]!.burb.startsWith('@'), 'Brooklyn is gone: api waits for a borough')
  assert.equal(city.world.sessions.length, 2, 'the sessions stay')
})

test("the game's record is read from the buildings: one source of truth", () => {
  const city = laidOut()
  city.buildAll(T0)
  assert.deepEqual(city.world.built, {}, 'Build it all now raises nothing a laid-out city has not placed')
  const lib = place(city, 'library', T0 + 100)
  assert.equal(city.world.built?.library, T0 + 100)
  assert.ok('ok' in city.build({ op: 'remove', id: lib.id }, T0 + 200))
  assert.equal(city.world.built?.library, undefined, 'bulldozed: off the record')
  assert.notEqual(state(city, 'library'), 'done', 'its quest is open again')

  // A city saved with the old record, before layouts: new land, nothing standing, no torch.
  const saved = { ...new City().world, built: { harbor: T0, torch: T0 + 5 }, homeRoot: 'C:/fake/home', home: 'home' }
  delete saved.layout
  const old = new City(saved)
  assert.equal(old.world.torch, undefined)
  assert.deepEqual(old.world.built, {})
})
