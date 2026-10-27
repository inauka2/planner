// Generates the app icons (PNG + SVG) with no dependencies: `npm run icons`
// Design: a yellow calendar outline with a dot grid on a black background.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0, 0, 0];
const FG = [242, 201, 76]; // #F2C94C

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sdBox = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// Shape in unit coordinates (0..1), centred at 0.5
function inside(x, y) {
  const body = sdBox(x, y, 0.5, 0.53, 0.28, 0.26, 0.07);
  if (Math.abs(body + 0.0225) < 0.0225) return true; // outline
  if (body < 0 && y < 0.37) return true; // header band
  for (const rx of [0.37, 0.63]) if (sdBox(x, y, rx, 0.25, 0.025, 0.07, 0.025) < 0) return true; // rings
  const dots = [[0.37, 0.5], [0.5, 0.5], [0.63, 0.5], [0.37, 0.64], [0.5, 0.64]];
  for (const [dx, dy] of dots) if (Math.hypot(x - dx, y - dy) < 0.035) return true;
  return false;
}

function render(size, scale = 1) {
  const S = 4; // supersampling
  return png(size, (px, py) => {
    let hit = 0;
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const u = ((px + (i + 0.5) / S) / size - 0.5) / scale + 0.5;
      const v = ((py + (j + 0.5) / S) / size - 0.5) / scale + 0.5;
      if (inside(u, v)) hit++;
    }
    const a = hit / (S * S);
    return BG.map((b, k) => Math.round(b + (FG[k] - b) * a));
  });
}

const out = (f) => new URL(`../icons/${f}`, import.meta.url);
writeFileSync(out('apple-touch-icon.png'), render(180));
writeFileSync(out('icon-192.png'), render(192));
writeFileSync(out('icon-512.png'), render(512));
writeFileSync(out('icon-maskable-512.png'), render(512, 0.78));
writeFileSync(out('icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#000"/>
<g fill="#F2C94C"><path fill-rule="evenodd" d="M29 27h42a7 7 0 0 1 7 7v38a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7V34a7 7 0 0 1 7-7zm-2.5 10v35a2.5 2.5 0 0 0 2.5 2.5h42a2.5 2.5 0 0 0 2.5-2.5V37z"/>
<rect x="34.5" y="18" width="5" height="14" rx="2.5"/><rect x="60.5" y="18" width="5" height="14" rx="2.5"/>
<circle cx="37" cy="50" r="3.5"/><circle cx="50" cy="50" r="3.5"/><circle cx="63" cy="50" r="3.5"/><circle cx="37" cy="64" r="3.5"/><circle cx="50" cy="64" r="3.5"/></g></svg>
`);
console.log('Icons written to icons/');
