/* The making of the drawing, as animated GIFs.
   Usage: node tools/process.js <which> [out.gif] [frames] [size] [seed]

     bones    the 27-bone skeleton and every joint centre, fading up over a
              hand that is closing - the rig the drawing is derived from
     layers   the twelve mark layers laid down one at a time, on a hand
              turning from its back to its palm
     depth    the occlusion machinery: front depth, part identity, the peeled
              second layer, slope, and the two tests every contour point
              answers to, then the ink they produce
     trace    a digit's outline is the border of what the digit covers -
              coverage mask, border walk, filtered outline, drawing

   These are the counterpart to tools/showcase.js. That one shows what comes
   out; this one shows what it is made of. Everything drawn here is read back
   from the renderer's own structures - the same DepthField, the same buildIds,
   the same silhouette trace - rather than reconstructed, so a panel that looks
   wrong is the pipeline being wrong and not the diagram.

   env SHEET=1   also write the frames out as a contact sheet PNG */
'use strict';
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose', '35-physics', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, M = G.math, DEG = M.DEG, PO = G.pose, RG = G.rig, REND = G.render;
const writeGIF = require('./gif.js');
const LB = require('./label.js');

const a = process.argv.slice(2);
const which = a[0] || 'layers';
const out = a[1] || ('/tmp/process-' + which + '.gif');
const N = parseInt(a[2] || '60');
const S = parseInt(a[3] || '560');
const seed = parseInt(a[4] || '12345');

const STYLE = { grade: 3, tone: 1, wobble: 1, ghost: 0.16, search: 0.42 };
const DET = { print: 0.8, ridge: 0.4, lattice: 0.5, hair: 0.8, vein: 1 };
const PAPER = [244, 241, 232];

// =========================================================================
//  PIXELS
//  Everything the diagrams add sits on top of a resolved graphite buffer, so
//  it all composites rather than replaces - the pencil has to stay visible
//  under an overlay or the overlay is just a different picture.
// =========================================================================

function blend(buf, w, h, x, y, rgb, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= w || y >= h) return;
  const o = (y * w + x) * 4, k = alpha > 1 ? 1 : alpha;
  buf[o] += (rgb[0] - buf[o]) * k;
  buf[o + 1] += (rgb[1] - buf[o + 1]) * k;
  buf[o + 2] += (rgb[2] - buf[o + 2]) * k;
}

/** a soft-edged disc - the only primitive the overlays need, since a line is a run of them */
function disc(buf, w, h, cx, cy, r, rgb, alpha) {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const c = 1 - M.smoothstep(M.clamp01((d - (r - 0.5)) / 1.0));
      if (c > 0.004) blend(buf, w, h, x, y, rgb, alpha * c);
    }
  }
}

function seg(buf, w, h, x0, y0, x1, y1, r, rgb, alpha) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(L / 0.45));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    disc(buf, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, rgb, alpha);
  }
}

function poly(buf, w, h, pts, r, rgb, alpha, closed) {
  for (let i = 0; i + 1 < pts.length; i++) {
    seg(buf, w, h, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r, rgb, alpha);
  }
  if (closed && pts.length > 2) {
    const a2 = pts[pts.length - 1], b = pts[0];
    seg(buf, w, h, a2[0], a2[1], b[0], b[1], r, rgb, alpha);
  }
}

function mix(A, B, t) {
  const o = new Uint8ClampedArray(A.length);
  for (let i = 0; i < A.length; i++) o[i] = A[i] + (B[i] - A[i]) * t;
  return o;
}

function flat(rgb) {
  const b = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) { b[i * 4] = rgb[0]; b[i * 4 + 1] = rgb[1]; b[i * 4 + 2] = rgb[2]; b[i * 4 + 3] = 255; }
  return b;
}

// =========================================================================
//  COLOUR
// =========================================================================

function stops(list, t) {
  const n = list.length - 1, f = M.clamp01(t) * n, i = Math.min(n - 1, Math.floor(f)), fr = f - i;
  const p = list[i], q = list[i + 1];
  return [M.lerp(p[0], q[0], fr), M.lerp(p[1], q[1], fr), M.lerp(p[2], q[2], fr)];
}
const heat = (t) => stops([[18, 20, 46], [24, 116, 132], [237, 202, 64], [214, 44, 36]], t);
const hid = (t) => stops([[46, 160, 67], [224, 168, 44], [199, 42, 42]], t);
const grey = (t) => { const g = M.lerp(28, 246, M.clamp01(t)); return [g, g, g]; };
const EMPTY = [44, 48, 58];

function hsl(hDeg, s, l) {
  const hh = ((hDeg % 360) + 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(hh % 2 - 1)), m = l - c / 2;
  const i = Math.floor(hh) % 6;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
}

/** buildIds hands ids out in a fixed walk, so this is a small closed palette rather than an open one */
function idColor(id, total) {
  if (id < 0) return EMPTY;
  let k = Math.max(1, Math.round(total * 0.382));
  const g = (p, q) => q ? g(q, p % q) : p;
  while (g(k, total) !== 1) k = (k % (total - 1)) + 1;
  return hsl(((id * k) % total) * 360 / total, 0.62, 0.56);
}

const DIGIT_HUE = [12, 44, 158, 208, 286];

// =========================================================================
//  CAPTION
//  A process film that does not say which step it is on is a screensaver.
// =========================================================================

const BAR = Math.max(26, Math.round(S * 0.062));
function caption(buf, title, step, total, alpha, frac) {
  const y0 = S - BAR;
  LB.box(buf, S, S, 0, y0, S, BAR, [22, 21, 19], 0.88);
  const sc = Math.max(2, Math.round(S / 280));
  const ty = y0 + Math.round((BAR - 7 * sc) / 2);
  if (alpha > 0.01) LB.text(buf, S, S, 12, ty, title, { scale: sc, rgb: [246, 243, 234], alpha });
  if (total > 1) {
    const tag = step + '/' + total;
    const wpx = LB.measure(tag, { scale: sc });
    LB.text(buf, S, S, S - 12 - wpx, ty, tag, { scale: sc, rgb: [150, 146, 136], alpha: 1 });
    // and a rule underneath that fills as the sequence runs, so a still frame
    // still says how far in it is
    LB.box(buf, S, S, 0, S - 3, S, 3, [58, 56, 52], 1);
    LB.box(buf, S, S, 0, S - 3, Math.round(S * (frac === undefined ? step / total : frac)), 3, [214, 138, 62], 1);
  }
}

// =========================================================================
//  FRAMING
//  Pinned for the whole sequence: a plate that re-fits per frame swims about
//  inside itself and reads as camera shake. Probed at several moments and
//  unioned, because a moving hand's screen extent is not constant.
// =========================================================================

const MARGIN = 0.84;
const r = new G.render.Renderer(S, S);

function drafts(states, zoom) {
  let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (const st of states) {
    const b = r.draw(Object.assign({}, st, {
      view: Object.assign({}, st.view, { zoom }),
      style: STYLE, detail: DET, contacts: false, margin: MARGIN, quality: 0,
    }));
    const sc = b.view.scale;
    const mx = (S * 0.5 - b.view.cx) / sc, my = (S * 0.5 - b.view.cy) / sc;
    const half = S * MARGIN / (2 * sc);
    x0 = Math.min(x0, mx - half); x1 = Math.max(x1, mx + half);
    y0 = Math.min(y0, my - half); y1 = Math.max(y1, my + half);
  }
  const uHalf = Math.max(x1 - x0, y1 - y0) * 0.5;
  const scale = S * MARGIN / (2 * uHalf);
  return { scale, cx: S * 0.5 - scale * (x0 + x1) * 0.5, cy: S * 0.5 - scale * (y0 + y1) * 0.5 };
}

/** the fixed scale, re-centred on this frame's own subject */
function recentre(fit, st, zoom) {
  const b = r.draw(Object.assign({}, st, {
    view: Object.assign({}, st.view, { zoom }),
    style: STYLE, detail: DET, contacts: false, margin: MARGIN, quality: 0,
  }));
  const sc = b.view.scale;
  return {
    scale: fit.scale,
    cx: S * 0.5 - fit.scale * (S * 0.5 - b.view.cx) / sc,
    cy: S * 0.5 - fit.scale * (S * 0.5 - b.view.cy) / sc,
  };
}

function plate(st, fit, layers) {
  const s = Object.assign({}, st, {
    fit, style: STYLE, detail: DET, contacts: false, quality: 1,
  });
  if (layers) s.layers = layers;
  const built = r.draw(s);
  return { px: r.resolve({ style: STYLE }).slice(), built };
}

// =========================================================================
//  THE FILMS
// =========================================================================

// A build that snaps straight back to a blank page reads as a restart, which
// is what it is - but the eye needs a moment on the finished thing first.
const HOLD = (n) => Math.max(4, Math.round(n * 0.14));

/** a still subject, a fixed camera, and a sequence of states of the drawing cross-fading into one another */
function stageFilm(build) {
  const A = G.anatomy.buildAnatomy(seed);
  const spec = build(A);
  const fit = drafts([spec.state], spec.zoom);
  const stages = spec.stages(A, fit);
  const K = stages.length;
  const FADE = 0.42;                       // of one stage's span
  const blank = flat(PAPER);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const u = (i / N) * K;
    const k = Math.min(K - 1, Math.floor(u));
    const local = u - k;
    const alpha = M.smoothstep(M.clamp01(local / FADE));
    const prev = k === 0 ? blank : stages[k - 1].px;
    const px = mix(prev, stages[k].px, alpha);
    // the name swaps at the midpoint of the cross-fade, fading out and back
    // in, so it never reads as two captions printed over one another
    const name = alpha < 0.5 ? (k === 0 ? '' : stages[k - 1].name) : stages[k].name;
    caption(px, name, k + 1, K, Math.abs(2 * alpha - 1), (k + local) / K);
    frames.push(px);
    process.stdout.write('\r  ' + (i + 1) + '/' + N + '   ');
  }
  for (let i = 0; i < HOLD(N); i++) frames.push(frames[frames.length - 1]);
  return { frames, label: spec.label };
}

/**
 * The same cross-fade, but every frame is a real render, so the camera can
 * move while the layers accumulate. It costs a second render through each
 * fade - the outgoing layer set has to be drawn from the same viewpoint as
 * the incoming one or the dissolve is a dissolve between two camera angles.
 */
function liveFilm(spec) {
  const A = G.anatomy.buildAnatomy(seed);
  const K = spec.steps.length;
  const fit0 = drafts([0, 0.25, 0.5, 0.75, 1].map(t => spec.stateAt(t, A)), spec.zoom);
  const FADE = 0.42;
  const blank = flat(PAPER);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const u = t * K, k = Math.min(K - 1, Math.floor(u)), local = u - k;
    const alpha = M.smoothstep(M.clamp01(local / FADE));
    const st = spec.stateAt(t, A);
    const fit = recentre(fit0, st, spec.zoom);
    const cur = plate(st, fit, spec.layersAt(k)).px;
    const px = alpha > 0.998 ? cur
      : mix(k === 0 ? blank : plate(st, fit, spec.layersAt(k - 1)).px, cur, alpha);
    const name = alpha < 0.5 ? (k === 0 ? '' : spec.steps[k - 1][1]) : spec.steps[k][1];
    caption(px, name, k + 1, K, Math.abs(2 * alpha - 1), (k + local) / K);
    frames.push(px);
    process.stdout.write('\r  ' + (i + 1) + '/' + N + '   ');
  }
  for (let i = 0; i < HOLD(N); i++) frames.push(frames[frames.length - 1]);
  return { frames, label: spec.label };
}

const MODES = {};

// ---- bones ---------------------------------------------------------------
MODES.bones = () => {
  const label = 'the rig the drawing is derived from';
  const A = G.anatomy.buildAnatomy(seed);
  const ZOOM = 1.24;
  const at = (t) => {
    const e = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    return {
      seed,
      pose: PO.lerpPose(PO.preset(A, 'rest'), PO.preset(A, 'fist'), e * e * (3 - 2 * e)),
      // broadside on the dorsum: seen down its own axis the skeleton stacks
      // into a knot, and the whole point is to watch the phalanges swing
      view: { az: (355 + 22 * Math.sin(t * Math.PI * 2)) * DEG, el: 15 * DEG, roll: 0, zoom: 1 },
    };
  };
  const PROBES = 8;
  const fit0 = drafts(Array.from({ length: PROBES }, (_, k) => at(k / PROBES)), ZOOM);

  // every layer off but the skeleton, so the bones can be lifted out of their
  // own plate rather than guessed at out of the finished one
  const BONE_ONLY = {};
  for (const k in REND.DEFAULT_LAYERS) BONE_ONLY[k] = false;
  BONE_ONLY.bone = true;

  const TINT = [30, 88, 156], JOINT = [206, 74, 44];
  const DOT = S / 560;                    // dots are plate furniture, not scene geometry
  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const st = at(t);
    const fit = recentre(fit0, st, ZOOM);
    // up over the first eighth, down over the last, held wide open between -
    // long enough to watch the bones swing rather than just flash
    const av = M.smoothstep(M.clamp01(t / 0.12)) * (1 - M.smoothstep(M.clamp01((t - 0.86) / 0.14)));
    const full = plate(st, fit);
    const bone = plate(st, fit, BONE_ONLY).px;
    const px = full.px;
    const span = PAPER[0] - 26;
    for (let j = 0; j < S * S; j++) {
      const o = j * 4;
      const k = M.clamp01((PAPER[0] - bone[o]) / span);
      // let the pencil go pale under the x-ray, then lay the bone in over it
      for (let c = 0; c < 3; c++) {
        px[o + c] += (PAPER[c] - px[o + c]) * 0.26 * av;
        px[o + c] += (TINT[c] - px[o + c]) * k * av;
      }
    }
    // ...and the joint centres themselves, which are the 25 numbers the pose
    // actually is - the bones are only what they carry
    const rig = full.built.rig, view = full.built.view;
    for (const dg of rig.digits) {
      for (const j2 of dg.joints) {
        const p = view.px(j2.P);
        disc(px, S, S, p[0], p[1], 3.6 * DOT, JOINT, 0.92 * av);
        disc(px, S, S, p[0], p[1], 1.5 * DOT, [250, 246, 238], 0.95 * av);
      }
      const tp = view.px(dg.tip);
      disc(px, S, S, tp[0], tp[1], 2.4 * DOT, JOINT, 0.72 * av);
    }
    caption(px, '27 bones, 25 DOF', 1, 1, av, 0);
    frames.push(px);
    process.stdout.write('\r  ' + (i + 1) + '/' + N + '   ');
  }
  return { frames, label };
};

// ---- layers --------------------------------------------------------------
// Ordered to follow the camera rather than the source file: a layer that
// arrives while the surface it lives on is pointing away from the eye is a
// caption over a picture that does not change. So the dorsal marks go down
// on the dorsum and the palmar ones as the palm comes round.
const LAYER_ORDER = [
  ['contour', 'contour'], ['tendon', 'tendons'], ['vein', 'veins'],
  ['nail', 'nail'], ['crease', 'crease'], ['fold', 'fold'],
  ['hair', 'hair'], ['hatch', 'skin lattice'], ['print', 'print'],
  ['palmcrease', 'palm creases'], ['ridge', 'friction ridges'], ['model', 'modelling'],
];

MODES.layers = () => {
  const cum = [];
  {
    const on = {};
    for (const k in REND.DEFAULT_LAYERS) on[k] = false;
    for (const [key] of LAYER_ORDER) { on[key] = true; cum.push(Object.assign({}, on)); }
  }
  return liveFilm({
    label: 'the twelve mark layers, in the order they are laid down',
    steps: LAYER_ORDER,
    zoom: 1.12,
    layersAt: (k) => cum[k],
    stateAt: (t, A) => ({
      seed,
      // spread reads every layer at once - nothing hides behind anything -
      // but hyperextended it is a starfish, so relax it back toward rest
      pose: PO.lerpPose(PO.preset(A, 'spread'), PO.preset(A, 'rest'), 0.32),
      // Dorsum to palm the long way round, over the ulnar border. The short
      // way is 140 degrees instead of 220, and it crosses the radial border,
      // where the eye runs down the length of the thumb: there the first web
      // projects to a sliver and the thumb reads as a form lying beside the
      // hand rather than joined to it. Over the little-finger side nothing is
      // ever seen end-on and every frame holds together.
      view: { az: (340 + 220 * t) * DEG, el: 16 * DEG, roll: 0, zoom: 1 },
    }),
  });
};

// ---- depth ---------------------------------------------------------------
/** walk the field once and colour every pixel by the cell that owns it */
function field(df, colorAt) {
  const buf = new Uint8ClampedArray(S * S * 4);
  const div = df.div, W = df.w, H = df.h;
  for (let y = 0; y < S; y++) {
    const cy = Math.min(H - 1, (y / div) | 0);
    for (let x = 0; x < S; x++) {
      const c = colorAt(Math.min(W - 1, (x / div) | 0), cy);
      const o = (y * S + x) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  }
  return buf;
}

MODES.depth = () => stageFilm((A) => {
  // two digits extended, two curled behind them and a thumb across the palm:
  // every kind of overlap the depth field has to get right, in one pose
  const state = { seed, pose: PO.preset(A, 'countThree'), view: { az: 330 * DEG, el: 14 * DEG, roll: 0, zoom: 1 } };
  return {
    label: 'the occlusion machinery, and the ink it produces',
    state, zoom: 1.16,
    stages: (A2, fit) => {
      // one render, and every panel read back off its own structures - not a
      // second pass that could disagree with the drawing it is explaining
      const trace = [];
      const p = plate(Object.assign({ trace }, state), fit);
      const df = p.built.df, ids = p.built.ids, view = p.built.view;
      const total = ids.count;

      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < df.i0.length; i++) {
        if (df.i0[i] === -1) continue;
        if (df.z0[i] < lo) lo = df.z0[i];
        if (df.z0[i] > hi) hi = df.z0[i];
      }
      const span = Math.max(1e-6, hi - lo);

      // Normalised to a high quantile rather than the maximum. Slope peaks at
      // silhouette edges, where the field falls off a cliff and the value is
      // an order of magnitude above anything on a face - divide by that and
      // every interior surface crushes into the bottom of the ramp and the
      // panel is a black hand with a coloured rim.
      const sl = new Float32Array(df.w * df.h);
      const seen = [];
      for (let cy = 0; cy < df.h; cy++) for (let cx = 0; cx < df.w; cx++) {
        const i = cy * df.w + cx;
        sl[i] = df.slope(cx, cy);
        if (df.i0[i] !== -1) seen.push(sl[i]);
      }
      seen.sort((x, y) => x - y);
      const sHi = Math.max(1e-6, seen.length ? seen[Math.floor(seen.length * 0.985)] : 1);

      // Renderer.draw()'s own tolerances, at this plate's scale
      const eps = Math.max(0.30, view.mmPerPx * 1.1);
      const gap = Math.max(0.90, view.mmPerPx * 3.2);

      const points = (color) => {
        const buf = flat(PAPER);
        for (const e of trace) {
          for (const q of e.pts) {
            const id = q[3] === undefined ? -1 : q[3];
            disc(buf, S, S, q[0], q[1], 1.35, color(q, id), 0.95);
          }
        }
        return buf;
      };

      return [
        { name: 'front depth (z0)', px: field(df, (cx, cy) => { const i = cy * df.w + cx; return df.i0[i] === -1 ? EMPTY : grey((df.z0[i] - lo) / span); }) },
        { name: 'part identity', px: field(df, (cx, cy) => idColor(df.i0[cy * df.w + cx], total)) },
        { name: 'second layer', px: field(df, (cx, cy) => idColor(df.i1[cy * df.w + cx], total)) },
        { name: 'depth slope', px: field(df, (cx, cy) => { const i = cy * df.w + cx; return df.i0[i] === -1 ? EMPTY : heat(sl[i] / sHi); }) },
        // green where a point faces the eye with nothing over it, red where
        // something genuinely covers it - the test that decides whether a
        // mark is drawn at all
        { name: 'occlusion test', px: points((q, id) => hid(df.hidden(q[0], q[1], q[2], id, eps, gap))) },
        // ...and how far behind each point the next surface is, which is what
        // decides how hard the line presses: blue where two forms are merging
        // into one, black where an edge stands clear of open air
        {
          name: 'step behind', px: points((q, id) => {
            const s2 = df.stepBehind(q[0], q[1], q[2], id);
            const m = s2 === Infinity ? 1 : 0.16 + 0.84 * M.smoothstep(M.clamp01(s2 / 13));
            // emit()'s weight never falls below 0.16, so plotting m directly
            // spends a sixth of the ramp on values that cannot occur and
            // leaves the merging end of it looking like the middle
            return stops([[62, 128, 192], [128, 122, 110], [22, 20, 18]], (m - 0.16) / 0.84);
          })
        },
        { name: 'the drawing', px: p.px },
      ];
    },
  };
});

// ---- trace ---------------------------------------------------------------
MODES.trace = () => stageFilm((A) => {
  const state = { seed, pose: PO.preset(A, 'spread'), view: { az: 200 * DEG, el: 16 * DEG, roll: 0, zoom: 1 } };
  return {
    label: 'an outline is the border of what the form covers',
    state, zoom: 1.14,
    stages: (A2, fit) => {
      const p = plate(state, fit);
      const rig = p.built.rig, view = p.built.view, df = p.built.df, ids = p.built.ids;
      // Re-run the silhouette trace with a tap on it, so the mask and the raw
      // border walk can be drawn. Same call the renderer makes, same options.
      const caught = [];
      for (let d = 0; d < 5; d++) {
        const c = { d };
        RG.digitSilhouette(rig, view, d, {
          tap: (o) => { if (o.final) c.final = o.final; else Object.assign(c, o); },
        });
        if (c.cov) caught.push(c);
      }
      // Only the digits have a coverage mask - the palm's outline is a swept
      // section and the webs are sheets, neither of which is traced this way.
      // So the rest of the hand's footprint comes off the depth field, in a
      // flat neutral that cannot be mistaken for one of the traced digits.
      // Without it the five masks float apart, and a thumb whose proximal
      // reach is deliberately excluded from its own trace - it is thenar mass
      // carried by the palm, not a tube - reads as amputated.
      const drawSolid = (buf, alpha) => {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const i = Math.min(df.h - 1, (y / df.div) | 0) * df.w + Math.min(df.w - 1, (x / df.div) | 0);
          if (df.i0[i] !== -1) blend(buf, S, S, x, y, [176, 170, 158], alpha);
        }
      };
      const drawMask = (buf, alpha) => {
        drawSolid(buf, alpha * 0.82);
        for (const c of caught) {
          const rgb = hsl(DIGIT_HUE[c.d], 0.52, 0.55);
          for (let cy = 0; cy < c.h; cy++) for (let cx = 0; cx < c.w; cx++) {
            if (!c.cov[cy * c.w + cx]) continue;
            const px0 = (cx - c.pad) * c.cell + c.x0, py0 = (cy - c.pad) * c.cell + c.y0;
            const x1 = Math.ceil(px0 + c.cell), y1 = Math.ceil(py0 + c.cell);
            for (let y = Math.floor(py0); y < y1; y++) for (let x = Math.floor(px0); x < x1; x++) {
              blend(buf, S, S, x, y, rgb, alpha);
            }
          }
        }
      };
      const mask = flat(PAPER); drawMask(mask, 0.92);

      // The walk is a staircase over cell centres and the finished outline is
      // that staircase filtered, resampled and pushed back out along its own
      // normal - at this scale the two are a pixel apart and drawn the same
      // colour they are the same picture. So the walk keeps its own hue and
      // stays underneath the finished curve, where the offset can be seen.
      const WALK = [199, 122, 44];
      const walk = flat(PAPER); drawMask(walk, 0.30);
      for (const c of caught) for (const q of c.raw) disc(walk, S, S, q[0], q[1], 1.05, WALK, 0.95);

      const outline = flat(PAPER); drawMask(outline, 0.16);
      for (const c of caught) for (const q of c.raw) disc(outline, S, S, q[0], q[1], 0.85, WALK, 0.5);
      for (const c of caught) {
        if (!c.final) continue;
        poly(outline, S, S, c.final.map(q => [q[0], q[1]]), 1.35, [26, 25, 23], 0.95, true);
      }

      return [
        { name: 'coverage mask', px: mask },
        { name: 'border walk', px: walk },
        { name: 'traced outline', px: outline },
        { name: 'the drawing', px: p.px },
      ];
    },
  };
});

// =========================================================================
const mode = MODES[which];
if (!mode) { console.error('modes: ' + Object.keys(MODES).join(', ')); process.exit(1); }
const t0 = Date.now();
const { frames, label } = mode();

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
// The depth panels are identity hues and heat scales; reduced to the writer's
// default paper-to-ink ramp a red part and a green one of the same brightness
// come out as one grey. bones tints its x-ray too. Both need a cut palette.
const COLOUR = which === 'depth' || which === 'bones' || which === 'trace';
const bytes = writeGIF(out, frames, S, S, Math.round(100 / 18), undefined, undefined, { color: COLOUR });
console.log('\n' + which + ': ' + label);
console.log('  ' + frames.length + ' frames at ' + S + 'px in ' + ((Date.now() - t0) / 1000).toFixed(1) +
  's -> ' + out + '  ' + (bytes / 1024).toFixed(0) + 'kB');
