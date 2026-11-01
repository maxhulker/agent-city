import type { Burb, District, Launch, Repo, World } from '../types.ts'
import { ACCENT, BRONX, BROOKLYN, BURBS, GOVERNORS, ISLAND, LABELS, MIDTOWN, NEW_JERSEY, QUEENS, RANDALLS, ROOSEVELT, S, SITES, T, edges, esc, frame, isReserved, n, p, padOf, poly, pts, r, seeded } from './geo.ts'
import type { Pt, Scene } from './geo.ts'

// The city itself: water, land, streets, buildings, landmarks, bridges, traffic
// and the Statue of Liberty.

// ---- palettes -------------------------------------------------------------

export type Pal = 'g' | 's' | 'b' | 'r' | 'k'

export const PALETTES: Record<Pal, [string, string, string]> = {
  // left face, right face, roof
  g: ['#1d3557', '#13253f', '#31507a'],
  s: ['#7d7368', '#57504a', '#a39a8f'],
  b: ['#6e4127', '#4d2c19', '#91593a'],
  r: ['#7f3324', '#5a2318', '#a3483a'],
  k: ['#4b5563', '#343b46', '#6b7280'],
}

const DISTRICTS = Object.keys(SITES) as District[]

// Text and sprites keep their size on screen as the page zooms: it sets --zt
// (1/zoom) and --zs on the svg, and z2/z4 once zoomed in that far.
const STYLE =
  `.ring{display:none}` +
  `.lbl,.sign,.cap{font-weight:700;fill:#e2e8f0;paint-order:stroke;stroke:#0b1224;stroke-linejoin:round}` +
  `.lbl{font-size:calc(9px*var(--zt,1));stroke-width:calc(3px*var(--zt,1));letter-spacing:.06em}` +
  `.lbl.on{font-size:calc(10.5px*var(--zt,1));stroke-width:calc(3.4px*var(--zt,1))}` +
  `.hood{font-size:calc(7px*var(--zt,1));font-weight:600;letter-spacing:.18em;fill:#cbd5e1;opacity:.45}` +
  `.hood.big{font-size:calc(8px*var(--zt,1))}` +
  `.water{font-size:calc(6.5px*var(--zt,1));font-style:italic;letter-spacing:.3em;fill:#7aa2d6;opacity:.6}` +
  `.sign,.cap{font-size:calc(10px*var(--zt,1));stroke-width:calc(3px*var(--zt,1));letter-spacing:.04em}` +
  `.sign.sb{font-size:calc(7px*var(--zt,1));stroke-width:calc(2.4px*var(--zt,1));letter-spacing:.22em;fill:#94a3b8}` +
  `.cap.sb{font-size:calc(7.5px*var(--zt,1));stroke-width:calc(2.6px*var(--zt,1))}` +
  `.city:not(.z2) .minor{display:none}` +
  `.spr{transform:scale(var(--zs,1));transform-box:fill-box;transform-origin:center}` +
  `.road{fill:none;stroke:#191d26}.st{stroke-width:2.2px}.av{stroke-width:3.4px}` +
  `.cl{fill:none;stroke:#6b5a2e;stroke-width:.5px;stroke-dasharray:3 4;opacity:.55}` +
  `.lamp,.lamph{fill:none;stroke-linecap:round;stroke-dasharray:0 5.59}` +
  `.lamp{stroke:#ffe6a8;stroke-width:1.1px}.lamph{stroke:#ffb347;stroke-width:3.6px;opacity:.15}` +
  `.zebra{fill:none;stroke:#cbd5e1;stroke-width:1.1px;stroke-dasharray:.5 .5;opacity:.4}` +
  `.scaf{fill:none;stroke:#cdb27a;stroke-width:.45px}.plank{fill:none;stroke:#a16207;stroke-width:1px}` +
  `.refl{fill:none;stroke-linecap:round}` +
  `.glow,.sky{pointer-events:none}.city.z4 .haze{opacity:.18}`

export function defs(): string {
  let d = '<defs>'
  d += `<linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#081226"/><stop offset="1" stop-color="#12284a"/></linearGradient>`
  d += `<radialGradient id="halo"><stop offset="0" stop-color="#fde68a" stop-opacity=".55"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>`
  d += `<radialGradient id="alarm"><stop offset="0" stop-color="#ef4444" stop-opacity=".7"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></radialGradient>`
  // A pool of light in each district's colour.
  for (const k of DISTRICTS) {
    d += `<radialGradient id="p-${k}"><stop offset="0" stop-color="${ACCENT[k]}" stop-opacity=".6"/><stop offset=".55" stop-color="${ACCENT[k]}" stop-opacity=".2"/><stop offset="1" stop-color="${ACCENT[k]}" stop-opacity="0"/></radialGradient>`
  }
  d += `<radialGradient id="moon" cx=".38" cy=".36"><stop offset="0" stop-color="#fffdf2"/><stop offset=".75" stop-color="#f1e6c4"/><stop offset="1" stop-color="#d8c89a"/></radialGradient>`
  d += `<radialGradient id="mhalo"><stop offset="0" stop-color="#fef3c7" stop-opacity=".28"/><stop offset=".35" stop-color="#fef3c7" stop-opacity=".08"/><stop offset="1" stop-color="#fef3c7" stop-opacity="0"/></radialGradient>`
  d += `<radialGradient id="sky"><stop offset="0" stop-color="#ffb066" stop-opacity=".16"/><stop offset=".6" stop-color="#ff9a4d" stop-opacity=".05"/><stop offset="1" stop-color="#ff9a4d" stop-opacity="0"/></radialGradient>`
  // Ripples catching the light, over all the water.
  d += `<pattern id="rip" width="46" height="23" patternUnits="userSpaceOnUse"><path d="M4 5h7M26 3h5M15 12h9M36 15h6M6 19h5M30 21h4" stroke="#a5c8f5" stroke-width=".6" opacity=".2"/></pattern>`
  for (const [k, [l, r]] of Object.entries(PALETTES)) {
    // Lit windows, skewed to lie flat on each face.
    for (const [side, base, skew] of [
      ['L', l, 26.565],
      ['R', r, -26.565],
    ] as const) {
      d += `<pattern id="${k}${side}" width="4" height="5" patternUnits="userSpaceOnUse" patternTransform="skewY(${skew})"><rect width="4" height="5" fill="${base}"/><rect x="1" y="1.4" width="1.6" height="1.8" fill="#fcd581" opacity="${side === 'L' ? 0.75 : 0.45}"/></pattern>`
    }
  }
  // Rooftop furniture, placed with <use>.
  d += `<g id="wt"><path d="M-1.3 0v-2.4M1.3 0v-2.4M0 0v-2.4" stroke="#3b2a1c" stroke-width=".45"/><rect x="-1.7" y="-6.4" width="3.4" height="4.2" rx=".5" fill="#7a4a26"/><path d="M-1.7 -5.2h3.4M-1.7 -3.8h3.4" stroke="#55331b" stroke-width=".35"/><path d="M-2 -6.3L0 -8.8L2 -6.3z" fill="#4a3426"/></g>`
  d += `<g id="ant"><path d="M0 0v-11M-1.2 -4h2.4" stroke="#94a3b8" stroke-width=".6"/><circle cy="-11" r=".9" fill="#f87171"/></g>`
  d += `<g id="ac"><path d="M-2 0l2 1l2 -1l-2 -1z" fill="#9ca3af"/><path d="M-2 0v-1.4l2 -1l2 1v1.4l-2 1z" fill="#6b7280" opacity=".8"/></g>`
  d += '</defs><style>'
  for (const [k, [, , top]] of Object.entries(PALETTES)) {
    d += `.${k}L{fill:url(#${k}L)}.${k}R{fill:url(#${k}R)}.${k}T{fill:${top}}`
  }
  d += STYLE + '</style>'
  return d
}

// A box on the grid: footprint gx [x0, x0+w], gy [y0, y0+d], h tall, from z.
export function box(x0: number, y0: number, w: number, d: number, h: number, pal: Pal, z = 0): string {
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

// A plain box in three given colours, for things without windows.
function slab(x0: number, y0: number, w: number, d: number, h: number, [cl, cr, ct]: [string, string, string], z = 0): string {
  const a = p(x0, y0 + d, z)
  const b = p(x0 + w, y0 + d, z)
  const c = p(x0 + w, y0, z)
  const e = p(x0, y0, z)
  const up = ([x, y]: Pt): Pt => [x, y - h]
  return (
    `<polygon points="${pts([a, b, up(b), up(a)])}" fill="${cl}"/>` +
    `<polygon points="${pts([b, c, up(c), up(b)])}" fill="${cr}"/>` +
    `<polygon points="${pts([up(a), up(b), up(c), up(e)])}" fill="${ct}"/>`
  )
}

// A flat shape on a wall: corners as [gx, gy, z].
function face(list: [number, number, number][], fill: string, extra = '', inner = ''): string {
  const head = `<polygon points="${pts(list.map(([gx, gy, z]) => p(gx, gy, z)))}" fill="${fill}"${extra}`
  return inner ? `${head}>${inner}</polygon>` : `${head}/>`
}

// Ground shapes are drawn in grid units inside this, so a circle lies flat.
const GRID = '<g transform="matrix(10 5 -10 5 0 0)">'

function gRect(x0: number, y0: number, x1: number, y1: number, fill: string, extra = ''): string {
  return `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="${fill}"${extra}/>`
}

// Blend two #rrggbb colours.
function mix(a: string, b: string, t: number): string {
  const c = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(c(a, i) * (1 - t) + c(b, i) * t).toString(16).padStart(2, '0')).join('')
}

const xy = ([x, y]: Pt) => `${n(x)} ${n(y)}`

// ---- effects --------------------------------------------------------------

// A bobbing "!" or "?" marker, the mark drawn as shapes rather than text.
// The outer group keeps its size on screen as the page zooms, around its
// own centre.
const MARKS: Record<string, string> = {
  '!': '<rect x="-1.3" y="-6" width="2.6" height="7.2" rx="1.2" fill="#fff"/><circle cy="4" r="1.5" fill="#fff"/>',
  '?': '<path d="M-3 -2.6a3.1 3.1 0 1 1 4.4 2.8q-1.4 .7-1.4 2.2" fill="none" stroke="#111827" stroke-width="2.3" stroke-linecap="round"/><circle cy="5" r="1.4" fill="#111827"/>',
}

export function beacon(x: number, y: number, color: string, mark: string, k: number): string {
  return (
    `<g class="spr"><g><animateTransform attributeName="transform" type="translate" values="0,0;0,${n(-4 * k)};0,0" dur="1s" repeatCount="indefinite"/>` +
    `<circle cx="${n(x)}" cy="${n(y)}" r="${n(9 * k)}" fill="${color}" stroke="#fff" stroke-width="${n(1.6 * k)}"/>` +
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(k)})">${MARKS[mark] ?? ''}</g></g></g>`
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
  return `<ellipse class="glow" cx="${n(x)}" cy="${n(y)}" rx="${n(r * 2)}" ry="${n(r)}" fill="url(#${id})"/>`
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

// A warm street lamp with its pool of light, at ground level.
function lamp(gx: number, gy: number): string {
  const [x, y] = p(gx, gy)
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="5" ry="2.5" fill="#ffd27a" opacity=".18"/><path d="M${n(x)} ${n(y)}v-5" stroke="#475569" stroke-width=".5"/><circle cx="${n(x)}" cy="${n(y - 5)}" r=".9" fill="#ffe9b0"/>`
}

// Scaffolding hugging a box's two visible walls, a hoist running up its side
// and a tower crane slewing on the roof: someone is editing in there.
function scaffold(x0: number, y0: number, w: number, d: number, h: number): string {
  const o = 0.09
  const fy = y0 + d + o // the south wall, stood off a little
  const fx = x0 + w + o // the east wall
  const top = h + 3
  const at = (gx: number, gy: number, z: number) => xy(p(gx, gy, z))
  const levels = Math.max(2, Math.round(top / 5.5))
  const nx = Math.max(2, Math.round((w + 2 * o) / 0.32))
  const ny = Math.max(1, Math.round((d + 2 * o) / 0.32))
  let poles = ''
  let planks = ''
  const xs: number[] = []
  for (let i = 0; i <= nx; i++) xs.push(x0 - o + ((w + 2 * o) * i) / nx)
  const ys: number[] = []
  for (let i = 0; i < ny; i++) ys.push(y0 - o + ((d + 2 * o) * i) / ny)
  for (const gx of xs) poles += `M${at(gx, fy, 0)}V${n(p(gx, fy, top)[1])}`
  for (const gy of ys) poles += `M${at(fx, gy, 0)}V${n(p(fx, gy, top)[1])}`
  for (let k = 1; k <= levels; k++) {
    const z = (top * k) / levels
    planks += `M${at(x0 - o, fy, z)}L${at(fx, fy, z)}L${at(fx, y0 - o, z)}`
    // Cross braces in every other bay.
    const z0 = (top * (k - 1)) / levels
    for (let i = (k % 2); i < nx; i += 2) poles += `M${at(xs[i]!, fy, z0)}L${at(xs[i + 1]!, fy, z)}`
  }
  let g = `<path class="scaf" d="${poles}"/><path class="plank" d="${planks}"/>`
  // Debris netting over the lower floors.
  g += face(
    [
      [x0 - o, fy, 0],
      [fx, fy, 0],
      [fx, fy, top * 0.4],
      [x0 - o, fy, top * 0.4],
    ],
    '#22c55e',
    ' opacity=".14"',
  )
  // The hoist cage, up and down the east wall.
  const [hx, hy] = p(fx, y0 + d * 0.45)
  g += `<path d="M${n(hx)} ${n(hy)}v-${n(top)}" stroke="#94a3b8" stroke-width=".7"/>`
  g += `<rect x="${n(hx - 1.4)}" y="${n(hy - 3.4)}" width="2.8" height="3" fill="#f59e0b"><animateTransform attributeName="transform" type="translate" values="0,0;0,-${n(top * 0.8)};0,-${n(top * 0.8)};0,0" keyTimes="0;.45;.6;1" dur="7s" repeatCount="indefinite"/></rect>`
  // The crane: a mast on the roof, a jib that swings round, a hook.
  const [mx, my] = p(x0 + w * 0.35, y0 + d * 0.5, h)
  const mt = my - 26
  g += `<path d="M${n(mx - 0.9)} ${n(my)}v-26M${n(mx + 0.9)} ${n(my)}v-26" stroke="#eab308" stroke-width=".6"/>`
  g += `<rect x="${n(mx - 4)}" y="${n(mt - 1.8)}" width="4" height="2.4" fill="#78716c"/>`
  const sweep = (a: number, b: number) => `values="${n(mx + a)};${n(mx + b)};${n(mx + a)}" dur="14s" repeatCount="indefinite"`
  g += `<line x1="${n(mx - 6)}" y1="${n(mt)}" x2="${n(mx + 24)}" y2="${n(mt)}" stroke="#facc15" stroke-width="1.2"><animate attributeName="x2" ${sweep(24, -14)}/></line>`
  g += `<line x1="${n(mx + 18)}" y1="${n(mt)}" x2="${n(mx + 18)}" y2="${n(mt + 12)}" stroke="#cbd5e1" stroke-width=".35"><animate attributeName="x1" ${sweep(18, -10)}/><animate attributeName="x2" ${sweep(18, -10)}/></line>`
  g += `<circle cx="${n(mx)}" cy="${n(mt - 2.4)}" r=".9" fill="#f87171"><animate attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite"/></circle>`
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

export type Item = { depth: number; svg: string }

// Ground to keep in view: [gx0, gy0, gx1, gy1, how much of it may hide].
type Keep = [number, number, number, number, number]

// Where each district's agents mostly stand, and the low landmarks behind
// them, which the buildings in front must not hide (the landmarks' lower half
// may go).
function keeps(): Keep[] {
  const list: Keep[] = DISTRICTS.filter(d => d !== 'plaza').map(d => {
    const [sx, sy] = SITES[d].spot
    return [sx - 0.9, sy - 0.1, sx + 0.9, padOf(d)[3] - 0.1, 1] as Keep
  })
  list.push(
    [5.9, 27.4, 8.1, 30.3, 1], // the Great Lawn
    [8.0, 55.3, 9.25, 55.7, 5], // City Hall
    [7.25, 39.2, 8.75, 39.8, 6], // the Library
    [9.35, 39.22, 11.75, 39.78, 6], // Grand Central
    [12.7, 57.2, 14.65, 57.8, 4], // the Seaport
  )
  return list
}

// How tall a building can stand before it hides a district's plaza behind it:
// compare depths (gx + gy) along each screen column (gx - gy) the two share.
function capFor(x0: number, y0: number, w: number, d: number, keep: Keep[]): number {
  let cap = Infinity
  for (const [px0, py0, px1, py1, slack] of keep) {
    const lo = Math.max(x0 - y0 - d, px0 - py1)
    const hi = Math.min(x0 + w - y0, px1 - py0)
    if (lo >= hi) continue
    for (let k = 0; k <= 4; k++) {
      const u = lo + ((hi - lo) * k) / 4
      const back = 2 * Math.max(x0, y0 + u) - u
      const front = 2 * Math.min(px1, py1 + u) - u
      if (back > front) cap = Math.min(cap, (back - front) * T + slack)
    }
  }
  return cap
}

function building(items: Item[], x0: number, y0: number, w: number, d: number, h: number, pal: Pal, q: number, keep: Keep[]) {
  h = Math.min(h, Math.max(3, capFor(x0, y0, w, d, keep)))
  let svg: string
  let roof = h
  let rx = x0 + w / 2
  let ry = y0 + d / 2
  if (pal === 'g' && h > 40 && q > 0.45) {
    // A setback tower: a broad base, a slimmer top.
    const base = Math.round(h * 0.68)
    svg = box(x0, y0, w, d, base, pal) + box(x0 + w * 0.18, y0 + d * 0.18, w * 0.64, d * 0.64, h - base, pal, base)
  } else {
    svg = box(x0, y0, w, d, h, pal)
  }
  // Rooftops: water towers on the older blocks, masts on the towers.
  const t = seeded(x0 * 3.1, y0 * 7.3)
  if (pal !== 'g' && h < 40 && w > 0.5 && t < 0.06) {
    rx = x0 + w * (0.3 + t * 4)
    svg += `<use href="#wt" x="${n(p(rx, ry, roof)[0])}" y="${n(p(rx, ry, roof)[1])}"/>`
  } else if (pal === 'g' && h > 46 && t > 0.62) {
    svg += `<use href="#ant" x="${n(p(rx, ry, roof)[0])}" y="${n(p(rx, ry, roof)[1])}"/>`
  } else if (h > 12 && t > 0.4 && t < 0.46) {
    svg += `<use href="#ac" x="${n(p(rx, ry, roof)[0])}" y="${n(p(rx, ry, roof)[1])}"/>`
  }
  items.push({ depth: x0 + y0 + 0.82, svg })
}

function fabric(items: Item[]) {
  const keep = keeps()
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
      const q = seeded(x, y)
      const y0 = y + 0.18
      const d = 0.64
      // Two buildings on wide lots, for a ragged skyline.
      if (x1 - x0 > 1.2 && q > 0.6) {
        const cut = x0 + (x1 - x0) * (0.4 + q * 0.2)
        const q2 = seeded(y, x)
        const h1 = heightAt(x0, y, q)
        const h2 = heightAt(cut, y, q2)
        building(items, x0, y0, cut - x0 - 0.06, d, h1, palAt(y, h1, q), q, keep)
        building(items, cut + 0.06, y0, x1 - cut - 0.06, d, h2, palAt(y, h2, q2), q2, keep)
      } else {
        const h = heightAt(x0, y, q)
        building(items, x0, y0, x1 - x0, d, h, palAt(y, h, q), q, keep)
      }
    }
  }
}

// Streets and avenues on the sidewalk-grey island, lamps along the avenues,
// zebra crossings at the big intersections.
function streets(): string {
  let st = ''
  let av = ''
  let lamps = ''
  let zebra = ''
  for (let y = -2; y <= 63; y++) {
    const [w, e] = edges(y)
    if (e - w < 0.8) continue
    st += `M${xy(p(w + 0.05, y))}L${xy(p(e - 0.05, y))}`
  }
  const span: Record<number, [number, number]> = {}
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
    if (first === undefined || last === undefined) continue
    span[x] = [first, last]
    av += `M${xy(p(x, first))}L${xy(p(x, last))}`
    const a = Math.ceil((first + 0.1) * 2) / 2 + 0.25
    for (const side of [-0.24, 0.24]) lamps += `M${xy(p(x + side, a))}L${xy(p(x + side, last - 0.1))}`
  }
  const crossings = [14, 20, 28, 35, 38, 40, 42, 47, 52, 56, 58]
  for (const y of crossings) {
    for (let x = 1; x < 18; x += 2) {
      const s = span[x]
      if (!s || y < s[0] + 0.5 || y > s[1] - 0.5) continue
      if (x > 4 && x < 10 && y > 21 && y < 35) continue // inside Central Park
      zebra += `M${xy(p(x - 0.17, y - 0.19))}L${xy(p(x + 0.17, y - 0.19))}M${xy(p(x - 0.17, y + 0.19))}L${xy(p(x + 0.17, y + 0.19))}`
      zebra += `M${xy(p(x - 0.27, y - 0.1))}L${xy(p(x - 0.27, y + 0.1))}M${xy(p(x + 0.27, y - 0.1))}L${xy(p(x + 0.27, y + 0.1))}`
    }
  }
  return (
    `<path class="road st" d="${st}"/><path class="road av" d="${av}"/><path class="cl" d="${av}"/>` +
    `<path class="zebra" d="${zebra}"/><path class="lamph" d="${lamps}"/><path class="lamp" d="${lamps}"/>`
  )
}

// ---- districts ------------------------------------------------------------

// The lit ground where each district's agents stand, in its own colour.
function pads(sc: Scene): string {
  let glows = ''
  let g = GRID
  for (const d of DISTRICTS) {
    const on = sc.active.has(d)
    const c = ACCENT[d]
    const [x0, y0, x1, y1] = padOf(d)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    if (d === 'plaza') {
      // The Great Lawn itself is the pad.
      g += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n((x1 - x0) / 2)}" ry="${n((y1 - y0) / 2)}" fill="#2d7040" stroke="${c}" stroke-width=".07" stroke-opacity="${on ? 0.9 : 0.5}"/>`
    } else {
      g += `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" rx=".22" fill="${c}" fill-opacity="${on ? 0.3 : 0.17}" stroke="${c}" stroke-width=".06" stroke-opacity="${on ? 0.95 : 0.55}"/>`
      if (on) {
        g += `<rect x="${n(x0 + 0.12)}" y="${n(y0 + 0.08)}" width="${n(x1 - x0 - 0.24)}" height="${n(y1 - y0 - 0.16)}" rx=".16" fill="none" stroke="${c}" stroke-width=".04"><animate attributeName="opacity" values=".2;1;.2" dur="1.6s" repeatCount="indefinite"/></rect>`
      }
    }
    const [x, y] = p(cx, cy)
    const rad = d === 'plaza' ? 30 : 22
    glows += `<ellipse class="glow" cx="${n(x)}" cy="${n(y)}" rx="${n(rad * 2)}" ry="${n(rad)}" fill="url(#p-${d})" opacity="${on ? 1 : 0.5}"/>`
  }
  return glows + g + '</g>'
}

// ---- boroughs: one per other repository -----------------------------------

const HOUSE_PALS: Pal[] = ['b', 'b', 'r', 'b', 'r', 's']

// A Brooklyn-ish neighbourhood: brownstone rows back to back along their
// streets, and a square at the front where the borough's agents gather. With
// no repository (it packed up), the houses stay and the sign comes down.
function burb(b: Burb, repo: Repo | undefined, sc: Scene): string {
  const [cx, cy] = BURBS[b].center
  const here = (sc.byBurb.get(b) ?? []).filter(a => a.status !== 'done')
  const isActive = here.some(a => a.status === 'working')
  const isBuilding = here.some(a => a.at === 'workshop')
  let g = isActive ? glow(cx - 0.6, cy + 3.4, 44) : ''
  // The ground: pavement, the streets between the blocks, an avenue down the
  // east side, and the square in front with a fountain behind the agents.
  g += GRID
  g += gRect(cx - 3.7, cy - 3.7, cx + 3.4, cy + 1.8, '#272c36', ' rx=".2"')
  g += `<path d="M${n(cx - 3.7)} ${n(cy - 2.45)}H${n(cx + 3.4)}M${n(cx - 3.7)} ${n(cy - 0.5)}H${n(cx + 3.4)}M${n(cx - 0.35)} ${n(cy - 3.7)}V${n(cy - 0.5)}M${n(cx + 3.15)} ${n(cy - 3.7)}V${n(cy + 1.8)}" stroke="#191d26" stroke-width=".42"/>`
  g += gRect(cx - 3.5, cy + 1.95, cx + 2.75, cy + 4.95, '#343944', ` rx=".3" stroke="${isActive ? '#fde68a' : '#3f4552'}" stroke-width=".05"`)
  let tiles = ''
  for (const ty of [2.95, 3.95]) tiles += `M${n(cx - 3.4)} ${n(cy + ty)}H${n(cx + 2.65)}`
  for (let tx = -2.25; tx < 2.7; tx += 1.25) tiles += `M${n(cx + tx)} ${n(cy + 2.05)}V${n(cy + 4.85)}`
  g += `<path d="${tiles}" stroke="#3d4350" stroke-width=".04"/>`
  g += `<circle cx="${n(cx - 0.3)}" cy="${n(cy + 2.4)}" r=".3" fill="#1e4f86" stroke="#9ca3af" stroke-width=".05"/>`
  g += '</g>'
  // Rows of houses, back to front, each row west to east: apartments at the
  // back, then brownstone rows back to back, the front row facing the square.
  const rows: [number, number, number][] = [
    [cy - 3.4, 12, 3],
    [cy - 2.15, 6.4, 1.4],
    [cy - 1.45, 6.4, 1.4],
    [cy - 0.2, 6, 1.4],
    [cy + 0.5, 6, 1.4],
  ]
  let scaffolded = ''
  rows.forEach(([y0, base, spread], ri) => {
    let x = cx - 3.4
    let i = 0
    let stoops = ''
    while (x < cx + 2.95) {
      // A cross street through the back blocks.
      if (ri < 3 && x < cx - 0.1 && x + 0.5 > cx - 0.6) {
        x = cx - 0.1
        continue
      }
      const q = seeded(x * 7 + ri, y0 * 3 + i)
      const w = Math.min(q > 0.85 ? 0.75 : 0.5, cx + 3.0 - x)
      if (w < 0.3) break
      const corner = ri === 4 && x + w >= cx + 2.9
      const h = corner ? 11 : base + q * spread
      const pal: Pal = ri === 0 ? (q > 0.5 ? 'k' : 's') : corner ? 'k' : HOUSE_PALS[Math.floor(q * HOUSE_PALS.length)]!
      g += box(x, y0, w - 0.03, 0.62, h, pal)
      if (corner && isBuilding) scaffolded = scaffold(x, y0, w - 0.03, 0.62, h)
      // A stoop up to each front door on the rows that face a street.
      if ((ri === 2 || ri === 4) && !corner) {
        const sx = x + w * 0.3
        stoops += `M${xy(p(sx, y0 + 0.62, 1.8))}L${xy(p(sx + 0.12, y0 + 0.62, 1.8))}L${xy(p(sx + 0.12, y0 + 0.8))}L${xy(p(sx, y0 + 0.8))}z`
      }
      x += w
      i++
    }
    if (stoops) g += `<path d="${stoops}" fill="#8a7a66"/>`
    // Street trees along the middle street, in front of the brownstones.
    if (ri === 2) for (const tx of [-3.0, -1.7, 0.4, 1.6, 2.7]) g += tree(cx + tx, cy - 0.74, 1.3)
  })
  g += scaffolded
  // Trees along the front, the square's lamps and its fountain.
  for (const tx of [-2.9, -1.5, 0.5, 1.9]) g += tree(cx + tx, cy + 1.5, 1.5)
  g += tree(cx - 3.3, cy + 2.15, 2) + tree(cx + 2.55, cy + 4.75, 2)
  g += lamp(cx - 3.35, cy + 4.8) + lamp(cx + 2.6, cy + 2.15) + lamp(cx - 1.4, cy + 2.1) + lamp(cx + 0.8, cy + 2.1)
  const [fx, fy] = p(cx - 0.3, cy + 2.4)
  g += `<path d="M${n(fx)} ${n(fy)}v-4" stroke="#bfdbfe" stroke-width=".8" opacity=".8"/><circle cx="${n(fx)}" cy="${n(fy - 4.4)}" r="1.1" fill="#dbeafe" opacity=".7"/>`
  // The sign hangs at the back corner, clear of the square where agents stand.
  const [lx, ly] = p(cx + 0.8, cy - 2.6, 40)
  g += `<text class="sign sb" x="${n(lx)}" y="${n(ly)}" dy="-1.7em" text-anchor="middle">${BURBS[b].name.toUpperCase()}</text>`
  if (repo) g += `<text class="sign" x="${n(lx)}" y="${n(ly)}" text-anchor="middle" style="fill:${isActive ? '#fde68a' : '#e2e8f0'}">${esc(repo.name)}</text>`
  return g
}

// ---- landmarks ------------------------------------------------------------

// Billboard colours.
const NEON = ['#f43f5e', '#22d3ee', '#a3e635', '#f59e0b', '#c084fc', '#fb7185', '#38bdf8']

// The landmarks, each pushed as depth-sorted items; their flat ground goes
// in `ground`, under everything.
function landmarks(items: Item[], sc: Scene): string {
  const on = (d: District) => sc.active.has(d)
  let ground = GRID
  const add = (depth: number, svg: string) => items.push({ depth, svg })
  const trees = (list: [number, number, number][]) => {
    for (const [gx, gy, rad] of list) add(gx + gy, tree(gx, gy, rad))
  }

  // Central Park: the Reservoir, the Great Lawn (the plaza's pad), the Lake.
  {
    ground += gRect(5.15, 22.1, 8.85, 34.9, '#1d4b2c')
    ground += `<rect x="5.5" y="22.5" width="3" height="12" rx="1.2" fill="none" stroke="#4d5a45" stroke-width=".05"/>`
    ground += `<ellipse cx="7" cy="24.3" rx="1.15" ry="1.5" fill="#1e4f86" stroke="#2f6aa8" stroke-width=".05"/>`
    ground += `<path d="M5.6 32.4q.6-.7 1.4-.3t1.1.4q.4.9-.6 1.1t-1.3.2q-.9-.2-.6-1.4z" fill="#1e4f86"/>`
    const list: [number, number, number][] = []
    for (let i = 0; i < 64; i++) {
      const tx = 5.35 + seeded(i, 3) * 3.3
      const ty = 22.3 + seeded(3, i) * 12.4
      const inLawn = ((tx - 7) / 1.75) ** 2 + ((ty - 28.85) / 2.5) ** 2 < 1
      const inRes = ((tx - 7) / 1.35) ** 2 + ((ty - 24.3) / 1.7) ** 2 < 1
      const inLake = tx > 5.5 && tx < 8.1 && ty > 32 && ty < 33.9
      if (inLawn || inRes || inLake) continue
      list.push([tx, ty, 1.8 + seeded(i, i) * 1.5])
    }
    trees(list)
  }

  // Times Square: towers wrapped in billboards around a pink-lit plaza with
  // the red steps; the screens cycle when someone is on the web.
  {
    const live = on('observatory')
    ground += gRect(5.2, 38.15, 6.8, 38.85, '#3b2b40')
    // The red steps, at the plaza's south end.
    add(5.7 + 38.5 + 0.6, slab(5.75, 38.5, 0.7, 0.3, 3.2, ['#dc2626', '#991b1b', '#f87171']))
    let g = box(3.3, 37.2, 1.35, 0.6, 44, 'k')
    g += box(5.25, 37.2, 0.72, 0.6, 54, 'g')
    g += box(6.1, 37.25, 0.62, 0.5, 42, 'k')
    // Screens on the south and east walls.
    let i = 0
    const bill = (list: [number, number, number][]) => {
      const c = NEON[i % NEON.length]!
      const c2 = NEON[(i + 3) % NEON.length]!
      const anim = live ? `<animate attributeName="fill" values="${c};${c2};${c}" dur="${n(1.3 + (i % 4) * 0.35)}s" repeatCount="indefinite"/>` : ''
      i++
      return `<polygon points="${pts(list.map(([gx, gy, z]) => p(gx, gy, z)))}" fill="${c}" opacity=".92">${anim}</polygon>`
    }
    for (const [a, b2, z0, z1] of [
      [3.4, 4.0, 8, 18],
      [4.1, 4.55, 6, 14],
      [3.5, 4.5, 22, 30],
      [5.3, 5.9, 10, 22],
      [5.35, 5.85, 28, 38],
      [6.15, 6.65, 6, 16],
      [6.2, 6.6, 20, 30],
    ] as const) {
      const gy = a < 6 ? 37.8 : 37.75
      g += bill([
        [a, gy, z0],
        [b2, gy, z0],
        [b2, gy, z1],
        [a, gy, z1],
      ])
    }
    for (const [gx, gy0, gy1, z0, z1] of [
      [6.72, 37.35, 37.7, 12, 26],
      [5.97, 37.3, 37.75, 30, 44],
      [4.65, 37.3, 37.75, 10, 24],
    ] as const) {
      g += bill([
        [gx, gy1, z0],
        [gx, gy0, z0],
        [gx, gy0, z1],
        [gx, gy1, z1],
      ])
    }
    // The ball, on the tallest tower, in the district's pink.
    const [bx, by] = p(5.61, 37.5, 54)
    g += `<path d="M${n(bx)} ${n(by)}v-7" stroke="#cbd5e1" stroke-width=".8"/><circle cx="${n(bx)}" cy="${n(by - 9)}" r="2.6" fill="${ACCENT.observatory}" stroke="#fff" stroke-width=".5">${live ? '<animate attributeName="r" values="2.4;3.2;2.4" dur="1s" repeatCount="indefinite"/>' : ''}</circle>`
    add(37.2 + 5.25 + 1.3, g)
  }

  // The Public Library: a wide Beaux-Arts front with columns, its lions and
  // lamps, and Bryant Park across the street.
  {
    const live = on('library')
    const c = ACCENT.library
    let g = box(7.25, 39.2, 1.5, 0.58, 12, 's')
    g += box(7.45, 39.28, 1.1, 0.4, 2.4, 's', 12)
    g += box(7.82, 39.72, 0.36, 0.14, 14, 's')
    // Columns across the front.
    let cols = ''
    for (let i = 0; i < 9; i++) {
      const gx = 7.33 + i * 0.167
      if (gx > 7.78 && gx < 8.22) continue
      const [x, y] = p(gx, 39.79, 1.5)
      cols += `M${n(x)} ${n(y)}v-8`
    }
    g += `<path d="${cols}" stroke="#e7e5e4" stroke-width=".7"/>`
    // The reading room's tall windows, lit blue while someone reads.
    g += face(
      [
        [7.85, 39.86, 4],
        [8.15, 39.86, 4],
        [8.15, 39.86, 11],
        [7.85, 39.86, 11],
      ],
      live ? c : '#33415a',
      '',
      live ? '<animate attributeName="opacity" values="1;.55;1" dur="1.4s" repeatCount="indefinite"/>' : '',
    )
    // Steps, and the two lions.
    g += slab(7.6, 39.8, 0.8, 0.14, 1, ['#a8a29e', '#78716c', '#d6d3d1'])
    for (const gx of [7.55, 8.45]) {
      const [x, y] = p(gx, 39.92, 1)
      g += `<path d="M${n(x - 1.6)} ${n(y)}h3.2v-1.6q-.4-1.6-1.6-1.6t-1.6 1.6z" fill="#d6c7a1"/>`
    }
    for (const gx of [7.4, 8.6]) {
      const [x, y] = p(gx, 39.9)
      g += `<path d="M${n(x)} ${n(y)}v-6" stroke="#57534e" stroke-width=".6"/><circle cx="${n(x)}" cy="${n(y - 6.5)}" r="1.2" fill="${c}"/>`
    }
    add(39.2 + 7.25 + 1.4, g)
    // Bryant Park.
    ground += gRect(7.25, 40.18, 8.75, 40.82, '#1f5130')
    ground += gRect(7.6, 40.3, 8.4, 40.7, '#2a6a3c')
    trees([
      [7.35, 40.75, 1.8],
      [7.9, 40.8, 1.7],
      [8.5, 40.78, 1.8],
      [8.68, 40.35, 1.6],
      [7.32, 40.3, 1.6],
    ])
  }

  // Grand Central: three great arched windows, the clock and its statues,
  // the MetLife slab behind and the Chrysler Building's crown beside it.
  {
    const live = on('relay')
    const c = ACCENT.relay
    let g = box(9.75, 38.25, 1.35, 0.55, 56, 'k')
    // The MetLife sign along the top.
    g += face(
      [
        [9.85, 38.82, 50],
        [10.95, 38.82, 50],
        [10.95, 38.82, 53],
        [9.85, 38.82, 53],
      ],
      live ? c : '#64748b',
      ' opacity=".9"',
    )
    const [mx, my] = p(10.42, 38.52, 56)
    if (live) g += rings(mx, my - 4, c)
    g += box(9.35, 39.22, 2.4, 0.56, 13, 's')
    g += box(9.6, 39.3, 1.9, 0.38, 2.5, 's', 13)
    // The arches, lit teal when messages fly.
    const [ax, ay] = p(9.65, 39.78)
    let arches = ''
    for (let i = 0; i < 3; i++) {
      const x = 4 + i * 6.4
      arches += `M${n(x)} -2v-6.2a2.1 2.1 0 0 1 4.2 0v6.2z`
    }
    g += `<path transform="translate(${n(ax)} ${n(ay)}) skewY(26.565)" d="${arches}" fill="${live ? c : '#24384a'}" stroke="#e7e5e4" stroke-width=".4">${live ? '<animate attributeName="opacity" values="1;.6;1" dur="1.2s" repeatCount="indefinite"/>' : ''}</path>`
    // The clock and Mercury on top.
    const [kx, ky] = p(10.55, 39.5, 15.5)
    g += `<circle cx="${n(kx)}" cy="${n(ky - 2)}" r="2.2" fill="#fde68a" stroke="#a16207" stroke-width=".5"/><path d="M${n(kx - 3)} ${n(ky - 4)}l3 -4l3 4z" fill="#d6c7a1"/>`
    // Chrysler: the stepped crown of arches, lit white.
    g += box(12.3, 39.25, 0.55, 0.5, 60, 'g')
    const [cx, cy] = p(12.575, 39.5, 60)
    g += `<path d="M${n(cx - 4.6)} ${n(cy)}Q${n(cx - 4.6)} ${n(cy - 9)} ${n(cx)} ${n(cy - 14)}Q${n(cx + 4.6)} ${n(cy - 9)} ${n(cx + 4.6)} ${n(cy)}z" fill="#cbd5e1"/>`
    g += `<path d="M${n(cx - 3.4)} ${n(cy - 2)}Q${n(cx - 3.4)} ${n(cy - 8)} ${n(cx)} ${n(cy - 11.5)}Q${n(cx + 3.4)} ${n(cy - 8)} ${n(cx + 3.4)} ${n(cy - 2)}M${n(cx - 2)} ${n(cy - 4)}Q${n(cx - 2)} ${n(cy - 7.4)} ${n(cx)} ${n(cy - 9.2)}Q${n(cx + 2)} ${n(cy - 7.4)} ${n(cx + 2)} ${n(cy - 4)}" fill="none" stroke="#fef3c7" stroke-width=".6"/>`
    g += spire(12.575, 39.5, 73, 9, '#e2e8f0')
    add(39.22 + 9.35 + 2.4, g)
  }

  // The Garment District: a loft with its water towers, the giant needle and
  // button in Herald Square, and scaffolding while someone is editing.
  {
    const live = on('workshop')
    const c = ACCENT.workshop
    let g = box(5.25, 41.2, 1.5, 0.6, 22, 'r')
    // A painted sign along the top floor.
    g += face(
      [
        [5.35, 41.8, 17],
        [6.4, 41.8, 17],
        [6.4, 41.8, 20],
        [5.35, 41.8, 20],
      ],
      '#1c1917',
      ' opacity=".85"',
    )
    g += face(
      [
        [5.45, 41.8, 17.8],
        [6.3, 41.8, 17.8],
        [6.3, 41.8, 19.2],
        [5.45, 41.8, 19.2],
      ],
      c,
      ' opacity=".8"',
    )
    for (const gx of [5.6, 6.35]) {
      const [x, y] = p(gx, 41.45, 22)
      g += `<use href="#wt" x="${n(x)}" y="${n(y)}"/>`
    }
    if (live) {
      g += scaffold(5.25, 41.2, 1.5, 0.6, 22)
      g += sparks(...p(6.75, 41.6, 10))
    }
    add(41.2 + 5.25 + 1.5, g)
    // Herald Square, with the needle threaded through its button.
    ground += gRect(5.25, 42.2, 6.75, 42.82, '#353a47')
    ground += `<path d="M5.6 42.7l.3 -.3l.3 .3z" fill="#1f5130"/>`
    const [nx, ny] = p(6.45, 42.62)
    let s = `<circle cx="${n(nx)}" cy="${n(ny - 7)}" r="4.2" fill="${c}" stroke="#a16207" stroke-width=".6"/>`
    for (const [dx, dy] of [
      [-1.1, -1.1],
      [1.1, -1.1],
      [-1.1, 1.1],
      [1.1, 1.1],
    ]) {
      s += `<circle cx="${n(nx + dx)}" cy="${n(ny - 7 + dy)}" r=".6" fill="#78350f"/>`
    }
    s += `<path d="M${n(nx - 4)} ${n(ny)}L${n(nx + 3)} ${n(ny - 16)}" stroke="#e5e7eb" stroke-width="1"/>`
    add(6.45 + 42.62, s)
    trees([
      [5.4, 42.75, 1.5],
      [5.9, 42.8, 1.3],
    ])
  }

  // The Empire State Building, its crown lit in the colour of whichever
  // district is busiest, as the real one changes colour for the occasion.
  {
    let busy: District | undefined
    let most = 0
    for (const [d, list] of sc.byDistrict) {
      const working = list.filter(a => a.status === 'working').length
      if (d !== 'plaza' && working > most) [busy, most] = [d, working]
    }
    // An update waiting turns the crown gold, whatever is busy.
    const crown = sc.update?.available ? '#fbbf24' : busy ? ACCENT[busy] : '#f8fafc'
    let e = ''
    if (sc.update?.available) {
      // A gold halo breathing around the tower.
      const [hx, hy] = p(7.8, 42.5, 50)
      e += `<ellipse cx="${n(hx)}" cy="${n(hy)}" rx="34" ry="60" fill="url(#halo)"><animate attributeName="opacity" values=".55;1;.55" dur="2s" repeatCount="indefinite"/></ellipse>`
    }
    e += box(7.4, 42.2, 0.8, 0.6, 34, 's')
    e += box(7.52, 42.3, 0.56, 0.4, 30, 's', 34)
    e += box(7.62, 42.38, 0.36, 0.24, 14, 's', 64)
    e += slab(7.67, 42.42, 0.26, 0.16, 5, [crown, mix(crown, '#000000', 0.3), '#fff'], 78)
    e += spire(7.8, 42.5, 83, 15)
    add(42.2 + 7.4 + 1.4, e)
  }

  // Hudson Yards: the rail yard, the Shed, two towers with the Edge's deck
  // jutting out, the copper Vessel, and a stack that smokes while the shell
  // is busy.
  {
    const live = on('foundry')
    const c = ACCENT.foundry
    ground += gRect(1.2, 40.2, 4.8, 41.85, '#24262f')
    let tracks = ''
    for (let i = 0; i < 6; i++) tracks += `M1.3 ${n(40.4 + i * 0.25)}H4.7`
    ground += `<path d="${tracks}" stroke="#64748b" stroke-width=".03"/>`
    let g = slab(1.3, 40.3, 0.9, 0.75, 14, ['#cbd5e1', '#94a3b8', '#e2e8f0'])
    let quilt = ''
    for (let i = 1; i < 4; i++) quilt += `M${xy(p(1.3 + i * 0.225, 41.05))}v-14`
    for (let z = 3.5; z < 14; z += 3.5) quilt += `M${xy(p(1.3, 41.05, z))}L${xy(p(2.2, 41.05, z))}`
    g += `<path d="${quilt}" stroke="#64748b" stroke-width=".4"/>`
    g += box(3.3, 40.25, 0.65, 0.55, 66, 'g')
    g += box(4.1, 40.3, 0.6, 0.5, 52, 'g')
    // The Edge, a wedge off the tall tower's east wall.
    const [ex, ey] = p(3.95, 40.6, 58)
    g += `<path d="M${n(ex)} ${n(ey)}l9 1.5l-1 1.6l-8 -0.6z" fill="#e2e8f0"/><path d="M${n(ex)} ${n(ey)}l9 1.5" stroke="${c}" stroke-width=".8"/>`
    // Crown lights in the district's orange.
    g += face(
      [
        [3.3, 40.8, 62],
        [3.95, 40.8, 62],
        [3.95, 40.8, 66],
        [3.3, 40.8, 66],
      ],
      c,
      live ? '' : ' opacity=".6"',
      live ? '<animate attributeName="opacity" values="1;.4;1" dur="1s" repeatCount="indefinite"/>' : '',
    )
    const [sx, sy] = p(1.6, 40.4)
    g += `<rect x="${n(sx - 2)}" y="${n(sy - 24)}" width="4" height="24" fill="#64748b"/><rect x="${n(sx - 2)}" y="${n(sy - 24)}" width="4" height="2" fill="${c}"/>`
    if (live) g += smoke(sx, sy - 26, '#cbd5e1')
    add(40.25 + 3.3 + 1.5, g)
    // The Vessel: a copper honeycomb cup.
    const [vx, vy] = p(2.6, 41.35)
    let v = `<path d="M${n(vx - 4)} ${n(vy)}L${n(vx - 7.5)} ${n(vy - 13)}L${n(vx + 7.5)} ${n(vy - 13)}L${n(vx + 4)} ${n(vy)}z" fill="#9a4a12"/>`
    v += `<ellipse cx="${n(vx)}" cy="${n(vy - 13)}" rx="7.5" ry="2.2" fill="#c2621a"/>`
    let lattice = ''
    for (let i = -3; i <= 3; i++) lattice += `M${n(vx + i * 1.2)} ${n(vy)}L${n(vx + i * 2.3 + 2.4)} ${n(vy - 12.5)}M${n(vx + i * 1.2)} ${n(vy)}L${n(vx + i * 2.3 - 2.4)} ${n(vy - 12.5)}`
    v += `<path d="${lattice}" stroke="${live ? '#fdba74' : '#e07a2f'}" stroke-width=".5" opacity=".9"/>`
    add(2.6 + 41.35, v)
  }

  // City Hall in its park, with the fountain, and the Woolworth Building.
  {
    const c = ACCENT.hall
    ground += gRect(7.15, 55.1, 9.85, 55.88, '#1f5130')
    ground += `<ellipse cx="7.55" cy="55.6" rx=".22" ry=".22" fill="#2f6aa8" stroke="#94a3b8" stroke-width=".04"/>`
    trees([
      [7.3, 55.25, 2],
      [9.6, 55.3, 2.1],
      [9.65, 55.75, 1.7],
      [7.8, 55.2, 1.6],
    ])
    let g = box(8.0, 55.28, 1.25, 0.42, 9, 's')
    g += box(8.35, 55.62, 0.55, 0.14, 10, 's')
    const [dx, dy] = p(8.62, 55.5, 10)
    g += `<path d="M${n(dx - 3)} ${n(dy)}a3 3 0 0 1 6 0z" fill="#e7e5e4"/><circle cx="${n(dx)}" cy="${n(dy - 3.4)}" r="1" fill="${c}"/>`
    g += `<line x1="${n(dx)}" y1="${n(dy - 3)}" x2="${n(dx)}" y2="${n(dy - 12)}" stroke="#e2e8f0" stroke-width=".8"/>`
    g += `<path d="M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z" fill="#60a5fa"><animate attributeName="d" values="M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z;M${n(dx)} ${n(dy - 12)}l6 2.5l-6 .5z;M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z" dur="1.2s" repeatCount="indefinite"/></path>`
    for (const gx of [8.05, 9.2]) {
      const [x, y] = p(gx, 55.72)
      g += `<circle cx="${n(x)}" cy="${n(y - 6)}" r="1.1" fill="${c}"/>`
    }
    if (sc.isWaiting) g += beacon(dx, dy - 30, '#fbbf24', '?', sc.k)
    add(55.28 + 8.0 + 1.5, g)

    let w = box(5.5, 55.25, 0.9, 0.55, 40, 's')
    w += box(5.65, 55.35, 0.6, 0.35, 14, 's', 40)
    const [tx, ty] = p(5.95, 55.52, 54)
    w += `<path d="M${n(tx - 6)} ${n(ty)}L${n(tx)} ${n(ty - 12)}L${n(tx + 6)} ${n(ty)}z" fill="#3f7d6a"/>`
    w += `<path d="M${n(tx)} ${n(ty - 12)}v-5" stroke="#cbd5e1" stroke-width=".7"/>`
    add(55.25 + 5.5 + 1.4, w)
  }

  // One World Trade Center.
  {
    let g = box(4.2, 57.2, 0.7, 0.7, 84, 'g')
    const [x, y] = p(4.55, 57.55, 84)
    g += `<path d="M${n(x - 7)} ${n(y)}L${n(x)} ${n(y - 8)}L${n(x + 7)} ${n(y)}z" fill="#3b5a85"/>`
    g += spire(4.55, 57.55, 92, 18)
    add(57.2 + 4.2 + 1.4, g)
  }

  // South Street Seaport: the pier and its market shed, the tall ship, the
  // crane; red alarm and smoke on a merge conflict.
  {
    const c = ACCENT.harbor
    ground += gRect(12.6, 57.15, 15.4, 57.85, '#4a4540')
    let deck = ''
    for (let gx = 12.8; gx < 15.4; gx += 0.3) deck += `M${n(gx)} 57.15V57.85`
    ground += `<path d="${deck}" stroke="#3a3632" stroke-width=".03"/>`
    let g = box(12.7, 57.2, 0.9, 0.6, 8, 'r')
    g += slab(13.75, 57.25, 0.9, 0.5, 5, ['#334155', '#1e293b', '#475569'])
    g += face(
      [
        [13.8, 57.75, 2],
        [14.6, 57.75, 2],
        [14.6, 57.75, 3.5],
        [13.8, 57.75, 3.5],
      ],
      c,
      ' opacity=".8"',
    )
    const [sx, sy] = p(14.9, 58.4)
    g += `<path d="M${n(sx - 14)} ${n(sy)}l24 -3l-3 5l-18 2z" fill="#292524"/>`
    for (const dx of [-8, 0, 6]) {
      g += `<line x1="${n(sx + dx)}" y1="${n(sy - 1)}" x2="${n(sx + dx)}" y2="${n(sy - 24)}" stroke="#a8a29e" stroke-width=".9"/>`
      g += `<path d="M${n(sx + dx - 4)} ${n(sy - 20)}h8l-1 10h-6z" fill="#f5f5f4" opacity=".85"/>`
    }
    g += `<path d="M${n(sx - 8)} ${n(sy - 24)}L${n(sx)} ${n(sy - 24)}L${n(sx + 6)} ${n(sy - 24)}" stroke="${c}" stroke-width=".5" stroke-dasharray="1 1.4"/>`
    const [cx, cy] = p(14.2, 57.4)
    g += `<g><line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - 30)}" stroke="#facc15" stroke-width="1.6"/><line x1="${n(cx)}" y1="${n(cy - 29)}" x2="${n(cx + 18)}" y2="${n(cy - 24)}" stroke="#facc15" stroke-width="1.6"/>`
    if (on('harbor')) {
      g += `<animateTransform attributeName="transform" type="rotate" values="0 ${n(cx)} ${n(cy)};16 ${n(cx)} ${n(cy)};0 ${n(cx)} ${n(cy)}" dur="5s" repeatCount="indefinite"/>`
    }
    g += `</g>`
    if (sc.hasConflict) {
      g += glow(13.6, 57.5, 34, 'alarm')
      const [fx, fy] = p(13.2, 57.5, 8)
      g += smoke(fx, fy, '#f87171')
      g += beacon(fx, fy - 26, '#ef4444', '!', sc.k)
    }
    add(57.2 + 12.7 + 3, g)
  }
  return ground + '</g>'
}

// ---- water and sky --------------------------------------------------------

// City lights reflected in the rivers: streaks under the shores that face us.
function reflections(): string {
  let warm = ''
  let cool = ''
  let twinkle = ''
  for (let gy = 16; gy < 62.6; gy += 0.7) {
    const e = edges(gy)[1]
    const q = seeded(gy, 7)
    const [x, y] = p(e + 0.2 + q * 0.5, gy)
    const w = 2 + seeded(7, gy) * 3
    const streak = `M${n(x - w / 2)} ${n(y + 1.5)}h${n(w)}M${n(x - w * 0.35)} ${n(y + 3.5)}h${n(w * 0.7)}M${n(x - w * 0.2)} ${n(y + 5.5)}h${n(w * 0.4)}`
    if (q > 0.3) warm += streak
    else cool += streak
    if (q > 0.9) {
      twinkle += `<circle cx="${n(x)}" cy="${n(y + 3)}" r=".8" fill="#fff7d6"><animate attributeName="opacity" values="0;1;0" dur="${n(2 + q * 2)}s" begin="${n(-gy % 3)}s" repeatCount="indefinite"/></circle>`
    }
  }
  // New Jersey's lights across the Hudson.
  for (let gy = -1; gy < 62; gy += 1.3) {
    const [w] = edges(gy)
    const [x, y] = p(w - 5 - gy * 0.02 + 0.3, gy)
    if (seeded(gy, 11) > 0.45) cool += `M${n(x - 1.2)} ${n(y + 1.5)}h2.4M${n(x - 0.6)} ${n(y + 3.5)}h1.2`
  }
  return (
    `<path class="refl" d="${warm}" stroke="#fcd581" stroke-width=".9" opacity=".4"/>` +
    `<path class="refl" d="${cool}" stroke="#c7ddff" stroke-width=".8" opacity=".3"/>` +
    twinkle
  )
}

function moon(x: number, y: number): string {
  return (
    `<circle class="sky" cx="${n(x)}" cy="${n(y)}" r="90" fill="url(#mhalo)"/>` +
    `<circle cx="${n(x)}" cy="${n(y)}" r="13" fill="url(#moon)"/>` +
    `<circle cx="${n(x - 4)}" cy="${n(y + 3)}" r="2.6" fill="#d9cba0" opacity=".5"/><circle cx="${n(x + 4)}" cy="${n(y - 4)}" r="1.6" fill="#d9cba0" opacity=".45"/><circle cx="${n(x + 3)}" cy="${n(y + 5)}" r="1.1" fill="#d9cba0" opacity=".4"/>`
  )
}

// ---- bridges, boats, traffic ----------------------------------------------

function bridge(a: [number, number], b: [number, number], towers: number[], color: string, isAlarm = false): string {
  const [x1, y1] = p(a[0], a[1], 4)
  const [x2, y2] = p(b[0], b[1], 4)
  let g = `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#94a3b8" stroke-width="2.4"/>`
  // Lamps along the deck.
  g += `<line x1="${n(x1)}" y1="${n(y1 - 1)}" x2="${n(x2)}" y2="${n(y2 - 1)}" stroke="#ffe6a8" stroke-width=".9" stroke-linecap="round" stroke-dasharray="0 6"/>`
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

// Cars on the avenues, under the buildings, and boats on the water.
function traffic(): string {
  let g = ''
  const lanes: [[number, number], [number, number], number, string][] = [
    [[9, 0], [9, 56], 14, TAXI],
    [[7, 58], [7, 35.2], 8, TAXI],
    [[7, 21.8], [7, 2], 7, CAR],
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
  const boat = (c: string) => `<path d="M-5 0l10 -1l-2 2.4h-7z" fill="${c}"/><rect x="-2" y="-3.6" width="3" height="2.4" fill="#f5f5f4"/><circle cx="4" cy="-.6" r=".7" fill="#fde68a"/>`
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
function statue(launch: Launch | undefined, now: number): string {
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
  g += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="9" ry="4.5" fill="#5eada0" opacity=".12"/>`
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
  g += `<text class="cap" x="${n(cx)}" y="${n(cy)}" dx="1.2em" style="fill:${kind === 'push' ? '#fdba74' : '#86efac'}">${esc(title + where)}</text>`
  g += `<text class="cap sb" x="${n(cx)}" y="${n(cy)}" dx="1.6em" dy="1.6em">${esc(launch.who)}</text></g>`
  return g
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

// Fireworks over the Empire State while an update waits: rockets climb from the
// spire and burst into rings of sparks, staggered so the sky is never quiet.
function fireworks(): string {
  const [sx, sy] = p(7.8, 42.5, 98)
  const colors = ['#fbbf24', '#f472b6', '#5eead4', '#a78bfa', '#f8fafc']
  let g = '<g class="fireworks">'
  for (let b = 0; b < 5; b++) {
    const dur = 2.6 + (b % 3) * 0.3
    const begin = b * 0.55
    const bx = sx + (b - 2) * 16 + (b % 2 ? 6 : -4)
    const by = sy - 46 - (b % 3) * 14
    const color = colors[b % colors.length]!
    const t = (a: string) => `dur="${n(dur)}s" begin="${n(begin)}s" repeatCount="indefinite" ${a}`
    // The rocket: a spark climbing from the spire, gone as it bursts.
    g += `<circle r="1.3" fill="#fde68a" opacity="0"><animate attributeName="cx" values="${n(sx)};${n(bx)};${n(bx)}" keyTimes="0;.3;1" ${t('')}/>`
    g += `<animate attributeName="cy" values="${n(sy)};${n(by)};${n(by)}" keyTimes="0;.3;1" ${t('')}/>`
    g += `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.28;.3;1" ${t('')}/></circle>`
    // The burst: a ring of sparks flying out and fading as they fall a little.
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2
      const r = 16 + (b % 2) * 5
      const ex = bx + Math.cos(ang) * r
      const ey = by + Math.sin(ang) * r * 0.85 + 5
      g += `<circle cx="${n(bx)}" cy="${n(by)}" r="1.4" fill="${color}" opacity="0">`
      g += `<animate attributeName="cx" values="${n(bx)};${n(bx)};${n(ex)}" keyTimes="0;.3;1" ${t('calcMode="spline" keySplines="0 0 1 1;.2 .7 .4 1"')}/>`
      g += `<animate attributeName="cy" values="${n(by)};${n(by)};${n(ey)}" keyTimes="0;.3;1" ${t('calcMode="spline" keySplines="0 0 1 1;.2 .7 .4 1"')}/>`
      g += `<animate attributeName="opacity" values="0;0;1;0" keyTimes="0;.3;.45;1" ${t('')}/></circle>`
    }
  }
  return g + '</g>'
}

// Everything but the agents, back to front.
export function drawMap(world: World, sc: Scene): string {
  const { active, hasConflict, repoOf, vacantOf, now } = sc
  const vb = frame([...repoOf.keys(), ...vacantOf.keys()])
  let s = ''
  // The water's sparkle, and the city's lights reflected in it.
  s += `<rect x="${n(vb.x - 2000)}" y="${n(vb.y - 2000)}" width="${n(vb.w + 4000)}" height="${n(vb.h + 4000)}" fill="url(#rip)"/>`
  s += reflections()
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

  // Manhattan: the shore, the pavement, the streets, then whatever lies flat
  // on them, then the cars.
  const shore = ISLAND.map(([gx, gy]) => p(gx, gy)).map(([x, y]) => [x, y + 5] as Pt)
  s += `<polygon points="${pts(shore)}" fill="#0f172a"/>`
  s += poly(ISLAND, '#30353f')
  s += streets()
  const items: Item[] = []
  s += landmarks(items, sc)
  s += pads(sc)
  s += traffic()

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

  // A borough for each repository in use besides the session's own, and the
  // houses of the ones that have moved out.
  for (const [b] of vacantOf) s += burb(b, undefined, sc)
  for (const [b, repo] of repoOf) s += burb(b, repo, sc)

  // Buildings and landmarks, back to front.
  fabric(items)
  items.sort((a, b) => a.depth - b.depth)
  s += items.map(i => i.svg).join('')
  // Each district's lights wash over its buildings in its colour, brighter
  // while someone works there.
  for (const d of DISTRICTS) {
    const [x0, y0, x1, y1] = padOf(d)
    const [x, y] = p((x0 + x1) / 2, (y0 + y1) / 2, 14)
    s += `<ellipse class="glow haze" cx="${n(x)}" cy="${n(y)}" rx="${d === 'plaza' ? 70 : 46}" ry="${d === 'plaza' ? 36 : 27}" fill="url(#p-${d})" opacity="${active.has(d) ? 0.55 : 0.28}"/>`
  }
  // The city's glow on the haze above Midtown and downtown.
  s += `<ellipse class="sky" cx="${n(p(9, 41)[0])}" cy="${n(p(9, 41)[1] - 40)}" rx="190" ry="85" fill="url(#sky)"/>`
  s += `<ellipse class="sky" cx="${n(p(8, 58)[0])}" cy="${n(p(8, 58)[1] - 40)}" rx="130" ry="60" fill="url(#sky)"/>`
  s += statue(world.launch, now)
  s += moon(vb.x + vb.w * 0.3, vb.y + 34)
  if (sc.update?.available) s += fireworks()

  // Names on the map: neighbourhoods once zoomed in, rivers, the boroughs not
  // in use, and the districts in their own colours.
  for (const [name, gx, gy] of HOODS) {
    const [x, y] = p(gx, gy)
    s += `<text class="hood minor" x="${n(x)}" y="${n(y)}" text-anchor="middle">${name}</text>`
  }
  const water: [string, number, number][] = [
    ['HUDSON RIVER', -2.4, 24],
    ['EAST RIVER', 18.2, 42],
    ['UPPER BAY', 4, 67],
  ]
  for (const [name, gx, gy] of water) {
    const [x, y] = p(gx, gy)
    s += `<text class="water" x="${n(x)}" y="${n(y)}" text-anchor="middle" transform="rotate(-26.6 ${n(x)} ${n(y)})">${name}</text>`
  }
  const boroughs: [string, number, number, Burb][] = [
    ['NEW JERSEY', -11, 28, 'jersey'],
    ['THE BRONX', 20, 4, 'bronx'],
    ['QUEENS', 25, 30, 'queens'],
    ['BROOKLYN', 25, 58, 'brooklyn'],
  ]
  for (const [name, gx, gy, b] of boroughs) {
    if (repoOf.has(b) || vacantOf.has(b)) continue
    const [x, y] = p(gx, gy)
    s += `<text class="hood big" x="${n(x)}" y="${n(y)}" text-anchor="middle">${name}</text>`
  }
  for (const d of DISTRICTS) {
    const [gx, gy, z, anchor] = SITES[d].label
    const [x, y] = p(gx, gy, z)
    const on = active.has(d)
    const cls = `lbl${on ? ' on' : MIDTOWN.has(d) ? ' minor' : ''}`
    const fill = on ? ACCENT[d] : mix(ACCENT[d], '#e2e8f0', 0.5)
    s += `<text class="${cls}" x="${n(x)}" y="${n(y)}" text-anchor="${anchor ?? 'middle'}" style="fill:${fill}">${LABELS[d].toUpperCase()}</text>`
  }
  return s
}
