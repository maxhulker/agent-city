// The Mac build to hand over: dist/Crosswalk-<version>-mac.zip, holding
// Crosswalk.app for Apple silicon and Intel Macs alike. It runs on any
// machine (Windows included): no Mac tools are needed to make it.
//
//   node scripts/build-mac.mjs
//
// Inside Crosswalk.app:
//   Contents/MacOS/Crosswalk      a launcher: this Mac's Node, then app/src/app.ts
//   Contents/Resources/node-arm64 Node for Apple silicon } this machine's Node version,
//   Contents/Resources/node-x64   Node for Intel Macs    } from nodejs.org, checksums checked
//   Contents/Resources/app/       src, public, assets, package.json, README.md
//   Contents/Resources/Crosswalk.icns, NODE-LICENSE.txt
//
// The zip keeps the launcher and Node executable (a zip made by Windows'
// own tools wouldn't, and the app wouldn't open). It is unsigned: macOS
// asks to confirm it the first time (docs/platforms.md says how).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync, gunzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const CACHE = join(DIST, '.cache')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NODE = process.versions.node
// Node 24 runs on macOS 13.5 and later.
const MIN_MACOS = '13.5'

const [major, minor] = NODE.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`Node ${NODE} can't run TypeScript as it is: build with Node 22.18 or newer.`)
  process.exit(1)
}

// ---- Node for the Mac, from nodejs.org --------------------------------------

async function fetchBuffer(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

// One file out of a tar: the entry whose name ends with `suffix`.
function fromTar(tar, suffix) {
  let longName
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512)
    if (header.every(b => b === 0)) break
    const field = (from, len) => header.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    longName = undefined
    const body = tar.subarray(at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
    // A pax header may carry the next entry's long name.
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))
      if (m) longName = m[1]
      continue
    }
    if ((type === '0' || type === '') && name.endsWith(suffix)) return Buffer.from(body)
  }
  throw new Error(`No ${suffix} in the archive`)
}

async function macNode(arch) {
  mkdirSync(CACHE, { recursive: true })
  const cached = join(CACHE, `node-v${NODE}-darwin-${arch}`)
  if (existsSync(cached)) return readFileSync(cached)
  const base = `https://nodejs.org/dist/v${NODE}`
  const file = `node-v${NODE}-darwin-${arch}.tar.gz`
  const sums = (await fetchBuffer(`${base}/SHASUMS256.txt`)).toString('utf8')
  const want = sums.split('\n').find(l => l.endsWith(`  ${file}`))?.split(' ')[0]
  if (!want) throw new Error(`nodejs.org lists no ${file}`)
  console.log(`Downloading ${file}`)
  const gz = await fetchBuffer(`${base}/${file}`)
  const got = createHash('sha256').update(gz).digest('hex')
  if (got !== want) throw new Error(`${file}: checksum ${got}, nodejs.org says ${want}`)
  const node = fromTar(gunzipSync(gz), '/bin/node')
  writeFileSync(cached, node)
  return node
}

// ---- the icon: an .icns holding the 512-pixel PNG -----------------------------

function icns(png) {
  const entry = Buffer.alloc(8)
  entry.write('ic09', 0, 'latin1')
  entry.writeUInt32BE(8 + png.length, 4)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(16 + png.length, 4)
  return Buffer.concat([head, entry, png])
}

// ---- a zip that keeps Unix permissions ----------------------------------------

function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const { name, data, mode } of entries) {
    const isDir = name.endsWith('/')
    const raw = isDir ? Buffer.alloc(0) : data
    const packed = isDir ? raw : deflateRawSync(raw, { level: 9 })
    const crc = isDir ? 0 : crc32(raw)
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // names in UTF-8
    local.writeUInt16LE(isDir ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // made by Unix, so the mode below counts
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(isDir ? 0 : 8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE((((isDir ? 0o040000 : 0o100000) | mode) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

// ---- the bundle ----------------------------------------------------------------

const LAUNCHER = `#!/bin/sh
# Crosswalk's launcher: the Node for this Mac (Apple silicon or Intel), then the app.
here="$(cd "$(dirname "$0")/../Resources" && pwd)"
case "$(uname -m)" in
  arm64) node="$here/node-arm64" ;;
  *) node="$here/node-x64" ;;
esac
exec "$node" "$here/app/src/app.ts" "$@"
`

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Crosswalk</string>
  <key>CFBundleDisplayName</key><string>Crosswalk</string>
  <key>CFBundleIdentifier</key><string>io.github.maxhulker.crosswalk</string>
  <key>CFBundleExecutable</key><string>Crosswalk</string>
  <key>CFBundleIconFile</key><string>Crosswalk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>${MIN_MACOS}</string>
  <!-- The launcher has no window of its own (the city's is a browser's): no Dock icon for it. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
`

const entries = []
const add = (name, data, mode = 0o644) => entries.push({ name, data, mode })
const dirs = new Set()
const addDirs = name => {
  const parts = name.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    const d = parts.slice(0, i).join('/') + '/'
    if (!dirs.has(d)) {
      dirs.add(d)
      entries.push({ name: d, data: Buffer.alloc(0), mode: 0o755 })
    }
  }
}
const put = (name, data, mode) => {
  addDirs(name)
  add(name, data, mode)
}

const APP = 'Crosswalk.app/Contents'
put(`${APP}/Info.plist`, Buffer.from(plist))
put(`${APP}/MacOS/Crosswalk`, Buffer.from(LAUNCHER), 0o755)
put(`${APP}/Resources/Crosswalk.icns`, icns(readFileSync(join(ROOT, 'assets', 'icon-512.png'))))
for (const arch of ['arm64', 'x64']) put(`${APP}/Resources/node-${arch}`, await macNode(arch), 0o755)
const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
for (const part of ['src', 'public', 'assets']) {
  for (const file of walk(join(ROOT, part))) put(`${APP}/Resources/app/${relative(ROOT, file).split('\\').join('/')}`, readFileSync(file))
}
for (const file of ['package.json', 'README.md']) put(`${APP}/Resources/app/${file}`, readFileSync(join(ROOT, file)))
try {
  put(`${APP}/Resources/NODE-LICENSE.txt`, await fetchBuffer(`https://raw.githubusercontent.com/nodejs/node/v${NODE}/LICENSE`))
} catch (err) {
  console.warn(`Couldn't fetch Node's license (${err.message}): add it before shipping.`)
}

mkdirSync(DIST, { recursive: true })
const out = join(DIST, `Crosswalk-${version}-mac.zip`)
writeFileSync(out, zip(entries))
console.log(`Built ${out} (${Math.round(statSync(out).size / 1e6)} MB; Node ${NODE} for Apple silicon and Intel, macOS ${MIN_MACOS} or later)`)
