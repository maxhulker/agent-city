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

// Where each kind stands in the preset: its reserved lot's corner, which is
// also the origin its drawing is made at (map.ts draws a kind there and
// shifts it to wherever the building is). The relay's towers are the MetLife
// lot behind the station; the Chrysler rises from the station's own lot once
// the towers are built. The Statue has Liberty Island. In drawing order.
export const PRESET_SITES: Record<Kind, [number, number]> = {
  plaza: [5, 22],
  observatory: [3, 37],
  library: [7, 39],
  relay: [9, 38],
  station: [9, 39],
  workshop: [5, 41],
  empire: [7, 42],
  foundry: [1, 40],
  hall: [7, 55],
  woolworth: [5, 55],
  wtc: [3, 57],
  harbor: [11, 57],
  liberty: [1, 69],
}

// How far a building stands from its kind's preset origin, in cells.
export function deltaOf(b: Building): [number, number] {
  const [ox, oy] = PRESET_SITES[b.kind]
  return [b.x - ox, b.y - oy]
}

// The city's buildings (not a borough's) of a kind.
export function cityBuildings(layout: Layout, kind: Kind): Building[] {
  return layout.buildings.filter(b => b.kind === kind && !b.burb)
}

// The building a district's agents stand in front of: the one of its kind in
// the city (the first, until routes pick the nearest), the station for the
// relay, and none when nothing of the kind is placed.
export function siteFor(layout: Layout, d: District): Building | undefined {
  return cityBuildings(layout, d === 'relay' ? 'station' : d)[0]
}

// Is the cell at x on row y land?
export function landAt(layout: Layout, x: number, y: number): boolean {
  return layout.land.some(([ry, x0, x1]) => ry === y && x >= x0 && x < x1)
}

// The land span of row y that holds x, if any.
export function landSpan(layout: Layout, x: number, y: number): [number, number] | undefined {
  const s = layout.land.find(([ry, x0, x1]) => ry === y && x >= x0 && x < x1)
  return s ? [s[1], s[2]] : undefined
}

// The zoned lots with their widths, in zoning order: a lot runs from the
// avenue at x + 0.26 to x + 1.74, clipped to the shore. The preset keeps its
// smooth shoreline, so its lots are exactly `lots()`.
export function lotsOf(layout: Layout): Lot[] {
  const preset = 'preset' in layout.map
  const out: Lot[] = []
  for (const [x, y] of layout.zoned) {
    let west: number
    let east: number
    if (preset) {
      const [w0, e0] = edges(y)
      const [w1, e1] = edges(y + 1)
      west = Math.max(w0, w1) + 0.15
      east = Math.min(e0, e1) - 0.15
    } else {
      const span = landSpan(layout, x, y) ?? landSpan(layout, x + 1, y)
      if (!span) continue
      west = span[0]
      east = span[1]
    }
    const x0 = Math.max(x + 0.26, west)
    const x1 = Math.min(x + 1.74, east)
    if (x1 - x0 < 0.5) continue
    out.push({ x, y, x0, x1 })
  }
  return out
}

// The rails: along the street behind the station's front, from the station
// east to the shore, where the tunnel mouth is.
export function trackOf(layout: Layout): { y: number; x0: number; x1: number; mouth: number } {
  const station = cityBuildings(layout, 'station')[0] ?? { x: PRESET_SITES.station[0], y: PRESET_SITES.station[1] }
  const y = station.y + 1.55
  let shore: number
  if ('preset' in layout.map) shore = edges(y)[1]
  else {
    const span = landSpan(layout, station.x, Math.floor(y))
    shore = span ? span[1] : station.x + 4
  }
  return { y, x0: station.x + 0.2, x1: shore + 0.6, mouth: shore + 0.1 }
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

// ---- placement: the rules -----------------------------------------------------

// What the page may ask for (POST /build). Every op is checked here, and a
// refused one changes nothing.
export type Op =
  | { op: 'place'; kind: Kind; x: number; y: number; face?: Face }
  | { op: 'remove'; id: string }
  | { op: 'road'; x: number; y: number; dir: 0 | 1; len?: number; kind?: RoadKind }
  | { op: 'unroad'; x: number; y: number; dir: 0 | 1; len?: number }
  | { op: 'zone'; x: number; y: number }
  | { op: 'unzone'; x: number; y: number }
  | { op: 'paint'; what: 'park' | 'none'; x: number; y: number; w?: number; h?: number }
  | { op: 'borough'; name: string; root?: string; x: number; y: number; w: number; h: number }

export type Applied = { layout: Layout } | { error: string }

// The grid the city may spread over.
const RANGE = { x0: -60, x1: 90, y0: -40, y1: 110 }
const RUN_MAX = 64
const BOROUGH_MIN = 3
const BOROUGH_MAX = 24

const KINDS = Object.keys(FOOTPRINT) as Kind[]
const FACES: Face[] = ['n', 'e', 's', 'w']

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const inRange = (x: number, y: number) => x >= RANGE.x0 && x <= RANGE.x1 && y >= RANGE.y0 && y <= RANGE.y1

// An op as it came in from the page: a well-formed one, or nothing.
export function parseOp(raw: unknown): Op | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const xy = isInt(r.x) && isInt(r.y) && inRange(r.x, r.y)
  switch (r.op) {
    case 'place':
      if (!xy || !KINDS.includes(r.kind as Kind)) return undefined
      if (r.face !== undefined && !FACES.includes(r.face as Face)) return undefined
      return { op: 'place', kind: r.kind as Kind, x: r.x as number, y: r.y as number, ...(r.face ? { face: r.face as Face } : {}) }
    case 'remove':
      return typeof r.id === 'string' && r.id.length <= 64 ? { op: 'remove', id: r.id } : undefined
    case 'road':
    case 'unroad': {
      if (!xy || (r.dir !== 0 && r.dir !== 1)) return undefined
      if (r.len !== undefined && !(isInt(r.len) && r.len >= 1 && r.len <= RUN_MAX)) return undefined
      if (r.op === 'road' && r.kind !== undefined && r.kind !== 'street' && r.kind !== 'avenue') return undefined
      const base = { x: r.x as number, y: r.y as number, dir: r.dir as 0 | 1, ...(r.len !== undefined ? { len: r.len as number } : {}) }
      return r.op === 'road' ? { op: 'road', ...base, ...(r.kind ? { kind: r.kind as RoadKind } : {}) } : { op: 'unroad', ...base }
    }
    case 'zone':
    case 'unzone':
      return xy ? { op: r.op, x: r.x as number, y: r.y as number } : undefined
    case 'paint': {
      if (!xy || (r.what !== 'park' && r.what !== 'none')) return undefined
      const ok = (v: unknown) => v === undefined || (isInt(v) && v >= 1 && v <= RUN_MAX)
      if (!ok(r.w) || !ok(r.h)) return undefined
      return { op: 'paint', what: r.what, x: r.x as number, y: r.y as number, ...(r.w !== undefined ? { w: r.w as number } : {}), ...(r.h !== undefined ? { h: r.h as number } : {}) }
    }
    case 'borough': {
      if (!xy || !isInt(r.w) || !isInt(r.h)) return undefined
      if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 40) return undefined
      if (r.root !== undefined && (typeof r.root !== 'string' || r.root.length > 400)) return undefined
      return { op: 'borough', name: r.name.trim(), ...(r.root ? { root: r.root } : {}), x: r.x as number, y: r.y as number, w: r.w, h: r.h }
    }
    default:
      return undefined
  }
}

// ---- what is where -----------------------------------------------------------

type Rect = [number, number, number, number]

const within = ([x0, y0, x1, y1]: Rect, x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

export function boroughRect(bo: Borough): Rect {
  return [bo.x, bo.y, bo.x + bo.w, bo.y + bo.h]
}

// The borough a cell lies in, if any.
export function boroughAt(layout: Layout, x: number, y: number): Borough | undefined {
  return layout.boroughs.find(bo => within(boroughRect(bo), x, y))
}

// Land, or a preset borough's ground: the hand-drawn boroughs stand on the
// mainland the preset's backdrop draws, which `land` does not list.
export function groundAt(layout: Layout, x: number, y: number): boolean {
  return landAt(layout, x, y) || layout.boroughs.some(bo => bo.preset && within(boroughRect(bo), x, y))
}

// What takes a cell: a building, a zoned lot or a park.
export function takenAt(layout: Layout, x: number, y: number): 'building' | 'lot' | 'park' | undefined {
  if (layout.buildings.some(b => cellsOf(b).some(r => within(r, x, y)))) return 'building'
  if (layout.zoned.some(([lx, ly]) => ly === y && (lx === x || lx + 1 === x))) return 'lot'
  if (layout.park.some(([py, x0, x1]) => py === y && x >= x0 && x < x1)) return 'park'
  return undefined
}

const sameRoad = (a: Road, x: number, y: number, dir: 0 | 1) => a[0] === x && a[1] === y && a[2] === dir

export function hasRoad(layout: Layout, x: number, y: number, dir: 0 | 1): boolean {
  return layout.roads.some(r => sameRoad(r, x, y, dir))
}

// A building's front edge as road segments: [x, y, dir] along the face.
export function frontOf(b: Building): [number, number, 0 | 1][] {
  const [x0, y0, x1, y1] = cellsOf(b)[0]!
  const out: [number, number, 0 | 1][] = []
  if (b.face === 's') for (let x = x0; x < x1; x++) out.push([x, y1, 1])
  if (b.face === 'n') for (let x = x0; x < x1; x++) out.push([x, y0, 1])
  if (b.face === 'e') for (let y = y0; y < y1; y++) out.push([x1, y, 0])
  if (b.face === 'w') for (let y = y0; y < y1; y++) out.push([x0, y, 0])
  return out
}

// Does a road run along the building's front? (The Statue needs none.)
export function facesRoad(layout: Layout, b: Building): boolean {
  if (b.kind === 'liberty') return true
  return frontOf(b).some(([x, y, dir]) => hasRoad(layout, x, y, dir))
}

// Is a road segment a bridge: water on both sides?
export function isBridge(layout: Layout, [x, y, dir]: Road | [number, number, 0 | 1]): boolean {
  const beside: [number, number][] = dir === 0 ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]]
  return beside.every(([cx, cy]) => !groundAt(layout, cx, cy))
}

// Does a road segment cut through something (not along its edge)?
function roadBlocked(layout: Layout, x: number, y: number, dir: 0 | 1): string | undefined {
  const cuts = ([x0, y0, x1, y1]: Rect) => (dir === 0 ? x > x0 && x < x1 && y >= y0 && y < y1 : y > y0 && y < y1 && x >= x0 && x < x1)
  if (layout.buildings.some(b => cellsOf(b).some(cuts))) return 'A building is in the way'
  if (layout.zoned.some(([lx, ly]) => cuts([lx, ly, lx + 2, ly + 1]))) return 'A zoned lot is in the way'
  return undefined
}

// A road beside a lot: along either street or either avenue.
function lotHasRoad(layout: Layout, x: number, y: number): boolean {
  return (
    hasRoad(layout, x, y, 1) ||
    hasRoad(layout, x + 1, y, 1) ||
    hasRoad(layout, x, y + 1, 1) ||
    hasRoad(layout, x + 1, y + 1, 1) ||
    hasRoad(layout, x, y, 0) ||
    hasRoad(layout, x + 2, y, 0)
  )
}

// ---- the checks ---------------------------------------------------------------

// Why a building could not be placed here, or nothing when it can. The
// Seaport is a pier: on the shore, reaching into the water. The Statue
// stands in the water. Everything else stands on land, on free cells, with
// a road along its front. A building inside a borough belongs to it.
export function canPlace(layout: Layout, kind: Kind, x: number, y: number, face: Face = 's'): string | undefined {
  if (!FOOTPRINT[kind]) return 'Unknown kind'
  const b: Building = { id: '', kind, x, y, face }
  const cells: [number, number][] = []
  for (const [x0, y0, x1, y1] of cellsOf(b)) for (let cx = x0; cx < x1; cx++) for (let cy = y0; cy < y1; cy++) cells.push([cx, cy])
  if (!cells.every(([cx, cy]) => inRange(cx, cy))) return 'Off the map'
  const ground = cells.filter(([cx, cy]) => groundAt(layout, cx, cy)).length
  if (kind === 'liberty') {
    if (ground) return 'The Statue stands in the water'
  } else if (kind === 'harbor') {
    if (!ground) return 'The Seaport needs a shore'
    if (ground === cells.length) return 'The Seaport reaches into the water'
  } else if (ground < cells.length) return 'Not on land'
  if (cells.some(([cx, cy]) => takenAt(layout, cx, cy))) return 'Something is already there'
  const burbs = new Set(cells.map(([cx, cy]) => boroughAt(layout, cx, cy)?.id))
  if (burbs.size > 1) return 'A building stands in one borough, or in the city'
  if (!facesRoad(layout, b)) return 'No road along its front'
  return undefined
}

let nextId = 1

function idFor(layout: Layout, base: string): string {
  const taken = new Set([...layout.buildings.map(b => b.id), ...layout.boroughs.map(bo => bo.id)])
  if (!taken.has(base)) return base
  let id: string
  do id = `${base}-${nextId++}`
  while (taken.has(id))
  return id
}

// Applies one op to a layout and gives back the new layout, revised, or why
// it was refused. The layout it was given is never changed. The fixed kinds
// stand at once; the game decides when the others do (`City.build`).
export function applyOp(layout: Layout, op: Op): Applied {
  const next = (patch: Partial<Layout>): Applied => ({ layout: { ...layout, ...patch, rev: layout.rev + 1 } })
  switch (op.op) {
    case 'place': {
      const face = op.face ?? 's'
      const why = canPlace(layout, op.kind, op.x, op.y, face)
      if (why) return { error: why }
      const b: Building = { id: idFor(layout, op.kind), kind: op.kind, x: op.x, y: op.y, face }
      const bo = boroughAt(layout, op.x, op.y)
      if (bo) b.burb = bo.id
      if (FIXED.includes(op.kind)) b.built = 0
      return next({ buildings: [...layout.buildings, b] })
    }
    case 'remove': {
      const b = layout.buildings.find(one => one.id === op.id)
      if (b) {
        if (b.kind === 'station') return { error: 'The station is the way in: it stays' }
        return next({ buildings: layout.buildings.filter(one => one !== b) })
      }
      const bo = layout.boroughs.find(one => one.id === op.id)
      if (bo) {
        // The bulldozer clears the whole block: what stood in it goes too.
        const rect = boroughRect(bo)
        return next({
          boroughs: layout.boroughs.filter(one => one !== bo),
          buildings: layout.buildings.filter(one => one.burb !== bo.id),
          zoned: layout.zoned.filter(([x, y]) => !within(rect, x, y)),
          park: layout.park.filter(([y, x0]) => !within(rect, x0, y)),
        })
      }
      return { error: 'Nothing there to bulldoze' }
    }
    case 'road': {
      const len = op.len ?? 1
      const kind: RoadKind = op.kind ?? (op.dir === 0 ? 'avenue' : 'street')
      const added: Road[] = []
      for (let i = 0; i < len; i++) {
        const x = op.dir === 0 ? op.x : op.x + i
        const y = op.dir === 0 ? op.y + i : op.y
        if (!inRange(x, y)) return { error: 'Off the map' }
        const why = roadBlocked(layout, x, y, op.dir)
        if (why) return { error: why }
        if (!hasRoad(layout, x, y, op.dir)) added.push([x, y, op.dir, kind])
      }
      if (!added.length) return { error: 'There is a road here already' }
      return next({ roads: [...layout.roads, ...added] })
    }
    case 'unroad': {
      const len = op.len ?? 1
      const gone = new Set<Road>()
      for (let i = 0; i < len; i++) {
        const x = op.dir === 0 ? op.x : op.x + i
        const y = op.dir === 0 ? op.y + i : op.y
        for (const r of layout.roads) if (sameRoad(r, x, y, op.dir)) gone.add(r)
      }
      if (!gone.size) return { error: 'No road here' }
      return next({ roads: layout.roads.filter(r => !gone.has(r)) })
    }
    case 'zone': {
      const cells: [number, number][] = [
        [op.x, op.y],
        [op.x + 1, op.y],
      ]
      if (layout.zoned.some(([x, y]) => x === op.x && y === op.y)) return { error: 'Zoned already' }
      if (cells.some(([x, y]) => takenAt(layout, x, y))) return { error: 'Something is already there' }
      if (!cells.some(([x, y]) => groundAt(layout, x, y))) return { error: 'Not on land' }
      if (!lotHasRoad(layout, op.x, op.y)) return { error: 'No road beside it' }
      const zoned: [number, number][] = [...layout.zoned, [op.x, op.y]]
      if (!lotsOf({ ...layout, zoned }).some(l => l.x === op.x && l.y === op.y)) return { error: 'Too little land for a block' }
      return next({ zoned })
    }
    case 'unzone': {
      if (!layout.zoned.some(([x, y]) => x === op.x && y === op.y)) return { error: 'Not zoned' }
      return next({ zoned: layout.zoned.filter(([x, y]) => !(x === op.x && y === op.y)) })
    }
    case 'paint': {
      const w = op.w ?? 1
      const h = op.h ?? 1
      const park = layout.park.map(s => [...s] as Span)
      let changed = false
      for (let y = op.y; y < op.y + h; y++) {
        for (let x = op.x; x < op.x + w; x++) {
          const has = park.some(([py, x0, x1]) => py === y && x >= x0 && x < x1)
          if (op.what === 'park') {
            if (has) continue
            if (!groundAt(layout, x, y)) return { error: 'Not on land' }
            if (takenAt(layout, x, y)) return { error: 'Something is already there' }
            park.push([y, x, x + 1])
            changed = true
          } else if (has) {
            // Cut the cell out of its span.
            for (let i = park.length - 1; i >= 0; i--) {
              const [py, x0, x1] = park[i]!
              if (py !== y || x < x0 || x >= x1) continue
              park.splice(i, 1)
              if (x > x0) park.push([y, x0, x])
              if (x + 1 < x1) park.push([y, x + 1, x1])
            }
            changed = true
          }
        }
      }
      if (!changed) return { error: op.what === 'park' ? 'A park already' : 'No park here' }
      return next({ park: mergeSpans(park) })
    }
    case 'borough': {
      if (op.w < BOROUGH_MIN || op.h < BOROUGH_MIN) return { error: `A borough is at least ${BOROUGH_MIN} cells each way` }
      if (op.w > BOROUGH_MAX || op.h > BOROUGH_MAX) return { error: `A borough is at most ${BOROUGH_MAX} cells each way` }
      const rect: Rect = [op.x, op.y, op.x + op.w, op.y + op.h]
      if (!inRange(rect[0], rect[1]) || !inRange(rect[2], rect[3])) return { error: 'Off the map' }
      if (layout.boroughs.some(bo => overlaps(rect, boroughRect(bo)))) return { error: 'It overlaps another borough' }
      if (layout.buildings.some(b => !b.burb && cellsOf(b).some(r => overlaps(rect, r)))) return { error: "It overlaps the city's buildings" }
      let ground = 0
      for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) if (groundAt(layout, x, y)) ground++
      if (!ground) return { error: 'Not on land' }
      const slug = op.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'borough'
      const bo: Borough = { id: idFor(layout, slug), name: op.name, x: op.x, y: op.y, w: op.w, h: op.h, ...(op.root ? { root: op.root } : {}) }
      return next({ boroughs: [...layout.boroughs, bo] })
    }
  }
}

// Spans sorted by row and start, with touching ones joined.
function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && last[0] === s[0] && last[2] >= s[1]) last[2] = Math.max(last[2], s[2])
    else out.push([...s] as Span)
  }
  return out
}
