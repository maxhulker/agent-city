import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderFrame } from '../src/city.ts'
import { CensusTaker, REST } from '../src/census.ts'
import { blockTip, weatherOf } from '../src/draw/blocks.ts'
import type { Block } from '../src/types.ts'
import { City } from '../src/world.ts'

// Weathering: a folder no commit has touched in months shows its age, ivy
// first, then boarded windows, then derelict.

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const block = (days: number | undefined, extra: Partial<Block> = {}): Block => ({
  path: 'src', files: 3, bytes: 3000, commits: 0, dirty: 0, ...(days === undefined ? {} : { touchedAt: NOW - days * DAY }), ...extra,
})

test('how weathered a folder is, by days since a commit touched it', () => {
  assert.equal(weatherOf(block(undefined), NOW), 0, 'unknown: fresh')
  assert.equal(weatherOf(block(10), NOW), 0)
  assert.equal(weatherOf(block(60), NOW), 1)
  assert.equal(weatherOf(block(200), NOW), 2)
  assert.equal(weatherOf(block(400), NOW), 3)
  assert.equal(weatherOf(block(400, { dirty: 2 }), NOW), 0, 'someone is working on it')
  assert.equal(weatherOf(block(400, { path: REST }), NOW), 0, 'the smallest folders together have no one age')
  assert.match(blockTip(block(200), NOW).text, /windows are boarded up \(last commit .+\)\. Restore it from its files\./)
  assert.doesNotMatch(blockTip(block(5), NOW).text, /Restore/)
})

test('the census reads when each folder was last committed to, and a borough weathers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-weather-'))
  const now = Date.now()
  const at = (days: number) => new Date(now - days * DAY).toISOString()
  const git = (when: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
  try {
    git(at(500), 'init', '-q')
    mkdirSync(join(dir, 'legacy'))
    writeFileSync(join(dir, 'legacy', 'old.ts'), 'x\n'.repeat(500))
    writeFileSync(join(dir, 'README.md'), '# r\n')
    git(at(500), 'add', '-A')
    git(at(500), 'commit', '-q', '-m', 'Long ago')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'app.ts'), 'y\n'.repeat(300))
    git(at(1), 'add', '-A')
    git(at(1), 'commit', '-q', '-m', 'Yesterday')

    const census = (await new CensusTaker().take(dir, now))!
    const touched = Object.fromEntries(census.blocks.map(b => [b.path, Math.round((now - (b.touchedAt ?? now)) / DAY)]))
    assert.equal(touched.legacy, 500)
    assert.equal(touched[''], 500, "the root's own files: README alone")
    assert.equal(touched.src, 1)

    const city = new City()
    city.apply({ hook_event_name: 'SessionStart', session_id: 'S1', cwd: 'C:/fake/home' }, now)
    city.build({ op: 'movein', id: 'brooklyn', root: dir }, now)
    city.setCensus(dir, census)
    const lit = renderFrame(city.world, now).overlay.find(o => o.k === 'burb:brooklyn')!.svg
    assert.match(lit, /class="weather"/)
    assert.match(lit, /fill="#a16207"/, 'boarded up')
    assert.match(lit, /fill="#0b1020" opacity="\.5"/, 'derelict')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
