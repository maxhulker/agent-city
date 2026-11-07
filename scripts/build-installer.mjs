// The Windows installer to hand over: dist/Crosswalk-Setup-<version>.exe.
//
//   node scripts/build-installer.mjs
//
// Packages the app first (scripts/package-app.mjs win32: Electron, in
// dist/Crosswalk-win32-x64), then compiles
// installer/crosswalk.iss with Inno Setup's ISCC: found through the ISCC
// variable, the PATH, or where Inno Setup 6 installs (get it with
// `winget install JRSoftware.InnoSetup --scope user`).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const SOURCE = join(DIST, 'Crosswalk-win32-x64')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function iscc() {
  if (process.env.ISCC && existsSync(process.env.ISCC)) return process.env.ISCC
  const homes = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'), process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)
  const found = homes.map(h => join(h, 'Inno Setup 6', 'ISCC.exe')).find(p => existsSync(p))
  if (found) return found
  try {
    return execFileSync('where', ['iscc'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || undefined
  } catch {
    return undefined
  }
}

const compiler = iscc()
if (!compiler) {
  console.error("Inno Setup's ISCC.exe isn't here: winget install JRSoftware.InnoSetup --scope user (or set ISCC to its path).")
  process.exit(1)
}

execFileSync(process.execPath, [join(ROOT, 'scripts', 'package-app.mjs'), 'win32'], { stdio: 'inherit' })
execFileSync(compiler, ['/Q', `/DSource=${SOURCE}`, `/DAppVersion=${version}`, `/O${DIST}`, join(ROOT, 'installer', 'crosswalk.iss')], { stdio: 'inherit' })

const out = join(DIST, `Crosswalk-Setup-${version}.exe`)
console.log(`Built ${out} (${Math.round(statSync(out).size / 1e6)} MB)`)
console.log("Unsigned: Windows SmartScreen will say it doesn't recognise it. More info, then Run anyway.")
