import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { censusShape } from '../src/census.ts'
import { nearestSlot, placeBlocks, slotsOf } from '../src/draw/blocks.ts'
import { cityWith, layoutWith } from './whole.ts'
import type { Census } from '../src/types.ts'

// Moving a house: a folder the person pins stands from the plot they chose;
// the rest fill in around it, as the census would place them.

const T0 = 1_700_000_000_000
const census = (): Census => ({
  at: T0, files: 40, bytes: 4e5, commits: 3, dirty: 0,
  blocks: [
    { path: 'src', files: 20, bytes: 2e5, commits: 2, dirty: 0 },
    { path: 'test', files: 12, bytes: 1e5, commits: 1, dirty: 0 },
    { path: 'docs', files: 8, bytes: 1e5, commits: 0, dirty: 0 },
  ],
})
const runOf = (placed: ReturnType<typeof placeBlocks>, bi: number) => placed.map((s, i) => (s.block === bi ? i : -1)).filter(i => i >= 0)
// A plot's middle, to the hundredth of a cell, as the city keeps a pin.
const mid = (s: { x: number; y0: number; w: number; d: number }): [number, number] => [Math.round((s.x + s.w / 2) * 100) / 100, Math.round((s.y0 + s.d / 2) * 100) / 100]

test('a pinned folder stands from the plot nearest its pin; the rest fill in as before', () => {
  const slots = slotsOf(layoutWith('Brooklyn'), 'brooklyn')
  const plain = placeBlocks(slots, census())
  // With no pins, unchanged: the front plots, in census order.
  const docsBefore = runOf(plain, 2)
  assert.ok(docsBefore.length > 0)
  assert.equal(plain.filter(s => s.block >= 0).length, runOf(plain, 0).length + runOf(plain, 1).length + docsBefore.length)

  // Pin docs to the very first (backmost) plot.
  const pinned = placeBlocks(slots, { ...census(), pins: { docs: mid(slots[0]!) } })
  const docs = runOf(pinned, 2)
  assert.equal(docs[0], 0, 'from the plot it was dropped on')
  assert.equal(docs.length, docsBefore.length, 'with as many houses as before')
  assert.equal(runOf(pinned, 0).length, runOf(plain, 0).length, 'the others keep their size')
  assert.ok(!runOf(pinned, 0).some(i => docs.includes(i)), 'and keep off it')
  assert.deepEqual(nearestSlot(slots, mid(slots[5]!))!.i, 5)
})

test('moving a house on the map: pinned, swapped with another moved one, let go, and reset by a move', () => {
  const city = cityWith('Brooklyn', 'Queens')
  city.apply({ hook_event_name: 'SessionStart', session_id: 'S1', cwd: 'C:/fake/home' }, T0)
  const root = 'C:/fake/api'
  city.build({ op: 'movein', id: 'brooklyn', root }, T0)
  city.setCensus(root, census())
  const repo = () => city.world.repos.find(r => r.root === root)!
  const slots = slotsOf(city.world.layout!, 'brooklyn')
  const at = (i: number) => mid(slots[i]!)

  assert.match((city.moveHouse({ root, folder: 'nope', x: 1, y: 1 }) as { error: string }).error, /No such folder/)
  assert.match((city.moveHouse({ root, folder: 'docs', x: -500, y: -500 }) as { error: string }).error, /Drop it on a lot in Brooklyn/)
  assert.match((city.moveHouse({ root: 'C:/fake/elsewhere', folder: 'docs', x: 1, y: 1 }) as { error: string }).error, /Not a project/)

  const before = renderFrame(city.world, T0).map!.hash
  assert.deepEqual(city.moveHouse({ root, folder: 'docs', x: at(0)[0] + 0.1, y: at(0)[1] }), { ok: true })
  assert.deepEqual(repo().pins, { docs: at(0) }, 'snapped to the plot')
  assert.deepEqual(repo().census!.pins, repo().pins)
  assert.notEqual(renderFrame(city.world, T0 + 1).map!.hash, before, 'the map redraws')
  assert.notEqual(JSON.stringify(censusShape(repo().census)), JSON.stringify(censusShape(census())))

  // test, pinned onto docs's plot: they trade places.
  const docsFirst = 0
  const testFrom = runOf(placeBlocks(slots, repo().census!), 1)[0]!
  assert.deepEqual(city.moveHouse({ root, folder: 'test', x: at(docsFirst)[0], y: at(docsFirst)[1] }), { ok: true })
  assert.deepEqual(repo().pins!.test, at(docsFirst))
  assert.deepEqual(repo().pins!.docs, at(testFrom), 'docs went where test stood')

  // A new census keeps them.
  city.setCensus(root, census())
  assert.deepEqual(Object.keys(repo().census!.pins ?? {}).sort(), ['docs', 'test'])

  // Let go: the census places it again.
  assert.deepEqual(city.moveHouse({ root, folder: 'docs', unpin: true }), { ok: true })
  assert.deepEqual(Object.keys(repo().pins!), ['test'])
  city.moveHouse({ root, folder: 'test', unpin: true })
  assert.equal(repo().pins, undefined)
  assert.equal(repo().census!.pins, undefined)

  // Pins belong to a borough: moving to another clears them.
  city.moveHouse({ root, folder: 'docs', x: at(0)[0], y: at(0)[1] })
  city.build({ op: 'movein', id: 'queens', root }, T0 + 10)
  assert.equal(repo().pins, undefined)
})
