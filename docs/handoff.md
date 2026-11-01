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

## Shelved: the smoothness rebuild

The page redraws the whole ~200 KB city SVG on every frame (~300 ms per swap,
~15 fps idle) and agents' walks get cut short at frame boundaries. The fix is
designed and half built:

- The contract is `docs/frames.md`: the server streams `{map?, overlay,
  agents, meta}` instead of one SVG. The static map is sent once; the overlay
  is keyed items replaced only when their hash changes; agents are sprites
  with their full walk route, moved by the page on requestAnimationFrame.
- `Agent.walk?: {from, at}` is already in `src/types.ts` for it.
- The half-done edits are in a git stash on this machine:
  `git stash list` → "smoothness rebuild WIP: map/overlay/sprite layers".
  They touch src/city.ts, src/draw/*.ts, src/world.ts, src/server.ts and
  public/index.html, and were interrupted mid-way twice (usage limits), so
  treat the stash as reference, not as something to apply and run. It may be
  cheaper to start the split again from the contract.
- Measuring the result: load the page, then in the console count
  requestAnimationFrame calls over 2 s (was 15/s), time `innerHTML` swaps
  (was ~300 ms), and sample an agent's transform across a frame boundary (it
  used to jump to its destination).

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
