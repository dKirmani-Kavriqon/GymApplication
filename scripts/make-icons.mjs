// Generates the app icon, Android adaptive icon, splash image and favicon (no dependencies).
// The mark is the four-point "sparkle" star from the Burgundy & Beige reference: an astroid
// |x|^(2/3) + |y|^(2/3) <= r^(2/3), anti-aliased by supersampling.
//   node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'mobile', 'assets');
const BEIGE = [0xf8, 0xf1, 0xe7];
const BURGUNDY = [0x6b, 0x0f, 0x1a];
const ROSE = [0xb5, 0x4b, 0x6a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function inStar(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx) / r;
  const dy = Math.abs(y - cy) / r;
  return Math.cbrt(dx * dx) + Math.cbrt(dy * dy) <= 1;
}

/** Draws stars [{cx, cy, r, color}] over an optional background, 4× supersampled. */
function render(size, background, stars, h = size) {
  const out = Buffer.alloc(size * h * 4);
  const S = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          const hit = stars.find((s) => inStar(px, py, s.cx, s.cy, s.r));
          const c = hit ? hit.color : background;
          if (c) {
            r += c[0]; g += c[1]; b += c[2]; a += 255;
          }
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      out[i] = alpha ? (r / n) * (255 / alpha) : 0;
      out[i + 1] = alpha ? (g / n) * (255 / alpha) : 0;
      out[i + 2] = alpha ? (b / n) * (255 / alpha) : 0;
      out[i + 3] = alpha;
    }
  }
  return out;
}

const mark = (size, scale = 1) => [
  { cx: size * 0.47, cy: size * 0.53, r: size * 0.34 * scale, color: BURGUNDY },
  { cx: size * 0.75, cy: size * 0.25, r: size * 0.11 * scale, color: ROSE },
];

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon.png', 1024, BEIGE, mark(1024)],
  ['adaptive-icon.png', 1024, null, mark(1024, 0.72)], // Android crops to a circle; keep the mark in the safe zone
  ['splash-icon.png', 512, null, mark(512)],
  ['favicon.png', 48, BEIGE, mark(48)],
];
for (const [name, size, bg, stars] of files) {
  writeFileSync(join(OUT, name), png(size, size, render(size, bg, stars)));
  console.log('wrote', name);
}
