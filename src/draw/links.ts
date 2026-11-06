import { esc, item, n, p } from './geo.ts'
import type { OverlayItem, Scene } from './geo.ts'
import { burbGeo, spotFor } from '../layout.ts'
import type { Link, World } from '../types.ts'

// Power lines between projects worked on together (World.links): lattice
// pylons from one project's square to the other's (home's by City
// Hall), a cable for each session that crossed (up to three), sagging
// between the towers. While work crosses the line it is lit, and sparks run
// along it.

// Work across a line within this long lights it.
export const LIVE_MS = 3 * 60_000
const TOWER = 22 // a pylon's height
const SPAN = 9 // cells between pylons, at most

const same = (a: string, b: string | undefined) => !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

// Where a project's end of a line stands, and its name; none for one with no place yet.
function endOf(world: World, sc: Scene, root: string): { at: [number, number]; name: string } | undefined {
  if (same(root, world.homeRoot)) return { at: spotFor(sc.layout, 'hall'), name: world.home }
  const repo = world.repos.find(r => same(r.root, root) && !r.left)
  const geo = repo ? burbGeo(sc.layout, repo.burb) : undefined
  if (!repo || !geo) return undefined
  return { at: geo.square, name: repo.name }
}

function pylon(gx: number, gy: number): string {
  const [x, y] = p(gx, gy)
  const t = y - TOWER
  return (
    `<path d="M${n(x - 2.4)} ${n(y)}L${n(x - 0.5)} ${n(t)}M${n(x + 2.4)} ${n(y)}L${n(x + 0.5)} ${n(t)}` +
    `M${n(x - 2)} ${n(y - 4)}L${n(x + 1.5)} ${n(y - 10)}M${n(x + 2)} ${n(y - 4)}L${n(x - 1.5)} ${n(y - 10)}` +
    `M${n(x - 1.4)} ${n(y - 11)}L${n(x + 1)} ${n(y - 17)}M${n(x + 1.4)} ${n(y - 11)}L${n(x - 1)} ${n(y - 17)}` +
    `M${n(x - 5)} ${n(t + 1.5)}H${n(x + 5)}M${n(x - 3.6)} ${n(t + 4.5)}H${n(x + 3.6)}" stroke="#94a3b8" stroke-width=".55" fill="none"/>` +
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="3" ry="1.4" fill="#000" opacity=".3"/>`
  )
}

function line(link: Link, from: [number, number], to: [number, number], names: [string, string], now: number): string {
  const live = now - link.lastAt < LIVE_MS
  const cables = Math.max(1, Math.min(3, link.sessions.length))
  // Pylons a little in from each end, and along the way at most SPAN apart.
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  const inset = Math.min(1.4, len / 4)
  const a: [number, number] = [from[0] + (dx / len) * inset, from[1] + (dy / len) * inset]
  const b: [number, number] = [to[0] - (dx / len) * inset, to[1] - (dy / len) * inset]
  const spans = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SPAN))
  const towers: [number, number][] = []
  for (let i = 0; i <= spans; i++) towers.push([a[0] + ((b[0] - a[0]) * i) / spans, a[1] + ((b[1] - a[1]) * i) / spans])
  const when = new Date(link.lastAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const tipTitle = `Power line: ${names[0]} ↔ ${names[1]}`
  const tipText = `${link.sessions.length} session${link.sessions.length === 1 ? '' : 's'} started in one worked in the other${live ? ', working across it now' : `; last ${when}`}. One cable for each, up to three.`
  let g = `<g class="powerline" data-tip-title="${esc(tipTitle)}" data-tip-text="${esc(tipText)}" style="--accent:${live ? '#fde68a' : '#94a3b8'}">`
  let wires = ''
  for (let i = 0; i < towers.length - 1; i++) {
    const [x0, y0] = p(...towers[i]!)
    const [x1, y1] = p(...towers[i + 1]!)
    for (let c = 0; c < cables; c++) {
      const off = (c - (cables - 1) / 2) * 3.2
      const ya = y0 - TOWER + 1.5
      const yb = y1 - TOWER + 1.5
      const sag = 6 + Math.abs(x1 - x0) * 0.06
      wires += `M${n(x0 + off)} ${n(ya)}Q${n((x0 + x1) / 2 + off)} ${n((ya + yb) / 2 + sag * 2)} ${n(x1 + off)} ${n(yb)}`
    }
  }
  // A wide clear stroke to hover, under the wires.
  g += `<path d="${wires}" stroke="transparent" stroke-width="5" fill="none" pointer-events="stroke"/>`
  g += `<path d="${wires}" stroke="${live ? '#fde68a' : '#64748b'}" stroke-width="${live ? 0.7 : 0.5}" fill="none" opacity="${live ? 0.95 : 0.7}" pointer-events="none"/>`
  if (live) {
    g += `<path d="${wires}" stroke="#fffbeb" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="1.2 22" fill="none" pointer-events="none">` +
      `<animate attributeName="stroke-dashoffset" values="0;-23.2" dur=".9s" repeatCount="indefinite"/></path>`
  }
  for (const [gx, gy] of towers) g += pylon(gx, gy)
  return g + '</g>'
}

export function drawLinks(world: World, sc: Scene): OverlayItem[] {
  const out: OverlayItem[] = []
  for (const link of world.links ?? []) {
    const a = endOf(world, sc, link.a)
    const b = endOf(world, sc, link.b)
    if (!a || !b) continue
    const svg = line(link, a.at, b.at, [a.name, b.name], sc.now)
    out.push(item(`link:${link.a.toLowerCase()}|${link.b.toLowerCase()}`, svg))
  }
  return out
}
