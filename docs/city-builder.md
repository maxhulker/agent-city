# City builder: lay out the city yourself

Written 2026-11-01. The brief for the change of direction: the city stops
being a fixed Manhattan that fills itself in and becomes a place the person
lays out, the way one plays Cities: Skylines or SimCity. Read
`docs/handoff.md` for how the project is laid out, `docs/onboarding.md` for
the game as it is today, and `docs/frames.md` for how the city reaches the
page.

## The idea

Every building still stands for a kind of work (the README's table), and a
session's agents still walk to the building for what they are doing. What
changes is who decides where things are. Today `src/draw/geo.ts` holds one
island, one street grid, eight sites and four boroughs, and the city is
"built" only in the sense that its landmarks appear as the work happens. From
now on the person places the buildings, lays the roads between them, paints
land, water and parks, and zones the blocks that fill in with the
population. A new project is a borough they lay out, not one the city picks
from a list of four.

The onboarding game keeps its best rule: a landmark goes up the first time
that kind of work happens. The person places its lot, and the building rises
when the work comes. Learning the legend and learning Claude Code's
capabilities still happen together, now with the person's own hands on the
map.

Three rules that must hold throughout:

- **The city layer only shapes scenery.** Agents, cards, approvals, messages,
  tasks and the ticker work from the first event, whatever is or isn't placed.
  An agent with nowhere to go stands at the station and says so.
- **Nothing is lost.** A city that exists today migrates to a layout that
  draws the same Manhattan, every landmark where it stands, every borough in
  its place. Then the person can change it.
- **The world stays pure.** Placement is a set of rules in `src/world.ts` (and
  a sibling `src/layout.ts`) that take a layout and an operation and give
  back a layout or an error, with no I/O, so every rule is a unit test.

## What the person places

Everything stands on one grid: the one `p(gx, gy)` projects today, where a
cell is one unit square and today's streets and avenues run along its lines.

- **Landmarks.** One per kind of work: City Hall, the Public Library, the
  Garment District, Hudson Yards, Times Square, the Seaport, Central Park,
  and Grand Central's towers; then the Empire State Building as the capstone,
  and the Statue of Liberty, which stands in water. Each has a footprint in
  whole cells (the rectangles `RESERVED` lists today: the Library is 2×1,
  Grand Central 4×1, Central Park 4×13) and a front, the side agents stand
  on. Placed, a landmark is a blueprint lot until its kind of work first
  happens; then it rises in scaffolding and stands. Once a kind has been
  unlocked, another of the same kind (a Library in a borough) goes up at once.
  Grand Central's terminal is placed from the start, as the city's entrance:
  it is where the rails arrive and where everyone steps off and boards.
- **Zoned blocks.** The filler fabric is no longer sprinkled by the renderer:
  the person zones lots along roads (a lot is 2×1 cells, as today), and the
  population fills them in, in the order they were zoned, on the same
  square-root curve `blocksFor()` draws today. Zoning is cheap and the
  reward is slow, as now.
- **Roads.** Streets and avenues on grid lines. A road over water is a
  bridge. Roads are what agents walk along and what buildings must touch.
- **Land, water and parks.** Three paints for cells. Land is the ground
  anything stands on; water is the bay; a park cell is lawn and trees.
  Central Park is a landmark (it has a quest and a spot where agents rest);
  parks are just scenery.
- **A borough per project.** A rectangle of cells the person draws and names
  for a repository. It holds its own roads, blocks and buildings. The
  repository's agents gather at its square. More on this below.

## Placing, on the page

The map keeps its pan and zoom (wheel, drag, double-click, `0`). A build
toolbar sits along the bottom of the map, above the ticker:

- **Select** (the default): drag pans, as today. Clicking a placed thing
  selects it and shows its card: what it is, what it stands for, who is
  there, and Bulldoze.
- **Road**: press on a grid point and drag along a line; a straight segment
  follows the cursor, green where it may go, red where it may not, and is
  laid on release. Drag-pan is off while a build tool is active; the wheel
  still zooms, and the right button still pans.
- **Bulldoze**: click a road segment, a building, a zoned lot or a paint to
  remove it. This is the undo.
- **Land, Water, Park, Zone**: paint cells by click or drag.
- **Buildings**: the catalogue, which is the Blueprints card moved onto the
  map: a button per landmark with its state (not placed, placed and waiting
  for its first work, built) and its hint. Picking one turns the cursor into
  its footprint; it follows the grid, green where the footprint is on land,
  free and touching a road, red otherwise; a click places it. `R` turns the
  front to another side.
- **Borough**: drag a rectangle; a sheet asks which repository it is for
  (the ones seen, or any folder) and its name.

The page draws the cursor itself, in a layer of its own above the overlay's
items (so `syncOverlay` never removes it), from the layout it holds. It
checks the simple rules as the cursor moves so the colour is right without a
round trip, and the server checks them again when the click arrives; the
server is the authority. To keep one set of rules, the server serves
`src/layout.ts` to the page as JavaScript, with its types stripped by
`stripTypeScriptTypes` from `node:module` (Node 22.13 and later; this
machine runs 24). `src/layout.ts` therefore imports nothing from Node and
nothing from the rest of `src/`, so it runs in both places unchanged. If
that proves awkward, the page keeps a copy of the three checks (on land,
free, touches a road) and nothing more.

Every placement is one POST to `/build`, origin-checked like `/sendhome`:
`{ op: 'place' | 'remove' | 'road' | 'unroad' | 'paint' | 'zone' | 'borough', ... }`.
The server applies it through the pure rules, saves, and the next frame
carries the new map.

## What is kept where

`World` gains `layout: Layout`, so `state.json` keeps it with everything
else:

```ts
type Layout = {
  rev: number                       // bumps on every change; the map hash covers it
  land: [y, x0, x1][]               // land cells as spans per row
  water: [y, x0, x1][]              // cells painted water inside land (canals, inlets)
  park: [y, x0, x1][]
  roads: [x, y, dir][]              // one cell edge each: dir 0 runs along y (an avenue), 1 along x (a street)
  zoned: [x, y][]                   // 2×1 lots, in the order they were zoned
  buildings: Building[]
  boroughs: Borough[]
  // The hand-drawn Manhattan: its smooth shoreline, the mainland, the small
  // islands, Liberty Island and the named rivers around it. A painted city
  // has none; its shore is drawn from its cells with rounded corners.
  backdrop?: 'manhattan'
  shore?: [gx, gy][]
}
type Building = { id: string; kind: Kind; x: number; y: number; face: 'n' | 'e' | 's' | 'w'; burb?: string }
type Borough = { id: string; name: string; root?: string; x: number; y: number; w: number; h: number; preset?: true }
```

`Kind` is today's `Landmark` plus `'station'` and `'liberty'`. A building's
size comes from its kind (`FOOTPRINT[kind]`), not from the layout. Whether a
landmark stands or is a lot still comes from `World.built`, per kind, as
today; the layout says where. `World.repos` keeps its `Repo` per repository,
and `Repo.burb` becomes the borough's id rather than one of four names.

The pure rules live in `src/layout.ts`: `manhattanLayout()` (the preset that
is today's city), `canPlace`, `place`, `remove`, `addRoad`, `removeRoad`,
`paint`, `zone`, `addBorough`, `doorOf` (where a building's agents stand),
`route` (the walk along the roads), and `lotsOf` (the zoned lots with their
widths clipped to the shore, which replaces `lots()`). `src/world.ts` calls
them from `build(op, now)` and bumps `rev`; `src/draw/geo.ts` keeps the
projection, the colours and the labels and loses the island, `SITES`,
`RESERVED`, `BURBS` and `walk()` once the preset holds them.

## How agents walk

Today `walk()` goes along the walker's street to Fifth Avenue, down Fifth,
and along the street to the destination, with a fixed detour over a bridge
for a borough. With roads laid by the person there is no Fifth Avenue to
count on, so:

- A building's **door** is the midpoint of its front edge, on the road
  there. Its agents stand along that edge (`standAt` as today, spread along
  the front; Central Park's lawn keeps its loose rows).
- `route(layout, from, to)` finds the shortest way over the road graph
  (nodes at grid points, one edge per road segment; a breadth-first search
  is enough at this size) from one door to the other, and returns the
  points. The sprite's `walk.pts` and `dur` come from it as before
  (`1 + dist × 0.05` s, capped at 4.5).
- No road between them: the agent walks straight, as the crow flies, and the
  tooltip on its destination says "no road here yet". The game layer never
  blocks the work.
- Grand Central's rails run from the station's back east to the map's edge;
  trains arrive and leave along them wherever the station is.
- A kind of work with no building placed for it (a Read before the Library
  has a lot) sends the agent to the station's forecourt, with its activity
  as always and "waiting for a Library" in the tooltip. Placing the lot moves
  everyone waiting for it.

`Place` stays `{ at: District; burb?: string }`: `at` is still the kind of
work. The layout resolves it to a building: the one of that kind in that
borough, or in the city when there is none, or the nearest when there are
several. So the world's rules about who goes where do not change.

## The onboarding: build your first district

Act one becomes "build your first district". The welcome card says what this
is, that you lay the city out and it comes alive as you work, and the one
thing to do now: `npm run connect`. Then, in a suggested order that nothing
enforces:

1. **Lay the tracks.** The rails come in once the hooks are there, to a
   station that already stands on a small island of land in a bay. The
   first session's lead arrives by train and waits on the forecourt.
2. **Build a road** from the station. The Road tool is lit on the toolbar
   and the hint says so. The first segment is the first quest.
3. **Place City Hall** on that road. Its lot goes down; "send a prompt to
   open it". The lead walks over on the next prompt and the hall rises.
4. **The Library, the Garment District, Hudson Yards, Times Square, Grand
   Central's towers, the Seaport (on a shore), Central Park, the Statue (in
   the water).** Place, then work, as the Blueprints card lists them today.
   The hints are the same words; the card's lines become the catalogue's
   buttons.
5. **Zone some blocks.** The population fills them in. "Population" in the
   header keeps counting tool calls.
6. **The Empire State Building** becomes placeable once every district
   stands, and goes up with the fireworks. "THE CITY IS COMPLETE".

Act two (run the city: answer at City Hall, send a telegram, open a work
site, file a zoning plan, cross a bridge, last train home) is unchanged,
except that "cross a bridge" becomes "lay out a borough".

The welcome offers two starts: **Lay it out yourself** (bare land, the
quests above) and **Start from Manhattan** (the preset, with every landmark
placed as a lot, so the person works to raise it as today and can rearrange
it later). **Rebuild the city** on the Blueprints card offers the same two.
**Build it all now** stays: every lot stands at once.

## A new project is a borough

Today a session in a second repository is sent to Brooklyn, Queens, the
Bronx or Jersey City by `burbFor()`, and its agents gather at that borough's
square. From now on:

- When a session first works in a repository that has no borough, the city
  announces it: a toast and a "New arrival" card in the sidebar, "`api`
  arrived at Grand Central. Lay out a borough for it." Its agents wait on the
  station's forecourt, with the repository's name on a sign, and work from
  there. Nothing is blocked.
- The person draws a borough with the Borough tool, picks the repository (the
  card's button pre-fills it) and names it. The sign goes up, and the
  repository's agents walk over to its square.
- The square is where the borough's agents gather: the borough's front edge
  by default, or any landmark the person places inside it, which its agents
  then use for that kind of work (a Library in the borough draws its reads;
  the rest still go to the square).
- A borough whose repository has packed up (an hour quiet, as section A made
  it) keeps its roads, houses and sign with no name; the repository moves
  straight back in. Bulldozing a borough frees its repository to be placed
  again; a session working there is announced again.
- **Make Manhattan** keeps its meaning: the chosen repository's agents take
  the city's districts, and the old home takes the borough it names.

## An existing city migrates

On load, a world with no `layout` gets `manhattanLayout()`: the land is the
island, rasterised to cells, with `shore` holding the smooth outline and
`backdrop: 'manhattan'` keeping the mainland, the small islands, Liberty
Island and the rivers' names; the roads are today's avenues and streets;
every lot `lots()` lists is zoned, in its order, so `blocksFor` draws the
same blocks; each landmark stands on its `RESERVED` lot with its front where
its `SITES` spot is; the station and the Statue are placed; and one preset
borough stands at each of the four `BURBS` sites, with `preset: true` so
`burb()` keeps drawing its hand-made brownstones, and `Repo.burb` becomes
that borough's id. `built` is untouched, so a city mid-game stays mid-game.
The picture does not change.

## The frame contract

Placement changes the map, so the map's hash must cover the layout:
`mapKey` hashes `layout.rev` along with what it hashes today (which
landmarks stand, which boroughs have houses, the rails, the block count).

The page needs the layout itself for its cursor. It travels like the map:
`Frame` gains `layout?: Layout`, sent on connect and whenever `rev` changes,
with the client remembering the `rev` it has as it remembers the map's hash.

Overlay keys stay per placed thing, by the building's id rather than its
kind: `lm:<id>` for a landmark's lights, smoke, scaffold and crown,
`burb:<id>` for a borough's sign and glow, `pad:<id>` for a lit pad (today
one `pads` item carries all of them; per building keeps a new lot from
redrawing the rest). The hover `zones`, `labels`, `statue`, `cars`, trains
and taxis keep their keys. The page's cursor and the selection ring on a
placed thing are the page's own layers, never overlay items.

The sprites do not change: `x`, `y`, `z` and `walk.pts` come from the
layout's doors and routes instead of `SITES` and `walk()`.

## Open choices

- **Where new land comes from.** Painting land anywhere, free, is the
  simplest and the most fun. A cost, or land that must touch existing
  land, can come later if the map sprawls.
- **Several of a kind.** Allowing two Libraries in the city (not only one
  per borough) is cheap with `route` choosing the nearest; the catalogue
  then never greys a button out. Recommended.
- **One width of road.** Roads on cell edges, one width, no diagonals. Wide
  avenues can be a look (every other avenue drawn wider, as today) rather
  than a rule.
- **Sharing the rules with the page.** `stripTypeScriptTypes` is the clean
  way; the fallback is three checks copied into the page. Decide at step 4.

## Order of work

Each step ships on its own, keeps `npm test` green, and leaves the city
looking as it does today until step 4 lets the person change it. Mechanical
parts (the preset's tables, the page's toolbar markup, test fixtures) go to
Sonnet subagents on small briefs; nothing here needs a real Claude session
until the final check.

1. **The layout in the world.** `src/layout.ts` with the `Layout` types,
   `manhattanLayout()` built from today's `PROFILE`, `lots()`, `RESERVED`,
   `SITES` and `BURBS`, and `FOOTPRINT` per kind; `World.layout`; the
   migration in the `City` constructor; `rev` in `mapKey`; a golden hash of
   the preset's map SVG committed under `test/`, so later steps can prove
   the picture did not change. Nothing is drawn differently yet.
   Tests: the preset places every landmark on its reserved lot with its
   front at its spot and a borough at each `BURBS` site; a world with no
   layout gets the preset and keeps `built`; `state.json` round-trips the
   layout; a bump of `rev` changes the map hash and nothing else does.
2. **Draw from the layout.** `landmarks()`, `streets()`, `fabric()`,
   `pads()`, `burb()`, `rails()` and `drawPlaces()` read the layout (a
   landmark drawn at its preset origin is moved anywhere by one translate,
   since the projection is affine); overlay keys become per id; `SITES`,
   `RESERVED`, `BURBS` and `lots()` leave `geo.ts`.
   Tests: the preset's map SVG still matches the golden hash; a Library
   placed elsewhere draws at the new place; two lots of one kind both draw.
3. **The placement rules.** `canPlace`, `place`, `remove`, `addRoad`,
   `removeRoad`, `paint`, `zone`, `addBorough` in `src/layout.ts`;
   `City.build(op, now)`; POST `/build`; `layout?` in the frame.
   Tests: a building needs land, free cells and a road at its front; a road
   over water is a bridge; bulldozing a road a building faces leaves the
   building (it faces nothing, and says so); zoning needs a road; a borough
   may not overlap another; every error has a message; `rev` bumps once per
   change and never on a refused one.
4. **The toolbar and the cursor.** The page's build toolbar, the ghost
   cursor in its own layer, road dragging, painting, the catalogue with the
   hints, the selection card with Bulldoze, and the rules served to the page.
   Checked on a sandboxed server (another port, `USERPROFILE` at a scratch
   folder, hook events by curl, the DOM read rather than screenshots): a
   road laid, a lot placed, the map re-sent once per change, the overlay's
   other items untouched.
5. **Walking the roads.** `doorOf`, `route`, the straight-line fallback, the
   station's forecourt for kinds with no building, the rails from the
   station; `walk()` goes.
   Tests: a route follows the roads and turns at corners; no road gives a
   straight walk; an agent whose kind has no building stands at the station
   and moves when its lot is placed; trains still arrive and leave.
6. **Boroughs by the person.** The arrival card, the Borough tool's sheet,
   moving in, packing up with the zone kept, Make Manhattan, and
   `Repo.burb` as an id.
   Tests: a new repository's agents wait at the station until a borough is
   drawn for it, then gather at its square; a packed-up borough keeps its
   layout and takes its repository back; a bulldozed borough's repository is
   announced again.
7. **Build your first district.** The new act one, the welcome's two starts,
   Rebuild's two starts, the quests' states on the catalogue, the toasts and
   ticker lines.
   Tests: a bare city's first quest is the road, then City Hall; placing a
   lot then doing the work builds it; the Empire State is placeable only
   once every district stands; "Start from Manhattan" is the preset with
   nothing built.
8. **Zoning, parks and the Statue.** Zoned lots fill with the population;
   park cells draw lawn and trees; the Statue placeable in water with its
   launch; the painted shore drawn with rounded corners.
   Tests: blocks appear in zoning order; a park cell draws trees and takes
   no building; the Statue needs water.

Step 1 is the one to ship alone first: it is all types, one table and a
migration, it changes no pixel, and everything after it reads from what it
puts in `state.json`.
