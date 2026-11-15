// 將 Radiance .hdr 轉成色調映射後的 PNG（網頁版環境光備援用）
const fs = require('fs'), zlib = require('zlib');
const [, , src, dst, expo = '1.0'] = process.argv;
const buf = fs.readFileSync(src); let pos = 0;
const line = () => { let s = ''; while (buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]); pos++; return s; };
let l; while ((l = line()) !== '') { }
const dim = line().match(/-Y (\d+) \+X (\d+)/); const H = +dim[1], W = +dim[2];
const out = Buffer.alloc(W * H * 3); const sc = new Uint8Array(W * 4);
for (let y = 0; y < H; y++) {
  if (buf[pos] === 2 && buf[pos + 1] === 2) {
    pos += 4;
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < W) { let n = buf[pos++]; if (n > 128) { n -= 128; const v = buf[pos++]; while (n--) sc[(x++) * 4 + c] = v; } else { while (n--) sc[(x++) * 4 + c] = buf[pos++]; } }
    }
  } else { for (let x = 0; x < W; x++) { for (let c = 0; c < 4; c++) sc[x * 4 + c] = buf[pos++]; } }
  for (let x = 0; x < W; x++) {
    const e = sc[x * 4 + 3]; const f = e ? Math.pow(2, e - 136) * +expo : 0;
    for (let c = 0; c < 3; c++) { let v = sc[x * 4 + c] * f; v = v / (1 + v); v = Math.pow(v, 1 / 2.2); out[(y * W + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v * 255))); }
  }
}
// PNG 編碼
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; out.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(dst, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', dst, W + 'x' + H);
