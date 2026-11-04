import type { Burb, District, Landmark, PresetBurb } from './types.ts'

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
export type Kind = Exclude<Landmark, 'torch'> | 'station' | 'liberty' | 'woolworth' | 'wtc' | 'treasury'

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
  // One of its kind's SIZES; none for the kind's own footprint.
  size?: string
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
  // The City Treasury: the city's books, kept from what each session spends.
  treasury: [[0, 0, 2, 1]],
}

// Kinds that come in other sizes than their own footprint, by size id: a
// name and the footprint. A sized building is drawn to fit its footprint
// rather than from its kind's hand-drawn picture.
export const SIZES: Partial<Record<Kind, Record<string, { name: string; rects: [number, number, number, number][] }>>> = {
  plaza: {
    square: { name: 'Town square', rects: [[0, 0, 4, 4]] },
    pocket: { name: 'Pocket park', rects: [[0, 0, 2, 2]] },
  },
}

// A kind's footprint at a size (its own when none is given or known).
export function footprintOf(kind: Kind, size?: string): [number, number, number, number][] {
  return (size && SIZES[kind]?.[size]?.rects) || FOOTPRINT[kind]
}

const hasSize = (kind: Kind, size: string) => Object.hasOwn(SIZES[kind] ?? {}, size)

// The kinds that always stand, never a lot: the preset's own (never in the
// catalogue) and the civic buildings, which are no part of the game.
export const FIXED: Kind[] = ['station', 'woolworth', 'wtc', 'treasury']

// A building's cells on the grid: [x0, y0, x1, y1] per rect.
export function cellsOf(b: Building): [number, number, number, number][] {
  return footprintOf(b.kind, b.size).map(([dx, dy, w, d]) => [b.x + dx, b.y + dy, b.x + dx + w, b.y + dy + d])
}

// Marks the city's buildings of a kind built (a lot that rises). The Statue
// stands with the Seaport, as in the game.
export function markBuilt(layout: Layout, kind: Landmark, at: number) {
  const kinds: Kind[] = kind === 'torch' ? [] : kind === 'harbor' ? ['harbor', 'liberty'] : [kind]
  for (const b of layout.buildings) {
    if (!b.burb && kinds.includes(b.kind) && b.built === undefined) b.built = at
  }
}

// What stands, by landmark, read from the buildings themselves: when the
// first of each kind went up in the city. The torch has no building of its
// own; it is lit when `torch` says. `World.built` is this, kept by
// `City.sync()`, never written on its own.
export function builtOf(layout: Layout, torch?: number): Partial<Record<Landmark, number>> {
  const out: Partial<Record<Landmark, number>> = {}
  for (const b of layout.buildings) {
    if (b.burb || b.built === undefined || FIXED.includes(b.kind) || b.kind === 'liberty') continue
    const id = b.kind as Landmark
    const at = out[id]
    if (at === undefined || b.built < at) out[id] = b.built
  }
  if (torch !== undefined) out.torch = torch
  return out
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

export const BURBS: Record<PresetBurb, { name: string; center: [number, number]; near: [number, number]; far: [number, number] }> = {
  brooklyn: { name: 'Brooklyn', center: [24, 55.5], near: [14.4, 56], far: [19.8, 56.2] },
  queens: { name: 'Queens', center: [24, 32.5], near: [16, 34.5], far: [19.2, 34.5] },
  bronx: { name: 'The Bronx', center: [19.5, 8], near: [12.9, 11], far: [14.6, 11] },
  jersey: { name: 'Jersey City', center: [-8.5, 40], near: [0.4, 39], far: [-4.8, 39] },
}

export const BURB_ORDER: PresetBurb[] = ['brooklyn', 'queens', 'bronx', 'jersey']

// ---- where a repository lives -------------------------------------------------

// A repository with no borough waits at the station under this id, which no
// borough's id can be (theirs are slugs).
export const waitingId = (root: string): Burb => '@' + root.split('\\').join('/').toLowerCase()
export const isWaiting = (id: string | undefined): boolean => !!id && id.startsWith('@')

// A borough as the walks and the drawing need it: its name, the square where
// its agents gather, the edge they come in by (`near`, where the road meets
// it) and the point inside it they cross to (`far`), and the rectangle it
// covers. The preset's four keep their hand-drawn places; a drawn one gathers
// its agents along the middle of its front (south) edge, facing the viewer.
export type BurbGeo = { name: string; square: Pt2; near: Pt2; far: Pt2; rect: Rect; preset: boolean }

export function burbGeo(layout: Layout | undefined, id: Burb): BurbGeo | undefined {
  const bo = layout?.boroughs.find(b => b.id === id)
  if (id in BURBS && (layout ? bo?.preset : true)) {
    const b = BURBS[id as PresetBurb]
    const [cx, cy] = b.center
    return { name: b.name, square: [cx, cy], near: b.near, far: b.far, rect: [cx - 3.5, cy - 3.5, cx + 3.5, cy + 3.5], preset: true }
  }
  if (!bo) return undefined
  const mid = bo.x + bo.w / 2
  const front = bo.y + bo.h
  return { name: bo.name, square: [mid, front - 1], near: [mid, front], far: [mid, front - 0.5], rect: boroughRect(bo), preset: false }
}

// The building of a kind its agents use inside a borough, if the person placed one there.
export function burbBuilding(layout: Layout | undefined, id: Burb, kind: District): Building | undefined {
  return layout?.buildings.find(b => b.burb === id && b.kind === kind)
}

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
export const PRESET_SITES: Record<Exclude<Kind, 'treasury'>, [number, number]> = {
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
  // The Treasury has no place on the preset: it is drawn from the grid's origin.
  const [ox, oy] = b.kind === 'treasury' ? [0, 0] : PRESET_SITES[b.kind]
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
export const PRESET_PARKS: Span[] = [
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
  const buildings: Building[] = (Object.keys(PRESET_SITES) as (keyof typeof PRESET_SITES)[]).map(kind => {
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
  | { op: 'place'; kind: Kind; x: number; y: number; face?: Face; size?: string }
  | { op: 'remove'; id: string }
  | { op: 'road'; x: number; y: number; dir: 0 | 1; len?: number; kind?: RoadKind }
  | { op: 'unroad'; x: number; y: number; dir: 0 | 1; len?: number }
  | { op: 'zone'; x: number; y: number }
  | { op: 'unzone'; x: number; y: number }
  | { op: 'paint'; what: 'park' | 'none'; x: number; y: number; w?: number; h?: number }
  // fill: lay streets and lots in it at once (`fillBorough`), for the person.
  | { op: 'borough'; name: string; root?: string; x: number; y: number; w: number; h: number; fill?: true }

export type Applied = { layout: Layout } | { error: string }

// The grid the city may spread over.
// The preset's boroughs reach west and north of 0; a generated map runs to GEN.
const RANGE = { x0: -60, x1: 140, y0: -40, y1: 140 }
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
      if (r.size !== undefined && !(typeof r.size === 'string' && hasSize(r.kind as Kind, r.size))) return undefined
      return {
        op: 'place',
        kind: r.kind as Kind,
        x: r.x as number,
        y: r.y as number,
        ...(r.face ? { face: r.face as Face } : {}),
        ...(r.size ? { size: r.size as string } : {}),
      }
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
      return { op: 'borough', name: r.name.trim(), ...(r.root ? { root: r.root } : {}), x: r.x as number, y: r.y as number, w: r.w, h: r.h, ...(r.fill === true ? { fill: true as const } : {}) }
    }
    default:
      return undefined
  }
}

// ---- what is where -----------------------------------------------------------

export type Rect = [number, number, number, number]

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

// Why a run of road could not be laid here, or nothing when it can: the
// page's cursor asks as it moves. A run that is all road already is refused.
export function canRoad(layout: Layout, x: number, y: number, dir: 0 | 1, len = 1): string | undefined {
  let fresh = 0
  for (let i = 0; i < len; i++) {
    const sx = dir === 0 ? x : x + i
    const sy = dir === 0 ? y + i : y
    if (!inRange(sx, sy)) return 'Off the map'
    const why = roadBlocked(layout, sx, sy, dir)
    if (why) return why
    if (!hasRoad(layout, sx, sy, dir)) fresh++
  }
  return fresh ? undefined : 'There is a road here already'
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
export function canPlace(layout: Layout, kind: Kind, x: number, y: number, face: Face = 's', size?: string): string | undefined {
  if (!FOOTPRINT[kind]) return 'Unknown kind'
  if (size && !hasSize(kind, size)) return 'Unknown size'
  const b: Building = { id: '', kind, x, y, face, ...(size ? { size } : {}) }
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
  // One way in: to move the station, bulldoze it and place it again.
  if (kind === 'station') {
    if (cityBuildings(layout, 'station').length) return 'Grand Central stands already: bulldoze it to move it'
    if (!burbs.has(undefined)) return 'Grand Central stands in the city, not in a borough'
  }
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
      const why = canPlace(layout, op.kind, op.x, op.y, face, op.size)
      if (why) return { error: why }
      const b: Building = { id: idFor(layout, op.kind), kind: op.kind, x: op.x, y: op.y, face, ...(op.size ? { size: op.size } : {}) }
      const bo = boroughAt(layout, op.x, op.y)
      if (bo) b.burb = bo.id
      if (FIXED.includes(op.kind)) b.built = 0
      return next({ buildings: [...layout.buildings, b] })
    }
    case 'remove': {
      const b = layout.buildings.find(one => one.id === op.id)
      if (b) {
        // The station too, to move it: until it is placed again, nothing
        // arrives by train and the waiting gather at what still stands.
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
      const why = canRoad(layout, op.x, op.y, op.dir, len)
      if (why) return { error: why }
      const added: Road[] = []
      for (let i = 0; i < len; i++) {
        const x = op.dir === 0 ? op.x : op.x + i
        const y = op.dir === 0 ? op.y + i : op.y
        if (!hasRoad(layout, x, y, op.dir)) added.push([x, y, op.dir, kind])
      }
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

// ---- laying a borough out for the person ---------------------------------------

// A lot holds three or four houses (`lotHouses` in draw/blocks.ts).
const LOT_HOUSES = 3.5

// The lots a repository of this size wants: about four house plots per
// square root of its files and one a folder at least (`plotsFor`), three or
// four plots to a lot, and a couple more to grow into.
export function lotsWanted(files: number, folders: number): number {
  const plots = Math.max(folders, Math.round(4 * Math.sqrt(Math.max(0, files))))
  return Math.min(80, Math.max(4, Math.ceil(plots / LOT_HOUSES) + 2))
}

// A borough's size for that many lots, as `fillBorough` lays them: avenues
// four cells apart with two lots between each pair, a lot on every row, and
// a margin round it with the front row left for the square.
export function boroughSizeFor(lots: number): [w: number, h: number] {
  const pairs = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(lots / 4))))
  const rows = Math.min(BOROUGH_MAX - 2, Math.max(2, Math.ceil(lots / (2 * pairs))))
  return [4 * pairs + 2, rows + 2]
}

const within2 = (bo: Borough, x: number, y: number) => x >= bo.x && x < bo.x + bo.w && y >= bo.y && y < bo.y + bo.h

// Streets and lots in a drawn borough, laid for the person: lots along the
// roads already there first, then avenues four cells apart, a street every
// third row and one along the front, and lots along them, the ones nearest
// the square first, up to `want` lots in the borough (every one that fits
// when no number is given). What can't be laid is skipped. The front row
// stays clear for the square.
export function fillBorough(layout: Layout, id: string, want = Infinity): { layout: Layout; lots: number; added: number } {
  const bo = layout.boroughs.find(b => b.id === id)
  if (!bo || bo.preset) return { layout, lots: 0, added: 0 }
  let cur = layout
  const count = () => cur.zoned.filter(([x, y]) => within2(bo, x, y)).length
  const had = count()
  let lots = had
  const attempt = (op: Op): boolean => {
    const r = applyOp(cur, op)
    if ('error' in r) return false
    cur = r.layout
    return true
  }
  const x0 = bo.x + 1
  const y0 = bo.y + 1
  const front = bo.y + bo.h - 1
  const xEnd = bo.x + bo.w - 1
  const sq: Pt2 = [bo.x + bo.w / 2, front]
  // Lots in line with the avenues first, then the nearest to the square.
  const spots: [number, number][] = []
  for (let y = y0; y < front; y++) for (let x = bo.x; x + 2 <= bo.x + bo.w; x++) spots.push([x, y])
  const off = (x: number) => (((x - x0) % 2) + 2) % 2
  const dist = ([x, y]: [number, number]) => Math.abs(x + 1 - sq[0]) + Math.abs(y + 0.5 - sq[1]) * 1.2
  spots.sort((a, b) => off(a[0]) - off(b[0]) || dist(a) - dist(b) || a[0] - b[0])
  const zone = () => {
    for (const [x, y] of spots) {
      if (lots >= want) return
      if (attempt({ op: 'zone', x, y })) lots++
    }
  }
  zone()
  if (lots < want) {
    for (let ax = x0; ax <= xEnd; ax += 4) for (let y = y0; y < front; y++) attempt({ op: 'road', x: ax, y, dir: 0 })
    const street = (y: number) => {
      for (let x = x0; x < xEnd; x++) attempt({ op: 'road', x, y, dir: 1 })
    }
    for (let y = y0; y < front; y += 3) street(y)
    street(front)
    zone()
  }
  if (cur === layout) return { layout, lots, added: 0 }
  return { layout: { ...cur, rev: layout.rev + 1 }, lots, added: lots - had }
}

// A free place for a w × h borough, as near `near` as can be (measured to the
// middle of its front edge): all land, clear of the city's buildings, lots,
// parks and the rails, and a cell away from any other borough.
export function findSite(layout: Layout, w: number, h: number, near: Pt2): Rect | undefined {
  if (!layout.land.length) return undefined
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [y, a, b] of layout.land) {
    minX = Math.min(minX, a)
    maxX = Math.max(maxX, b)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y + 1)
  }
  const W = maxX - minX
  const H = maxY - minY
  if (W < w || H < h) return undefined
  const ok = new Uint8Array(W * H)
  for (const [y, a, b] of layout.land) for (let x = a; x < b; x++) ok[(y - minY) * W + (x - minX)] = 1
  const clear = (x: number, y: number) => {
    if (x >= minX && x < maxX && y >= minY && y < maxY) ok[(y - minY) * W + (x - minX)] = 0
  }
  const clearRect = ([x0, y0, x1, y1]: Rect, pad: number) => {
    for (let y = y0 - pad; y < y1 + pad; y++) for (let x = x0 - pad; x < x1 + pad; x++) clear(x, y)
  }
  for (const b of layout.buildings) if (!b.burb) for (const r of cellsOf(b)) clearRect(r, 1)
  for (const bo of layout.boroughs) clearRect(boroughRect(bo), 1)
  for (const [x, y] of layout.zoned) clearRect([x, y, x + 2, y + 1], 0)
  for (const [y, a, b] of layout.park) clearRect([a, y, b, y + 1], 0)
  if (cityBuildings(layout, 'station').length) {
    const t = trackOf(layout)
    clearRect([Math.floor(t.x0), Math.floor(t.y) - 1, Math.ceil(t.x1), Math.floor(t.y) + 1], 0)
  }
  // Sums over the free cells, so each rectangle is counted at once.
  const S = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S[(y + 1) * (W + 1) + x + 1] = ok[y * W + x]! + S[y * (W + 1) + x + 1]! + S[(y + 1) * (W + 1) + x]! - S[y * (W + 1) + x]!
  const free = (x: number, y: number) => S[(y + h) * (W + 1) + x + w]! - S[y * (W + 1) + x + w]! - S[(y + h) * (W + 1) + x]! + S[y * (W + 1) + x]!
  let best: Rect | undefined
  let bestD = Infinity
  for (let y = 0; y + h <= H; y++) {
    for (let x = 0; x + w <= W; x++) {
      if (free(x, y) !== w * h) continue
      const gx = minX + x
      const gy = minY + y
      const d = Math.abs(gx + w / 2 - near[0]) + Math.abs(gy + h - near[1])
      if (d < bestD) {
        bestD = d
        best = [gx, gy, gx + w, gy + h]
      }
    }
  }
  return best
}

// A road from a borough's front street to the nearest road outside it, so
// its agents walk there along the roads: down (or up) then across, else
// across then down. Nothing changes when neither way can be laid.
export function connectBorough(layout: Layout, id: string): Layout {
  const bo = layout.boroughs.find(b => b.id === id)
  if (!bo) return layout
  const front = bo.y + bo.h - 1
  const mid = Math.round(bo.x + bo.w / 2)
  let target: Pt2 | undefined
  let bestD = 41
  for (const [x, y, dir] of layout.roads) {
    for (const [px, py] of dir === 0 ? [[x, y], [x, y + 1]] : [[x, y], [x + 1, y]]) {
      if (px! >= bo.x && px! <= bo.x + bo.w && py! >= bo.y && py! <= bo.y + bo.h) continue
      const d = Math.abs(px! - mid) + Math.abs(py! - front)
      if (d < bestD) {
        bestD = d
        target = [px!, py!]
      }
    }
  }
  if (!target) return layout
  const [tx, ty] = target
  const run = (l: Layout, x: number, y: number, dir: 0 | 1, len: number): Layout | undefined => {
    if (len === 0) return l
    const sx = dir === 0 ? x : len > 0 ? x : x + len
    const sy = dir === 0 ? (len > 0 ? y : y + len) : y
    const r = applyOp(l, { op: 'road', x: sx, y: sy, dir, len: Math.abs(len) })
    if ('layout' in r) return r.layout
    return r.error === 'There is a road here already' ? l : undefined
  }
  const down = run(layout, mid, front, 0, ty - front)
  const a = down && run(down, mid, ty, 1, tx - mid)
  if (a) return a
  const across = run(layout, mid, front, 1, tx - mid)
  const b = across && run(across, tx, front, 0, ty - front)
  return b ?? layout
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

// ---- doors and routes ------------------------------------------------------------

export type Pt2 = [number, number]

// Where a building's agents stand: on the road along its front. A kind with a
// preset site keeps that spot (where its hand-drawn door is) while it faces
// south; otherwise the midpoint of the face it turns to the road. A sized
// park's agents rest on its lawn, rows from just behind its middle.
export function doorOf(b: Building): Pt2 {
  const [x0, y0, x1, y1] = cellsOf(b)[0]!
  const siteKind = b.kind === 'station' ? 'relay' : b.kind
  if (b.kind === 'plaza' && b.size) return [(x0 + x1) / 2, (y0 + y1) / 2 + roomOf(b) * 0.3]
  if (b.face === 's' && siteKind in SITES && !b.size) {
    const [sx, sy] = SITES[siteKind as District].spot
    const [dx, dy] = deltaOf(b)
    return [sx + dx, sy + dy]
  }
  if (b.face === 'n') return [(x0 + x1) / 2, y0]
  if (b.face === 'e') return [x1, (y0 + y1) / 2]
  if (b.face === 'w') return [x0, (y0 + y1) / 2]
  return [(x0 + x1) / 2, y1]
}

// How much room a building gives the agents standing at it, against its
// kind's own footprint: 1 unless it is a smaller size (a pocket park's lawn
// holds its resting agents closer together than Central Park's).
export function roomOf(b: Building | undefined): number {
  if (!b?.size) return 1
  const [x0, y0, x1, y1] = cellsOf(b)[0]!
  return Math.max(0.45, Math.min(1, Math.min(x1 - x0, y1 - y0) / 4))
}

// Where a district's agents stand: its building's door, or the station's
// forecourt while nothing of the kind is placed. With the station bulldozed
// (being moved), at the door of the first building still standing in the
// city; the preset's spot when there is none.
export function spotFor(layout: Layout, d: District): Pt2 {
  const b = siteFor(layout, d) ?? cityBuildings(layout, 'station')[0] ?? layout.buildings.find(one => !one.burb && one.kind !== 'liberty')
  return b ? doorOf(b) : SITES[d].spot
}

// The nearest point on a road to pt, within reach, and the segment's ends.
function onRoad(layout: Layout, [px, py]: Pt2): { at: Pt2; ends: [Pt2, Pt2] } | undefined {
  let best: { at: Pt2; ends: [Pt2, Pt2] } | undefined
  let bestD = 0.75
  for (const [x, y, dir] of layout.roads) {
    const qx = dir === 0 ? x : Math.min(x + 1, Math.max(x, px))
    const qy = dir === 0 ? Math.min(y + 1, Math.max(y, py)) : y
    const d = Math.abs(qx - px) + Math.abs(qy - py)
    if (d < bestD) {
      bestD = d
      best = { at: [qx, qy], ends: dir === 0 ? [[x, y], [x, y + 1]] : [[x, y], [x + 1, y]] }
    }
  }
  return best
}

const pk = (x: number, y: number) => `${x},${y}`

// The road graph: grid points joined by the segments between them. Kept per
// layout object, which every change replaces.
const GRAPHS = new WeakMap<Layout, Map<string, Pt2[]>>()

function adjacency(layout: Layout): Map<string, Pt2[]> {
  let adj = GRAPHS.get(layout)
  if (adj) return adj
  adj = new Map()
  const link = (a: Pt2, b: Pt2) => {
    const ka = pk(a[0], a[1])
    if (!adj!.has(ka)) adj!.set(ka, [])
    adj!.get(ka)!.push(b)
  }
  for (const [x, y, dir] of layout.roads) {
    const b: Pt2 = dir === 0 ? [x, y + 1] : [x + 1, y]
    link([x, y], b)
    link(b, [x, y])
  }
  GRAPHS.set(layout, adj)
  return adj
}

// Among ways of the same length the one with fewer corners wins, so a route
// reads like streets, not a staircase.
const TURN = 0.3

type Step = { x: number; y: number; h: number; cost: number; prev?: Step }

// The shortest way along the roads from one point to another, as the points
// where it turns: from the start to the road, along it, and off it to the
// end. Nothing when either end is off the roads or no road joins them.
export function route(layout: Layout, from: Pt2, to: Pt2): Pt2[] | undefined {
  const a = onRoad(layout, from)
  const b = onRoad(layout, to)
  if (!a || !b) return undefined
  const adj = adjacency(layout)
  const goal = new Map(b.ends.map(([x, y]) => [pk(x, y), Math.abs(x - b.at[0]) + Math.abs(y - b.at[1])]))
  // A small binary heap of steps by cost.
  const heap: Step[] = []
  const push = (s: Step) => {
    heap.push(s)
    let i = heap.length - 1
    while (i > 0) {
      const j = (i - 1) >> 1
      if (heap[j]!.cost <= heap[i]!.cost) break
      ;[heap[i], heap[j]] = [heap[j]!, heap[i]!]
      i = j
    }
  }
  const pop = (): Step => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l]!.cost < heap[m]!.cost) m = l
        if (r < heap.length && heap[r]!.cost < heap[m]!.cost) m = r
        if (m === i) break
        ;[heap[i], heap[m]] = [heap[m]!, heap[i]!]
        i = m
      }
    }
    return top
  }
  for (const [x, y] of a.ends) push({ x, y, h: -1, cost: Math.abs(x - a.at[0]) + Math.abs(y - a.at[1]) })
  const seen = new Set<string>()
  let found: Step | undefined
  let foundCost = Infinity
  while (heap.length) {
    const s = pop()
    if (s.cost >= foundCost) break
    const k = `${s.x},${s.y},${s.h}`
    if (seen.has(k)) continue
    seen.add(k)
    const g = goal.get(pk(s.x, s.y))
    if (g !== undefined && s.cost + g < foundCost) {
      found = s
      foundCost = s.cost + g
    }
    for (const [nx, ny] of adj.get(pk(s.x, s.y)) ?? []) {
      const h = nx === s.x ? 0 : 1
      push({ x: nx, y: ny, h, cost: s.cost + 1 + (s.h >= 0 && h !== s.h ? TURN : 0), prev: s })
    }
  }
  if (!found) return undefined
  const nodes: Pt2[] = []
  for (let s: Step | undefined = found; s; s = s.prev) nodes.unshift([s.x, s.y])
  // Only the corners, and no point twice.
  const pts: Pt2[] = [from, a.at, ...nodes, b.at, to]
  const out: Pt2[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    const prev = out[out.length - 2]
    if (last && prev && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

// ---- the generated map ---------------------------------------------------------

// A generated map is GEN cells each way, from (0, 0) at the back to (GEN, GEN)
// at the front: the mainland behind, a strait, the station's island, and the
// sea in front.
export const GEN = 128

// A number in [0, 1) for a lattice point, the same on every machine.
function rnd(seed: number, x: number, y: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Value noise: lattice values every `scale` cells, eased between.
function noise(seed: number, x: number, y: number, scale: number): number {
  const gx = x / scale
  const gy = y / scale
  const ix = Math.floor(gx)
  const iy = Math.floor(gy)
  const ease = (t: number) => t * t * (3 - 2 * t)
  const fx = ease(gx - ix)
  const fy = ease(gy - iy)
  const a = rnd(seed, ix, iy)
  const b = rnd(seed, ix + 1, iy)
  const c = rnd(seed, ix, iy + 1)
  const d = rnd(seed, ix + 1, iy + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

// Three octaves, in [0, 1).
function fbm(seed: number, x: number, y: number): number {
  return 0.55 * noise(seed, x, y, 16) + 0.3 * noise(seed + 1, x, y, 8) + 0.15 * noise(seed + 2, x, y, 4)
}

// Five octaves, for terrain, in [0, 1).
function fbm5(seed: number, x: number, y: number): number {
  let v = 0
  let amp = 0.5
  let scale = 24
  let sum = 0
  for (let o = 0; o < 5; o++) {
    v += amp * noise(seed + o * 7, x, y, scale)
    sum += amp
    amp *= 0.5
    scale /= 2
  }
  return v / sum
}

// Noise read through noise: the coordinates pushed about by two slower
// fields, so coasts wander into bays and headlands instead of blobs.
function warped(seed: number, x: number, y: number, by = 12): number {
  const wx = x + (fbm(seed + 31, x, y) - 0.5) * by
  const wy = y + (fbm(seed + 37, x, y) - 0.5) * by
  return fbm5(seed, wx, wy)
}

// The shape of a seed's map: the island's middle and half-sizes, how wide
// the strait round it runs, which way the mainland lies (a unit vector
// pointing inland, any way round), and whether a second, smaller shore lies
// across the water on the other side.
export function mapShape(seed: number): { cx: number; cy: number; a: number; b: number; strait: number; inland: [number, number]; tilt: number; across: boolean } {
  const r = (k: number) => rnd(seed, 1000 + k, 7)
  const turn = r(5) * Math.PI * 2
  const inland: [number, number] = [Math.cos(turn), Math.sin(turn)]
  return { cx: GEN / 2 + (r(0) - 0.5) * 6, cy: GEN / 2 + (r(1) - 0.5) * 6, a: 8 + r(2) * 3, b: 12 + r(3) * 4, strait: 0.25 + r(4) * 0.25, inland, tilt: (r(6) - 0.5) * 0.9, across: r(7) > 0.45 }
}

// A seed's terrain: which cells are land, and how high each stands (0 at the
// sea, rising inland), for the generator and for the drawing's hills.
export function terrainOf(seed: number): { land: boolean[][]; height: number[][] } {
  const { cx, cy, a, b, strait, inland, tilt, across } = mapShape(seed)
  const land: boolean[][] = []
  const height: number[][] = []
  // How far inland a point lies along the mainland's direction, 0 at the
  // island's middle, about 1 at the far edge.
  const depth = (x: number, y: number) => ((x - cx) * inland[0] + (y - cy) * inland[1]) / 30
  // The island: a tilted oval, its outline thrown about into coves and points.
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)
  const islandAt = (x: number, y: number) => {
    const u = (x - cx) * cos + (y - cy) * sin
    const v = -(x - cx) * sin + (y - cy) * cos
    const e = Math.sqrt((u / a) ** 2 + (v / b) ** 2)
    return { e, warped: e + (warped(seed + 50, x, y, 14) - 0.5) * 2.8 }
  }
  for (let y = 0; y < GEN; y++) {
    const lr: boolean[] = []
    const hr: number[] = []
    for (let x = 0; x < GEN; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const t = warped(seed, px, py)
      const isl = islandAt(px, py)
      // The mainland: rising inland, its coast thrown about by the noise.
      const main = (t - 0.5) * 3.2 + (depth(px, py) - 0.45) * 1.2
      // The far shore, on some maps: lower, and further off.
      const far = across ? (warped(seed + 70, px, py) - 0.5) * 3.2 + (-depth(px, py) - 0.7) * 1.2 : -1
      let h = Math.max(main, far)
      let on = h > 0
      // The strait keeps the island apart; the island has a solid core.
      if (isl.warped < 1 + strait) on = false
      if (isl.warped < 1 || isl.e < 0.62) {
        on = true
        h = Math.max(0.02, (1 - isl.warped) * 0.3)
      }
      lr.push(on)
      hr.push(on ? Math.max(0.02, h) : 0)
    }
    land.push(lr)
    height.push(hr)
  }
  // Rivers: from the far side of the mainland down to the sea, meandering,
  // widening towards their mouths.
  const rivers = 2 + Math.floor(rnd(seed, 2000, 1) * 3)
  for (let k = 0; k < rivers; k++) {
    const along = [-inland[1], inland[0]]
    const offset = (rnd(seed, 2001, k) - 0.5) * GEN * 0.8
    // Its source: as far inland as the map goes, a little in from the edge.
    let x = cx + along[0]! * offset
    let y = cy + along[1]! * offset
    while (x + inland[0] > 2 && y + inland[1] > 2 && x + inland[0] < GEN - 3 && y + inland[1] < GEN - 3) {
      x += inland[0]
      y += inland[1]
    }
    let dir = Math.atan2(-inland[1], -inland[0])
    for (let step = 0; step < GEN * 3; step++) {
      // A slow swing either side of seaward, from the noise along its course.
      const swing = (noise(seed + 60 + k, step, k * 13, 9) - 0.5) * 2.4
      const seaward = Math.atan2(-inland[1], -inland[0])
      dir = seaward + swing
      x += Math.cos(dir) * 0.5
      y += Math.sin(dir) * 0.5
      if (x < -2 || y < -2 || x > GEN + 1 || y > GEN + 1) break
      const isl = islandAt(x, y)
      if (isl.warped < 1 + strait) break
      const width = 0.75 + Math.min(1, step / 180) * 1.1
      for (let yy = Math.floor(y - width); yy <= Math.ceil(y + width); yy++) {
        for (let xx = Math.floor(x - width); xx <= Math.ceil(x + width); xx++) {
          if (yy < 0 || xx < 0 || yy >= GEN || xx >= GEN) continue
          if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= width * width) {
            land[yy]![xx] = false
            height[yy]![xx] = 0
          }
        }
      }
      // It ends where it meets the open water.
      if (step > 20 && !land[Math.floor(y)]?.[Math.floor(x)] && seaNear(land, Math.floor(x), Math.floor(y))) break
    }
  }
  // Tidy up: no specks of island, no puddles (rivers and lakes of some size stay).
  sweep(land, true, 8)
  sweep(land, false, 5)
  for (let y = 0; y < GEN; y++) for (let x = 0; x < GEN; x++) if (!land[y]![x]) height[y]![x] = 0
  return { land, height }
}

// Whether open sea lies within two cells: water that reaches the map's edge
// in a straight line, as a river mouth does.
function seaNear(land: boolean[][], x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    let cx = x
    let cy = y
    let open = true
    for (let i = 0; i < 6; i++) {
      cx += dx
      cy += dy
      if (cy < 0 || cx < 0 || cy >= GEN || cx >= GEN) break
      if (land[cy]![cx]) {
        open = false
        break
      }
    }
    if (open) return true
  }
  return false
}

// Flips the small patches of `value` (fewer than `min` cells, not touching
// the map's edge) to the other: islets sink, puddles fill.
function sweep(land: boolean[][], value: boolean, min: number) {
  const seen = new Set<number>()
  for (let y = 0; y < GEN; y++) {
    for (let x = 0; x < GEN; x++) {
      if (land[y]![x] !== value || seen.has(y * GEN + x)) continue
      const patch: [number, number][] = []
      let edge = false
      const todo: [number, number][] = [[x, y]]
      seen.add(y * GEN + x)
      while (todo.length) {
        const [px, py] = todo.pop()!
        patch.push([px, py])
        if (px === 0 || py === 0 || px === GEN - 1 || py === GEN - 1) edge = true
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= GEN || ny >= GEN || seen.has(ny * GEN + nx) || land[ny]![nx] !== value) continue
          seen.add(ny * GEN + nx)
          todo.push([nx, ny])
        }
      }
      if (patch.length < min && !edge) for (const [px, py] of patch) land[py]![px] = !value
    }
  }
}

// A map made from a seed (docs/city-builder.md, "The map"): warped value
// noise over the grid with a coast threshold, the mainland rising inland,
// rivers running down to the sea, and the station's island in front of it
// across a strait, with a core of solid land big enough for every footprint.
// The station stands on the island near its east shore, its track running
// out to the water, with a street along its front.
export function generateMap(seed: number): Layout {
  const { cx, cy } = mapShape(seed)
  const cells = terrainOf(seed).land
  // The station: on the island's row a little above its middle, four cells in
  // from the east shore, on a quay of solid land with the street in front.
  const sy = Math.round(cy) - 2
  let east = Math.floor(cx)
  while (east + 1 < GEN && cells[sy]![east + 1]) east++
  const sx = Math.max(Math.floor(cx) - 2, east - 5)
  for (const y of [sy, sy + 1]) for (let x = sx - 1; x <= sx + 5; x++) cells[y]![x] = true
  const land: Span[] = []
  for (let y = 0; y < GEN; y++) {
    let x = 0
    while (x < GEN) {
      if (!cells[y]![x]) {
        x++
        continue
      }
      const x0 = x
      while (x < GEN && cells[y]![x]) x++
      land.push([y, x0, x])
    }
  }
  const roads: Road[] = []
  for (let x = sx - 1; x < sx + 5; x++) roads.push([x, sy + 1, 1, 'street'])
  const station: Building = { id: 'station', kind: 'station', x: sx, y: sy, face: 's', built: 0 }
  return { rev: 0, map: { seed }, land, park: [], roads, zoned: [], buildings: [station], boroughs: [] }
}

// The spans joined to the one at (x, y), by index: rows touching rows.
export function componentOf(land: Span[], x: number, y: number): Set<number> {
  const start = land.findIndex(([ry, x0, x1]) => ry === y && x >= x0 && x < x1)
  const out = new Set<number>()
  if (start < 0) return out
  const todo = [start]
  out.add(start)
  while (todo.length) {
    const [ry, a0, a1] = land[todo.pop()!]!
    land.forEach(([sy, b0, b1], j) => {
      if (out.has(j) || Math.abs(sy - ry) !== 1 || b1 <= a0 || b0 >= a1) return
      out.add(j)
      todo.push(j)
    })
  }
  return out
}
