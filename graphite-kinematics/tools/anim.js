/* The hand picking a ball up and dropping it, as an animated GIF.
   Usage: node tools/anim.js [out.gif] [frames] [size] [radius] [az] [el] */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose','35-physics','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, DEG = G.math.DEG;
const writeGIF = require('./gif.js');
const a = process.argv.slice(2);
const out = a[0] || '/tmp/pickdrop.gif';
const N = parseInt(a[1] || '36'), S = parseInt(a[2] || '460');
const rad = +(a[3] || 26), az = +(a[4] || 205) * DEG, el = +(a[5] || 22) * DEG;
const seed = parseInt(process.env.SEED || '12345');

const A = G.anatomy.buildAnatomy(seed);
const seq = G.pose.pickAndDrop(A, rad, {
  roughness: +(process.env.ROUGH === undefined ? 0.3 : process.env.ROUGH),
  anisotropy: +(process.env.ANISO || 0)
});
const r = new G.render.Renderer(S, S);
// One framing for the whole sequence, or the hand swims about inside its own
// plate and a ball leaving the picture drags the drawing small as it goes.
// Measure it on the widest moment - the hand open with the ball still in it.
const probe = seq(0);
const first = r.draw({
  seed, pose: probe, ball: probe.ball,
  view: { az, el, roll: 0, zoom: 0.94 },
  style: { grade: 3, tone: 1, wobble: 1, ghost: 0.16, search: 0.4 },
  detail: { print: 0.8, ridge: 0.4, lattice: 0.5, hair: 0.8, vein: 1 },
  contacts: false, margin: 0.86, quality: 0
});
const fit = { scale: first.view.scale, cx: first.view.cx, cy: first.view.cy };

const frames = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const pose = seq(i / N);
  r.draw({
    seed, pose, ball: pose.ball, fit,
    view: { az, el, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0.16, search: 0.4 },
    detail: { print: 0.8, ridge: 0.4, lattice: 0.5, hair: 0.8, vein: 1 },
    contacts: false, quality: 0
  });
  frames.push(r.resolve({ style: {} }).slice());
  process.stdout.write('\r  frame ' + (i + 1) + '/' + N + '  ' + pose.phase + '        ');
}
const bytes = writeGIF(out, frames, S, S, Math.round(100 / 18));
console.log('\n' + N + ' frames at ' + S + 'px in ' + ((Date.now() - t0) / 1000).toFixed(1) +
  's -> ' + out + '  ' + (bytes / 1024).toFixed(0) + 'kB');
