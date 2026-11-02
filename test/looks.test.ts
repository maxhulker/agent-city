import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { HATS } from '../src/draw/agents.ts'
import { lookOf } from '../src/sessions.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// A session started from the page can be given a name, a colour and a hat:
// checked on the way in, worn by its session and lead whether it is already
// in the city or turns up later, and drawn on the lead's head.

const T0 = 1_700_000_000_000

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: 'C:/fake/home', ...extra }
}

function city(): City {
  const c = new City()
  c.buildAll(T0 - 60_000)
  return c
}

const leadOf = (c: City, sid: string) => c.world.agents.find(a => a.id === `lead:${sid}`)!
const figOf = (c: City, sid: string, now: number) => renderFrame(c.world, now).agents.find(s => s.id === `lead:${sid}`)!.fig.svg

test('lookOf keeps a tidy name, a hex colour and a known hat', () => {
  assert.equal(lookOf(undefined), undefined)
  assert.equal(lookOf({}), undefined)
  assert.equal(lookOf({ name: '   ', color: '', hat: '' }), undefined)
  assert.deepEqual(lookOf({ name: '  Ada \n Lovelace ', color: '#38BDF8', hat: 'wizard' }), { name: 'Ada Lovelace', color: '#38bdf8', hat: 'wizard' })
  assert.deepEqual(lookOf({ name: 'Rex\u0007' }), { name: 'Rex' })
})

test('lookOf refuses what the city cannot draw', () => {
  assert.throws(() => lookOf('red'), /look must be an object/)
  assert.throws(() => lookOf({ color: 'red' }), /color must look like/)
  assert.throws(() => lookOf({ color: '#38bdf8; x' }), /color must look like/)
  assert.throws(() => lookOf({ hat: 'fez' }), /hat must be one of/)
  assert.throws(() => lookOf({ hat: 'toString' }), /hat must be one of/)
  assert.throws(() => lookOf({ name: 'x'.repeat(25) }), /longer than 24/)
  assert.throws(() => lookOf({ name: 42 }), /name must be text/)
})

test('a look picked before the session arrives is worn when it does', () => {
  const c = city()
  c.dress('S1', { name: 'Ada', color: '#c084fc', hat: 'tophat' })
  c.apply(ev('SessionStart', 'S1'), T0)
  const s = c.world.sessions[0]!
  assert.equal(s.name, 'Ada')
  assert.equal(s.color, '#c084fc')
  assert.equal(s.hat, 'tophat')
  assert.equal(leadOf(c, 'S1').name, 'Ada')
  assert.equal(leadOf(c, 'S1').color, '#c084fc')
})

test('a session already in the city changes into its look', () => {
  const c = city()
  c.apply(ev('SessionStart', 'S1'), T0)
  c.apply(ev('UserPromptSubmit', 'S1', { prompt: 'go' }), T0 + 10)
  c.dress('S1', { hat: 'cowboy' })
  const s = c.world.sessions[0]!
  assert.equal(s.name, 'home', 'what was not picked stays as the city chose it')
  assert.equal(s.hat, 'cowboy')
  assert.equal(leadOf(c, 'S1').name, 'home')
})

test('a session sent home comes back in the same look', () => {
  const c = city()
  c.dress('S1', { name: 'Ada', hat: 'chef' })
  c.apply(ev('SessionStart', 'S1'), T0)
  c.sendHome('S1', T0 + 100)
  c.flush(T0 + 600_000)
  assert.equal(c.world.sessions.length, 0)
  c.apply(ev('UserPromptSubmit', 'S1', { prompt: 'again' }), T0 + 700_000)
  assert.equal(c.world.sessions[0]!.name, 'Ada')
  assert.equal(c.world.sessions[0]!.hat, 'chef')
})

test('the lead wears its hat: the crown by default, none when bare', () => {
  const c = city()
  c.apply(ev('SessionStart', 'S1'), T0)
  c.apply(ev('SessionStart', 'S2', { cwd: 'C:/fake/other' }), T0)
  c.dress('S2', { hat: 'wizard' })
  c.flush(T0 + 100)
  assert.ok(figOf(c, 'S1', T0 + 200).includes(HATS.crown.svg))
  const wizard = figOf(c, 'S2', T0 + 200)
  assert.ok(wizard.includes(HATS.wizard.svg))
  assert.ok(!wizard.includes(HATS.crown.svg))
  c.dress('S2', { hat: 'none' })
  assert.ok(!figOf(c, 'S2', T0 + 300).includes(HATS.crown.svg))
})
