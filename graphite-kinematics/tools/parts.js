// Which construction drew that line?
//
// A finished plate cannot answer it. Eight constructions - one outline per
// digit, the knuckle rings, the palm's two borders and its distal cap, the
// first web, the ball - all land in the same graphite, and a line in the
// wrong place looks the same whichever of them put it there. So render them
// one at a time, each against a faint ghost of the whole drawing for
// bearings, and the question answers itself.
//
// A wrong answer looks like: a line that appears in the montage cell for a
// part that is nowhere near it, or a cell that draws something the full
// plate does not (or the other way round, which means it is being buried).
//
// Usage: node tools/parts.js <preset> <seed> <az> <el> [out.png] [cell]
//        BALL=<mm> puts something in the hand.
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');

const a = process.argv.slice(2);
const preset = a[0] || 'rest', seed = parseInt(a[1] || '12345');
const az = (+a[2] || 0) * DEG, el = (+a[3] || 0) * DEG;
const out = a[4] || '/tmp/parts.png', CELL = parseInt(a[5] || '440');

const A = G.anatomy.buildAnatomy(seed);
const ballR = process.env.BALL ? +process.env.BALL : 0;
const pose = ballR ? G.pose.holdBall(A, G.pose.preset(A, preset), ballR)
  : G.pose.preset(A, preset);

// One pass to learn what the drawing is made of, and to pin the framing so
// every cell lands on the same hand.
const probe = new G.render.Renderer(CELL, CELL);
const trace = [];
const built = probe.draw({
  seed, pose, ball: pose.ball || null,
  view: { az, el, roll: 0, zoom: 1 },
  style: { grade: 3, tone: 1, wobble: 1, ghost: 0, search: 0 },
  detail: { print: 0, ridge: 0, lattice: 0, hair: 0, vein: 0 },
  quality: 1, trace,
});
const fit = { scale: built.view.scale, cx: built.view.cx, cy: built.view.cy };
const sources = [];
for (const t of trace) if (!sources.includes(t.src)) sources.push(t.src);
sources.sort();

// Every cell is the same plate with one source kept, so anything that moves
// between cells is a difference in the drawing and not in the framing.
const shot = (keep) => {
  const r = new G.render.Renderer(CELL, CELL);
  r.draw({
    seed, pose, ball: pose.ball || null, fit,
    view: { az, el, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0, search: 0 },
    detail: { print: 0, ridge: 0, lattice: 0, hair: 0, vein: 0 },
    layers: keep === null ? undefined : {
      crease: false, fold: false, nail: false, print: false, palmcrease: false,
      ridge: false, vein: false, tendon: false, hair: false, hatch: false, model: false,
    },
    contourOnly: keep,
    quality: 1,
  });
  return r.resolve({ style: {} });
};

const cells = [{ name: 'everything', px: shot(null) }];
for (const s of sources) cells.push({ name: s, px: shot(s) });

const cols = Math.min(4, cells.length);
const rows = Math.ceil(cells.length / cols);
const W = CELL * cols, H = CELL * rows;
const big = new Uint8ClampedArray(W * H * 4).fill(255);
cells.forEach((c, i) => {
  const ox = (i % cols) * CELL, oy = Math.floor(i / cols) * CELL;
  for (let y = 0; y < CELL; y++) {
    const src = (y * CELL) * 4, dst = ((oy + y) * W + ox) * 4;
    big.set(c.px.subarray(src, src + CELL * 4), dst);
  }
});
writePNG(out, big, W, H);
console.log(preset, az / DEG + ',' + el / DEG, '->', out, W + 'x' + H);
console.log('cells:', cells.map(c => c.name).join(' | '));
