import { esc, item, n, p, pts, waitAt } from './geo.ts'
import type { OverlayItem, Scene } from './geo.ts'
import { burbGeo, spotFor } from '../layout.ts'
import { hostOf } from '../billboards.ts'
import type { Billboard, World } from '../types.ts'

// The billboards: one for each local server a session started (a front end
// on localhost) while it answers, in its project's part of the city.
// Manhattan's stand by Times Square, a borough's along its front row, and a
// project still waiting for a borough's on the station's forecourt. A click
// opens the page (the page's own handler, by data-url). A new one glows, its
// bulbs chase and a sign hangs over it, until the person first opens it.

// Cells between neighbouring billboards' middles: a board is three wide.
const GAP = 3.1

const same = (a: string, b: string | undefined) => !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

// Where the i-th billboard of a place stands, on the grid.
function spotOf(world: World, sc: Scene, b: Billboard, i: number): [number, number] {
  const layout = sc.layout
  if (same(b.root, world.homeRoot)) {
    const [x, y] = spotFor(layout, 'observatory')
    return [x - 2.6 - i * GAP, y + 1.1]
  }
  const repo = world.repos.find(r => same(r.root, b.root) && !r.left) ?? world.repos.find(r => same(r.root, b.root))
  const geo = repo ? burbGeo(layout, repo.burb) : undefined
  if (geo && !geo.preset) {
    const [x0, , , y1] = geo.rect
    return [x0 + 2 + i * GAP, y1 - 0.4]
  }
  if (geo) return [geo.square[0] - 3 + i * GAP, geo.square[1] + 2.2]
  const [wx, wy] = waitAt(layout, 0)
  return [wx - 3.5 - i * GAP, wy + 1.4]
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)

// Drawn like the city: slabs on the grid and shapes laid on their faces. The
// screen is the board's front-left face (along gx, facing +gy), as Times
// Square's neon is, and its words are slanted to lie flat on it.

type P3 = [number, number, number]
const poly = (list: P3[], fill: string, extra = '') => `<polygon points="${pts(list.map(([gx, gy, z]) => p(gx, gy, z)))}" fill="${fill}"${extra}/>`

// A box in three colours: footprint gx [x0, x0+w], gy [y0, y0+d], h tall from z.
function slab(x0: number, y0: number, w: number, d: number, h: number, [cl, cr, ct]: [string, string, string], z = 0): string {
  const a: P3 = [x0, y0 + d, z]
  const b: P3 = [x0 + w, y0 + d, z]
  const c: P3 = [x0 + w, y0, z]
  const e: P3 = [x0, y0, z]
  const up = ([gx, gy, gz]: P3): P3 => [gx, gy, gz + h]
  return poly([a, b, up(b), up(a)], cl) + poly([b, c, up(c), up(b)], cr) + poly([up(a), up(b), up(c), up(e)], ct)
}

// Words on the front face at gy: centred at gx, baseline at height z.
function faceText(gx: number, gy: number, z: number, text: string, size: number, fill: string, weight = 700): string {
  const [x, y] = p(gx, gy, 0)
  return `<g transform="translate(${n(x)} ${n(y)}) skewY(26.565)"><text x="0" y="${n(-z)}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text></g>`
}

const W = 2.6 // cells along gx
const Z0 = 10 // the board's bottom and top, above the ground
const Z1 = 24

function board(b: Billboard, gx: number, gy: number): string {
  const fresh = b.openedAt === undefined
  const x0 = gx - W / 2
  const x1 = gx + W / 2
  const host = hostOf(b.url)
  const title = clip(b.title || b.name, 16)
  // The city's own hover card (data-tip-*), like its places'.
  const tipTitle = b.title ? `${b.title}` : `${b.name}'s local server`
  const tipText = `${b.url}: ${b.name}'s local server. Click to open it${fresh ? ' (new)' : ''}.`
  let g = `<g class="billboard${fresh ? ' fresh' : ''}" data-billboard="${esc(b.id)}" data-url="${esc(b.url)}" data-tip-title="${esc(tipTitle)}" data-tip-text="${esc(tipText)}" style="cursor:pointer;--accent:#38bdf8">`
  // A new one lights the ground round it, flat on the grid.
  if (fresh) {
    const [cx, cy] = p(gx, gy + 0.6)
    g += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="34" ry="17" fill="#38bdf8" opacity=".22"><animate attributeName="opacity" values=".08;.34;.08" dur="1.6s" repeatCount="indefinite"/></ellipse>`
  }
  // Two steel legs, cross-braced.
  const post: [string, string, string] = ['#475569', '#334155', '#64748b']
  g += slab(x0 + 0.45, gy - 0.18, 0.14, 0.14, Z0, post)
  g += slab(x1 - 0.6, gy - 0.18, 0.14, 0.14, Z0, post)
  g += `<path d="M${pts([p(x0 + 0.52, gy - 0.04, 2), p(x1 - 0.53, gy - 0.04, Z0 - 2)])}M${pts([p(x0 + 0.52, gy - 0.04, Z0 - 2), p(x1 - 0.53, gy - 0.04, 2)])}" stroke="#334155" stroke-width=".5" fill="none"/>`
  // The catwalk in front of the screen.
  g += slab(x0 + 0.1, gy, W - 0.2, 0.32, 0.7, ['#3f4b5c', '#2b3442', '#556273'], Z0 - 1.6)
  // The board: a frame with depth, then the lit screen on its front face.
  g += slab(x0, gy - 0.22, W, 0.22, Z1 - Z0, ['#1e293b', '#111827', '#334155'], Z0)
  const sx0 = x0 + 0.12
  const sx1 = x1 - 0.12
  const mid = (Z0 + Z1) / 2
  g += poly([[sx0, gy, Z0 + 1.2], [sx1, gy, Z0 + 1.2], [sx1, gy, Z1 - 1.2], [sx0, gy, Z1 - 1.2]], '#0c4a6e')
  g += poly([[sx0, gy, mid], [sx1, gy, mid], [sx1, gy, Z1 - 1.2], [sx0, gy, Z1 - 1.2]], '#0369a1', ' opacity=".6"')
  g += poly([[sx0, gy, Z0 + 1.2], [sx1, gy, Z0 + 1.2], [sx1, gy, Z1 - 1.2], [sx0, gy, Z1 - 1.2]], 'none', ` stroke="${fresh ? '#7dd3fc' : '#38bdf8'}" stroke-width="${fresh ? 0.8 : 0.5}"`)
  g += faceText(gx, gy, Z1 - 6.4, title, 3.2, '#f0f9ff', 800)
  g += faceText(gx, gy, Z0 + 3.1, `${host} ↗`, 2.5, '#bae6fd', 600)
  // Bulbs along the top edge, chasing while it is new.
  for (let i = 0; i < 8; i++) {
    const [bx, by] = p(x0 + 0.2 + i * ((W - 0.4) / 7), gy, Z1 + 0.6)
    g += `<circle cx="${n(bx)}" cy="${n(by)}" r=".7" fill="#fde68a">`
    if (fresh) g += `<animate attributeName="opacity" values="1;.2;1" dur="1.2s" begin="${(i * 0.13).toFixed(2)}s" repeatCount="indefinite"/>`
    g += `</circle>`
  }
  // A new one has a sign hung over it, on the same face.
  if (fresh) {
    const t0 = Z1 + 2.2
    const t1 = Z1 + 7.4
    g += `<g>`
    g += `<path d="M${pts([p(gx - 0.6, gy, Z1), p(gx - 0.6, gy, t0)])}M${pts([p(gx + 0.6, gy, Z1), p(gx + 0.6, gy, t0)])}" stroke="#78716c" stroke-width=".5"/>`
    g += poly([[x0, gy, t0], [x1, gy, t0], [x1, gy, t1], [x0, gy, t1]], '#fbbf24')
    g += faceText(gx, gy, t0 + 1.6, 'NEW · CLICK TO OPEN', 2.1, '#1c1917', 800)
    g += `<animate attributeName="opacity" values="1;.55;1" dur="1.6s" repeatCount="indefinite"/></g>`
  }
  return g + '</g>'
}

export function drawBillboards(world: World, sc: Scene): OverlayItem[] {
  const up = (world.billboards ?? []).filter(b => b.up !== undefined).sort((a, b) => (a.builtAt ?? 0) - (b.builtAt ?? 0))
  const count = new Map<string, number>()
  // Where boards stand already, as the screen boxes they cover (sign and
  // ground glow included): a new one slides along its row until its box is
  // clear, so the boards of a borough and of Times Square beside it never
  // cover each other.
  const placed: [number, number, number, number][] = []
  const boxOf = (gx: number, gy: number): [number, number, number, number] => {
    const [ax, ay] = p(gx - W / 2, gy, Z1 + 8)
    const [bx, by] = p(gx + W / 2, gy, 0)
    return [ax - 2, ay - 2, bx + 2, by + 2]
  }
  const clear = (gx: number, gy: number) => {
    const [x0, y0, x1, y1] = boxOf(gx, gy)
    return placed.every(([a0, b0, a1, b1]) => x1 <= a0 || a1 <= x0 || y1 <= b0 || b1 <= y0)
  }
  return up.map(b => {
    const place = same(b.root, world.homeRoot) ? '' : b.root.toLowerCase()
    const i = count.get(place) ?? 0
    count.set(place, i + 1)
    let [gx, gy] = spotOf(world, sc, b, i)
    const step = place ? 0.5 : -0.5
    for (let k = 0; k < 80 && !clear(gx, gy); k++) gx += step
    placed.push(boxOf(gx, gy))
    return item(`billboard:${b.id}`, board(b, gx, gy))
  })
}
