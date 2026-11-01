# How the server streams the city to the page

The page used to get one complete SVG of the whole city about once a second
and swap it in, which cost ~300 ms of drawing per swap and cut agents' walks
short. Now the city comes in three layers, and the page keeps what hasn't
changed.

Each Server-Sent Event on `/stream` is one JSON object:

```ts
type Frame = {
  // The static city. Sent on connect and whenever its hash changes; omitted
  // otherwise, and then the page keeps the one it has.
  map?: { hash: string; svg: string }
  // Everything dynamic except the agents, in paint order.
  overlay: OverlayItem[]
  // The agents; the page draws and moves them itself.
  agents: Sprite[]
  meta: Meta // as before (sessions, tasks, pending, appSessions, update, ...)
}
```

## map

A complete `<svg class="city map" viewBox="…" preserveAspectRatio="xMidYMid meet">`
with its `<defs>` (gradients, patterns) and `<style>`: water, land, island,
streets, lamps, the city fabric, the landmark buildings, bridges, trees,
neighbourhood and water labels. Nothing in it animates. It depends only on
things that rarely change (which repos are in which borough, Manhattan's
name), so its hash stays the same for minutes or hours. Ids in its `<defs>`
are document-global, so the overlay can use them (`url(#halo)` etc.).

## overlay

```ts
type OverlayItem = {
  k: string // stable key: 'pad:library', 'label:hall', 'cars', 'statue', 'ride:<id>', 'zones', 'fireworks'…
  h: string // hash of what the item shows, from its INPUTS, never from its text: it must
            // stay the same while the item looks the same, even if its SVG text holds
            // time-dependent values (negative SMIL begin offsets)
  svg: string // an SVG fragment (no <svg> root), drawn in the overlay's own SVG
  top?: true  // drawn above the agents (taxis, beacons, fireworks)
}
```

The page keeps one `<svg class="city overlay">` with the map's viewBox,
holding a `<g>` per item keyed by `k`. It replaces an item's content only when
its `h` changes, adds new keys, removes missing ones, and keeps the order. So
running animations (smoke, cars, the statue's launch) are not restarted by a
frame that didn't change them.

Overlay items include: district pads and glows and their labels (they change
with who's busy), smoke/sparks/rings at busy landmarks, scaffolding, the
merge-conflict alarm and the "?" beacon, cars and boats, the Statue of Liberty
(at rest or launching), the Empire State's update glow and fireworks, the
borough neighbourhoods' signs and glow, taxis (rides), and the hover zones
(`polygon.zone` with the `data-tip-*` and `data-update` attributes the page
reads).

## agents

```ts
type Sprite = {
  id: string
  session: string
  cls: string // 'agent working' / 'agent idle' / … (the page adds 'sel')
  x: number   // where it stands now (SVG units), its feet
  y: number
  z: number   // paint order: higher draws later (in front)
  fig: { h: string; svg: string } // the figure drawn around (0,0): shadow,
                                  // body, prop, bullet, badge, name, bubble, ring
  // While walking: the route in SVG units, ending at (x, y), started at t0
  // (epoch ms, server clock = page clock, same machine), lasting dur ms.
  // Sent on every frame until the walk is over, so a walk always plays out.
  walk?: { t0: number; dur: number; pts: [number, number][] }
}
```

The page keeps one `<g class="… agent" data-agent data-session>` per id with
an inner `<g class="fig">`, replacing the fig only when `fig.h` changes, and
sets `transform="translate(x,y)"` itself on every animation frame: along
`walk.pts` (eased at both ends) while `now < t0 + dur`, at `(x, y)` after. A
new walk arriving mid-walk starts from where the agent is drawn now (the page
swaps `pts[0]` for its current position), so it turns instead of jumping.
Agents are drawn in `z` order, above the overlay's items and below its `top`
items.

## Zoom and pan

The page zooms and pans by setting the same viewBox on both SVGs, and sets
`--zt`, `--zs` and the `z2`/`z4` classes on both. While a wheel or drag gesture
is under way it moves both with a CSS transform on their container instead,
and only commits the viewBox once the gesture pauses, so the map isn't
redrawn on every wheel tick.
