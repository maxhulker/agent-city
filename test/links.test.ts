import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderFrame } from '../src/city.ts'
import { LIVE_MS } from '../src/draw/links.ts'
import { City, norm } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'
import { cityWith } from './whole.ts'

// Power lines between projects worked on together: a session that started in
// one and worked in the other strings one, a cable for each such session.

const T0 = 1_700_000_000_000

function repo(dir: string, name: string): string {
  const root = join(dir, name)
  mkdirSync(join(root, '.git'), { recursive: true })
  writeFileSync(join(root, 'a.ts'), 'x')
  return norm(root)
}

test('work across two projects strings a power line, one cable per session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-links-'))
  try {
    const home = repo(dir, 'home')
    const api = repo(dir, 'api')
    const city = cityWith('Brooklyn')
    const ev = (name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent => ({ hook_event_name: name, session_id: sid, cwd: home, ...extra })
    const read = (sid: string, file: string, now: number) => {
      const extra = { tool_name: 'Read', tool_use_id: `${sid}${now}`, tool_input: { file_path: file } }
      city.apply(ev('PreToolUse', sid, extra), now)
      city.apply(ev('PostToolUse', sid, { ...extra, tool_response: 'ok' }), now + 5)
    }
    city.apply(ev('SessionStart', 'S1'), T0)
    read('S1', join(home, 'a.ts'), T0 + 10)
    assert.equal(city.world.links, undefined, 'work at home strings nothing')

    read('S1', join(api, 'a.ts'), T0 + 20)
    const links = () => city.world.links ?? []
    assert.equal(links().length, 1)
    assert.deepEqual(links()[0]!.sessions, ['S1'])
    assert.ok(city.toasts.some(t => /Power line strung between (home and api|api and home)/.test(t)))

    read('S1', join(api, 'a.ts'), T0 + 30)
    assert.deepEqual(links()[0]!.sessions, ['S1'], 'the same session adds no cable')
    city.apply(ev('SessionStart', 'S2'), T0 + 40)
    read('S2', join(api, 'a.ts'), T0 + 50)
    assert.deepEqual(links()[0]!.sessions, ['S1', 'S2'])
    assert.equal(links().length, 1, 'one line per pair, whichever end a session starts at')

    // Drawn once both ends have a place: api gets a borough.
    assert.ok(!renderFrame(city.world, T0 + 60).overlay.some(o => o.k.startsWith('link:')), 'api still waits at the station')
    const r = city.build({ op: 'movein', id: 'brooklyn', root: api }, T0 + 70)
    assert.deepEqual(r, { ok: true })
    const lit = renderFrame(city.world, T0 + 80).overlay.find(o => o.k.startsWith('link:'))
    assert.ok(lit, 'a line from City Hall to its borough')
    assert.match(lit!.svg, /Power line: /)
    assert.match(lit!.svg, /stroke-dashoffset/, 'sparks while work crosses it')
    const dim = renderFrame(city.world, T0 + 80 + LIVE_MS).overlay.find(o => o.k.startsWith('link:'))!
    assert.doesNotMatch(dim.svg, /stroke-dashoffset/, 'dark when it is quiet')
    assert.match(dim.svg, /2 sessions started in one worked in the other/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
