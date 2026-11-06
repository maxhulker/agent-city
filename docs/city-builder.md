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
now on the city is laid out on a map the game generates, as Cities:
Skylines and SimCity hand you a coastline and a river to build on, and the
person places the buildings, lays the roads between them, plants parks, and
zones the blocks that fill in with the population. A new project is a
borough they lay out, not one the city picks from a list of four.

In the city, placing a building builds it: the lot goes down, the
scaffolding goes up, and the landmark stands, with no work needed first.
The onboarding becomes a tour of the legend by building it. The game's old
rule, that a landmark goes up the first time its kind of work happens, moves
to the boroughs: a building placed in a borough is a lot until that
repository's agents first do that kind of work there, so each new project
earns its skyline as before.

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

## The map

Everything stands on one grid: the one `p(gx, gy)` projects today, where a
cell is one unit square and today's streets and avenues run along its lines.
The land is not painted; it is generated. A new city gets a map made from a
seed: a bay, a coastline with inlets and a headland or two, a river or a
strait, an island where the station stands, and the mainland beyond it, all
as land and water cells, drawn with a smoothed shore. The welcome shows a
few of these (a seed each, with a Shuffle), and the person picks one. The
generator is a pure function of its seed (`generateMap(seed)` in
`src/layout.ts`, value noise over the grid with a coast threshold, the same
on every machine), so a map is a number in `state.json`, and a test can
assert that a seed gives a station on land with a shore within reach for
the Seaport. Today's Manhattan is one map among them, the hand-drawn one,
and the one an existing city keeps. Landfill, where the person adds land
themselves, is a later nicety, not part of this.

## What the person places

- **Landmarks.** One per kind of work: City Hall, the Public Library, the
  Garment District, Hudson Yards, Times Square, the Seaport, Central Park,
  and Grand Central's towers; then the Empire State Building as the capstone,
  and the Statue of Liberty, which stands in water. Each has a footprint in
  whole cells (the rectangles `RESERVED` lists today: the Library is 2×1,
  Grand Central 4×1, Central Park 4×13) and a front, the side agents stand
  on. Placing one in the city builds it: scaffolding for a few seconds, then
  the landmark. Several of a kind are allowed (two Libraries, one at each
  end of town); agents go to the nearest. Grand Central's terminal is placed
  from the start, as the city's entrance: it is where the rails arrive and
  where everyone steps off and boards.
- **Zoned blocks.** The filler fabric is no longer sprinkled by the renderer:
  the person zones lots along roads (a lot is 2×1 cells, as today), and the
  population fills them in, in the order they were zoned, on the same
  square-root curve `blocksFor()` draws today. Zoning is cheap and the
  reward is slow, as now.
- **Roads.** Streets and avenues on grid lines, laid by dragging, any
  length. A road over water is a bridge. Roads are what agents walk along
  and what buildings must touch. Each segment carries a kind, `street` or
  `avenue`, which for now only changes how it is drawn (avenues wider, with
  lamps, as today). Roads of a real width, taking the cells beside their
  line, are a later addition that this leaves room for: the routing graph
  is the same, and only the occupancy check and the drawing grow.
- **Parks.** A paint for cells: lawn and trees. Central Park is a landmark
  (it has a spot where agents rest); parks are scenery.
- **A borough per project.** A rectangle of cells the person draws and names
  for a repository. It holds its own roads, blocks and buildings, and a
  building placed in it is a lot until the repository's agents first do that
  kind of work there. The repository's agents gather at its square. More on
  this below.

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
- **Park, Zone**: paint cells by click or drag.
- **Buildings**: the catalogue, which is the Blueprints card moved onto the
  map: a button per landmark, with what it stands for ("where agents read
  files") and whether one is placed yet. Picking one turns the cursor into
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
nothing from the rest of `src/`, so it runs in both places unchanged.

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
  // The map: a generated one by its seed, or the hand-drawn Manhattan, whose
  // smooth shoreline, mainland, small islands, Liberty Island and named
  // rivers are drawn as its backdrop. Either way `land` holds the cells.
  map: { seed: number } | { preset: 'manhattan' }
  land: [y, x0, x1][]               // land cells as spans per row
  park: [y, x0, x1][]
  roads: [x, y, dir, kind][]        // one cell edge each: dir 0 runs along y, 1 along x; kind 'street' | 'avenue'
  zoned: [x, y][]                   // 2×1 lots, in the order they were zoned
  buildings: Building[]
  boroughs: Borough[]
}
type Building = {
  id: string; kind: Kind; x: number; y: number; face: 'n' | 'e' | 's' | 'w'
  burb?: string
  // When it went up: at placement in the city, at the first such work in a
  // borough; absent while it is a lot.
  built?: number
}
type Borough = { id: string; name: string; root?: string; x: number; y: number; w: number; h: number; preset?: true }
```

`Kind` is today's `Landmark` plus `'station'` and `'liberty'`. A building's
size comes from its kind (`FOOTPRINT[kind]`), not from the layout. Whether a
building stands or is a lot is its own `built`, so `World.built` per kind
goes once the migration has read it; the torch keeps a flag of its own
(`World.torch`), lit on the first push as today. `World.repos` keeps its
`Repo` per repository, and `Repo.burb` becomes the borough's id rather than
one of four names.

The pure rules live in `src/layout.ts`: `generateMap(seed)`,
`manhattanLayout()` (the preset that is today's city), `canPlace`, `place`,
`remove`, `addRoad`, `removeRoad`, `paint`, `zone`, `addBorough`, `doorOf`
(where a building's agents stand), `route` (the walk along the roads), and
`lotsOf` (the zoned lots with their widths clipped to the shore, which
replaces `lots()`). `src/world.ts` calls them from `build(op, now)` and
bumps `rev`; `src/draw/geo.ts` keeps the projection, the colours and the
labels and loses the island, `SITES`, `RESERVED`, `BURBS` and `walk()` once
the preset holds them.

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
is, that you lay the city out and your sessions bring it to life, and the
one thing to do now: `npm run connect`. Then, in a suggested order that
nothing enforces:

1. **Pick a map.** Three generated ones on the welcome, and Shuffle. The
   station already stands on its island; the rails come in once the hooks
   are there. The first session's lead arrives by train and waits on the
   forecourt.
2. **Build a road** from the station. The Road tool is lit on the toolbar
   and the hint says so. The first segment is the first quest.
3. **Place City Hall** on that road. It goes up at once, in scaffolding
   first, and the lead walks over on the next prompt: the catalogue's line
   says what it is for ("where your sessions think and wait for you").
4. **The Library, the Garment District, Hudson Yards, Times Square, Grand
   Central's towers, the Seaport (on a shore), Central Park, the Statue (in
   the water).** Place each where you like. Each goes up as it is placed,
   and the first time a session uses it the ticker says so ("THE LIBRARY
   OPENED ITS DOORS"), so the legend is still learnt by watching the work.
5. **Zone some blocks.** The population fills them in. "Population" in the
   header keeps counting tool calls.
6. **The Empire State Building** becomes placeable once every district
   stands, and goes up with the fireworks. "THE CITY IS COMPLETE".

Act two (run the city: answer at City Hall, send a telegram, open a work
site, file a zoning plan, cross a bridge, last train home) is unchanged,
except that "cross a bridge" becomes "lay out a borough", which has its own
reward: the borough's buildings rise as its agents first use them.

The welcome offers two starts: **Lay it out yourself** (a generated map, the
quests above) and **Start from Manhattan** (the preset, whole, which the
person can then rearrange). **Rebuild the city** on the Blueprints card
offers the same two. **Build it all now** goes: the Manhattan start is that.

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
  the rest still go to the square). A landmark placed in a borough is a
  blueprint lot, with the hint the Blueprints card shows today ("read a
  file to build it"), and rises in scaffolding the first time that
  repository's agents do that kind of work: the new project earns its
  skyline as the whole city did before.
- A borough whose repository has packed up (an hour quiet, as section A made
  it) keeps its roads, houses and sign with no name; the repository moves
  straight back in. Bulldozing a borough frees its repository to be placed
  again; a session working there is announced again.
- **Make Manhattan** keeps its meaning: the chosen repository's agents take
  the city's districts, and the old home takes the borough it names.
- **The hub is the city's own.** On a generated map the island in the middle
  (`hubOf`: the land joined to the map's centre) holds Grand Central, the
  landmarks and the fabric. No borough goes on it: `findSite` skips it, and
  the `borough` op refuses it ("The island is the city's own: boroughs go on
  the mainland"), so the Borough tool does too. The Manhattan preset, all one
  island, has no hub.
- **A project is one place.** Every worktree of a repository shares git's
  common directory; the server asks git for it (`Repo.project`). A worktree
  arriving while another worktree of its project has a borough is built onto
  that borough as a section (`Borough.of`, placed by `sectionSite`) with no
  click, and "Build it for me" does the same.
- **A section is a branch off its project** (the look of 2026-11-06,
  `SECTION_LOOK` 2). It stays attached, sharing an edge, but smaller than the
  main borough: half its lots at most, narrower and shallower than it. Its
  streets join the project's by a spur, two cells of road straight across the
  seam (`spurSection`; `sectionSite` much prefers places where one lines up),
  else a road to the city as any borough. Each section has a colour of its
  own (`branchColor`: teal, violet, pink, amber, sky, lime in turn): its
  ground tinted and outlined in it, its square, its seam, its roofs (the
  walls keep their folders' palette) and its spur painted down the middle.
  Its name is its own part, "↳ TERRAIN", in the colour, drawn with its lights
  over the houses so none hides it. The main borough draws one line round
  them all. Bulldozing the main borough makes its first section the main one.
- **A removed worktree's section is taken up** (`City.pruneSections`, every
  few seconds with the project naming): once every folder in it is gone, the
  section and its spur are lifted and its repository packs up. A borough of
  its own stays until it is bulldozed.
- **Regrouping, once per look.** A city laid out before these rules
  (`World.regrouped` unset), or whose sections were laid out in an older look
  (`World.sectionLook` below `SECTION_LOOK`), is regrouped once git has named
  every borough's project: boroughs on the hub move to the mainland, each
  project's other worktrees become sections of its main worktree's borough,
  built again in the current look, and a borough whose folders are all gone
  is taken up. Each is laid out afresh; no file is touched.

## An existing city migrates

On load, a world with no `layout` gets `manhattanLayout()`: the map is the
preset, so the island's smooth outline, the mainland, the small islands,
Liberty Island and the rivers' names are drawn as before, with the island
rasterised into `land`; the roads are today's avenues and streets; every lot
`lots()` lists is zoned, in its order, so `blocksFor` draws the same blocks;
each landmark stands on its `RESERVED` lot with its front where its `SITES`
spot is, `built` at the time `World.built` recorded for its kind, and left a
lot where that kind was never built, so a city mid-game stays mid-game and
its remaining lots rise on the first such work as they would have (the one
place the old rule still runs in the city); the station and the Statue are
placed; and one preset borough stands at each of the four `BURBS` sites,
with `preset: true` so `burb()` keeps drawing its hand-made brownstones, and
`Repo.burb` becomes that borough's id. The picture does not change.

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

## Decided

Settled with the person on 2026-11-01, after the first draft:

- **The map is generated**, as in Cities: Skylines and SimCity, not painted;
  Manhattan is the hand-drawn one. Landfill can come later.
- **Several of a kind** are allowed; agents go to the nearest.
- **One width of road** for now, on cell edges, with a kind per segment so
  that wider roads later touch only occupancy and drawing, not the routing.
- **The rules are shared with the page** through `stripTypeScriptTypes`.
- **Placing builds, in the city.** In a borough, a building rises on the
  first such work by that repository's agents.

## Order of work

Each step ships on its own, keeps `npm test` green, and leaves the city
looking as it does today until step 4 lets the person change it; a
generated map is step 7, so until then every city is the Manhattan one.
Mechanical
parts (the preset's tables, the page's toolbar markup, test fixtures) go to
Sonnet subagents on small briefs; nothing here needs a real Claude session
until the final check.

1. **The layout in the world.** `src/layout.ts` with the `Layout` types,
   `manhattanLayout()` built from today's `PROFILE`, `lots()`, `RESERVED`,
   `SITES` and `BURBS`, and `FOOTPRINT` per kind; `World.layout`; the
   migration in the `City` constructor, which copies `World.built` onto the
   preset's buildings; `rev` in `mapKey`; a golden hash of the preset's map
   SVG committed under `test/`, so later steps can prove the picture did
   not change. Nothing is drawn differently yet: the renderer still reads
   `World.built`, which stays in step until step 2 reads the buildings.
   Tests: the preset places every landmark on its reserved lot with its
   front at its spot and a borough at each `BURBS` site; a world with no
   layout gets the preset, and a built Library there is `built` while an
   unbuilt one is a lot; `state.json` round-trips the layout; a bump of
   `rev` changes the map hash and nothing else does.
2. **Draw from the layout.** `landmarks()`, `streets()`, `fabric()`,
   `pads()`, `burb()`, `rails()` and `drawPlaces()` read the layout (a
   landmark drawn at its preset origin is moved anywhere by one translate,
   since the projection is affine); a building's `built` decides lot or
   landmark, and `World.built` goes; overlay keys become per id; `SITES`,
   `RESERVED`, `BURBS` and `lots()` leave `geo.ts`.
   Tests: the preset's map SVG still matches the golden hash; a Library
   placed elsewhere draws at the new place; two of one kind both draw; a
   building without `built` draws as a lot.
3. **The placement rules.** `canPlace`, `place`, `remove`, `addRoad`,
   `removeRoad`, `paint`, `zone`, `addBorough` in `src/layout.ts`;
   `City.build(op, now)`, which sets `built` at once in the city and leaves
   it unset in a borough, where the first such work sets it; POST `/build`;
   `layout?` in the frame.
   Tests: a building needs land, free cells and a road at its front; one
   placed in the city stands at once and one placed in a borough rises on
   that repository's first such work and not on another's; a road over
   water is a bridge; bulldozing a road a building faces leaves the
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
7. **The generated map.** `generateMap(seed)`: value noise over the grid,
   a coast threshold, a river or strait, the station's island with land
   enough for a first district, and the shore drawn from the cells with
   rounded corners; the welcome's three maps and Shuffle.
   Tests: a seed gives the same cells twice; the station is on land with a
   road's reach of shore; a few fixed seeds hold enough land for every
   footprint; the map's hash changes with the seed.
8. **Build your first district.** The new act one, the welcome's two starts,
   Rebuild's two starts, the quests' states on the catalogue, the "opened
   its doors" lines on first use, the toasts.
   Tests: a new city's first quest is the road, then City Hall; placing City
   Hall completes its quest with no work; the Empire State is placeable
   only once every district stands; "Start from Manhattan" is the preset,
   whole.
9. **Zoning, parks and the Statue.** Zoned lots fill with the population;
   park cells draw lawn and trees; the Statue placeable in water with its
   launch.
   Tests: blocks appear in zoning order; a park cell draws trees and takes
   no building; the Statue needs water.

Step 1 is the one to ship alone first: it is all types, one table and a
migration, it changes no pixel, and everything after it reads from what it
puts in `state.json`.
