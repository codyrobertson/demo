// Per-layer isolation strip: node tools/iso.js <preset> <az> <el> <out>
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');
const [key, az, el, out] = [process.argv[2]||'rest', +(process.argv[3]||0), +(process.argv[4]||0), process.argv[5]||'/tmp/iso.png'];
const NAMES = ['contour','crease','fold','nail','print','palmcrease','ridge','vein','tendon','hair','hatch'];
const cell = 340, cols = 6, rows = Math.ceil(NAMES.length/cols);
const W = cell*cols, H = cell*rows;
const big = new Uint8ClampedArray(W*H*4).fill(255);
const A = G.anatomy.buildAnatomy(12345);
const pose = G.pose.preset(A, key);
const r = new G.render.Renderer(cell, cell);
NAMES.forEach((n, i) => {
  const L = {}; NAMES.forEach(x => L[x] = false); L[n] = true; L.bone = false;
  r.draw({ seed: 12345, pose, view: { az: az*DEG, el: el*DEG, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0, search: 0 },
    detail: { print: 1, ridge: 0.5, lattice: 0.5, hair: 1, vein: 1 }, layers: L, quality: 1 });
  const px = r.resolve({ style: {} });
  const cx = (i%cols)*cell, cy = Math.floor(i/cols)*cell;
  for (let y = 0; y < cell; y++) big.set(px.subarray(y*cell*4, (y+1)*cell*4), ((cy+y)*W+cx)*4);
});
writePNG(out, big, W, H);
console.log('order:', NAMES.join(' | '));
