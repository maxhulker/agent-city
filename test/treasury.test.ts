import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderFrame } from '../src/city.ts'
import { dayOf } from '../src/draw/geo.ts'
import { canPlace } from '../src/layout.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// The City Treasury: what sessions spend (Claude Code's own estimate, from
// the status line, app sessions and tasks) and what is left of the plan's
// usage limits.

const T0 = 1_700_000_000_000

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: 'C:/fake/home', ...extra }
}

function city(): City {
  const c = new City()
  c.buildAll(T0 - 60_000)
  c.apply(ev('SessionStart', 'S1'), T0)
  return c
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

test('the books take only what each report adds; a /clear starts again', () => {
  const c = city()
  c.spend('S1', 0.1, T0)
  c.spend('S1', 0.25, T0 + 1000)
  c.spend('S1', 0.25, T0 + 2000)
  assert.ok(close(c.world.treasury!.total, 0.25))
  assert.ok(close(c.world.sessions[0]!.costUsd!, 0.25))
  c.spend('S1', 0.05, T0 + 3000)
  assert.ok(close(c.world.treasury!.total, 0.3), 'a total that drops is a fresh count')
  c.spend('S1', 'nonsense', T0 + 4000)
  c.spend('S1', -1, T0 + 4000)
  assert.ok(close(c.world.treasury!.total, 0.3))
  // The next day has its own page; a task turn is its own running total.
  c.spend('task:t1:0', 1, T0 + 86_400_000, 'S1')
  c.spend('task:t1:1', 0.5, T0 + 86_400_000, 'S1')
  const t = c.world.treasury!
  assert.ok(close(t.days[dayOf(T0)]!, 0.3))
  assert.ok(close(t.days[dayOf(T0 + 86_400_000)]!, 1.5))
  const v = c.treasuryView(T0 + 86_400_000)
  assert.ok(close(v.today, 1.5) && close(v.week, 1.8) && close(v.total, 1.8))
  assert.equal(v.days.length, 14)
  assert.equal(v.sessions[0]!.id, 'S1')
})

test('the status line brings the cost and the plan limits, and shows the Treasury', () => {
  const c = city()
  const line = c.statusLine(
    {
      session_id: 'S1',
      cost: { total_cost_usd: 0.42 },
      rate_limits: { five_hour: { used_percentage: 23.5, resets_at: (T0 + 3_600_000) / 1000 }, seven_day: { used_percentage: 41.2, resets_at: (T0 + 86_400_000) / 1000 } },
    },
    T0,
  )
  assert.equal(line, '🏦 $0.42 this session · $0.42 today · 5h 77% left · 7d 59% left')
  assert.deepEqual(c.world.limits?.fiveHour, { used: 23.5, resetsAt: T0 + 3_600_000 })
  // Past its reset a window is full again.
  const later = c.treasuryView(T0 + 2 * 3_600_000)
  assert.equal(later.limits.find(l => l.id === 'fiveHour')!.left, 100)
  assert.equal(later.limits.find(l => l.id === 'sevenDay')!.left, 100 - 41.2)
  // A report with no limits (an API key) leaves the last ones; a session the city has not seen shows its own cost.
  assert.equal(c.statusLine({ session_id: 'S2', cost: { total_cost_usd: 0.01 } }, T0), '🏦 $0.010 this session · $0.43 today · 5h 77% left · 7d 59% left')
  assert.equal(c.statusLine('garbage', T0).startsWith('🏦'), true)
})

test('the Treasury stands where it is placed, outside the game, with its board and its tooltip', () => {
  const c = city()
  const l = () => c.world.layout!
  // Somewhere on the island with a street along its front.
  let at: [number, number] | undefined
  for (let y = 4; y < 60 && !at; y++) for (let x = 0; x < 14 && !at; x++) if (!canPlace(l(), 'treasury', x, y)) at = [x, y]
  if (!at) {
    // The preset's blocks are all zoned: clear one.
    const [x, y] = l().zoned[10]!
    assert.ok('ok' in c.build({ op: 'unzone', x, y }, T0))
    at = [x, y]
  }
  const r = c.build({ op: 'place', kind: 'treasury', x: at[0], y: at[1] }, T0 + 100)
  assert.ok('ok' in r, JSON.stringify(r))
  const t = l().buildings.find(b => b.kind === 'treasury')!
  assert.equal(t.built, 0, 'it stands at once')
  assert.equal((c.world.built as Record<string, number>).treasury, undefined, 'no part of the game')
  c.spend('S1', 1.25, T0 + 200)
  const f = renderFrame(c.world, T0 + 300)
  const board = f.overlay.find(i => i.k === `treasury:${t.id}`)
  assert.ok(board?.svg.includes('$1.25 today'), board?.svg)
  assert.ok(f.overlay.find(i => i.k === 'zones')?.svg.includes('City Treasury'))
})

test('the installer adds the status line only where there is none, and takes back only its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-city-'))
  const run = (settings: object, ...args: string[]) => {
    const path = join(dir, `s${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(path, JSON.stringify(settings))
    return JSON.parse(execFileSync(process.execPath, ['src/install.ts', '--print', '--settings', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  }
  const fresh = run({})
  assert.match(fresh.statusLine.command, /127\.0\.0\.1:\d+\/statusline/)
  assert.ok(fresh.hooks.TaskCreated && fresh.hooks.TaskCompleted, 'the task events for site plans')
  const theirs = { type: 'command', command: 'my-own-statusline.sh' }
  assert.deepEqual(run({ statusLine: theirs }).statusLine, theirs, 'theirs stays')
  assert.equal(run(fresh, '--uninstall').statusLine, undefined, 'ours goes')
  assert.deepEqual(run({ statusLine: theirs }, '--uninstall').statusLine, theirs)
})
