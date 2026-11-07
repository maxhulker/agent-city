import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

import { appBrowser } from './browser.ts'
import { stateDir } from './cities.ts'

// The desktop app: what the Steam build runs (scripts/build-desktop.mjs).
// Starts the server, unless one already answers on the port, opens Crosswalk
// in a window of its own (a Chromium browser's app mode: Edge, on every
// Windows 10 and 11; on a Mac, Chrome, Edge or Brave if one is installed;
// else the default browser), and quits once that window has closed: nobody has
// watched for a few seconds after someone did.
//
//   node src/app.ts [--demo]

const PORT = Number(process.env.AGENT_CITY_PORT ?? 4777)
const ADDRESS = `http://localhost:${PORT}/`
const STATE = stateDir()
mkdirSync(STATE, { recursive: true })

// The windowed build has no console: what would print goes to a log too.
const LOG = join(STATE, 'app.log')
for (const name of ['log', 'error', 'warn'] as const) {
  const write = console[name].bind(console)
  console[name] = (...args: unknown[]) => {
    try {
      appendFileSync(LOG, `${new Date().toISOString()} ${name === 'log' ? '' : `${name}: `}${format(...args)}\n`)
    } catch {
      // A log that can't be written is no reason to stop.
    }
    try {
      write(...args)
    } catch {
      // No console to write to.
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function answers(): Promise<boolean> {
  try {
    const r = await fetch(`${ADDRESS}state.json`, { signal: AbortSignal.timeout(1000) })
    return r.ok
  } catch {
    return false
  }
}

// A window of its own: Edge in app mode with a profile of Crosswalk's, so it
// has no tabs or address bar and remembers its size. Else the default browser.
function openWindow(): ReturnType<typeof spawn> | undefined {
  // For tests of the app itself: whoever watches opens the page.
  if (process.env.AGENT_CITY_NO_WINDOW) return undefined
  const browser = appBrowser()
  if (browser) {
    return spawn(browser, [`--app=${ADDRESS}`, `--user-data-dir=${join(STATE, 'window')}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore', windowsHide: false })
  }
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', ADDRESS]] : process.platform === 'darwin' ? ['open', [ADDRESS]] : ['xdg-open', [ADDRESS]]
  spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).unref()
  return undefined
}

async function main() {
  if (await answers()) {
    // Crosswalk is running already (another window, or `npm start`): a window onto it.
    console.log(`Crosswalk is already running on ${ADDRESS}: opening a window onto it`)
    const win = openWindow()
    if (win) await new Promise(r => win.on('exit', r))
    return
  }
  const server = (await import('./server.ts')) as { watching(): number; shutdown(): void }
  for (let i = 0; i < 50 && !(await answers()); i++) await sleep(100)
  openWindow()
  // Quit once the window has closed: someone watched, and for ten seconds
  // nobody has (a reload reconnects well within that).
  let seen = false
  let quietSince = 0
  for (;;) {
    await sleep(1000)
    const n = server.watching()
    if (n > 0) {
      seen = true
      quietSince = 0
      continue
    }
    if (!seen) continue
    quietSince ||= Date.now()
    if (Date.now() - quietSince >= 10_000) break
  }
  console.log('The window closed: Crosswalk is stopping')
  server.shutdown()
  process.exit(0)
}

main().catch(err => {
  console.error('agent-city: the app could not start:', err)
  process.exit(1)
})
