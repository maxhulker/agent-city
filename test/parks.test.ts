import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { placeAt } from '../src/draw/geo.ts'
import { SIZES, canPlace, cellsOf, footprintOf, parseOp, roomOf, siteFor, takenAt } from '../src/layout.ts'
import { City } from '../src/world.ts'

// Parks in sizes: Central Park is the plaza's own footprint, and the plaza
// also comes as a town square and a pocket park. A sized park is placed by
// the same rules, drawn to fit its footprint, named by its size, and its
// resting agents stand on its lawn.

const T0 = 1_700_000_000_000
const SEED = 7

function laidOut(): City {
  const city = new City()
  assert.ok('ok' in city.newMap(SEED, T0))
  return city
}

// Free land near the station for a park of this size, with a street laid
// along its front.
function plot(city: City, size: string): { x: number; y: number } {
  const [[, , w, d]] = footprintOf('plaza', size)
  const st = city.world.layout!.buildings.find(b => b.kind === 'station')!
  for (let y = st.y - 12; y < st.y + 12; y++) {
    for (let x = st.x - 14; x < st.x + 8; x++) {
      if (canPlace(city.world.layout!, 'plaza', x, y, 's', size) !== 'No road along its front') continue
      if (!('ok' in city.build({ op: 'road', x, y: y + d, dir: 1, len: w }, T0))) continue
      if (!canPlace(city.world.layout!, 'plaza', x, y, 's', size)) return { x, y }
    }
  }
  assert.fail(`no plot for a ${size}`)
}

test('the plaza comes in sizes, and an op names one only where the kind has it', () => {
  assert.deepEqual(footprintOf('plaza'), [[0, 0, 4, 13]], 'Central Park is the kind’s own')
  assert.deepEqual(footprintOf('plaza', 'square'), [[0, 0, 4, 4]])
  assert.deepEqual(footprintOf('plaza', 'pocket'), [[0, 0, 2, 2]])
  assert.deepEqual(footprintOf('plaza', 'nonsense'), [[0, 0, 4, 13]])
  assert.equal(SIZES.plaza?.pocket?.name, 'Pocket park')
  assert.deepEqual(parseOp({ op: 'place', kind: 'plaza', x: 3, y: 4, size: 'pocket' }), { op: 'place', kind: 'plaza', x: 3, y: 4, size: 'pocket' })
  assert.equal(parseOp({ op: 'place', kind: 'plaza', x: 3, y: 4, size: 'huge' }), undefined)
  assert.equal(parseOp({ op: 'place', kind: 'library', x: 3, y: 4, size: 'pocket' }), undefined)
  assert.equal(parseOp({ op: 'place', kind: 'plaza', x: 3, y: 4, size: 'toString' }), undefined, 'own sizes only')
  const city = laidOut()
  assert.equal(canPlace(city.world.layout!, 'library', 0, 0, 's', 'pocket'), 'Unknown size')
})

test('a pocket park takes its two by two cells, stands at once and is drawn under its own name', () => {
  const city = laidOut()
  const { x, y } = plot(city, 'pocket')
  const before = renderFrame(city.world, T0).map!.svg
  assert.ok('ok' in city.build({ op: 'place', kind: 'plaza', x, y, size: 'pocket' }, T0 + 10))
  const l = city.world.layout!
  const park = siteFor(l, 'plaza')!
  assert.equal(park.size, 'pocket')
  assert.equal(park.built, T0 + 10, 'stands at once in the city')
  assert.deepEqual(cellsOf(park), [[x, y, x + 2, y + 2]])
  for (const [cx, cy] of [[x, y], [x + 1, y + 1]]) assert.equal(takenAt(l, cx!, cy!), 'building')
  assert.equal(takenAt(l, x + 2, y), undefined, 'and no more')
  assert.equal(city.quests()!.find(q => q.id === 'plaza')!.state, 'done', 'any size of park is the quest’s')
  const f = renderFrame(city.world, T0 + 20)
  assert.notEqual(f.map!.svg, before)
  const names = f.overlay.find(i => i.k === 'labels')!.svg
  assert.ok(names.includes('POCKET PARK'), 'its name on the map')
  assert.ok(!names.includes('CENTRAL PARK'))
  const zones = f.overlay.find(i => i.k === 'zones')!.svg
  assert.ok(zones.includes('Pocket park'), 'and in its tooltip')
})

test("a sized park's resting agents stand on its lawn, closer together on a smaller one", () => {
  for (const size of ['pocket', 'square']) {
    const city = laidOut()
    const { x, y } = plot(city, size)
    assert.ok('ok' in city.build({ op: 'place', kind: 'plaza', x, y, size }, T0))
    const l = city.world.layout!
    const [x0, y0, x1, y1] = cellsOf(siteFor(l, 'plaza')!)[0]!
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = placeAt({ at: 'plaza' }, i, l)
      assert.ok(ax > x0 && ax < x1 && ay > y0 && ay < y1, `${size}: agent ${i} at ${ax},${ay} in ${x0},${y0}–${x1},${y1}`)
    }
  }
  const city = laidOut()
  const { x, y } = plot(city, 'pocket')
  assert.ok('ok' in city.build({ op: 'place', kind: 'plaza', x, y, size: 'pocket' }, T0))
  assert.ok(roomOf(siteFor(city.world.layout!, 'plaza')) < 1)
  assert.equal(roomOf(undefined), 1)
})

test('a town square draws a pond, a pocket park none', () => {
  const pond = (size: string) => {
    const city = laidOut()
    const { x, y } = plot(city, size)
    const bare = (renderFrame(city.world, T0).map!.svg.match(/fill="#1e4f86"/g) ?? []).length
    assert.ok('ok' in city.build({ op: 'place', kind: 'plaza', x, y, size }, T0))
    return (renderFrame(city.world, T0 + 1).map!.svg.match(/fill="#1e4f86"/g) ?? []).length - bare
  }
  assert.equal(pond('square'), 1)
  assert.equal(pond('pocket'), 0)
})
