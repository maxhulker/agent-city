import test from 'node:test'
import assert from 'node:assert/strict'

import { FALLBACK_MS, GIVE_UP_MS, QUIT_MS, windowStep, type WindowKind } from '../src/window.ts'

// The desktop app never runs unseen: on a tester's Mac it started, no window
// showed, and it sat there with no Dock icon until opening it again failed.

const at = (secondsIn: number, more: Partial<Parameters<typeof windowStep>[0]> = {}) =>
  windowStep({ now: 1_000_000 + secondsIn * 1000, startedAt: 1_000_000, window: 'app' as WindowKind, seen: false, quietSince: 0, triedDefault: false, ...more })

test('an app window nobody watches: the default browser, once, then stop', () => {
  assert.equal(at(5), 'wait')
  assert.equal(at(FALLBACK_MS / 1000), 'default-browser')
  assert.equal(at(FALLBACK_MS / 1000 + 1, { triedDefault: true }), 'wait', 'only once')
  assert.equal(at(GIVE_UP_MS / 1000, { triedDefault: true }), 'give-up')
})

test('the default browser nobody watches: no second try, stop in the end', () => {
  assert.equal(at(FALLBACK_MS / 1000, { window: 'browser' }), 'wait')
  assert.equal(at(GIVE_UP_MS / 1000, { window: 'browser' }), 'give-up')
})

test('no window (whoever runs it watches, as CI does): it waits', () => {
  assert.equal(at(GIVE_UP_MS / 1000 * 10, { window: 'none' }), 'wait')
})

test('once watched: it runs as long as someone watches, and quits after they leave', () => {
  assert.equal(at(GIVE_UP_MS / 1000 * 10, { seen: true }), 'wait', 'watched for hours')
  const left = 1_000_000 + 600_000
  assert.equal(at(600 + QUIT_MS / 1000 - 1, { seen: true, quietSince: left }), 'wait', 'a reload reconnects in time')
  assert.equal(at(600 + QUIT_MS / 1000, { seen: true, quietSince: left }), 'quit')
})
