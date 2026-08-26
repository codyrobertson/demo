/* Render one plate and dump its resolved RGBA buffer verbatim, no PNG
   encoding in between. Exists so pixeldiff.js can compare what two trees
   actually drew without also trusting a compressor to round-trip it losslessly.
   Usage: node tools/rawdump.js <srcDir> <preset> <seed> <az> <el> <out.bin> [size]
   srcDir lets the same script render from a different checkout of src/ - a
   baseline kept on disk, or another commit checked out elsewhere - so
   pixeldiff.js can point this tool at two trees in turn and diff what came
   back, rather than diffing two versions of the tool itself.             */
'use strict';
global.window = {};
const path = require('path');
const fs = require('fs');

const srcDir = path.resolve(process.argv[2]);
const presetKey = process.argv[3] || 'rest';
const seed = parseInt(process.argv[4] || '12345', 10);
const az = parseFloat(process.argv[5] || '0');
const el = parseFloat(process.argv[6] || '0');
const out = process.argv[7];
const size = parseInt(process.argv[8] || '900', 10);

['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(srcDir, f + '.js')));
const G = window.GK, DEG = G.math.DEG;

const A = G.anatomy.buildAnatomy(seed);
const pose = G.pose.preset(A, presetKey);
const r = new G.render.Renderer(size, size);
r.draw({
  seed, pose,
  view: { az: az * DEG, el: el * DEG, roll: 0, zoom: 1 },
  style: { grade: 3, tone: 1, wobble: 1, ghost: 0.20, search: 0.55 },
  detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
  quality: 1
});
const px = r.resolve({ style: {} });

// header: two little-endian uint32s (w, h), then the raw RGBA bytes.
const head = Buffer.alloc(8);
head.writeUInt32LE(size, 0);
head.writeUInt32LE(size, 4);
fs.writeFileSync(out, Buffer.concat([head, Buffer.from(px.buffer, px.byteOffset, px.byteLength)]));
