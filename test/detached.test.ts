import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SHOW_HIDDEN, launchDetached, launchScript } from '../src/detached.ts'
import { relaunchLine } from '../src/updates.ts'

// A process started to outlive its starter: through WMI on Windows.

test('the launch script quotes what it is given, and waits first when asked', () => {
  const s = launchScript(`cmd.exe /c title Crosswalk & "C:\\node.exe" "C:\\it's here\\server.ts"`, "C:\\it's here", 2)
  assert.match(s, /^Start-Sleep -Seconds 2\n/)
  assert.match(s, /CommandLine = 'cmd\.exe \/c title Crosswalk & "C:\\node\.exe" "C:\\it''s here\\server\.ts"'/)
  assert.match(s, /CurrentDirectory = 'C:\\it''s here'/)
  assert.match(s, /ShowWindow = \[uint16\]7/)
  assert.doesNotMatch(launchScript('x', 'y'), /Start-Sleep/)
})

test('a detached launch runs the command on its own', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-detached-'))
  const out = join(dir, 'ran.txt')
  try {
    launchDetached(`"${process.execPath}" -e "require('fs').writeFileSync(process.argv[1], String(process.ppid))" "${out}"`, tmpdir(), 0, SHOW_HIDDEN)
    for (let i = 0; i < 60 && !existsSync(out); i++) await new Promise(r => setTimeout(r, 250))
    assert.ok(existsSync(out), 'it ran')
    // Its parent is the WMI service's, not this test's.
    assert.notEqual(Number(readFileSync(out, 'utf8')), process.pid)
  } finally {
    // It may still be on its way out, holding the file.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test("a relaunched server gets Crosswalk's own settings, through WMI too", { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const line = relaunchLine('C:\node.exe', 'C:\app\src\server.ts', { AGENT_CITY_PORT: '4788', AGENT_CITY_NO_TOAST: '1', CLAUDE_CONFIG_DIR: 'C:\cfg', PATH: 'x', AGENT_CITY_BAD: 'a&b' }, true)
  assert.equal(line, 'cmd.exe /c set "AGENT_CITY_PORT=4788" & set "AGENT_CITY_NO_TOAST=1" & set "CLAUDE_CONFIG_DIR=C:\cfg" & title Crosswalk & "C:\node.exe" "C:\app\src\server.ts"')

  // For real: a stand-in for the server writes down what it was given.
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-relaunch-'))
  const script = join(dir, 'server.mjs')
  const out = join(dir, 'env.json')
  writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify({ port: process.env.AGENT_CITY_PORT, toast: process.env.AGENT_CITY_NO_TOAST }))\n`)
  try {
    launchDetached(relaunchLine(process.execPath, script, { AGENT_CITY_PORT: '4799', AGENT_CITY_NO_TOAST: '1' }, true), tmpdir(), 0, SHOW_HIDDEN)
    for (let i = 0; i < 60 && !existsSync(out); i++) await new Promise(r => setTimeout(r, 250))
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { port: '4799', toast: '1' })
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
