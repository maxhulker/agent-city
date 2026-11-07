// The desktop app, packaged with Electron (desktop/main.mjs) for one
// platform: the window of its own the downloads are built from.
//
//   node scripts/package-app.mjs win32     dist/Crosswalk-win32-x64/Crosswalk.exe (on Windows)
//   node scripts/package-app.mjs darwin    dist/Crosswalk-<version>-mac.zip (on a Mac)
//
// The Mac app is universal (Apple silicon and Intel in one), signed ad hoc
// (so macOS offers Open Anyway rather than calling it damaged) and zipped
// with ditto, which keeps Electron's framework links. Both need a Mac, so
// the Mac build is made there (CI's mac-build job does it on every run).
// The Windows app needs Windows (its icon and details are written into
// Crosswalk.exe).

import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const platform = process.argv[2] ?? process.platform

if (platform !== 'win32' && platform !== 'darwin') {
  console.error('Crosswalk is packaged for win32 (Windows) and darwin (macOS).')
  process.exit(1)
}
if (platform !== process.platform) {
  console.error(`Package the ${platform === 'darwin' ? 'Mac' : 'Windows'} app on ${platform === 'darwin' ? 'a Mac' : 'Windows'} (CI builds both on every run).`)
  process.exit(1)
}

// The Mac's icon: an .icns holding the 512-pixel PNG.
function icns(png) {
  const entry = Buffer.alloc(8)
  entry.write('ic09', 0, 'latin1')
  entry.writeUInt32BE(8 + png.length, 4)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(16 + png.length, 4)
  return Buffer.concat([head, entry, png])
}

mkdirSync(join(DIST, '.cache'), { recursive: true })
let icon = join(ROOT, 'assets', 'agent-city.ico')
if (platform === 'darwin') {
  icon = join(DIST, '.cache', 'Crosswalk.icns')
  writeFileSync(icon, icns(readFileSync(join(ROOT, 'assets', 'icon-512.png'))))
}

const [out] = await packager({
  dir: ROOT,
  out: DIST,
  name: 'Crosswalk',
  executableName: 'Crosswalk',
  platform,
  arch: platform === 'darwin' ? 'universal' : 'x64',
  icon,
  appVersion: version,
  buildVersion: version,
  appBundleId: 'io.github.maxhulker.crosswalk',
  appCategoryType: 'public.app-category.developer-tools',
  darwinDarkModeSupport: true,
  win32metadata: { ProductName: 'Crosswalk', FileDescription: 'Crosswalk', InternalName: 'Crosswalk', OriginalFilename: 'Crosswalk.exe' },
  // The server reads its files from disk (and runs as plain Node): no asar.
  asar: false,
  overwrite: true,
  prune: true,
  // Only what the app runs: the server, its page and assets, the desktop shell.
  // The server needs nothing installed (Electron is the app's alone).
  ignore: [/^\/(test|docs|dist|scripts|installer|node_modules|\.github|\.claude)(\/|$)/, /^\/CLAUDE\.md$/, /^\/\.git/],
})
console.log(`Packaged ${out}`)

// Crosswalk speaks English only: Chromium's other languages stay out.
if (platform === 'win32') {
  const locales = join(out, 'locales')
  for (const file of readdirSync(locales)) if (file !== 'en-US.pak') rmSync(join(locales, file))
}

if (platform === 'darwin') {
  const app = join(out, 'Crosswalk.app')
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  const zip = join(DIST, `Crosswalk-${version}-mac.zip`)
  rmSync(zip, { force: true })
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], { stdio: 'inherit' })
  console.log(`Built ${zip}`)
}
