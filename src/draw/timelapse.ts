import { burbGeo, n, p } from './geo.ts'
import { lotsIn, placeBlocks, slotsOf } from './blocks.ts'
import type { Placed } from './blocks.ts'
import { censusHouse, scaffold, tree } from './map.ts'
import type { Layout } from '../layout.ts'
import type { Burb, Census } from '../types.ts'

// A borough's time-lapse on a stage of its own (src/timelapse.ts): its ground
// and lots as the map has them, and for each frame its houses as that
// commit's census would build them, drawn by the map's own hand. The folders
// that changed in a frame go up in scaffolding. The page swaps the houses
// frame by frame.

const GRID = '<g transform="matrix(10 5 -10 5 0 0)">'
const rect = (x0: number, y0: number, x1: number, y1: number, fill: string, extra = '') =>
  `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="${fill}"${extra}/>`

// The borough's ground, in cells: x0, y0, x1, y1.
function groundOf(layout: Layout, id: Burb): [number, number, number, number] | undefined {
  return burbGeo(layout, id)?.rect
}

export type Stage = { viewBox: string; ground: string }

// The stage: its frame on screen, and the ground under the houses.
export function stageOf(layout: Layout, id: Burb): Stage | undefined {
  const r = groundOf(layout, id)
  const g = burbGeo(layout, id)
  if (!r || !g) return undefined
  const [x0, y0, x1, y1] = r
  // Streets under everything, the lots on them.
  let ground = GRID + rect(x0, y0, x1, y1, '#3a3f4a', ' rx=".3"')
  for (const l of lotsIn(layout, id)) ground += rect(l.x0 + 0.03, l.y + 0.06, l.x1 - 0.03, l.y + 0.94, '#272c36', ' rx=".08"')
  const [sx, sy] = g.square
  const half = Math.min(1.6, (x1 - x0) / 2 - 0.2)
  ground += rect(sx - half, sy - 0.6, sx + half, y1 - 0.15, '#343944', ' rx=".25"')
  ground += '</g>'
  // A few trees round the edge, for scale.
  for (const [tx, ty] of [[x0 + 0.3, y1 - 0.3], [x1 - 0.3, y1 - 0.3], [x1 - 0.3, y0 + 0.3]] as const) ground += tree(tx, ty, 1.4)
  // On screen: the ground's corners, and room above for the tallest tower and its crane.
  const corners = [p(x0, y0), p(x1, y0), p(x0, y1), p(x1, y1)]
  const xs = corners.map(c => c[0])
  const ys = corners.map(c => c[1])
  const left = Math.min(...xs) - 12
  const top = Math.min(...ys) - 48
  const w = Math.max(...xs) + 12 - left
  const h = Math.max(...ys) + 10 - top
  return { viewBox: `${n(left)} ${n(top)} ${n(w)} ${n(h)}`, ground }
}

// One frame's houses, back to front, the changed folders in scaffolding (a
// crane on the biggest of them).
export function framesHouses(layout: Layout, id: Burb, census: Census, changed: string[]): string {
  const g = burbGeo(layout, id)
  if (!g) return ''
  const placed = placeBlocks(slotsOf(layout, id), census)
  const isChanged = (s: Placed) => s.block >= 0 && changed.includes(census.blocks[s.block]!.path)
  const biggest = census.blocks.findIndex(b => changed.includes(b.path))
  let out = ''
  const order = placed.map((s, i) => [s, i] as const).sort((a, b) => a[0].x + a[0].y0 - (b[0].x + b[0].y0))
  let craned = false
  for (const [s] of order) {
    if (s.block < 0) continue
    out += censusHouse(s, [])
    if (isChanged(s)) {
      const crane = !craned && s.block === biggest
      if (crane) craned = true
      out += scaffold(s.x, s.y0, s.w, s.d, s.h, crane)
    }
  }
  return out
}
