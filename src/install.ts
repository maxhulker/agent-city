import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { cityQuery, citiesOf, HOME, HOOKS_MARK, register, WHO_HEADERS } from './cities.ts'
import type { CityConf } from './cities.ts'

// Connects every Claude Code session on this machine to Crosswalk by adding
// HTTP hooks to the user settings file, or removes them with --uninstall.
// --quiet installs command hooks that post with curl instead: Claude Code
// prints a failure line for an HTTP hook whenever the server is down, and the
// curl version always exits 0.
//
// The hooks say which account each session is signed in as, so another
// sign-in sharing the config folder can have a city of its own (src/cities.ts):
// --city work --account <email> makes it. --city with --config <folder> is
// for a Claude Code with a config folder of its own; --name sets the tab's name.
//
//   node src/install.ts [--uninstall] [--quiet] [--settings <path>] [--print]
//                       [--city <id> [--account <email>] [--config <folder>] [--name <name>]]

const PORT = Number(process.env.AGENT_CITY_PORT ?? 4777)

// Events Crosswalk listens to. Tool events take a matcher; the rest none.
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']
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
  // A session's task checklist, for its site plan. Our reply is always empty,
  // so a task is never blocked.
  'TaskCreated',
  'TaskCompleted',
]
// The page answers these: Claude Code waits for the reply, so the hook may take
// minutes (the server gives up a minute before this and answers with nothing).
const HELD_EVENTS = ['PermissionRequest']
const HELD_TIMEOUT = 600

type Handler = { type?: string; url?: string; command?: string; [key: string]: unknown }
type Group = { matcher?: string; hooks?: Handler[]; [key: string]: unknown }
type Settings = { hooks?: Record<string, Group[]>; [key: string]: unknown }

const args = process.argv.slice(2)
const isUninstall = args.includes('--uninstall')
const isPrint = args.includes('--print')
const isQuiet = args.includes('--quiet')
const option = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] && !args[at + 1]!.startsWith('--') ? args[at + 1]! : undefined
}
const city = option('--city') ?? HOME

// Who the session is, as headers: an HTTP hook's are filled in from the
// session's environment by Claude Code, a command hook's by the shell.
const HTTP_WHO = {
  headers: {
    ...Object.fromEntries(Object.entries(WHO_HEADERS).map(([h, v]) => [h, `$${v}`])),
    [HOOKS_MARK.header]: HOOKS_MARK.value,
  },
  allowedEnvVars: Object.values(WHO_HEADERS),
}
const CURL_WHO = [...Object.entries(WHO_HEADERS).map(([h, v]) => `-H "${h}: $${v}"`), `-H "${HOOKS_MARK.header}: ${HOOKS_MARK.value}"`].join(' ')

// The hook and status line, for a URL ending in ?city= (a folder of its own) or not.
// In a command hook the URL goes through a shell, where ? is a wildcard.
const hookUrl = (query: string) => `http://127.0.0.1:${PORT}/hook${query}`
const curl = (url: string, maxSeconds: number) =>
  `curl -s --connect-timeout 0.3 -m ${maxSeconds} -H "content-type: application/json" ${CURL_WHO} --data-binary @- ${url.includes('?') ? `"${url}"` : url} || exit 0`

// Same JSON as the HTTP hook (stdin), but never fails: a down server is not an error.
// On Windows a closed local port isn't refused, it hangs: --connect-timeout keeps
// that to a fraction of a second per event. The server's reply goes to stdout, so
// a message sent from the page still reaches the session.
//
// The status line: Claude Code hands it the session's cost and the plan's
// usage limits, which the City Treasury keeps; it prints the Treasury's line
// (or nothing while Crosswalk is closed). Set only when there is no status
// line already: the person's own stays as it is.
const statusCommand = (query: string) => curl(`http://127.0.0.1:${PORT}/statusline${query}`, 1)
const isOurStatus = (v: unknown) =>
  !!v && typeof v === 'object' && typeof (v as { command?: unknown }).command === 'string' && /\/\/(127\.0\.0\.1|localhost):\d+\/statusline\b/.test((v as { command: string }).command)

// Either mode, so installing one removes the other and --uninstall gets both.
function isOurs(h: Handler): boolean {
  if (h.type === 'http') return typeof h.url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/hook(\?city=[a-z0-9-]+)?$/.test(h.url)
  return h.type === 'command' && typeof h.command === 'string' && /\bcurl\b/.test(h.command) && /\/\/(127\.0\.0\.1|localhost):\d+\/hook\b/.test(h.command)
}

// Whether a hook says who its session is (hooks from before don't).
function saysWho(h: Handler): boolean {
  if (h.type === 'http') return (h.headers as Record<string, unknown> | undefined)?.[HOOKS_MARK.header] === HOOKS_MARK.value
  return typeof h.command === 'string' && h.command.includes(`${HOOKS_MARK.header}: ${HOOKS_MARK.value}`)
}

// True when the settings file carries Crosswalk's hooks for this port and
// city (one with a folder of its own: its ?city=). The server shows it on the
// welcome card, and lays the rails into Grand Central. With byAccount, only
// hooks that say who their session is count: a city that claims an account
// hears nothing without them.
export function hooksInstalled(settingsPath: string, cityId = HOME, byAccount = false): boolean {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Settings
    const query = cityId === HOME ? '' : `\\?city=${cityId}`
    const port = new RegExp(`//(127\\.0\\.0\\.1|localhost):${PORT}/hook${query}(?![?\\w-])`)
    return (settings.hooks?.SessionStart ?? []).some(g =>
      (g.hooks ?? []).some(h => isOurs(h) && port.test(h.type === 'http' ? (h.url ?? '') : (h.command ?? '')) && (!byAccount || saysWho(h))),
    )
  } catch {
    return false
  }
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

function add(settings: Settings, query: string, quiet: boolean) {
  settings.hooks ??= {}
  for (const event of EVENTS) {
    const held = HELD_EVENTS.includes(event)
    const hook: Handler = quiet
      ? { type: 'command', command: curl(hookUrl(query), held ? HELD_TIMEOUT : 1), timeout: held ? HELD_TIMEOUT : 3 }
      : { type: 'http', url: hookUrl(query), ...HTTP_WHO, timeout: held ? HELD_TIMEOUT : 2 }
    const group: Group = { hooks: [hook] }
    if (TOOL_EVENTS.includes(event)) group.matcher = '*'
    settings.hooks[event] = [...(settings.hooks[event] ?? []), group]
  }
}

// The city to connect, put in the registry when named with --account,
// --config or --name (not with --print, which changes nothing).
function cityConf(): CityConf {
  const config = option('--config')
  const account = option('--account')
  const name = option('--name')
  if (config && !existsSync(config)) throw new Error(`${resolve(config)} is not a folder: give the folder Claude Code's CLAUDE_CONFIG_DIR points at`)
  if ((config || account || name) && !isPrint) return register(city, { config, account, name })
  const known = citiesOf().find(c => c.id === city)
  if (isPrint && config) return { ...(known ?? { id: city, name: city, accounts: [], color: '' }), config: resolve(config), ownFolder: true }
  if (!known) throw new Error(`There is no "${city}" city yet: add --account <its email> (or --config <its Claude Code config folder>)`)
  return known
}

// Adds Crosswalk's hooks (and status line) to a city's Claude Code settings,
// or takes them out: the command below, and the page's Connect and
// Disconnect buttons. Every other setting stays as it is; the file as it was
// before Crosswalk is backed up once, beside it. With `print`, nothing is
// written: the settings it would write come back.
export function setHooks(
  conf: CityConf,
  opts: { uninstall?: boolean; quiet?: boolean; settingsPath?: string; print?: boolean } = {},
): { path: string; text: string; message: string; backup?: string } {
  // A city sharing the folder (home, or one claiming an account) shares its hooks too.
  const query = conf.ownFolder ? cityQuery(conf.id) : ''
  if (opts.uninstall && !conf.ownFolder && conf.id !== HOME) {
    throw new Error(`The ${conf.id} city shares ${conf.config}'s hooks with the others; take it out of ~/.agent-city/cities.json to fold it back in`)
  }
  const path = opts.settingsPath ?? join(conf.config, 'settings.json')
  if (!opts.settingsPath && conf.ownFolder && !existsSync(conf.config)) throw new Error(`${conf.config} is not a folder: give the folder Claude Code's CLAUDE_CONFIG_DIR points at`)
  const settings: Settings = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Settings) : {}
  strip(settings)
  if (isOurStatus(settings.statusLine)) delete settings.statusLine
  if (!opts.uninstall) {
    add(settings, query, !!opts.quiet)
    if (!settings.statusLine) settings.statusLine = { type: 'command', command: statusCommand(query), padding: 0 }
  }
  const text = JSON.stringify(settings, null, 2) + '\n'
  const claims = conf.accounts.length ? `\nThe ${conf.name} city hears sessions signed in as ${conf.accounts.join(', ')}.` : ''
  const message = opts.uninstall
    ? `Removed Crosswalk's hooks from ${path}.`
    : `Added Crosswalk's hooks to ${path} (${EVENTS.length} events → ${hookUrl(query)}; ${opts.quiet ? 'quiet mode, curl command hooks' : 'HTTP hooks'}).${claims}\nSessions started from now on report to Crosswalk; restart any that are open.`
  if (opts.print) return { path, text, message }
  const backup = `${path}.agent-city-backup`
  let backedUp: string | undefined
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
  } else if (!existsSync(backup)) {
    // The first backup only: it keeps the settings as they were before Crosswalk.
    copyFileSync(path, backup)
    backedUp = backup
  }
  writeFileSync(path, text)
  return { path, text, message, ...(backedUp ? { backup: backedUp } : {}) }
}

function main() {
  const settingsPath = option('--settings')
  const r = setHooks(cityConf(), { uninstall: isUninstall, quiet: isQuiet, print: isPrint, ...(settingsPath ? { settingsPath } : {}) })
  if (isPrint) {
    process.stdout.write(r.text)
    return
  }
  if (r.backup) console.log(`Backed up ${r.path} to ${r.backup}`)
  console.log(r.message)
}

// Only when run as a command: importing this file (to check it loads) changes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (err) {
    console.error(`agent-city: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
