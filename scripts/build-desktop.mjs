// The desktop build, for Steam: Crosswalk with a Node runtime of its own, so
// it runs on a machine with nothing installed.
//
//   node scripts/build-desktop.mjs [out]      (default dist/Crosswalk)
//
// Out comes:
//   Crosswalk.exe   this Node (22.18 or newer), marked as a windowed program
//                   so no console opens; run it with app/src/app.ts
//   app/            src, public, assets, package.json, README.md
//   NODE-LICENSE.txt  Node's license, which must ship with it
//   STEAM.md        the launch option and depot settings for Steamworks
//
// Windows only for now: the launcher opens Edge in app mode, and parts of
// the server (restarts, notifications) are Windows'.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist', 'Crosswalk'))

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`Node ${process.versions.node} can't run TypeScript as it is: build with Node 22.18 or newer.`)
  process.exit(1)
}
if (process.platform !== 'win32') {
  console.error('The desktop build is Windows-only for now.')
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'app'), { recursive: true })
for (const part of ['src', 'public', 'assets']) cpSync(join(ROOT, part), join(OUT, 'app', part), { recursive: true })
for (const file of ['package.json', 'README.md']) copyFileSync(join(ROOT, file), join(OUT, 'app', file))

// Node, as a windowed program: the PE header's subsystem from console (3) to
// Windows GUI (2). The same program otherwise; it just opens no console.
const exe = readFileSync(process.execPath)
const pe = exe.readUInt32LE(0x3c)
if (exe.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${process.execPath} is not a Windows program`)
const subsystem = pe + 24 + 68
if (exe.readUInt16LE(subsystem) !== 3) throw new Error(`${process.execPath} is not a console program (subsystem ${exe.readUInt16LE(subsystem)})`)
exe.writeUInt16LE(2, subsystem)
writeFileSync(join(OUT, 'Crosswalk.exe'), exe)

// Node's license ships with Node.
const version = process.versions.node
try {
  const r = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  writeFileSync(join(OUT, 'NODE-LICENSE.txt'), await r.text())
} catch (err) {
  console.warn(`Couldn't fetch Node's license (${err.message}): add NODE-LICENSE.txt from https://github.com/nodejs/node/blob/v${version}/LICENSE before shipping.`)
}

writeFileSync(
  join(OUT, 'STEAM.md'),
  `# Crosswalk on Steam: build settings

Built ${new Date().toISOString().slice(0, 10)} with Node ${version}.

## Launch options (Steamworks: Installation > General Installation)

| | Executable | Arguments | Description |
|---|---|---|---|
| 1 | \`Crosswalk.exe\` | \`app/src/app.ts\` | Launch Crosswalk |
| 2 | \`Crosswalk.exe\` | \`app/src/app.ts --demo\` | Launch with the demo city |

Operating system: Windows. Working directory: leave empty (the install folder).

## Depot

Upload this whole folder as the Windows depot's content root.

## What it does on a player's machine

- Keeps its cities in \`%USERPROFILE%\\.agent-city\` (a candidate for Steam Cloud).
- Changes Claude Code's settings only when the player clicks **Connect Claude
  Code** (hooks in \`%USERPROFILE%\\.claude\\settings.json\`, backed up first);
  **Disconnect** on the Blueprints card takes them out again. Uninstalling
  from Steam does not: tell players to Disconnect first.
- Without Claude Code installed, the welcome offers the demo city.
- Listens on 127.0.0.1:4777 only.
`,
)
console.log(`Built ${OUT}`)
console.log(`Try it: "${join(OUT, 'Crosswalk.exe')}" app/src/app.ts   (from ${OUT})`)
