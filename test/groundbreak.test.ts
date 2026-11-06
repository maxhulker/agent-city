import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { breakGround, checkGround, foundationsPrompt, projectsDir, slugFor, unbreak } from '../src/groundbreak.ts'
import { cityBuildings, findSite } from '../src/layout.ts'
import { City, norm } from '../src/world.ts'

// Breaking ground: a project that starts in the city, with a folder, a git
// repository holding its brief, a borough and a session to build it.

const SEED = 1511622721
const T0 = 1_700_000_000_000

const tmp = () => mkdtempSync(join(tmpdir(), 'crosswalk-ground-'))
const ok = { name: 'Red Hook', brief: 'A tiny todo app.', level: 'edit' }

test('a project name becomes a folder name', () => {
  assert.equal(slugFor('Red Hook'), 'red-hook')
  assert.equal(slugFor('  Café — Ünïcode!! v2.0 '), 'cafe-unicode-v2.0')
  assert.equal(slugFor('---'), '')
})

test('new projects go beside a repository, or inside a folder of projects', () => {
  const dir = tmp()
  try {
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    assert.equal(projectsDir(repo, '/home/x'), norm(dir), 'beside the repository')
    assert.equal(projectsDir(dir, '/home/x'), norm(dir), 'a plain folder holds them')
    assert.equal(projectsDir(undefined, dir), norm(dir), 'no home repository yet: the user folder')
    assert.equal(projectsDir(join(dir, 'gone'), dir), norm(dir), 'a home repository that is gone: the user folder')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('what the page sends is checked before anything is made', () => {
  const dir = tmp()
  try {
    const g = checkGround({ ...ok, parent: dir }, '/nowhere')
    assert.equal(g.path, norm(join(dir, 'red-hook')))
    assert.equal(checkGround({ ...ok, folder: 'hook_2' }, dir).path, norm(join(dir, 'hook_2')), 'the fallback parent')
    const err = (args: Record<string, unknown>) => {
      try {
        checkGround({ ...ok, parent: dir, ...args }, dir)
        return ''
      } catch (e) {
        return (e as Error).message
      }
    }
    assert.match(err({ name: ' ' }), /Name the project/)
    assert.match(err({ brief: '' }), /brief/)
    assert.match(err({ brief: 'x'.repeat(8001) }), /longer/)
    assert.match(err({ level: 'god' }), /level/)
    assert.match(err({ parent: 'relative/path' }), /full path/)
    assert.match(err({ parent: join(dir, 'missing') }), /not a folder/)
    for (const folder of ['../escape', 'a/b', 'a\\b', '.hidden', 'trailing.', 'con', 'NUL.txt', 'has space']) {
      assert.match(err({ folder }), /folder name/, folder)
    }
    mkdirSync(join(dir, 'taken'))
    assert.match(err({ folder: 'taken' }), /already exists/)
    assert.equal(existsSync(join(dir, 'red-hook')), false, 'nothing made')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('breaking ground makes a repository with the brief in CLAUDE.md, and unbreak takes it back', () => {
  const dir = tmp()
  try {
    const g = checkGround({ ...ok, parent: dir }, dir)
    const { committed } = breakGround(g)
    assert.ok(existsSync(join(g.path, '.git')), 'a repository')
    assert.equal(readFileSync(join(g.path, 'CLAUDE.md'), 'utf8'), '# Red Hook\n\nA tiny todo app.\n')
    if (committed) {
      const files = execFileSync('git', ['ls-tree', '--name-only', 'HEAD'], { cwd: g.path, encoding: 'utf8' })
      assert.equal(files.trim(), 'CLAUDE.md', 'the first house: its brief')
    }
    assert.match(foundationsPrompt(g), /brand-new project, "Red Hook"[\s\S]*Commit once the first version works[\s\S]*A tiny todo app\.$/)
    unbreak(g)
    assert.equal(existsSync(g.path), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a new project gets a borough drawn for it, or one nobody lives in, and moves in', () => {
  const city = new City()
  assert.deepEqual(city.newMap(SEED, T0 - 1000), { ok: true })
  const st = cityBuildings(city.layout, 'station')[0]!
  const site = findSite(city.layout, 10, 8, [st.x + 1, st.y + 2])!
  const root = 'C:/fake/red-hook'
  const r = city.groundFor(root, 'Red Hook', { x: site[0], y: site[1], w: 10, h: 8, fill: true }, T0)
  const bo = city.layout.boroughs.at(-1)!
  assert.deepEqual(r, { ok: true, borough: 'Red Hook', id: bo.id, drawn: true })
  const repo = city.world.repos.find(x => x.root === root)!
  assert.equal(repo.burb, bo.id, 'moved in')
  assert.ok(city.world.layout!.zoned.length > 0, 'streets and lots laid')
  assert.ok(city.toasts.includes('Ground broken for Red Hook'))
  assert.ok(!city.toasts.some(t => /moved into/.test(t)), 'one line, not two')

  // That borough is taken now; another drawn and left empty takes the next one.
  assert.match((city.groundFor('C:/fake/other', 'Other', { id: bo.id }, T0 + 10) as { error: string }).error, /Red Hook's|red-hook's/)
  const site2 = findSite(city.layout, 10, 8, [st.x + 1, st.y + 2])!
  assert.deepEqual(city.build({ op: 'borough', name: 'Gowanus', x: site2[0], y: site2[1], w: 10, h: 8 }, T0 + 20), { ok: true })
  const empty = city.layout.boroughs.at(-1)!
  assert.deepEqual(city.groundFor('C:/fake/canal', 'Canal', { id: empty.id }, T0 + 30), { ok: true, borough: 'Gowanus', id: empty.id, drawn: false })
  assert.ok(city.toasts.includes('Ground broken for Canal in Gowanus'))
  assert.equal(city.world.repos.find(x => x.root === 'C:/fake/canal')!.burb, empty.id)
  assert.match((city.groundFor('C:/fake/x', 'X', { id: 'nope' }, T0 + 40) as { error: string }).error, /No such borough/)
  assert.ok('error' in city.groundFor('C:/fake/y', 'Y', { x: 0, y: 0, w: 1, h: 1 }, T0 + 50), 'a rectangle the rules refuse')
})
