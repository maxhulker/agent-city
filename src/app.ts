import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

import { appBrowser } from './browser.ts'
import { stateDir } from './cities.ts'
import { FALLBACK_MS, GIVE_UP_MS, windowStep, type WindowKind } from './window.ts'

// The desktop app: what the Steam build runs (scripts/build-desktop.mjs).
// Starts the server, unless one already answers on the port, opens Crosswalk
// in a window of its own (a Chromium browser's app mode: Edge, on every
// Windows 10 and 11; on a Mac, Chrome, Edge or Brave if one is installed;
// else the default browser), and quits once that window has closed: nobody has
// watched for a few seconds after someone did. A window that never shows up is
// tried in the default browser, and if nobody watches at all it stops rather
// than run unseen (src/window.ts).
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

function defaultBrowser() {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', ADDRESS]] : process.platform === 'darwin' ? ['open', [ADDRESS]] : ['xdg-open', [ADDRESS]]
  const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true })
  child.on('error', err => console.error(`Couldn't open ${ADDRESS} in the default browser:`, err.message))
  child.unref()
}

// A window of its own: Edge in app mode with a profile of Crosswalk's, so it
// has no tabs or address bar and remembers its size. Else the default browser.
function openWindow(): { kind: WindowKind; child?: ReturnType<typeof spawn> } {
  // For tests of the app itself: whoever watches opens the page.
  if (process.env.AGENT_CITY_NO_WINDOW) return { kind: 'none' }
  const browser = appBrowser()
  if (browser) {
    console.log(`Opening the city's window in ${browser}`)
    const child = spawn(browser, [`--app=${ADDRESS}`, `--user-data-dir=${join(STATE, 'window')}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore', windowsHide: false })
    // A browser that won't start (not an uncaught error, which would stop Crosswalk): the default one.
    child.on('error', err => {
      console.error(`${browser} wouldn't start (${err.message}): opening the default browser`)
      defaultBrowser()
    })
    return { kind: 'app', child }
  }
  console.log(`Opening ${ADDRESS} in the default browser`)
  defaultBrowser()
  return { kind: 'browser' }
}

async function main() {
  if (await answers()) {
    // Crosswalk is running already (another window, or `npm start`): a window onto it.
    console.log(`Crosswalk is already running on ${ADDRESS}: opening a window onto it`)
    const { child } = openWindow()
    if (child) await new Promise(r => child.on('exit', r).on('error', r))
    return
  }
  const server = (await import('./server.ts')) as { watching(): number; shutdown(): void }
  for (let i = 0; i < 50 && !(await answers()); i++) await sleep(100)
  const startedAt = Date.now()
  const { kind } = openWindow()
  let seen = false
  let quietSince = 0
  let triedDefault = false
  for (;;) {
    await sleep(1000)
    if (server.watching() > 0) {
      seen = true
      quietSince = 0
    } else if (seen) {
      quietSince ||= Date.now()
    }
    const step = windowStep({ now: Date.now(), startedAt, window: kind, seen, quietSince, triedDefault })
    if (step === 'default-browser') {
      console.warn(`Nobody is watching ${FALLBACK_MS / 1000} s after opening the window: opening the default browser too`)
      triedDefault = true
      defaultBrowser()
    } else if (step === 'give-up') {
      console.warn(`Nobody watched the city in ${GIVE_UP_MS / 60_000} minutes: Crosswalk is stopping (open it again to retry)`)
      break
    } else if (step === 'quit') {
      console.log('The window closed: Crosswalk is stopping')
      break
    }
  }
  server.shutdown()
  process.exit(0)
}

main().catch(err => {
  console.error('agent-city: the app could not start:', err)
  process.exit(1)
})
