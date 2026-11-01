import { LANDMARKS, frame, item, n } from './draw/geo.ts'
import type { OverlayItem, Scene, Sprite } from './draw/geo.ts'
import { AGENT_CSS, drawRides, drawSprites, drawTrains } from './draw/agents.ts'
import { defs, drawMap, drawOverlay, mapKey } from './draw/map.ts'
import { PLACES_CSS, drawPlaces } from './draw/places.ts'
import { manhattanLayout } from './layout.ts'
import type { Layout } from './layout.ts'
import type { Agent, Burb, District, World } from './types.ts'

export { AGENT_COLORS, BLUEPRINTS, BURBS, BURB_ORDER, LABELS, LANDMARKS, districtFor, mainColor } from './draw/geo.ts'
export type { OverlayItem, Sprite } from './draw/geo.ts'

// Draws the world as the three layers the page composes (docs/frames.md):
// the still map, the overlay of keyed animated items, and the agents as
// sprites. Pure: no I/O, so the server renders it on each change.

export type Frame = {
  // The still city, with its hash: the server sends it only when it changes.
  map: { hash: string; svg: string }
  // What stands where, for the page's build cursor: the server sends it only
  // when its revision changes.
  layout: Layout
  // Everything dynamic but the agents, in paint order.
  overlay: OverlayItem[]
  // The agents, which the page draws and moves itself.
  agents: Sprite[]
}

export type RenderOptions = { update?: Scene['update']; connected?: boolean }

// The map takes a while to draw and changes rarely, so the last one is kept
// by its key.
let lastMap: { hash: string; svg: string } | undefined

export function renderFrame(world: World, now: number, opts: RenderOptions = {}): Frame {
  // Everyone still in the world is drawn; whoever has left is gone from it.
  const visible = world.agents
  const byDistrict = new Map<District, Agent[]>()
  const byBurb = new Map<Burb, Agent[]>()
  for (const a of visible) {
    if (a.burb) byBurb.set(a.burb, [...(byBurb.get(a.burb) ?? []), a])
    else byDistrict.set(a.at, [...(byDistrict.get(a.at) ?? []), a])
  }
  const active = new Set<District>()
  for (const [d, list] of byDistrict) if (list.some(a => a.status === 'working')) active.add(d)
  const repoOf = new Map(world.repos.filter(r => !r.left).map(r => [r.burb, r]))
  // Boroughs whose repository packed up and nobody moved into: the houses stay. The
  // latest to leave names the place.
  const vacantOf = new Map(
    world.repos
      .filter(r => r.left && !repoOf.has(r.burb))
      .sort((a, b) => (a.left ?? 0) - (b.left ?? 0))
      .map(r => [r.burb, r]),
  )
  const layout = world.layout ?? manhattanLayout(world.built)
  const sc: Scene = {
    now,
    byDistrict,
    byBurb,
    active,
    hasConflict: world.conflicts.length > 0,
    isWaiting: world.asks.length > 0,
    repoOf,
    vacantOf,
    k: 1.4,
    ...(opts.update ? { update: opts.update } : {}),
    // A world saved before the game existed counts as fully built.
    built: world.built ?? Object.fromEntries(LANDMARKS.map(id => [id, 0])),
    population: world.built ? (world.population ?? 0) : Infinity,
    connected: opts.connected ?? true,
    layout,
    rev: layout.rev,
  }

  const key = mapKey(sc)
  if (!lastMap || lastMap.hash !== key) {
    const vb = frame([...repoOf.keys(), ...vacantOf.keys()])
    let s = `<svg xmlns="http://www.w3.org/2000/svg" class="city map" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" preserveAspectRatio="xMidYMid meet" font-family="ui-sans-serif, system-ui, Segoe UI, sans-serif">`
    s += defs()
    // The styles apply to the whole page, the overlay's SVG included.
    s += `<style>${AGENT_CSS}${PLACES_CSS}</style>`
    s += `<rect x="${n(vb.x - 2000)}" y="${n(vb.y - 2000)}" width="${n(vb.w + 4000)}" height="${n(vb.h + 4000)}" fill="url(#sea)"/>`
    s += drawMap(sc)
    s += `</svg>`
    lastMap = { hash: key, svg: s }
  }

  const overlay = [
    ...drawOverlay(world, sc),
    // The train home waits at Grand Central, behind whoever is boarding it.
    ...drawTrains(world, sc),
    // Hover zones between the city and the agents, so agents keep their own hover.
    item('zones', drawPlaces(world, sc)),
    // Taxis last, so they drive over everyone.
    ...drawRides(world, sc),
  ]
  return { map: lastMap, layout, overlay, agents: drawSprites(world, sc) }
}
