// Contact sheet: node tools/sheet.js out.png "preset:az:el,preset:az:el,..." [cell] [cols] [seed]
global.window = {};
const path = require('path'), fs = require('fs');
['00-math','10-anatomy','20-rig','30-pose','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');
const out = process.argv[2] || '/tmp/sheet.png';
const spec = (process.argv[3] || 'rest:0:0,fist:0:0').split(',');
const cell = parseInt(process.argv[4] || '420');
const cols = parseInt(process.argv[5] || '4');
const seed = parseInt(process.argv[6] || '12345');
const rows = Math.ceil(spec.length / cols);
const W = cell * cols, H = cell * rows;
const big = new Uint8ClampedArray(W * H * 4).fill(255);
const r = new G.render.Renderer(cell, cell);
const t0 = Date.now();
spec.forEach((sp, i) => {
  const [key, az, el, sd] = sp.split(':');
  const useSeed = sd ? parseInt(sd) : seed;
  const A = G.anatomy.buildAnatomy(useSeed);
  const pose = key.startsWith('gen') ? G.pose.generate(A, parseInt(key.slice(3)) || 1, 0.7)
                                     : G.pose.preset(A, key);
  r.draw({ seed: useSeed, pose, view: { az: parseFloat(az||0)*DEG, el: parseFloat(el||0)*DEG, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0.20, search: 0.5 },
    detail: { print: 1, ridge: 0.8, lattice: 0.5, hair: 1, vein: 1 }, quality: 1 });
  const px = r.resolve({ style: {} });
  const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
  for (let y = 0; y < cell; y++) {
    const src = y * cell * 4, dst = ((cy + y) * W + cx) * 4;
    big.set(px.subarray(src, src + cell * 4), dst);
  }
  process.stdout.write(key + ' ');
});
writePNG(out, big, W, H);
console.log('\n->', out, (Date.now()-t0)+'ms');
