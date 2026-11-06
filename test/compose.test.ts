import test from 'node:test'
import assert from 'node:assert/strict'

import { compose, overlaps } from '../src/draw/map.ts'
import type { Item, Part } from '../src/draw/map.ts'
import type { Pt } from '../src/draw/geo.ts'

// compose draws the city's fabric back to front in as few elements as keep
// the picture: faces that overlap keep their order unless they share a fill,
// faces that don't may share a layer, and an item without parts is a wall.

const sq = (x: number, y: number, s = 10): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
const face = (fill: string, x: number, y: number, s = 10): Part => ({ fill: `class="${fill}"`, d: `<${fill}@${x},${y}>`, pts: sq(x, y, s) })
const item = (...parts: Part[]): Item => ({ depth: 0, svg: '', parts })
// The paths drawn, in order: [fill, the faces in it].
const paths = (s: string) => [...s.matchAll(/<path class="(\w+)" d="([^"]*)"\/>|(<g id="\w+"\/>)/g)].map(m => m[3] ? [m[3], ''] : [m[1]!, m[2]!])

test('overlaps: area, not a shared edge', () => {
  assert.ok(overlaps(sq(0, 0), sq(5, 5)))
  assert.ok(!overlaps(sq(0, 0), sq(10, 0)), 'side by side')
  assert.ok(!overlaps(sq(0, 0), sq(30, 0)))
  // A slanted wall and a square clear of it, inside its bounding box.
  assert.ok(!overlaps([[0, 0], [10, 5], [10, -15], [0, -20]], sq(8, -20, 3)))
})

test('faces that do not overlap share a layer: one path per fill', () => {
  const s = compose([item(face('aL', 0, 0), face('aR', 10, 0)), item(face('aL', 50, 0), face('aR', 60, 0)), item(face('aL', 100, 0))])
  assert.deepEqual(paths(s), [['aL', '<aL@0,0><aL@50,0><aL@100,0>'], ['aR', '<aR@10,0><aR@60,0>']])
})

test('a face over another in a different fill is drawn after it', () => {
  const s = compose([item(face('aR', 0, 0)), item(face('bL', 5, 5)), item(face('aR', 50, 0))])
  const p = paths(s)
  assert.deepEqual(p.map(([f]) => f), ['aR', 'bL'])
  assert.equal(p[0]![1], '<aR@0,0><aR@50,0>', 'the far face joins the first layer')
  // And the chain goes on: a third over the second, in the first fill.
  const t = paths(compose([item(face('aR', 0, 0)), item(face('bL', 5, 5)), item(face('aR', 10, 10))]))
  assert.deepEqual(t, [['aR', '<aR@0,0>'], ['bL', '<bL@5,5>'], ['aR', '<aR@10,10>']])
})

test('overlapping faces of one fill merge', () => {
  assert.deepEqual(paths(compose([item(face('aT', 0, 0)), item(face('aT', 5, 5))])), [['aT', '<aT@0,0><aT@5,5>']])
})

test('nothing moves across an item without parts', () => {
  const wall: Item = { depth: 0, svg: '<g id="lm"/>' }
  const p = paths(compose([item(face('aL', 0, 0)), wall, item(face('aL', 500, 500))]))
  assert.deepEqual(p, [['aL', '<aL@0,0>'], ['<g id="lm"/>', ''], ['aL', '<aL@500,500>']])
})
