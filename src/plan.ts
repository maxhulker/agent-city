// A whole city planned on a generated map: avenues and streets over the hub
// island, every landmark placed (not yet built) as near the station as it
// fits, and every lot left beside a road zoned. The tests stand on it, and
// the demo city (src/demo.ts) starts from it, its landmarks rising as its
// scripted sessions work.

import { FOOTPRINT, applyOp, cityBuildings, generateMap, hubOf } from './layout.ts'
import type { Face, Kind, Layout, Op } from './layout.ts'

const FACES: Face[] = ['s', 'e', 'w', 'n']

export function planCity(seed: number): Layout {
  let l = generateMap(seed)
  const hub = hubOf(l)
  const st = cityBuildings(l, 'station')[0]!
  const apply = (op: Op) => {
    const r = applyOp(l, op)
    if ('error' in r) return false
    l = r.layout
    return true
  }
  // The island's cells, nearest the station first.
  const cells: [number, number][] = []
  for (const [y, x0, x1] of l.land) for (let x = x0; x < x1; x++) if (hub(x, y)) cells.push([x, y])
  const d = ([x, y]: [number, number]) => Math.abs(x - st.x) + Math.abs(y - st.y)
  cells.sort((a, b) => d(a) - d(b))
  // Avenues every four cells in line with the station, a street every third row.
  for (const [x, y] of cells) {
    if ((((x - st.x) % 4) + 4) % 4 === 0) apply({ op: 'road', x, y, dir: 0 })
    if ((((y - st.y - 1) % 3) + 3) % 3 === 0) apply({ op: 'road', x, y, dir: 1 })
  }
  // The landmarks, biggest first so the park finds room; the Statue and the
  // Seaport search the whole map, since they stand in and by the water.
  const kinds = (Object.keys(FOOTPRINT) as Kind[]).filter(k => k !== 'station')
  const area = (k: Kind) => FOOTPRINT[k].reduce((n, [, , w, h]) => n + w * h, 0)
  kinds.sort((a, b) => area(b) - area(a))
  const all: [number, number][] = []
  for (let y = -10; y < 80; y++) for (let x = -10; x < 80; x++) all.push([x, y])
  all.sort((a, b) => d(a) - d(b))
  for (const kind of kinds) {
    const where = kind === 'liberty' || kind === 'harbor' ? all : cells
    let done = false
    for (const [x, y] of where) {
      for (const face of FACES) if (!done && apply({ op: 'place', kind, x, y, face })) done = true
      if (done) break
    }
    if (!done) {
      for (const [x, y] of cells) {
        if (apply({ op: 'place', kind, x, y, face: 's', size: 'square' })) break
      }
    }
  }
  for (const [x, y] of cells) apply({ op: 'zone', x, y })
  return { ...l, rev: 0 }
}

