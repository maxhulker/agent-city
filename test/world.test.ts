import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { renderCity } from './render.ts'
import { opacityFor } from '../src/draw/agents.ts'
import { AGENT_CAP, BURB_LEAVE, City, IDLE_LEAVE, REST_LEAVE, TRAIN_MS } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'
import { cityWith } from './whole.ts'

// The world rules are pure: feed the city hook events and clock ticks, then
// look at what it holds. No server, no page, no Claude.

const T0 = 1_700_000_000_000
const MIN = 60_000
const HOME = 'C:/fake/home'
const OTHER = 'C:/fake/other'
const THIRD = 'C:/fake/third'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

// A session that has done one turn and now waits, idle, in Central Park.
function idleSession(city: City, sid: string, now: number, cwd = HOME) {
  city.apply(ev('SessionStart', sid, { cwd }), now)
  city.apply(ev('UserPromptSubmit', sid, { cwd, prompt: 'hello' }), now)
  city.apply(ev('Stop', sid, { cwd }), now)
}

// A session in the middle of a turn, reading a file.
function workingSession(city: City, sid: string, now: number, cwd = HOME) {
  city.apply(ev('SessionStart', sid, { cwd }), now)
  city.apply(ev('UserPromptSubmit', sid, { cwd, prompt: 'hello' }), now)
  city.apply(ev('PreToolUse', sid, { cwd, tool_name: 'Read', tool_use_id: `${sid}-read`, tool_input: { file_path: `${cwd}/a.ts` } }), now)
}

const lead = (city: City, sid: string) => city.world.agents.find(a => a.id === `lead:${sid}`)
const staying = (city: City) => city.world.agents.filter(a => a.status !== 'leaving')

test('an idle lead takes the last train home after half an hour, and the train leaves', () => {
  const city = new City()
  idleSession(city, 'S1', T0)
  city.flush(T0 + IDLE_LEAVE - MIN)
  assert.equal(lead(city, 'S1')?.status, 'idle')
  assert.equal(city.world.sessions.length, 1)

  city.flush(T0 + IDLE_LEAVE + MIN)
  const a = lead(city, 'S1')!
  assert.equal(a.status, 'leaving', 'it is on its way to the station')
  assert.equal(a.at, 'relay', 'Grand Central is the exit')
  assert.equal(a.burb, undefined)
  assert.ok(a.leaving! > T0 + IDLE_LEAVE + MIN, 'the train waits for the walk')
  assert.equal(city.world.sessions.length, 0, 'the session is forgotten')
  assert.equal(city.world.trains?.length, 1)
  const leaveAt = city.world.trains![0]!.leaveAt
  assert.equal(leaveAt, a.leaving)

  assert.equal(city.due(leaveAt - 100), false)
  assert.equal(city.due(leaveAt), true, 'the server redraws when the train is due')
  city.flush(leaveAt)
  assert.equal(city.world.agents.length, 0, 'gone with the train')
  assert.equal(city.world.trains?.length, 1, 'the train is still pulling out')

  assert.equal(city.due(leaveAt + TRAIN_MS), true)
  city.flush(leaveAt + TRAIN_MS)
  assert.equal(city.world.trains, undefined)
})

test('a session that speaks again after leaving arrives fresh', () => {
  const city = new City()
  idleSession(city, 'S1', T0)
  city.flush(T0 + IDLE_LEAVE + MIN)
  assert.equal(lead(city, 'S1')?.status, 'leaving')

  const later = T0 + IDLE_LEAVE + MIN + 1000
  city.apply(ev('UserPromptSubmit', 'S1', { prompt: 'back again' }), later)
  const s = city.world.sessions.find(one => one.id === 'S1')!
  assert.equal(s.startedAt, later, 'a new session record')
  const leads = city.world.agents.filter(a => a.id === 'lead:S1')
  assert.equal(leads.length, 1, 'the one waiting for the train is gone at once')
  assert.equal(leads[0]!.status, 'working')
  assert.equal(leads[0]!.leaving, undefined)
})

test('a message still queued keeps an idle session from leaving on the timer', () => {
  const city = new City()
  idleSession(city, 'S1', T0)
  city.queueMessage('S1', 'one more thing', T0 + MIN)
  city.flush(T0 + IDLE_LEAVE + 2 * MIN)
  assert.equal(lead(city, 'S1')?.status, 'idle')
  assert.equal(city.world.sessions.length, 1)
})

test('a finished subagent leaves two minutes after its report has arrived', () => {
  const city = new City()
  workingSession(city, 'S1', T0)
  city.apply(ev('SubagentStart', 'S1', { agent_id: 'a1', agent_type: 'Explore' }), T0 + 1000)
  city.apply(ev('PreToolUse', 'S1', { agent_id: 'a1', tool_name: 'Grep', tool_use_id: 'g1', tool_input: { pattern: 'x' } }), T0 + 2000)
  const stopAt = T0 + 10_000
  city.apply(ev('SubagentStop', 'S1', { agent_id: 'a1' }), stopAt)
  const sub = () => city.world.agents.find(a => a.id === 'S1:a1')
  assert.equal(sub()?.status, 'done')
  assert.ok(sub()!.restUntil! > stopAt + REST_LEAVE, 'the taxi ride comes first')

  city.flush(stopAt + MIN)
  assert.equal(sub()?.status, 'done', 'still resting in Central Park')
  city.flush(stopAt + REST_LEAVE + 6000)
  assert.equal(sub()?.status, 'leaving')
  assert.equal(lead(city, 'S1')?.status, 'working', 'its lead carries on')
  assert.equal(city.world.sessions.length, 1)
})

test("an ended app session's lead leaves at once; one resumed in a living app session stays", () => {
  const city = new City()
  idleSession(city, 'S1', T0)
  city.world.appSessions = [{ id: 'app1', sessionId: 'S1', cwd: HOME, title: 't', level: 'ask', model: 'default', status: 'idle', startedAt: T0, lastAt: T0 }]
  city.flush(T0 + 1000)
  assert.equal(lead(city, 'S1')?.status, 'idle', 'a living app session keeps its lead')

  city.world.appSessions[0]!.status = 'ended'
  city.flush(T0 + 2000)
  assert.equal(lead(city, 'S1')?.status, 'leaving')
  assert.equal(city.world.sessions.length, 0)
  assert.equal(city.world.appSessions.length, 1, 'the app session stays listed')

  // Resumed: a new app session on the same Claude session id, alive.
  const city2 = new City()
  idleSession(city2, 'S2', T0)
  city2.world.appSessions = [
    { id: 'old', sessionId: 'S2', cwd: HOME, title: 't', level: 'ask', model: 'default', status: 'ended', startedAt: T0, lastAt: T0 },
    { id: 'new', sessionId: 'S2', cwd: HOME, title: 't', level: 'ask', model: 'default', status: 'working', startedAt: T0, lastAt: T0 },
  ]
  city2.flush(T0 + 1000)
  assert.equal(lead(city2, 'S2')?.status, 'idle')
})

test('SessionEnd sends the whole session to the train', () => {
  const city = new City()
  workingSession(city, 'S1', T0)
  city.apply(ev('SubagentStart', 'S1', { agent_id: 'a1' }), T0 + 1000)
  city.apply(ev('SessionEnd', 'S1'), T0 + 2000)
  assert.equal(city.world.sessions.length, 0)
  assert.deepEqual(
    city.world.agents.map(a => a.status),
    ['leaving', 'leaving'],
  )
  // Besides the one the first session arrived on.
  assert.equal(city.world.trains?.filter(t => t.kind !== 'arrive').length, 1, 'one train for the session')
})

test('a session that leaves keeps where its conversation is', () => {
  const city = new City()
  city.apply(ev('SessionStart', 'S1', { transcript_path: 'C:/t/S1.jsonl' }), T0)
  city.apply(ev('SubagentStop', 'S1', { agent_id: 'a1', agent_transcript_path: 'C:/t/a1.jsonl' }), T0 + 500)
  idleSession(city, 'S2', T0)
  city.apply(ev('SessionEnd', 'S1'), T0 + 1000)
  assert.ok(city.sendHome('S2', T0 + 2000))
  assert.equal(city.world.sessions.length, 0)
  assert.deepEqual(city.world.pastSessions?.S1, {
    root: HOME, leftAt: T0 + 1000, transcriptPath: 'C:/t/S1.jsonl', agentTranscripts: { a1: 'C:/t/a1.jsonl' },
  })
  assert.equal(city.world.pastSessions?.S2?.leftAt, T0 + 2000)
  // The most recent 200 are kept, newest last.
  for (let i = 0; i < 205; i++) {
    idleSession(city, `X${i}`, T0 + 3000 + i)
    city.sendHome(`X${i}`, T0 + 3000 + i)
  }
  const ids = Object.keys(city.world.pastSessions ?? {})
  assert.equal(ids.length, 200)
  assert.equal(ids.at(-1), 'X204')
  assert.ok(!ids.includes('S1'), 'the oldest went first')
})

test('a borough packs up after an hour of quiet, and its repository moves straight back in', () => {
  const city = cityWith('Brooklyn')
  idleSession(city, 'S1', T0)
  workingSession(city, 'S2', T0, OTHER)
  const repo = () => city.world.repos.find(r => r.root === OTHER)!
  assert.ok('ok' in city.build({ op: 'movein', id: 'brooklyn', root: OTHER }, T0))
  assert.equal(repo().burb, 'brooklyn')
  assert.equal(city.world.homeRoot, HOME)

  city.apply(ev('Stop', 'S2', { cwd: OTHER }), T0 + MIN)
  // S2's lead leaves on the idle timer first; the borough stays a while longer.
  city.flush(T0 + IDLE_LEAVE + 2 * MIN)
  assert.equal(city.world.sessions.length, 0)
  assert.equal(repo().left, undefined)

  city.flush(T0 + BURB_LEAVE + MIN)
  assert.ok(repo().left, 'packed up')
  assert.equal(repo().burb, 'brooklyn', 'still known, with its old address')
  const svg = renderCity(city.world, T0 + BURB_LEAVE + MIN, {})
  assert.ok(svg.includes('Brooklyn: empty'), 'the houses stay, with an empty sign')

  // Another repository may be moved into the free borough.
  workingSession(city, 'S3', T0 + BURB_LEAVE + 2 * MIN, THIRD)
  assert.ok(city.world.repos.find(r => r.root === THIRD)?.burb.startsWith('@'), 'it waits at the station first')
  assert.ok('ok' in city.build({ op: 'movein', id: 'brooklyn', root: THIRD }, T0 + BURB_LEAVE + 2 * MIN))
  assert.equal(city.world.repos.find(r => r.root === THIRD)?.burb, 'brooklyn')

  // The first one comes back and finds Brooklyn taken, so it waits at the station, announced again.
  city.toasts.length = 0
  city.apply(ev('UserPromptSubmit', 'S2', { cwd: OTHER, prompt: 'again' }), T0 + BURB_LEAVE + 3 * MIN)
  assert.equal(repo().left, undefined)
  assert.ok(repo().burb.startsWith('@'))
  assert.ok(city.toasts.some(t => t.includes('arrived at Grand Central')))
})

test('a repository moving back in takes its old borough when it is still free', () => {
  const city = cityWith('Brooklyn')
  idleSession(city, 'S1', T0)
  workingSession(city, 'S2', T0, OTHER)
  assert.ok('ok' in city.build({ op: 'movein', id: 'brooklyn', root: OTHER }, T0))
  city.apply(ev('Stop', 'S2', { cwd: OTHER }), T0 + MIN)
  city.flush(T0 + BURB_LEAVE + MIN)
  const repo = () => city.world.repos.find(r => r.root === OTHER)!
  assert.ok(repo().left)
  city.apply(ev('UserPromptSubmit', 'S2', { cwd: OTHER, prompt: 'again' }), T0 + BURB_LEAVE + 2 * MIN)
  assert.equal(repo().left, undefined)
  assert.equal(repo().burb, 'brooklyn')
})

test('Send home empties a session now, busy or not', () => {
  const city = new City()
  workingSession(city, 'S1', T0)
  city.apply(ev('SubagentStart', 'S1', { agent_id: 'a1' }), T0 + 1000)
  workingSession(city, 'S2', T0)
  assert.equal(city.sendHome('S1', T0 + 2000), true)
  assert.equal(city.sendHome('nope', T0 + 2000), false)
  assert.deepEqual(city.world.agents.filter(a => a.session === 'S1').map(a => a.status), ['leaving', 'leaving'])
  assert.equal(lead(city, 'S2')?.status, 'working', 'the other session is untouched')
  assert.deepEqual(city.world.sessions.map(s => s.id), ['S2'])
})

test('Last call sends everyone idle home and leaves the busy at work', () => {
  const city = new City()
  idleSession(city, 'S1', T0)
  workingSession(city, 'S2', T0)
  city.apply(ev('SubagentStart', 'S2', { agent_id: 'a1' }), T0 + 1000)
  city.apply(ev('SubagentStop', 'S2', { agent_id: 'a1' }), T0 + 2000)
  assert.equal(city.lastCall(T0 + 3000), 2, 'the idle lead and the finished subagent')
  assert.equal(lead(city, 'S1')?.status, 'leaving')
  assert.equal(city.world.agents.find(a => a.id === 'S2:a1')?.status, 'leaving')
  assert.equal(lead(city, 'S2')?.status, 'working')
  assert.deepEqual(city.world.sessions.map(s => s.id), ['S2'])
  assert.equal(city.lastCall(T0 + 4000), 0, 'nobody left to send')
})

test('above the cap, the longest-idle leave first, whatever their timers say', () => {
  const city = new City()
  const n = AGENT_CAP + 3
  for (let i = 0; i < n; i++) idleSession(city, `S${i}`, T0 + i * 1000)
  assert.equal(city.world.agents.length, n)
  city.flush(T0 + n * 1000 + MIN)
  assert.equal(staying(city).length, AGENT_CAP)
  const gone = city.world.agents.filter(a => a.status === 'leaving').map(a => a.session)
  assert.deepEqual(gone.sort(), ['S0', 'S1', 'S2'], 'the three that have waited longest')
  // A full city of busy agents is left alone.
  const busy = new City()
  for (let i = 0; i < n; i++) workingSession(busy, `W${i}`, T0)
  busy.flush(T0 + MIN)
  assert.equal(staying(busy).length, n)
})

test('idle agents fade with age; active ones stay bright', () => {
  const base = { id: 'x', session: 's', name: 'x', kind: 'k', color: '#fff', isMain: true, at: 'hall' as const, shown: { at: 'hall' as const }, activity: '', tools: 0, inFlight: 0, startedAt: T0, updatedAt: T0 }
  assert.equal(opacityFor({ ...base, status: 'working' }, T0 + IDLE_LEAVE), undefined)
  assert.equal(opacityFor({ ...base, status: 'idle' }, T0 + MIN), undefined, 'fresh idle is still bright')
  const mid = opacityFor({ ...base, status: 'idle' }, T0 + 16 * MIN)!
  const late = opacityFor({ ...base, status: 'idle' }, T0 + IDLE_LEAVE)!
  assert.ok(mid < 1 && late < mid, 'dimmer the longer it has been quiet')
  assert.ok(late >= 0.35)
  assert.ok(opacityFor({ ...base, status: 'done', isMain: false }, T0)! > opacityFor({ ...base, status: 'done', isMain: false }, T0 + REST_LEAVE)!)
})

test('the city renders with a train at the platform and then on its way', () => {
  const city = new City()
  idleSession(city, 'S1', T0)
  city.sendHome('S1', T0 + 1000)
  city.flush(T0 + 1000)
  const boarding = renderCity(city.world, T0 + 1500, {})
  assert.ok(boarding.includes('class="train boarding"'))
  assert.ok(boarding.includes('Boarding: home'))
  assert.ok(boarding.includes('class="agent leaving"'), 'the passenger walks to the station')
  const leaveAt = city.world.trains!.find(t => t.kind !== 'arrive')!.leaveAt
  city.flush(leaveAt + 500)
  const rolling = renderCity(city.world, leaveAt + 500, {})
  assert.ok(rolling.includes('class="train leaving"'), 'the train pulls out')
  assert.ok(!rolling.includes('class="agent'), 'nobody is left on the platform')
})

