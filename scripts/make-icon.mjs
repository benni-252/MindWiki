// Erzeugt build/icon.png und build/icon.ico (Mind-Map-Symbol) ohne externe Werkzeuge.
// Aufruf: node scripts/make-icon.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const out = path.join(import.meta.dirname, '..', 'build')
fs.mkdirSync(out, { recursive: true })

const ACCENT_TOP = [92, 103, 224]
const ACCENT_BOTTOM = [64, 74, 196]
const CENTER = [0.5, 0.5]
const SATELLITES = [
  [0.215, 0.27],
  [0.785, 0.27],
  [0.785, 0.73],
  [0.215, 0.73]
]

function roundedRectCoverage(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r))
  const dy = Math.max(r - y, 0, y - (1 - r))
  return dx * dx + dy * dy <= r * r
}

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

/** Liefert [r, g, b, a] für einen Abtastpunkt in Einheitskoordinaten. */
function sample(x, y) {
  if (!roundedRectCoverage(x, y, 0.22)) return null
  const white =
    Math.hypot(x - CENTER[0], y - CENTER[1]) <= 0.165 ||
    SATELLITES.some(([sx, sy]) => Math.hypot(x - sx, y - sy) <= 0.088) ||
    SATELLITES.some((s) => segmentDistance(x, y, CENTER, s) <= 0.026)
  if (white) return [255, 255, 255]
  return ACCENT_TOP.map((c, i) => Math.round(c + (ACCENT_BOTTOM[i] - c) * y))
}

function render(size) {
  const ss = size <= 32 ? 6 : 4
  const pixels = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          hits++
        }
      }
      const i = (py * size + px) * 4
      if (hits) {
        pixels[i] = Math.round(r / hits)
        pixels[i + 1] = Math.round(g / hits)
        pixels[i + 2] = Math.round(b / hits)
        pixels[i + 3] = Math.round((255 * hits) / (ss * ss))
      }
    }
  }
  return pixels
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size) {
  const pixels = render(size)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // Bit pro Kanal
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function ico(sizes) {
  const images = sizes.map(png)
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => {
    const e = 6 + i * 16
    header[e] = size >= 256 ? 0 : size
    header[e + 1] = size >= 256 ? 0 : size
    header.writeUInt16LE(1, e + 4) // Farbebenen
    header.writeUInt16LE(32, e + 6) // Bit pro Pixel
    header.writeUInt32LE(images[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

fs.writeFileSync(path.join(out, 'icon.png'), png(512))
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]))
console.log('Icons geschrieben nach', out)
