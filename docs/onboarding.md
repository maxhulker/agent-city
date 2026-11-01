# Onboarding: build Manhattan by working in it

Written 2026-11-01. The brief for section C: making the first days with Agent
City a game, where the person raises the city one landmark at a time. Read
`docs/handoff.md` first for how the project is laid out.

## The idea

Every landmark already stands for a kind of work (the README's table). So the
city is not placed by hand: it is built by doing. The island starts as bare
land, streets and the rivers, each lot marked by a faint blueprint ("PUBLIC
LIBRARY · read a file to build it"), and a landmark goes up the first time a
session does that kind of work. The person learns the city's legend and Claude
Code's capabilities at once, with the work they were going to do anyway.

Two rules that must hold throughout:

- **The game layer only delays scenery.** Agents, cards, approvals, messages,
  tasks and the ticker all work from the first event. An agent reading a file
  before the Library exists stands on the empty lot while it is built.
- **Nobody is forced through it.** Anyone whose `state.json` already holds
  sessions or agents has a city, and everything counts as built for them.
  "Rebuild the city" (sidebar) clears the progress for whoever wants to play;
  "Build it all now" (on the welcome card) skips it for whoever doesn't.

## Act one: raise the districts

A suggested order. Any first use builds its own landmark, in whatever order
it comes; the list only nudges towards read → edit → run → commit.

1. **Lay the tracks.** The page opens on an empty island with a three-line
   welcome: what this is, that it builds itself as you work, and the one thing
   to do now: `npm run connect`. The server reads `~/.claude/settings.json` to
   see the hooks (the logic is in `src/install.ts`) and lays the rails into
   Grand Central when they are there. The first SessionStart brings a train in
   and your lead steps off: Grand Central is the entrance, as section A made it
   the exit. Draw the arrival with the train from `drawTrains` run backwards
   (it comes in from the east, the agent appears, the train leaves empty).
2. **City Hall** rises on the first prompt (UserPromptSubmit), as the lead
   walks there to think.
3. **Public Library** on the first Read, Grep or Glob.
4. **Garment District** on the first Edit or Write: scaffolding first, the
   building after. `scaffold()` in `src/draw/map.ts` is the construction
   animation; a landmark stands under it for a few seconds after it unlocks.
5. **Hudson Yards** on the first shell command, smoke and all.
6. **Times Square** on the first WebFetch, WebSearch or browser tool. The
   billboards light one by one over the first few uses.
7. **Grand Central's towers** (MetLife and the Chrysler) on the first
   subagent dispatched. The blueprint's hint teaches the move: "Ask Claude to
   use a subagent."
8. **Seaport and the Statue of Liberty** on the first commit. Her torch
   lights on the first push.
9. **Central Park** greens when the first subagent finishes and goes to rest.
10. **The Empire State Building**, the capstone, goes up once every district
    is built, with the fireworks that `fireworks()` already draws for updates.
    "THE CITY IS COMPLETE" in the ticker, once.

Beyond the landmarks, the filler fabric (`fabric()` in map.ts) grows with
cumulative tool calls: one more block every so many, so the city keeps
densifying for weeks. "Population" in the header counts the blocks; it is
the slow, ambient reward after the quests are done. Pick the step so a normal
day of work adds a visible block or two, and cap it where the island is full.

## Act two: run the city

Once the island stands, the blueprints move to the app's own features, each a
small quest with a hint:

- **Answer at City Hall**: approve a permission or answer a question from the
  page rather than the terminal.
- **Send a telegram**: message a running session from its card.
- **Open a work site**: start a task from the New task form, so the first app
  session arrives.
- **File a zoning plan**: approve a plan from plan mode (section B3 posts it
  at City Hall).
- **Cross a bridge**: work in a second repository; the borough moves in and
  its bridge is built.
- **Last train home**: send a session home (section A).

Act two can ship later than act one: it leans on section B, and act one
stands on its own.

## How it fits the code

- `World` gains `built: Partial<Record<District, number>>` (when each landmark
  went up), `quests: Partial<Record<Quest, number>>` for act two, and a
  `population` counter. All of it is derived in `apply()` in `src/world.ts`,
  so it stays pure: feed a Read event, assert the Library is built. Unit-test
  every unlock the same way as `test/world.test.ts` does the departures.
- `landmarks()` in `src/draw/map.ts` draws a blueprint lot (dashed outline on
  the footprint from `RESERVED`, the name and the hint) for anything unbuilt,
  the scaffolded landmark for a few seconds after it unlocks, and the finished
  one after. The hover zones in `src/draw/places.ts` carry the hint text.
- The sidebar gets a **Blueprints** card: one line per landmark and quest with
  its state (blueprint, under construction, built) and hint. Toasts and the
  ticker announce each opening ("PUBLIC LIBRARY OPENED").
- The welcome card shows while nothing is built and no session has been seen;
  it goes away on the first event, or on "Build it all now".
- Migration: on load, a world with sessions, agents or repos and no `built`
  gets every landmark marked built at `flushedAt`, so nobody's city vanishes
  on update.

## Open choices

- **Blueprints or nothing.** Blueprints are recommended: they are the quest
  list drawn on the map itself, and they keep the island readable while empty.
- **Where the Statue starts.** Liberty Island bare, or the statue there and
  dark until the first commit. Dark is cheaper and reads as "not yet".
- **Whether act two gates anything.** It must not; it is a checklist with
  hints, nothing more.

## Order of work

Act one first, in this order: the world bookkeeping with tests, then the
blueprint and scaffold drawing, then the Blueprints card and welcome, then the
train's arrival. Act two once section B is in. Same cost lessons as the
handoff: small briefs, Sonnet subagents, no real Claude sessions until the
final check.
