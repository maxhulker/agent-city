import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { costOf, costsByRoot, signCost } from '../src/costs.ts'
import type { LedgerEntry, World } from '../src/types.ts'
import { City } from '../src/world.ts'

// What each project has cost to build: the Treasury's ledger by the
// repository each session started in.

const T0 = 1_700_000_000_000
const entry = (root: string, usd: number): LedgerEntry => ({ name: 'x', root, color: '#fff', usd, days: {}, first: T0, last: T0 })

test('the ledger summed by project, whatever the slashes and case', () => {
  const world = { treasury: { days: {}, total: 0, last: {}, ledger: { a: entry('C:/p/api', 1.5), b: entry('c:\\p\\API', 2.25), c: entry('C:/p/web', 4), d: entry('', 9), e: entry('C:/p/web', 0) } } } as unknown as World
  const costs = costsByRoot(world)
  assert.deepEqual(costOf(costs, 'C:/p/api'), { usd: 3.75, sessions: 2 })
  assert.deepEqual(costOf(costs, 'C:/p/web'), { usd: 4, sessions: 1 }, 'an account that spent nothing is not a session of it')
  assert.equal(costOf(costs, 'C:/p/none'), undefined)
  assert.equal(signCost(3.456), '$3.46')
  assert.equal(signCost(1234.4), '$1,234')
})

test("a borough's sign and the Treasury card say what it cost to build", () => {
  const city = new City()
  city.apply({ hook_event_name: 'SessionStart', session_id: 'S1', cwd: 'C:/fake/home' }, T0)
  city.build({ op: 'movein', id: 'brooklyn', root: 'C:/fake/api' }, T0 + 10)
  city.world.treasury = { days: {}, total: 7, last: {}, ledger: { S2: entry('C:/fake/api', 5), S3: entry('C:/fake/api', 1.25), S1: entry('C:/fake/home', 0.75) } }
  const overlay = renderFrame(city.world, T0 + 20).overlay
  assert.match(overlay.find(o => o.k === 'burb:brooklyn')!.svg, /\$6\.25 to build/)
  assert.match(overlay.find(o => o.k === 'zones')!.svg, /Built so far for \$6\.25 across 2 sessions/)
  const view = city.treasuryView(T0 + 30)
  assert.deepEqual(view.projects.map(p => [p.name, p.usd, p.sessions, p.home]), [['api', 6.25, 2, false], ['home', 0.75, 1, true]])
})
