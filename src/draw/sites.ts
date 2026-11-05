import { esc, item, n, p, pts } from './geo.ts'
import type { OverlayItem, Scene } from './geo.ts'
import { frameOf } from './billboards.ts'
import { burbGeo, spotFor } from '../layout.ts'
import { boardOf } from '../sites.ts'
import type { Board } from '../sites.ts'
import type { Census, World } from '../types.ts'

// Each project's construction site (src/sites.ts), drawn as a builder's
// board on its square: the permit (pending for a branch at work, filed with
// its pull request), the last inspection's tag (green passed, red failed),
// and "Now open" after a ribbon cutting, when a red ribbon is cut across the
// square in a shower of confetti. A click on a board with a pull request
// opens it (the page's handler, by data-site-url).

const same = (a: string, b: string | undefined) => !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)

const W = 2.1 // along the board
const Z0 = 5 // the board's bottom and top, above the ground
const Z1 = 14

const STAGE: Record<Board['stage'], { head: string; face: string; band: string; ink: string }> = {
  pending: { head: 'PERMIT PENDING', face: '#fef3c7', band: '#f59e0b', ink: '#451a03' },
  permit: { head: 'BUILDING PERMIT', face: '#f8fafc', band: '#2563eb', ink: '#0f172a' },
  open: { head: 'NOW OPEN', face: '#dcfce7', band: '#16a34a', ink: '#052e16' },
  office: { head: 'SITE OFFICE', face: '#e2e8f0', band: '#475569', ink: '#0f172a' },
}

function tipOf(name: string, b: Board): [string, string] {
  const insp = b.inspection
    ? ` Last inspection: ${b.inspection.what} ${b.inspection.passed ? 'passed' : 'failed'}${b.inspection.detail ? ` (${b.inspection.detail})` : ''}.`
    : ''
  if (b.stage === 'open') return [`${name}: now open`, `Pull request${b.pr ? ` #${b.pr}` : ''} merged: the ribbon is cut.${b.url ? ' Click to see it.' : ''}`]
  if (b.stage === 'permit') return [`${name}: permit #${b.pr}`, `A pull request filed${b.branch ? ` for ${b.branch}` : ''}: the building permit. It is open until the pull request is merged.${insp} Click to see it.`]
  if (b.stage === 'pending') return [`${name}: permit pending`, `Work under way on ${b.branch}, with no pull request filed yet.${insp}`]
  return [`${name}: site office`, `The site's last inspection.${insp}`]
}

function board(b: Board, name: string, cx: number, cy: number): string {
  const f = frameOf(cx, cy, 'l')
  const st = STAGE[b.stage]
  const u0 = -W / 2
  const u1 = W / 2
  const [title, text] = tipOf(name, b)
  const failed = b.inspection && !b.inspection.passed
  let g = `<g class="site-board" data-tip-title="${esc(title)}" data-tip-text="${esc(text)}"${b.url ? ` data-site-url="${esc(b.url)}" style="cursor:pointer;--accent:${st.band}"` : ` style="--accent:${st.band}"`}>`
  // Two timber posts.
  const post: [string, string, string] = ['#a16207', '#854d0e', '#ca8a04']
  g += f.slab(u0 + 0.25, u0 + 0.37, -0.12, 0, Z0 + 1, post)
  g += f.slab(u1 - 0.37, u1 - 0.25, -0.12, 0, Z0 + 1, post)
  // The board: a plywood frame, its face, and a coloured band across the top.
  g += f.slab(u0, u1, -0.1, 0, Z1 - Z0, ['#78350f', '#57290b', '#92400e'], Z0)
  g += f.poly([[u0 + 0.08, 0, Z0 + 0.5], [u1 - 0.08, 0, Z0 + 0.5], [u1 - 0.08, 0, Z1 - 0.5], [u0 + 0.08, 0, Z1 - 0.5]], st.face)
  g += f.poly([[u0 + 0.08, 0, Z1 - 3.4], [u1 - 0.08, 0, Z1 - 3.4], [u1 - 0.08, 0, Z1 - 0.5], [u0 + 0.08, 0, Z1 - 0.5]], st.band)
  g += f.text(0, Z1 - 2.6, st.head, 1.7, '#ffffff', 800)
  const line = b.stage === 'open' ? (b.pr ? `#${b.pr} MERGED` : 'MERGED') : b.stage === 'permit' ? `#${b.pr}` : b.stage === 'pending' ? 'NO PR YET' : (b.inspection?.what ?? '').toUpperCase()
  g += f.text(0, Z1 - 6, line, b.stage === 'permit' ? 2.6 : 1.9, st.ink, 800)
  if (b.branch) g += f.text(0, Z0 + 1.7, clip(b.branch, 18), 1.4, st.ink, 600)
  // The inspection's tag, hung under the board between its posts.
  if (b.inspection) {
    const t0 = Z0 - 3.4
    const t1 = Z0 - 0.9
    const half = 0.6
    const fill = failed ? '#dc2626' : '#16a34a'
    g += `<g class="tag">`
    g += `<path d="M${pts([f.pt([-0.3, 0.02, t1]), f.pt([-0.3, 0.02, Z0])])}M${pts([f.pt([0.3, 0.02, t1]), f.pt([0.3, 0.02, Z0])])}" stroke="#57534e" stroke-width=".3"/>`
    g += f.poly([[-half, 0.02, t0], [half, 0.02, t0], [half, 0.02, t1], [-half, 0.02, t1]], fill, ' stroke="#0b1224" stroke-width=".2"')
    const label = `${failed ? '✗ FAILED' : '✓ PASSED'}`
    g += f.text(0, t0 + 0.75, label, 1.15, '#ffffff', 800)
    if (failed) g += `<animate attributeName="opacity" values="1;.45;1" dur="1.4s" repeatCount="indefinite"/>`
    g += `</g>`
  }
  return g + '</g>'
}

// A red ribbon across the square, cut in the middle, and confetti falling.
function ribbon(cx: number, cy: number): string {
  const post = (gx: number) => {
    const [x0, y0] = p(gx, cy)
    const [, y1] = p(gx, cy, 6)
    return `<path d="M${n(x0)} ${n(y0)}V${n(y1)}" stroke="#e5e7eb" stroke-width=".9"/><circle cx="${n(x0)}" cy="${n(y1)}" r=".9" fill="#fbbf24"/>`
  }
  const [ax, ay] = p(cx - 1.4, cy, 5)
  const [mx, my] = p(cx, cy, 5)
  const [bx, by] = p(cx + 1.4, cy, 5)
  let g = `<g class="ribbon" pointer-events="none">`
  g += post(cx - 1.4) + post(cx + 1.4)
  // The two cut ends, drooping from the posts.
  g += `<path d="M${n(ax)} ${n(ay)}Q${n((ax + mx) / 2)} ${n((ay + my) / 2 + 2.6)} ${n(mx - 1.2)} ${n(my + 3.4)}" stroke="#dc2626" stroke-width="1.1" fill="none"/>`
  g += `<path d="M${n(bx)} ${n(by)}Q${n((bx + mx) / 2)} ${n((by + my) / 2 + 2.6)} ${n(mx + 1.2)} ${n(my + 3.4)}" stroke="#dc2626" stroke-width="1.1" fill="none"/>`
  // The bow, on the ground where it fell.
  const [gx, gy] = p(cx, cy + 0.3)
  g += `<path d="M${n(gx)} ${n(gy)}l-2.2 -1.3v2.6zM${n(gx)} ${n(gy)}l2.2 -1.3v2.6z" fill="#b91c1c"/>`
  const colors = ['#f472b6', '#fbbf24', '#38bdf8', '#a3e635', '#c084fc', '#fb7185']
  for (let i = 0; i < 18; i++) {
    const [x, y] = p(cx - 1.6 + ((i * 7) % 18) / 5.6, cy - 0.6 + ((i * 5) % 9) / 6, 16 + ((i * 3) % 7))
    const dur = (1.6 + (i % 5) * 0.25).toFixed(2)
    g += `<rect x="${n(x)}" y="${n(y)}" width=".9" height=".5" fill="${colors[i % colors.length]}">` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;${(i % 3) - 1} 18" dur="${dur}s" begin="${((i * 0.17) % 1.5).toFixed(2)}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="1;1;0" dur="${dur}s" begin="${((i * 0.17) % 1.5).toFixed(2)}s" repeatCount="indefinite"/></rect>`
  }
  return g + '</g>'
}

// Where a project's site is: its board, and the middle of its square for the
// ribbon. Manhattan's is by City Hall; a project with no borough has none.
function placeOf(world: World, sc: Scene, root: string): { board: [number, number]; square: [number, number]; census?: Census } | undefined {
  if (same(root, world.homeRoot)) {
    const [x, y] = spotFor(sc.layout, 'hall')
    return { board: [x + 2.4, y + 1.2], square: [x, y + 1.2] }
  }
  const repo = world.repos.find(r => same(r.root, root) && !r.left)
  const geo = repo ? burbGeo(sc.layout, repo.burb) : undefined
  if (!repo || !geo) return undefined
  const [sx, sy] = geo.square
  if (!geo.preset) {
    const [, , x1, y1] = geo.rect
    return { board: [x1 - 1.5, y1 - 0.4], square: [sx, sy + 0.2], census: repo.census }
  }
  return { board: [sx + 3.2, sy + 2.2], square: [sx, sy + 1.2], census: repo.census }
}

export function drawSites(world: World, sc: Scene): OverlayItem[] {
  // Every project with a site record, and every borough whose census shows a branch at work.
  const roots = new Map<string, string>()
  for (const s of world.sites ?? []) roots.set(s.root.toLowerCase(), s.root)
  for (const r of world.repos) if (!r.left && r.census?.branch) roots.set(r.root.toLowerCase(), r.root)
  const out: OverlayItem[] = []
  for (const root of roots.values()) {
    const at = placeOf(world, sc, root)
    if (!at) continue
    const site = (world.sites ?? []).find(s => same(s.root, root))
    const b = boardOf(site, at.census, sc.now)
    if (!b) continue
    const name = same(root, world.homeRoot) ? world.home : (world.repos.find(r => same(r.root, root))?.name ?? root)
    out.push(item(`site:${root.toLowerCase()}`, board(b, name, ...at.board)))
    if (b.ribbon) out.push(item(`ribbon:${root.toLowerCase()}`, ribbon(...at.square)))
  }
  return out
}
