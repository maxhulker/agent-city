import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { City } from '../src/world.ts'
import { findSite } from '../src/layout.ts'
import { cityWith, stationDoor } from './whole.ts'
import type { HookEvent } from '../src/world.ts'

// Site plans (docs/handoff.md, B3) and act two of the onboarding
// (docs/onboarding.md): a session's task checklist, the plan posted at City
// Hall, and the app's own features as a checklist once the city stands.

const T0 = 1_700_000_000_000

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: 'C:/fake/home', ...extra }
}

function city(): City {
  const c = cityWith()
  c.buildAll(T0 - 60_000)
  c.apply(ev('SessionStart', 'S1'), T0)
  c.apply(ev('UserPromptSubmit', 'S1', { prompt: 'go' }), T0 + 10)
  c.flush(T0 + 20)
  return c
}

const planOf = (c: City) => c.world.sessions[0]!.plan ?? []

test('TaskCreated and TaskCompleted keep the site plan', () => {
  const c = city()
  c.apply(ev('TaskCreated', 'S1', { task_id: 'task-001', task_subject: 'Write the parser' }), T0 + 100)
  c.apply(ev('TaskCreated', 'S1', { task_id: 'task-002', task_subject: 'Test the parser', task_description: 'Unit tests' }), T0 + 200)
  c.apply(ev('TaskCreated', 'S1', { task_id: 'task-002', task_subject: 'Test the parser' }), T0 + 250)
  assert.deepEqual(planOf(c), [
    { id: 'task-001', subject: 'Write the parser', state: 'todo' },
    { id: 'task-002', subject: 'Test the parser', state: 'todo' },
  ])
  c.apply(ev('TaskCompleted', 'S1', { task_id: 'task-001', task_subject: 'Write the parser' }), T0 + 300)
  assert.equal(planOf(c)[0]!.state, 'done')
  // The tools say the same, with the task's number: no double.
  const tool = (name: string, input: Record<string, unknown>, response?: unknown) => {
    c.apply(ev('PreToolUse', 'S1', { tool_name: name, tool_use_id: `${name}${Math.random()}`, tool_input: input }), T0 + 400)
    if (response !== undefined) c.apply(ev('PostToolUse', 'S1', { tool_name: name, tool_use_id: 'x', tool_input: input, tool_response: response }), T0 + 410)
  }
  tool('TaskCreate', { subject: 'Test the parser' }, 'Task #2 created successfully: Test the parser')
  assert.equal(planOf(c).length, 2)
  tool('TaskUpdate', { taskId: '2', status: 'in_progress' })
  assert.equal(planOf(c)[1]!.state, 'doing', 'task #2 is task-002')
  tool('TaskCreate', { subject: 'Ship it' }, 'Task #3 created successfully: Ship it')
  assert.deepEqual(planOf(c)[2], { id: '3', subject: 'Ship it', state: 'todo' })
  tool('TaskUpdate', { taskId: '3', status: 'deleted' })
  assert.equal(planOf(c).length, 2)
})

test('TodoWrite gives the whole list; the lead stands by its hoarding while work is left', () => {
  const c = city()
  c.apply(ev('PreToolUse', 'S1', { tool_name: 'TodoWrite', tool_use_id: 'w1', tool_input: { todos: [
    { content: 'Read the brief', status: 'completed', activeForm: 'Reading' },
    { content: 'Write the code', status: 'in_progress', activeForm: 'Writing' },
    { content: 'Run the tests', status: 'pending', activeForm: 'Running' },
  ] } }), T0 + 100)
  assert.deepEqual(planOf(c).map(t => t.state), ['done', 'doing', 'todo'])
  const lead = () => renderFrame(c.world, T0 + 200).agents.find(a => a.id === 'lead:S1')!.fig.svg
  assert.ok(lead().includes('class="hoarding"') && lead().includes('1 of 3'))
  c.apply(ev('PreToolUse', 'S1', { tool_name: 'TodoWrite', tool_use_id: 'w2', tool_input: { todos: [
    { content: 'Read the brief', status: 'completed' },
    { content: 'Write the code', status: 'completed' },
    { content: 'Run the tests', status: 'completed' },
  ] } }), T0 + 300)
  assert.ok(!lead().includes('class="hoarding"'), 'all done: the hoarding comes down')
})

test('an approved plan is posted at City Hall as the zoning plan', () => {
  const c = city()
  c.fileZoningPlan({ session: 'S1', summary: 'x', plan: '# Move the station\n\nThen lay the rails.' }, T0 + 100)
  assert.equal(c.world.zoning?.title, 'Move the station')
  assert.equal(c.world.zoning?.by, c.world.agents.find(a => a.id === 'lead:S1')!.name)
  const f = renderFrame(c.world, T0 + 200)
  assert.ok(f.overlay.some(i => i.k === 'zoning' && i.svg.includes('Move the station')), 'the board by City Hall')
  assert.equal(c.world.feats?.zoning, T0 + 100)
})

test('act two shows once the city stands, records each feature once, and gates nothing', () => {
  const fresh = new City()
  assert.equal(fresh.actTwo(), undefined, 'not before the city stands')
  fresh.achieve('telegram', T0)
  assert.equal(fresh.world.feats?.telegram, T0, 'recorded all the same')
  assert.equal(fresh.toasts.length, 0, 'but not announced yet')

  const c = city()
  assert.deepEqual(c.actTwo()!.map(q => [q.id, q.state]), [
    ['answer', 'todo'], ['telegram', 'todo'], ['worksite', 'todo'], ['zoning', 'todo'], ['borough', 'todo'], ['train', 'todo'],
  ])
  assert.ok('id' in c.queueMessage('S1', 'hello', T0 + 100))
  assert.ok(c.toasts.includes('Act two: Send a telegram'))
  c.achieve('telegram', T0 + 200)
  assert.equal(c.world.feats?.telegram, T0 + 100, 'once')
  const [bx, by] = findSite(c.world.layout!, 5, 5, stationDoor(c.world.layout!))!
  assert.ok('ok' in c.build({ op: 'borough', x: bx, y: by, w: 5, h: 5, name: 'Red Hook' }, T0 + 300))
  assert.equal(c.actTwo()!.find(q => q.id === 'borough')!.state, 'done')
  assert.ok(c.sendHome('S1', T0 + 400))
  assert.equal(c.actTwo()!.find(q => q.id === 'train')!.state, 'done')
})
