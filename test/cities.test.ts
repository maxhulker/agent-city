import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { cityFor, citiesOf, HOME, idFor, register, stateFile, whoOf } from '../src/cities.ts'
import { hooksInstalled } from '../src/install.ts'

// More than one city: a personal one and a work one, each hearing only its
// own sessions, whether the two sign-ins share a config folder (routed by
// account) or each has its own (routed by URL).

const scratch = () => mkdtempSync(join(tmpdir(), 'agent-city-'))
const ORG = '0f3c9a2e-1b2c-4d5e-8f90-123456789abc'

test('home is always the first city; the registry adds the rest', () => {
  const dir = scratch()
  const registry = join(dir, 'cities.json')
  const [home, ...rest] = citiesOf(registry)
  assert.equal(home!.id, HOME)
  assert.equal(home!.name, 'Personal')
  assert.equal(rest.length, 0, 'no registry, one city')

  const work = register('work', { account: 'Max@Acme.com', name: 'Work' }, registry)
  assert.deepEqual(work.accounts, ['max@acme.com'])
  assert.equal(work.ownFolder, false, 'shares the folder')
  assert.notEqual(work.color, citiesOf(registry)[0]!.color, 'each tab its own colour')

  const side = register('side', { config: join(dir, 'side-claude') }, registry)
  assert.equal(side.config, resolve(dir, 'side-claude'))
  assert.equal(side.ownFolder, true)
  assert.deepEqual(citiesOf(registry).map(c => c.id), [HOME, 'work', 'side'])

  // A new name keeps the accounts; an account claimed again moves.
  assert.deepEqual(register('work', { name: 'Day job' }, registry).accounts, ['max@acme.com'])
  register('side', { account: 'max@acme.com' }, registry)
  assert.deepEqual(citiesOf(registry).find(c => c.id === 'work'), undefined, 'left claiming nothing, it is skipped')
  register(HOME, { name: 'Me' }, registry)
  assert.equal(citiesOf(registry)[0]!.name, 'Me')

  assert.throws(() => register('Work Stuff', { account: 'a@b.co' }, registry), /lowercase/)
  assert.throws(() => register('other', {}, registry), /--account/)
  assert.throws(() => register('other', { account: 'not an email' }, registry), /not an email/)
  assert.equal(idFor('Work', citiesOf(registry)), 'work')
  assert.equal(idFor('Side', citiesOf(registry)), 'side-2')
  assert.match(stateFile(HOME), /state\.json$/)
  assert.match(stateFile('work'), /cities[\\/]work\.json$/)
})

test('each event goes to the city that claims its account; the rest stay home', () => {
  const dir = scratch()
  const registry = join(dir, 'cities.json')
  register('work', { account: '@acme.com', name: 'Work' }, registry)
  register('side', { config: dir }, registry)
  register('org', { account: ORG }, registry)
  const cities = citiesOf(registry)
  // A desktop app session: its account rides in the headers.
  const desktop = (email: string, org = '') =>
    whoOf({ 'x-agent-city-email': email, 'x-agent-city-org': org, 'x-agent-city-hooks': '2' }, dir)
  assert.equal(cityFor(cities, null, desktop('max@acme.com')), 'work', 'a domain claims every address in it')
  assert.equal(cityFor(cities, null, desktop('maxhulker@gmail.com')), HOME)
  assert.equal(cityFor(cities, null, desktop('x@y.com', ORG.toUpperCase())), 'org')
  // A folder of its own: its URL says so, whatever the account.
  assert.equal(cityFor(cities, 'side', desktop('max@acme.com')), 'side')
  assert.equal(cityFor(cities, 'gone', {}), undefined)
  // AGENT_CITY, which Crosswalk gives the sessions it starts, beats them all.
  assert.equal(cityFor(cities, null, whoOf({ 'x-agent-city': 'home', 'x-agent-city-email': 'max@acme.com' }, dir)), HOME)
  assert.equal(cityFor(cities, null, whoOf({ 'x-agent-city': 'nope', 'x-agent-city-email': 'max@acme.com' }, dir)), 'work')
  // A shell that didn't expand a variable sends its name: nobody.
  assert.deepEqual(whoOf({ 'x-agent-city-email': '$CLAUDE_CODE_USER_EMAIL' }, dir), {})
})

test("a terminal session is the folder's signed-in account; hooks from before guess nothing", () => {
  const dir = scratch()
  const config = join(dir, 'claude-config')
  mkdirSync(config)
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'Max@Acme.com', organizationUuid: ORG } }))
  assert.deepEqual(whoOf({ 'x-agent-city-hooks': '2', 'x-agent-city-email': '' }, config), { email: 'max@acme.com', org: ORG })
  assert.deepEqual(whoOf({}, config), {}, 'old hooks: no account, so home')
  assert.equal(whoOf({ 'x-agent-city-hooks': '2', 'x-agent-city-email': 'me@gmail.com' }, config).email, 'me@gmail.com', 'the header wins')
})

test("the hooks say who their session is, and a city's own folder gets its own URL", () => {
  const dir = scratch()
  const run = (...args: string[]) =>
    JSON.parse(execFileSync(process.execPath, ['src/install.ts', '--print', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  const settings = join(dir, 'settings.json')
  writeFileSync(settings, '{}')

  const http = run('--settings', settings)
  const hook = http.hooks.SessionStart[0].hooks[0]
  assert.match(hook.url, /\/hook$/)
  assert.equal(hook.headers['x-agent-city-email'], '$CLAUDE_CODE_USER_EMAIL')
  assert.equal(hook.headers['x-agent-city'], '$AGENT_CITY')
  assert.ok(hook.allowedEnvVars.includes('CLAUDE_CODE_ORGANIZATION_UUID'))
  assert.match(http.statusLine.command, /-H "x-agent-city-email: \$CLAUDE_CODE_USER_EMAIL"/)
  const quiet = run('--settings', settings, '--quiet')
  assert.match(quiet.hooks.Stop[0].hooks[0].command, /-H "x-agent-city-hooks: 2".*\/hook \|\| exit 0$/)

  writeFileSync(settings, JSON.stringify(http))
  assert.equal(hooksInstalled(settings), true)
  assert.equal(hooksInstalled(settings, HOME, true), true, 'they say who')
  assert.equal(hooksInstalled(settings, 'work'), false)
  // Hooks from before this version: connected, but not by account.
  writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:4777/hook' }] }] } }))
  assert.equal(hooksInstalled(settings), true)
  assert.equal(hooksInstalled(settings, HOME, true), false)

  // A folder of its own: ?city=, quoted for the shell.
  const own = join(dir, 'own')
  mkdirSync(own)
  const side = run('--city', 'side', '--config', own, '--quiet')
  assert.match(side.hooks.Stop[0].hooks[0].command, /"http:\/\/127\.0\.0\.1:\d+\/hook\?city=side"/)
  writeFileSync(settings, JSON.stringify(run('--city', 'side', '--config', own)))
  assert.equal(hooksInstalled(settings, 'side'), true)
  assert.equal(hooksInstalled(settings, HOME), false, "side's hooks aren't home's")
})
