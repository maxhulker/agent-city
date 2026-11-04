import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findTranscript, listTranscripts, readConversation } from '../src/transcripts.ts'

test('earlier sessions are listed newest first, with their title, folder and first prompt', () => {
  const config = mkdtempSync(join(tmpdir(), 'agent-city-ls-'))
  try {
    const dir = join(config, 'projects', 'C--work')
    mkdirSync(dir, { recursive: true })
    const line = (o: object) => JSON.stringify(o) + '\n'
    const write = (id: string, lines: object[], at: number) => {
      const file = join(dir, id + '.jsonl')
      writeFileSync(file, lines.map(line).join(''))
      utimesSync(file, at / 1000, at / 1000)
    }
    const a = 'aaaaaaaa-1111-1111-1111-111111111111'
    const b = 'bbbbbbbb-2222-2222-2222-222222222222'
    const c = 'cccccccc-3333-3333-3333-333333333333'
    const d = 'dddddddd-4444-4444-4444-444444444444'
    const e = 'eeeeeeee-5555-5555-5555-555555555555'
    write(a, [
      { type: 'queue-operation', operation: 'enqueue' },
      { type: 'user', cwd: 'C:\\work', message: { content: '<system-reminder>noise</system-reminder>fix the login page' } },
      { type: 'custom-title', customTitle: 'Old name' },
      { type: 'custom-title', customTitle: 'Login page fix' },
    ], 2_000_000_000_000)
    write(b, [{ type: 'user', cwd: 'C:\\work\\api', message: { content: [{ type: 'text', text: 'why is the build red?' }] } }], 2_000_000_100_000)
    write(c, [{ type: 'user', cwd: 'C:\\work', isMeta: true, message: { content: 'only harness' } }], 2_000_000_200_000)
    write(d, [{ type: 'user', cwd: 'C:\\Temp\\probe', message: { content: 'a probe' } }], 2_000_000_300_000)
    write(e, [{ type: 'user', cwd: 'C:\\work', message: { content: 'still running' } }], 2_000_000_400_000)

    const got = listTranscripts(config, { skip: new Set([e]), hideUnder: ['C:\\Temp\\'] })
    assert.deepEqual(got.map(p => [p.id, p.cwd, p.title, p.prompt]), [
      [b, 'C:\\work\\api', '', 'why is the build red?'],
      [a, 'C:\\work', 'Login page fix', 'fix the login page'],
    ], 'newest first; none asked, in the temp folder or skipped are left out')
    assert.equal(got[1].at, 2_000_000_000_000)
    assert.deepEqual(listTranscripts(config, { limit: 1 }).map(p => p.id), [e])
    assert.equal(findTranscript(config, a), join(dir, a + '.jsonl'), 'a listed session can be read')
    assert.deepEqual(listTranscripts(join(config, 'missing')), [])
  } finally {
    rmSync(config, { recursive: true, force: true })
  }
})

test('a session that left before the city kept its transcript is found in the config folder', () => {
  const config = mkdtempSync(join(tmpdir(), 'agent-city-tr-'))
  try {
    const sid = '296b981a-e003-4a4f-8922-754aa791650c'
    mkdirSync(join(config, 'projects', 'C--other'), { recursive: true })
    mkdirSync(join(config, 'projects', 'C--work'), { recursive: true })
    const file = join(config, 'projects', 'C--work', sid + '.jsonl')
    writeFileSync(file, JSON.stringify({ type: 'user', message: { content: 'what did we say?' } }) + '\n')
    assert.equal(findTranscript(config, sid), file)
    assert.deepEqual(readConversation(file).map(e => e.text), ['what did we say?'])
    assert.equal(findTranscript(config, 'aaaaaaaa-0000-0000-0000-000000000000'), '', 'none there')
    assert.equal(findTranscript(config, '../../etc/passwd'), '', 'only a session id')
    assert.equal(findTranscript(join(config, 'missing'), sid), '', 'no folder')
  } finally {
    rmSync(config, { recursive: true, force: true })
  }
})
