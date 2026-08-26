/* Render the hand holding a ball.
   Usage: node tools/ball.js <preset> <seed> <az> <el> <radiusMm> [out] [size] */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');
const a = process.argv.slice(2);
const preset = a[0] || 'flat', seed = parseInt(a[1] || '12345');
const az = (+a[2] || 0) * DEG, el = (+a[3] || 0) * DEG, rad = +a[4] || 26;
const rough = process.env.ROUGH === undefined ? 0.25 : +process.env.ROUGH;
const aniso = process.env.ANISO === undefined ? 0 : +process.env.ANISO;
const out = a[5] || '/tmp/ball.png', S = parseInt(a[6] || '900');

const A = G.anatomy.buildAnatomy(seed);
const pose = G.pose.holdBall(A, G.pose.preset(A, preset), rad);
pose.ball.roughness = rough; pose.ball.anisotropy = aniso;
const r = new G.render.Renderer(S, S);
const built = r.draw({
  seed, pose, ball: pose.ball,
  view: { az, el, roll: 0, zoom: 1 },
  style: { grade: 3, tone: 1, wobble: 1, ghost: 0.2, search: 0.55 },
  detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
  contacts: false, quality: 1,
  soft: process.env.SOFT === undefined ? 1 : +process.env.SOFT
});
writePNG(out, r.resolve({ style: {} }), S, S);
console.log(preset + ' holding r=' + rad + 'mm | curves ' + built.curves.length +
  ' | ' + built.ms + 'ms -> ' + out);
