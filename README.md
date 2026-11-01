# Agent City

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

Manhattan is the busiest repository. Every other repository a session works in
moves into Brooklyn, Queens, the Bronx or Jersey City, and agents cross the
bridges to reach it. Use **Make Manhattan** in the sidebar to pick home
yourself, and **Pick automatically** to hand it back.

When a newer version is on GitHub's `main`, the Empire State Building lights up
gold and shoots fireworks: click it to update. Agent City pulls the new version
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
  into one-liners, read live from the session's transcript. The **Changes**
  tab shows the git diff of what it changed.
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
  and an effort level. It runs as a headless Claude Code session, shows up in
  the city like any other, and its answer lands in the task list. Reply to it
  from its conversation and it carries on in the same session, with memory.
  Stop ends it and everything it started. (Headless tasks can't ask
  multiple-choice questions or present plans; sessions in a terminal can.)

Both work only from the page itself (the server refuses other origins), and
only with the HTTP hooks or the `--quiet` hooks from this version on.

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

This puts an **Agent City** shortcut on the desktop. Opening it starts the
server if it isn't running, in a minimized window titled "Agent City" (close
that window to stop the server), and opens the city in its own Edge app window,
or in the default browser where Edge isn't installed. Opening it again while
the server runs just opens another window.

## Connect Claude Code

```bash
npm run connect
```

This adds HTTP hooks to `~/.claude/settings.json` (backed up first to
`settings.json.agent-city-backup`). It leaves every other setting and hook as
it is. Sessions started afterwards report to Agent City; restart any that are
open.

To stop Claude Code printing a failure line when Agent City isn't running, add
`--quiet`:

```bash
npm run connect -- --quiet
```

This installs command hooks that post the same events with `curl` and always
succeed silently. It needs `curl` in the shell Claude Code runs hooks in (Git
Bash on Windows has it). The trade-off: while Agent City is closed, each event
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

## Good to know

- Everything stays on this machine. The server listens on 127.0.0.1 only,
  refuses other hosts, and refuses hook posts that come from a web page.
- When Agent City isn't running, sessions carry on at full speed. Claude Code
  may print one `ECONNREFUSED` line for the failed hook; connect with
  `--quiet` (see above) to avoid it.
- State is kept in `~/.agent-city/state.json`, so a restart keeps the city.
- `AGENT_CITY_PORT` changes the port (set it for both `npm start` and
  `npm run connect`). `AGENT_CITY_DEBUG=1` writes every raw event to
  `~/.agent-city/events.log`. Those events include file paths and commands, so
  leave it off unless you are debugging.
- A company's managed settings can disable personal hooks. If the city stays
  empty on a work machine, that's the likely cause.
