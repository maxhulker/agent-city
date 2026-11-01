import { frame, n } from './draw/geo.ts'
import type { Scene } from './draw/geo.ts'
import { AGENT_CSS, drawAgents, drawRides } from './draw/agents.ts'
import { defs, drawMap } from './draw/map.ts'
import { PLACES_CSS, drawPlaces } from './draw/places.ts'
import type { Agent, Burb, District, World } from './types.ts'

export { AGENT_COLORS, BURBS, BURB_ORDER, LABELS, districtFor, mainColor } from './draw/geo.ts'

// Draws the world as one animated isometric SVG of Manhattan at night. Pure:
// no I/O, so the server renders it on each change. The page zooms and pans it.

export function renderCity(world: World, now: number, opts: { animateWalks: boolean }): string {
  const visible = world.agents.filter(a => a.status !== 'done' || now - a.updatedAt < 90_000)
  const byDistrict = new Map<District, Agent[]>()
  const byBurb = new Map<Burb, Agent[]>()
  for (const a of visible) {
    if (a.burb) byBurb.set(a.burb, [...(byBurb.get(a.burb) ?? []), a])
    else byDistrict.set(a.at, [...(byDistrict.get(a.at) ?? []), a])
  }
  const active = new Set<District>()
  for (const [d, list] of byDistrict) if (list.some(a => a.status === 'working')) active.add(d)
  const repoOf = new Map(world.repos.map(r => [r.burb, r]))
  const sc: Scene = {
    now,
    animateWalks: opts.animateWalks,
    byDistrict,
    byBurb,
    active,
    hasConflict: world.conflicts.length > 0,
    isWaiting: world.asks.length > 0,
    repoOf,
    k: 1.4,
  }

  const vb = frame([...repoOf.keys()])
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="city" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" preserveAspectRatio="xMidYMid meet" font-family="ui-sans-serif, system-ui, Segoe UI, sans-serif">`
  s += defs()
  s += `<style>${AGENT_CSS}${PLACES_CSS}</style>`
  s += `<rect x="${n(vb.x - 2000)}" y="${n(vb.y - 2000)}" width="${n(vb.w + 4000)}" height="${n(vb.h + 4000)}" fill="url(#sea)"/>`
  s += drawMap(world, sc)
  // Hover zones between the city and the agents, so agents keep their own hover.
  s += drawPlaces(world, sc)
  s += drawAgents(world, sc)
  // Taxis last, so they drive over everyone.
  s += drawRides(world, sc)
  s += `</svg>`
  return s
}
