// A whole city on a generated map, for the tests: avenues and streets over
// the hub island, every landmark placed as near the station as it fits, and
// every lot left beside a road zoned. It stands in for the hand-drawn
// Manhattan the tests used to start from.

import { FOOTPRINT, cityBuildings, connectBorough, doorOf, fillBorough, findSite } from '../src/layout.ts'
import type { Borough, Kind, Layout } from '../src/layout.ts'
import { planCity } from '../src/plan.ts'
import { City, emptyWorld } from '../src/world.ts'

export const SEED = 7

export function wholeLayout(seed = SEED): Layout {
  return planCity(seed)
}

// A City on the whole layout, nothing else changed.
export function wholeCity(seed = SEED): City {
  return new City({ ...emptyWorld(), layout: wholeLayout(seed) })
}

// Every kind placed? (For the fixture's own test.)
export function missing(l: Layout): Kind[] {
  return (Object.keys(FOOTPRINT) as Kind[]).filter(k => !cityBuildings(l, k).length)
}

// A borough laid out on the free mainland nearest the station, with its
// streets and lots, as "Build it for me" would. Changes the layout in place.
export function addBorough(layout: Layout, id: string, name: string, w = 8, h = 9): Borough {
  const st = cityBuildings(layout, 'station')[0]!
  const r = findSite(layout, w, h, [st.x + 2, st.y + 1])
  if (!r) throw new Error(`no room for ${name}`)
  const bo: Borough = { id, name, x: r[0], y: r[1], w, h }
  layout.boroughs.push(bo)
  const filled = fillBorough(layout, id).layout
  Object.assign(layout, connectBorough(filled, id), { rev: layout.rev })
  return layout.boroughs.find(b => b.id === id)!
}

// The whole layout with a borough for each name, each id the name in lower
// case without spaces ('Brooklyn' is 'brooklyn'), in the order given.
export function layoutWith(...names: string[]): Layout {
  const l = wholeLayout()
  for (const name of names) addBorough(l, name.toLowerCase().replace(/\s+/g, ''), name)
  return l
}

export function cityWith(...names: string[]): City {
  return new City({ ...emptyWorld(), layout: layoutWith(...names) })
}

// The station's door: where a home agent with nothing of its kind placed waits.
export const stationDoor = (l: Layout) => doorOf(cityBuildings(l, 'station')[0]!)
