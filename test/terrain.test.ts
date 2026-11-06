import test from 'node:test'
import assert from 'node:assert/strict'

import { marching, marchingPieces } from '../src/draw/map.ts'
import { generateMap } from '../src/layout.ts'

// A generated map's land is drawn as traced outlines (marching): one loop per
// coast, where it used to be a piece per square (marchingPieces), which the
// GPU paid for each time the view settled. Both must cover the same ground.

// The path's loops as point lists (M, L, H, V, z, absolute only).
function loops(d: string): [number, number][][] {
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  let x = 0
  let y = 0
  for (const [, op, args] of d.matchAll(/([MLHVz])([^MLHVz]*)/g)) {
    const v = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (op === 'M') { if (cur.length) out.push(cur); cur = [[x = v[0]!, y = v[1]!]] }
    else if (op === 'L') cur.push([x = v[0]!, y = v[1]!])
    else if (op === 'H') cur.push([x = v[0]!, y])
    else if (op === 'V') cur.push([x, y = v[0]!])
    else { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}

// Nonzero winding of the point (px, py), as the SVG fill rule takes it.
function winding(ls: [number, number][][], px: number, py: number): number {
  let w = 0
  for (const l of ls) {
    for (let i = 0; i < l.length; i++) {
      const [ax, ay] = l[i]!
      const [bx, by] = l[(i + 1) % l.length]!
      const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay)
      if (ay <= py && by > py && side > 0) w++
      else if (ay > py && by <= py && side < 0) w--
    }
  }
  return w
}

function same(cells: Set<string>, label: string, samples = 0) {
  const a = loops(marching(cells))
  const b = loops(marchingPieces(cells))
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number) as [number, number]
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  const check = (px: number, py: number) => assert.equal(winding(a, px, py) !== 0, winding(b, px, py) !== 0, `${label}: (${px}, ${py})`)
  if (samples) {
    // A big map: points scattered over it, fixed from run to run.
    let s = 7
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < samples; i++) check(x0 - 1 + rnd() * (x1 - x0 + 2), y0 - 1 + rnd() * (y1 - y0 + 2))
  } else {
    // Every quarter cell, off every edge and diagonal the outlines can run along.
    for (let y = y0 - 1; y <= y1 + 1; y += 0.25) for (let x = x0 - 1; x <= x1 + 1; x += 0.25) check(x + 0.0371, y + 0.0913)
  }
  return { loops: a.length, pieces: b.length }
}

const cellsOf = (rows: string[]) => {
  const s = new Set<string>()
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') s.add(`${x},${y}`) }))
  return s
}

test('a lake stays a hole, a saddle joins, a lone cell is a diamond', () => {
  const lake = cellsOf(['#####', '#...#', '#.#.#', '#...#', '#####'])
  const r = same(lake, 'lake')
  assert.equal(r.loops, 3) // the coast, the lake, the islet in it
  same(cellsOf(['#.', '.#']), 'saddle')
  same(cellsOf(['.#.', '#.#', '.#.']), 'ring of saddles')
  const one = loops(marching(cellsOf(['#'])))
  assert.equal(one.length, 1)
  assert.equal(one[0]!.length, 4)
})

test('the traced land covers what the pieces did, on generated maps', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    const all = new Set<string>()
    generateMap(seed).land.forEach(([y, x0, x1]) => { for (let x = x0; x < x1; x++) all.add(`${x},${y}`) })
    const r = same(all, `seed ${seed}`, 3000)
    // A coast is a loop, not a piece per square.
    assert.ok(r.loops * 20 < r.pieces, `seed ${seed}: ${r.loops} loops for ${r.pieces} pieces`)
  }
})

test('random speckle: every corner case at once', () => {
  let s = 12345
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const cells = new Set<string>()
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) if (rnd() < 0.5) cells.add(`${x},${y}`)
  same(cells, 'speckle')
})
