/* The standing figure on a turntable, as an animated GIF.
   Usage: node tools/orbit.js [seed] [out.gif] [frames] [size]

   Each frame is tools/skin.js run as a child process, for sheet.js's
   reason: the film must show exactly what the plate renderer produces.
   The scale holds steady across the orbit on its own — the fit is
   height-driven for a standing figure and the projected height of a
   vertical body does not change with azimuth — so no fit-pinning is
   needed here the way the hand films need it.

   FRAME passes through, so an orbit of just the head is
   FRAME=<lo>,<hi> node tools/orbit.js ... */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const writeGIF = require('/home/user/demo/graphite-kinematics/tools/gif.js');

const seed = process.argv[2] || '12345';
const out = process.argv[3] || '/tmp/orbit.gif';
const N = parseInt(process.argv[4] || '36');
const S = parseInt(process.argv[5] || '520');

// the same minimal PNG reader sheet.js carries; each tool stands alone
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

const frames = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  // start facing the viewer and turn one full revolution
  const az = (180 + (i * 360) / N) % 360;
  const tmp = `/tmp/_orbit_${i}.png`;
  execFileSync('node', [path.join(__dirname, 'skin.js'), seed, String(az), '0', tmp, String(S)],
    { stdio: 'pipe' });
  const { o } = readPNG(tmp);
  frames.push(new Uint8ClampedArray(o));
  fs.unlinkSync(tmp);
  process.stdout.write('\r  frame ' + (i + 1) + '/' + N + '   ');
}
const bytes = writeGIF(out, frames, S, S, 9);
console.log('\n' + N + ' frames at ' + S + 'px in ' + ((Date.now() - t0) / 1000).toFixed(0) +
  's -> ' + out + '  ' + (bytes / 1024).toFixed(0) + 'kB');
