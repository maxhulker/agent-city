# How the server streams the city to the page

The page used to get one complete SVG of the whole city about once a second
and swap it in, which cost ~300 ms of drawing per swap and cut agents' walks
short. Now the city comes in three layers, and the page keeps what hasn't
changed. This shipped on 2026-11-01 (commits a2e8370 and fab3f2d); the
sections at the end say what was measured and what is left.

Each Server-Sent Event on `/stream` is one JSON object:

```ts
type Frame = {
  // The static city. Sent on connect and whenever its hash changes; omitted
  // otherwise, and then the page keeps the one it has.
  map?: { hash: string; svg: string }
  // What stands where (docs/city-builder.md), for the page's build cursor.
  // Sent on connect and whenever its revision changes; omitted otherwise.
  layout?: Layout
  // Everything dynamic except the agents, in paint order.
  overlay: OverlayItem[]
  // The agents; the page draws and moves them itself.
  agents: Sprite[]
  meta: Meta // as before (sessions, tasks, pending, appSessions, update, ...)
}
```

`src/city.ts` (`renderFrame`) builds `{map, overlay, agents}` from the world,
purely; `src/server.ts` adds `meta` and drops `map` for clients that already
have that hash. `src/draw/map.ts` draws the map (`drawMap`) and most overlay
items (`drawOverlay`); `src/draw/agents.ts` the sprites, trains and taxis;
`src/draw/places.ts` the hover zones. `test/frames.test.ts` holds the
contract to the tests.

A server from before the layers, still running across an update of the page
(Crosswalk serves `public/index.html` from disk on every load), sends
`{svg, meta}`; the page shows that SVG as the map, the old slow way, until
the server is restarted.

## map

A complete `<svg class="city map" viewBox="…" preserveAspectRatio="xMidYMid meet">`
with its `<defs>` (gradients, patterns) and `<style>` (which, being inline in
the page, styles the overlay's SVG too): water, land, island, streets, lamps,
the rails once the hooks are laid, the city fabric, the landmark buildings in
their "off" state, bridges, trees, the boroughs' houses and names,
neighbourhood and water labels, the moon. Nothing in it animates. Its hash
(`mapKey`) comes from which landmarks stand, which boroughs have houses (in
use or packed up), whether the hooks are connected, how many filler blocks
the population has earned, and the layout's revision (`World.layout.rev`,
docs/city-builder.md: a placement changes the map), so in a built city it
changes only when a borough moves in or out or the person builds. The last map is kept by its key, so a frame that
doesn't change it costs no drawing. Ids in its `<defs>` are document-global,
so the overlay can use them (`url(#halo)` etc.).

## overlay

```ts
type OverlayItem = {
  k: string // stable key: 'pads', 'lm:library', 'burb:<id>', 'statue', 'zones', 'train:<id>', 'ride:<at>:<kind>:<color>', 'fireworks'…
  h: string // hash of what the item shows, from its INPUTS, never from its text: it must
            // stay the same while the item looks the same, even if its SVG text holds
            // time-dependent values (negative SMIL begin offsets)
  svg: string // an SVG fragment (no <svg> root), drawn in the overlay's own SVG
  top?: true  // drawn above the agents (taxis, fireworks)
}
```

Most items hold no clock in their markup and are hashed by it (`item()` in
`src/draw/geo.ts`); the ones whose markup counts from now (the Statue's
launch, trains, taxis) are hashed by their inputs (`keyed()`).

The page keeps one `<svg class="city overlay">` with the map's viewBox,
holding a `<g data-k>` per item keyed by `k`. It replaces an item's content
only when its `h` changes, adds new keys, removes missing ones, and keeps the
order. So running animations (smoke, cars, the statue's launch) are not
restarted by a frame that didn't change them. When an item's markup does
arrive, plain clock offsets in its `begin` attributes are shifted by the
overlay's current time, so a negative offset still means "that long ago".

Overlay items, in paint order: the lit pads of the districts someone is working in
(`pads`), each borough's sign, glow and scaffolding (`burb:<b>`), each
placed building's lights, smoke, sparks, rings, beacons, crane, flag, crown
and scaffolding (`lm:<id>`, the building's id in the layout; the "?" at City Hall and
the alarm at the Seaport included), the spires' lights (`spires`), the districts' haze (`haze`), the Statue of
Liberty at rest or launching (`statue`), the districts' names (`labels`),
the trains (`train:<id>`), the hover zones (`zones`: `polygon.zone` with the
`data-tip-*` and `data-update` attributes the page reads), and above the
agents the taxis (`ride:…`) and the fireworks (`fireworks`).

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
                                  // body, prop, bullet, badge, name, bubble, ring;
                                  // wrapped in <g opacity> when faded or still aboard
  // While walking: the route in SVG units, ending at (x, y), started at t0
  // (epoch ms, server clock = page clock, same machine), lasting dur ms.
  // Sent on every frame until the walk is over, so a walk always plays out.
  walk?: { t0: number; dur: number; pts: [number, number][] }
}
```

`Agent.walk?: {from, at}` in the world (set by `flush()` when an agent's
place changes, kept `WALK_MS`) is where the route comes from; `walk()` in
`src/draw/geo.ts` turns it into points.

The page keeps one `<g class="… agent" data-agent data-session>` per id with
an inner `<g class="fig">`, replacing the fig only when `fig.h` changes, and
sets `transform="translate(x,y)"` itself on every animation frame: along
`walk.pts` at constant speed, eased at both ends, while `now < t0 + dur`, at
`(x, y)` after. A new walk arriving mid-walk starts from where the agent is
drawn now (the page swaps `pts[0]` for its current position and keeps the
server's arrival time), so it turns instead of jumping. Agents are drawn in
`z` order, above the overlay's items and below its `top` items. An agent
missing from a frame fades out over a third of a second.

## Zoom and pan

The page zooms and pans by setting the same viewBox on both SVGs, and sets
`--zt`, `--zs` and the `z2`/`z4` classes on both. While a wheel or drag
gesture is under way it moves both with a CSS transform on their container
(`#city`) instead, and commits the viewBox once the gesture pauses for
150 ms (or the drag ends), so the map isn't redrawn on every wheel tick.

## What shipped, measured

Against a sandboxed server (another port, `USERPROFILE` at a scratch folder,
synthetic hook events posted with curl), in the desktop app's browser:

- `requestAnimationFrame` ran 121 times in 2 s (60/s; it was 15/s).
- The map `<svg>` element stayed the same object across frames, with no
  attribute or subtree mutations over 3 s; the overlay had none either while
  nothing changed. A quiet frame is ~20 KB of overlay and sprites against a
  ~70 KB map (a new city; a full one is bigger) that isn't sent again.
- An agent's transform sampled every 100 ms across two server frames landing
  mid-walk moved smoothly along its route and ended at its destination
  exactly when the walk was due.
- Hover tooltips, selection (the ring, the card), the taxi, the boarding
  train, fireworks and the zoom gesture (transform during, viewBox after)
  all work on the layered page.

## What is left

- Overlay items paint above the whole map, where the old single SVG
  depth-sorted them among the buildings. So a car on an avenue, a lit pad, a
  borough's glow or a scaffold can show over the foot of a building that
  stands in front of it. It is slight at the usual zoom; a fix would draw the
  fabric in front of such things in the overlay too, or clip them.
- In a young city the map is sent again whenever a tool call earns another
  filler block (every few calls at first); a built city's map is stable.
- The hover zones are re-sent when their tooltip text changes (the "ago"
  times after a commit or a borough moving out), which replaces the hovered
  polygon and drops its hover highlight until the mouse moves.
