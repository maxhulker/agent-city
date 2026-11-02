import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Work orders and route lines (docs/handoff.md, B1 and B2): a subagent keeps
// the brief its lead gave it, numbered by the session, and every agent keeps
// its last eight stops.

const T0 = 1_700_000_000_000

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: 'C:/fake/home', ...extra }
}

function city(): City {
  const c = new City()
  c.buildAll(T0 - 60_000)
  c.apply(ev('SessionStart', 'S1'), T0)
  c.apply(ev('UserPromptSubmit', 'S1', { prompt: 'go' }), T0 + 10)
  c.flush(T0 + 20)
  return c
}

function spawn(c: City, n: number, now: number, prompt: string) {
  c.apply(ev('PreToolUse', 'S1', { tool_name: 'Agent', tool_use_id: `t${n}`, tool_input: { description: `Find the bug ${n}`, prompt, subagent_type: 'Explore' } }), now)
  c.apply(ev('SubagentStart', 'S1', { agent_id: `a${n}`, agent_type: 'Explore' }), now + 100)
}

test("a subagent carries its lead's brief as a numbered work order", () => {
  const c = city()
  const lead = c.world.agents.find(a => a.id === 'lead:S1')!
  const bullet = c.world.sessions[0]!.bullet!
  spawn(c, 1, T0 + 1000, 'Look through src/world.ts for the borough bug.\nReport the line.')
  spawn(c, 2, T0 + 2000, 'x'.repeat(5000))
  const [one, two] = ['S1:a1', 'S1:a2'].map(id => c.world.agents.find(a => a.id === id)!)
  assert.deepEqual(one!.order, { no: `${bullet}-1`, title: 'Find the bug 1', brief: 'Look through src/world.ts for the borough bug.\nReport the line.', issuedBy: lead.name, at: T0 + 1000 })
  assert.equal(one!.name, 'Find the bug 1')
  assert.equal(two!.order!.no, `${bullet}-2`)
  assert.equal(two!.order!.brief.length, 2048, 'cut to 2 KB')
  assert.ok(two!.order!.brief.endsWith('…'))
  assert.equal(lead.order, undefined, 'a lead has no work order')
})

test('a subagent shows its clipboard on its first walk only', () => {
  const c = city()
  spawn(c, 1, T0 + 1000, 'Read the files.')
  c.flush(T0 + 1200)
  const clip = (now: number) => /class="clipboard"/.test(renderFrame(c.world, now).agents.find(a => a.id === 'S1:a1')!.fig.svg)
  assert.ok(clip(T0 + 1300), 'at the station')
  c.apply(ev('PreToolUse', 'S1', { agent_id: 'a1', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: 'C:/fake/home/a.ts' } }), T0 + 1400)
  c.flush(T0 + 1500)
  assert.ok(clip(T0 + 1600), 'on its first walk, to the Library')
  c.apply(ev('PreToolUse', 'S1', { agent_id: 'a1', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'C:/fake/home/a.ts' } }), T0 + 7000)
  c.flush(T0 + 7100)
  assert.ok(!clip(T0 + 7200), 'delivered')
})

test('every agent keeps its last eight stops, with when it got there', () => {
  const c = city()
  spawn(c, 1, T0 + 1000, 'Debug it.')
  c.flush(T0 + 1200)
  let now = T0 + 2000
  for (let i = 0; i < 6; i++) {
    for (const tool of ['Read', 'Edit']) {
      c.apply(ev('PreToolUse', 'S1', { agent_id: 'a1', tool_name: tool, tool_use_id: `${tool}${i}`, tool_input: { file_path: 'C:/fake/home/a.ts' } }), now)
      c.flush(now + 10)
      now += 1000
    }
  }
  const a = c.world.agents.find(x => x.id === 'S1:a1')!
  assert.equal(a.stops!.length, 8)
  assert.deepEqual(a.stops!.slice(-4).map(s => s.at), ['library', 'workshop', 'library', 'workshop'], 'debugging reads as back and forth')
  assert.equal(a.stops!.at(-1)!.t, now - 1000 + 10)
  const lead = c.world.agents.find(x => x.id === 'lead:S1')!
  assert.ok(lead.stops && lead.stops.length >= 1, 'the lead too')
})
