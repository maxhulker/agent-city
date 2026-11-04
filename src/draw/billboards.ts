import { esc, item, n, p, waitAt } from './geo.ts'
import type { OverlayItem, Scene } from './geo.ts'
import { burbGeo, spotFor } from '../layout.ts'
import { hostOf } from '../billboards.ts'
import type { Billboard, World } from '../types.ts'

// The billboards: one for each local server a session started (a front end
// on localhost) while it answers, in its project's part of the city.
// Manhattan's stand by Times Square, a borough's along its front row, and a
// project still waiting for a borough's on the station's forecourt. A click
// opens the page (the page's own handler, by data-url). A new one glows, its
// bulbs chase and a tag says so, until the person first opens it.

const same = (a: string, b: string | undefined) => !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

// Where the i-th billboard of a place stands, on the grid.
function spotOf(world: World, sc: Scene, b: Billboard, i: number): [number, number] {
  const layout = sc.layout
  if (same(b.root, world.homeRoot)) {
    const [x, y] = spotFor(layout, 'observatory')
    return [x - 1.8 - i * 2.4, y + 1.1]
  }
  const repo = world.repos.find(r => same(r.root, b.root) && !r.left) ?? world.repos.find(r => same(r.root, b.root))
  const geo = repo ? burbGeo(layout, repo.burb) : undefined
  if (geo && !geo.preset) {
    const [x0, , , y1] = geo.rect
    return [x0 + 1.5 + i * 2.4, y1 - 0.3]
  }
  if (geo) return [geo.square[0] - 2.4 + i * 2.4, geo.square[1] + 2.2]
  const [wx, wy] = waitAt(layout, 0)
  return [wx - 3 - i * 2.4, wy + 1.4]
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)

function board(b: Billboard, gx: number, gy: number): string {
  const [x, y] = p(gx, gy)
  const fresh = b.openedAt === undefined
  const W = 36
  const H = 19
  const lift = 13
  const top = y - lift - H
  const host = hostOf(b.url)
  const title = clip(b.title || b.name, 22)
  // The city's own hover card (data-tip-*), like its places'.
  const tipTitle = b.title ? `${b.title}` : `${b.name}'s local server`
  const tipText = `${b.url}: ${b.name}'s local server. Click to open it${fresh ? ' (new)' : ''}.`
  let g = `<g class="billboard${fresh ? ' fresh' : ''}" data-billboard="${esc(b.id)}" data-url="${esc(b.url)}" data-tip-title="${esc(tipTitle)}" data-tip-text="${esc(tipText)}" style="cursor:pointer;--accent:#38bdf8">`
  // A new one throws light round itself until it is opened.
  if (fresh) {
    g += `<ellipse cx="${n(x)}" cy="${n(top + H / 2)}" rx="34" ry="22" fill="#38bdf8" opacity=".25"><animate attributeName="opacity" values=".08;.42;.08" dur="1.6s" repeatCount="indefinite"/></ellipse>`
  }
  // Two posts and a catwalk.
  g += `<path d="M${n(x - 10)} ${n(y)}v${-lift}M${n(x + 10)} ${n(y)}v${-lift}" stroke="#334155" stroke-width="1.6" stroke-linecap="round"/>`
  g += `<path d="M${n(x - 15)} ${n(y - lift + 0.6)}h30" stroke="#475569" stroke-width=".9"/>`
  // The frame and the lit screen.
  g += `<rect x="${n(x - W / 2)}" y="${n(top)}" width="${W}" height="${H}" rx="1.4" fill="#0f172a" stroke="${fresh ? '#7dd3fc' : '#38bdf8'}" stroke-width="${fresh ? 1 : 0.7}"/>`
  g += `<rect x="${n(x - W / 2 + 1.5)}" y="${n(top + 1.5)}" width="${W - 3}" height="${H - 3}" rx=".8" fill="#0c4a6e"/>`
  g += `<rect x="${n(x - W / 2 + 1.5)}" y="${n(top + 1.5)}" width="${W - 3}" height="${(H - 3) / 2}" rx=".8" fill="#0369a1" opacity=".55"/>`
  g += `<text x="${n(x)}" y="${n(top + 8)}" text-anchor="middle" font-size="4.2" font-weight="800" fill="#f0f9ff">${esc(title)}</text>`
  g += `<text x="${n(x)}" y="${n(top + 14)}" text-anchor="middle" font-size="3.3" font-weight="600" fill="#bae6fd">${esc(host)} ↗</text>`
  // Bulbs along the top, chasing while it is new.
  for (let i = 0; i < 7; i++) {
    const bx = x - W / 2 + 3 + i * ((W - 6) / 6)
    g += `<circle cx="${n(bx)}" cy="${n(top - 0.2)}" r=".7" fill="#fde68a">`
    if (fresh) g += `<animate attributeName="opacity" values="1;.25;1" dur="1.2s" begin="${(i * 0.17).toFixed(2)}s" repeatCount="indefinite"/>`
    g += `</circle>`
  }
  if (fresh) {
    const ty = top - 6.5
    g += `<g><rect x="${n(x - 22)}" y="${n(ty - 3.6)}" width="44" height="5.4" rx="2.7" fill="#fbbf24"/>`
    g += `<text x="${n(x)}" y="${n(ty + 0.3)}" text-anchor="middle" font-size="3" font-weight="800" fill="#1c1917" letter-spacing=".12">NEW · CLICK TO OPEN</text>`
    g += `<animate attributeName="opacity" values="1;.55;1" dur="1.6s" repeatCount="indefinite"/></g>`
  }
  return g + '</g>'
}

export function drawBillboards(world: World, sc: Scene): OverlayItem[] {
  const up = (world.billboards ?? []).filter(b => b.up !== undefined).sort((a, b) => (a.builtAt ?? 0) - (b.builtAt ?? 0))
  const count = new Map<string, number>()
  return up.map(b => {
    const place = same(b.root, world.homeRoot) ? '' : b.root.toLowerCase()
    const i = count.get(place) ?? 0
    count.set(place, i + 1)
    const [gx, gy] = spotOf(world, sc, b, i)
    return item(`billboard:${b.id}`, board(b, gx, gy))
  })
}
