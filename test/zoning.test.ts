import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { blocksFor, fullPopulation } from '../src/draw/geo.ts'
import { GEN, canPlace, generateMap, isBridge, landAt, lotsOf } from '../src/layout.ts'
import type { Layout } from '../src/layout.ts'
import { City, emptyWorld } from '../src/world.ts'

// Zoning, parks and the Statue (docs/city-builder.md, step nine): zoned lots
// fill with the population in the order they were zoned, a park cell draws
// lawn and trees and takes no building, the Statue stands in the water, and a
// road over water is drawn as a bridge.

const T0 = 1_700_000_000_000
const SEED = 7

function laidOut(): City {
  const city = new City()
  assert.ok('ok' in city.newMap(SEED, T0))
  return city
}

// The map is cached by its key, which a real change's revision always moves:
// each variant here carries its own revision.
const mapOf = (l: Layout, population: number) => {
  const w = emptyWorld()
  w.layout = l
  w.population = population
  return renderFrame(w, T0).map!.svg
}

// Free land on the station's street, east of the station: a run of cells
// along a road where blocks can be zoned.
function street(city: City): { x: number; y: number } {
  const st = city.world.layout!.buildings.find(b => b.kind === 'station')!
  for (let y = st.y - 10; y < st.y + 10; y++) {
    for (let x = st.x - 14; x < st.x + 4; x++) {
      if ([0, 2, 4, 6].every(dx => !canPlace(city.world.layout!, 'library', x + dx, y) || canPlace(city.world.layout!, 'library', x + dx, y) === 'No road along its front')) {
        if ('ok' in city.build({ op: 'road', x, y: y + 1, dir: 1, len: 8 }, T0)) return { x, y }
      }
    }
  }
  assert.fail('no street')
}

test('zoned blocks fill with the population in the order they were zoned', () => {
  const city = laidOut()
  const { x, y } = street(city)
  for (const dx of [0, 2, 4]) assert.ok('ok' in city.build({ op: 'zone', x: x + dx, y }, T0), `zone ${x + dx},${y}`)
  const l = city.world.layout!
  assert.deepEqual(lotsOf(l).map(lot => lot.x), [x, x + 2, x + 4], 'in zoning order')
  // A third of the way to a full population: one block of the three.
  const pop = Math.ceil(fullPopulation() * 0.12)
  assert.equal(blocksFor(pop, 3), 1)
  const first = mapOf(l, pop)
  const [A, B, C] = l.zoned as [[number, number], [number, number], [number, number]]
  assert.equal(first, mapOf({ ...l, zoned: [A, C, B], rev: l.rev + 101 }, pop), 'only the first-zoned block stands: the others may swap')
  assert.notEqual(first, mapOf({ ...l, zoned: [B, A, C], rev: l.rev + 102 }, pop), 'another first, another block')
  assert.notEqual(mapOf(l, 0), first, 'none before any work')
  assert.notEqual(mapOf(l, fullPopulation()), first, 'all three at full population')
})

test('a park cell draws lawn and trees and takes no building', () => {
  const city = laidOut()
  const { x, y } = street(city)
  const bare = mapOf(city.world.layout!, 0)
  assert.ok(!bare.includes('class="lawn"'))
  assert.ok('ok' in city.build({ op: 'paint', what: 'park', x, y, w: 2, h: 1 }, T0))
  const park = mapOf(city.world.layout!, 0)
  assert.ok(park.includes('class="lawn"'), 'lawn')
  const trees = (svg: string) => (svg.match(/<circle [^>]*fill="#1(66534|5803d)"/g) ?? []).length
  assert.ok(trees(park) >= trees(bare) + 4, `trees: ${trees(bare)} then ${trees(park)}`)
  assert.equal(canPlace(city.world.layout!, 'library', x, y), 'Something is already there')
  // The preset's own parks stay drawn by their landmarks, not twice.
  const preset = new City()
  assert.ok(!mapOf(preset.world.layout!, 0).includes('class="lawn"'))
})

test('the Statue stands in the water, goes up as she is placed, and a road over water is a bridge', () => {
  const city = laidOut()
  const l = () => city.world.layout!
  const st = l().buildings.find(b => b.kind === 'station')!
  assert.equal(canPlace(l(), 'liberty', st.x, st.y - 3), 'The Statue stands in the water')
  // Open water east of the station's island.
  let spot: [number, number] | undefined
  for (let x = st.x + 4; x < GEN - 2 && !spot; x++) if (!canPlace(l(), 'liberty', x, st.y + 4)) spot = [x, st.y + 4]
  assert.ok(spot, 'water for her')
  assert.ok('ok' in city.build({ op: 'place', kind: 'liberty', x: spot[0], y: spot[1] }, T0 + 100))
  const statue = l().buildings.find(b => b.kind === 'liberty')!
  assert.equal(statue.built, T0 + 100, 'she stands at once')
  assert.equal(city.quests()!.find(q => q.id === 'liberty')!.state, 'done')
  const f = renderFrame(city.world, T0 + 200)
  const item = f.overlay.find(i => i.k === 'statue')
  assert.ok(item && !item.svg.includes('dark'), 'drawn, lit up')

  // A bridge: a street from the station's island out over the water.
  const y = st.y + 1
  let x = st.x + 4
  while (landAt(l(), x, y) || landAt(l(), x, y - 1)) x++
  assert.ok('ok' in city.build({ op: 'road', x, y, dir: 1, len: 2 }, T0 + 300))
  assert.ok(isBridge(l(), [x, y, 1]))
  assert.ok(mapOf(l(), 0).includes('class="deck"'), 'drawn as a deck')
})
