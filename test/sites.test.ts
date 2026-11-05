import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { INSPECTION_MS, OPENED_MS, RIBBON_MS, applySiteEvent, boardOf, branchAtWork, isTestRun, outputOf, siteEventOf, verdictOf } from '../src/sites.ts'
import type { Census, Site } from '../src/types.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// A project's construction site: a pull request filed is its permit, a test
// run an inspection, a pull request merged its ribbon cutting.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'
const census = (branch: string): Census => ({ at: T0, branch, files: 1, bytes: 1, commits: 0, dirty: 0, blocks: [] })

test('test runners are spotted at the start of a command part, not in a file name', () => {
  for (const c of ['npm test', 'cd /c/x && npm test 2>&1 | tail -5', 'pnpm run test:unit', 'node --test test/*.test.ts', 'npx vitest run', 'CI=1 jest --ci', 'python -m pytest -q', 'go test ./...', 'cargo test', 'yarn test']) {
    assert.ok(isTestRun(c), c)
  }
  for (const c of ['cat jest.config.js', 'git commit -m ""', 'npm install', 'echo test', 'grep -r pytest .', 'npm run build']) {
    assert.ok(!isTestRun(c), c)
  }
})

test("a test run's verdict comes from its summary, whatever the runner", () => {
  assert.deepEqual(verdictOf('ℹ tests 147\nℹ pass 147\nℹ fail 0', false), { passed: true, detail: '147 passed' })
  assert.deepEqual(verdictOf('ℹ pass 140\nℹ fail 7', false), { passed: false, detail: '7 failed' })
  assert.deepEqual(verdictOf(' Tests  2 failed | 40 passed (42)', false), { passed: false, detail: '2 failed' })
  assert.deepEqual(verdictOf('Tests:       12 passed, 12 total', false), { passed: true, detail: '12 passed' })
  assert.deepEqual(verdictOf('==== 3 failed, 10 passed in 1.2s ====', false), { passed: false, detail: '3 failed' })
  assert.deepEqual(verdictOf('test result: ok. 9 passed; 0 failed; 0 ignored', false), { passed: true, detail: '9 passed' })
  assert.deepEqual(verdictOf('--- FAIL: TestX (0.00s)\nFAIL\tpkg', false), { passed: false })
  assert.deepEqual(verdictOf('ok  \tgithub.com/x/y\t0.2s', false), { passed: true })
  assert.deepEqual(verdictOf('something', true), { passed: false }, 'the command failed')
  assert.equal(verdictOf('building…', false), undefined, 'no summary: no verdict')
  assert.deepEqual(verdictOf('All checks were successful', false, true), { passed: true, detail: 'checks passed' })
  assert.deepEqual(verdictOf('Some checks were not successful\nci\tfail\t1m', false, true), { passed: false, detail: 'checks failed' })
  assert.equal(verdictOf('Some checks are still pending', false, true), undefined)
})

test('pull requests filed and merged, and checks, are site events', () => {
  const url = 'https://github.com/maxhulker/agent-city/pull/10'
  assert.deepEqual(siteEventOf('gh pr create --title "" --body ""', `${url}\n`, false), { kind: 'permit', pr: 10, url })
  assert.equal(siteEventOf('gh pr create', 'error: no commits', true), undefined)
  assert.deepEqual(siteEventOf('gh pr merge 10 --merge --delete-branch', '✓ Merged pull request maxhulker/agent-city#10', false), { kind: 'opened', pr: 10 })
  assert.deepEqual(siteEventOf('gh pr merge --squash', '✓ Squashed and merged pull request #12', false), { kind: 'opened', pr: 12 })
  assert.deepEqual(siteEventOf('gh pr merge --auto', '', false), { kind: 'opened' }, 'which one: the permit says')
  assert.deepEqual(siteEventOf(`gh pr merge ${url}`, '', false), { kind: 'opened', pr: 10, url })
  assert.equal(siteEventOf('gh pr merge 10', 'X Pull request #10 is not mergeable', false), undefined)
  assert.deepEqual(siteEventOf('gh pr checks 10', 'All checks were successful', false), { kind: 'inspection', passed: true, what: 'checks', detail: 'checks passed' })
  assert.deepEqual(siteEventOf('npm test', 'ℹ pass 3\nℹ fail 1', false), { kind: 'inspection', passed: false, what: 'tests', detail: '1 failed' })
  assert.equal(siteEventOf('ls', 'x', false), undefined)
  assert.equal(outputOf({ stdout: 'a', stderr: 'b', interrupted: false }), 'a\nb')
})

test("a site's board: pending, permit, open with a ribbon, then gone", () => {
  assert.equal(branchAtWork(census('main')), undefined)
  assert.equal(branchAtWork(census('break-ground')), 'break-ground')
  assert.equal(boardOf(undefined, census('main'), T0), undefined, 'nothing under way')
  assert.deepEqual(boardOf(undefined, census('feat'), T0), { stage: 'pending', branch: 'feat', ribbon: false })

  const site: Site = { root: 'r' }
  applySiteEvent(site, { kind: 'inspection', passed: false, what: 'tests', detail: '2 failed' }, 'feat', T0)
  applySiteEvent(site, { kind: 'permit', pr: 7, url: 'u7' }, 'feat', T0 + 1)
  const permit = boardOf(site, census('feat'), T0 + 2)!
  assert.equal(permit.stage, 'permit')
  assert.equal(permit.pr, 7)
  assert.equal(permit.inspection?.passed, false)
  assert.equal(boardOf(site, census('feat'), T0 + INSPECTION_MS + 5)!.inspection, undefined, 'an old inspection drops off')

  applySiteEvent(site, { kind: 'opened' }, undefined, T0 + 100)
  assert.equal(site.permit, undefined, 'the permit is used up')
  assert.deepEqual(site.opened, { at: T0 + 100, pr: 7, url: 'u7' }, 'the permit says which pull request')
  assert.deepEqual(boardOf(site, census('main'), T0 + 200), { stage: 'open', pr: 7, url: 'u7', ribbon: true })
  assert.equal(boardOf(site, census('main'), T0 + 100 + RIBBON_MS + 1)!.ribbon, false, 'the ribbon is cut and cleared')
  assert.equal(boardOf({ root: 'r', opened: site.opened }, census('main'), T0 + 100 + OPENED_MS + 1), undefined)

  // Merging another pull request leaves this one's permit standing.
  const two: Site = { root: 'r', permit: { pr: 8, url: 'u8', at: T0 } }
  applySiteEvent(two, { kind: 'opened', pr: 9 }, undefined, T0 + 1)
  assert.equal(two.permit?.pr, 8)
  assert.deepEqual(two.opened, { at: T0 + 1, pr: 9 })
})

function ev(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: 'S1', cwd: HOME, ...extra }
}
function bash(city: City, command: string, response: unknown, now: number, failed = false) {
  const extra = { tool_name: 'Bash', tool_use_id: `t${now}`, tool_input: { command } }
  city.apply(ev('PreToolUse', extra), now)
  city.apply(ev(failed ? 'PostToolUseFailure' : 'PostToolUse', { ...extra, ...(failed ? { error: response } : { tool_response: response }) }), now + 10)
}

test('the city keeps each site from its sessions\' commands, and draws its board and ribbon', () => {
  const city = new City()
  city.apply(ev('SessionStart'), T0)
  city.apply(ev('UserPromptSubmit', { prompt: 'go' }), T0)
  bash(city, 'npm test', { stdout: 'ℹ pass 5\nℹ fail 2', stderr: '' }, T0 + 100)
  const site = () => city.world.sites!.find(s => s.root === HOME)!
  assert.equal(site().inspection?.passed, false)
  assert.ok(city.toasts.some(t => /home failed inspection: 2 failed/.test(t)))

  bash(city, 'gh pr create --fill', { stdout: 'https://github.com/o/home/pull/3\n', stderr: '' }, T0 + 200)
  assert.equal(site().permit?.pr, 3)
  let overlay = renderFrame(city.world, T0 + 300).overlay
  const board = overlay.find(o => o.k === `site:${HOME.toLowerCase()}`)
  assert.ok(board, 'a board by City Hall')
  assert.match(board!.svg, /BUILDING PERMIT/)
  assert.match(board!.svg, /data-site-url="https:\/\/github.com\/o\/home\/pull\/3"/)
  assert.match(board!.svg, /FAILED/)

  bash(city, 'npm test', { stdout: 'ℹ pass 7\nℹ fail 0', stderr: '' }, T0 + 400)
  assert.equal(site().inspection?.passed, true)
  bash(city, 'gh pr merge 3 --merge', { stdout: '✓ Merged pull request o/home#3', stderr: '' }, T0 + 500)
  assert.ok(city.toasts.includes('✂ Ribbon cut in home: #3 merged'))
  overlay = renderFrame(city.world, T0 + 600).overlay
  assert.match(overlay.find(o => o.k === `site:${HOME.toLowerCase()}`)!.svg, /NOW OPEN/)
  assert.ok(overlay.some(o => o.k === `ribbon:${HOME.toLowerCase()}`), 'the ribbon is cut')
  overlay = renderFrame(city.world, T0 + 600 + OPENED_MS).overlay
  assert.ok(!overlay.some(o => o.k.startsWith('site:') || o.k.startsWith('ribbon:')), 'and the site is quiet again')

  // A failed command is a failed inspection, whatever it printed.
  bash(city, 'npm test', 'Command failed with exit code 1', T0 + 700, true)
  assert.equal(site().inspection?.passed, false)
})
