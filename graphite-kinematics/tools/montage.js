/* A contact sheet: many poses and angles in one plate, so a defect that only
   shows from one direction cannot hide between single renders.
   Usage: node tools/montage.js <out.png> <cell> <seed> pose@az,el pose@az,el ... */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');

const args = process.argv.slice(2);
const out = args[0] || '/tmp/montage.png';
const cell = parseInt(args[1] || '420');
const seed = parseInt(args[2] || '12345');
const specs = args.slice(3).map(s => {
  const [pose, ang] = s.split('@');
  const [az, el] = (ang || '0,0').split(',').map(Number);
  return { pose, az, el };
});
const cols = Math.min(specs.length, Math.ceil(Math.sqrt(specs.length * 1.6)));
const rows = Math.ceil(specs.length / cols);
const W = cols * cell, H = rows * cell;
const sheet = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  sheet[i * 4] = 244; sheet[i * 4 + 1] = 241; sheet[i * 4 + 2] = 232; sheet[i * 4 + 3] = 255;
}

const A = G.anatomy.buildAnatomy(seed);
const r = new G.render.Renderer(cell, cell);
specs.forEach((sp, i) => {
  const pose = G.pose.preset(A, sp.pose);
  r.draw({
    seed, pose,
    view: { az: sp.az * DEG, el: sp.el * DEG, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0.2, search: 0.55 },
    detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
    quality: 1
  });
  const px = r.resolve({ style: {} });
  const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
  for (let y = 0; y < cell; y++) {
    const src = y * cell * 4, dst = ((oy + y) * W + ox) * 4;
    sheet.set(px.subarray(src, src + cell * 4), dst);
  }
  console.log('  ' + sp.pose + ' @ ' + sp.az + ',' + sp.el);
});
writePNG(out, sheet, W, H);
console.log(specs.length + ' cells ->', out, W + 'x' + H);
