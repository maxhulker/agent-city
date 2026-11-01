import { LANDMARKS, frame, n } from './draw/geo.ts'
import type { Scene } from './draw/geo.ts'
import { AGENT_CSS, drawAgents, drawRides, drawTrains } from './draw/agents.ts'
import { defs, drawMap } from './draw/map.ts'
import { PLACES_CSS, drawPlaces } from './draw/places.ts'
import type { Agent, Burb, District, World } from './types.ts'

export { AGENT_COLORS, BURBS, BURB_ORDER, LABELS, districtFor, mainColor } from './draw/geo.ts'

// Draws the world as one animated isometric SVG of Manhattan at night. Pure:
// no I/O, so the server renders it on each change. The page zooms and pans it.

export function renderCity(world: World, now: number, opts: { animateWalks: boolean; update?: Scene['update']; connected?: boolean }): string {
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
  const sc: Scene = {
    now,
    animateWalks: opts.animateWalks,
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
  }

  const vb = frame([...repoOf.keys(), ...vacantOf.keys()])
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="city" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" preserveAspectRatio="xMidYMid meet" font-family="ui-sans-serif, system-ui, Segoe UI, sans-serif">`
  s += defs()
  s += `<style>${AGENT_CSS}${PLACES_CSS}</style>`
  s += `<rect x="${n(vb.x - 2000)}" y="${n(vb.y - 2000)}" width="${n(vb.w + 4000)}" height="${n(vb.h + 4000)}" fill="url(#sea)"/>`
  s += drawMap(world, sc)
  // The train home waits at Grand Central, behind whoever is boarding it.
  s += drawTrains(world, sc)
  // Hover zones between the city and the agents, so agents keep their own hover.
  s += drawPlaces(world, sc)
  s += drawAgents(world, sc)
  // Taxis last, so they drive over everyone.
  s += drawRides(world, sc)
  s += `</svg>`
  return s
}
