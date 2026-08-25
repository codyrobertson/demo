/* Render large and cut a window out of it, so a region can be studied at a
   resolution the whole plate would never survive.
   Usage: node tools/crop.js <preset> <seed> <az> <el> <fx> <fy> <fw> <out> [size] */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');
const a = process.argv.slice(2);
const [preset, seed, az, el, fx, fy, fw] = [a[0], parseInt(a[1]), +a[2], +a[3], +a[4], +a[5], +a[6]];
const out = a[7] || '/tmp/crop.png';
const S = parseInt(a[8] || '2000');

const A = G.anatomy.buildAnatomy(seed);
// BALL=<radius mm> puts something in the hand; SOFT=<0..1.6> says how hard
// the skin gives under it
const ballR = process.env.BALL ? +process.env.BALL : 0;
const pose = ballR
  ? G.pose.holdBall(A, G.pose.preset(A, preset), ballR)
  : G.pose.preset(A, preset);
const r = new G.render.Renderer(S, S);
r.draw({
  seed, pose, ball: pose.ball || null,
  soft: process.env.SOFT === undefined ? 1 : +process.env.SOFT,
  view: { az: az * DEG, el: el * DEG, roll: 0, zoom: 1 },
  style: { grade: 3, tone: 1, wobble: 1,
    ghost: process.env.GHOST === undefined ? 0.2 : +process.env.GHOST,
    search: process.env.SEARCH === undefined ? 0.55 : +process.env.SEARCH },
  detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
  layers: JSON.parse(process.env.LAYERS || 'null') || undefined,
  quality: 1
});
const px = r.resolve({ style: {} });
const x0 = Math.round(fx * S), y0 = Math.round(fy * S), w = Math.round(fw * S);
const h = w;
const cut = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) {
  const src = ((y0 + y) * S + x0) * 4;
  cut.set(px.subarray(src, src + w * 4), y * w * 4);
}
writePNG(out, cut, w, h);
console.log(preset, az + ',' + el, '->', out, w + 'x' + h, 'of', S);
