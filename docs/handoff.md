# Handoff: where Agent City stands

Written 2026-11-01, at the end of the first build session, for whoever (or
whichever Claude session) picks the project up next.

## What works, on `main`

Everything in the README is live and was tested against real Claude Code
sessions: the city, boroughs per repository, hover tooltips, the Statue of
Liberty launch, the Times Square ticker, messaging a session, tasks, approvals
(permissions, questions, plans) through the PermissionRequest hook,
conversation and Changes views, desktop notifications, sessions that live in
the app (`src/sessions.ts`, streaming mode: message any time, Continue in the
app, wake after a restart), and the Empire State update button
(`src/updates.ts`: fast-forward to origin/main and restart).

Run it with `npm start` (or the desktop shortcut) and connect sessions with
`npm run connect`. State lives in `~/.agent-city/state.json`.

## Done: the smoothness rebuild (2026-11-01)

The page no longer redraws the whole city SVG on every frame. The server
streams `{map?, overlay, agents, meta}` as `docs/frames.md` specifies: the
still map once (and again when a landmark goes up, a borough moves, the hooks
connect or the block count grows), the overlay as keyed items the page
replaces only when their hash changes, and the agents as sprites that carry
their whole walk and are moved by the page on requestAnimationFrame. Measured
in the app's browser against a sandboxed server: requestAnimationFrame at
60/s (was 15/s), no map mutations between frames, and a walk sampled across
two server frames carrying on to its destination. `docs/frames.md` ends with
what was measured and the small things left (overlay items paint above the
buildings in front of them; a young city re-sends its map as blocks appear;
the zones item is re-sent when its "ago" text changes).

The git stash "smoothness rebuild WIP: map/overlay/sprite layers" on this
machine is now obsolete: everything it was for is on main, built afresh from
the contract. It can be dropped.

How to measure again, without touching the real instance: start a second
server with `USERPROFILE` pointed at a scratch folder and `AGENT_CITY_PORT`
set, post synthetic hook events to `/hook` with curl (no Origin header), open
the page, and in the console count requestAnimationFrame calls over 2 s,
watch the map `<svg>` with a MutationObserver, and sample an agent's
`transform` every 100 ms while posting an event that moves it and another a
second later.

## Next round: the brief

Two things the person asked for, in the city's own language. Build them in a
fresh session, with Sonnet (or Haiku) subagents on small briefs, unit tests
for the world rules (`src/world.ts` is pure: feed it hook events and assert),
and no real Claude sessions until the final check.

### A. Decommissioning: the last train home (do this first; it's small)

The city fills up because its departure rules are slow (all in `flush()` in
`src/world.ts`): a quiet session is kept 6 hours, a finished subagent rests
10 minutes, a session only leaves at once if it posts SessionEnd, and a
borough is never given up until all four are taken.

- Grand Central is the exit as well as the entrance. An idle lead that has
  heard nothing for 30 minutes walks to Grand Central and boards a departing
  train (a short overlay animation: the train pulls out, the agent is gone).
  If its session speaks again later it arrives fresh, as new sessions do.
- A finished subagent leaves the same way 2 minutes after its report taxi
  has arrived. An ended or failed app session's lead leaves at once (the app
  session stays in the sidebar's list).
- Fading with age: before the train, an idle agent dims the longer it has
  been quiet (opacity by idle time), so active agents stand out.
- Moving out: a borough with no activity for an hour packs up (sign down,
  houses stay) and is free. Keep the repo known, so it moves straight back in
  when a session works there again.
- Controls: **Send home** on a session card (that session's agents leave
  now) and **Last call** in the header (everyone idle leaves now): one small
  POST each, origin-checked like the others.
- A cap with manners: above 24 agents, the longest-idle leave first,
  whatever their timers say.

### B. Why each agent exists, and how it works

1. **Work orders (why).** When a lead starts a subagent, the Agent tool's
   `prompt` is the brief; today only `description` is kept (world.ts, the
   `spawns` queue). Keep the prompt too (cut to ~2 KB), with who issued it and
   when. On the map the agent carries a clipboard on its first walk; clicking
   it, or its card, shows the work order: "WORK ORDER A-3 · issued by Ⓐ AIV at
   14:02 · reports to Grand Central", then the brief.
2. **Route lines (how).** Keep each agent's last eight stops (district or
   borough, with times). When an agent is selected, draw its route as a
   dotted subway-style line with numbered stops and a legend ("1 Library →
   2 Garment District → 3 Hudson Yards → 4 Seaport"). Library ↔ Garment
   District six times reads as debugging; Library → Grand Central as
   delegating.
3. **Site plans (progress).** Claude Code has TaskCreated and TaskCompleted
   hook events for a session's own task checklist (verify their payloads
   first: https://code.claude.com/docs/en/hooks.md); subscribe to them (one
   more event in `src/install.ts`, with the person's OK since it changes their
   settings). Show the checklist as a construction hoarding beside the
   session's lead and as a "Site plan" tab in the drawer, and let the
   scaffolding on the building being edited climb with the share completed.
   An approved plan (ExitPlanMode, already captured by approvals) is posted at
   City Hall as the zoning plan.
4. Small touches: a hard hat in the session's colour on subagents; the report
   taxi's envelope opening in the lead's bubble with the report's first line;
   the conversation drawer for subagents too (their transcripts arrive with
   SubagentStop).

Order: A, then B1 and B2 together (mostly world.ts bookkeeping plus drawing),
then B3 once the task hooks are verified.

B1 and B2 are in: `Agent.order` (the Agent tool's prompt cut to 2 KB,
numbered by the session's bullet, with who issued it and when) and
`Agent.stops` (the last eight, recorded in `flush()` as each walk starts);
the server sends them as `order` and `route` (named stops with map points);
clicking an agent opens its session's drawer with its work order and the
stops' legend, and draws its route as a dotted line with numbered stops
(`drawRoute` in the page). A subagent carries a clipboard on its first walk.
Tests in `test/orders.test.ts`. B3 is in too: the hook docs confirm
`TaskCreated` (task_id, task_subject, task_description, agent_id) and
`TaskCompleted`; `src/install.ts` subscribes to both (they take effect when
the person runs `npm run connect` again; our reply is always empty, so no
task is ever blocked), and the TodoWrite, TaskCreate and TaskUpdate tool
calls feed the same checklist, so site plans work before that. A session's
`plan` shows as a hoarding beside its lead (while work is left) and in the
drawer; an approved plan (POST `/decide` on a plan) is posted at City Hall
as `World.zoning`, on a board by its door and in its tooltip. Not done from
B3: the scaffolding climbing with the share completed. Act two of the
onboarding is in as well (`World.feats`, `City.achieve`, `actTwo()`): answer
at City Hall, send a telegram, open a work site, file a zoning plan, lay out
a borough, last train home, shown on the card once the city stands. Tests
in `test/siteplan.test.ts`. B4's small touches are not done. (The
installer's two task events only landed with the Treasury's commit: the
site plans commit missed them.)

Generated maps were reworked after the person found them unnatural:
`terrainOf(seed)` in `src/layout.ts` builds a heightmap from domain-warped
noise (five octaves), the island in the middle, the mainland rising inland
in any direction (and, on about half the maps, a second shore across the
water on the other side), a tilted island with a strongly warped outline and a solid
core, one or two rivers meandering from the mainland's far side to the sea
and widening to their mouths, and small islets and puddles swept away.
`generatedLand` in map.ts draws blurred shallows round the coasts and up
the rivers, a sand rim, green rising into three bands of hills by height,
and pavement only under zoned blocks and buildings. A generated map is 128
cells each way (`GEN`; the grid's `RANGE` reaches it), so the mainland has
room for many boroughs, with two to four rivers. Its frame is all the land;
the page opens on the station's island (`fitIsland`, also on Rebuild and a
new pick) and may zoom in further on a bigger map (`maxZ`).

### E. The City Treasury

A civic building (`treasury` in `FOOTPRINT` and `FIXED`: it stands at once
and is no part of the game; drawn from the grid's origin, since the preset
has no place for it). The books are `World.treasury` (spend by local day, in
all, and each report's last running total, so only what a report adds is
counted and a /clear starts again) and `World.limits` (the 5-hour, 7-day and
gateway spend windows). Reports come from POST `/statusline` (the status
line `src/install.ts` sets when the person has none; its reply is the line
the terminal prints), from app sessions (`costUsd`, keyed per app session)
and from tasks (keyed per turn). `City.treasuryView()` feeds the sidebar
card and the board over the building; its tooltip has the week. Tests in
`test/treasury.test.ts`. Per-subagent spend is not split out: Claude Code
reports cost per session. The smoothness rebuild
(`docs/frames.md`) is done.

A is done (commit d318388). Section C, the onboarding game where the city is
built by working in it, is briefed in `docs/onboarding.md`; its act one is
done (`World.built`, blueprints, the arriving train, the Blueprints card, the
welcome, `hooksInstalled()` in `src/install.ts`; tests in
`test/onboarding.test.ts`). Act two waits for section B.

### D. The city builder

The direction after C: the person lays the city out themselves, briefed in
`docs/city-builder.md` with nine steps. Step one is in: `src/layout.ts`
(the `Layout` types, the Manhattan preset, the island's constants moved
from `geo.ts` and re-exported there), `World.layout` with the migration in
the `City` constructor, the revision in the map's hash, and the golden hash
of the preset's map in `test/golden.json` (`test/layout.test.ts`). Step two
is in too: the map, the overlay, the hover zones and the sprites read the
layout. Each building is drawn by its kind at the kind's preset origin and
moved by one translate (`sh`/`gsh` in map.ts), keyed `lm:<id>`; the station
and Grand Central's towers are two buildings; streets, lots, the rails and
the pads come from the layout. The picture is the same to the pixel but for
a strip on MetLife's east wall (the golden hash notes it). Not done from the
brief's step two: `World.built` stays as the game's record (the Blueprints
card, the torch, the Empire State's timing read it) and is kept in step with
the buildings' own `built`; step seven can retire it. Step three (the rules
in `src/layout.ts`, `City.build`, POST `/build`, `layout?` in the frame;
`test/build.test.ts`) and step four (the toolbar, the cursor layer, the
catalogue, the selection card and the borough sheet in `public/index.html`,
with the rules served as JavaScript at `/layout.js` through
`stripTypeScriptTypes`, which prints one ExperimentalWarning on first use)
are in too. Checked in the app's browser against a sandboxed server by
driving the tools with synthetic mouse events: each op re-sends the map once
and leaves the other overlay items alone. Step five is in: `doorOf`,
`spotFor` and `route` in `src/layout.ts` (a shortest way along the road
segments with a small cost per corner), `walk()` in `geo.ts` on top of it
with the straight-line fallback, and the station's forecourt for a kind with
nothing placed (`test/route.test.ts`). Step six is in: `Repo.burb` is a
borough's id (`Burb` is a string; the preset's four are `PresetBurb`), or
`@<root>` while the repository waits on Grand Central's forecourt
(`waitingId`/`isWaiting` in `src/layout.ts`). A new repository no longer
moves into a free preset borough by itself: it is announced and waits, and
the sidebar's New arrival card lays out a borough for it (the sheet's
repository pre-picked) or moves it into a free one (`{op: 'movein'}` on
POST `/build`, handled by `City.moveIn`). `burbGeo` gives every borough its
square, edge and rectangle; a drawn one gathers along the middle of its
south edge, and a landmark placed in a borough draws that work to its door.
Bulldozing a borough sends its repository back to wait; Make Manhattan gives
the old home the borough the new one leaves, or the forecourt. Tests in
`test/borough.test.ts`. On the Manhattan preset the only land is the island,
so a drawn borough stands on it until step seven's generated map; drawn
boroughs show a dashed line, a square and their name, and get houses with
zoning (step nine), as do player-laid bridges and parks. Step seven is in:
`generateMap(seed)` in `src/layout.ts` (value noise over a 64-cell square:
mainland at the back, a strait, the station's island with a solid core, the
sea in front; the station near the island's east shore with a street along
its front), drawn by `generatedLand` in map.ts (spans inset and stroked with
round joins over a darker shore; the island paved, the rest green), with
the preset's backdrop, bridges, names, reflections and traffic left out and
the view framed on the land. The welcome's picker (three seeds, Shuffle,
Manhattan) posts `/newmap`, which `City.newMap` takes only while the city is
new. Tests in `test/map.test.ts`. Not done yet: Build it all now on a
generated map records the game but has no buildings to raise (step eight's
starts take that on). Step eight is in: work of a kind with nothing placed
for it in the city builds nothing (its agents wait at the station); a lot
still rises by its first work (the old game on a bare preset); a landmark
placed and standing opens its doors on its first use (`World.opened`,
seeded from `built` for a city that has seen sessions, so no burst after
the upgrade). `City.quests()` lists the first district's quests on a
generated map (road via `World.firstRoad`, the landmarks, zoning, the
Empire State locked until every district stands); the server sends them in
`game.quests`, the page shows them as the First district card, marks the
next one in the catalogue and lights its tool. The welcome's two starts:
the picker, or Start from Manhattan (`newMap('manhattan')` builds it
whole); Build it all now is gone from the welcome. Rebuild's two starts:
`City.restart(seed | 'manhattan')` (POST `/rebuild` with `start`); the old
`rebuild()` stays for the bare preset. A brand-new state file starts on a
random seed. The welcome shows until the first session (`isWelcome`); its
picker only while the city is new. Tests in `test/quests.test.ts`. Step
nine is in, and with it the brief's nine steps: zoned lots fill with the
population in zoning order (the fabric already read `lotsOf`; now tested on
a generated map), park cells the person paints draw lawn and two or three
trees each (`parks` in map.ts; the preset's own plazas stay with their
landmarks), a road over water draws as a bridge deck under the roadway, a
placed Statue stands at once (with the Seaport's time where it stands), and
every Statue on the map is drawn and launches. Tests in
`test/zoning.test.ts`. Left for later: drawn boroughs still have no houses
of their own (zone their blocks), act two of the onboarding waits for
section B. Since then: a drawn borough's zoned blocks fill with brownstones
(`lotStyle`), and `World.built` is no longer written on its own: it is
`builtOf(layout, torch)`, kept by `City.sync()`, with Liberty's torch in
`World.torch` (migrated from an old record on load). Bulldozing a landmark
takes it off the record, and Build it all now raises only what is placed.

## Lessons from the first session, on cost

- One long session gets expensive: every action re-sends the whole history.
  Prefer short sessions started from this file, the README and `docs/frames.md`.
- Subagents default to the parent's model; set `sonnet` (or `haiku`) for all
  but design-heavy work, and give them small briefs. Four Opus subagents at a
  time reading 2,000-line files cost more than the feature was worth.
- Real headless Claude sessions are a fine final check but a poor test loop;
  most logic here (world.ts, tickerNow, approvals, transcripts) can be unit
  tested with no credits at all.
- Screenshots stay in the session's context for good; read the DOM instead
  where a number will do.

## Known rough edges

- Headless tasks (`src/tasks.ts`) can't ask questions or present plans; app
  sessions (`src/sessions.ts`) can, since they run with a permission host.
- Quiet-mode hooks (`npm run connect -- --quiet`) wait up to 0.3 s per event
  when the app is closed.
- The interactive-window fallback for an unanswered permission card (the card
  says it falls back after nine minutes) was never tested in a real terminal.
