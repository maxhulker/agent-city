import { esc, item, keyed, n, p } from './geo.ts'
import type { OverlayItem, Scene } from './geo.ts'
import { frameOf } from './billboards.ts'
import { placeOf } from './sites.ts'
import { cellsOf, cityBuildings, landAt } from '../layout.ts'
import type { Layout } from '../layout.ts'
import type { Site, World } from '../types.ts'

// Shipping (src/deploys.ts): a deploy sends a cargo ship out of the Seaport,
// the project's name on its hull, out to open water and away; a production
// deploy puts a LIVE sign on the project's square, opening the site (the
// page's data-site-url handler, as a permit board's does).

export const SAIL_MS = 24_000
export const LIVE_MS = 30 * 24 * 3600_000
export const PREVIEW_MS = 24 * 3600_000

const same = (a: string, b: string | undefined) => !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Where a ship leaves from and which way it sails: the Seaport's water, the
// side nearest open water. None while the Seaport isn't standing.
export function seaway(layout: Layout): { from: [number, number]; dir: [number, number] } | undefined {
  const port = cityBuildings(layout, 'harbor').find(b => b.built !== undefined)
  if (!port) return undefined
  const [x0, y0, x1, y1] = cellsOf(port)[0]!
  const c: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2]
  let best: { k: number; dir: [number, number] } | undefined
  for (const dir of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
    let k = 1
    while (k < 12 && landAt(layout, Math.floor(c[0] + dir[0] * k), Math.floor(c[1] + dir[1] * k))) k++
    if (k < 12 && (!best || k < best.k)) best = { k, dir }
  }
  if (!best) return undefined
  return { from: [c[0] + best.dir[0] * (best.k + 0.6), c[1] + best.dir[1] * (best.k + 0.6)], dir: best.dir }
}

// A container ship at (0,0), its bow to screen-right; its name on the hull.
function shipSvg(name: string, color: string): string {
  const crates = ['#ef4444', '#3b82f6', '#f59e0b', '#22c55e', '#a855f7', '#14b8a6']
  let g = `<ellipse cx="0" cy="3" rx="22" ry="3" fill="#0b1224" opacity=".35"/>`
  // The wake, trailing behind.
  g += `<path d="M-22 2.5q-10 1.5 -22 0M-22 4q-12 2 -26 1" stroke="#e0f2fe" stroke-width=".7" fill="none" opacity=".55"/>`
  g += `<path d="M-20 -3h36l6 3l-4 4h-36z" fill="#1e293b" stroke="#0f172a" stroke-width=".5"/>`
  g += `<path d="M-20 -3h36l6 3h-42z" fill="${color}"/>`
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 2; j++) g += `<rect x="${-16 + i * 4.6}" y="${-7.2 - j * 3.6}" width="4.2" height="3.4" fill="${crates[(i + j * 2) % crates.length]}" stroke="#0f172a" stroke-width=".3"/>`
  }
  g += `<rect x="-19.5" y="-13" width="4" height="10" fill="#e2e8f0"/><rect x="-19" y="-12" width="3" height="1.4" fill="#38bdf8"/><path d="M-18 -13v-3" stroke="#475569" stroke-width=".6"/>`
  g += `<text x="0" y="2.6" text-anchor="middle" font-size="2.6" font-weight="800" fill="#f8fafc" letter-spacing=".3">${esc(clip(name.toUpperCase(), 18))}</text>`
  return g
}

function sailing(site: Site, name: string, way: NonNullable<ReturnType<typeof seaway>>, now: number): string {
  const s = site.shipped!
  const elapsed = (now - s.at) / 1000
  const dur = SAIL_MS / 1000
  const [x0, y0] = p(...way.from)
  const [x1, y1] = p(way.from[0] + way.dir[0] * 16, way.from[1] + way.dir[1] * 16)
  // Facing its way on screen: mirrored when it sails screen-left.
  const flip = x1 < x0 ? ' scale(-1,1)' : ''
  const tip = `${name} shipped to ${s.target}${s.prod ? '' : ' (preview)'}${s.url ? `: ${s.url}` : ''}`
  return (
    `<g class="ship" pointer-events="none"><title>${esc(tip)}</title><g opacity="0">` +
    `<animateTransform attributeName="transform" type="translate" values="${n(x0)},${n(y0)};${n(x1)},${n(y1)}" keyTimes="0;1" dur="${dur}s" begin="${n(-elapsed)}s" fill="freeze"/>` +
    `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.06;.85;1" dur="${dur}s" begin="${n(-elapsed)}s" fill="freeze"/>` +
    `<g transform="scale(.9)${flip}">${shipSvg(name, s.prod ? '#b91c1c' : '#b45309')}</g></g></g>`
  )
}

// The LIVE sign: a small neon board on a pole by the project's site board.
function liveSign(site: Site, name: string, gx: number, gy: number): string {
  const s = site.shipped!
  const f = frameOf(gx, gy, 'l')
  const W = 1.5
  const color = s.prod ? '#22c55e' : '#f59e0b'
  const word = s.prod ? 'LIVE' : 'PREVIEW'
  const host = s.url ? clip(hostOf(s.url), 22) : s.target
  const when = new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const tipTitle = `${name}: ${s.prod ? 'live' : 'a preview'} on ${s.target}`
  const tipText = `Shipped ${when}${s.version ? `, v${s.version}` : ''}${s.url ? `. ${s.url}: click to open it.` : '.'}`
  let g = `<g class="live-sign" data-tip-title="${esc(tipTitle)}" data-tip-text="${esc(tipText)}"${s.url ? ` data-site-url="${esc(s.url)}" style="cursor:pointer;--accent:${color}"` : ` style="--accent:${color}"`}>`
  g += f.slab(-0.05, 0.05, -0.05, 0.05, 9, ['#475569', '#334155', '#64748b'])
  g += f.slab(-W / 2, W / 2, -0.08, 0, 4.6, ['#0f172a', '#0b1020', '#1e293b'], 9)
  g += f.poly([[-W / 2 + 0.06, 0, 9.3], [W / 2 - 0.06, 0, 9.3], [W / 2 - 0.06, 0, 13.3], [-W / 2 + 0.06, 0, 13.3]], 'none', ` stroke="${color}" stroke-width=".5"`)
  g += f.text(0, 11.2, word, 2.3, color, 900)
  g += f.text(0, 9.7, host, 1.05, '#e2e8f0', 600)
  return g + `<animate attributeName="opacity" values="1;.82;1" dur="2.4s" repeatCount="indefinite"/></g>`
}

export function drawShips(world: World, sc: Scene): OverlayItem[] {
  const out: OverlayItem[] = []
  const way = seaway(sc.layout)
  for (const site of world.sites ?? []) {
    const s = site.shipped
    if (!s) continue
    const name = same(site.root, world.homeRoot) ? world.home : (world.repos.find(r => same(r.root, site.root))?.name ?? site.root.split(/[\\/]/).pop() ?? '')
    const age = sc.now - s.at
    if (way && age < SAIL_MS) out.push(keyed(`ship:${site.root.toLowerCase()}:${s.at}`, [s.at, s.target, s.prod, name, way], sailing(site, name, way, sc.now), true))
    if (age < (s.prod ? LIVE_MS : PREVIEW_MS)) {
      const at = placeOf(world, sc, site.root)
      // Beside the permit board's spot, a little to its left.
      if (at) out.push(item(`live:${site.root.toLowerCase()}`, liveSign(site, name, at.board[0] - 1.9, at.board[1])))
    }
  }
  return out
}
