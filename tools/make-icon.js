// 產生 256×256 應用程式圖示（橘底、斜置裝甲板、穿甲桿）
const fs = require('fs'), zlib = require('zlib'); const N = 256; const px = Buffer.alloc(N * N * 4);
const set = (x, y, c) => { const o = (y * N + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3]; };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const r = 44, cx = Math.min(Math.max(x, r), N - 1 - r), cy = Math.min(Math.max(y, r), N - 1 - r);
  if (Math.hypot(x - cx, y - cy) > r) { set(x, y, [0, 0, 0, 0]); continue; }
  let c = [240, 162, 58, 255];
  const d = (x * 0.5 - y * 0.866 + 60) ; // 斜置板（約 60°）
  if (d > -10 && d < 30) c = ((x + y) % 14 < 7) ? [70, 78, 88, 255] : [92, 101, 112, 255];
  const ry = 128 + (x - 30) * 0.0, rod = Math.abs(y - 128) < 9 && x > 24 && x < 168;
  if (rod) c = [30, 34, 38, 255];
  if (Math.abs(y - 128) < 18 && x > 24 && x < 52 && Math.abs(y - 128) > 9 && (x - 24) % 10 < 6) c = [30, 34, 38, 255];
  if (x >= 160 && x < 200 && Math.abs(y - 128) < 30 - (x - 160) * 0.6 && Math.random() < 0.6) c = [255, 240, 200, 255];
  set(x, y, c);
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((N * 4 + 1) * N); for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 6;
fs.writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
