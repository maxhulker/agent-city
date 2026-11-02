import type { Agent, Burb, District, Landmark, Place, Repo } from '../types.ts'
import { BLOCK_EVERY, PROFILE, SITES, burbBuilding, burbGeo, cellsOf, deltaOf, doorOf, edges, isWaiting, lots, roomOf, route, siteFor, spotFor } from '../layout.ts'
import type { Layout } from '../layout.ts'

// The map's geometry, shared by every layer: the projection, the island and
// its neighbours, where districts and boroughs are, and how agents walk. The
// island, the sites, the boroughs and the lots are the Manhattan preset's,
// kept in src/layout.ts (docs/city-builder.md) and re-exported here.

export { BLOCK_EVERY, BURBS, BURB_ORDER, PROFILE, RESERVED, SITES, burbGeo, edges, isReserved, isWaiting, lots, seeded } from '../layout.ts'
export type { Lot, Site } from '../layout.ts'

export const LABELS: Record<District, string> = {
  hall: 'City Hall',
  library: 'Public Library',
  workshop: 'Garment District',
  foundry: 'Hudson Yards',
  harbor: 'Seaport',
  observatory: 'Times Square',
  relay: 'Grand Central',
  plaza: 'Central Park',
}


export const AGENT_COLORS = [
  '#5eead4',
  '#f472b6',
  '#a78bfa',
  '#60a5fa',
  '#fb923c',
  '#4ade80',
  '#f87171',
  '#facc15',
]

export const mainColor = '#fbbf24'

// Which district a tool call sends its agent to.
export function districtFor(tool: string, command = ''): District {
  if (tool === 'Bash' || tool === 'PowerShell') {
    return /(^|[\s;&|(])(git|gh)\s/.test(command) ? 'harbor' : 'foundry'
  }
  if (/^(Read|Grep|Glob|NotebookRead|LSP|Skill|ToolSearch)$/.test(tool)) return 'library'
  if (/^(Edit|Write|MultiEdit|NotebookEdit|Artifact|ArtifactData)$/.test(tool)) return 'workshop'
  if (/^(Monitor|TaskStop|CronCreate|CronDelete|CronList|ScheduleWakeup)$/.test(tool)) return 'foundry'
  if (/^(WebFetch|WebSearch)$/.test(tool) || /^mcp__(Claude_Browser|claude-in-chrome)__/.test(tool)) {
    return 'observatory'
  }
  if (/^mcp__ccd_(pr|host)__/.test(tool) || /merge|sync_with_base/.test(tool)) return 'harbor'
  if (/^(AskUserQuestion|ExitPlanMode|EnterPlanMode)$/.test(tool) || /^mcp__ccd_turn__/.test(tool)) {
    return 'hall'
  }
  if (/^(Agent|Task|SendMessage|ListAgents)$/.test(tool) || tool.startsWith('mcp__')) return 'relay'

  return 'hall'
}

// ---- projection -----------------------------------------------------------

export const S = 10
export const T = 5

export type Pt = [number, number]

export function p(gx: number, gy: number, z = 0): Pt {
  return [(gx - gy) * S, (gx + gy) * T - z]
}

export function n(v: number): string {
  return String(Math.round(v * 10) / 10)
}

// Whole pixels: enough for buildings, and it keeps the page small.
export function r(v: number): string {
  return String(Math.round(v))
}

export function pts(list: Pt[]): string {
  return list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')
}

export function poly(list: [number, number][], fill: string, extra = ''): string {
  return `<polygon points="${pts(list.map(([gx, gy]) => p(gx, gy)))}" fill="${fill}"${extra}/>`
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

// ---- the island -----------------------------------------------------------

export const ISLAND: [number, number][] = [
  ...PROFILE.map(([gy, w]) => [w, gy] as [number, number]),
  ...PROFILE.slice()
    .reverse()
    .map(([gy, , e]) => [e, gy] as [number, number]),
]

export const NEW_JERSEY: [number, number][] = [
  [-40, -20],
  [2.6, -20],
  ...PROFILE.map(([gy, w]) => [w - 5 - gy * 0.02, gy] as [number, number]),
  [-1.5, 66],
  [-40, 70],
]
export const BRONX: [number, number][] = [
  [9.4, -20],
  [60, -20],
  [60, 15.6],
  [16.4, 15.6],
  [14.6, 13],
  [13.8, 8],
  [13.1, 3],
  [11.3, -1],
  [9.6, -3.4],
]
export const QUEENS: [number, number][] = [
  [17.4, 19.5],
  [60, 19.5],
  [60, 46],
  [21, 46],
  [19, 40],
  [18.6, 33],
  [18.2, 25],
]
export const BROOKLYN: [number, number][] = [
  [21, 46],
  [60, 46],
  [60, 90],
  [15, 90],
  [12.6, 70],
  [14.8, 64],
  [16.8, 60],
  [19.2, 56.5],
  [20.8, 52],
  [21.3, 48.5],
]
export const ROOSEVELT: [number, number][] = [
  [17, 27],
  [17.5, 27.4],
  [17.6, 36],
  [17.1, 35.8],
]
export const RANDALLS: [number, number][] = [
  [15.6, 15.8],
  [17.4, 16],
  [17.6, 19],
  [15.8, 19.2],
]
export const GOVERNORS: [number, number][] = [
  [9.5, 64.2],
  [11.4, 64.4],
  [11.8, 66.4],
  [9.8, 66.6],
]

// ---- districts ------------------------------------------------------------

// Each district's own colour: its plaza, its landmark's lights, its name.
export const ACCENT: Record<District, string> = {
  observatory: '#f472b6',
  library: '#7cb6ff',
  relay: '#2dd4bf',
  workshop: '#facc15',
  foundry: '#fb923c',
  hall: '#c4a5ff',
  harbor: '#38bdf8',
  plaza: '#4ade80',
}

// Midtown's five sit a block or two apart, so their names wait for a zoom.
export const MIDTOWN = new Set<District>(['observatory', 'library', 'relay', 'workshop', 'foundry'])

// Where a district's agents stand: its preset spot, moved with its building.
export function spotOf(d: District, [dx, dy]: [number, number] = [0, 0]): [number, number] {
  const [sx, sy] = SITES[d].spot
  return [sx + dx, sy + dy]
}

// The shift of the building a district's agents use, in cells; none when
// nothing of the kind is placed (its agents then stand at the preset spot).
export function shiftFor(layout: Layout | undefined, d: District): [number, number] {
  const b = layout && siteFor(layout, d)
  return b ? deltaOf(b) : [0, 0]
}

// The lit ground where a district's agents stand: [gx0, gy0, gx1, gy1].
export function padOf(d: District, [dx, dy]: [number, number] = [0, 0]): [number, number, number, number] {
  const [sx, sy] = spotOf(d, [dx, dy])
  if (d === 'plaza') return [5.5 + dx, 26.6 + dy, 8.5 + dx, 31.1 + dy]
  // Times Square, the library and the Garment District open onto a plaza
  // or a park across the street, and their light spills over it.
  const deep = d === 'observatory' || d === 'library' || d === 'workshop'
  return [sx - 1.35, sy - 0.3, sx + 1.35, sy + (deep ? 0.85 : 0.42)]
}

// A district's lit ground where its building stands: a sized park's lawn is
// its footprint set in from the paths round it.
export function padFor(layout: Layout | undefined, d: District): [number, number, number, number] {
  const b = layout && siteFor(layout, d)
  if (!b?.size) return padOf(d, shiftFor(layout, d))
  const [x0, y0, x1, y1] = cellsOf(b)[0]!
  const inset = 0.3 + roomOf(b) * 0.3
  return [x0 + inset, y0 + inset, x1 - inset, y1 - inset]
}

// Where the i-th agent of a district stands, around its spot (the door of
// its building, or the station's forecourt while nothing of the kind is placed).
// `room` closes the rows up on a smaller park's lawn (`roomOf`).
export function standAt(d: District, i: number, [sx, sy]: [number, number] = SITES[d].spot, room = 1): [number, number] {
  if (d === 'plaza') {
    // On the Great Lawn, in loose rows.
    return [sx + (-1.1 + (i % 3) * 1.1) * room, sy + (-1.6 + Math.floor(i / 3) * 1.1 + (i % 2) * 0.3) * room]
  }
  const off = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.55
  return [sx + off, sy + Math.floor(i / 6) * 0.3]
}

// ---- boroughs: one per other repository -----------------------------------

// Rows along the borough's front edge, facing the viewer, a body's width
// apart: on a preset borough's square in front of its houses, on a drawn one
// along the middle of its front edge, rows stepping back into it. A
// repository with no borough waits on the station's forecourt.
export function burbAt(b: Burb, i: number, layout?: Layout): [number, number] {
  const g = burbGeo(layout, b)
  if (!g) return waitAt(layout, i)
  const [cx, cy] = g.square
  const col = i % 3
  const row = Math.floor(i / 3)
  if (g.preset) return [cx - 2.8 + col * 2 + (row % 2) * 1, cy + 3 + row * 1.4]
  const step = Math.min(1.6, (g.rect[2] - g.rect[0] - 1) / 3)
  return [cx - step + col * step + (row % 2) * (step / 2), cy - row * 0.9]
}

// The forecourt, east of the station's door, where the agents of a
// repository with no borough wait (counted across all such repositories).
export function waitAt(layout: Layout | undefined, i: number): [number, number] {
  const [sx, sy] = layout ? spotFor(layout, 'relay') : SITES.relay.spot
  return [sx + 1.6 + (i % 4) * 0.45, sy + 0.25 + Math.floor(i / 4) * 0.3]
}

// Where an agent stands: in Manhattan at its district's door; in a borough
// at the building of its kind the person placed there, else on the square.
export function placeAt(place: Place, i: number, layout?: Layout): [number, number] {
  if (!place.burb) return standAt(place.at, i, layout ? spotFor(layout, place.at) : undefined, roomOf(layout && siteFor(layout, place.at)))
  const inside = burbGeo(layout, place.burb) && burbBuilding(layout, place.burb, place.at)
  return inside ? standAt(place.at, i, doorOf(inside), roomOf(inside)) : burbAt(place.burb, i, layout)
}

// How long the train home takes to pull out of Grand Central and be gone, and
// an arriving one to come in. It runs along the track behind the station's
// front (`trackOf` in src/layout.ts), east to the tunnel under the river.
export const TRAIN_MS = 3_000

// ---- the onboarding game --------------------------------------------------

// The landmarks in the order the Blueprints card lists them, with the hint
// that says how to build each.
export const LANDMARKS: Landmark[] = ['hall', 'library', 'workshop', 'foundry', 'observatory', 'relay', 'harbor', 'torch', 'plaza', 'empire']

export const BLUEPRINTS: Record<Landmark, { name: string; hint: string }> = {
  hall: { name: 'City Hall', hint: 'Send a prompt to build it' },
  library: { name: 'Public Library', hint: 'Read a file to build it' },
  workshop: { name: 'Garment District', hint: 'Edit a file to build it' },
  foundry: { name: 'Hudson Yards', hint: 'Run a shell command to build it' },
  observatory: { name: 'Times Square', hint: 'Fetch a web page to build it' },
  relay: { name: "Grand Central's towers", hint: 'Ask Claude to use a subagent' },
  harbor: { name: 'Seaport and the Statue of Liberty', hint: 'Commit to build them' },
  torch: { name: "Liberty's torch", hint: 'Push to light it' },
  plaza: { name: 'Central Park', hint: 'Let a subagent finish to green it' },
  empire: { name: 'Empire State Building', hint: 'Build every district to raise it' },
}

// A landmark stands in scaffolding this long after it goes up; the fireworks
// for the finished city last this long.
export const SCAFFOLD_MS = 6_000
export const FIREWORKS_MS = 20_000

// The filler blocks (the preset's lots, in src/layout.ts): one more for every
// BLOCK_EVERY tool calls, Midtown and downtown first, until the island is full.
// The population at which every lot has its block.
export function fullPopulation(): number {
  return lots().length * BLOCK_EVERY
}

// How many blocks a population has earned, of `all` lots: quick at first (a
// morning's work shows), then one or two a day for weeks, until they are full.
export function blocksFor(population: number, all = lots().length): number {
  if (!Number.isFinite(population)) return all
  return Math.min(all, Math.floor(all * Math.sqrt(Math.max(0, population) / fullPopulation())))
}

// From one place's door to another's along the roads the person laid
// (`route` in src/layout.ts), over a bridge in or out of a borough, and off
// the road to where the walker stands. Where no road joins the two, the walker
// goes straight: the game layer never blocks the work.
export function walk(from: Place, to: Place, end: [number, number], layout?: Layout): { path: string; dur: number; pts: Pt[] } {
  const via: [number, number][] = [placeAt(from, 0, layout)]
  let a = via[0]!
  const fromGeo = from.burb ? burbGeo(layout, from.burb) : undefined
  if (fromGeo) {
    // Out to the square, then over the bridge (a drawn borough: its front edge).
    if (burbBuilding(layout, from.burb!, from.at)) via.push(fromGeo.square)
    via.push(fromGeo.far, fromGeo.near)
    a = fromGeo.near
  }
  const toGeo = to.burb ? burbGeo(layout, to.burb) : undefined
  const target: [number, number] = toGeo ? toGeo.near : isWaiting(to.burb) ? waitAt(layout, 0) : layout ? spotFor(layout, to.at) : SITES[to.at].spot
  const road = layout && route(layout, a, target)
  if (road) via.push(...road.slice(1))
  else via.push(target)
  if (toGeo) via.push(toGeo.far)
  // No point twice in a row (the stand point is often the door itself).
  for (let i = via.length - 1; i > 0; i--) if (via[i]![0] === via[i - 1]![0] && via[i]![1] === via[i - 1]![1]) via.splice(i, 1)
  let dist = 0
  for (let i = 1; i < via.length; i++) {
    dist += Math.abs(via[i]![0] - via[i - 1]![0]) + Math.abs(via[i]![1] - via[i - 1]![1])
  }
  const screen = via.map(([gx, gy]) => p(gx, gy).map(v => Math.round(v * 10) / 10) as Pt)
  const path = 'M' + screen.map(([x, y]) => `${x},${y}`).join(' L')
  return { path, dur: Math.min(4.5, 1 + dist * 0.05), pts: screen }
}


// ---- the frame ------------------------------------------------------------

export type Frame = { x: number; y: number; w: number; h: number }

// The whole map: the island, the bay and Liberty Island, and every borough in use.
export function frame(burbs: Burb[], layout?: Layout): Frame {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  const take = (gx: number, gy: number) => {
    const [x, y] = p(gx, gy)
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  if (layout && !('preset' in layout.map)) {
    // A generated map: all of it (the page opens on the island, zoomed in).
    for (const [y, x0, x1] of layout.land) {
      take(x0, y)
      take(x1, y)
      take(x0, y + 1)
      take(x1, y + 1)
    }
  } else {
    for (let gy = -3; gy <= 71; gy += 0.5) {
      const [w, e] = edges(gy)
      take(w - 1, gy)
      take(e + 1, gy)
    }
    for (const [gx, gy] of [
      [0.5, 71],
      [3.5, 71.5],
      [12, 67],
      [-3, 70],
    ] as const) take(gx, gy)
  }
  for (const b of burbs) {
    const g = burbGeo(layout, b)
    if (!g) continue
    const [x0, y0, x1, y1] = g.rect
    take(x0, y1)
    take(x1, y0)
    take(x1, y1)
  }
  // Room above the northern tip for the moon and the tallest spires.
  const head = 46
  const pad = 20
  return { x: x0 - pad, y: y0 - head, w: x1 - x0 + pad * 2, h: y1 - y0 + head + pad }
}

// What every layer knows about this frame.
export type Scene = {
  now: number
  // Manhattan's agents by district; the others by borough.
  byDistrict: Map<District, Agent[]>
  byBurb: Map<Burb, Agent[]>
  // Districts with someone working in them.
  active: Set<District>
  hasConflict: boolean
  isWaiting: boolean
  // The repositories living in each borough, and the ones that have packed up
  // and left their houses behind (sign down, nobody home).
  repoOf: Map<Burb, Repo>
  vacantOf: Map<Burb, Repo>
  // Agents' size on the map, before the page's zoom.
  k: number
  // A newer Agent City on main: the Empire State lights up and becomes the
  // update button. `blocked` says why it can't update cleanly, if so.
  update?: { available: boolean; behind: number; latest?: string; blocked?: string; local?: boolean }
  // The onboarding game: when each landmark went up (unbuilt ones are
  // blueprint lots), how many tool calls the city has seen, and whether the
  // hooks are installed (the rails into Grand Central).
  built: Partial<Record<Landmark, number>>
  population: number
  connected: boolean
  // What stands where (docs/city-builder.md): the drawing reads it, and its
  // revision is in the map's hash, since a placement changes the map.
  layout: Layout
  rev: number
}

// ---- layers (docs/frames.md) ---------------------------------------------

// One dynamic piece of the city, drawn over the static map. The page keeps a
// <g> per key and replaces its content only when `h` changes, so `h` must come
// from what the item shows, never from markup that holds the clock.
export type OverlayItem = { k: string; h: string; svg: string; top?: true }

// An agent as the page draws and moves it: its figure around (0,0), where it
// stands, and the walk under way, if any, as a route in SVG units.
export type Sprite = {
  id: string
  session: string
  cls: string
  x: number
  y: number
  z: number
  fig: { h: string; svg: string }
  walk?: { t0: number; dur: number; pts: Pt[] }
}

// FNV-1a over a string: short and stable, and quick enough for a few KB a frame.
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

// An overlay item hashed by its markup, for pieces whose markup holds no clock.
export function item(k: string, svg: string, top = false): OverlayItem {
  return top ? { k, h: hash(svg), svg, top } : { k, h: hash(svg), svg }
}

// An overlay item hashed by its inputs, for markup with begin offsets from now.
export function keyed(k: string, inputs: unknown[], svg: string, top = false): OverlayItem {
  const h = hash(JSON.stringify(inputs))
  return top ? { k, h, svg, top } : { k, h, svg }
}

// ---- the City Treasury ------------------------------------------------------

// A local date, the Treasury's day: "2026-11-01".
export function dayOf(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Dollars as the Treasury shows them: cents, or tenths of a cent below a dime.
export function usd(v: number): string {
  return v < 0.1 && v > 0 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`
}

