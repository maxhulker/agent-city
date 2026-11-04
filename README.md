# Crosswalk

Watch every Claude Code session on this machine at work in one isometric
Manhattan at night. Each session gets a crowned lead in its own color, and its
subagents walk between landmarks as they call tools:

| Landmark | Tools |
| --- | --- |
| Public Library | Read, Grep, Glob |
| Garment District | Edit, Write |
| Hudson Yards | shell commands |
| Times Square | WebFetch, WebSearch, browsers |
| Grand Central | Agent, SendMessage, MCP tools |
| Seaport | git (merge conflicts light it up) |
| City Hall | the lead; questions and permission prompts raise a "?" here |
| Central Park | finished subagents rest here |

Each session has a subway bullet (Ⓐ, Ⓑ, …) shared by its agents. Agents hold
a prop for what they're doing (a book, a hammer, a laptop…), show a speech
bubble on hover, and send finished reports back by yellow cab. The building
being edited goes up in scaffolding, the Statue of Liberty hops on a commit and
launches on a push, and a Times Square news ticker runs along the bottom.

Manhattan is the main island: the busiest repository. Every other repository
a session works in (any file it reads or edits counts, wherever the session
started) arrives at Grand Central: its agents wait on the station's forecourt
under a sign, and its card goes to the top of the sidebar (click the sign to
find it). **Build it for me** gives it a borough sized to the repository on
the free land nearest the station, named after it, with streets, zoned lots
and a road to the city: its houses go up as soon as it is counted. **Lay it
out myself** lets you drag out where it goes, and lays the streets and lots
in it for you (untick that on the form to lay them yourself). Or move it into
a free borough (Brooklyn, Queens, the Bronx, Jersey City, or any you drew).
Then its agents cross over and gather on the borough's square. A drawn
borough with no lots says so in **Boroughs**, with a button to lay them.
**Make Manhattan** picks home yourself (the old Manhattan takes the new one's
place), and **Pick automatically** hands it back.

When a session starts a local server (a front end on localhost), a
**billboard** goes up for it: by Times Square for Manhattan's project, along
the front of a borough for the others, on the forecourt for a project still
waiting at Grand Central. It shows the page's title and address, and a click
opens the page in a window of its own. A new one glows, its bulbs chase and a
"New · click to open" tag hangs over it until you first open it. Crosswalk
spots the address in a shell's or a browser tool's work (or, for `npm run
dev` and the like run in the background, watches the usual dev ports for one
that opens), puts the billboard up only once the port answers, and takes it
down a few seconds after the server stops; it comes back when the server
does. The **⚙** beside a billboard opens its card: **Move** (click where it
should stand; `R` turns it while you move it, `Esc` cancels), **Rotate** (its
screen faces the other way: front-left or front-right), and **Destroy** (it
stays down while that server keeps running, and goes up again the next time
the server starts). A billboard you moved stays where you put it, and the
others keep clear of it.

A borough's houses are its repository. Crosswalk reads each one with git
(every 15 seconds while its agents work, every 5 minutes otherwise) and
gives every folder a run of houses side by side: as many as its share of the
files, as tall as its size, lit if it had commits in the last two weeks and
dark if not. Tests are red brick, docs stone, assets and loose files grey, code
brownstone. A small repository leaves the back plots empty, room to grow.
Folders with uncommitted changes go up in scaffolding (with a crane while an
agent edits there). The line under the sign shows the branch, commits ahead
(↑) and behind (↓) its upstream, the fortnight's commits and what is
uncommitted. Hover over a house for its folder's files, size and latest
commit, or over the borough for the repository at a glance. **Click a house**
to open its folder: every file in it with its size, the ones changed since
the last commit marked (changed, new, deleted, renamed), and a filter. Click
a file to look inside: its text with line numbers, Markdown rendered (or its
source), an image shown, and **Open in VS Code** or **Copy path** to take it
further. It is read-only, and only for the repositories the city knows. In a
borough you drew, the zoned lots take the folders. Manhattan keeps its
districts.

When a newer version is on GitHub's `main`, the Empire State Building lights up
gold and shoots fireworks: click it to update. Crosswalk pulls the new version
(a clean fast-forward only) and restarts itself; app sessions wake up with their
memory on your next message.

Scroll to zoom, drag to pan, double-click to zoom in, and press `0` or **Fit**
to see the whole island. Hover over a district, borough or landmark to see what
it stands for and who's there. Click an agent or a session card to highlight
that session.

## Talk to your sessions

The idea: you never need the terminal or the Claude window.

- **Read the conversation.** Click a session (on the map or its card) to open
  its conversation: your prompts, Claude's replies, and its tool calls folded
  into one-liners, read live from the session's transcript. It stays readable
  after the session ends or takes the last train home. The **Changes**
  tab shows the git diff of what it changed.
- **Look back.** **Earlier sessions** in the sidebar lists the sessions that
  have ended, newest first, from Claude Code's own records: its title, your
  first prompt, the folder and when. Click one to read its conversation, and
  **Continue in the app** to pick it up again with its full history.
- **Attach files** to a message in the conversation: the 📎 button, drop
  them on the drawer, or paste an image. Each is saved in
  `~/.agent-city/uploads` (up to 30 MB, cleared after a month) and the
  message lists its path, so Claude opens it with its Read tool: images,
  PDFs, notebooks, code and text. Sessions in the app see an image with the
  message itself, as in Claude, and read the folder without asking; a session
  in another window may ask you first, since the folder is outside its own.
- **Approve, answer and review plans** from the "Needs you" cards: Allow or
  Deny a permission request (with a reason Claude sees), answer Claude's
  multiple-choice questions, approve or send back a plan. Unanswered after
  nine minutes, the request falls back to the session's own window.
- **Get notified.** The bell in the header turns on desktop notifications and
  a chime for anything that needs you, finished turns and finished tasks; the
  window title counts what's waiting.
- **Message a running session** from its card in the sidebar. The message rides
  back on the session's next hook event: after its next tool call while it
  works, with your next prompt, or instead of stopping at the end of a turn
  (it carries on with your message). A session sitting idle gets it when it
  next does something; until then it shows as queued, and you can cancel it.
- **Start a new task** from the New task form: pick a folder, describe the
  task, and choose what it may do (read only; ask me in the app, where every
  edit or command becomes an Allow/Deny card; edit files; or edit and run
  commands), a model and version (the latest, a pinned one, or any model ID)
  and an effort level. Give it a name, a colour and a hat (crown, top hat,
  wizard, chef…) if you like; its lead wears them in the city, on its card and
  on its subway bullet. It runs as a headless Claude Code session, shows up in
  the city like any other, and its answer lands in the task list. Reply to it
  from its conversation and it carries on in the same session, with memory.
  Stop ends it and everything it started. (Headless tasks can't ask
  multiple-choice questions or present plans; sessions in a terminal can.)

Both work only from the page itself (the server refuses other origins), and
only with the HTTP hooks or the `--quiet` hooks from this version on.

## Building the city

A new city starts as bare land: streets, the rivers, Grand Central, and a
blueprint lot for every landmark ("PUBLIC LIBRARY · read a file to build it").
Each one goes up, in scaffolding first, the first time any session does that
kind of work: City Hall on your first prompt, the Library on the first read,
the Garment District on the first edit, Hudson Yards on the first shell
command, Times Square on the first web tool, Grand Central's towers on the
first subagent, the Seaport and the Statue of Liberty on the first commit (her
torch lights on the first push), Central Park when the first subagent finishes,
and the Empire State Building once every district stands, with fireworks. The
filler blocks fill in with the population, which counts every tool call. The
**Blueprints** card in the sidebar keeps the list with its hints. Nothing
waits for the scenery: agents, cards and approvals work from the first event.

A city that existed before this version counts as built. **Rebuild the city**
(on the Blueprints card) starts the game over for whoever wants to play it;
**Build it all now** (on the welcome card) skips it.

## Lay it out yourself

A new city starts on land of its own: the welcome card shows three maps made
from seeds (a mainland, a strait and the station's island; **Shuffle** for
others), or **start from Manhattan**, whole, to rearrange. Your first lead
arrives by train at the station. The **First district** card lists the
quests in a suggested order: lay a road from the station, place City Hall,
then the Library, the Garment District, Hudson Yards, Times Square, Grand
Central's towers, the Seaport (on a shore), Central Park and the Statue (in
the water), zone some blocks, and finally the Empire State Building, which
you can place once every district stands. Each goes up as you place it;
the first time a session uses it the ticker says it opened its doors. Work
of a kind you have not placed waits at the station. **Rebuild** offers the
same two starts.

The build toolbar along the bottom of the map lets you shape the city
(`docs/city-builder.md` is the plan): **Road** drags a street or avenue (over
water it is a bridge), **Zone** marks blocks beside a road for the population
to fill in, **Park** plants trees, **Borough** drags a rectangle for a project
and asks its name, **Build…** opens the catalogue of landmarks (each needs
land and a road along its front; the Seaport a shore; the Statue water; `R`
turns the front; the park where finished subagents rest comes as Central
Park, a town square or a pocket park), and **Bulldoze** removes a road, a building, a zoned lot or
a park. The ghost under the cursor is green where a thing may go and red
where it may not, with the reason beside the toolbar. With **Select**, click
a building for its card and Bulldoze. The right mouse button always pans;
`Esc` goes back to Select.

To move Grand Central, bulldoze it and place it again from **Build…** (one
stands at a time, in the city rather than a borough). While it is gone,
nothing arrives by train and the agents who would wait on its forecourt
gather at another building.

In the city a placed landmark goes up at once. In a borough it is a
blueprint lot until that repository's agents first do that kind of work
there, and from then on that work happens at its door. Bulldozing a borough
sends its repository back to Grand Central to wait for another. Manhattan's blocks are all zoned, so to place something on the island
bulldoze a lot first.

## Work orders and site plans

Click an agent to see why it exists and how it works. A subagent carries a
**work order**, the brief its lead gave it, numbered by session (A-1, A-2,
...), with who issued it and when; it walks out of Grand Central with a
clipboard. Every agent's last eight stops are drawn as a dotted subway line
with numbered stops, and listed in the drawer: Library and Garment District
back and forth reads as debugging. A session's task checklist is its **site
plan**: a hoarding beside its lead shows how much is done, and the drawer
lists it. A plan you approve from plan mode is posted at City Hall as the
zoning plan. Run `npm run connect` again to send Crosswalk the task
events; the checklist tools already feed it.

Once the city stands, the card turns to **Run the city**: answer at City
Hall, send a telegram, open a work site, file a zoning plan, lay out a
borough, and send a session home on the last train.

## The City Treasury

Place the **City Treasury** from Build… to keep the city's books on the map:
a Federal Hall with a board over its steps showing what was spent today and
what is left of your plan's limits. The **City Treasury** card in the
sidebar has today, this week and in all, the last two weeks, the 5-hour and
7-day limits (Pro, Max and Ultra plans) with when they reset, and what each
session here has spent. Spend is Claude Code's own estimate at list price;
your bill may differ. It comes from the status line `npm run connect` sets
up (only when you have none of your own; it prints the Treasury's line in
each terminal), and from app sessions and tasks, which report their cost
themselves.

## The last train home

Grand Central is the exit as well as the entrance. Everyone who leaves the
city walks there and boards a departing train: a lead that has sat idle for
half an hour (it dims the longer it waits, so the busy ones stand out), a
finished subagent two minutes after its report taxi has arrived, a session
that ends, and the lead of an app session you have ended. If a session speaks
again later it arrives fresh, like a new one. Above 24 agents, the ones idle
longest leave first.

A borough nobody has worked in for an hour packs up: the sign comes down and
the houses stay, and the repository moves straight back in when a session
works there again. **Send home** on a session's card sends that session's
agents to the train now; **Last call** in the header sends everyone idle.

It works with any account Claude Code is signed into, personal or company,
because hooks are set on the machine, not the account. It does not work with
claude.ai chat, which has no hooks.

## Run it

Needs Node 22.18 or newer (it runs the TypeScript directly, no install step).

```bash
npm start
```

Open http://localhost:4777.

### Desktop shortcut (Windows)

```bash
npm run shortcut
```

This puts an **Crosswalk** shortcut on the desktop. Opening it starts the
server if it isn't running, in a minimized window titled "Crosswalk" (close
that window to stop the server), and opens the city in its own Edge app window,
or in the default browser where Edge isn't installed. Opening it again while
the server runs just opens another window.

### As an app, with update notifications

- **Install it.** Open http://localhost:4777 in Edge or Chrome and choose
  *Install Crosswalk* (the install icon in the address bar, or the menu's
  *Apps*). It gets its own window, taskbar icon and Start menu entry.
- **Start it at login.** `npm run autostart` starts the server, out of
  sight, whenever you sign in to Windows, so the city keeps its records and
  its notifications reach you with no window open. `npm run autostart --
  -Remove` takes that away.
- **Notifications.** When main on GitHub has something new, or this copy has
  new commits since the server started (you or Claude committed here),
  Windows shows a notification once; clicking it opens the city, and the
  lit Empire State updates or restarts it in one click. `npm run
  notifications` gives them Crosswalk's own name and icon (otherwise they
  come from Windows PowerShell) and its own entry in Windows' notification
  settings. A notification that never pops up but sits in the notification
  centre (Win+N) means Do Not Disturb is on. Set `AGENT_CITY_NO_TOAST=1` to
  turn them off.

## Connect Claude Code

```bash
npm run connect
```

This adds HTTP hooks to `~/.claude/settings.json` (backed up first to
`settings.json.agent-city-backup`). It leaves every other setting and hook as
it is. Sessions started afterwards report to Crosswalk; restart any that are
open.

To stop Claude Code printing a failure line when Crosswalk isn't running, add
`--quiet`:

```bash
npm run connect -- --quiet
```

This installs command hooks that post the same events with `curl` and always
succeed silently. It needs `curl` in the shell Claude Code runs hooks in (Git
Bash on Windows has it). The trade-off: while Crosswalk is closed, each event
waits up to a third of a second for it, where the HTTP hooks fail at once.
Running `npm run connect` again, with or without `--quiet`, switches modes.

To disconnect:

```bash
npm run disconnect
```

To connect only one session, without touching your settings:

```bash
node src/install.ts --print --settings hooks.json
claude --settings hooks.json
```

## A city for each Claude

Signed in to Claude as more than one account, say a personal one and a
work one? Each can have a city of its own, with a tab for each in the header.

The hooks tell Crosswalk which account each session is signed in as: a
session the Claude desktop app starts says so itself, and one in a terminal
is whichever account the CLI is signed into (`~/.claude.json`). Run
`npm run connect` again once to get hooks that say so (they share
`~/.claude/settings.json`, whatever the account). When sessions from a second
account arrive, a card at the top of the panel lists the accounts reporting
to this city: name a city for one and click **Own city**. Its sessions move
there from their next step. Or from the terminal:

```bash
npm run connect -- --city work --account you@company.com --name Work
```

`--account` also takes `@company.com` for every address there, or an
organization's UUID. The cities are listed in `~/.agent-city/cities.json`,
and the server picks up a change within seconds, no restart needed.

Click a tab, or press `Alt+1`, `Alt+2`, to switch. Each city has its own
map, sessions, Treasury and state file (`~/.agent-city/cities/work.json`).
A tab's badge counts what is waiting for you there, and with the bell on, a
prompt in the other city notifies you too. A session started with
`AGENT_CITY=work` in its environment goes to that city whatever its
account; the sessions and tasks you start from a city's page are given
their city that way. They still run as the account the CLI is signed into.

A Claude Code with a config folder of its own (`CLAUDE_CONFIG_DIR`) can
have a city too: `npm run connect -- --city side --config <folder>` puts
hooks in that folder that post to `/hook?city=side`, and the sessions
started from its page run with that folder.

## Good to know

- Everything stays on this machine. The server listens on 127.0.0.1 only,
  refuses other hosts, and refuses hook posts that come from a web page.
- When Crosswalk isn't running, sessions carry on at full speed. Claude Code
  may print one `ECONNREFUSED` line for the failed hook; connect with
  `--quiet` (see above) to avoid it.
- State is kept in `~/.agent-city/state.json`, so a restart keeps the city.
- `AGENT_CITY_PORT` changes the port (set it for both `npm start` and
  `npm run connect`). `AGENT_CITY_DEBUG=1` writes every raw event to
  `~/.agent-city/events.log`. Those events include file paths and commands, so
  leave it off unless you are debugging.
- A company's managed settings can disable personal hooks. If the city stays
  empty on a work machine, that's the likely cause.
