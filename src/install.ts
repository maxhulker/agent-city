import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// Connects every Claude Code session on this machine to Agent City by adding
// HTTP hooks to the user settings file, or removes them with --uninstall.
// --quiet installs command hooks that post with curl instead: Claude Code
// prints a failure line for an HTTP hook whenever the server is down, and the
// curl version always exits 0.
//
//   node src/install.ts [--uninstall] [--quiet] [--settings <path>] [--print]

const PORT = Number(process.env.AGENT_CITY_PORT ?? 4777)
const URL = `http://127.0.0.1:${PORT}/hook`

// Events Agent City listens to. Tool events take a matcher; the rest none.
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']
const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  ...TOOL_EVENTS,
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'Notification',
]

type Handler = { type?: string; url?: string; command?: string; [key: string]: unknown }
type Group = { matcher?: string; hooks?: Handler[]; [key: string]: unknown }
type Settings = { hooks?: Record<string, Group[]>; [key: string]: unknown }

const args = process.argv.slice(2)
const isUninstall = args.includes('--uninstall')
const isPrint = args.includes('--print')
const isQuiet = args.includes('--quiet')
const at = args.indexOf('--settings')
const path = at >= 0 && args[at + 1] ? args[at + 1]! : join(homedir(), '.claude', 'settings.json')

// Same JSON as the HTTP hook (stdin), but never fails: a down server is not an error.
// On Windows a closed local port isn't refused, it hangs: --connect-timeout keeps
// that to a fraction of a second per event.
const COMMAND = `curl -s --connect-timeout 0.3 -m 1 -o /dev/null -H "content-type: application/json" --data-binary @- ${URL} || exit 0`

// Either mode, so installing one removes the other and --uninstall gets both.
function isOurs(h: Handler): boolean {
  if (h.type === 'http') return typeof h.url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/hook$/.test(h.url)
  return h.type === 'command' && typeof h.command === 'string' && /\bcurl\b/.test(h.command) && /\/\/(127\.0\.0\.1|localhost):\d+\/hook\b/.test(h.command)
}

// Our hooks only: every other hook in the file stays as it is.
function strip(settings: Settings) {
  const hooks = settings.hooks ?? {}
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length > 0)
    if (kept.length) hooks[event] = kept
    else delete hooks[event]
  }
  if (Object.keys(hooks).length) settings.hooks = hooks
  else delete settings.hooks
}

function add(settings: Settings) {
  settings.hooks ??= {}
  for (const event of EVENTS) {
    const hook: Handler = isQuiet ? { type: 'command', command: COMMAND, timeout: 3 } : { type: 'http', url: URL, timeout: 2 }
    const group: Group = { hooks: [hook] }
    if (TOOL_EVENTS.includes(event)) group.matcher = '*'
    settings.hooks[event] = [...(settings.hooks[event] ?? []), group]
  }
}

const settings: Settings = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Settings) : {}
strip(settings)
if (!isUninstall) add(settings)
const text = JSON.stringify(settings, null, 2) + '\n'

if (isPrint) {
  process.stdout.write(text)
} else {
  if (existsSync(path)) {
    const backup = `${path}.agent-city-backup`
    copyFileSync(path, backup)
    console.log(`Backed up ${path} to ${backup}`)
  } else {
    mkdirSync(dirname(path), { recursive: true })
  }
  writeFileSync(path, text)
  console.log(
    isUninstall
      ? `Removed Agent City's hooks from ${path}.`
      : `Added Agent City's hooks to ${path} (${EVENTS.length} events → ${URL}; ${isQuiet ? 'quiet mode, curl command hooks' : 'HTTP hooks'}).\nSessions started from now on report to Agent City; restart any that are open.`,
  )
}
