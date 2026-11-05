import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FRAMES_MAX, Timelapses, changedBlocks, parseHistory, sample } from '../src/timelapse.ts'
import { framesHouses, stageOf } from '../src/draw/timelapse.ts'
import { cityBuildings, findSite } from '../src/layout.ts'
import type { Census } from '../src/types.ts'
import { City } from '../src/world.ts'

// A borough's time-lapse: its repository's history replayed as the borough it
// would have been at each commit.

const T0 = 1_700_000_000_000

test('history from git log, oldest first, with each commit\'s files', () => {
  const out = '\x01aaa\t1700000000\tAda\tFirst commit\0\nREADME.md\0\x01bbb\t1700000100\tBo\tAdd src\twith a tab\0\nsrc/a.ts\0src/b.ts\0'
  assert.deepEqual(parseHistory(out), [
    { sha: 'aaa', at: 1_700_000_000_000, who: 'Ada', subject: 'First commit', files: ['README.md'] },
    { sha: 'bbb', at: 1_700_000_100_000, who: 'Bo', subject: 'Add src\twith a tab', files: ['src/a.ts', 'src/b.ts'] },
  ])
  assert.deepEqual(parseHistory(''), [])
})

test('a long history is sampled evenly, first and last always in', () => {
  assert.deepEqual(sample(5), [0, 1, 2, 3, 4])
  const s = sample(1000)
  assert.equal(s.length, FRAMES_MAX)
  assert.equal(s[0], 0)
  assert.equal(s.at(-1), 999)
  assert.deepEqual([...s].sort((a, b) => a - b), s, 'in order')
})

const census = (blocks: [string, number, number][]): Census => ({
  at: T0, files: 0, bytes: 0, commits: 0, dirty: 0,
  blocks: blocks.map(([path, files, bytes]) => ({ path, files, bytes, commits: 0, dirty: 0 })),
})

test('the folders that changed between frames', () => {
  const a = census([['src', 2, 100], ['docs', 1, 10]])
  const b = census([['src', 3, 140], ['docs', 1, 10], ['test', 1, 5]])
  assert.deepEqual(changedBlocks(undefined, a), ['src', 'docs'], 'everything is new in the first')
  assert.deepEqual(changedBlocks(a, b), ['test', 'src'], 'the new folder, then the grown one')
  assert.deepEqual(changedBlocks(b, b), [])
  // A merge that touches everything: the new ones, and the two that moved most.
  const before = census([['a', 1, 100], ['b', 1, 100], ['c', 1, 100], ['d', 1, 100]])
  const after = census([['a', 1, 110], ['b', 1, 900], ['c', 1, 50], ['d', 1, 101], ['e', 1, 1]])
  assert.deepEqual(changedBlocks(before, after), ['e', 'b', 'c'])
})

test('a real repository replays commit by commit, and the stage draws each frame', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-timelapse-'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore' })
  try {
    git('init', '-q')
    writeFileSync(join(dir, 'README.md'), '# x\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'Break ground')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1\n'.repeat(400))
    git('add', '-A')
    git('commit', '-q', '-m', 'The app')
    mkdirSync(join(dir, 'test'))
    writeFileSync(join(dir, 'test', 'app.test.ts'), 'test()\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'Its tests')

    const lapses = new Timelapses()
    const frames = (await lapses.of(dir))!
    assert.equal(frames.length, 3)
    assert.deepEqual(frames.map(f => f.subject), ['Break ground', 'The app', 'Its tests'])
    assert.deepEqual(frames.map(f => f.n), [1, 2, 3])
    assert.deepEqual(frames.map(f => f.census.files), [1, 2, 3], 'it grows')
    assert.deepEqual(frames[1]!.changed, ['src'])
    assert.deepEqual(frames[2]!.changed, [], 'today stands finished')
    assert.equal(await lapses.of(dir), frames, 'kept until HEAD moves')
    assert.equal(await new Timelapses().of(tmpdir()), undefined, 'not a repository')

    // On a borough's stage.
    const city = new City()
    city.newMap(1511622721, T0)
    const st = cityBuildings(city.layout, 'station')[0]!
    const site = findSite(city.layout, 10, 8, [st.x + 1, st.y + 2])!
    assert.deepEqual(city.build({ op: 'borough', name: 'Lapse', root: dir, x: site[0], y: site[1], w: 10, h: 8, fill: true }, T0), { ok: true })
    const id = city.layout.boroughs.at(-1)!.id
    const stage = stageOf(city.layout, id)!
    assert.match(stage.viewBox, /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/)
    assert.match(stage.ground, /<rect/)
    const first = framesHouses(city.layout, id, frames[0]!.census, frames[0]!.changed)
    const last = framesHouses(city.layout, id, frames[2]!.census, [])
    const walls = (svg: string) => (svg.match(/class="[a-z]L"/g) ?? []).length
    assert.ok(walls(first) > 0 && walls(last) > walls(first), 'more houses at the end than at the start')
    assert.match(first, /scaffold|<line|<path/, 'the first frame goes up in scaffolding')
    assert.equal(stageOf(city.layout, 'nope'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
