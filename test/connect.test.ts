import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hooksInstalled, setHooks } from '../src/install.ts'
import type { CityConf } from '../src/cities.ts'

// Connect and Disconnect on the page (POST /connect) do what `npm run
// connect` does: Crosswalk's hooks in, everything else kept, the file as it
// was backed up once; and out again.

test('Connect adds the hooks and keeps the rest; Disconnect takes them out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-connect-'))
  try {
    const config = join(dir, '.claude')
    mkdirSync(config)
    const path = join(config, 'settings.json')
    writeFileSync(path, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }))
    const conf: CityConf = { id: 'home', name: 'Home', config, ownFolder: false, accounts: [], color: '#fff' }

    const on = setHooks(conf)
    assert.equal(on.path, path)
    assert.ok(hooksInstalled(path), 'connected')
    assert.ok(on.backup && existsSync(on.backup), 'the file as it was, backed up')
    const kept = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(kept.model, 'opus', 'other settings stay')
    assert.ok(kept.hooks.Stop.some((g: { hooks: { command?: string }[] }) => g.hooks.some(h => h.command === 'echo mine')), 'and other hooks')
    assert.ok(kept.statusLine, 'a status line, there being none')

    // Again: no second backup, no doubled hooks.
    const again = setHooks(conf)
    assert.equal(again.backup, undefined)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).hooks.SessionStart.length, 1)

    const off = setHooks(conf, { uninstall: true })
    assert.match(off.message, /Removed/)
    assert.equal(hooksInstalled(path), false, 'disconnected')
    const after = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(after.model, 'opus')
    assert.equal(after.statusLine, undefined, 'our status line went too')
    assert.ok(after.hooks.Stop.length === 1, 'their own hook stays')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a city claiming an account shares home's hooks: it can't disconnect them alone", () => {
  const conf: CityConf = { id: 'work', name: 'Work', config: tmpdir(), ownFolder: false, accounts: ['me@example.com'], color: '#fff' }
  assert.throws(() => setHooks(conf, { uninstall: true, print: true }), /shares/)
})
