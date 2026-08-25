/* A minimal animated-GIF writer.
   This drawing is graphite on paper: one ink, one ground, and everything
   between them on a single ramp. So the palette is that ramp, and quantising
   is a luminance lookup rather than anything cleverer - which is also why a
   32-entry table loses nothing visible here and keeps the file small.

   That is the default and it stays the default. The diagnostic films in
   tools/process.js are the exception: their panels are saturated identity
   hues and heat scales, and a luminance ramp does not reduce those, it
   deletes them - a red part and a green one of the same brightness come out
   as the same grey. Pass {color: true} and the palette is instead cut from
   the frames themselves. */
const fs = require('fs');

function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map(), out = [], cur = 0, bits = 0;
  const emit = (code) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { out.push(cur & 255); cur >>= 8; bits -= 8; }
  };
  const reset = () => { dict = new Map(); next = eoi + 1; size = minCode + 1; };
  emit(clear); reset();
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix);
    dict.set(key, next++);
    if (next > (1 << size)) {
      if (size < 12) size++;
      else { emit(clear); reset(); }
    }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

/** the 15-bit bucket a colour falls in, and the centre of that bucket */
const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const mid = (c) => (c << 3) | 4;

/**
 * Median cut over the whole sequence at once, so the palette is global and a
 * colour does not shift between frames. Boxes are split on the axis they are
 * widest in, at the point that halves the population rather than the range -
 * a long tail of nearly-empty greys should not cost the same as the band
 * where most of the picture actually lives.
 */
function cutPalette(frames, want, step) {
  const hist = new Uint32Array(32768);
  for (const px of frames) {
    for (let i = 0; i < px.length; i += 4 * step) hist[key15(px[i], px[i + 1], px[i + 2])]++;
  }
  let keys = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) keys.push(k);
  const R = (k) => (k >> 10) & 31, Gc = (k) => (k >> 5) & 31, B = (k) => k & 31;
  const mk = (lo, hi) => {
    let r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 31, b1 = 0, n = 0;
    for (let i = lo; i <= hi; i++) {
      const k = keys[i], r = R(k), g = Gc(k), b = B(k);
      if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (g < g0) g0 = g; if (g > g1) g1 = g;
      if (b < b0) b0 = b; if (b > b1) b1 = b;
      n += hist[k];
    }
    return { lo, hi, n, dr: r1 - r0, dg: g1 - g0, db: b1 - b0 };
  };
  const boxes = [mk(0, keys.length - 1)];
  while (boxes.length < want) {
    let bi = -1, best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi <= b.lo) continue;
      const score = b.n * Math.max(b.dr, b.dg, b.db);
      if (score > best) { best = score; bi = i; }
    }
    if (bi < 0) break;
    const b = boxes[bi];
    const ch = b.dr >= b.dg && b.dr >= b.db ? R : (b.dg >= b.db ? Gc : B);
    const part = keys.slice(b.lo, b.hi + 1).sort((x, y) => ch(x) - ch(y));
    for (let i = 0; i < part.length; i++) keys[b.lo + i] = part[i];
    let acc = 0, cut = b.lo;
    for (let i = b.lo; i < b.hi; i++) { acc += hist[keys[i]]; if (acc * 2 >= b.n) { cut = i; break; } cut = i; }
    boxes[bi] = mk(b.lo, cut);
    boxes.push(mk(cut + 1, b.hi));
  }
  const table = boxes.map((b) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = b.lo; i <= b.hi; i++) {
      const k = keys[i], c = hist[k];
      r += mid(R(k)) * c; g += mid(Gc(k)) * c; bl += mid(B(k)) * c; n += c;
    }
    n = n || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
  while (table.length < want) table.push([0, 0, 0]);
  // every bucket resolved once against the finished table, so the per-pixel
  // pass is a single array read rather than a 256-way search
  const map = new Uint8Array(32768);
  for (let k = 0; k < 32768; k++) {
    const r = mid(R(k)), g = mid(Gc(k)), b = mid(B(k));
    let bi = 0, bd = Infinity;
    for (let i = 0; i < table.length; i++) {
      const t = table[i], dr = t[0] - r, dg = t[1] - g, db = t[2] - b;
      const d = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bd) { bd = d; bi = i; }
    }
    map[k] = bi;
  }
  return { table, map };
}

/**
 * @param frames  array of RGBA Uint8ClampedArray, all w x h
 * @param delayCs delay per frame in hundredths of a second
 * @param opts    {color: true} to cut a 256-entry palette from the frames
 *                instead of using the paper-to-ink ramp
 */
module.exports = function writeGIF(path, frames, w, h, delayCs, paper, ink, opts) {
  opts = opts || {};
  const N = opts.color ? 256 : 32, minCode = opts.color ? 8 : 5;
  paper = paper || [244, 241, 232]; ink = ink || [26, 25, 23];
  const cut = opts.color ? cutPalette(frames, N, 2) : null;
  const table = cut ? cut.table : [];
  if (!cut) for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    table.push([
      Math.round(paper[0] + (ink[0] - paper[0]) * t),
      Math.round(paper[1] + (ink[1] - paper[1]) * t),
      Math.round(paper[2] + (ink[2] - paper[2]) * t)
    ]);
  }
  const lumPaper = paper[0] * 0.299 + paper[1] * 0.587 + paper[2] * 0.114;
  const lumInk = ink[0] * 0.299 + ink[1] * 0.587 + ink[2] * 0.114;
  const bytes = [];
  const push = (...b) => bytes.push(...b);
  const str = (s) => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  const u16 = (v) => push(v & 255, (v >> 8) & 255);

  str('GIF89a');
  u16(w); u16(h); push(0xF0 | (minCode - 1), 0, 0);
  for (const c of table) push(c[0], c[1], c[2]);
  // loop forever
  push(0x21, 0xFF, 11); str('NETSCAPE2.0'); push(3, 1); u16(0); push(0);

  for (const px of frames) {
    push(0x21, 0xF9, 4, 0x04); u16(delayCs); push(0, 0);
    push(0x2C); u16(0); u16(0); u16(w); u16(h); push(0);
    const idx = new Uint8Array(w * h);
    if (cut) {
      for (let i = 0; i < w * h; i++) idx[i] = cut.map[key15(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])];
    } else {
      for (let i = 0; i < w * h; i++) {
        const l = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
        let t = (l - lumPaper) / (lumInk - lumPaper);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        idx[i] = Math.round(t * (N - 1));
      }
    }
    push(minCode);
    const data = lzw(idx, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      push(chunk.length, ...chunk);
    }
    push(0);
  }
  push(0x3B);
  fs.writeFileSync(path, Buffer.from(bytes));
  return bytes.length;
};
