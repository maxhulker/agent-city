// Crosswalk's desktop app: a window of its own (Electron), on Windows and
// macOS alike. It starts the server (src/server.ts) with Electron's own Node,
// unless one already answers on the port, and shows the city in a window
// of its own: its own name and icon in the taskbar and Dock, a menu bar on
// the Mac. Closing the window quits it, and the server it started with it
// (saved first). The server, the city and its page are the same as ever.
//
//   npm run app [-- --demo]            (after npm install)
//   Crosswalk --demo                   the demo city's tab
//   Crosswalk --disconnect             take the hooks out of Claude Code's settings and exit (the uninstaller)
//
// AGENT_CITY_PORT moves it; AGENT_CITY_NO_WINDOW starts the server and no
// window (CI checks a built app that way); AGENT_CITY_SHOT=<file.png> draws
// the window hidden, saves a picture of it after AGENT_CITY_SHOT_DELAY ms
// (8 s by default) and quits (CI keeps the Mac's and Windows' pictures).

import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.AGENT_CITY_PORT ?? 4777)
const ADDRESS = `http://localhost:${PORT}/`
const STATE = join(homedir(), '.agent-city')
const LOG = join(STATE, 'app.log')
const BOUNDS = join(STATE, 'window.json')
const args = process.argv.slice(app.isPackaged ? 1 : 2)
const isDemo = args.includes('--demo')

mkdirSync(STATE, { recursive: true })
const log = text => {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${text}\n`)
  } catch {
    // A log that can't be written is no reason to stop.
  }
}

// Node, as Electron runs it: for the server and the hooks' installer.
const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }

// ---- --disconnect: the uninstaller's ------------------------------------------

if (args.includes('--disconnect')) {
  const child = spawn(process.execPath, [join(ROOT, 'src', 'install.ts'), '--uninstall'], { env: nodeEnv, stdio: 'ignore', windowsHide: true })
  child.on('exit', code => app.exit(code ?? 0))
  child.on('error', () => app.exit(1))
} else {
  run()
}

function run() {
  // One Crosswalk at a time: a second launch shows the first one's window.
  if (!app.requestSingleInstanceLock()) {
    log('Another Crosswalk is running: it shows its window instead')
    app.quit()
    return
  }

  let server
  let win

  async function answers() {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/state.json`, { signal: AbortSignal.timeout(1000) })
      return r.ok
    } catch {
      return false
    }
  }

  // The server, with Electron's own Node, its output in the log.
  function startServer() {
    log(`Starting the server on ${ADDRESS}`)
    server = spawn(process.execPath, [join(ROOT, 'src', 'server.ts'), ...(isDemo ? ['--demo'] : [])], {
      cwd: ROOT,
      env: nodeEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    for (const stream of [server.stdout, server.stderr]) stream.on('data', d => log(String(d).trimEnd()))
    server.on('exit', code => {
      log(`The server stopped (${code})`)
      server = undefined
    })
  }

  function stopServer() {
    if (!server) return
    // It saves every city first (src/server.ts), then exits.
    try {
      server.send('shutdown')
    } catch {
      server.kill()
    }
  }

  function savedBounds() {
    try {
      return JSON.parse(readFileSync(BOUNDS, 'utf8'))
    } catch {
      return { width: 1440, height: 900 }
    }
  }

  function openWindow() {
    win = new BrowserWindow({
      ...savedBounds(),
      minWidth: 900,
      minHeight: 600,
      title: 'Crosswalk',
      backgroundColor: '#0b1224',
      icon: join(ROOT, 'assets', 'icon-512.png'),
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    })
    // A picture for CI is taken of the window unseen.
    win.once('ready-to-show', () => {
      if (!process.env.AGENT_CITY_SHOT) win.show()
    })
    win.on('close', () => {
      try {
        writeFileSync(BOUNDS, JSON.stringify(win.getBounds()))
      } catch {
        // Next time it opens at the usual size.
      }
    })
    // The city's own pages (a billboard's local server, a deploy) open in a
    // window of their own when they are on this machine, else in the browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)
      if (local) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#0b1224' } }
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    win.loadURL(isDemo ? `${ADDRESS}?city=demo` : ADDRESS)
  }

  // A menu bar on the Mac (with Edit, so copy and paste work in the page);
  // on Windows the same shortcuts, the bar itself hidden.
  function menu() {
    const mac = process.platform === 'darwin'
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(mac ? [{ role: 'appMenu' }] : []),
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
        },
        { role: 'windowMenu' },
      ]),
    )
  }

  // Opened again while it runs (a second double-click; on the Mac, the Dock
  // or Finder): the window comes forward, or back if it was closed.
  const reopen = how => {
    log(`Opened again (${how}): showing the window`)
    if (process.env.AGENT_CITY_NO_WINDOW) return
    if (!win || win.isDestroyed()) return openWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  app.on('second-instance', () => reopen('a second launch'))
  // (Not while starting: macOS activates a new app as it launches.)
  let started = false
  app.on('activate', () => {
    if (started) reopen('activate')
  })

  // Closing the window quits, on the Mac too: there is nothing to keep open.
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', stopServer)

  app.whenReady().then(async () => {
    app.setName('Crosswalk')
    menu()
    if (!(await answers())) {
      startServer()
      for (let i = 0; i < 100 && !(await answers()); i++) await new Promise(r => setTimeout(r, 150))
      if (!(await answers())) {
        log('The server did not answer')
        dialog.showErrorBox('Crosswalk could not start', `Its server didn't answer on port ${PORT}. What it printed is in ${LOG}.`)
        stopServer()
        app.exit(1)
        return
      }
    } else {
      log(`Crosswalk is already running on ${ADDRESS}: a window onto it`)
    }
    started = true
    // From here on, opening it again brings the window back (CI waits for this).
    log('Ready')
    if (process.env.AGENT_CITY_NO_WINDOW) return
    openWindow()
    const shot = process.env.AGENT_CITY_SHOT
    if (shot) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const image = await win.webContents.capturePage()
            writeFileSync(shot, image.toPNG())
            log(`Saved a picture of the window: ${shot}`)
          } catch (err) {
            log(`No picture: ${err}`)
          }
          app.quit()
        }, Number(process.env.AGENT_CITY_SHOT_DELAY ?? 8000))
      })
    }
  })
}
