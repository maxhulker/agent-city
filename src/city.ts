import type { Agent, Burb, District, Launch, Place, Repo, View, World } from './types.ts'

// Draws the world as one animated isometric SVG of Manhattan at night. Pure:
// no I/O, so the server renders it on each change.
//
// The grid follows Manhattan's own: gx runs across the island, west (Hudson)
// to east (East River), avenues on the odd lines; gy runs down the island,
// north (Inwood) to south (the Battery), one unit for about four streets.

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

export const VIEWS: Record<View, string> = {
  island: 'Whole island',
  uptown: 'Uptown',
  midtown: 'Midtown',
  downtown: 'Downtown',
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

const S = 10
const T = 5

type Pt = [number, number]

function p(gx: number, gy: number, z = 0): Pt {
  return [(gx - gy) * S, (gx + gy) * T - z]
}

function n(v: number): string {
  return String(Math.round(v * 10) / 10)
}

// Whole pixels: enough for buildings, and it keeps the page small.
function r(v: number): string {
  return String(Math.round(v))
}

function pts(list: Pt[]): string {
  return list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')
}

function poly(list: [number, number][], fill: string, extra = ''): string {
  return `<polygon points="${pts(list.map(([gx, gy]) => p(gx, gy)))}" fill="${fill}"${extra}/>`
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

function seeded(i: number, j: number): number {
  let h = (Math.round(i * 1000) * 374761393 + Math.round(j * 1000) * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---- the island -----------------------------------------------------------

// Shoreline as [gy, west, east], north to south.
const PROFILE: [number, number, number][] = [
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

function edges(gy: number): [number, number] {
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

const ISLAND: [number, number][] = [
  ...PROFILE.map(([gy, w]) => [w, gy] as [number, number]),
  ...PROFILE.slice()
    .reverse()
    .map(([gy, , e]) => [e, gy] as [number, number]),
]

const NEW_JERSEY: [number, number][] = [
  [-40, -20],
  [2.6, -20],
  ...PROFILE.map(([gy, w]) => [w - 5 - gy * 0.02, gy] as [number, number]),
  [-1.5, 66],
  [-40, 70],
]
const BRONX: [number, number][] = [
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
const QUEENS: [number, number][] = [
  [17.4, 19.5],
  [60, 19.5],
  [60, 46],
  [21, 46],
  [19, 40],
  [18.6, 33],
  [18.2, 25],
]
const BROOKLYN: [number, number][] = [
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
const ROOSEVELT: [number, number][] = [
  [17, 27],
  [17.5, 27.4],
  [17.6, 36],
  [17.1, 35.8],
]
const RANDALLS: [number, number][] = [
  [15.6, 15.8],
  [17.4, 16],
  [17.6, 19],
  [15.8, 19.2],
]
const GOVERNORS: [number, number][] = [
  [9.5, 64.2],
  [11.4, 64.4],
  [11.8, 66.4],
  [9.8, 66.6],
]

// ---- palettes -------------------------------------------------------------

type Pal = 'g' | 's' | 'b' | 'r' | 'k'

const PALETTES: Record<Pal, [string, string, string]> = {
  // left face, right face, roof
  g: ['#1d3557', '#13253f', '#31507a'],
  s: ['#7d7368', '#57504a', '#a39a8f'],
  b: ['#6e4127', '#4d2c19', '#91593a'],
  r: ['#7f3324', '#5a2318', '#a3483a'],
  k: ['#4b5563', '#343b46', '#6b7280'],
}

function defs(): string {
  let d = '<defs>'
  d += `<linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#081226"/><stop offset="1" stop-color="#12284a"/></linearGradient>`
  d += `<radialGradient id="halo"><stop offset="0" stop-color="#fde68a" stop-opacity=".55"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>`
  d += `<radialGradient id="alarm"><stop offset="0" stop-color="#ef4444" stop-opacity=".7"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></radialGradient>`
  for (const [k, [l, r]] of Object.entries(PALETTES)) {
    // Lit windows, skewed to lie flat on each face.
    for (const [side, base, skew] of [
      ['L', l, 26.565],
      ['R', r, -26.565],
    ] as const) {
      d += `<pattern id="${k}${side}" width="4" height="5" patternUnits="userSpaceOnUse" patternTransform="skewY(${skew})"><rect width="4" height="5" fill="${base}"/><rect x="1" y="1.4" width="1.6" height="1.8" fill="#fcd581" opacity="${side === 'L' ? 0.75 : 0.45}"/></pattern>`
    }
  }
  d += '</defs><style>'
  for (const [k, [, , top]] of Object.entries(PALETTES)) {
    d += `.${k}L{fill:url(#${k}L)}.${k}R{fill:url(#${k}R)}.${k}T{fill:${top}}`
  }
  d += `.ring{display:none}`
  d += `.lbl{font-weight:700;letter-spacing:.06em;fill:#e2e8f0;paint-order:stroke;stroke:#0b1224;stroke-width:3px}`
  d += `.hood{font-weight:600;letter-spacing:.18em;fill:#cbd5e1;opacity:.45}`
  d += `.water{font-style:italic;letter-spacing:.3em;fill:#7aa2d6;opacity:.6}`
  d += '</style>'
  return d
}

// A box on the grid: footprint gx [x0, x0+w], gy [y0, y0+d], h tall, from z.
function box(x0: number, y0: number, w: number, d: number, h: number, pal: Pal, z = 0): string {
  const [ax, ay] = p(x0, y0 + d, z)
  const wx = r(w * S)
  const wy = r(w * T)
  const dx = r(d * S)
  const dy = r(d * T)
  const hh = r(h)
  const bx = ax + w * S
  const by = ay + w * T

  return (
    `<path class="${pal}L" d="M${r(ax)} ${r(ay)}l${wx} ${wy}v-${hh}l-${wx} -${wy}z"/>` +
    `<path class="${pal}R" d="M${r(bx)} ${r(by)}l${dx} -${dy}v-${hh}l-${dx} ${dy}z"/>` +
    `<path class="${pal}T" d="M${r(ax)} ${r(ay - h)}l${wx} ${wy}l${dx} -${dy}l-${wx} -${wy}z"/>`
  )
}

// ---- districts ------------------------------------------------------------

type Site = {
  // Where agents stand: on the street in front of the landmark.
  spot: [number, number]
  // Where its name goes, and how high above the ground.
  label: [number, number, number]
}

const SITES: Record<District, Site> = {
  observatory: { spot: [6, 39], label: [5.6, 38.2, 62] },
  library: { spot: [8, 40], label: [8.4, 40.5, -10] },
  relay: { spot: [11, 40], label: [12.2, 40.4, -10] },
  workshop: { spot: [6, 41], label: [5.6, 42.2, -10] },
  foundry: { spot: [3, 42], label: [1.6, 40.6, 70] },
  hall: { spot: [8.5, 56], label: [8.5, 56.8, -10] },
  harbor: { spot: [12.4, 58], label: [13.6, 59, -10] },
  plaza: { spot: [7, 28.5], label: [5.2, 24, 8] },
}

// Lots the landmarks take, skipped when filling the grid.
const RESERVED: [number, number, number, number][] = [
  [5, 22, 9, 35], // Central Park
  [5, 38, 7, 39], // Times Square
  [7, 39, 9, 40], // Public Library
  [9, 39, 13, 40], // Grand Central, Chrysler
  [9, 38, 11, 39], // MetLife
  [5, 40, 7, 41], // Garment District
  [7, 41, 9, 42], // Empire State
  [1, 40, 5, 42], // Hudson Yards
  [7, 55, 10, 56], // City Hall
  [11, 57, 15, 58], // Seaport
  [3, 57, 6, 58], // One World Trade
]

function isReserved(x: number, y: number): boolean {
  return RESERVED.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)
}

function standAt(d: District, i: number): [number, number] {
  const [sx, sy] = SITES[d].spot
  if (d === 'plaza') {
    return [5.8 + (i % 3) * 1.1, sy - 3 + Math.floor(i / 3) * 1.9 + (i % 2) * 0.5]
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
function burbAt(b: Burb, i: number): [number, number] {
  const [cx, cy] = BURBS[b].center
  const col = i % 3
  const row = Math.floor(i / 3)
  return [cx - 2.8 + col * 2 + (row % 2) * 1, cy + 3 + row * 1.4]
}

function placeAt(place: Place, i: number): [number, number] {
  return place.burb ? burbAt(place.burb, i) : standAt(place.at, i)
}

// Along the walker's street to Fifth Avenue, down Fifth, along the street to
// the destination: the grid way, crossing a bridge in or out of a borough.
function walk(from: Place, to: Place, end: [number, number]): { path: string; dur: number } {
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

// A small neighbourhood of low buildings, named for the repository.
function burb(b: Burb, repo: Repo, isActive: boolean, hud: number): string {
  const [cx, cy] = BURBS[b].center
  let g = isActive ? glow(cx, cy, 40) : ''
  const lots: Item[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === 0 && j === 2) continue // the square, where agents gather
      const x = cx - 2.4 + i * 1.6
      const y = cy - 2.4 + j * 1.6
      const rr = seeded(x + 100, y)
      const h = 6 + rr * 14
      const pal: Pal = rr > 0.66 ? 'r' : rr > 0.33 ? 'b' : 'k'
      lots.push({ depth: x + y, svg: box(x, y, 1.1, 1.1, h, pal) })
    }
  }
  lots.sort((a, c) => a.depth - c.depth)
  g += lots.map(l => l.svg).join('')
  g += tree(cx - 2.2, cy + 0.6, 2.4) + tree(cx - 1, cy + 2.9, 2.2)
  // The sign hangs at the back corner, clear of the square where agents stand.
  const [lx, ly] = p(cx + 0.8, cy - 2.6, 40)
  g += `<text class="hood" x="${n(lx)}" y="${n(ly - 12 * hud)}" text-anchor="middle" font-size="${n(7 * hud)}" style="opacity:.8">${BURBS[b].name.toUpperCase()}</text>`
  g += `<text class="lbl" x="${n(lx)}" y="${n(ly)}" text-anchor="middle" font-size="${n(10 * hud)}" style="stroke-width:${n(3 * hud)}px;fill:${isActive ? '#fde68a' : '#e2e8f0'}">${esc(repo.name)}</text>`
  return g
}

// ---- city fabric ----------------------------------------------------------

function heightAt(x: number, y: number, r: number): number {
  const midtown = 62 * Math.exp(-(((y - 39.5) / 4.2) ** 2)) * (1 - Math.min(1, Math.abs(x - 10) / 14))
  const fidi = 68 * Math.exp(-(((y - 59) / 2.4) ** 2))
  const uptownRow = y > 20 && y < 35 ? 9 : 0
  const base = y < 18 ? 7 : y > 45 && y < 55 ? 7 : 9
  return Math.max(4, (base + uptownRow + midtown + fidi) * (0.55 + r * 0.8))
}

function palAt(y: number, h: number, r: number): Pal {
  if (h > 30) return 'g'
  if (y < 18) return r > 0.5 ? 'b' : 'r'
  if (y < 35) return r > 0.35 ? 's' : 'b'
  if (y > 45 && y < 56) return r > 0.4 ? 'r' : 'k'
  return r > 0.5 ? 'k' : 's'
}

type Item = { depth: number; svg: string }

function fabric(items: Item[], rows: [number, number]) {
  for (let y = Math.max(-2, rows[0]); y < Math.min(63, rows[1]); y++) {
    const [w0, e0] = edges(y)
    const [w1, e1] = edges(y + 1)
    const west = Math.max(w0, w1) + 0.15
    const east = Math.min(e0, e1) - 0.15
    for (let x = -1; x < 19; x += 2) {
      if (isReserved(x + 1, y)) continue
      const x0 = Math.max(x + 0.2, west)
      const x1 = Math.min(x + 1.8, east)
      if (x1 - x0 < 0.5) continue
      const r = seeded(x, y)
      const y0 = y + 0.14
      const d = 0.72
      // Two buildings on wide lots, for a ragged skyline.
      if (x1 - x0 > 1.2 && r > 0.6) {
        const cut = x0 + (x1 - x0) * (0.4 + r * 0.2)
        const r2 = seeded(y, x)
        const h1 = heightAt(x0, y, r)
        const h2 = heightAt(cut, y, r2)
        items.push({ depth: x0 + y + 1, svg: box(x0, y0, cut - x0 - 0.06, d, h1, palAt(y, h1, r)) })
        items.push({ depth: cut + y + 1, svg: box(cut + 0.06, y0, x1 - cut - 0.06, d, h2, palAt(y, h2, r2)) })
      } else {
        const h = heightAt(x0, y, r)
        items.push({ depth: x0 + y + 1, svg: box(x0, y0, x1 - x0, d, h, palAt(y, h, r)) })
      }
    }
  }
}

// ---- effects --------------------------------------------------------------

function beacon(x: number, y: number, color: string, mark: string, k: number): string {
  return (
    `<g><animateTransform attributeName="transform" type="translate" values="0,0;0,${n(-4 * k)};0,0" dur="1s" repeatCount="indefinite"/>` +
    `<circle cx="${n(x)}" cy="${n(y)}" r="${n(9 * k)}" fill="${color}" stroke="#fff" stroke-width="${n(1.6 * k)}"/>` +
    `<text x="${n(x)}" y="${n(y + 4.4 * k)}" text-anchor="middle" font-size="${n(12.5 * k)}" font-weight="800" fill="#111827">${mark}</text></g>`
  )
}

function smoke(x: number, y: number, color: string): string {
  let out = ''
  for (let i = 0; i < 4; i++) {
    const b = `begin="${i * 0.8}s" dur="3.2s" repeatCount="indefinite"`
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="3" fill="${color}" opacity="0">`
    out += `<animate attributeName="cy" values="${n(y)};${n(y - 34)}" ${b}/>`
    out += `<animate attributeName="cx" values="${n(x)};${n(x + 12)}" ${b}/>`
    out += `<animate attributeName="r" values="3;9" ${b}/>`
    out += `<animate attributeName="opacity" values=".8;0" ${b}/></circle>`
  }
  return out
}

function sparks(x: number, y: number): string {
  let out = ''
  for (let i = 0; i < 5; i++) {
    const b = `begin="${(i * 0.13).toFixed(2)}s" dur=".7s" repeatCount="indefinite"`
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="1.4" fill="#fde047" opacity="0">`
    out += `<animate attributeName="cx" values="${n(x)};${n(x + (i - 2) * 5)}" ${b}/>`
    out += `<animate attributeName="cy" values="${n(y)};${n(y - 9)};${n(y + 3)}" ${b}/>`
    out += `<animate attributeName="opacity" values="1;0" ${b}/></circle>`
  }
  return out
}

function rings(x: number, y: number, color: string): string {
  let out = ''
  for (let i = 0; i < 3; i++) {
    const b = `begin="${i * 0.8}s" dur="2.4s" repeatCount="indefinite"`
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="3" fill="none" stroke="${color}" stroke-width="1.6">`
    out += `<animate attributeName="r" values="3;26" ${b}/><animate attributeName="opacity" values=".9;0" ${b}/></circle>`
  }
  return out
}

function glow(gx: number, gy: number, r: number, id = 'halo'): string {
  const [x, y] = p(gx, gy)
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r * 2)}" ry="${n(r)}" fill="url(#${id})"/>`
}

function spire(gx: number, gy: number, z: number, len: number, light = '#f87171'): string {
  const [x, y] = p(gx, gy, z)
  return (
    `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - len)}" stroke="#cbd5e1" stroke-width="1.2"/>` +
    `<circle cx="${n(x)}" cy="${n(y - len)}" r="1.6" fill="${light}"><animate attributeName="opacity" values="1;.15;1" dur="1.5s" repeatCount="indefinite"/></circle>`
  )
}

function tree(gx: number, gy: number, r: number): string {
  const [x, y] = p(gx, gy)
  return `<circle cx="${n(x)}" cy="${n(y - r)}" r="${n(r)}" fill="${seeded(gx, gy) > 0.5 ? '#166534' : '#15803d'}"/>`
}

// ---- landmarks ------------------------------------------------------------

type Mood = { active: Set<District>; hasConflict: boolean; isWaiting: boolean; k: number }

function landmarks(items: Item[], m: Mood) {
  const on = (d: District) => m.active.has(d)

  // Central Park: lawn, the Reservoir, the Lake, trees.
  {
    let g = poly(
      [
        [5.15, 22.1],
        [8.85, 22.1],
        [8.85, 34.9],
        [5.15, 34.9],
      ],
      '#1f5130',
    )
    const [rx, ry] = p(7, 26.2)
    g += `<ellipse cx="${n(rx)}" cy="${n(ry)}" rx="20" ry="9" fill="#1e4f86" transform="rotate(-26.6 ${n(rx)} ${n(ry)})"/>`
    const [lx, ly] = p(6.4, 31)
    g += `<ellipse cx="${n(lx)}" cy="${n(ly)}" rx="11" ry="4.5" fill="#1e4f86"/>`
    for (let i = 0; i < 46; i++) {
      const tx = 5.4 + seeded(i, 3) * 3.2
      const ty = 22.4 + seeded(3, i) * 12.2
      if (Math.abs(tx - 7) < 1.4 && Math.abs(ty - 26.2) < 1.6) continue
      g += tree(tx, ty, 2 + seeded(i, i) * 1.6)
    }
    items.push({ depth: 26, svg: g })
  }

  // Times Square: towers wrapped in billboards that cycle when busy.
  {
    let g = on('observatory') ? glow(6, 38.6, 26) : ''
    g += box(5.2, 38.15, 0.7, 0.7, 46, 'k')
    g += box(6.05, 38.15, 0.75, 0.7, 38, 'g')
    const colors = ['#f43f5e', '#22d3ee', '#a3e635', '#f59e0b', '#c084fc']
    for (let i = 0; i < 4; i++) {
      const gx = 5.25 + (i % 2) * 0.85
      const [x, y] = p(gx + 0.3, 38.85, 10 + i * 7)
      const c = colors[i % colors.length]!
      const c2 = colors[(i + 2) % colors.length]!
      g += `<polygon points="${pts([
        [x - 6, y - 3],
        [x + 2, y + 1],
        [x + 2, y - 6],
        [x - 6, y - 10],
      ])}" fill="${c}" opacity=".9">${on('observatory') ? `<animate attributeName="fill" values="${c};${c2};${c}" dur="${1.2 + i * 0.3}s" repeatCount="indefinite"/>` : ''}</polygon>`
    }
    items.push({ depth: 38.15 + 5.2 + 1.5, svg: g })
  }

  // Public Library and Bryant Park.
  {
    let g = on('library') ? glow(8, 39.5, 22) : ''
    g += poly(
      [
        [8.1, 39.1],
        [8.85, 39.1],
        [8.85, 39.9],
        [8.1, 39.9],
      ],
      '#1f5130',
    )
    g += tree(8.4, 39.3, 2.2) + tree(8.7, 39.6, 2)
    g += box(7.15, 39.2, 0.85, 0.65, 11, 's')
    const [cx, cy] = p(7.15, 39.85)
    for (let i = 0; i < 4; i++) {
      g += `<rect x="${n(cx + 2 + i * 1.9)}" y="${n(cy + i - 9)}" width=".9" height="8" fill="#f5f5f4"/>`
    }
    if (on('library')) {
      const [wx, wy] = p(7.6, 39.85, 6)
      g += `<rect x="${n(wx - 3)}" y="${n(wy - 2)}" width="6" height="3" fill="#fde68a"><animate attributeName="opacity" values="1;.5;1" dur="1.4s" repeatCount="indefinite"/></rect>`
    }
    items.push({ depth: 39.2 + 7.15 + 1.5, svg: g })
  }

  // Grand Central, the MetLife tower behind it, and the Chrysler Building.
  {
    let g = on('relay') ? glow(10.8, 39.5, 24) : ''
    g += box(10.4, 38.3, 0.8, 0.55, 58, 'k')
    g += box(9.4, 39.2, 2.2, 0.65, 13, 's')
    const [ax, ay] = p(10.5, 39.85, 3)
    for (let i = 0; i < 3; i++) {
      g += `<path d="M${n(ax + i * 4)} ${n(ay + i * 2)}v-5a2 2 0 0 1 3 0v5z" fill="${on('relay') ? '#fde68a' : '#1f2937'}"/>`
    }
    const [mx, my] = p(10.8, 38.6, 58)
    if (on('relay')) g += rings(mx, my - 4, '#5eead4')
    g += box(12.3, 39.2, 0.5, 0.5, 62, 'g')
    const [cx, cy] = p(12.55, 39.45, 62)
    g += `<path d="M${n(cx - 4)} ${n(cy)}L${n(cx)} ${n(cy - 12)}L${n(cx + 4)} ${n(cy)}z" fill="#e2e8f0"/>`
    g += `<path d="M${n(cx - 2.6)} ${n(cy - 3)}L${n(cx)} ${n(cy - 9)}L${n(cx + 2.6)} ${n(cy - 3)}" fill="none" stroke="#94a3b8" stroke-width=".8"/>`
    g += spire(12.55, 39.45, 74, 10, '#e2e8f0')
    items.push({ depth: 39.2 + 9.4 + 2.5, svg: g })
  }

  // Garment District, with the Empire State Building on Fifth.
  {
    let g = on('workshop') ? glow(6, 40.6, 22) : ''
    g += box(5.2, 40.15, 1.6, 0.7, 20, 'r')
    // Water towers.
    for (const gx of [5.6, 6.3]) {
      const [x, y] = p(gx, 40.5, 20)
      g += `<rect x="${n(x - 1.6)}" y="${n(y - 6)}" width="3.2" height="4" fill="#78350f"/><path d="M${n(x - 2)} ${n(y - 6)}L${n(x)} ${n(y - 8.5)}L${n(x + 2)} ${n(y - 6)}z" fill="#57534e"/>`
    }
    if (on('workshop')) g += sparks(...p(6.8, 40.6, 8))
    items.push({ depth: 40.15 + 5.2 + 1.5, svg: g })

    let e = box(7.6, 41.15, 1.2, 0.7, 34, 's')
    e += box(7.85, 41.3, 0.7, 0.45, 34, 's', 34)
    e += box(8.0, 41.4, 0.4, 0.28, 18, 's', 68)
    e += spire(8.2, 41.54, 86, 16)
    items.push({ depth: 41.15 + 7.6 + 1.5, svg: e })
  }

  // Hudson Yards: rail yard, towers, the Vessel.
  {
    let g = on('foundry') ? glow(3, 41, 30) : ''
    g += poly(
      [
        [1.2, 40.2],
        [4.8, 40.2],
        [4.8, 41.85],
        [1.2, 41.85],
      ],
      '#2b2f3a',
    )
    for (let i = 0; i < 6; i++) {
      const y = 40.4 + i * 0.25
      const [x1, y1] = p(1.3, y)
      const [x2, y2] = p(4.7, y)
      g += `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#64748b" stroke-width=".6"/>`
    }
    g += box(3.3, 40.25, 0.6, 0.5, 64, 'g')
    g += box(4.05, 40.3, 0.6, 0.5, 52, 'g')
    const [vx, vy] = p(2.3, 41.4)
    g += `<path d="M${n(vx - 4)} ${n(vy)}L${n(vx - 7)} ${n(vy - 12)}L${n(vx + 7)} ${n(vy - 12)}L${n(vx + 4)} ${n(vy)}z" fill="#b45309"/>`
    const [sx, sy] = p(1.6, 40.6)
    g += `<rect x="${n(sx - 2)}" y="${n(sy - 22)}" width="4" height="22" fill="#64748b"/>`
    if (on('foundry')) g += smoke(sx, sy - 24, '#cbd5e1')
    items.push({ depth: 40.25 + 3.3 + 1.5, svg: g })
  }

  // City Hall in its park.
  {
    let g = poly(
      [
        [7.15, 55.1],
        [9.85, 55.1],
        [9.85, 55.9],
        [7.15, 55.9],
      ],
      '#1f5130',
    )
    g += tree(7.4, 55.3, 2.2) + tree(9.5, 55.4, 2.2) + tree(9.6, 55.8, 1.8)
    g += box(8.1, 55.3, 1.0, 0.45, 9, 's')
    const [dx, dy] = p(8.6, 55.52, 9)
    g += `<path d="M${n(dx - 3)} ${n(dy)}a3 3 0 0 1 6 0z" fill="#e7e5e4"/>`
    g += `<line x1="${n(dx)}" y1="${n(dy - 3)}" x2="${n(dx)}" y2="${n(dy - 12)}" stroke="#e2e8f0" stroke-width=".8"/>`
    g += `<path d="M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z" fill="#60a5fa"><animate attributeName="d" values="M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z;M${n(dx)} ${n(dy - 12)}l6 2.5l-6 .5z;M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z" dur="1.2s" repeatCount="indefinite"/></path>`
    if (m.isWaiting) g += beacon(dx, dy - 28, '#fbbf24', '?', m.k)
    items.push({ depth: 55.3 + 8.1 + 1.5, svg: g })
  }

  // One World Trade Center.
  {
    let g = box(4.2, 57.2, 0.7, 0.7, 84, 'g')
    const [x, y] = p(4.55, 57.55, 84)
    g += `<path d="M${n(x - 7)} ${n(y)}L${n(x)} ${n(y - 8)}L${n(x + 7)} ${n(y)}z" fill="#3b5a85"/>`
    g += spire(4.55, 57.55, 92, 18)
    items.push({ depth: 57.2 + 4.2 + 1.4, svg: g })
  }

  // South Street Seaport: pier, tall ship, crane.
  {
    let g = poly(
      [
        [12.6, 57.15],
        [15.4, 57.15],
        [15.4, 57.85],
        [12.6, 57.85],
      ],
      '#57534e',
    )
    g += box(12.7, 57.2, 0.9, 0.6, 8, 'r')
    const [sx, sy] = p(14.9, 58.4)
    g += `<path d="M${n(sx - 14)} ${n(sy)}l24 -3l-3 5l-18 2z" fill="#292524"/>`
    for (const dx of [-8, 0, 6]) {
      g += `<line x1="${n(sx + dx)}" y1="${n(sy - 1)}" x2="${n(sx + dx)}" y2="${n(sy - 24)}" stroke="#a8a29e" stroke-width=".9"/>`
      g += `<path d="M${n(sx + dx - 4)} ${n(sy - 20)}h8l-1 10h-6z" fill="#f5f5f4" opacity=".85"/>`
    }
    const [cx, cy] = p(14.2, 57.4)
    g += `<g><line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - 30)}" stroke="#facc15" stroke-width="1.6"/><line x1="${n(cx)}" y1="${n(cy - 29)}" x2="${n(cx + 18)}" y2="${n(cy - 24)}" stroke="#facc15" stroke-width="1.6"/>`
    if (on('harbor')) {
      g += `<animateTransform attributeName="transform" type="rotate" values="0 ${n(cx)} ${n(cy)};16 ${n(cx)} ${n(cy)};0 ${n(cx)} ${n(cy)}" dur="5s" repeatCount="indefinite"/>`
    }
    g += `</g>`
    if (m.hasConflict) {
      g += glow(13.6, 57.5, 34, 'alarm')
      const [fx, fy] = p(13.2, 57.5, 8)
      g += smoke(fx, fy, '#f87171')
      g += beacon(fx, fy - 26, '#ef4444', '!', m.k)
    } else if (on('harbor')) {
      g += glow(13.6, 57.5, 22)
    }
    items.push({ depth: 57.2 + 12.7 + 3, svg: g })
  }
}

// ---- bridges, boats, traffic ----------------------------------------------

function bridge(a: [number, number], b: [number, number], towers: number[], color: string, isAlarm = false): string {
  const [x1, y1] = p(a[0], a[1], 4)
  const [x2, y2] = p(b[0], b[1], 4)
  let g = `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#94a3b8" stroke-width="2.4"/>`
  const tops: Pt[] = towers.map(t => {
    const x = x1 + (x2 - x1) * t
    const y = y1 + (y2 - y1) * t
    g += `<rect x="${n(x - 1.5)}" y="${n(y - 16)}" width="3" height="17" fill="#a8a29e"/>`
    return [x, y - 15]
  })
  const [t1, t2] = tops
  if (t1 && t2) {
    const midX = (t1[0] + t2[0]) / 2
    const midY = (t1[1] + t2[1]) / 2 + 12
    const stroke = isAlarm ? '#f87171' : color
    g += `<path d="M${n(x1)} ${n(y1)}L${n(t1[0])} ${n(t1[1])}Q${n(midX)} ${n(midY)} ${n(t2[0])} ${n(t2[1])}L${n(x2)} ${n(y2)}" fill="none" stroke="${stroke}" stroke-width="1">${isAlarm ? '<animate attributeName="opacity" values="1;.3;1" dur=".8s" repeatCount="indefinite"/>' : ''}</path>`
  }
  return g
}

function mover(path: string, dur: number, begin: number, shape: string): string {
  return `<g>${shape}<animateMotion path="${path}" dur="${n(dur)}s" begin="${n(begin)}s" repeatCount="indefinite"/></g>`
}

function line(a: [number, number], b: [number, number]): string {
  return `M${p(...a).map(n).join(',')} L${p(...b).map(n).join(',')}`
}

const TAXI = '<rect x="-2" y="-1.4" width="4" height="2.8" rx=".8" fill="#facc15"/>'
const CAR = '<rect x="-2" y="-1.4" width="4" height="2.8" rx=".8" fill="#e2e8f0"/>'

function traffic(): string {
  let g = ''
  const lanes: [[number, number], [number, number], number, string][] = [
    [[9, 0], [9, 56], 14, TAXI],
    [[7, 58], [7, 2], 16, TAXI],
    [[11, 4], [11, 52], 12, CAR],
    [[13, 48], [13, 16], 11, TAXI],
    [[3, 10], [3, 54], 15, CAR],
    [[15, 50], [15, 22], 10, TAXI],
    [[1, 50], [1, 22], 12, CAR],
  ]
  lanes.forEach(([a, b, dur, shape], i) => {
    g += mover(line(a, b), dur, -i * 2.3, shape)
    g += mover(line(a, b), dur, -i * 2.3 - dur / 2, shape)
  })
  // Boats and the Staten Island Ferry.
  const boat = (c: string) => `<path d="M-5 0l10 -1l-2 2.4h-7z" fill="${c}"/><rect x="-2" y="-3.6" width="3" height="2.4" fill="#f5f5f4"/>`
  g += mover(line([-2.2, 2], [-2.6, 58]), 40, 0, boat('#e2e8f0'))
  g += mover(line([18.6, 52], [16.8, 24]), 30, -6, boat('#e2e8f0'))
  g += mover(line([7.4, 64], [2, 76]), 18, 0, boat('#f97316'))
  return g
}

// How long each launch plays, in seconds.
const LAUNCH_SECONDS = { commit: 3.5, push: 9 }

// The Statue of Liberty: at rest, or mid-launch after a commit (a hop) or a
// push (liftoff, off the top of the map, and back). Each frame the page gets
// may land mid-launch, so every animation begins `elapsed` seconds in the
// past and carries on from there rather than starting over.
function statue(launch: Launch | undefined, now: number, hud: number): string {
  let g = poly(
    [
      [1.4, 69.4],
      [2.8, 69.4],
      [2.8, 70.6],
      [1.4, 70.6],
    ],
    '#1f5130',
  )
  const [x, y] = p(2.1, 70)
  const elapsed = launch ? (now - launch.at) / 1000 : Infinity
  const kind = launch && elapsed < LAUNCH_SECONDS[launch.kind] ? launch.kind : undefined
  const dur = kind ? LAUNCH_SECONDS[kind] : 0
  // An animation `at` seconds into the launch, lasting `len`.
  const t = (at: number, len: number, rest: string) => `begin="${n(at - elapsed)}s" dur="${n(len)}s" fill="freeze" ${rest}`

  // The figure, with its engine flame tucked under the robe.
  let figure = ''
  if (kind) {
    const flame = (rx: number, ry: number, color: string) =>
      `<ellipse cx="${n(x)}" cy="${n(y - 6 + ry * 0.6)}" rx="${rx}" ry="${ry}" fill="${color}"><animate attributeName="ry" values="${ry};${n(ry * 1.5)};${ry}" dur=".12s" repeatCount="indefinite"/></ellipse>`
    figure += `<g opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.85;1" ${t(kind === 'push' ? 0.3 : 0.5, kind === 'push' ? 4.4 : 1.2, '')}/>`
    figure += flame(3.2, kind === 'push' ? 9 : 5, '#f97316') + flame(1.8, kind === 'push' ? 6 : 3, '#fde047') + `</g>`
  }
  figure += `<path d="M${n(x - 2.4)} ${n(y - 8)}l1 -12h3l1 12z" fill="#5eada0"/>`
  figure += `<circle cx="${n(x)}" cy="${n(y - 21.5)}" r="1.8" fill="#5eada0"/>`
  figure += `<line x1="${n(x + 1.4)}" y1="${n(y - 19)}" x2="${n(x + 3)}" y2="${n(y - 27)}" stroke="#5eada0" stroke-width="1.2"/>`
  figure += `<circle cx="${n(x + 3)}" cy="${n(y - 28.5)}" r="1.8" fill="#fbbf24"><animate attributeName="r" values="1.6;2.4;1.6" dur="1.6s" repeatCount="indefinite"/></circle>`

  if (!kind || !launch) {
    g += `<rect x="${n(x - 3)}" y="${n(y - 8)}" width="6" height="8" fill="#a8a29e"/>` + figure
    return g
  }

  // Smoke billowing from the pad.
  for (let i = 0; i < (kind === 'push' ? 7 : 3); i++) {
    const dx = (i - 3) * 4
    g += `<circle cx="${n(x)}" cy="${n(y - 2)}" r="2" fill="#e2e8f0" opacity="0">`
    g += `<animate attributeName="cx" values="${n(x)};${n(x + dx * 2.2)}" ${t(0.3 + i * 0.12, 2.6, '')}/>`
    g += `<animate attributeName="r" values="2;${8 + (i % 3) * 3}" ${t(0.3 + i * 0.12, 2.6, '')}/>`
    g += `<animate attributeName="opacity" values="0;.85;0" ${t(0.3 + i * 0.12, 2.6, '')}/></circle>`
  }
  g += `<rect x="${n(x - 3)}" y="${n(y - 8)}" width="6" height="8" fill="#a8a29e"/>`

  let move: string
  if (kind === 'push') {
    const height = 560
    // Exhaust puffs left behind along the climb (it speeds up as it goes).
    for (let i = 0; i < 10; i++) {
      const at = 1.4 + i * 0.3
      const h = height * ((at - 1.2) / 3.3) ** 2
      g += `<circle cx="${n(x)}" cy="${n(y - 4 - h)}" r="2" fill="#cbd5e1" opacity="0">`
      g += `<animate attributeName="r" values="2;${7 + i}" ${t(at, 2.2, '')}/>`
      g += `<animate attributeName="opacity" values=".8;0" ${t(at, 2.2, '')}/></circle>`
    }
    move =
      `<animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,-${height};0,-${height};0,0;0,0" keyTimes="0;.133;.5;.77;.78;1" calcMode="spline" keySplines="0 0 1 1;.6 0 .9 .5;0 0 1 1;0 0 1 1;0 0 1 1" ${t(0, dur, '')}/>` +
      `<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;.49;.5;.78;1" ${t(0, dur, '')}/>`
  } else {
    move = `<animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,-16;0,0;0,0" keyTimes="0;.17;.31;.46;1" calcMode="spline" keySplines="0 0 1 1;.2 .6 .4 1;.6 0 .8 .4;0 0 1 1" ${t(0, dur, '')}/>`
  }
  // The rumble before it goes.
  const shake = `<animateTransform attributeName="transform" type="translate" additive="sum" values="0,0;-.8,0;.8,0;0,0" dur=".1s" begin="${n(-elapsed)}s" repeatDur="${kind === 'push' ? 1.2 : 0.6}s"/>`
  g += `<g>${move}${shake}${figure}</g>`

  // A caption saying who launched it, from which repository.
  const [cx, cy] = p(2.1, 70, kind === 'push' ? 70 : 44)
  const title = kind === 'push' ? '🚀 PUSHED' : '✓ COMMITTED'
  const where = launch.repo ? ` · ${launch.repo}` : ''
  g += `<g opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.06;.85;1" ${t(0, dur, '')}/>`
  g += `<text class="lbl" x="${n(cx + 12 * hud)}" y="${n(cy)}" font-size="${n(10 * hud)}" style="stroke-width:${n(3 * hud)}px;fill:${kind === 'push' ? '#fdba74' : '#86efac'}">${esc(title + where)}</text>`
  g += `<text class="lbl" x="${n(cx + 12 * hud)}" y="${n(cy + 12 * hud)}" font-size="${n(7.5 * hud)}" style="stroke-width:${n(2.6 * hud)}px">${esc(launch.who)}</text></g>`
  return g
}

// ---- agents ---------------------------------------------------------------

function figure(a: Agent, label: boolean, lift: number, k: number): string {
  const s = (a.isMain ? 1.3 : 1) * k
  const isWorking = a.status === 'working'
  let body = `<ellipse class="ring" cx="0" cy="0" rx="${n(9 * s)}" ry="${n(4.5 * s)}" fill="none" stroke="#fde047" stroke-width="${n(1.6 * k)}"/>`
  body += `<ellipse cx="0" cy="0" rx="${n(5 * s)}" ry="${n(2.5 * s)}" fill="#000" opacity=".4"/><g>`
  if (isWorking) {
    body += `<animateTransform attributeName="transform" type="translate" values="0,0;0,${n(-2.4 * s)};0,0" dur=".55s" repeatCount="indefinite"/>`
  }
  body += `<rect x="${n(-4 * s)}" y="${n(-13 * s)}" width="${n(8 * s)}" height="${n(10.5 * s)}" rx="${n(3.6 * s)}" fill="${a.color}" stroke="#0b1224" stroke-width="${n(0.8 * k)}"/>`
  body += `<circle cx="0" cy="${n(-16 * s)}" r="${n(3.7 * s)}" fill="#fef3c7" stroke="#0b1224" stroke-width="${n(0.8 * k)}"/>`
  if (a.isMain) {
    body += `<path d="M${n(-3.5 * s)} ${n(-19 * s)}v${n(-4.5 * s)}l${n(1.75 * s)} ${n(2.5 * s)}l${n(1.75 * s)} ${n(-3.5 * s)}l${n(1.75 * s)} ${n(3.5 * s)}l${n(1.75 * s)} ${n(-2.5 * s)}v${n(4.5 * s)}z" fill="#fde047" stroke="#0b1224" stroke-width="${n(0.6 * k)}"/>`
  }
  const badge = (fill: string, mark: string, ink: string, pulse: boolean) =>
    `<g>${pulse ? '<animate attributeName="opacity" values="1;.35;1" dur="1s" repeatCount="indefinite"/>' : ''}<circle cx="${n(8 * s)}" cy="${n(-26 * s)}" r="${n(5.5 * s)}" fill="${fill}" stroke="#fff" stroke-width="${n(1.2 * k)}"/><text x="${n(8 * s)}" y="${n(-23.2 * s)}" text-anchor="middle" font-size="${n(8 * s)}" font-weight="800" fill="${ink}">${mark}</text></g>`
  if (a.status === 'waiting') body += badge('#fbbf24', '?', '#111827', true)
  else if (a.status === 'failed') body += badge('#ef4444', '!', '#fff', false)
  body += `</g>`
  if (label) {
    const name = esc(a.name.length > 18 ? a.name.slice(0, 17) + '…' : a.name)
    body += `<text class="lbl" x="0" y="${n(-31 * s - lift * k)}" text-anchor="middle" font-size="${n((a.isMain ? 8.5 : 7.5) * k)}" style="stroke-width:${n(2.6 * k)}px">${name}</text>`
  }
  const tip = `<title>${esc(`${a.name} (${a.kind}) · ${a.status}${a.activity ? ' · ' + a.activity : ''}`)}</title>`
  return tip + body
}

// ---- views ----------------------------------------------------------------

type Frame = { x: number; y: number; w: number; h: number }

function rowsOf(view: View): [number, number] {
  return view === 'uptown' ? [-3, 36] : view === 'midtown' ? [33, 49] : view === 'downtown' ? [46, 66] : [-3, 71]
}

function frame(view: View, burbs: Burb[]): Frame {
  const [from, to] = rowsOf(view)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (let gy = from; gy <= to; gy += 0.5) {
    const [w, e] = edges(gy)
    for (const gx of [w - 1, e + 1]) {
      const [x, y] = p(gx, gy)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  // The harbor, Liberty Island and the bay below the Battery.
  if (view === 'island' || view === 'downtown') {
    for (const [gx, gy] of [
      [0.5, 71],
      // Room below Liberty Island, so the statue's pad and smoke show.
      [3.5, 71.5],
      [12, 67],
    ] as const) {
      const [x, y] = p(gx, gy)
      x0 = Math.min(x0, x - 30)
      y1 = Math.max(y1, y)
    }
  }
  // Every borough in use, on the whole-island view.
  if (view === 'island') {
    for (const b of burbs) {
      const [cx, cy] = BURBS[b].center
      for (const [gx, gy] of [
        [cx - 3.5, cy + 3.5],
        [cx + 3.5, cy - 3.5],
        [cx + 3.5, cy + 3.5],
      ] as const) {
        const [x, y] = p(gx, gy)
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
  }
  const head = view === 'uptown' ? 60 : 110
  const pad = view === 'island' ? 20 : 14
  return { x: x0 - pad, y: y0 - head, w: x1 - x0 + pad * 2, h: y1 - y0 + head + pad }
}

const HOODS: [string, number, number][] = [
  ['INWOOD', 8, 0.5],
  ['WASHINGTON HEIGHTS', 8, 7],
  ['HARLEM', 8.5, 16],
  ['UPPER WEST SIDE', 3, 28],
  ['UPPER EAST SIDE', 12.4, 29],
  ['MIDTOWN', 14.5, 37],
  ['CHELSEA', 2.4, 45.5],
  ['GREENWICH VILLAGE', 4.5, 49.5],
  ['EAST VILLAGE', 15, 48.5],
  ['SOHO', 7.5, 52.5],
  ['TRIBECA', 3.6, 54.5],
  ['FINANCIAL DISTRICT', 8.5, 60.5],
]

// ---- the whole city -------------------------------------------------------

export function renderCity(world: World, now: number, opts: { animateWalks: boolean; view: View }): string {
  const visible = world.agents.filter(a => a.status !== 'done' || now - a.updatedAt < 90_000)
  // Manhattan's agents by district; the others by borough.
  const byDistrict = new Map<District, Agent[]>()
  const byBurb = new Map<Burb, Agent[]>()
  for (const a of visible) {
    if (a.burb) {
      byBurb.set(a.burb, [...(byBurb.get(a.burb) ?? []), a])
    } else {
      byDistrict.set(a.at, [...(byDistrict.get(a.at) ?? []), a])
    }
  }
  const active = new Set<District>()
  for (const [d, list] of byDistrict) if (list.some(a => a.status === 'working')) active.add(d)
  const hasConflict = world.conflicts.length > 0
  const isWaiting = world.asks.length > 0
  const repoOf = new Map(world.repos.map(r => [r.burb, r]))

  const vb = frame(opts.view, [...repoOf.keys()])
  // How much bigger agents and text draw, so they read at any zoom.
  const k = Math.max(0.8, Math.min(1.7, vb.w / 520))
  // Text keeps one size on screen whatever the zoom.
  const hud = vb.w / 680
  const isWhole = opts.view === 'island'
  // Drawn wide; the pane scales it to fit.
  const width = 900

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" width="${width}" height="${Math.round((width * vb.h) / vb.w)}" font-family="ui-sans-serif, system-ui, Segoe UI, sans-serif">`
  s += defs()
  s += `<rect x="${n(vb.x - 50)}" y="${n(vb.y - 50)}" width="${n(vb.w + 100)}" height="${n(vb.h + 100)}" fill="url(#sea)"/>`

  // Land: New Jersey, the Bronx, Queens, Brooklyn and the small islands, each
  // a shore under its top.
  const land = (shape: [number, number][], top: string) => {
    const shifted = shape.map(([gx, gy]) => p(gx, gy)).map(([x, y]) => [x, y + 3] as Pt)
    s += `<polygon points="${pts(shifted)}" fill="#0d1a14"/>`
    s += poly(shape, top)
  }
  land(NEW_JERSEY, '#17251d')
  land(BRONX, '#17251d')
  land(QUEENS, '#17251d')
  land(BROOKLYN, '#17251d')
  land(ROOSEVELT, '#1d3326')
  land(RANDALLS, '#1d3326')
  land(GOVERNORS, '#1d3326')
  // Lights across the boroughs.
  for (let i = 0; i < 70; i++) {
    const r1 = seeded(i, 91)
    const r2 = seeded(91, i)
    const [gx, gy] =
      i % 3 === 0 ? [-14 + r1 * 9, -6 + r2 * 64] : i % 3 === 1 ? [22 + r1 * 14, 20 + r2 * 60] : [16 + r1 * 20, -10 + r2 * 24]
    const [x, y] = p(gx, gy)
    s += `<circle cx="${n(x)}" cy="${n(y)}" r=".9" fill="#fcd581" opacity="${n(0.25 + r1 * 0.5)}"/>`
  }

  // Manhattan.
  const shore = ISLAND.map(([gx, gy]) => p(gx, gy)).map(([x, y]) => [x, y + 5] as Pt)
  s += `<polygon points="${pts(shore)}" fill="#0f172a"/>`
  s += poly(ISLAND, '#262a36')
  // Avenues glow faintly, from where each meets the shore to where it leaves.
  for (let x = 1; x < 18; x += 2) {
    let first: number | undefined
    let last: number | undefined
    for (let y = -2.5; y <= 62.5; y += 0.25) {
      const [w, e] = edges(y)
      if (x > w + 0.1 && x < e - 0.1) {
        first ??= y
        last = y
      }
    }
    if (first !== undefined && last !== undefined) {
      const [ax, ay] = p(x, first)
      const [bx, by] = p(x, last)
      s += `<line x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}" stroke="#4b4128" stroke-width="1.4" opacity=".7"/>`
    }
  }

  // Bridges.
  s += bridge([edges(4.5)[0], 4.5], [edges(4.5)[0] - 5.2, 4.5], [0.12, 0.88], '#cbd5e1') // George Washington
  s += bridge([edges(34.5)[1], 34.5], [19.2, 34.5], [0.3, 0.75], '#94a3b8') // Queensboro
  s += bridge([edges(50.5)[1], 50.5], [21.4, 50.5], [0.25, 0.75], '#94a3b8') // Williamsburg
  s += bridge([edges(54)[1], 54], [20.5, 54], [0.2, 0.8], '#94a3b8') // Manhattan
  s += bridge([14.4, 56], [19.8, 56.2], [0.22, 0.8], '#e2e8f0', hasConflict) // Brooklyn
  s += bridge([12.9, 11], [14.6, 11], [], '#94a3b8') // Third Avenue, to the Bronx
  {
    // The ferry to Jersey City.
    const [x1, y1] = p(0.4, 39)
    const [x2, y2] = p(-4.8, 39)
    s += `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#7aa2d6" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`
  }

  // A borough for each repository in use besides the session's own.
  for (const [b, repo] of repoOf) {
    s += burb(b, repo, (byBurb.get(b) ?? []).some(a => a.status === 'working'), hud)
  }

  // Buildings and landmarks, back to front.
  const items: Item[] = []
  // Only the blocks in view, with a margin for towers that lean in.
  const [from, to] = rowsOf(opts.view)
  fabric(items, [from - 6, to + 4])
  landmarks(items, { active, hasConflict, isWaiting, k })
  items.sort((a, b) => a.depth - b.depth)
  s += items.map(i => i.svg).join('')
  s += statue(world.launch, now, hud)
  s += traffic()

  // Names on the map.
  for (const [name, gx, gy] of HOODS) {
    const [x, y] = p(gx, gy)
    s += `<text class="hood" x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="${n(7 * hud)}">${name}</text>`
  }
  const water: [string, number, number][] = [
    ['HUDSON RIVER', -2.4, 24],
    ['EAST RIVER', 18.2, 42],
    ['UPPER BAY', 4, 67],
  ]
  for (const [name, gx, gy] of water) {
    const [x, y] = p(gx, gy)
    s += `<text class="water" x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="${n(6.5 * hud)}" transform="rotate(-26.6 ${n(x)} ${n(y)})">${name}</text>`
  }
  const boroughs: [string, number, number, Burb][] = [
    ['NEW JERSEY', -11, 28, 'jersey'],
    ['THE BRONX', 20, 4, 'bronx'],
    ['QUEENS', 25, 30, 'queens'],
    ['BROOKLYN', 25, 58, 'brooklyn'],
  ]
  for (const [name, gx, gy, b] of boroughs) {
    if (repoOf.has(b)) continue
    const [x, y] = p(gx, gy)
    s += `<text class="hood" x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="${n(8 * hud)}">${name}</text>`
  }
  for (const d of Object.keys(SITES) as District[]) {
    const busy = byDistrict.has(d)
    // Midtown's names crowd each other at this scale: its zoom shows them.
    const isMidtown = d !== 'hall' && d !== 'harbor' && d !== 'plaza'
    if (isWhole && (isMidtown || (!busy && d === 'harbor'))) continue
    const [gx, gy, z] = SITES[d].label
    const [x, y] = p(gx, gy, z)
    s += `<text class="lbl" x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="${n(9 * hud)}" style="stroke-width:${n(3 * hud)}px;fill:${active.has(d) ? '#fde68a' : '#e2e8f0'}">${LABELS[d].toUpperCase()}</text>`
  }

  // Agents, always on top so no tower hides one.
  const placed: { a: Agent; at: [number, number]; i: number }[] = []
  for (const [d, list] of byDistrict) list.forEach((a, i) => placed.push({ a, at: standAt(d, i), i }))
  for (const [b, list] of byBurb) list.forEach((a, i) => placed.push({ a, at: burbAt(b, i), i }))
  placed.sort((x, y) => x.at[0] + x.at[1] - (y.at[0] + y.at[1]))
  const crowd = isWhole || placed.length > 8
  for (const { a, at, i } of placed) {
    const fade = a.status === 'done' ? ` opacity=".6"` : ''
    const alert = a.status === 'waiting' || a.status === 'failed'
    // The lead of a borough shares the repo's name, which is already on the sign.
    const dup = !!a.burb && a.name.toLowerCase() === repoOf.get(a.burb)?.name.toLowerCase()
    const label = (a.isMain || !crowd || alert) && (!dup || alert)
    const who = ` class="agent" data-agent="${esc(a.id)}" data-session="${esc(a.session)}"`
    const lift = (i % 2) * 9
    const moved = a.walkFrom && (a.walkFrom.at !== a.at || a.walkFrom.burb !== a.burb)
    if (opts.animateWalks && a.walkFrom && moved) {
      const { path, dur } = walk(a.walkFrom, { at: a.at, burb: a.burb }, at)
      s += `<g${who}${fade}><animateMotion path="${path}" dur="${n(dur)}s" fill="freeze"/>${figure(a, label, lift, k)}</g>`
    } else {
      const [x, y] = p(at[0], at[1])
      s += `<g${who} transform="translate(${n(x)},${n(y)})"${fade}>${figure(a, label, lift, k)}</g>`
    }
  }

  // Header and alerts, pinned to the view's corners.
  const working = visible.filter(a => a.status === 'working').length
  const subs = world.agents.filter(a => !a.isMain && a.status !== 'done' && a.status !== 'failed').length
  const hx = vb.x + 12 * hud
  s += `<text x="${n(hx)}" y="${n(vb.y + 22 * hud)}" font-size="${n(13 * hud)}" font-weight="800" letter-spacing="2" fill="#f5f3ff">AGENT CITY <tspan font-weight="500" fill="#a5b4fc" font-size="${n(8 * hud)}">MANHATTAN · ${esc(world.home.toUpperCase())}</tspan></text>`
  s += `<text x="${n(hx)}" y="${n(vb.y + 36 * hud)}" font-size="${n(8.5 * hud)}" fill="#c4b5fd">${world.sessions.length} session${world.sessions.length === 1 ? '' : 's'} · ${working} working · ${subs} subagent${subs === 1 ? '' : 's'} out</text>`
  let ay = vb.y + 20 * hud
  const alert = (text: string, color: string) => {
    const w = 170 * hud
    const x = vb.x + vb.w - w - 10 * hud
    s += `<g><rect x="${n(x)}" y="${n(ay - 12 * hud)}" width="${n(w)}" height="${n(18 * hud)}" rx="${n(9 * hud)}" fill="${color}"/><text x="${n(x + w / 2)}" y="${n(ay + 1 * hud)}" text-anchor="middle" font-size="${n(8.5 * hud)}" font-weight="700" fill="#111827">${esc(text)}</text><animate attributeName="opacity" values="1;.6;1" dur="1.4s" repeatCount="indefinite"/></g>`
    ay += 23 * hud
  }
  if (hasConflict) {
    const c = world.conflicts.length
    alert(`⚠ ${c} merge conflict${c === 1 ? '' : 's'} at the Seaport`, '#f87171')
  }
  if (isWaiting) alert(`? ${world.asks.length} waiting at City Hall`, '#fbbf24')

  s += `</svg>`
  return s
}
