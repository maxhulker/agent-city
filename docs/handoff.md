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
then B3 once the task hooks are verified. The smoothness rebuild
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
of the preset's map in `test/golden.json` (`test/layout.test.ts`). Nothing
is drawn from the layout yet; step two is next.

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
- A repository keeps its borough until all four are taken; nothing empties a
  borough that has gone quiet.
- The interactive-window fallback for an unanswered permission card (the card
  says it falls back after nine minutes) was never tested in a real terminal.
- The conversation drawer keeps polling `/conversation` for a session that
  has left (one 404 a second while it stays open on a departed session).
