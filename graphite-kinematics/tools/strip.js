/* Stitch existing plates side by side, for comparing one parameter's range. */
const fs = require('fs'), zlib = require('zlib');
const writePNG = require('./png.js');
function readPNG(p) {
  const d = fs.readFileSync(p); let i = 8, w = 0, h = 0, idat = [];
  while (i < d.length) {
    const ln = d.readUInt32BE(i), t = d.toString('ascii', i + 4, i + 8);
    if (t === 'IHDR') { w = d.readUInt32BE(i + 8); h = d.readUInt32BE(i + 12); }
    else if (t === 'IDAT') idat.push(d.subarray(i + 8, i + 8 + ln));
    i += 12 + ln;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4); let k = 0;
  let prev = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[k++], line = Buffer.from(raw.subarray(k, k + w * 4)); k += w * 4;
    for (let x = 0; x < w * 4; x++) {
      const a = x >= 4 ? line[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p0 = a + b - c, pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * w * 4); prev = line;
  }
  return { w, h, px: out };
}
const args = process.argv.slice(2);
const out = args[0], files = args.slice(1);
const imgs = files.map(readPNG);
const W = imgs.reduce((a, i) => a + i.w, 0), H = Math.max(...imgs.map(i => i.h));
const sheet = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { sheet[i*4] = 244; sheet[i*4+1] = 241; sheet[i*4+2] = 232; sheet[i*4+3] = 255; }
let x0 = 0;
for (const im of imgs) {
  for (let y = 0; y < im.h; y++)
    sheet.set(im.px.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((y * W) + x0) * 4);
  x0 += im.w;
}
writePNG(out, sheet, W, H);
console.log(files.length + ' plates -> ' + out + '  ' + W + 'x' + H);
