import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MAC_SCRIPT } from '../src/notify.ts'

// Crosswalk runs on Windows and macOS (docs/platforms.md). The desktop app
// is the same Electron window on both (desktop/main.mjs); what still
// differs is small and checked here, from either machine.

test('a Mac notification takes its words from the environment, so nothing needs quoting', () => {
  assert.match(MAC_SCRIPT, /^display notification \(system attribute "AGENT_CITY_BODY"\) with title \(system attribute "AGENT_CITY_TITLE"\)$/)
})

test('the desktop app runs the server with its own Node, and stops it when it quits', () => {
  const main = readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8')
  assert.match(main, /ELECTRON_RUN_AS_NODE: '1'/, "Electron's own Node, not a second one")
  assert.match(main, /join\(ROOT, 'src', 'server\.ts'\)/)
  assert.match(main, /server\.send\('shutdown'\)/, 'asked to stop (and save) on quit')
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
  assert.match(server, /process\.on\('message'/, 'the server listens for it')
  assert.match(server, /process\.on\('disconnect', stop\)/, 'and goes when the app is gone')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.main, 'desktop/main.mjs')
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'the server needs nothing installed: Electron is for the app only')
})
