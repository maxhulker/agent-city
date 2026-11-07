import test from 'node:test'
import assert from 'node:assert/strict'

import { districtFor, renderFrame } from '../src/city.ts'
import { VERDICT_MS, isCiWait, siteEventOf, testWaitOf, verdictOf } from '../src/sites.ts'
import { City, waitingLine } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Waiting on tests: a session running its tests, or watching CI, sends its
// agent to the Rail Yards with a stopwatch, an hourglass over its head and
// its foot tapping, until the result comes back with a tick or a cross.

const T0 = 1_700_000_000_000
const MIN = 60_000
const HOME = 'C:/fake/home'

function ev(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: 'S1', cwd: HOME, ...extra }
}

function started(): City {
  const city = new City()
  city.apply(ev('SessionStart'), T0)
  city.apply(ev('UserPromptSubmit', { prompt: 'go' }), T0)
  return city
}

const pre = (city: City, id: string, command: string, now: number, extra: Record<string, unknown> = {}) =>
  city.apply(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command, ...extra } }), now)
const post = (city: City, id: string, command: string, stdout: string, now: number, failed = false) =>
  city.apply(
    ev(failed ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command }, ...(failed ? { error: stdout } : { tool_response: { stdout, stderr: '' } }) }),
    now,
  )

const lead = (city: City) => city.world.agents.find(a => a.id === 'lead:S1')!
const sprite = (city: City, now: number) => {
  city.flush(now)
  return renderFrame(city.world, now).agents.find(a => a.id === 'lead:S1')!
}

test('a test run, or a wait on CI, is waiting on tests', () => {
  for (const c of ['npm test', 'cd /c/x && npm test 2>&1 | tail -20', 'node --test test/*.test.ts', 'npx vitest run', 'python -m pytest -q', 'cargo test']) {
    assert.equal(testWaitOf(c), 'tests', c)
  }
  for (const c of [
    'gh run watch 123',
    'gh run watch --exit-status',
    'gh pr checks',
    'gh pr checks 34 -R maxhulker/agent-city --watch',
    'GH_TOKEN=$(gh auth token --user maxhulker) gh pr checks 34 --watch',
    'until gh pr checks 5; do sleep 30; done',
    'sleep 60 && gh run view 123 --json conclusion',
    'gh run view 123 --exit-status',
  ]) {
    assert.equal(testWaitOf(c), 'ci', c)
  }
  for (const c of ['npm install', 'gh pr view 5', 'gh run list', 'gh run view 123 --log-failed', 'gh pr checks 5 --web', 'git push', 'echo gh pr checks', 'cat jest.config.js']) {
    assert.equal(testWaitOf(c), undefined, c)
  }
  assert.ok(isCiWait('gh run watch 9'))
  assert.ok(!isCiWait('npm test'))
})

test('it is done at the Rail Yards, CI waits included; other gh work stays at the Seaport', () => {
  assert.equal(districtFor('Bash', 'npm test'), 'foundry')
  assert.equal(districtFor('Bash', 'gh pr checks 5 --watch'), 'foundry')
  assert.equal(districtFor('PowerShell', 'gh run watch 12'), 'foundry')
  assert.equal(districtFor('Bash', 'gh pr view 5'), 'harbor')
  assert.equal(districtFor('Bash', 'git status'), 'harbor')
})

test("a watched CI run's verdict comes from how it completed; pending checks are no failure", () => {
  assert.deepEqual(verdictOf("✓ main CI · 123\nRun CI (123) completed with 'success'", false, true), { passed: true, detail: 'CI passed' })
  assert.deepEqual(verdictOf("X main CI · 123\nRun CI (123) completed with 'failure'", true, true), { passed: false, detail: 'CI failed' })
  assert.deepEqual(verdictOf('{"conclusion":"success","status":"completed"}', false, true), { passed: true, detail: 'CI passed' })
  assert.equal(verdictOf('test (macos)\tpending\t0\thttps://x\ntest (windows)\tpass\t1m\thttps://y', true, true), undefined, 'gh pr checks exits non-zero while it waits')
  assert.deepEqual(siteEventOf('gh run watch 7 --exit-status', "Run CI (7) completed with 'failure'", true), { kind: 'inspection', passed: false, what: 'checks', detail: 'CI failed' })
})

test('the agent waits on its tests at the Rail Yards, then shows how they came out', () => {
  const city = started()
  pre(city, 't1', 'npm test 2>&1 | tail -5', T0 + 1000)
  const a = lead(city)
  assert.equal(a.at, 'foundry')
  assert.equal(a.status, 'working')
  assert.deepEqual(a.waitingOn, { what: 'tests', since: T0 + 1000, id: 't1' })
  assert.equal(a.activity, 'Waiting on tests: npm test 2>&1 | tail -5')
  assert.equal(waitingLine(a), 'WAITING ON TESTS npm test 2>&1 | tail -5', "the ticker's live line")

  const waiting = sprite(city, T0 + 1500)
  assert.equal(waiting.cls, 'agent working testing', 'its speech bubble shows')
  assert.match(waiting.fig.svg, /class="stopwatch"/, 'a stopwatch in hand')
  assert.match(waiting.fig.svg, /class="hourglass"/, 'an hourglass over its head')
  assert.match(waiting.fig.svg, /type="rotate" values="-3;3;-3"/, 'rocking on its heels, not bouncing at work')
  assert.ok(!waiting.fig.svg.includes('dur=".55s"'))

  post(city, 't1', 'npm test 2>&1 | tail -5', 'ℹ pass 12\nℹ fail 0', T0 + 30_000)
  assert.equal(a.waitingOn, undefined, 'the result is back')
  assert.equal(a.activity, 'npm test 2>&1 | tail -5')
  assert.equal(waitingLine(a), undefined)
  assert.deepEqual(a.verdict, { passed: true, at: T0 + 30_000 })
  const passed = sprite(city, T0 + 30_100)
  assert.equal(passed.cls, 'agent working')
  assert.match(passed.fig.svg, /class="verdict passed"/, 'a green tick')
  assert.ok(!passed.fig.svg.includes('stopwatch'))

  // The tick comes down after a moment, and the server redraws for it.
  assert.equal(city.due(T0 + 30_000 + VERDICT_MS - 1), false)
  assert.equal(city.due(T0 + 30_000 + VERDICT_MS), true)
  const after = sprite(city, T0 + 30_000 + VERDICT_MS)
  assert.ok(!after.fig.svg.includes('verdict'))
  assert.equal(a.verdict, undefined)
})

test('waiting on CI says so, and a failed run shows a red cross', () => {
  const city = started()
  const cmd = 'gh pr checks 34 --watch'
  pre(city, 'c1', cmd, T0 + 1000)
  const a = lead(city)
  assert.equal(a.at, 'foundry', 'not the Seaport')
  assert.equal(a.waitingOn?.what, 'ci')
  assert.equal(a.activity, `Waiting on CI: ${cmd}`)
  assert.equal(waitingLine(a), `WAITING ON CI ${cmd}`)
  post(city, 'c1', cmd, 'Some checks were not successful\ntest (macos)\tfail\t1m\thttps://x', T0 + 90_000, true)
  assert.equal(a.waitingOn, undefined)
  assert.equal(a.verdict?.passed, false)
  assert.match(sprite(city, T0 + 90_100).fig.svg, /class="verdict failed"/)
})

test("only its own call's result ends the wait; other work, a stop or a background run do not start or keep one", () => {
  const city = started()
  // A read started alongside finishes first: still waiting.
  pre(city, 't1', 'npm test', T0 + 1000)
  post(city, 'r0', 'cat a.txt', 'a', T0 + 2000)
  assert.equal(lead(city).waitingOn?.what, 'tests')
  // Another call means it has moved on; the test's result still gives its verdict.
  city.apply(ev('PreToolUse', { tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: `${HOME}/a.ts` } }), T0 + 3000)
  assert.equal(lead(city).waitingOn, undefined)
  post(city, 't1', 'npm test', 'ℹ pass 1\nℹ fail 2', T0 + 4000)
  assert.equal(lead(city).verdict?.passed, false)
  assert.equal(lead(city).activity, 'Read a.ts', 'its activity is the read it moved on to')

  // A test run sent to the background is not waited on here.
  pre(city, 'b1', 'npm test', T0 + 5000, { run_in_background: true })
  assert.equal(lead(city).waitingOn, undefined)
  assert.equal(lead(city).at, 'foundry')

  // The turn ending ends the wait.
  pre(city, 't2', 'npm test', T0 + 6000)
  city.apply(ev('Stop'), T0 + 7000)
  assert.equal(lead(city).waitingOn, undefined)
  assert.equal(lead(city).status, 'idle')
})

test('a long wait on tests is not taken for a session gone quiet', () => {
  const city = started()
  pre(city, 'c1', 'gh run watch 5', T0)
  city.flush(T0 + 15 * MIN)
  assert.equal(lead(city).status, 'working', 'still waiting at a quarter of an hour')
  assert.equal(lead(city).waitingOn?.what, 'ci')
  city.flush(T0 + 21 * MIN)
  assert.equal(lead(city).status, 'idle', 'but not for ever')
  assert.equal(lead(city).waitingOn, undefined)
})
