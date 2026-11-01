import type { Agent, Burb, District, Place, Repo } from '../types.ts'

// The map's geometry, shared by every layer: the projection, the island and
// its neighbours, where districts and boroughs are, and how agents walk.

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

export function seeded(i: number, j: number): number {
  let h = (Math.round(i * 1000) * 374761393 + Math.round(j * 1000) * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---- the island -----------------------------------------------------------

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

export type Site = {
  // Where agents stand: on the street in front of the landmark.
  spot: [number, number]
  // Where its name goes, how high above the ground, and which way it reads
  // from there (centred unless given).
  label: [number, number, number, ('start' | 'end')?]
}

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

// The lit ground where a district's agents stand: [gx0, gy0, gx1, gy1].
export function padOf(d: District): [number, number, number, number] {
  const [sx, sy] = SITES[d].spot
  if (d === 'plaza') return [5.5, 26.6, 8.5, 31.1]
  // Times Square, the library and the Garment District open onto a plaza
  // or a park across the street, and their light spills over it.
  const deep = d === 'observatory' || d === 'library' || d === 'workshop'
  return [sx - 1.35, sy - 0.3, sx + 1.35, sy + (deep ? 0.85 : 0.42)]
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

export function standAt(d: District, i: number): [number, number] {
  const [sx, sy] = SITES[d].spot
  if (d === 'plaza') {
    // On the Great Lawn, in loose rows.
    return [sx - 1.1 + (i % 3) * 1.1, sy - 1.6 + Math.floor(i / 3) * 1.1 + (i % 2) * 0.3]
  }
  const off = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.55
  return [sx + off, sy + Math.floor(i / 6) * 0.3]
}

// ---- boroughs: one per other repository -----------------------------------

export const BURBS: Record<Burb, { name: string; center: [number, number]; near: [number, number]; far: [number, number] }> = {
  brooklyn: { name: 'Brooklyn', center: [24, 55.5], near: [14.4, 56], far: [19.8, 56.2] },
  queens: { name: 'Queens', center: [24, 32.5], near: [16, 34.5], far: [19.2, 34.5] },
  bronx: { name: 'The Bronx', center: [19.5, 8], near: [12.9, 11], far: [14.6, 11] },
  jersey: { name: 'Jersey City', center: [-8.5, 40], near: [0.4, 39], far: [-4.8, 39] },
}

export const BURB_ORDER: Burb[] = ['brooklyn', 'queens', 'bronx', 'jersey']

// Rows along the borough's front edge, facing the viewer, a body's width apart.
export function burbAt(b: Burb, i: number): [number, number] {
  const [cx, cy] = BURBS[b].center
  const col = i % 3
  const row = Math.floor(i / 3)
  return [cx - 2.8 + col * 2 + (row % 2) * 1, cy + 3 + row * 1.4]
}

export function placeAt(place: Place, i: number): [number, number] {
  return place.burb ? burbAt(place.burb, i) : standAt(place.at, i)
}

// Along the walker's street to Fifth Avenue, down Fifth, along the street to
// the destination: the grid way, crossing a bridge in or out of a borough.
export function walk(from: Place, to: Place, end: [number, number]): { path: string; dur: number } {
  const trunk = 9
  const via: [number, number][] = [placeAt(from, 0)]
  if (from.burb) {
    const b = BURBS[from.burb]
    via.push(b.far, b.near, [trunk, b.near[1]])
  } else {
    via.push([trunk, via[0]![1]])
  }
  if (to.burb) {
    const b = BURBS[to.burb]
    via.push([trunk, b.near[1]], b.near, b.far)
  } else {
    via.push([trunk, end[1]])
  }
  via.push(end)
  let dist = 0
  for (let i = 1; i < via.length; i++) {
    dist += Math.abs(via[i]![0] - via[i - 1]![0]) + Math.abs(via[i]![1] - via[i - 1]![1])
  }
  const path = 'M' + via.map(([gx, gy]) => p(gx, gy).map(n).join(',')).join(' L')
  return { path, dur: Math.min(4.5, 1 + dist * 0.05) }
}


// ---- the frame ------------------------------------------------------------

export type Frame = { x: number; y: number; w: number; h: number }

// The whole map: the island, the bay and Liberty Island, and every borough in use.
export function frame(burbs: Burb[]): Frame {
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
  for (const b of burbs) {
    const [cx, cy] = BURBS[b].center
    take(cx - 3.5, cy + 3.5)
    take(cx + 3.5, cy - 3.5)
    take(cx + 3.5, cy + 3.5)
  }
  // Room above the northern tip for the moon and the tallest spires.
  const head = 46
  const pad = 20
  return { x: x0 - pad, y: y0 - head, w: x1 - x0 + pad * 2, h: y1 - y0 + head + pad }
}

// What every layer knows about this frame.
export type Scene = {
  now: number
  animateWalks: boolean
  // Manhattan's agents by district; the others by borough.
  byDistrict: Map<District, Agent[]>
  byBurb: Map<Burb, Agent[]>
  // Districts with someone working in them.
  active: Set<District>
  hasConflict: boolean
  isWaiting: boolean
  repoOf: Map<Burb, Repo>
  // Agents' size on the map, before the page's zoom.
  k: number
}
