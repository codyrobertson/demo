/* The standard review sheet: every region, every angle, one image.
   Usage: node tools/sheet.js [seed] [out.png] [cell]

   The figure went wrong for a whole evening because every render was a
   single view of a single region, chosen to show the thing just changed.
   A change that fixes the front of a head can ruin its profile, and the
   render that would say so is exactly the one nobody makes. So: one sheet,
   fixed views, run after every change, looked at whole.

   Each cell is skin.js run as a child process rather than in-process,
   because skin.js is a script with its own argv/env contract and the sheet
   must show exactly what that script produces — not a reimplementation that
   can drift from it. */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const writePNG = require('/home/user/demo/graphite-kinematics/tools/png.js');

const seed = process.argv[2] || '12345';
const out = process.argv[3] || '/tmp/sheet.png';
const CELL = parseInt(process.argv[4] || '440');

// label | az | el | FRAME height band (mm above floor) or null for the whole
const VIEWS = [
  ['front', 180, 0, null], ['three-quarter', 140, 0, null],
  ['side', 90, 0, null], ['back', 0, 0, null],
  ['head front', 180, 0, '1330,1690'], ['head 3q', 140, 0, '1330,1690'],
  ['head side', 90, 0, '1330,1690'], ['head back', 0, 0, '1330,1690'],
  ['torso front', 180, 0, '900,1500'], ['torso side', 90, 0, '900,1500'],
  ['legs front', 180, 0, '30,980'], ['legs side', 90, 0, '30,980'],
];

function readPNG(f) {
  const buf = fs.readFileSync(f);
  let p = 8, w, h; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); }
    if (t === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4 + 1, o = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    const f2 = raw[y * stride], line = raw.subarray(y * stride + 1, y * stride + 1 + w * 4);
    const cur = Buffer.alloc(w * 4);
    for (let x = 0; x < w * 4; x++) {
      const a = x >= 4 ? cur[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (f2 === 1) v += a; else if (f2 === 2) v += b;
      else if (f2 === 3) v += (a + b) >> 1;
      else if (f2 === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    cur.copy(o, y * w * 4); prev = cur;
  }
  return { w, h, o };
}

const COLS = 4;
const rows = Math.ceil(VIEWS.length / COLS);
const big = new Uint8ClampedArray(CELL * COLS * CELL * rows * 4).fill(255);
const W = CELL * COLS;

VIEWS.forEach(([label, az, el, frame], i) => {
  const tmp = `/tmp/_sheet_${i}.png`;
  const env = Object.assign({}, process.env);
  if (frame) env.FRAME = frame; else delete env.FRAME;
  try {
    execFileSync('node', [path.join(__dirname, 'skin.js'), seed, String(az), String(el), tmp, String(CELL)],
      { env, stdio: 'pipe' });
  } catch (e) {
    console.error('  FAILED: ' + label + ' — ' + String(e.stderr || e).slice(0, 300));
    return;
  }
  const { o } = readPNG(tmp);
  const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const s = (y * CELL + x) * 4, d = ((oy + y) * W + ox + x) * 4;
      for (let k = 0; k < 4; k++) big[d + k] = o[s + k];
    }
  }
  fs.unlinkSync(tmp);
  process.stdout.write((i + 1) + '/' + VIEWS.length + ' ');
});
console.log('');
writePNG(out, big, W, CELL * rows);
console.log('-> ' + out + '  ' + W + 'x' + CELL * rows);
