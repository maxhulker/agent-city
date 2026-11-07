import type { Burb, Census, District, Landmark, Launch, Repo, World } from '../types.ts'
import { ACCENT, BLUEPRINTS, FIREWORKS_MS, LABELS, MIDTOWN, S, SCAFFOLD_MS, SITES, T, blocksFor, burbGeo, esc, frame, isWaiting, hash, item, keyed, n, p, padFor, padOf, pts, r, seeded, shiftFor, spotOf, waitAt, dayOf, usd } from './geo.ts'
import type { OverlayItem, Pt, Scene } from './geo.ts'
import { ORIGINS, SIZES, boroughAt, boroughRect, doorOf as doorOfHall, terrainOf, cellsOf, cityBuildings, deltaOf, footprintOf, groupOf, partName, isBridge, lotsOf, roomOf, seamCrossings, siteFor, trackOf } from '../layout.ts'
import type { Borough, Building, Kind, Layout } from '../layout.ts'
import { blueprintPlots, lotHouses, placeBlocks, signLine, slotsOf, weatherOf } from './blocks.ts'
import { unbuilt } from '../blueprints.ts'
import type { Placed } from './blocks.ts'
import { censusShape } from '../census.ts'
import { costOf, signCost } from '../costs.ts'
import type { Cost } from '../costs.ts'

// The city itself, in two layers (docs/frames.md): the still map (water, land,
// streets, buildings, the landmarks' bodies, bridges, trees, names), which
// changes only when something is built or a borough moves, and the overlay of
// everything that lights up or moves (district pads and labels, smoke and
// sparks, scaffolding, beacons, cars and boats, the Statue, fireworks), as
// keyed items the page replaces one at a time.

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
  `.lamp,.lamph{fill:none;stroke-linecap:round;stroke-dasharray:0 11.18}` +
  `.lamp{stroke:#ffe6a8;stroke-width:1.1px}.lamph{stroke:#ffb347;stroke-width:3.6px;opacity:.15}` +
  `.zebra{fill:none;stroke:#cbd5e1;stroke-width:1.1px;stroke-dasharray:.5 .5;opacity:.4}` +
  `.scaf{fill:none;stroke:#cdb27a;stroke-width:.45px}.plank{fill:none;stroke:#a16207;stroke-width:1px}` +
  `.refl{fill:none;stroke-linecap:round}` +
  `.glow,.sky{pointer-events:none}.city.z4 .haze{opacity:.18}` +
  // Blueprint captions keep their size on screen; the hint waits for a zoom.
  `.bp .tx{transform:scale(var(--zt,1))}` +
  `.bpn{font-size:7.5px;font-weight:700;letter-spacing:.1em;fill:#7dd3fc;paint-order:stroke;stroke:#0b1224;stroke-width:2.6px;stroke-linejoin:round}` +
  `.bph{font-size:7px;font-weight:500;fill:#bae6fd;paint-order:stroke;stroke:#0b1224;stroke-width:2.2px;stroke-linejoin:round;opacity:.9}` +
  `.city:not(.z2) .bph{display:none}` +
  `.rails{fill:none;stroke:#b6bec9;stroke-width:.7px}.ties{fill:none;stroke:#7a6648;stroke-width:2.2px;stroke-dasharray:.7 1.1}`

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
  return boxFaces(x0, y0, w, d, h, pal, z).map(partSvg).join('')
}

// One flat piece of the city's fabric (see compose): a face with its fill
// and path, or other markup, with the outline it covers on screen (convex).
export type Part = { fill: string; d: string; pts: Pt[] } | { svg: string; pts: Pt[] }

const partSvg = (f: Part) => ('svg' in f ? f.svg : `<path ${f.fill} d="${f.d}"/>`)

// A box's three faces, each drawn just as box() always drew it (whole
// pixels), with the outline that drawing covers. All three run the same way
// round, so faces of one fill overlapping in one path still fill (nonzero).
function boxFaces(x0: number, y0: number, w: number, d: number, h: number, pal: Pal, z = 0): Part[] {
  const [ax, ay] = p(x0, y0 + d, z)
  const wx = Math.round(w * S)
  const wy = Math.round(w * T)
  const dx = Math.round(d * S)
  const dy = Math.round(d * T)
  const hh = Math.round(h)
  const AX = Math.round(ax)
  const AY = Math.round(ay)
  const BX = Math.round(ax + w * S)
  const BY = Math.round(ay + w * T)
  const TY = Math.round(ay - h)
  return [
    { fill: `class="${pal}L"`, d: `M${AX} ${AY}l${wx} ${wy}v-${hh}l-${wx} -${wy}z`, pts: [[AX, AY], [AX + wx, AY + wy], [AX + wx, AY + wy - hh], [AX, AY - hh]] },
    { fill: `class="${pal}R"`, d: `M${BX} ${BY}l${dx} -${dy}v-${hh}l-${dx} ${dy}z`, pts: [[BX, BY], [BX + dx, BY - dy], [BX + dx, BY - dy - hh], [BX, BY - hh]] },
    { fill: `class="${pal}T"`, d: `M${AX} ${TY}l${wx} ${wy}l${dx} -${dy}l-${wx} -${wy}z`, pts: [[AX, TY], [AX + wx, TY + wy], [AX + wx + dx, TY + wy - dy], [AX + dx, TY - dy]] },
  ]
}

// The same three faces in plain colours, for a house with its windows out.
function slabFaces(x0: number, y0: number, w: number, d: number, h: number, [cl, cr, ct]: [string, string, string]): Part[] {
  const a = p(x0, y0 + d)
  const b = p(x0 + w, y0 + d)
  const c = p(x0 + w, y0)
  const e = p(x0, y0)
  const up = ([x, y]: Pt): Pt => [x, y - h]
  const at = (list: Pt[], fill: string): Part => {
    const q = list.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt)
    return { fill: `fill="${fill}"`, d: 'M' + q.map(([x, y]) => `${x} ${y}`).join('L') + 'z', pts: q }
  }
  return [at([a, b, up(b), up(a)], cl), at([b, c, up(c), up(b)], cr), at([up(a), up(b), up(c), up(e)], ct)]
}

// A rectangle on screen as an outline.
const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

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
// A building is drawn at its kind's drawing origin and moved to where it
// stands by one translate (the projection is affine): in screen units for
// projected markup, in cells for markup inside the GRID group. Nothing is
// wrapped when it stands at the origin, so its markup is unchanged.
function sh(svg: string, [dx, dy]: [number, number]): string {
  if (!svg || (!dx && !dy)) return svg
  return `<g transform="translate(${n((dx - dy) * S)},${n((dx + dy) * T)})">${svg}</g>`
}

function gsh(svg: string, [dx, dy]: [number, number]): string {
  if (!svg || (!dx && !dy)) return svg
  return `<g transform="translate(${n(dx)},${n(dy)})">${svg}</g>`
}

// Does a building of this kind stand in the city (not a lot)?
function standing(sc: Scene, kind: Kind): boolean {
  return cityBuildings(sc.layout, kind).some(b => b.built !== undefined)
}

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

// A mast on a roof. Its blinking light is the overlay's (spireLights), so the
// map holds nothing that animates.
function spire(gx: number, gy: number, z: number, len: number): string {
  const [x, y] = p(gx, gy, z)
  return `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - len)}" stroke="#cbd5e1" stroke-width="1.2"/>`
}

function spireLight(gx: number, gy: number, z: number, len: number, light = '#f87171'): string {
  const [x, y] = p(gx, gy, z)
  return `<circle cx="${n(x)}" cy="${n(y - len)}" r="1.6" fill="${light}"><animate attributeName="opacity" values="1;.15;1" dur="1.5s" repeatCount="indefinite"/></circle>`
}

// The spires' lights: One World Trade's always, the Chrysler's (on the
// station) and the Crown Tower's once they stand, each with its building.
function spireLights(sc: Scene): string {
  let g = ''
  for (const b of sc.layout.buildings) {
    if (b.kind === 'wtc') g += sh(spireLight(4.55, 57.55, 92, 18), deltaOf(b))
    else if (b.kind === 'station' && standing(sc, 'relay')) g += sh(spireLight(12.575, 39.5, 73, 9, '#e2e8f0'), deltaOf(b))
    else if (b.kind === 'empire' && b.built !== undefined) g += sh(spireLight(7.8, 42.5, 83, 15), deltaOf(b))
  }
  return g
}

export function tree(gx: number, gy: number, r: number): string {
  const [x, y] = p(gx, gy)
  return `<circle cx="${n(x)}" cy="${n(y - r)}" r="${n(r)}" fill="${seeded(gx, gy) > 0.5 ? '#166534' : '#15803d'}"/>`
}

// Scaffolding hugging a box's two visible walls, a hoist running up its side
// and a tower crane slewing on the roof: someone is editing in there. Without
// the crane, just the scaffolding: work started and not yet committed.
export function scaffold(x0: number, y0: number, w: number, d: number, h: number, crane = true): string {
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
  if (!crane) return g
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

// The items, back to front, in as few elements as keeps the picture the same.
// Every building used to be three paths, each wall filled with its window
// pattern, and the GPU paid for each one every time the view settled. Now
// each face goes in a layer: above every face it overlaps in another fill,
// level with one it overlaps in its own (one path of one fill paints the same
// pixels in any order). Faces that never overlap may share a layer whatever
// their order, so each layer is one path per fill. An item without parts (a
// landmark, a caption) is drawn whole, over all before it and under all after.
export function compose(items: Item[]): string {
  type Laid = { part: Part; fill: string; layer: number; bb: [number, number, number, number] }
  const layers: Part[][] = []
  let laid: Laid[] = []
  let floor = 0
  for (const it of items) {
    if (!it.parts) {
      const layer = Math.max(floor, layers.length)
      layers[layer] = [{ svg: it.svg, pts: [] }]
      floor = layer + 1
      laid = []
      continue
    }
    for (const part of it.parts) {
      const fill = 'fill' in part ? part.fill : ''
      const bb = boundsOf(part.pts)
      let layer = floor
      for (const o of laid) {
        // Only what would lift it higher is worth the overlap test.
        if (o.layer + 1 <= layer) continue
        if (o.bb[0] >= bb[2] || bb[0] >= o.bb[2] || o.bb[1] >= bb[3] || bb[1] >= o.bb[3]) continue
        if (!overlaps(o.part.pts, part.pts)) continue
        layer = Math.max(layer, fill && fill === o.fill ? o.layer : o.layer + 1)
      }
      laid.push({ part, fill, layer, bb })
      ;(layers[layer] ??= []).push(part)
    }
  }
  let s = ''
  for (const group of layers) {
    if (!group) continue
    const fills = new Map<string, string>()
    let rest = ''
    for (const part of group) {
      if ('fill' in part) fills.set(part.fill, (fills.get(part.fill) ?? '') + part.d)
      else rest += part.svg
    }
    for (const [fill, d] of fills) s += `<path ${fill} d="${d}"/>`
    s += rest
  }
  return s
}

function boundsOf(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}

// Whether two convex outlines share any area (separating axes); sharing only
// an edge or a corner is not overlapping.
export function overlaps(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]!
      const [x2, y2] = poly[(i + 1) % poly.length]!
      const nx = y2 - y1
      const ny = x1 - x2
      const len = Math.hypot(nx, ny)
      if (!len) continue
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity
      for (const [x, y] of a) { const v = (x * nx + y * ny) / len; amin = Math.min(amin, v); amax = Math.max(amax, v) }
      for (const [x, y] of b) { const v = (x * nx + y * ny) / len; bmin = Math.min(bmin, v); bmax = Math.max(bmax, v) }
      if (amax <= bmin + 0.01 || bmax <= amin + 0.01) return false
    }
  }
  return true
}

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

// Something drawn back to front. With parts, compose may merge it with its
// neighbours; without, it is drawn whole, over everything before it.
export type Item = { depth: number; svg: string; parts?: Part[] }

// Ground to keep in view: [gx0, gy0, gx1, gy1, how much of it may hide].
export type Keep = [number, number, number, number, number]

// Where each district's agents mostly stand, and the low landmarks behind
// them, which the buildings in front must not hide (the landmarks' lower half
// may go). Each moves with its building.
function keeps(sc: Scene): Keep[] {
  const list: Keep[] = []
  for (const d of DISTRICTS) {
    if (d === 'plaza' || !siteFor(sc.layout, d)) continue
    const shift = shiftFor(sc.layout, d)
    const [sx, sy] = spotOf(d, shift)
    list.push([sx - 0.9, sy - 0.1, sx + 0.9, padOf(d, shift)[3] - 0.1, 1])
  }
  const low: [Kind, Keep][] = [
    ['plaza', [5.9, 27.4, 8.1, 30.3, 1]], // the Great Lawn
    ['hall', [8.0, 55.3, 9.25, 55.7, 5]], // City Hall
    ['library', [7.25, 39.2, 8.75, 39.8, 6]], // the Library
    ['station', [9.35, 39.22, 11.75, 39.78, 6]], // Central Station
    ['harbor', [12.7, 57.2, 14.65, 57.8, 4]], // the Seaport
  ]
  for (const [kind, [x0, y0, x1, y1, slack]] of low) {
    for (const b of cityBuildings(sc.layout, kind)) {
      if (b.size) continue
      const [dx, dy] = deltaOf(b)
      list.push([x0 + dx, y0 + dy, x1 + dx, y1 + dy, slack])
    }
  }
  // A park of another size keeps its lawn in view.
  for (const b of cityBuildings(sc.layout, 'plaza')) {
    if (!b.size) continue
    const [x0, y0, x1, y1] = cellsOf(b)[0]!
    const inset = 0.3 + roomOf(b) * 0.3
    list.push([x0 + inset, y0 + inset, x1 - inset, y1 - inset, 1])
  }
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

// `top`, a colour for its roof instead of its palette's (a section's houses).
function building(items: Item[], x0: number, y0: number, w: number, d: number, h: number, pal: Pal, q: number, keep: Keep[], top?: string) {
  h = Math.min(h, Math.max(3, capFor(x0, y0, w, d, keep)))
  let parts: Part[]
  let roof = h
  let rx = x0 + w / 2
  let ry = y0 + d / 2
  if (pal === 'g' && h > 40 && q > 0.45) {
    // A setback tower: a broad base, a slimmer top.
    const base = Math.round(h * 0.68)
    parts = [...boxFaces(x0, y0, w, d, base, pal), ...boxFaces(x0 + w * 0.18, y0 + d * 0.18, w * 0.64, d * 0.64, h - base, pal, base)]
  } else {
    parts = boxFaces(x0, y0, w, d, h, pal)
  }
  if (top) parts = parts.map(f => ('fill' in f && f.fill === `class="${pal}T"` ? { ...f, fill: `fill="${top}"` } : f))
  // Rooftops: water towers on the older blocks, masts on the towers.
  const t = seeded(x0 * 3.1, y0 * 7.3)
  const kit = pal !== 'g' && h < 40 && w > 0.5 && t < 0.06 ? 'wt' : pal === 'g' && h > 46 && t > 0.62 ? 'ant' : h > 12 && t > 0.4 && t < 0.46 ? 'ac' : ''
  if (kit === 'wt') rx = x0 + w * (0.3 + t * 4)
  if (kit) {
    const [ux, uy] = p(rx, ry, roof).map(v => Math.round(v * 10) / 10) as Pt
    // What #wt, #ant and #ac reach from where they stand, and a little more.
    parts.push({ svg: `<use href="#${kit}" x="${ux}" y="${uy}"/>`, pts: rectPts(ux - 2.6, uy - 13, ux + 2.6, uy + 1.6) })
  }
  items.push({ depth: x0 + y0 + 0.82, svg: parts.map(partSvg).join(''), parts })
}

// The filler blocks on the zoned lots, as many as the population has earned
// (all of them once the city is full), in zoning order.
// What a zoned lot fills with: the city's towers, or, inside a borough, a
// row of brownstones.
export function lotStyle(layout: Layout, x: number, y: number): 'towers' | 'houses' {
  return boroughAt(layout, x, y) ? 'houses' : 'towers'
}

// The boroughs whose repository has a census: their lots stand for its
// folders, whatever the population.
function censused(sc: Scene): Map<Burb, Census> {
  const out = new Map<Burb, Census>()
  for (const [b, repo] of [...sc.vacantOf, ...sc.repoOf]) if (repo.census && burbGeo(sc.layout, b)) out.set(b, repo.census)
  return out
}

// A house of the census: lit windows for a folder worked on lately, dark
// ones for a quiet folder, nothing on an empty plot.
export function censusHouse(s: Placed, keep: Keep[]): string {
  if (s.block < 0) return ''
  if (s.lit) return box(s.x, s.y0, s.w, s.d, s.h, s.pal)
  const h = Math.min(s.h, Math.max(3, capFor(s.x, s.y0, s.w, s.d, keep)))
  return slab(s.x, s.y0, s.w, s.d, h, DARK[s.pal])
}

// A palette with its windows out.
const DARK = Object.fromEntries(Object.entries(PALETTES).map(([k, cols]) => [k, cols.map(c => mix(c, '#0b1020', 0.35))])) as Record<Pal, [string, string, string]>

function fabric(items: Item[], sc: Scene) {
  const keep = keeps(sc)
  const all = lotsOf(sc.layout)
  const earned = blocksFor(sc.population, all.length)
  const counted = censused(sc)
  all.forEach(({ x, y, x0, x1 }, i) => {
    if (i >= earned) return
    const q = seeded(x, y)
    const y0 = y + 0.18
    const d = 0.64
    if (lotStyle(sc.layout, x, y) === 'houses') {
      // A borough with a census builds its own (below).
      const bo = boroughAt(sc.layout, x, y)!
      if (counted.has(bo.id)) return
      const tint = sectionTint(sc.layout, bo.id)
      for (const s of lotHouses({ x, y, x0, x1 })) building(items, s.x, s.y0, s.w, s.d, s.h, s.pal, seeded(s.x, y), keep, tint && roofIn(s.pal, tint))
      return
    }
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
  })
  // A drawn borough with a census: its folders on its lots.
  // A section's roofs are in its colour (its walls keep their folders' palette).
  for (const [b, census] of counted) {
    const tint = sectionTint(sc.layout, b)
    for (const s of placeBlocks(slotsOf(sc.layout, b), census)) {
      if (s.block < 0) continue
      if (s.lit) building(items, s.x, s.y0, s.w, s.d, s.h, s.pal, 0, keep, tint && roofIn(s.pal, tint))
      else {
        const [cl, cr, ct] = DARK[s.pal]
        const parts = slabFaces(s.x, s.y0, s.w, s.d, Math.min(s.h, Math.max(3, capFor(s.x, s.y0, s.w, s.d, keep))), [cl, cr, tint ? mix(ct, tint, 0.4) : ct])
        items.push({ depth: s.x + s.y0 + 0.82, svg: parts.map(partSvg).join(''), parts })
      }
    }
  }
}

// The rails into the station, along the street behind its front and under
// the river, once the hooks are laid. None while the station is being moved.
function rails(sc: Scene): string {
  if (!cityBuildings(sc.layout, 'station').length) return ''
  const t = trackOf(sc.layout)
  const y = t.y + 0.16
  const ties = `M${xy(p(t.x0, y))}L${xy(p(t.x1, y))}`
  const left = `M${xy(p(t.x0, y - 0.1))}L${xy(p(t.x1, y - 0.1))}`
  const right = `M${xy(p(t.x0, y + 0.1))}L${xy(p(t.x1, y + 0.1))}`
  // The tunnel mouth at the shore.
  const [mx, my] = p(t.mouth, y)
  return `<g class="rails"><path class="ties" d="${ties}"/><path d="${left}${right}"/><path d="M${n(mx - 3)} ${n(my + 1)}a3 3 0 0 1 6 0z" fill="#0b1224" stroke="none"/></g>`
}

// A blueprint lot: the landmark's footprint in dashed cyan on the ground,
// its name and, zoomed in, the hint that says how to build it. The ground part
// is returned; the caption is pushed as an item so it lies over the ground.
function blueprint(
  items: Item[],
  id: Landmark,
  [x0, y0, x1, y1]: [number, number, number, number],
  name: string,
  // Where the caption goes when the lot's centre would collide with a
  // neighbour's, and whether it waits for a zoom (Midtown is tight).
  at?: [number, number, ('start' | 'end')?],
  minor = false,
): string {
  const m = 0.08
  let hatch = ''
  for (let t = 0.4; t < x1 - x0 + (y1 - y0); t += 0.4) {
    const ax = x0 + m + Math.min(t, x1 - x0 - 2 * m)
    const ay = y0 + m + Math.max(0, t - (x1 - x0 - 2 * m))
    const bx = x0 + m + Math.max(0, t - (y1 - y0 - 2 * m))
    const by = y0 + m + Math.min(t, y1 - y0 - 2 * m)
    if (ay <= y1 - m && bx <= x1 - m) hatch += `M${n(ax)} ${n(ay)}L${n(bx)} ${n(by)}`
  }
  const ground =
    `<rect x="${n(x0 + m)}" y="${n(y0 + m)}" width="${n(x1 - x0 - 2 * m)}" height="${n(y1 - y0 - 2 * m)}" rx=".1" fill="#38bdf8" fill-opacity=".07" stroke="#7dd3fc" stroke-opacity=".8" stroke-width=".06" stroke-dasharray=".3 .18"/>` +
    `<path d="${hatch}" stroke="#7dd3fc" stroke-opacity=".16" stroke-width=".03"/>`
  const [cx, cy] = at ? p(at[0], at[1]) : p((x0 + x1) / 2, (y0 + y1) / 2)
  const anchor = at?.[2] ?? 'middle'
  const caption =
    `<g class="bp${minor ? ' minor' : ''}" transform="translate(${n(cx)},${n(cy)})"><g class="tx">` +
    `<text class="bpn" y="-3" text-anchor="${anchor}">${esc(name.toUpperCase())}</text>` +
    `<text class="bph" y="7" text-anchor="${anchor}">${esc(BLUEPRINTS[id].hint)}</text></g></g>`
  // Over every building, like the district labels.
  items.push({ depth: 1e6, svg: caption })
  return ground
}

// Consecutive values grouped into runs [first, last + 1].
function runs(set: Set<number>): [number, number][] {
  const out: [number, number][] = []
  for (const v of [...set].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && last[1] === v) last[1] = v + 1
    else out.push([v, v + 1])
  }
  return out
}

// Streets and avenues from the layout's roads, on the sidewalk-grey island:
// lamps along the avenues, zebra crossings at the big intersections (never
// through a park).
function streets(sc: Scene): string {
  const { layout } = sc
  const avs = new Map<number, Set<number>>()
  const sts = new Map<number, Set<number>>()
  for (const [x, y, dir] of layout.roads) {
    const m = dir === 0 ? avs : sts
    const k = dir === 0 ? x : y
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(dir === 0 ? y : x)
  }
  const sorted = (m: Map<number, Set<number>>) => [...m.keys()].sort((a, b) => a - b)
  let st = ''
  for (const y of sorted(sts)) {
    for (const [a, b] of runs(sts.get(y)!)) st += `M${xy(p(a, y))}L${xy(p(b, y))}`
  }
  let av = ''
  let lamps = ''
  const span = new Map<number, [number, number][]>()
  for (const x of sorted(avs)) {
    for (const [first, last] of runs(avs.get(x)!)) {
      span.set(x, [...(span.get(x) ?? []), [first, last]])
      av += `M${xy(p(x, first))}L${xy(p(x, last))}`
      const l0 = Math.ceil((first + 0.1) * 2) / 2 + 0.25
      for (const side of [-0.24, 0.24]) lamps += `M${xy(p(x + side, l0))}L${xy(p(x + side, last - 0.1))}`
    }
  }
  let zebra = ''
  const rows = sorted(sts).filter(y => y % 4 === 0)
  const parks = layout.buildings.filter(b => b.kind === 'plaza').flatMap(b => cellsOf(b))
  const inPark = (x: number, y: number) => parks.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y > y0 - 1 && y < y1)
  for (const y of rows) {
    for (const x of sorted(avs)) {
      if (!(span.get(x) ?? []).some(([f, l]) => y >= f + 0.5 && y <= l - 0.5)) continue
      if (inPark(x, y)) continue
      zebra += `M${xy(p(x - 0.17, y - 0.19))}L${xy(p(x + 0.17, y - 0.19))}M${xy(p(x - 0.17, y + 0.19))}L${xy(p(x + 0.17, y + 0.19))}`
      zebra += `M${xy(p(x - 0.27, y - 0.1))}L${xy(p(x - 0.27, y + 0.1))}M${xy(p(x + 0.27, y - 0.1))}L${xy(p(x + 0.27, y + 0.1))}`
    }
  }
  // Roads the person laid over water: a deck with its shadow on the water
  // and railings, under the roadway.
  let deck = ''
  for (const r of layout.roads) {
    if (!isBridge(layout, r)) continue
    const [x, y, dir] = r
    deck += dir === 0 ? `M${xy(p(x, y))}L${xy(p(x, y + 1))}` : `M${xy(p(x, y))}L${xy(p(x + 1, y))}`
  }
  const bridges = deck ? `<g class="deck" fill="none"><path d="${deck}" transform="translate(0 4)" stroke="#06101f" stroke-width="7" opacity=".6"/><path d="${deck}" stroke="#94a3b8" stroke-width="7"/><path d="${deck}" stroke="#334155" stroke-width="5"/></g>` : ''
  return (
    bridges +
    `<path class="road st" d="${st}"/><path class="road av" d="${av}"/><path class="cl" d="${av}"/>` +
    `<path class="zebra" d="${zebra}"/><path class="lamph" d="${lamps}"/><path class="lamp" d="${lamps}"/>`
  )
}

// Parks the person planted: lawn on each cell, and trees, two or three a
// cell, set back to front with the buildings.
function parks(items: Item[], sc: Scene): string {
  let lawn = ''
  for (const [y, x0, x1] of sc.layout.park) {
    for (let x = x0; x < x1; x++) {
      lawn += `M${n(x + 0.04)} ${n(y + 0.04)}h.92v.92h-.92z`
      const count = 2 + Math.floor(seeded(x, y) * 2)
      for (let i = 0; i < count; i++) {
        const gx = x + 0.2 + seeded(x + i, y * 3) * 0.6
        const gy = y + 0.2 + seeded(y + i, x * 3) * 0.6
        const rad = 1.3 + seeded(gx, gy) * 0.6
        const [tx, ty] = p(gx, gy)
        const svg = tree(gx, gy, rad)
        items.push({ depth: gx + gy, svg, parts: [{ svg, pts: rectPts(tx - rad - 0.5, ty - 2 * rad - 0.5, tx + rad + 0.5, ty + 0.5) }] })
      }
    }
  }
  return lawn ? `${GRID}<path class="lawn" d="${lawn}" fill="#1d4a2b"/></g>` : ''
}

// ---- districts ------------------------------------------------------------

// The lit ground where each district's agents stand, in its own colour, in
// front of its building wherever that is: the map draws every pad at rest,
// and padsLit adds the brighter look and the pulse of the ones someone is
// working in.
function pads(sc: Scene): string {
  let glows = ''
  let g = GRID
  for (const d of DISTRICTS) {
    if (!siteFor(sc.layout, d)) continue
    const c = ACCENT[d]
    const [x0, y0, x1, y1] = padFor(sc.layout, d)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    if (d === 'plaza') {
      // The Great Lawn itself is the pad: bare earth until the park is green.
      const lawn = standing(sc, 'plaza') ? '#2d7040' : '#4a4034'
      g += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n((x1 - x0) / 2)}" ry="${n((y1 - y0) / 2)}" fill="${lawn}" stroke="${c}" stroke-width=".07" stroke-opacity=".5"/>`
    } else {
      g += `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" rx=".22" fill="${c}" fill-opacity=".17" stroke="${c}" stroke-width=".06" stroke-opacity=".55"/>`
    }
    const [x, y] = p(cx, cy)
    const rad = d === 'plaza' ? 30 * roomOf(siteFor(sc.layout, d)) : 22
    glows += `<ellipse class="glow" cx="${n(x)}" cy="${n(y)}" rx="${n(rad * 2)}" ry="${n(rad)}" fill="url(#p-${d})" opacity=".5"/>`
  }
  return glows + g + '</g>'
}

function padsLit(sc: Scene): string {
  let glows = ''
  let g = ''
  for (const d of DISTRICTS) {
    if (!sc.active.has(d) || !siteFor(sc.layout, d)) continue
    const c = ACCENT[d]
    const [x0, y0, x1, y1] = padFor(sc.layout, d)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    if (d === 'plaza') {
      g += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n((x1 - x0) / 2)}" ry="${n((y1 - y0) / 2)}" fill="none" stroke="${c}" stroke-width=".07" stroke-opacity=".9"/>`
    } else {
      g += `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" rx=".22" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width=".06" stroke-opacity=".95"/>`
      g += `<rect x="${n(x0 + 0.12)}" y="${n(y0 + 0.08)}" width="${n(x1 - x0 - 0.24)}" height="${n(y1 - y0 - 0.16)}" rx=".16" fill="none" stroke="${c}" stroke-width=".04"><animate attributeName="opacity" values=".2;1;.2" dur="1.6s" repeatCount="indefinite"/></rect>`
    }
    const [x, y] = p(cx, cy)
    const rad = d === 'plaza' ? 30 * roomOf(siteFor(sc.layout, d)) : 22
    glows += `<ellipse class="glow" cx="${n(x)}" cy="${n(y)}" rx="${n(rad * 2)}" ry="${n(rad)}" fill="url(#p-${d})" opacity=".5"/>`
  }
  return g ? glows + GRID + g + '</g>' : ''
}

// Each district's lights wash over its buildings in its colour, brighter
// while someone works there.
function haze(sc: Scene): string {
  let s = ''
  for (const d of DISTRICTS) {
    if (!siteFor(sc.layout, d)) continue
    const [x0, y0, x1, y1] = padFor(sc.layout, d)
    const [x, y] = p((x0 + x1) / 2, (y0 + y1) / 2, 14)
    s += `<ellipse class="glow haze" cx="${n(x)}" cy="${n(y)}" rx="${d === 'plaza' ? n(70 * roomOf(siteFor(sc.layout, d))) : 46}" ry="${d === 'plaza' ? n(36 * roomOf(siteFor(sc.layout, d))) : 27}" fill="url(#p-${d})" opacity="${sc.active.has(d) ? 0.55 : 0.28}"/>`
  }
  return s
}

// The districts' names, in their own colours, brighter and bigger with work.
function labels(sc: Scene): string {
  let s = ''
  for (const d of DISTRICTS) {
    const site = siteFor(sc.layout, d)
    // A blueprint lot carries its own caption; the station always stands.
    if (!site || site.built === undefined) continue
    const [dx, dy] = deltaOf(site)
    const [gx, gy, z, anchor] = SITES[d].label
    // A building of another size: its name, under its middle.
    const sized = site.size ? SIZES[site.kind]?.[site.size] : undefined
    const [, , x1, y1] = cellsOf(site)[0]!
    const [x, y] = sized ? p(x1 - (x1 - site.x) / 2, y1 - 0.5, -2) : p(gx + dx, gy + dy, z)
    const on = sc.active.has(d)
    const cls = `lbl${on ? ' on' : MIDTOWN.has(d) || sized ? ' minor' : ''}`
    const fill = on ? ACCENT[d] : mix(ACCENT[d], '#e2e8f0', 0.5)
    s += `<text class="${cls}" x="${n(x)}" y="${n(y)}" text-anchor="${sized ? 'middle' : (anchor ?? 'middle')}" style="fill:${fill}">${esc((sized?.name ?? LABELS[d]).toUpperCase())}</text>`
  }
  return s
}

// ---- boroughs: one per other repository -----------------------------------

// The first house of each folder with uncommitted changes, for its scaffolding
// (three at most, the most changed first).
function dirtyHouses(placed: Placed[], census: Census | undefined): Placed[] {
  if (!census) return []
  const dirty = census.blocks.map((b, i) => [b.dirty, i] as const).filter(([d]) => d > 0).sort((a, b) => b[0] - a[0]).slice(0, 3)
  return dirty.flatMap(([, i]) => placed.filter(s => s.block === i).slice(0, 1))
}

// A borough's blueprints (src/blueprints.ts): on the free plots nearest the
// front, each planned folder's houses as a blue dashed footprint and a
// see-through wireframe, its name over the first.
function blueprintHouses(placed: Placed[], repo: Repo, census: Census, now: number): string {
  const planned = unbuilt(repo.blueprints, census, now)
  if (!planned.length) return ''
  let g = ''
  for (const { path, plots } of blueprintPlots(placed, planned.map(b => b.path))) {
    plots.forEach((i, k) => {
      const { x, y0, w, d } = placed[i]!
      const h = 7
      const base = [p(x, y0 + d), p(x + w, y0 + d), p(x + w, y0), p(x, y0)]
      const top = [p(x, y0 + d, h), p(x + w, y0 + d, h), p(x + w, y0, h), p(x, y0, h)]
      g += `<polygon points="${pts(base)}" fill="#0c4a6e" fill-opacity=".35" stroke="#7dd3fc" stroke-width=".4" stroke-dasharray="1.2 .8"/>`
      // The two walls you see and the roof, glass-thin; their edges in blue line.
      g += `<polygon points="${pts([base[0]!, base[1]!, top[1]!, top[0]!])}" fill="#38bdf8" fill-opacity=".12"/>`
      g += `<polygon points="${pts([base[1]!, base[2]!, top[2]!, top[1]!])}" fill="#38bdf8" fill-opacity=".07"/>`
      g += `<polygon points="${pts(top)}" fill="#7dd3fc" fill-opacity=".1" stroke="#7dd3fc" stroke-width=".45"/>`
      g += `<path d="M${xy(base[0]!)}L${xy(top[0]!)}M${xy(base[1]!)}L${xy(top[1]!)}M${xy(base[2]!)}L${xy(top[2]!)}M${xy(base[0]!)}L${xy(base[1]!)}L${xy(base[2]!)}" stroke="#7dd3fc" stroke-width=".45" fill="none"/>`
      if (k === 0) {
        const [lx, ly] = p(x + w / 2, y0 + d / 2, h + 3)
        g += `<text class="cap" x="${n(lx)}" y="${n(ly)}" text-anchor="middle" style="font-size:calc(4.5px*var(--zt,1));stroke-width:calc(1.8px*var(--zt,1));font-weight:700;fill:#7dd3fc">PLANNED · ${esc(path)}/</text>`
      }
    })
  }
  return `<g class="blueprints">${g}</g>`
}

// Every house of a weathered folder, back to front.
function weatheredHouses(placed: Placed[], census: Census, now: number): string {
  return placed
    .filter(h => h.block >= 0)
    .sort((a, b) => a.x + a.y0 - (b.x + b.y0))
    .map(h => weathered(h, weatherOf(census.blocks[h.block]!, now)))
    .join('')
}

// A house's age on its walls (weatherOf in src/draw/blocks.ts): ivy climbing
// its two walls, higher the older it is; planks nailed across its windows;
// and for a derelict one, its walls gone dark and streaked with rust.
function weathered(h: Placed, level: number): string {
  if (level <= 0) return ''
  const { x, y0, w, d } = h
  const fy = y0 + d + 0.01 // the front-left wall, along x
  const fx = x + w + 0.01 // the front-right wall, along y
  let g = ''
  if (level >= 3) {
    const dark = 'fill="#0b1020" opacity=".5"'
    g += `<polygon points="${pts([p(x, fy), p(x + w, fy), p(x + w, fy, h.h), p(x, fy, h.h)])}" ${dark}/>`
    g += `<polygon points="${pts([p(fx, y0 + d), p(fx, y0), p(fx, y0, h.h), p(fx, y0 + d, h.h)])}" ${dark}/>`
    for (const u of [0.3, 0.7]) g += `<path d="M${xy(p(x + w * u, fy, h.h - 0.5))}L${xy(p(x + w * u, fy, h.h * 0.35))}" stroke="#9a3412" stroke-width=".5" opacity=".7"/>`
  }
  if (level >= 2) {
    // Two planks across the front wall, a little askew.
    for (const [z, tilt] of [[0.62, 0.6], [0.38, -0.5]] as const) {
      const zz = h.h * z
      g += `<polygon points="${pts([p(x + 0.04, fy, zz - tilt), p(x + w - 0.04, fy, zz + tilt), p(x + w - 0.04, fy, zz + tilt + 1.1), p(x + 0.04, fy, zz - tilt + 1.1)])}" fill="#a16207" stroke="#713f12" stroke-width=".2"/>`
    }
  }
  // Ivy: leafy clumps up from the ground on both walls, seeded so a house keeps its own.
  const reach = Math.min(0.9, 0.25 + level * 0.2) * h.h
  const leaves: string[] = []
  for (let i = 0; i < 5 + level * 3; i++) {
    const q = seeded(x * 3.1 + i, y0 * 1.7 + i * 0.37)
    const q2 = seeded(y0 + i * 0.9, x + i)
    const onFront = i % 3 !== 2
    const z = q2 * reach
    const [cx, cy] = onFront ? p(x + 0.06 + q * (w - 0.12), fy, z) : p(fx, y0 + 0.06 + q * (d - 0.12), z)
    // Leaves a tenth of a house wide or so: the wall shows through them.
    const r = 0.45 + q * 0.45
    leaves.push(`<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r)}" ry="${n(r * 1.2)}" fill="${q > 0.5 ? '#166534' : '#22c55e'}" opacity="${q > 0.5 ? 0.95 : 0.8}"/>`)
  }
  // A stem up the front corner, to the highest leaves.
  g += `<path d="M${xy(p(x + 0.08, fy, 0))}L${xy(p(x + 0.1, fy, reach))}" stroke="#14532d" stroke-width=".6"/>`
  return `<g class="weather" opacity=".92">${g}${leaves.join('')}</g>`
}

// The line under a repository's sign, from its census: branch, sync, the
// fortnight's commits and what is uncommitted; then what it has cost to
// build so far (src/costs.ts), when anything.
function censusSign(x: number, y: number, census: Census | undefined, cost?: Cost): string {
  const built = cost ? `<tspan style="fill:#86efac">${census ? ' · ' : ''}${esc(signCost(cost.usd))} to build</tspan>` : ''
  if (!census) return built ? `<text class="cap" x="${n(x)}" y="${n(y)}" dy="1.6em" text-anchor="middle" style="font-size:calc(6px*var(--zt,1));stroke-width:calc(2.2px*var(--zt,1));font-weight:600">${built}</text>` : ''
  const [line, dirty] = signLine(census)
  const tail = dirty ? `<tspan style="fill:#fcd34d"> · ${esc(dirty)}</tspan>` : ''
  return `<text class="cap" x="${n(x)}" y="${n(y)}" dy="1.6em" text-anchor="middle" style="font-size:calc(6px*var(--zt,1));stroke-width:calc(2.2px*var(--zt,1));font-weight:600;fill:#94a3b8">${esc(line)}${tail}${built}</text>`
}

// A borough the person drew: its line on the ground, the square on its front
// edge where its agents gather, and its name at the back. Its houses come
// with zoning (docs/city-builder.md, step nine).
// A project with sections (other worktrees built onto its borough) is one
// place: the main borough draws a single line round all of them, and a
// seam where two meet. Each section is a branch off it, in a colour of its
// own (branchColor): its ground tinted, its own line and square in that
// colour, its spur street onto the project painted down the middle, and its
// own part of the name ("↳ TERRAIN") in the colour.
function drawnBurb(bo: Borough, layout: Layout): string {
  const [x0, y0, x1, y1] = boroughRect(bo)
  const [sx, sy] = burbGeo(layout, bo.id)!.square
  const half = Math.min(1.6, (x1 - x0) / 2 - 0.2)
  const group = groupOf(layout, bo.id)
  const main = group[0]!
  const color = main === bo ? undefined : branchColor(group, bo)
  let g = GRID
  if (group.length < 2) g += gRect(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 'none', ` rx=".2" stroke="#64748b" stroke-width=".06" stroke-dasharray=".35 .25"`)
  else if (main === bo) g += groupLine(group)
  if (color) g += gRect(x0 + 0.18, y0 + 0.18, x1 - 0.18, y1 - 0.18, color, ` fill-opacity=".1" rx=".2" stroke="${color}" stroke-opacity=".85" stroke-width=".07" stroke-dasharray=".5 .2"`)
  g += gRect(sx - half, sy - 0.6, sx + half, y1 - 0.15, color ? mix('#343944', color, 0.3) : '#343944', ` rx=".25" stroke="${color ?? '#3f4552'}" stroke-width=".05"`)
  g += '</g>'
  // A section's name goes over the houses, with its lights (drawnBurbLit).
  if (color) return g + spurLine(layout, bo, color)
  const [lx, ly] = p(x0 + (x1 - x0) / 2, y0 + 0.6, 30)
  g += `<text class="sign sb" x="${n(lx)}" y="${n(ly)}" dy="-1.7em" text-anchor="middle">${esc(bo.name.toUpperCase())}</text>`
  return g
}

// A section's colour, none for a borough that is no section.
function sectionTint(layout: Layout, id: string): string | undefined {
  const group = groupOf(layout, id)
  const bo = group.find(b => b.id === id)
  return bo && bo !== group[0] ? branchColor(group, bo) : undefined
}

// A roof of that palette, in a section's colour.
const roofIn = (pal: Pal, tint: string) => mix(PALETTES[pal][2], tint, 0.6)

// Each section's colour, by its place among its project's sections.
const BRANCH_COLORS = ['#2dd4bf', '#c084fc', '#f472b6', '#fbbf24', '#38bdf8', '#a3e635']
export function branchColor(group: Borough[], bo: Borough): string {
  return BRANCH_COLORS[Math.max(0, group.indexOf(bo) - 1) % BRANCH_COLORS.length]!
}

// A section's spur street onto its project: a line in its colour down the
// middle of the road where it crosses the seam, and a dot on the seam.
function spurLine(layout: Layout, bo: Borough, color: string): string {
  const roads = seamCrossings(layout, bo.id)
  if (!roads.length) return ''
  let d = ''
  for (const [x, y, dir] of roads) d += `M${xy(p(x, y))}L${xy(p(dir === 0 ? x : x + 1, dir === 0 ? y + 1 : y))}`
  return `<path class="spur" d="${d}" fill="none" stroke="${color}" stroke-width="1.3" stroke-dasharray="2.2 1.4" stroke-linecap="round" opacity=".95"/>`
}

// The line round a project's boroughs, in cells (inside GRID): every cell
// edge with one of them on one side and none on the other, joined into
// runs; a dotted seam along the edges two of them share; a faint tint over all.
function groupLine(group: Borough[]): string {
  const rects = group.map(boroughRect)
  const tints = group.map((bo, i) => (i === 0 ? '#94a3b8' : branchColor(group, bo)))
  const inAny = (x: number, y: number) => rects.some(([a, b, c, d]) => x >= a && x < c && y >= b && y < d)
  // Unit edges keyed by their line: along rows (y, from x) and along columns (x, from y).
  const rows = new Map<number, number[]>()
  const cols = new Map<number, number[]>()
  const add = (m: Map<number, number[]>, k: number, v: number) => m.set(k, [...(m.get(k) ?? []), v])
  for (const [a, b, c, d] of rects) {
    for (let x = a; x < c; x++) {
      if (!inAny(x, b - 1)) add(rows, b, x)
      if (!inAny(x, d)) add(rows, d, x)
    }
    for (let y = b; y < d; y++) {
      if (!inAny(a - 1, y)) add(cols, a, y)
      if (!inAny(c, y)) add(cols, c, y)
    }
  }
  let line = ''
  const runs = (m: Map<number, number[]>, seg: (k: number, from: number, to: number) => string) => {
    for (const [k, list] of m) {
      const vs = [...new Set(list)].sort((p, q) => p - q)
      let from = vs[0]!
      for (let i = 1; i <= vs.length; i++) {
        if (i < vs.length && vs[i] === vs[i - 1]! + 1) continue
        line += seg(k, from, vs[i - 1]! + 1)
        from = vs[i]!
      }
    }
  }
  runs(rows, (y, a, b) => `M${n(a)} ${n(y)}H${n(b)}`)
  runs(cols, (x, a, b) => `M${n(x)} ${n(a)}V${n(b)}`)
  // A seam in the colour of the section on its far side from the main borough.
  let seams = ''
  rects.forEach(([a0, b0, c0, d0], i) => {
    rects.slice(i + 1).forEach(([a1, b1, c1, d1], k) => {
      let seam = ''
      if (c0 === a1 || c1 === a0) {
        const from = Math.max(b0, b1), to = Math.min(d0, d1)
        if (to > from) seam += `M${n(c0 === a1 ? c0 : a0)} ${n(from)}V${n(to)}`
      }
      if (d0 === b1 || d1 === b0) {
        const from = Math.max(a0, a1), to = Math.min(c0, c1)
        if (to > from) seam += `M${n(from)} ${n(d0 === b1 ? d0 : b0)}H${n(to)}`
      }
      if (seam) seams += `<path d="${seam}" fill="none" stroke="${tints[i + 1 + k]}" stroke-width=".07" stroke-dasharray=".08 .18" stroke-linecap="round"/>`
    })
  })
  return (
    rects.map(([a, b, c, d], i) => gRect(a, b, c, d, tints[i]!, ` fill-opacity="${i === 0 ? '.05' : '.08'}"`)).join('') +
    seams +
    `<path d="${line}" fill="none" stroke="#94a3b8" stroke-width=".08" stroke-dasharray=".35 .25" stroke-linejoin="round"/>`
  )
}

// A drawn borough's lit side: its repository's name under the borough's,
// and the square lit while someone works there.
function drawnBurbLit(bo: Borough, repo: Repo | undefined, sc: Scene): string {
  const [x0, y0, x1, y1] = boroughRect(bo)
  const [sx, sy] = burbGeo(sc.layout, bo.id)!.square
  const half = Math.min(1.6, (x1 - x0) / 2 - 0.2)
  const here = (sc.byBurb.get(bo.id) ?? []).filter(a => a.status !== 'done')
  const isActive = here.some(a => a.status === 'working')
  let g = ''
  // A section's name, in its colour, over its houses so none hides it.
  const tint = sectionTint(sc.layout, bo.id)
  if (tint) {
    const [lx, ly] = p(x0 + (x1 - x0) / 2, y0 + 0.6, 30)
    const part = partName(bo.name, groupOf(sc.layout, bo.id)[0]!.name)
    g += `<text class="sign sb" x="${n(lx)}" y="${n(ly)}" dy="-1.7em" text-anchor="middle" style="fill:${tint}">${esc(`↳ ${part}`.toUpperCase())}</text>`
  }
  if (isActive) {
    g += glow(sx, sy, 34)
    g += GRID + gRect(sx - half, sy - 0.6, sx + half, y1 - 0.15, 'none', ` rx=".25" stroke="#fde68a" stroke-width=".05"`) + '</g>'
  }
  const census = repo?.census
  if (census) {
    const isBuilding = here.some(a => a.at === 'workshop')
    g += weatheredHouses(placeBlocks(slotsOf(sc.layout, bo.id), census), census, sc.now)
    if (repo) g += blueprintHouses(placeBlocks(slotsOf(sc.layout, bo.id), census), repo, census, sc.now)
    dirtyHouses(placeBlocks(slotsOf(sc.layout, bo.id), census), census).forEach((h, i) => (g += scaffold(h.x, h.y0, h.w, h.d, h.h, isBuilding && i === 0)))
  }
  if (repo) {
    const [lx, ly] = p(x0 + (x1 - x0) / 2, y0 + 0.6, 30)
    g += `<text class="sign" x="${n(lx)}" y="${n(ly)}" text-anchor="middle" style="fill:${isActive ? '#fde68a' : '#e2e8f0'}">${esc(repo.name)}</text>`
    g += censusSign(lx, ly, census, costOf(sc.costs ?? new Map(), repo.root))
  }
  return g
}

// The sign on the station's forecourt over the agents of repositories that
// have no borough yet.
function waitingSign(sc: Scene): string {
  const names = [...sc.repoOf].filter(([b]) => isWaiting(b)).map(([, r]) => r.name)
  if (!names.length) return ''
  const [gx, gy] = waitAt(sc.layout, 0)
  const [x, y] = p(gx + 0.7, gy, 22)
  let g = `<g class="waiting">`
  g += `<text class="sign sb" x="${n(x)}" y="${n(y)}" dy="-1.7em" text-anchor="middle">WAITING FOR A BOROUGH</text>`
  g += `<text class="sign" x="${n(x)}" y="${n(y)}" text-anchor="middle" style="fill:#fde68a">${esc(names.join(' · '))}</text>`
  return g + '</g>'
}

// ---- landmarks ------------------------------------------------------------

// Billboard colours.
const NEON = ['#f43f5e', '#22d3ee', '#a3e635', '#f59e0b', '#c084fc', '#fb7185', '#38bdf8']

// The pieces of the landmarks that light up with work, drawn in the "off"
// state on the map and again, lit and animated, by the overlay.

// Neon Square's screens, on the south and east walls of its towers.
function billboards(live: boolean): string {
  let g = ''
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
  return g
}

// The ball on Neon Square's tallest tower, in the district's pink.
function ball(live: boolean): string {
  const [bx, by] = p(5.61, 37.5, 54)
  return `<circle cx="${n(bx)}" cy="${n(by - 9)}" r="2.6" fill="${ACCENT.observatory}" stroke="#fff" stroke-width=".5">${live ? '<animate attributeName="r" values="2.4;3.2;2.4" dur="1s" repeatCount="indefinite"/>' : ''}</circle>`
}

// The Library's reading room windows, lit blue while someone reads.
function readingRoom(live: boolean): string {
  return face(
    [
      [7.85, 39.86, 4],
      [8.15, 39.86, 4],
      [8.15, 39.86, 11],
      [7.85, 39.86, 11],
    ],
    live ? ACCENT.library : '#33415a',
    '',
    live ? '<animate attributeName="opacity" values="1;.55;1" dur="1.4s" repeatCount="indefinite"/>' : '',
  )
}

// The MetLife sign along the top of the slab behind Central Station.
function metlife(live: boolean): string {
  return face(
    [
      [9.85, 38.82, 50],
      [10.95, 38.82, 50],
      [10.95, 38.82, 53],
      [9.85, 38.82, 53],
    ],
    live ? ACCENT.relay : '#64748b',
    ' opacity=".9"',
  )
}

// Central Station's three great arches, lit teal when messages fly.
function arches(live: boolean): string {
  const [ax, ay] = p(9.65, 39.78)
  let d = ''
  for (let i = 0; i < 3; i++) {
    const x = 4 + i * 6.4
    d += `M${n(x)} -2v-6.2a2.1 2.1 0 0 1 4.2 0v6.2z`
  }
  return `<path transform="translate(${n(ax)} ${n(ay)}) skewY(26.565)" d="${d}" fill="${live ? ACCENT.relay : '#24384a'}" stroke="#e7e5e4" stroke-width=".4">${live ? '<animate attributeName="opacity" values="1;.6;1" dur="1.2s" repeatCount="indefinite"/>' : ''}</path>`
}

// Rail Yards' crown lights, in the district's orange.
function yardsCrown(live: boolean): string {
  return face(
    [
      [3.3, 40.8, 62],
      [3.95, 40.8, 62],
      [3.95, 40.8, 66],
      [3.3, 40.8, 66],
    ],
    ACCENT.foundry,
    live ? '' : ' opacity=".6"',
    live ? '<animate attributeName="opacity" values="1;.4;1" dur="1s" repeatCount="indefinite"/>' : '',
  )
}

// The Vessel's copper lattice, brighter while the shell is busy.
function lattice(live: boolean): string {
  const [vx, vy] = p(2.6, 41.35)
  let d = ''
  for (let i = -3; i <= 3; i++) d += `M${n(vx + i * 1.2)} ${n(vy)}L${n(vx + i * 2.3 + 2.4)} ${n(vy - 12.5)}M${n(vx + i * 1.2)} ${n(vy)}L${n(vx + i * 2.3 - 2.4)} ${n(vy - 12.5)}`
  return `<path d="${d}" stroke="${live ? '#fdba74' : '#e07a2f'}" stroke-width=".5" opacity=".9"/>`
}

// The Seaport's crane, which slews while git is at work. Always the overlay's.
function crane(live: boolean): string {
  const [cx, cy] = p(14.2, 57.4)
  let g = `<g><line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - 30)}" stroke="#facc15" stroke-width="1.6"/><line x1="${n(cx)}" y1="${n(cy - 29)}" x2="${n(cx + 18)}" y2="${n(cy - 24)}" stroke="#facc15" stroke-width="1.6"/>`
  if (live) {
    g += `<animateTransform attributeName="transform" type="rotate" values="0 ${n(cx)} ${n(cy)};16 ${n(cx)} ${n(cy)};0 ${n(cx)} ${n(cy)}" dur="5s" repeatCount="indefinite"/>`
  }
  return g + `</g>`
}

// The flag over City Hall's dome, waving. Always the overlay's.
function flag(): string {
  const [dx, dy] = p(8.62, 55.5, 10)
  return `<path d="M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z" fill="#60a5fa"><animate attributeName="d" values="M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z;M${n(dx)} ${n(dy - 12)}l6 2.5l-6 .5z;M${n(dx)} ${n(dy - 12)}l6 1.5l-6 1.5z" dur="1.2s" repeatCount="indefinite"/></path>`
}

// The Crown Tower's crown: the colour of the busiest district, changing
// for the occasion; gold while an update waits.
function crownColor(sc: Scene): string {
  let busy: District | undefined
  let most = 0
  for (const [d, list] of sc.byDistrict) {
    const working = list.filter(a => a.status === 'working').length
    if (d !== 'plaza' && working > most) [busy, most] = [d, working]
  }
  return sc.update?.available ? '#fbbf24' : busy ? ACCENT[busy] : '#f8fafc'
}

// The box each kind's scaffolding hugs while it goes up, at its drawing origin.
const SCAFFOLDS: Partial<Record<Kind, [number, number, number, number, number][]>> = {
  observatory: [[5.25, 37.2, 0.72, 0.6, 54]],
  library: [[7.25, 39.2, 1.5, 0.58, 12]],
  relay: [[9.75, 38.25, 1.35, 0.55, 56]],
  workshop: [[5.25, 41.2, 1.5, 0.6, 22]],
  empire: [[7.4, 42.2, 0.8, 0.6, 64]],
  foundry: [[3.3, 40.25, 0.65, 0.55, 66]],
  hall: [[8.0, 55.28, 1.25, 0.42, 9]],
  harbor: [[12.7, 57.2, 0.9, 0.6, 8]],
}

// Everything that moves or lights up on the landmarks: one overlay item per
// building, keyed by its id and hashed by its markup (none of it holds the
// clock), so a frame that changes nothing leaves its animations running.
// Each is drawn at its kind's drawing origin and shifted to its building.
function landmarkLights(sc: Scene): OverlayItem[] {
  const out: OverlayItem[] = []
  const on = (d: District) => sc.active.has(d)
  const isRising = (b: Building) => b.built !== undefined && sc.now - b.built < SCAFFOLD_MS
  const relayRising = sc.layout.buildings.some(b => b.kind === 'relay' && !b.burb && isRising(b))
  for (const b of sc.layout.buildings) {
    const built = b.built !== undefined
    const rising = isRising(b)
    const scaf = rising ? (SCAFFOLDS[b.kind] ?? []).map(box => scaffold(...box)).join('') : ''
    let g = ''
    switch (b.kind) {
      case 'observatory':
        g = built ? (on('observatory') ? billboards(true) + ball(true) : '') + scaf : ''
        break
      case 'library':
        g = built ? (on('library') ? readingRoom(true) : '') + scaf : ''
        break
      case 'relay':
        if (built) {
          if (on('relay')) {
            const [mx, my] = p(10.42, 38.52, 56)
            g += metlife(true) + rings(mx, my - 4, ACCENT.relay)
          }
          g += scaf
        }
        break
      case 'station':
        // The arches light with dispatch; the Chrysler's scaffolding rises with the towers.
        if (on('relay')) g += arches(true)
        if (relayRising && standing(sc, 'relay')) g += scaffold(12.3, 39.25, 0.55, 0.5, 60)
        break
      case 'workshop':
        g = built && (on('workshop') || rising) ? scaffold(5.25, 41.2, 1.5, 0.6, 22) + sparks(...p(6.75, 41.6, 10)) : ''
        break
      case 'empire':
        if (built) {
          const crown = crownColor(sc)
          if (sc.update?.available) {
            // A gold halo breathing around the tower.
            const [hx, hy] = p(7.8, 42.5, 50)
            g += `<ellipse cx="${n(hx)}" cy="${n(hy)}" rx="34" ry="60" fill="url(#halo)"><animate attributeName="opacity" values=".55;1;.55" dur="2s" repeatCount="indefinite"/></ellipse>`
          }
          g += slab(7.67, 42.42, 0.26, 0.16, 5, [crown, mix(crown, '#000000', 0.3), '#fff'], 78)
          g += scaf
        }
        break
      case 'foundry':
        if (built) {
          if (on('foundry')) {
            const [sx, sy] = p(1.6, 40.4)
            g += yardsCrown(true) + smoke(sx, sy - 26, '#cbd5e1') + lattice(true)
          }
          g += scaf
        }
        break
      case 'hall':
        g = built ? flag() + scaf : ''
        // A "?" goes up when something needs you, on the empty lot too.
        if (sc.isWaiting) {
          const [dx, dy] = p(8.62, 55.5, 10)
          g += beacon(dx, dy - 30, '#fbbf24', '?', sc.k)
        }
        break
      case 'harbor':
        g = built ? crane(on('harbor')) + scaf : ''
        // A merge conflict raises the alarm, on the empty lot too.
        if (sc.hasConflict) {
          const [fx, fy] = p(13.2, 57.5, 8)
          g += glow(13.6, 57.5, 34, 'alarm')
          if (built) g += smoke(fx, fy, '#f87171')
          g += beacon(fx, fy - 26, '#ef4444', '!', sc.k)
        }
        break
    }
    if (g) out.push(item(`lm:${b.id}`, sh(g, deltaOf(b))))
  }
  return out
}

// The landmarks' still bodies: each building drawn by its kind at the kind's
// drawing origin and shifted to where it stands (the projection is affine, so
// one translate moves it), its flat ground into `ground`, under everything,
// and its body as depth-sorted items. A lot while unbuilt.
function landmarks(items: Item[], sc: Scene): string {
  let ground = GRID
  for (const b of sc.layout.buildings) {
    const mine: Item[] = []
    const g = landmark(mine, sc, b)
    const d = deltaOf(b)
    for (const it of mine) items.push({ depth: it.depth + d[0] + d[1], svg: sh(it.svg, d) })
    ground += gsh(g, d)
  }
  return ground + '</g>'
}

// One building, at its kind's drawing origin: its ground (grid space) is
// returned, its items pushed. Only what is built matters here.
function landmark(items: Item[], sc: Scene, b: Building): string {
  let ground = ''
  const kind = b.kind
  const built = b.built !== undefined
  const add = (depth: number, svg: string) => items.push({ depth, svg })
  const trees = (list: [number, number, number][]) => {
    for (const [gx, gy, rad] of list) add(gx + gy, tree(gx, gy, rad))
  }
  // The game: a landmark not yet built is a blueprint lot.
  const lot = (box: [number, number, number, number], name: string, at?: [number, number, ('start' | 'end')?], minor = false) => {
    ground += blueprint(items, kind as Landmark, box, name, at, minor)
  }

  // A park of another size, drawn to fit its footprint: a path round the
  // edge, the lawn its agents rest on in the middle, trees between, and a
  // pond when there is room for one.
  if (kind === 'plaza' && b.size) {
    const [ox, oy] = ORIGINS.plaza
    const [[, , w, d]] = footprintOf(kind, b.size)
    const name = SIZES.plaza?.[b.size]?.name ?? LABELS.plaza
    if (!built) {
      ground += gRect(ox + 0.15, oy + 0.1, ox + w - 0.15, oy + d - 0.1, '#3b352c')
      lot([ox, oy, ox + w, oy + d], name)
    } else {
      const inset = 0.3 + roomOf(b) * 0.3
      ground += gRect(ox + 0.15, oy + 0.1, ox + w - 0.15, oy + d - 0.1, '#1d4b2c')
      ground += `<rect x="${n(ox + 0.4)}" y="${n(oy + 0.4)}" width="${n(w - 0.8)}" height="${n(d - 0.8)}" rx="${n(Math.min(w, d) * 0.25)}" fill="none" stroke="#4d5a45" stroke-width=".05"/>`
      const big = w * d >= 12
      const pond: [number, number, number, number] = [ox + w - 0.95, oy + 0.95, 0.42, 0.55]
      if (big) ground += `<ellipse cx="${n(pond[0])}" cy="${n(pond[1])}" rx="${n(pond[2])}" ry="${n(pond[3])}" fill="#1e4f86" stroke="#2f6aa8" stroke-width=".05"/>`
      const [lx, ly, rx, ry] = [ox + w / 2, oy + d / 2, w / 2 - inset, d / 2 - inset]
      const list: [number, number, number][] = []
      for (let i = 0; i < w * d * 3; i++) {
        const tx = ox + 0.25 + seeded(i, w * 7 + d) * (w - 0.5)
        const ty = oy + 0.25 + seeded(w * 7 + d, i) * (d - 0.5)
        if (((tx - lx) / rx) ** 2 + ((ty - ly) / ry) ** 2 < 1) continue
        if (big && ((tx - pond[0]) / (pond[2] + 0.2)) ** 2 + ((ty - pond[1]) / (pond[3] + 0.2)) ** 2 < 1) continue
        list.push([tx, ty, 1.8 + seeded(i, i) * 1.5])
      }
      trees(list)
    }
  }

  // Commons Park: the Reservoir, the Great Lawn (the plaza's pad), the Lake.
  else if (kind === 'plaza') if (!built) {
    // Bare ground, fenced off, until the first subagent comes to rest.
    ground += gRect(5.15, 22.1, 8.85, 34.9, '#3b352c')
    lot([5, 22, 9, 27], LABELS.plaza)
  } else {
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

  // Neon Square: towers wrapped in billboards around a pink-lit plaza with
  // the red steps; the screens cycle when someone is on the web.
  if (kind === 'observatory') if (!built) {
    lot([3, 37, 7, 38], LABELS.observatory)
  } else {
    ground += gRect(5.2, 38.15, 6.8, 38.85, '#3b2b40')
    // The red steps, at the plaza's south end.
    add(5.7 + 38.5 + 0.6, slab(5.75, 38.5, 0.7, 0.3, 3.2, ['#dc2626', '#991b1b', '#f87171']))
    let g = box(3.3, 37.2, 1.35, 0.6, 44, 'k')
    g += box(5.25, 37.2, 0.72, 0.6, 54, 'g')
    g += box(6.1, 37.25, 0.62, 0.5, 42, 'k')
    g += billboards(false)
    // The ball, on the tallest tower.
    const [bx, by] = p(5.61, 37.5, 54)
    g += `<path d="M${n(bx)} ${n(by)}v-7" stroke="#cbd5e1" stroke-width=".8"/>` + ball(false)
    add(37.2 + 5.25 + 1.3, g)
  }

  // The Public Library: a wide Beaux-Arts front with columns, its lions and
  // lamps, and Bryant Park across the street.
  if (kind === 'library') if (!built) {
    lot([7, 39, 9, 40], LABELS.library, [6.9, 41.1, 'start'])
  } else {
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
    g += readingRoom(false)
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

  // Central Station: three great arched windows, the clock and its statues, and
  // the Chrysler Building's crown beside it once the towers are built. The
  // terminal always stands (it is the way in).
  if (kind === 'station') {
    let g = box(9.35, 39.22, 2.4, 0.56, 13, 's')
    g += box(9.6, 39.3, 1.9, 0.38, 2.5, 's', 13)
    g += arches(false)
    // The clock and Mercury on top.
    const [kx, ky] = p(10.55, 39.5, 15.5)
    g += `<circle cx="${n(kx)}" cy="${n(ky - 2)}" r="2.2" fill="#fde68a" stroke="#a16207" stroke-width=".5"/><path d="M${n(kx - 3)} ${n(ky - 4)}l3 -4l3 4z" fill="#d6c7a1"/>`
    if (standing(sc, 'relay')) {
      // Chrysler: the stepped crown of arches, lit white.
      g += box(12.3, 39.25, 0.55, 0.5, 60, 'g')
      const [cx, cy] = p(12.575, 39.5, 60)
      g += `<path d="M${n(cx - 4.6)} ${n(cy)}Q${n(cx - 4.6)} ${n(cy - 9)} ${n(cx)} ${n(cy - 14)}Q${n(cx + 4.6)} ${n(cy - 9)} ${n(cx + 4.6)} ${n(cy)}z" fill="#cbd5e1"/>`
      g += `<path d="M${n(cx - 3.4)} ${n(cy - 2)}Q${n(cx - 3.4)} ${n(cy - 8)} ${n(cx)} ${n(cy - 11.5)}Q${n(cx + 3.4)} ${n(cy - 8)} ${n(cx + 3.4)} ${n(cy - 2)}M${n(cx - 2)} ${n(cy - 4)}Q${n(cx - 2)} ${n(cy - 7.4)} ${n(cx)} ${n(cy - 9.2)}Q${n(cx + 2)} ${n(cy - 7.4)} ${n(cx + 2)} ${n(cy - 4)}" fill="none" stroke="#fef3c7" stroke-width=".6"/>`
      g += spire(12.575, 39.5, 73, 9)
    }
    add(39.22 + 9.35 + 2.4, g)
  }

  // Central Station's towers: the MetLife slab behind the terminal, the game's.
  if (kind === 'relay') if (!built) {
    lot([9, 38, 11, 39], 'Towers', [10, 38.5], true)
  } else {
    let g = box(9.75, 38.25, 1.35, 0.55, 56, 'k')
    g += metlife(false)
    add(38.25 + 9.75 + 1.35, g)
  }

  // The Mill District: a loft with its water towers, the giant needle and
  // button in Herald Square, and scaffolding while someone is editing.
  if (kind === 'workshop') if (!built) {
    lot([5, 41, 7, 42], LABELS.workshop, [4.9, 43.1, 'end'])
  } else {
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

  // The Crown Tower. Its crown (z 78 to 83) is the overlay's: it
  // takes the colour of whichever district is busiest.
  if (kind === 'empire') if (!built) {
    lot([7, 42, 9, 43], 'Crown Tower', [8, 42.5], true)
  } else {
    let e = box(7.4, 42.2, 0.8, 0.6, 34, 's')
    e += box(7.52, 42.3, 0.56, 0.4, 30, 's', 34)
    e += box(7.62, 42.38, 0.36, 0.24, 14, 's', 64)
    e += spire(7.8, 42.5, 83, 15)
    add(42.2 + 7.4 + 1.4, e)
  }

  // Rail Yards: the rail yard, the Shed, two towers with the Edge's deck
  // jutting out, the copper Vessel, and a stack that smokes while the shell
  // is busy.
  if (kind === 'foundry') if (!built) {
    lot([1, 40, 5, 42], LABELS.foundry, [1.3, 42.9, 'end'])
  } else {
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
    g += yardsCrown(false)
    // The stack that smokes while the shell is busy.
    const [sx, sy] = p(1.6, 40.4)
    g += `<rect x="${n(sx - 2)}" y="${n(sy - 24)}" width="4" height="24" fill="#64748b"/><rect x="${n(sx - 2)}" y="${n(sy - 24)}" width="4" height="2" fill="${c}"/>`
    add(40.25 + 3.3 + 1.5, g)
    // The Vessel: a copper honeycomb cup.
    const [vx, vy] = p(2.6, 41.35)
    let v = `<path d="M${n(vx - 4)} ${n(vy)}L${n(vx - 7.5)} ${n(vy - 13)}L${n(vx + 7.5)} ${n(vy - 13)}L${n(vx + 4)} ${n(vy)}z" fill="#9a4a12"/>`
    v += `<ellipse cx="${n(vx)}" cy="${n(vy - 13)}" rx="7.5" ry="2.2" fill="#c2621a"/>`
    v += lattice(false)
    add(2.6 + 41.35, v)
  }

  // City Hall in its park, with the fountain, and the Gothic Tower.
  if (kind === 'hall') if (!built) {
    lot([7, 55, 10, 56], LABELS.hall)
  } else {
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
    for (const gx of [8.05, 9.2]) {
      const [x, y] = p(gx, 55.72)
      g += `<circle cx="${n(x)}" cy="${n(y - 6)}" r="1.1" fill="${c}"/>`
    }
    add(55.28 + 8.0 + 1.5, g)
  }
  // The City Treasury: a Federal Hall for the city's books, columns along its
  // steps under a pediment. Its board, with the day's spend, is the overlay's.
  if (kind === 'treasury') {
    ground += gRect(0.05, 0.05, 1.95, 0.95, '#3b3f48')
    let g = box(0.15, 0.1, 1.7, 0.6, 2, 's')
    g += box(0.25, 0.12, 1.5, 0.45, 7.5, 's', 2)
    g += box(0.2, 0.7, 1.6, 0.22, 0.8, 's')
    for (let i = 0; i < 6; i++) g += box(0.3 + i * 0.26, 0.6, 0.08, 0.08, 6.5, 's', 2)
    const a = p(0.18, 0.66, 9.5)
    const b = p(1.82, 0.66, 9.5)
    const top = p(1.0, 0.66, 13)
    g += `<path d="M${xy(a)}L${xy(top)}L${xy(b)}z" fill="#d6d3d1" stroke="#a8a29e" stroke-width=".3"/>`
    const [ex, ey] = p(1.0, 0.66, 10.6)
    g += `<circle cx="${n(ex)}" cy="${n(ey)}" r=".9" fill="#fbbf24"/>`
    add(0.1 + 0.15 + 1.7, g)
  }
  // The Gothic Tower: scenery, always there.
  if (kind === 'woolworth') {
    let w = box(5.5, 55.25, 0.9, 0.55, 40, 's')
    w += box(5.65, 55.35, 0.6, 0.35, 14, 's', 40)
    const [tx, ty] = p(5.95, 55.52, 54)
    w += `<path d="M${n(tx - 6)} ${n(ty)}L${n(tx)} ${n(ty - 12)}L${n(tx + 6)} ${n(ty)}z" fill="#3f7d6a"/>`
    w += `<path d="M${n(tx)} ${n(ty - 12)}v-5" stroke="#cbd5e1" stroke-width=".7"/>`
    add(55.25 + 5.5 + 1.4, w)
  }

  // Glass Tower.
  if (kind === 'wtc') {
    let g = box(4.2, 57.2, 0.7, 0.7, 84, 'g')
    const [x, y] = p(4.55, 57.55, 84)
    g += `<path d="M${n(x - 7)} ${n(y)}L${n(x)} ${n(y - 8)}L${n(x + 7)} ${n(y)}z" fill="#3b5a85"/>`
    g += spire(4.55, 57.55, 92, 18)
    add(57.2 + 4.2 + 1.4, g)
  }

  // South Street Seaport: the pier and its market shed, the tall ship, the
  // crane; red alarm and smoke on a merge conflict.
  if (kind === 'harbor') if (!built) {
    lot([11, 57, 15, 58], LABELS.harbor)
  } else {
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
    add(57.2 + 12.7 + 3, g)
  }
  return ground
}

// ---- water and sky --------------------------------------------------------

// A generated map's land, from its cells, with a smoothed shore (marching
// squares over the cells' centres): the shallows round every coast and up
// the rivers, a darker shore under the land, a sand rim, and inland the
// green rising into hills by the terrain's height. The city's island is green
// too, paved where its blocks are zoned and its buildings stand.
function generatedLand(layout: Layout): string {
  const seed = 'seed' in layout.map ? layout.map.seed : 0
  const heights = heightsOf(seed)
  const all = new Set<string>()
  layout.land.forEach(([y, x0, x1]) => {
    for (let x = x0; x < x1; x++) all.add(`${x},${y}`)
  })
  const at = (x: number, y: number) => all.has(`${x},${y}`)
  const near = (r: number) => {
    const out = new Set<string>()
    for (const c of all) {
      const [x, y] = c.split(',').map(Number) as [number, number]
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1) out.add(`${x + dx},${y + dy}`)
    }
    return out
  }
  // The land in from the beach: every neighbour is land too.
  const inner = new Set([...all].filter(c => {
    const [x, y] = c.split(',').map(Number) as [number, number]
    return at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)
  }))
  // Hills: the inland cells' heights in thirds of what is high on this map.
  const hs = [...inner].map(c => {
    const [x, y] = c.split(',').map(Number) as [number, number]
    return heights[y]?.[x] ?? 0
  }).sort((a, b) => a - b)
  const q = (f: number) => hs[Math.floor(f * (hs.length - 1))] ?? Infinity
  const band = (min: number) => new Set([...inner].filter(c => {
    const [x, y] = c.split(',').map(Number) as [number, number]
    return (heights[y]?.[x] ?? 0) >= min
  }))
  // Pavement: the zoned blocks and the buildings' ground.
  const paved = new Set<string>()
  for (const [x, y] of layout.zoned) for (const dx of [0, 1]) if (at(x + dx, y)) paved.add(`${x + dx},${y}`)
  for (const b of layout.buildings) for (const [x0, y0, x1, y1] of cellsOf(b)) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (at(x, y)) paved.add(`${x},${y}`)
  const shape = (cells: Set<string>, fill: string, extra = '') => (cells.size ? `<path d="${marching(cells)}" fill="${fill}" stroke="${fill}" stroke-width=".06" stroke-linejoin="round"${extra}/>` : '')
  // The shallows, blurred so they fade into the deep water.
  let s = `<filter id="shallows" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4"/></filter>`
  s += `<g filter="url(#shallows)">${GRID}${shape(near(3), '#0f2c55', ' opacity=".6"')}${shape(near(1), '#1b5590', ' opacity=".55"')}</g></g>`
  s += `<g class="shore" transform="translate(0 4)">${GRID}${shape(all, '#0d1a14')}</g></g>`
  s += GRID + shape(all, '#6f6446') + shape(inner, '#1b2e20')
  s += shape(band(q(0.55)), '#20372a') + shape(band(q(0.8)), '#2b3e2c') + shape(band(q(0.94)), '#45493a')
  s += shape(paved, '#30353f') + '</g>'
  return s
}

// A seed's terrain heights, kept: the drawing asks for them on each new map.
const heightCache = new Map<number, number[][]>()
function heightsOf(seed: number): number[][] {
  let h = heightCache.get(seed)
  if (!h) {
    h = terrainOf(seed).height
    if (heightCache.size > 8) heightCache.clear()
    heightCache.set(seed, h)
  }
  return h
}

// The outline of a set of cells ("x,y") as marching squares over their
// centres, traced into closed loops: each square on the shore is cut from
// edge middle to edge middle, the cuts are joined end to end, and a straight
// run of them is one segment. A coast is one loop (a lake runs the other way
// round, so it stays a hole under the nonzero rule), never a piece per square:
// a path of thousands of touching pieces cost the GPU most of a frame each
// time the view settled.
export function marching(cells: Set<string>): string {
  if (!cells.size) return ''
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number) as [number, number]
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const at = (x: number, y: number) => cells.has(`${x},${y}`)
  // Points in half cells (doubled), so they key exactly. Each cut runs with
  // the land on its right: an edge middle starts one cut and ends another.
  const next = new Map<string, [number, number]>()
  for (let j = y0 - 1; j <= y1; j++) {
    for (let i = x0 - 1; i <= x1; i++) {
      // The square between the centres of (i, j), (i+1, j), (i+1, j+1), (i, j+1),
      // walked clockwise (y runs down): its land corners and the edge middles
      // where land turns to water. Two middles in a row are a cut.
      const tl = at(i, j)
      const tr = at(i + 1, j)
      const br = at(i + 1, j + 1)
      const bl = at(i, j + 1)
      if (tl === tr && tr === br && br === bl) continue
      const cx = 2 * i + 1
      const cy = 2 * j + 1
      const ring: [number, number, boolean][] = []
      if (tl) ring.push([cx, cy, false])
      if (tl !== tr) ring.push([cx + 1, cy, true])
      if (tr) ring.push([cx + 2, cy, false])
      if (tr !== br) ring.push([cx + 2, cy + 1, true])
      if (br) ring.push([cx + 2, cy + 2, false])
      if (br !== bl) ring.push([cx + 1, cy + 2, true])
      if (bl) ring.push([cx, cy + 2, false])
      if (bl !== tl) ring.push([cx, cy + 1, true])
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % ring.length]!
        if (a[2] && b[2]) next.set(`${a[0]},${a[1]}`, [b[0], b[1]])
      })
    }
  }
  let d = ''
  const done = new Set<string>()
  for (const start of next.keys()) {
    if (done.has(start)) continue
    const loop: [number, number][] = []
    for (let k: string | undefined = start; k !== undefined && !done.has(k);) {
      done.add(k)
      const to: [number, number] | undefined = next.get(k)
      loop.push(k.split(',').map(Number) as [number, number])
      k = to && `${to[0]},${to[1]}`
    }
    // Only the turns: a point on a straight line between its neighbours goes.
    const pts = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length]!
      const b = loop[(i + 1) % loop.length]!
      return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0])
    })
    if (pts.length >= 3) d += 'M' + pts.map(([x, y]) => `${n(x / 2)} ${n(y / 2)}`).join('L') + 'z'
  }
  return d
}

// The previous outline, a piece per square, kept to check the traced one
// against (test/terrain.test.ts).
export function marchingPieces(cells: Set<string>): string {
  if (!cells.size) return ''
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number) as [number, number]
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const at = (x: number, y: number) => cells.has(`${x},${y}`)
  let d = ''
  for (let j = y0 - 1; j <= y1; j++) {
    let run = -1
    for (let i = x0 - 1; i <= x1 + 1; i++) {
      // The square between the centres of (i, j), (i+1, j), (i+1, j+1), (i, j+1).
      const tl = at(i, j)
      const tr = at(i + 1, j)
      const br = at(i + 1, j + 1)
      const bl = at(i, j + 1)
      const full = tl && tr && br && bl
      if (full) {
        if (run < 0) run = i
        continue
      }
      if (run >= 0) {
        d += `M${n(run + 0.5)} ${n(j + 0.5)}H${n(i + 0.5)}V${n(j + 1.5)}H${n(run + 0.5)}z`
        run = -1
      }
      if (!tl && !tr && !br && !bl) continue
      const cx = i + 0.5
      const cy = j + 0.5
      const pts: [number, number][] = []
      const corner = (on: boolean, x: number, y: number) => on && pts.push([x, y])
      const mid = (a: boolean, b: boolean, x: number, y: number) => a !== b && pts.push([x, y])
      corner(tl, cx, cy)
      mid(tl, tr, cx + 0.5, cy)
      corner(tr, cx + 1, cy)
      mid(tr, br, cx + 1, cy + 0.5)
      corner(br, cx + 1, cy + 1)
      mid(br, bl, cx + 0.5, cy + 1)
      corner(bl, cx, cy + 1)
      mid(bl, tl, cx, cy + 0.5)
      d += 'M' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L') + 'z'
    }
  }
  return d
}


function moon(x: number, y: number): string {
  return (
    `<circle class="sky" cx="${n(x)}" cy="${n(y)}" r="90" fill="url(#mhalo)"/>` +
    `<circle cx="${n(x)}" cy="${n(y)}" r="13" fill="url(#moon)"/>` +
    `<circle cx="${n(x - 4)}" cy="${n(y + 3)}" r="2.6" fill="#d9cba0" opacity=".5"/><circle cx="${n(x + 4)}" cy="${n(y - 4)}" r="1.6" fill="#d9cba0" opacity=".45"/><circle cx="${n(x + 3)}" cy="${n(y + 5)}" r="1.1" fill="#d9cba0" opacity=".4"/>`
  )
}

// How long each launch plays, in seconds.
const LAUNCH_SECONDS = { commit: 3.5, push: 9 }

// The launch under way, if any: the Statue's item is keyed on it.
function launching(launch: Launch | undefined, now: number): Launch['kind'] | undefined {
  return launch && (now - launch.at) / 1000 < LAUNCH_SECONDS[launch.kind] ? launch.kind : undefined
}

// The Harbor Statue: at rest, or mid-launch after a commit (a hop) or a
// push (liftoff, off the top of the map, and back). The item is sent while a
// launch is under way, so every animation begins `elapsed` seconds in the
// past and carries on from there; the page shifts those offsets onto its own
// clock when the item arrives. She stands dark until the first commit, and
// her torch is unlit until the first push.
function statue(launch: Launch | undefined, now: number, state: 'dark' | 'unlit' | 'lit'): string {
  const copper = state === 'dark' ? '#2f3f42' : '#5eada0'
  let g = `<g class="statue ${state}">`
  const [x, y] = p(2.1, 70)
  if (state !== 'dark') g += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="9" ry="4.5" fill="#5eada0" opacity=".12"/>`
  const elapsed = launch ? (now - launch.at) / 1000 : Infinity
  const kind = launching(launch, now)
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
  figure += `<path d="M${n(x - 2.4)} ${n(y - 8)}l1 -12h3l1 12z" fill="${copper}"/>`
  figure += `<circle cx="${n(x)}" cy="${n(y - 21.5)}" r="1.8" fill="${copper}"/>`
  figure += `<line x1="${n(x + 1.4)}" y1="${n(y - 19)}" x2="${n(x + 3)}" y2="${n(y - 27)}" stroke="${copper}" stroke-width="1.2"/>`
  figure +=
    state === 'lit'
      ? `<circle cx="${n(x + 3)}" cy="${n(y - 28.5)}" r="1.8" fill="#fbbf24"><animate attributeName="r" values="1.6;2.4;1.6" dur="1.6s" repeatCount="indefinite"/></circle>`
      : `<circle cx="${n(x + 3)}" cy="${n(y - 28.5)}" r="1.4" fill="${state === 'dark' ? '#3a4a4d' : '#7a6a3a'}"/>`

  if (!kind || !launch) {
    g += `<rect x="${n(x - 3)}" y="${n(y - 8)}" width="6" height="8" fill="${state === 'dark' ? '#4b4a48' : '#a8a29e'}"/>` + figure
    return g + '</g>'
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
  return g + '</g>'
}

// Fireworks over the Crown Tower while an update waits: rockets climb from the
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

// The boroughs the view takes in: every one.
export function framed(sc: Scene): Burb[] {
  return [...sc.repoOf.keys(), ...sc.vacantOf.keys(), ...sc.layout.boroughs.map(bo => bo.id)]
}

// What the still map depends on: which landmarks stand, which boroughs have
// houses, whether the rails are laid, how many blocks the population has
// earned, and the layout's revision. Its hash tells the page whether it
// already has this map.
export function mapKey(sc: Scene): string {
  const built = Object.keys(sc.built).sort()
  const burbs = [...sc.repoOf.keys(), ...sc.vacantOf.keys()].filter(b => !isWaiting(b)).sort()
  // The censuses' folders, by borough (none at all keeps the hash it had before censuses).
  const counts = [...sc.vacantOf, ...sc.repoOf].filter(([, r]) => r.census).map(([b, r]) => [b, censusShape(r.census)])
  return hash(JSON.stringify([built, burbs, sc.connected, blocksFor(sc.population, lotsOf(sc.layout).length), sc.rev, sc.layout.map.seed, ...(counts.length ? [counts] : [])]))
}

// The still city, back to front: everything but the agents and the overlay.
// It reads only what mapKey hashes.
export function drawMap(sc: Scene): string {
  const vb = frame(framed(sc), sc.layout)
  let s = ''
  // The water's sparkle, and the city's lights reflected in it.
  s += `<rect x="${n(vb.x - 2000)}" y="${n(vb.y - 2000)}" width="${n(vb.w + 4000)}" height="${n(vb.h + 4000)}" fill="url(#rip)"/>`
  s += generatedLand(sc.layout)

  // The streets, then whatever lies flat on them.
  s += streets(sc)
  if (sc.connected) s += rails(sc)
  const items: Item[] = []
  s += parks(items, sc)
  s += landmarks(items, sc)
  s += pads(sc)

  // Every borough, lived in or not.
  for (const bo of sc.layout.boroughs) s += drawnBurb(bo, sc.layout)

  // Buildings and landmarks, back to front.
  fabric(items, sc)
  items.sort((a, b) => a.depth - b.depth)
  s += compose(items)
  s += moon(vb.x + vb.w * 0.3, vb.y + 34)
  return s
}

// Everything on the city that moves or lights up, in paint order, as keyed
// items (docs/frames.md). The trains, the hover zones, the taxis and the
// agents are drawn elsewhere.
export function drawOverlay(world: World, sc: Scene): OverlayItem[] {
  const out: OverlayItem[] = []
  const put = (k: string, svg: string, top = false) => {
    if (svg) out.push(item(k, svg, top))
  }
  put('pads', padsLit(sc))
  for (const bo of sc.layout.boroughs) put(`burb:${bo.id}`, drawnBurbLit(bo, sc.repoOf.get(bo.id), sc))
  put('waiting', waitingSign(sc))
  out.push(...landmarkLights(sc))
  // The Treasury's board: the day's spend, and what is left of the plan's limits.
  for (const t of cityBuildings(sc.layout, 'treasury')) {
    const today = world.treasury?.days[dayOf(sc.now)] ?? 0
    const lim = world.limits
    const windows: [string, { used: number; resetsAt: number } | undefined][] = [
      ['5h', lim?.fiveHour],
      ['7d', lim?.sevenDay],
    ]
    const left = windows
      .flatMap(([name, w]) => (w ? [`${name} ${Math.round(100 - (w.resetsAt <= sc.now ? 0 : w.used))}% left`] : []))
      .join(' · ')
    const [bx, by] = p(...([t.x + 1, t.y + 0.5] as [number, number]), 22)
    const lines = left ? 2 : 1
    put(
      `treasury:${t.id}`,
      `<g class="treasury-board"><rect x="${n(bx - 25)}" y="${n(by - 6 - lines * 6)}" width="50" height="${n(4 + lines * 6)}" rx="1.5" fill="#0b1224" stroke="#fbbf24" stroke-width=".6"/>` +
        `<text x="${n(bx)}" y="${n(by - 2 - (lines - 1) * 6 - 2)}" text-anchor="middle" font-size="5" font-weight="800" fill="#fbbf24">${esc(usd(today))} today</text>` +
        (left ? `<text x="${n(bx)}" y="${n(by - 4)}" text-anchor="middle" font-size="3.6" fill="#e2e8f0">${esc(left)}</text>` : '') +
        `</g>`,
    )
  }
  // The zoning plan, pinned on a board by City Hall's door.
  const hall = cityBuildings(sc.layout, 'hall').find(b => b.built !== undefined)
  if (world.zoning && hall) {
    const [hx, hy] = p(...doorOfHall(hall), 0)
    put('zoning', `<g class="zoning"><title>${esc(`Zoning plan: ${world.zoning.title} (filed by ${world.zoning.by})`)}</title><path d="M${n(hx + 9)} ${n(hy)}v-9" stroke="#78716c" stroke-width=".8"/><rect x="${n(hx + 4)}" y="${n(hy - 16)}" width="10" height="8" fill="#f8fafc" stroke="#94a3b8" stroke-width=".5"/><path d="M${n(hx + 5.5)} ${n(hy - 14)}h7M${n(hx + 5.5)} ${n(hy - 12)}h7M${n(hx + 5.5)} ${n(hy - 10)}h4" stroke="#64748b" stroke-width=".5"/><circle cx="${n(hx + 9)}" cy="${n(hy - 16)}" r=".8" fill="#ef4444"/></g>`)
  }
  put('spires', spireLights(sc))
  put('haze', haze(sc))
  sc.layout.buildings.filter(b => b.kind === 'liberty').forEach((liberty, i) => {
    // She stands dark until she goes up (with the Seaport);
    // her torch lights on the first push. Every Statue launches on a push.
    const state = liberty.built === undefined ? 'dark' : sc.built.torch !== undefined ? 'lit' : 'unlit'
    const kind = launching(world.launch, sc.now)
    const d = deltaOf(liberty)
    // Keyed on the launch, not the markup: the markup holds offsets from now.
    out.push(keyed(i ? `statue:${liberty.id}` : 'statue', [state, kind, kind ? world.launch!.at : 0, kind ? world.launch!.who : '', kind ? world.launch!.repo : '', d], sh(statue(world.launch, sc.now, state), d)))
  })
  put('labels', labels(sc))
  // Fireworks over the Crown Tower for an update waiting, and for a while
  // once the city is complete.
  const empire = cityBuildings(sc.layout, 'empire')[0]
  const finished = sc.built.empire
  if (sc.update?.available || (finished !== undefined && sc.now - finished < FIREWORKS_MS)) put('fireworks', sh(fireworks(), empire ? deltaOf(empire) : [0, 0]), true)
  return out
}
