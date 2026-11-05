import type { Block, Burb, Census, PresetBurb } from '../types.ts'
import { BURBS, seeded } from './geo.ts'
import { boroughAt, lotsOf } from '../layout.ts'
import type { Layout, Lot } from '../layout.ts'
import type { Pal } from './map.ts'
import { REST, WINDOW_DAYS } from '../census.ts'

// A borough's houses as its repository's folders (src/census.ts). The
// borough keeps its streets and its house plots, its slots; the census
// decides which stand and what each is: every folder takes a run of houses
// side by side, as many as its share of the files, as tall as its size, lit
// if it was worked on in the last two weeks and dark if not. A small
// repository leaves plots empty, room to grow. Pure: the map draws the
// houses, the overlay their scaffolding, and the hover zones their names.

export const HOUSE_PALS: Pal[] = ['b', 'b', 'r', 'b', 'r', 's']

// One house plot: its footprint (x along the row, from y0, d deep), its own
// height and palette when no census says otherwise, whether it is the tall
// corner house, and its row (back to front).
export type Slot = { x: number; y0: number; w: number; d: number; h: number; pal: Pal; corner: boolean; ri: number }

// A preset borough's houses: rows back to front, each row west to east,
// apartments at the back, then brownstone rows back to back, the front row
// facing the square, with the tall corner house at its east end.
export function houses(b: PresetBurb): Slot[] {
  const [cx, cy] = BURBS[b].center
  const rows: [number, number, number][] = [
    [cy - 3.4, 12, 3],
    [cy - 2.15, 6.4, 1.4],
    [cy - 1.45, 6.4, 1.4],
    [cy - 0.2, 6, 1.4],
    [cy + 0.5, 6, 1.4],
  ]
  const out: Slot[] = []
  rows.forEach(([y0, base, spread], ri) => {
    let x = cx - 3.4
    let i = 0
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
      out.push({ x, y0, w: w - 0.03, d: 0.62, h, pal, corner, ri })
      x += w
      i++
    }
  })
  return out
}

// A zoned lot in a drawn borough: three or four narrow houses, a storey or
// two apart, with a tall corner one now and then.
export function lotHouses({ x, y, x0, x1 }: Lot, ri = 0): Slot[] {
  const q = seeded(x, y)
  const count = q > 0.5 ? 4 : 3
  const w = (x1 - x0) / count
  const out: Slot[] = []
  for (let i = 0; i < count; i++) {
    const qi = seeded(x + i * 0.37, y)
    const corner = i === count - 1 && q > 0.7
    out.push({ x: x0 + i * w, y0: y + 0.18, w: w - 0.03, d: 0.64, h: corner ? 11 : 5.5 + qi * 2.5, pal: HOUSE_PALS[Math.floor(qi * HOUSE_PALS.length)]!, corner, ri })
  }
  return out
}

// The zoned lots inside a drawn borough, in zoning order.
export function lotsIn(layout: Layout, id: Burb): Lot[] {
  return lotsOf(layout).filter(l => boroughAt(layout, l.x, l.y)?.id === id)
}

// A borough's house plots, back to front: the preset's own rows, or the
// houses on a drawn borough's zoned lots.
export function slotsOf(layout: Layout, id: Burb, preset: boolean): Slot[] {
  if (preset) return houses(id as PresetBurb)
  const lots = lotsIn(layout, id).sort((a, b) => a.y - b.y || a.x - b.x)
  return lots.flatMap((l, i) => lotHouses(l, i))
}

// How tall a folder stands: a storey or so for a few small files, a tower
// for megabytes of them.
export function heightOf(bytes: number): number {
  return Math.min(26, 3.5 + 2.6 * Math.log2(1 + bytes / 20_480))
}

// What a folder looks like: tests in red brick, docs in stone, assets and
// the loose files in grey, the code itself in brownstone.
export function palOf(block: Block): Pal {
  const name = block.path.split('/').pop()!.toLowerCase()
  if (block.path === '' || block.path === REST) return 'k'
  if (/^(tests?|spec|specs|__tests__|e2e|testing)$/.test(name)) return 'r'
  if (/^(docs?|documentation|guides?|examples?)$/.test(name) || block.ext === 'md') return 's'
  if (/^(public|static|assets?|images?|img|media|fonts|icons)$/.test(name)) return 'k'
  if (/^(\.github|scripts?|bin|tools|config|ci)$/.test(name)) return 'k'
  return 'b'
}

// A plot as the census has it: which folder stands there (-1 for none: an
// empty plot), how tall, in what, and whether its windows are lit.
export type Placed = Slot & { block: number; lit: boolean }

// How many plots a repository fills: about four per square root of its
// files, at least one per folder, at most the borough.
export function plotsFor(census: Census, total: number): number {
  return Math.max(Math.min(census.blocks.length, total), Math.min(total, Math.round(4 * Math.sqrt(census.files))))
}

// The census on a borough's plots. The front plots fill first (the back stays
// empty for a small repository), the biggest folders at the back of what
// stands, so the tall ones don't hide the short ones; each folder takes a
// run of plots by its share of the files (one at least). A folder the person
// pinned somewhere (census.pins) takes its run from the plot nearest its pin
// first; the rest fill in around it as before.
export function placeBlocks(slots: Slot[], census: Census): Placed[] {
  const total = slots.length
  const used = plotsFor(census, total)
  const blocks = census.blocks.slice(0, used)
  // One plot each, then the rest by share of files, largest remainder first.
  const files = blocks.reduce((s, b) => s + b.files, 0) || 1
  const spare = used - blocks.length
  const want = blocks.map(b => (b.files / files) * spare)
  const count = want.map(w => 1 + Math.floor(w))
  let left = used - count.reduce((s, c) => s + c, 0)
  const order = want.map((w, i) => [w - Math.floor(w), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && order.length; k++, left--) count[order[k % order.length]![1]]!++

  // Which folder stands on each plot: -1 for none.
  const owner: number[] = new Array(total).fill(-1)
  const pins = census.pins ?? {}
  const pinned = new Set<number>()
  blocks.forEach((b, bi) => {
    const pin = pins[b.path]
    if (!pin) return
    const free = owner.map((o, i) => (o < 0 ? i : -1)).filter(i => i >= 0)
    if (free.length < count[bi]!) return
    // The free plot nearest the pin, then the next free ones after it, round to the start.
    const start = free.reduce((best, i) => (dist(slots[i]!, pin) < dist(slots[best]!, pin) ? i : best), free[0]!)
    const run = [...free.filter(i => i >= start), ...free.filter(i => i < start)].slice(0, count[bi])
    for (const i of run) owner[i] = bi
    pinned.add(bi)
  })
  // The rest on the frontmost free plots, in order, as with no pins at all.
  const rest = blocks.map((_, bi) => bi).filter(bi => !pinned.has(bi))
  const need = rest.reduce((s, bi) => s + count[bi]!, 0)
  const plots = owner.map((o, i) => (o < 0 ? i : -1)).filter(i => i >= 0).slice(-need || total)
  let k = 0
  for (const bi of rest) for (let c = 0; c < count[bi]! && k < plots.length; c++) owner[plots[k++]!] = bi

  return slots.map((s, i) => {
    const bi = owner[i]!
    const b = blocks[bi]
    if (bi < 0 || !b) return { ...s, block: -1, lit: false }
    // A storey or so between neighbours, so a run reads as a terrace.
    const jitter = (seeded(s.x * 5.3, s.y0 * 2.1) - 0.5) * 1.6
    return { ...s, block: bi, h: Math.max(3, heightOf(b.bytes) + jitter), pal: palOf(b), lit: b.commits > 0, corner: false }
  })
}

const dist = (s: Slot, [x, y]: [number, number]) => Math.hypot(s.x + s.w / 2 - x, s.y0 + s.d / 2 - y)

// The plot nearest a point on the grid, and how far it is (cells): where a
// house dropped there would stand.
export function nearestSlot(slots: Slot[], at: [number, number]): { i: number; d: number } | undefined {
  let best: { i: number; d: number } | undefined
  slots.forEach((s, i) => {
    const d = dist(s, at)
    if (!best || d < best.d) best = { i, d }
  })
  return best
}

// Each folder's houses as boxes for its hover zone: one per row it runs along.
export type Run = { block: number; box: [number, number, number, number]; h: number }

export function runsOf(placed: Placed[]): Run[] {
  const out: Run[] = []
  for (const s of placed) {
    if (s.block < 0) continue
    const last = out[out.length - 1]
    if (last && last.block === s.block && Math.abs(last.box[1] - s.y0) < 0.01 && s.x - last.box[2] < 0.1) {
      last.box[2] = s.x + s.w
      last.h = Math.max(last.h, s.h)
      continue
    }
    out.push({ block: s.block, box: [s.x, s.y0, s.x + s.w, s.y0 + s.d], h: s.h })
  }
  return out
}

// ---- words ---------------------------------------------------------------

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ago(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

const plural = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`

export function blockName(b: Block): string {
  return b.path === '' ? 'Top-level files' : b.path === REST ? 'Smaller folders' : `${b.path}/`
}

// A folder's hover: what it holds and what has happened in it.
export function blockTip(b: Block, now: number): { title: string; text: string } {
  const what = `${plural(b.files, 'file')}, ${size(b.bytes)}${b.ext ? `, mostly .${b.ext}` : ''}.`
  const work = b.commits
    ? `${plural(b.commits, 'commit')} in the last two weeks, the latest ${ago(now - (b.lastAt ?? now))}: its windows are lit.`
    : `No commits in the last ${WINDOW_DAYS} days: its windows are dark.`
  const dirty = b.dirty ? ` ${plural(b.dirty, 'file')} with uncommitted changes: scaffolding is up.` : ''
  const age = weatherOf(b, now)
  const weather = age ? ` ${WEATHER_SAYS[age]} (last commit ${ago(now - b.touchedAt!)}). Restore it from its files.` : ''
  return { title: blockName(b), text: `${what} ${work}${dirty}${weather}` }
}

// How weathered a folder is from how long since any commit touched it: 0
// fresh; 1 ivy climbing (two months); 2 windows boarded up (six months);
// 3 derelict (a year). One being worked on now doesn't weather.
export const WEATHER_DAYS = [60, 180, 365]
const WEATHER_SAYS = ['', 'Ivy is climbing its walls', 'Its windows are boarded up', 'It stands derelict']

export function weatherOf(b: Block, now: number): 0 | 1 | 2 | 3 {
  if (!b.touchedAt || b.dirty || b.path === REST) return 0
  const days = (now - b.touchedAt) / 86_400_000
  return days >= WEATHER_DAYS[2]! ? 3 : days >= WEATHER_DAYS[1]! ? 2 : days >= WEATHER_DAYS[0]! ? 1 : 0
}

// The line under a borough's sign: the branch, how it stands with its
// upstream, and the fortnight's commits; then what is uncommitted, if anything.
export function signLine(c: Census): [string, string] {
  const parts: string[] = []
  if (c.branch) {
    const sync = [c.ahead ? `↑${c.ahead}` : '', c.behind ? `↓${c.behind}` : ''].filter(Boolean).join(' ')
    parts.push(sync ? `${c.branch} ${sync}` : c.branch)
  }
  parts.push(c.commits ? `${c.commits} ${c.commits === 1 ? 'commit' : 'commits'}/2 wks` : 'quiet 2 wks')
  return [parts.join(' · '), c.dirty ? `${c.dirty} uncommitted` : '']
}

// The borough's hover: the repository at a glance.
export function censusText(c: Census, now: number): string {
  const lines = [`${plural(c.files, 'file')}, ${size(c.bytes)}, in ${plural(c.blocks.length, 'folder')}: each run of houses is one, as tall as its size.`]
  if (c.branch) {
    const up = c.ahead === undefined ? 'no upstream' : !c.ahead && !c.behind ? 'up to date with its upstream' : [c.ahead ? `${c.ahead} ahead` : '', c.behind ? `${c.behind} behind` : ''].filter(Boolean).join(', ')
    lines.push(`On ${c.branch}, ${up}.`)
  }
  lines.push(c.commits ? `${plural(c.commits, 'commit')} in the last two weeks.` : 'No commits in the last two weeks.')
  if (c.last) lines.push(`Last commit ${ago(now - c.last.at)} by ${c.last.who}: "${c.last.subject}".`)
  if (c.dirty) lines.push(`${plural(c.dirty, 'file')} with uncommitted changes.`)
  return lines.join(' ')
}
