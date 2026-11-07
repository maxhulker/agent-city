import test from 'node:test'
import assert from 'node:assert/strict'

import { appBrowser } from '../src/browser.ts'
import { MAC_SCRIPT } from '../src/notify.ts'

// Crosswalk runs on Windows and macOS (docs/platforms.md). What differs is
// small and kept here: the browser that gives the city a window of its own,
// and how a desktop notification is shown.

test("the city's window: Edge on Windows; Chrome, Edge, Brave or Chromium on a Mac; else none", () => {
  const has = (...paths: string[]) => (p: string) => paths.includes(p.split('\\').join('/'))
  const win = { 'ProgramFiles(x86)': 'C:/Program Files (x86)', ProgramFiles: 'C:/Program Files' }
  assert.equal(appBrowser('win32', win, has('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'))?.split('\\').join('/'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
  assert.equal(appBrowser('win32', win, has()), undefined, 'no Edge: the default browser')

  const mac = { HOME: '/Users/me' }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  const brave = '/Users/me/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
  assert.equal(appBrowser('darwin', mac, has(chrome, edge)), chrome, 'Chrome first')
  assert.equal(appBrowser('darwin', mac, has(edge)), edge)
  assert.equal(appBrowser('darwin', mac, has(brave)), brave, "in the person's own Applications too")
  assert.equal(appBrowser('darwin', mac, has()), undefined, 'none: the default browser')
  assert.equal(appBrowser('linux', {}, () => true), undefined)
})

test('a Mac notification takes its words from the environment, so nothing needs quoting', () => {
  assert.match(MAC_SCRIPT, /^display notification \(system attribute "AGENT_CITY_BODY"\) with title \(system attribute "AGENT_CITY_TITLE"\)$/)
})
