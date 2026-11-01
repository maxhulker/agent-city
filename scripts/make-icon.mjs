// Draws the Agent City icon (an isometric tower and a brick block at night)
// and writes it as a multi-size .ico, with no dependencies.
import { writeFileSync } from 'node:fs'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// Isometric point: gx right-down, gy left-down, z up; unit space 0..1.
const S = 0.13
const T = 0.065
const iso = (gx, gy, z = 0) => [0.5 + (gx - gy) * S, 0.7 + (gx + gy) * T - z]

function box(x0, y0, w, d, h, [l, r, t]) {
  const a = iso(x0, y0 + d), b = iso(x0 + w, y0 + d), c = iso(x0 + w, y0)
  const up = p => [p[0], p[1] - h]
  const top = [iso(x0, y0, h), iso(x0 + w, y0, h), iso(x0 + w, y0 + d, h), iso(x0, y0 + d, h)]
  return [
    { poly: [a, b, up(b), up(a)], color: hex(l) },
    { poly: [b, c, up(c), up(b)], color: hex(r) },
    { poly: top, color: hex(t) },
  ]
}

function windows(x0, y0, w, d, h, rows, cols, seed) {
  const out = []
  let k = seed
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      k = (k * 9301 + 49297) % 233280
      const lit = k % 3 !== 0
      const z0 = 0.03 + i * (h - 0.05) / rows
      const z1 = z0 + (h - 0.05) / rows * 0.5
      const u0 = (j + 0.25) / cols, u1 = (j + 0.75) / cols
      // Left face.
      const L = (u, z) => iso(x0 + u * w, y0 + d, z)
      out.push({ poly: [L(u0, z0), L(u1, z0), L(u1, z1), L(u0, z1)], color: hex(lit ? '#fcd581' : '#24324d') })
      // Right face.
      const R = (u, z) => iso(x0 + w, y0 + d - u * d, z)
      out.push({ poly: [R(u0, z0), R(u1, z0), R(u1, z1), R(u0, z1)], color: hex(lit ? '#e0b45a' : '#1a2438') })
    }
  }
  return out
}

const shapes = [
  ...box(-1.25, -0.15, 1.0, 1.0, 0.42, ['#1d3557', '#13253f', '#3b5a85']),
  ...windows(-1.25, -0.15, 1.0, 1.0, 0.42, 5, 2, 7),
  ...box(0.3, -0.95, 1.0, 0.9, 0.22, ['#8f3b2a', '#68291c', '#b4553f']),
  ...windows(0.3, -0.95, 1.0, 0.9, 0.22, 2, 2, 3),
]
const spire = iso(-0.75, 0.35, 0.42)
shapes.push({ poly: [[spire[0] - 0.008, spire[1]], [spire[0] + 0.008, spire[1]], [spire[0] + 0.008, spire[1] - 0.09], [spire[0] - 0.008, spire[1] - 0.09]], color: hex('#cbd5e1') })
shapes.push({ circle: [spire[0], spire[1] - 0.1, 0.03], color: hex('#fbbf24') })

function inside(poly, x, y) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

// A rounded square of night sky behind it all.
function background(x, y) {
  const r = 0.2
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r)
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null
  const glow = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.45) / 0.6)
  const base = hex('#0b1226'), lit = hex('#3b2a63')
  return base.map((v, i) => Math.round(v + (lit[i] - v) * glow * 0.8))
}

function render(size) {
  const ss = 4
  const px = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (x + (sx + 0.5) / ss) / size, uy = (y + (sy + 0.5) / ss) / size
          let c = background(ux, uy)
          if (!c) continue
          for (const s of shapes) {
            if (s.poly ? inside(s.poly, ux, uy) : (ux - s.circle[0]) ** 2 + (uy - s.circle[1]) ** 2 < s.circle[2] ** 2) c = s.color
          }
          r += c[0]; g += c[1]; b += c[2]; a += 255
        }
      }
      const n = ss * ss, i = (y * size + x) * 4
      const cov = a / n
      px[i] = cov ? Math.round((r / n) * 255 / cov) : 0
      px[i + 1] = cov ? Math.round((g / n) * 255 / cov) : 0
      px[i + 2] = cov ? Math.round((b / n) * 255 / cov) : 0
      px[i + 3] = Math.round(cov)
    }
  }
  return px
}

// One BMP image entry: BITMAPINFOHEADER, BGRA rows bottom-up, empty AND mask.
function bmp(size, px) {
  const maskRow = Math.ceil(size / 32) * 4
  const buf = Buffer.alloc(40 + size * size * 4 + maskRow * size)
  buf.writeUInt32LE(40, 0)
  buf.writeInt32LE(size, 4)
  buf.writeInt32LE(size * 2, 8)
  buf.writeUInt16LE(1, 12)
  buf.writeUInt16LE(32, 14)
  buf.writeUInt32LE(size * size * 4 + maskRow * size, 20)
  let o = 40
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      buf[o++] = px[i + 2]; buf[o++] = px[i + 1]; buf[o++] = px[i]; buf[o++] = px[i + 3]
    }
  }
  return buf
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(s => bmp(s, render(s)))
const head = Buffer.alloc(6 + 16 * sizes.length)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(sizes.length, 4)
let offset = head.length
sizes.forEach((s, k) => {
  const e = 6 + k * 16
  head[e] = s === 256 ? 0 : s
  head[e + 1] = s === 256 ? 0 : s
  head.writeUInt16LE(1, e + 4)
  head.writeUInt16LE(32, e + 6)
  head.writeUInt32LE(images[k].length, e + 8)
  head.writeUInt32LE(offset, e + 12)
  offset += images[k].length
})
writeFileSync(process.argv[2], Buffer.concat([head, ...images]))

// A preview of the 256 size as an uncompressed BMP file, to look at.
const prev = bmp(256, render(256))
const file = Buffer.alloc(14)
file.write('BM', 0)
file.writeUInt32LE(14 + 40 + 256 * 256 * 4, 2)
file.writeUInt32LE(54, 10)
const info = Buffer.from(prev.subarray(0, 40))
info.writeInt32LE(256, 8)
writeFileSync(process.argv[3], Buffer.concat([file, info, prev.subarray(40, 40 + 256 * 256 * 4)]))
console.log('wrote', process.argv[2])
