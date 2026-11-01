import type { Burb, District, Landmark } from './types.ts'

// The city's layout (docs/city-builder.md): what stands where, on one grid of
// unit cells, with roads along the cells' edges. Pure, and it imports nothing
// at runtime (the type import above is erased), so the server can hand this
// file to the page as JavaScript and both check a placement by the same rules.
// `manhattanLayout()` is today's hand-drawn city as a layout, and what a city
// saved before layouts existed migrates to.

// ---- types ----------------------------------------------------------------

// What can be placed: the game's landmarks (the torch is a light on the
// Statue, not a building), the station everyone arrives at, the Statue of
// Liberty, and two scenery towers the Manhattan preset keeps.
export type Kind = Exclude<Landmark, 'torch'> | 'station' | 'liberty' | 'woolworth' | 'wtc'

export type RoadKind = 'street' | 'avenue'
export type Face = 'n' | 'e' | 's' | 'w'

export type Building = {
  id: string
  kind: Kind
  // The cell its footprint starts from (FOOTPRINT's rects are relative to it).
  x: number
  y: number
  // The side its agents stand on.
  face: Face
  // The borough it stands in; none for the city.
  burb?: string
  // When it went up: at placement in the city, at the first such work in a
  // borough; absent while it is a blueprint lot.
  built?: number
}

export type Borough = {
  id: string
  name: string
  root?: string
  x: number
  y: number
  w: number
  h: number
  // One of the Manhattan preset's four, drawn by hand (`burb()` in map.ts).
  preset?: true
}

// A span of cells on row y, from x0 to x1 (exclusive).
export type Span = [y: number, x0: number, x1: number]
// One cell edge: from (x, y) along y (dir 0, an avenue) or along x (dir 1, a street).
export type Road = [x: number, y: number, dir: 0 | 1, kind: RoadKind]

export type Layout = {
  // Bumps on every change; the map's hash covers it.
  rev: number
  // The map: a generated one by its seed, or the hand-drawn Manhattan, whose
  // smooth shoreline, mainland, small islands, Liberty Island and named
  // rivers are drawn as its backdrop. Either way `land` holds the cells.
  map: { seed: number } | { preset: 'manhattan' }
  land: Span[]
  park: Span[]
  roads: Road[]
  // 2×1 lots (from the avenue at x to x + 2, on row y), in the order they
  // were zoned, which is the order the population fills them in.
  zoned: [x: number, y: number][]
  buildings: Building[]
  boroughs: Borough[]
}

// Each kind's footprint as rects [dx, dy, w, d] from the building's cell.
export const FOOTPRINT: Record<Kind, [number, number, number, number][]> = {
  plaza: [[0, 0, 4, 13]],
  observatory: [[0, 0, 4, 1]],
  library: [[0, 0, 2, 1]],
  relay: [[0, 0, 2, 1]],
  workshop: [[0, 0, 2, 1]],
  empire: [[0, 0, 2, 1]],
  foundry: [[0, 0, 4, 2]],
  hall: [[0, 0, 2, 1]],
  // The Seaport is a pier: it stands on the shore and reaches into the water.
  harbor: [[0, 0, 4, 1]],
  station: [[0, 0, 4, 1]],
  // In the water, on its island.
  liberty: [[0, 0, 2, 2]],
  woolworth: [[0, 0, 2, 1]],
  wtc: [[0, 0, 2, 1]],
}

// The kinds that always stand: never a lot, never in the catalogue.
export const FIXED: Kind[] = ['station', 'woolworth', 'wtc']

// A building's cells on the grid: [x0, y0, x1, y1] per rect.
export function cellsOf(b: Building): [number, number, number, number][] {
  return FOOTPRINT[b.kind].map(([dx, dy, w, d]) => [b.x + dx, b.y + dy, b.x + dx + w, b.y + dy + d])
}

// Marks the city's buildings of a kind built (a lot that rises). The Statue
// stands with the Seaport, as in the game.
export function markBuilt(layout: Layout, kind: Landmark, at: number) {
  const kinds: Kind[] = kind === 'torch' ? [] : kind === 'harbor' ? ['harbor', 'liberty'] : [kind]
  for (const b of layout.buildings) {
    if (!b.burb && kinds.includes(b.kind) && b.built === undefined) b.built = at
  }
}

// Back to lots: every building of the game's kinds, the fixed ones excepted.
export function clearBuilt(layout: Layout) {
  for (const b of layout.buildings) if (!FIXED.includes(b.kind)) delete b.built
}

// ---- shared helpers ---------------------------------------------------------

export function seeded(i: number, j: number): number {
  let h = (Math.round(i * 1000) * 374761393 + Math.round(j * 1000) * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---- the Manhattan preset: the island ----------------------------------------

// Shoreline as [gy, west, east], north to south.
export const PROFILE: [number, number, number][] = [
  [-2.6, 7.6, 8.4],
  [-1.6, 6.3, 9.8],
  [1, 5, 11],
  [5, 4, 12],
  [9, 3.2, 12.6],
  [14, 2.3, 13.3],
  [17, 2, 15],
  [20, 1.5, 15.4],
  [26, 1, 15.6],
  [34, 0.5, 16],
  [40, 0.2, 16.4],
  [45, 0.3, 16.6],
  [47, 0.6, 18],
  [50, 1, 18.6],
  [52, 1.3, 17.6],
  [54, 1.8, 16.2],
  [57, 2.5, 14.6],
  [59, 3.5, 13.2],
  [60.8, 4.8, 11],
  [62, 6.2, 8.6],
  [62.6, 7.2, 7.6],
]

export function edges(gy: number): [number, number] {
  const first = PROFILE[0]!
  const last = PROFILE[PROFILE.length - 1]!
  if (gy <= first[0]) return [first[1], first[2]]
  if (gy >= last[0]) return [last[1], last[2]]
  for (let i = 1; i < PROFILE.length; i++) {
    const b = PROFILE[i]!
    if (gy <= b[0]) {
      const a = PROFILE[i - 1]!
      const t = (gy - a[0]) / (b[0] - a[0])
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    }
  }
  return [last[1], last[2]]
}

// ---- the Manhattan preset: districts and boroughs ----------------------------

export type Site = {
  // Where agents stand: on the street in front of the landmark.
  spot: [number, number]
  // Where its name goes, how high above the ground, and which way it reads
  // from there (centred unless given).
  label: [number, number, number, ('start' | 'end')?]
}

// Each spot is on a street with its landmark just north of it (behind, on
// screen) and nothing tall in front, so the plaza stays in view.
export const SITES: Record<District, Site> = {
  observatory: { spot: [6, 38], label: [5.4, 37.2, 60] },
  library: { spot: [8, 40], label: [6.9, 41.1, -2, 'start'] },
  relay: { spot: [11, 40], label: [11.9, 40.4, -2] },
  workshop: { spot: [5.4, 42], label: [4.9, 43.1, -2, 'end'] },
  foundry: { spot: [2.4, 42], label: [1.3, 42.9, -2, 'end'] },
  hall: { spot: [8.5, 56], label: [8.5, 56.9, -2] },
  harbor: { spot: [12.4, 58], label: [12.6, 58.9, -2] },
  plaza: { spot: [7, 28.6], label: [7, 31.3, -2] },
}

// Lots the landmarks take, skipped when filling the grid.
export const RESERVED: [number, number, number, number][] = [
  [5, 22, 9, 35], // Central Park
  [3, 37, 7, 38], // Times Square's towers
  [5, 38, 7, 39], // Times Square's plaza
  [7, 39, 9, 40], // Public Library
  [7, 40, 9, 41], // Bryant Park
  [9, 39, 13, 40], // Grand Central, Chrysler
  [9, 38, 11, 39], // MetLife
  [5, 41, 7, 42], // Garment District
  [5, 42, 7, 43], // Herald Square
  [7, 42, 9, 43], // Empire State
  [1, 40, 5, 42], // Hudson Yards
  [5, 55, 7, 56], // Woolworth
  [7, 55, 10, 56], // City Hall
  [11, 57, 15, 58], // Seaport
  [3, 57, 6, 58], // One World Trade
]

export function isReserved(x: number, y: number): boolean {
  return RESERVED.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)
}

export const BURBS: Record<Burb, { name: string; center: [number, number]; near: [number, number]; far: [number, number] }> = {
  brooklyn: { name: 'Brooklyn', center: [24, 55.5], near: [14.4, 56], far: [19.8, 56.2] },
  queens: { name: 'Queens', center: [24, 32.5], near: [16, 34.5], far: [19.2, 34.5] },
  bronx: { name: 'The Bronx', center: [19.5, 8], near: [12.9, 11], far: [14.6, 11] },
  jersey: { name: 'Jersey City', center: [-8.5, 40], near: [0.4, 39], far: [-4.8, 39] },
}

export const BURB_ORDER: Burb[] = ['brooklyn', 'queens', 'bronx', 'jersey']

// ---- the Manhattan preset: the filler lots --------------------------------------

// The filler blocks: one more for every so many tool calls, Midtown and
// downtown first, spreading out from there (with a little jitter), until the
// island is full.
export const BLOCK_EVERY = 40

export type Lot = { x: number; y: number; x0: number; x1: number }

let LOTS: Lot[] | undefined

export function lots(): Lot[] {
  if (LOTS) return LOTS
  const list: Lot[] = []
  for (let y = -2; y < 63; y++) {
    const [w0, e0] = edges(y)
    const [w1, e1] = edges(y + 1)
    const west = Math.max(w0, w1) + 0.15
    const east = Math.min(e0, e1) - 0.15
    for (let x = -1; x < 19; x += 2) {
      if (isReserved(x + 1, y)) continue
      const x0 = Math.max(x + 0.26, west)
      const x1 = Math.min(x + 1.74, east)
      if (x1 - x0 < 0.5) continue
      list.push({ x, y, x0, x1 })
    }
  }
  const score = (l: Lot) => Math.min(Math.hypot(l.x0 - 8, (l.y - 41) / 2.5), Math.hypot(l.x0 - 8, (l.y - 58) / 2.5)) + seeded(l.x0, l.y) * 3
  list.sort((a, b) => score(a) - score(b))
  LOTS = list
  return list
}

// ---- the Manhattan preset as a layout ------------------------------------------

// Where each landmark stands in the preset: its reserved lot's corner. The
// relay's towers are the MetLife lot behind the station; the Chrysler rises
// from the station's own lot. The Statue has Liberty Island.
const PRESET_SITES: Record<Kind, [number, number]> = {
  plaza: [5, 22],
  observatory: [3, 37],
  library: [7, 39],
  relay: [9, 38],
  workshop: [5, 41],
  empire: [7, 42],
  foundry: [1, 40],
  hall: [7, 55],
  harbor: [11, 57],
  station: [9, 39],
  liberty: [1, 69],
  woolworth: [5, 55],
  wtc: [3, 57],
}

// The plazas and parks the landmarks open onto, which no building takes.
const PRESET_PARKS: Span[] = [
  [38, 5, 7], // Times Square's plaza
  [40, 7, 9], // Bryant Park
  [42, 5, 7], // Herald Square
]

// Math.ceil gives -0 near the shore, which JSON turns into 0: keep it 0 here.
function whole(v: number): number {
  return v === 0 ? 0 : v
}

// Is the avenue at x on the island at row y (clear of the shore)?
function onIsland(x: number, y: number): boolean {
  const [w, e] = edges(y)
  return x > w + 0.1 && x < e - 0.1
}

// Today's city as a layout: the island rasterised to cells, its avenues and
// streets, every filler lot zoned in the order it fills, the landmarks on
// their lots and a borough at each of the four sites. `built` says which
// landmarks stand (a city mid-game keeps its remaining lots).
export function manhattanLayout(built: Partial<Record<Landmark, number>> = {}): Layout {
  const land: Span[] = []
  for (let y = -3; y < 63; y++) {
    // A cell is land when its centre is on the island.
    const [w, e] = edges(y + 0.5)
    const x0 = whole(Math.ceil(w - 0.5))
    const x1 = Math.floor(e - 0.5) + 1
    if (x1 > x0) land.push([y, x0, x1])
  }
  const roads: Road[] = []
  for (let x = 1; x < 18; x += 2) {
    for (let y = -3; y < 63; y++) if (onIsland(x, y) && onIsland(x, y + 1)) roads.push([x, y, 0, 'avenue'])
  }
  for (let y = -2; y <= 63; y++) {
    const [w, e] = edges(y)
    if (e - w < 0.8) continue
    for (let x = whole(Math.ceil(w - 0.5)); x + 1 <= e + 0.5; x++) roads.push([whole(x), y, 1, 'street'])
  }
  const buildings: Building[] = (Object.keys(PRESET_SITES) as Kind[]).map(kind => {
    const [x, y] = PRESET_SITES[kind]!
    const b: Building = { id: kind, kind, x, y, face: 's' }
    if (FIXED.includes(kind)) b.built = 0
    return b
  })
  const layout: Layout = {
    rev: 0,
    map: { preset: 'manhattan' },
    land,
    park: PRESET_PARKS.map(s => [...s] as Span),
    roads,
    zoned: lots().map(l => [l.x, l.y]),
    buildings,
    boroughs: BURB_ORDER.map(b => {
      const [cx, cy] = BURBS[b].center
      return { id: b, name: BURBS[b].name, x: Math.floor(cx - 4), y: Math.floor(cy - 4), w: 8, h: 9, preset: true as const }
    }),
  }
  for (const [kind, at] of Object.entries(built) as [Landmark, number][]) if (at !== undefined) markBuilt(layout, kind, at)
  return layout
}
