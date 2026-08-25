/* A minimal animated-GIF writer.
   This drawing is graphite on paper: one ink, one ground, and everything
   between them on a single ramp. So the palette is that ramp, and quantising
   is a luminance lookup rather than anything cleverer - which is also why a
   32-entry table loses nothing visible here and keeps the file small. */
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

/**
 * @param frames  array of RGBA Uint8ClampedArray, all w x h
 * @param delayCs delay per frame in hundredths of a second
 */
module.exports = function writeGIF(path, frames, w, h, delayCs, paper, ink) {
  const N = 32, minCode = 5;
  paper = paper || [244, 241, 232]; ink = ink || [26, 25, 23];
  const table = [];
  for (let i = 0; i < N; i++) {
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
    for (let i = 0; i < w * h; i++) {
      const l = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
      let t = (l - lumPaper) / (lumInk - lumPaper);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      idx[i] = Math.round(t * (N - 1));
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
