import { esc, item, n, p, pts, waitAt } from './geo.ts'
import type { OverlayItem, Scene } from './geo.ts'
import { burbGeo, spotFor } from '../layout.ts'
import { hostOf, litFor } from '../billboards.ts'
import type { Billboard, World } from '../types.ts'

// The billboards: one for each local server a session started (a front end
// on localhost) while it answers, in its project's part of the city.
// Manhattan's stand by Times Square, a borough's along its front row, and a
// project still waiting for a borough's on the station's forecourt, unless
// the person moved one. A click opens the page (the page's own handler, by
// data-url); the ⚙ on its corner opens its card (move, turn, take down). A new
// one glows, its bulbs chase and a sign hangs over it, until first opened.

// Cells between neighbouring billboards' middles: a board is 2.6 wide.
const GAP = 3.1

const same = (a: string, b: string | undefined) => !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

// Where the i-th billboard of a place stands, on the grid, when the person
// hasn't put it somewhere.
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

// Drawn like the city: slabs on the grid and shapes laid on their faces. A
// board is drawn in its own frame: u runs along it (left to right on screen),
// v out of its screen towards the viewer, z up. Facing left ('l') its screen
// is the front-left face (along gx, facing +gy), as Times Square's neon is;
// facing right ('r') the front-right one (along gy, facing +gx). Its words
// are slanted to lie flat on whichever it is.

type P3 = [number, number, number]
export type Face = 'l' | 'r'

const W = 2.6 // along the board
const Z0 = 10 // the board's bottom and top, above the ground
const Z1 = 24

export function frameOf(cx: number, cy: number, face: Face) {
  // Grid point of a local one.
  const at = (u: number, v: number): [number, number] => (face === 'l' ? [cx + u, cy + v] : [cx + v, cy - u])
  const pt = ([u, v, z]: P3) => p(...at(u, v), z)
  const poly = (list: P3[], fill: string, extra = '') => `<polygon points="${pts(list.map(pt))}" fill="${fill}"${extra}/>`
  // A box from u0..u1, v0..v1, h tall from z, as the grid sees it: the faces
  // that show are the box's own front-left and front-right, whatever it is in
  // the board's frame.
  const slab = (u0: number, u1: number, v0: number, v1: number, h: number, [cl, cr, ct]: [string, string, string], z = 0) => {
    const [ax, ay] = at(u0, v0)
    const [bx, by] = at(u1, v1)
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by)
    const g = (gx: number, gy: number, gz: number) => p(gx, gy, gz)
    const face = (list: [number, number, number][], fill: string) => `<polygon points="${pts(list.map(([a, b, c]) => g(a, b, c)))}" fill="${fill}"/>`
    return (
      face([[x0, y1, z], [x1, y1, z], [x1, y1, z + h], [x0, y1, z + h]], cl) +
      face([[x1, y1, z], [x1, y0, z], [x1, y0, z + h], [x1, y1, z + h]], cr) +
      face([[x0, y1, z + h], [x1, y1, z + h], [x1, y0, z + h], [x0, y0, z + h]], ct)
    )
  }
  // Words on the screen: centred at u, baseline at height z.
  const text = (u: number, z: number, s: string, size: number, fill: string, weight = 700) => {
    const [x, y] = pt([u, 0, 0])
    return `<g transform="translate(${n(x)} ${n(y)}) skewY(${face === 'l' ? 26.565 : -26.565})"><text x="0" y="${n(-z)}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text></g>`
  }
  return { at, pt, poly, slab, text }
}

// The box it covers on screen, sign and ground glow included, for keeping
// boards off each other.
function screenBox(cx: number, cy: number, face: Face): [number, number, number, number] {
  const f = frameOf(cx, cy, face)
  const corners = [f.pt([-W / 2, 0, 0]), f.pt([W / 2, 0, 0]), f.pt([-W / 2, 0, Z1 + 8]), f.pt([W / 2, 0, Z1 + 8])]
  const xs = corners.map(c => c[0])
  const ys = corners.map(c => c[1])
  return [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2]
}

function board(b: Billboard, cx: number, cy: number): string {
  const face: Face = b.face === 'r' ? 'r' : 'l'
  const f = frameOf(cx, cy, face)
  // New until first opened, updated whenever it changes after: both glow.
  const lit = litFor(b)
  const fresh = lit !== ''
  const u0 = -W / 2
  const u1 = W / 2
  const host = hostOf(b.url)
  const title = clip(b.title || b.name, 16)
  // The city's own hover card (data-tip-*), like its places'.
  const tipTitle = b.title ? `${b.title}` : `${b.name}'s local server`
  const tipText = `${b.url}: ${b.name}'s local server. Click to open it${lit === 'new' ? ' (new)' : lit === 'updated' ? ' (updated since you last looked)' : ''}; ⚙ to move, turn or take it down.`
  let g = `<g class="billboard${fresh ? ' fresh' : ''}" data-billboard="${esc(b.id)}" data-url="${esc(b.url)}" data-face="${face}" data-tip-title="${esc(tipTitle)}" data-tip-text="${esc(tipText)}" style="cursor:pointer;--accent:#38bdf8">`
  // A new one lights the ground round it, flat on the grid.
  if (fresh) {
    const [gx, gy] = f.at(0, 0.6)
    const [x, y] = p(gx, gy)
    g += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="34" ry="17" fill="#38bdf8" opacity=".22"><animate attributeName="opacity" values=".08;.34;.08" dur="1.6s" repeatCount="indefinite"/></ellipse>`
  }
  // Two steel legs, cross-braced.
  const post: [string, string, string] = ['#475569', '#334155', '#64748b']
  g += f.slab(u0 + 0.45, u0 + 0.59, -0.18, -0.04, Z0, post)
  g += f.slab(u1 - 0.6, u1 - 0.46, -0.18, -0.04, Z0, post)
  g += `<path d="M${pts([f.pt([u0 + 0.52, -0.04, 2]), f.pt([u1 - 0.53, -0.04, Z0 - 2])])}M${pts([f.pt([u0 + 0.52, -0.04, Z0 - 2]), f.pt([u1 - 0.53, -0.04, 2])])}" stroke="#334155" stroke-width=".5" fill="none"/>`
  // The catwalk in front of the screen.
  g += f.slab(u0 + 0.1, u1 - 0.1, 0, 0.32, 0.7, ['#3f4b5c', '#2b3442', '#556273'], Z0 - 1.6)
  // The board: a frame with depth, then the lit screen on its front.
  g += f.slab(u0, u1, -0.22, 0, Z1 - Z0, ['#1e293b', '#111827', '#334155'], Z0)
  const s0 = u0 + 0.12
  const s1 = u1 - 0.12
  const mid = (Z0 + Z1) / 2
  const screen: P3[] = [[s0, 0, Z0 + 1.2], [s1, 0, Z0 + 1.2], [s1, 0, Z1 - 1.2], [s0, 0, Z1 - 1.2]]
  g += f.poly(screen, '#0c4a6e')
  g += f.poly([[s0, 0, mid], [s1, 0, mid], [s1, 0, Z1 - 1.2], [s0, 0, Z1 - 1.2]], '#0369a1', ' opacity=".6"')
  g += f.poly(screen, 'none', ` stroke="${fresh ? '#7dd3fc' : '#38bdf8'}" stroke-width="${fresh ? 0.8 : 0.5}"`)
  g += f.text(0, Z1 - 6.4, title, 3.2, '#f0f9ff', 800)
  g += f.text(0, Z0 + 3.1, `${host} ↗`, 2.5, '#bae6fd', 600)
  // Bulbs along the top edge, chasing while it is new.
  for (let i = 0; i < 8; i++) {
    const [bx, by] = f.pt([u0 + 0.2 + i * ((W - 0.4) / 7), 0, Z1 + 0.6])
    g += `<circle cx="${n(bx)}" cy="${n(by)}" r=".7" fill="#fde68a">`
    if (fresh) g += `<animate attributeName="opacity" values="1;.2;1" dur="1.2s" begin="${(i * 0.13).toFixed(2)}s" repeatCount="indefinite"/>`
    g += `</circle>`
  }
  // A new or updated one has a sign hung over it, on the same face.
  if (fresh) {
    const t0 = Z1 + 2.2
    const t1 = Z1 + 7.4
    g += `<g>`
    g += `<path d="M${pts([f.pt([-0.6, 0, Z1]), f.pt([-0.6, 0, t0])])}M${pts([f.pt([0.6, 0, Z1]), f.pt([0.6, 0, t0])])}" stroke="#78716c" stroke-width=".5"/>`
    g += f.poly([[u0, 0, t0], [u1, 0, t0], [u1, 0, t1], [u0, 0, t1]], '#fbbf24')
    g += f.text(0, t0 + 1.6, lit === 'new' ? 'NEW · CLICK TO OPEN' : 'UPDATED · CLICK TO SEE', 2.1, '#1c1917', 800)
    g += `<animate attributeName="opacity" values="1;.55;1" dur="1.6s" repeatCount="indefinite"/></g>`
  }
  // The ⚙ just off its top corner, clear of the sign: the card to move, turn
  // or take it down.
  const [kx, ky] = f.pt([u1 + 0.42, 0, Z1 - 2])
  g += `<g class="bb-edit" data-bb-edit="1"><title>Move, turn or take down</title><circle cx="${n(kx)}" cy="${n(ky)}" r="3.4" fill="#0f172a" stroke="#64748b" stroke-width=".5"/><text x="${n(kx)}" y="${n(ky + 1.5)}" text-anchor="middle" font-size="4.2" fill="#cbd5e1">⚙</text></g>`
  return g + '</g>'
}

export function drawBillboards(world: World, sc: Scene): OverlayItem[] {
  const up = (world.billboards ?? []).filter(b => b.up !== undefined && b.destroyedAt === undefined).sort((a, b) => (a.builtAt ?? 0) - (b.builtAt ?? 0))
  // The ones the person put somewhere stand there; the rest slide along their
  // row until clear of every board already placed, so none covers another.
  const placed: [number, number, number, number][] = []
  const clear = (box: [number, number, number, number]) => placed.every(([a0, b0, a1, b1]) => box[2] <= a0 || a1 <= box[0] || box[3] <= b0 || b1 <= box[1])
  const at = new Map<string, [number, number]>()
  for (const b of up) {
    if (!b.pos) continue
    at.set(b.id, b.pos)
    placed.push(screenBox(b.pos[0], b.pos[1], b.face === 'r' ? 'r' : 'l'))
  }
  const count = new Map<string, number>()
  for (const b of up) {
    if (b.pos) continue
    const place = same(b.root, world.homeRoot) ? '' : b.root.toLowerCase()
    const i = count.get(place) ?? 0
    count.set(place, i + 1)
    let [gx, gy] = spotOf(world, sc, b, i)
    const face: Face = b.face === 'r' ? 'r' : 'l'
    const step = place ? 0.5 : -0.5
    for (let k = 0; k < 80 && !clear(screenBox(gx, gy, face)); k++) gx += step
    placed.push(screenBox(gx, gy, face))
    at.set(b.id, [gx, gy])
  }
  return up.map(b => {
    const [gx, gy] = at.get(b.id)!
    return item(`billboard:${b.id}`, board(b, gx, gy))
  })
}
