/* The pieces of this that are hard to fake, as animated GIFs.
   Usage: node tools/showcase.js <which> [out.gif] [frames] [size] [seed]
     orbit    one pose, all the way round - the drawing is rebuilt from the
              solid every frame, so this is the honest test of whether it is
              derived or drawn
     rom      every degree of freedom to both of its stops
     wave     each digit through its own range, in turn - the legible version
     squeeze  a ball pressed into the palm and let go, skin giving under it
     seeds    one pose, a different hand each frame
     close    rest to fist and back, creases gathering as the joints shut

   Framing is pinned from a probe frame in every mode, because a sequence
   that re-fits per frame swims about inside its own plate and reads as
   camera shake rather than as movement. */
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose', '35-physics', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, M = G.math, DEG = M.DEG, PO = G.pose;
const writeGIF = require('./gif.js');

const a = process.argv.slice(2);
const which = a[0] || 'orbit';
const out = a[1] || ('/tmp/' + which + '.gif');
const N = parseInt(a[2] || '54');
const S = parseInt(a[3] || '520');
const seed = parseInt(a[4] || '12345');

const STYLE = { grade: 3, tone: 1, wobble: 1, ghost: 0.16, search: 0.42 };
const DET = { print: 0.8, ridge: 0.4, lattice: 0.5, hair: 0.8, vein: 1 };

// Each mode answers the same two questions per frame: what is the hand doing,
// and where is it being looked at from.
const MODES = {
  orbit: {
    label: 'one pose, all the way round',
    frame: (t, A) => ({
      pose: PO.preset(A, 'claw'),
      view: { az: (t * 360) * DEG, el: (14 + 20 * Math.sin(t * Math.PI * 2)) * DEG, roll: 0, zoom: 1 },
    }),
    // the widest moment of an orbit is broadside, so probe there
    probeAt: 0.25, zoom: 1.30,
  },
  rom: {
    label: 'every joint to both stops',
    frame: (t, A) => ({
      pose: PO.romTour(A, t),
      view: { az: 205 * DEG, el: 12 * DEG, roll: 0, zoom: 1 },
    }),
    probeAt: 0, zoom: 1.05,
  },
  wave: {
    // The range-of-motion tour walks 25 degrees of freedom in one cycle, so
    // at any sane frame count each one gets two or three frames and the whole
    // thing reads as a hand shivering. This drives the same joints, one digit
    // at a time, slowly enough to see - which is what actually shows that
    // every finger is independently articulated rather than a rig with one
    // curl parameter.
    label: 'each digit through its own range, in turn',
    frame: (t, A) => {
      // a raised cosine travelling along the hand, wrapped so it loops
      const pulse = (c, w) => {
        let d = t - c; d -= Math.round(d);
        const x = Math.abs(d) / w;
        return x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(x * Math.PI);
      };
      const f = [];
      for (let i = 0; i < 4; i++) {
        const u = pulse(0.10 + i * 0.135, 0.17);
        f.push([0.96 * u, 0.98 * u, 0.82 * u, [-0.15, -0.05, 0.05, 0.15][i]]);
      }
      const th = pulse(0.72, 0.20);
      return {
        pose: PO.mk(A, {
          wrist: [0.04, 0.05, 0], arch: 0.10 + 0.40 * Math.max(...f.map(v => v[0])),
          thumb: [0.10 + 0.60 * th, 0.16, 0.10 + 0.70 * th, 0.10 + 0.55 * th, 0.08 + 0.60 * th],
          f,
        }),
        view: { az: (214 + 10 * Math.sin(t * Math.PI * 2)) * DEG, el: 14 * DEG, roll: 0, zoom: 1 },
      };
    },
    probeAt: 0.1, zoom: 1.18,
  },
  seeds: {
    label: 'one pose, a different hand each frame',
    // The renderer grows its own anatomy from state.seed, so a different hand
    // means a different seed - handing over an anatomy object here drew the
    // same hand every frame, which is a quiet way for a showcase of
    // generative variety to show none.
    frame: (t, A, i) => ({
      seed: seed + i * 7919,
      view: { az: 198 * DEG, el: 16 * DEG, roll: 0, zoom: 1 },
    }),
    poseKey: 'spread', probeAt: 0, zoom: 1.20,
  },
  close: {
    label: 'rest to fist and back',
    frame: (t, A) => {
      const u = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      const e = u * u * (3 - 2 * u);
      return {
        pose: PO.lerpPose(PO.preset(A, 'rest'), PO.preset(A, 'fist'), e),
        view: { az: 232 * DEG, el: 10 * DEG, roll: 0, zoom: 1 },
      };
    },
    probeAt: 0, zoom: 1.25,
  },
  squeeze: {
    label: 'a ball pressed into the palm and let go',
    frame: (t, A) => {
      // in and out on a cosine, so the ends have no velocity in them
      const u = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      // The grip itself does not change - only how far the skin gives under
      // it - so it is solved once. Re-solving per frame would also let the
      // contact solver wander a little each time and put a tremor into a
      // hand that is supposed to be holding still.
      const held = MODES.squeeze._held || (MODES.squeeze._held = PO.holdBall(A, PO.preset(A, 'flat'), 26));
      return {
        pose: held, ball: held.ball,
        soft: 0.15 + 1.45 * u,
        view: { az: (196 + 26 * Math.sin(t * Math.PI * 2)) * DEG, el: 22 * DEG, roll: 0, zoom: 1 },
      };
    },
    probeAt: 0.5, zoom: 1.30,
  },
};

const mode = MODES[which];
if (!mode) { console.error('modes: ' + Object.keys(MODES).join(', ')); process.exit(1); }

const A0 = G.anatomy.buildAnatomy(seed);
const r = new G.render.Renderer(S, S);
const build = (t, i) => {
  const f = mode.frame(t, A0, i);
  const sd = f.seed === undefined ? seed : f.seed;
  const A = sd === seed ? A0 : G.anatomy.buildAnatomy(sd);
  const pose = f.pose || PO.preset(A, mode.poseKey || 'rest');
  return { seed: sd, A, pose, ball: f.ball || pose.ball || null, soft: f.soft, view: f.view };
};

// One framing for the whole sequence, and it has to hold for ALL of it. A
// single probe frame is not enough: an orbit changes the hand's screen extent
// as it turns, and pinned to one moment the hand walks off the edge of the
// plate at the others. So probe several moments and take the union.
//
// The auto-fit's own answer can be read back out of the view it produced. It
// sets scale = plate * margin / extent and cx = plate/2 - scale * midpoint, so
// the midpoint is (plate/2 - cx)/scale and the half-extent of the square it
// framed is plate * margin / (2 * scale). Unioning those squares is
// conservative - it can only ever frame wider than needed, never tighter.
const MARGIN = 0.84;
const PROBES = 9;
let ux0 = 1e18, uy0 = 1e18, ux1 = -1e18, uy1 = -1e18;
for (let k = 0; k < PROBES; k++) {
  const p = build(k / PROBES, k);
  const b = r.draw({
    seed: p.seed, pose: p.pose, ball: p.ball, soft: p.soft,
    view: Object.assign({}, p.view, { zoom: mode.zoom }),
    style: STYLE, detail: DET, contacts: false, margin: MARGIN, quality: 0,
  });
  const sc = b.view.scale;
  const midX = (S * 0.5 - b.view.cx) / sc, midY = (S * 0.5 - b.view.cy) / sc;
  const half = S * MARGIN / (2 * sc);
  ux0 = Math.min(ux0, midX - half); ux1 = Math.max(ux1, midX + half);
  uy0 = Math.min(uy0, midY - half); uy1 = Math.max(uy1, midY + half);
}
const uHalf = Math.max(ux1 - ux0, uy1 - uy0) * 0.5;
const uScale = S * MARGIN / (2 * uHalf);

// Scale is held fixed for the whole sequence - a hand that grows and shrinks
// frame to frame reads as the camera lurching rather than as the hand moving -
// but the frame follows the subject, because a hand orbiting a wrist walks a
// long way across the plate and a rigidly fixed frame has to be pulled back
// far enough to contain the whole path, which leaves it small in every frame.
// The per-frame centre costs one cheap draft draw, whose own auto-fit answer
// is read back the same way as above and re-expressed at the fixed scale.
const centreOf = (f) => {
  const b = r.draw({
    seed: f.seed, pose: f.pose, ball: f.ball, soft: f.soft,
    view: Object.assign({}, f.view, { zoom: mode.zoom }),
    style: STYLE, detail: DET, contacts: false, margin: MARGIN, quality: 0,
  });
  const sc = b.view.scale;
  return {
    scale: uScale,
    cx: S * 0.5 - uScale * (S * 0.5 - b.view.cx) / sc,
    cy: S * 0.5 - uScale * (S * 0.5 - b.view.cy) / sc,
  };
};

const frames = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const f = build(i / N, i);
  const fit = centreOf(f);
  r.draw({
    seed: f.seed, pose: f.pose, ball: f.ball, soft: f.soft, fit,
    view: f.view, style: STYLE, detail: DET, contacts: false, quality: 1,
  });
  frames.push(r.resolve({ style: STYLE }).slice());
  process.stdout.write('\r  ' + (i + 1) + '/' + N + '   ');
}
// SHEET=1 also lays the frames out as a contact sheet, because a GIF is
// awkward to check a frame of and the whole point is to look at them.
if (process.env.SHEET) {
  const writePNG = require('./png.js');
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const big = new Uint8ClampedArray(cols * S * rows * S * 4).fill(255);
  frames.forEach((px, i) => {
    const ox = (i % cols) * S, oy = Math.floor(i / cols) * S, W = cols * S;
    for (let y = 0; y < S; y++) big.set(px.subarray(y * S * 4, (y + 1) * S * 4), ((oy + y) * W + ox) * 4);
  });
  writePNG(out.replace(/\.gif$/, '') + '-sheet.png', big, cols * S, rows * S);
}
const bytes = writeGIF(out, frames, S, S, Math.round(100 / 20));
console.log('\n' + which + ': ' + mode.label);
console.log('  ' + N + ' frames at ' + S + 'px in ' + ((Date.now() - t0) / 1000).toFixed(1) +
  's -> ' + out + '  ' + (bytes / 1024).toFixed(0) + 'kB');
