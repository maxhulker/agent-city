import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// More than one city: say a personal one and a work one, with a tab for each
// on the page. A city hears the sessions it claims, in one of two ways:
//
// - by account: Claude Code sessions signed in as a given email or
//   organization (two sign-ins sharing one config folder). The hooks send
//   who they are as headers, and the server routes each event by them.
// - by config folder: a second Claude Code with its own CLAUDE_CONFIG_DIR,
//   whose settings' hooks post to /hook?city=<id>.
//
// A session started with AGENT_CITY=<id> in its environment goes to that
// city whatever its account (the sessions Crosswalk starts itself do).
//
// ~/.agent-city/cities.json lists the cities beyond the first:
//
//   { "cities": [
//     { "id": "work", "name": "Work", "accounts": ["me@company.com"] },
//     { "id": "side", "name": "Side", "config": "C:\\Users\\me\\.claude-side" }
//   ] }
//
// An account is an email, an organization UUID, or "@company.com" for a
// whole domain. The first city, "home", is the one there always was: every
// session nothing else claims, kept in state.json. An entry with id "home"
// renames it.

export const HOME = 'home'
export const ID = /^[a-z0-9][a-z0-9-]{0,23}$/

export type CityConf = {
  id: string
  name: string
  // The Claude Code config folder its sessions use: its own, or the shared one.
  config: string
  // True when the config folder is its own (its hooks post with ?city=).
  ownFolder: boolean
  // Emails, organization UUIDs and "@domain"s it claims, lowercased.
  accounts: string[]
  color: string
}

// Who a hook event comes from, from its headers.
export type Who = { city?: string; email?: string; org?: string }

// The headers our hooks send, and the variable each carries. Claude Code
// fills in an HTTP hook's header from the session's environment; the
// desktop app sets the account's for the sessions it starts.
export const WHO_HEADERS: Record<string, string> = {
  'x-agent-city': 'AGENT_CITY',
  'x-agent-city-email': 'CLAUDE_CODE_USER_EMAIL',
  'x-agent-city-org': 'CLAUDE_CODE_ORGANIZATION_UUID',
}
// Marks hooks that send those: without it (hooks from before), no guessing.
export const HOOKS_MARK = { header: 'x-agent-city-hooks', value: '2' }

// A colour for each city's tab, in the order they're listed.
const COLORS = ['#fbbf24', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fb923c']

export const stateDir = () => join(homedir(), '.agent-city')
export const registryPath = () => join(stateDir(), 'cities.json')
export const defaultConfig = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

// Where a city's world is kept.
export function stateFile(id: string): string {
  return id === HOME ? join(stateDir(), 'state.json') : join(stateDir(), 'cities', `${id}.json`)
}

type Entry = { id?: unknown; name?: unknown; config?: unknown; accounts?: unknown; color?: unknown }

function entries(path: string): Entry[] {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { cities?: unknown }
    return Array.isArray(raw.cities) ? raw.cities.filter((e): e is Entry => !!e && typeof e === 'object') : []
  } catch {
    return []
  }
}

const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ')
const accountsOf = (e: Entry) =>
  Array.isArray(e.accounts) ? e.accounts.filter((a): a is string => typeof a === 'string' && !!a.trim()).map(a => a.trim().toLowerCase()) : []

// Every city, home first. A bad entry (no id, nothing it claims, a repeat) is skipped.
export function citiesOf(path = registryPath()): CityConf[] {
  const list = entries(path)
  const color = (e: Entry | undefined, i: number) =>
    typeof e?.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color.toLowerCase() : COLORS[i % COLORS.length]!
  const name = (e: Entry | undefined, fallback: string) =>
    typeof e?.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 24) : fallback
  const home = list.find(e => e.id === HOME)
  const out: CityConf[] = [{ id: HOME, name: name(home, 'Personal'), config: defaultConfig(), ownFolder: false, accounts: [], color: color(home, 0) }]
  for (const e of list) {
    if (typeof e.id !== 'string' || !ID.test(e.id) || out.some(c => c.id === e.id)) continue
    const ownFolder = typeof e.config === 'string' && !!e.config.trim()
    const accounts = accountsOf(e)
    if (!ownFolder && !accounts.length) continue
    const config = ownFolder ? resolve((e.config as string).trim()) : defaultConfig()
    out.push({ id: e.id, name: name(e, label(e.id)), config, ownFolder, accounts, color: color(e, out.length) })
  }
  return out
}

// Adds a city to the registry, or changes its folder, name or accounts. Returns it.
export function register(id: string, opts: { config?: string; name?: string; account?: string }, path = registryPath()): CityConf {
  if (!ID.test(id)) throw new Error('A city id is lowercase letters, digits and dashes, up to 24 (like "work")')
  const list = entries(path)
  const at = list.findIndex(e => e.id === id)
  const was = at >= 0 ? list[at]! : undefined
  const entry: Entry = { ...was, id }
  if (id !== HOME && opts.config) entry.config = resolve(opts.config)
  if (opts.name) entry.name = opts.name.trim().slice(0, 24)
  const account = opts.account?.trim().toLowerCase()
  if (account && id !== HOME) {
    if (!/^([^\s@]*@[^\s@]+\.[^\s@]+|[0-9a-f-]{36})$/.test(account)) throw new Error(`${opts.account} is not an email, @domain or organization UUID`)
    // An account belongs to one city: claiming it here takes it from any other.
    for (const other of list) if (other !== was && Array.isArray(other.accounts)) other.accounts = accountsOf(other).filter(a => a !== account)
    entry.accounts = [...new Set([...accountsOf(entry), account])]
  }
  if (id !== HOME && typeof entry.config !== 'string' && !accountsOf(entry).length) {
    throw new Error(`Say what the ${id} city hears: --account <email> (a sign-in sharing ~/.claude) or --config <folder> (a Claude Code of its own)`)
  }
  if (at >= 0) list[at] = entry
  else list.push(entry)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ cities: list }, null, 2) + '\n')
  return citiesOf(path).find(c => c.id === id)!
}

// An id for a new city from its name, not one already taken.
export function idFor(name: string, cities: CityConf[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'city'
  let id = slug === HOME ? 'home-2' : slug
  for (let n = 2; cities.some(c => c.id === id); n++) id = `${slug}-${n}`
  return id
}

// The hook and status line URLs for a city of its own folder: home and the
// cities that share its folder keep the plain ones.
export function cityQuery(id: string): string {
  return id === HOME ? '' : `?city=${id}`
}

// The account Claude Code is signed into in a config folder, from its
// global config (~/.claude.json beside the default folder, or .claude.json
// inside one set with CLAUDE_CONFIG_DIR). A terminal session has no account
// in its environment; it is this one. Read again only when the file changes.
const logins = new Map<string, { mtime: number; who: Who }>()
export function loginOf(config: string): Who {
  const file = resolve(config) === resolve(homedir(), '.claude') ? join(homedir(), '.claude.json') : join(config, '.claude.json')
  try {
    const mtime = statSync(file).mtimeMs
    const known = logins.get(file)
    if (known && known.mtime === mtime) return known.who
    const acct = (JSON.parse(readFileSync(file, 'utf8')) as { oauthAccount?: { emailAddress?: unknown; organizationUuid?: unknown } }).oauthAccount
    const who: Who = {}
    if (typeof acct?.emailAddress === 'string') who.email = acct.emailAddress.toLowerCase()
    if (typeof acct?.organizationUuid === 'string') who.org = acct.organizationUuid.toLowerCase()
    logins.set(file, { mtime, who })
    return who
  } catch {
    return {}
  }
}

// Who an event comes from, from its headers. Hooks that send our headers but
// no account are a terminal session's: the folder's signed-in account.
export function whoOf(headers: Record<string, string | string[] | undefined>, config: string): Who {
  const get = (name: string) => {
    const v = headers[name]
    const s = (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase()
    // A shell that didn't expand the variable sends its name: that's nobody.
    return s && !s.startsWith('$') ? s : undefined
  }
  const who: Who = {}
  const city = get('x-agent-city')
  if (city && ID.test(city)) who.city = city
  const email = get('x-agent-city-email')
  const org = get('x-agent-city-org')
  if (email) who.email = email
  if (org) who.org = org
  if (!email && !org && get(HOOKS_MARK.header)) Object.assign(who, loginOf(config))
  return who
}

export function claims(conf: CityConf, who: Who): boolean {
  return conf.accounts.some(a => a === who.email || a === who.org || (a.startsWith('@') && !!who.email?.endsWith(a)))
}

// Which city an event goes to: the one its session names (AGENT_CITY), the
// one its URL names (a folder of its own), the one claiming its account, or
// home. Undefined for a city that isn't listed.
export function cityFor(cities: CityConf[], query: string | null, who: Who): string | undefined {
  if (who.city && cities.some(c => c.id === who.city)) return who.city
  if (query) return cities.some(c => c.id === query) ? query : undefined
  return cities.find(c => c.id !== HOME && !c.ownFolder && claims(c, who))?.id ?? HOME
}
