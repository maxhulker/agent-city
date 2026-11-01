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

The first repository seen is Manhattan. Every other repository a session works
in moves into Brooklyn, Queens, the Bronx or Jersey City, and agents cross the
bridges to reach it. Use **Make Manhattan** in the sidebar to change which
repository is home.

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
