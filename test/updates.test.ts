import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toastXml } from '../src/notify.ts'
import { Updates } from '../src/updates.ts'

// Knowing when there is something new: commits on main (a pull and a
// restart), or commits made in this very folder since the server started (a
// restart), each said once with a desktop notification.

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-city-updates-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.txt'), 'one')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'First')
  return dir
}

test('a commit made in the folder after the server started asks for a restart, once', async () => {
  const dir = repo()
  const told: string[][] = []
  let changes = 0
  const u = new Updates(dir, () => changes++, (title, body) => told.push([title, body]))
  await u.init()
  await u.checkLocal(true)
  assert.equal(u.state.restart, undefined, 'nothing new yet')
  writeFileSync(join(dir, 'a.txt'), 'two')
  git(dir, 'commit', '-q', '-am', 'Bigger maps')
  await u.checkLocal(true)
  assert.deepEqual(u.state.restart, { count: 1, latest: 'Bigger maps' })
  assert.equal(changes, 1, 'the city redraws')
  assert.equal(told.length, 1)
  assert.equal(told[0]![0], 'Crosswalk: restart to apply')
  assert.match(told[0]![1], /1 new commit in this copy: Bigger maps/)
  await u.checkLocal(true)
  assert.equal(told.length, 1, 'said once')
  // No origin to pull from: the update is the restart, and apply lets it go ahead.
  await u.apply()
  assert.deepEqual(u.state.restart, { count: 1, latest: 'Bigger maps' })
})

test("the notification's text is XML-safe and a click opens the city", () => {
  const xml = toastXml('Crosswalk <update> & more', 'It\'s "new"', 'http://localhost:4777/')
  assert.ok(xml.includes('launch="http://localhost:4777/"'))
  assert.ok(xml.includes('Crosswalk &lt;update&gt; &amp; more'))
  assert.ok(xml.includes('It&apos;s &quot;new&quot;'))
})
