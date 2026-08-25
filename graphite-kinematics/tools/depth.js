/* ============================================================================
   GRAPHITE KINEMATICS — tools/depth.js
   A window into the occlusion machinery itself, not into the finished
   drawing. Every contour and every hair of texture the renderer lays down
   answers to three numbers per screen cell — who is in front, who is next,
   and how steep the join between them is — and a wrong drawing is always one
   of those three numbers lying. Squinting at the finished pencil image
   cannot show which one: two forms merging smoothly and two forms meeting at
   a hard edge can read as nearly the same tone of graphite, and a line
   missing over open air looks exactly like a line correctly suppressed
   because a knuckle stands in front of it. This tool renders the three
   numbers directly, instead of the ink they eventually produce.

   A correct depth field, seen through these six views, looks like this:
     z / slope   smooth, continuous bowls over every solid part, with
                 cliffs only at true silhouette edges - never a crease
                 splitting a part that should read as one continuous form.
     id / layer2 each digit and the palm as one solid, unbroken, well
                 separated colour, with no finger of one part's colour
                 bleeding into a neighbour's footprint.
     hidden      green wherever a surface faces the eye with nothing in
                 front of it, reddening smoothly only where another part
                 genuinely covers it - never a red patch sitting in open
                 air, never a green dot on a point that plainly sits behind
                 something else.
     over        a dark, confident line wherever a form's edge stands proud
                 of whatever is behind it, fading pale only at a seam where
                 two forms are truly merging into one continuous surface.
   The opposite of any of those is the bug: an id map leaking one part's
   colour across a boundary it does not own; a hidden map killing a line
   that has nothing in front of it, or keeping one that plainly is buried;
   an over map going dark across what should be a soft merge, which is
   exactly what draws a line slicing across a form meant to read as one
   continuous piece of flesh.

   Usage:
     node tools/depth.js <mode> <preset> <seed> <az> <el> [out.png] [size]
     mode: z | id | layer2 | slope | hidden | over | split
     env BALL=<mm>   put a ball in the hand, the way tools/ball.js does
     env MONTAGE=1   force the 2x3 grid regardless of <mode>
     env SOFT=<0..1> contact softness when BALL is set (default 1)

   Every number plotted here comes straight out of the renderer's own
   DepthField, rasterise() and buildIds() (src/60-render.js), called exactly
   as Renderer itself calls them - nothing about the depth field or the
   identity scheme is reimplemented. A handful of small constants live only
   as private numbers inside Renderer.draw()/_contours(), unreachable any
   other way without a source edit; each is copied verbatim below with a
   comment pointing at the line it came from, so a drift between the two
   copies is visible rather than silent.
   ========================================================================== */
'use strict';
global.window = {};
const fs = require('fs');
const path = require('path');

// This file is developed and run from outside the project (see the task's
// own notes on why), so __dirname/.. is not reliably the project root the
// way it is for every other tool in tools/. Try that first anyway - it is
// exactly right if this file is later copied into the real tools/ folder -
// and fall back to the known checkout so the tool keeps working wherever it
// actually lives. This is the one thing worth getting right before anything
// else: get it wrong and every mode below fails at the very first require.
const ROOT = [path.join(__dirname, '..'), '/home/user/demo/graphite-kinematics']
  .find(p => fs.existsSync(path.join(p, 'src', '60-render.js'))) || '/home/user/demo/graphite-kinematics';

['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(ROOT, 'src', f + '.js')));
const writePNG = require(path.join(ROOT, 'tools', 'png.js'));

const G = window.GK;
const M = G.math, AN = G.anatomy, RG = G.rig, PO = G.pose, REND = G.render;
const DEG = M.DEG;

// =========================================================================
//  COLOUR
// =========================================================================

// Deliberately dark and desaturated, so it can never be mistaken for one of
// idColor()'s saturated hues: this is "no data", not "part zero".
const EMPTY_FLAT = [44, 48, 58];

function greyOf(t) {
  const g = Math.round(M.lerp(28, 246, M.clamp01(t)));
  return [g, g, g];
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  const i = Math.floor(h * 6);
  if (i === 0) { r = c; g = x; b = 0; }
  else if (i === 1) { r = x; g = c; b = 0; }
  else if (i === 2) { r = 0; g = c; b = x; }
  else if (i === 3) { r = 0; g = x; b = c; }
  else if (i === 4) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

/** a step around an n-point hue wheel that lands on every point exactly once, chosen away from the low stride values that would leave neighbouring ids on neighbouring hues */
function wheelStride(n) {
  let k = Math.max(1, Math.round(n * 0.382));
  while (gcd(k, n) !== 1) k = (k % (n - 1)) + 1;
  return k;
}

/**
 * Part identity never changes shape from one render to the next: buildIds()
 * hands ids out in a fixed walk - the palm, then each digit's rendered
 * segments in digit/segment order, then the ball - that depends only on
 * which segments exist, never on pose. So id 7 is "middle/PP" in a fist and
 * in a spread hand alike, and ids.count is always exactly 16 or 17. That
 * makes this a small, fixed palette rather than an open-ended one, and a
 * fixed wheel of n evenly spaced hues does something a golden-angle
 * sequence cannot: guarantee a 360/n minimum separation between every pair
 * of ids actually in play. (A golden-angle sequence of 17 colours was tried
 * first here and its closest pair - two unrelated segments - landed 12
 * degrees apart purely by coincidence, which is exactly the kind of
 * accidental near-collision this tool exists to catch in the *data*, so it
 * had no business being in the *legend*.) The wheel is walked in a
 * shuffled stride rather than id order, so consecutive ids - which are
 * consecutive phalanges of one finger far more often than not, i.e.
 * exactly the parts most likely to sit side by side on screen - land far
 * apart on the wheel instead of next to it. Alternating the lightness by
 * wheel slot adds a second, cheap margin for the one pair of ids that is
 * always exactly one wheel-step (so ~360/n degrees of hue) apart.
 */
function idColor(id, total) {
  if (id === undefined || id < 0) return EMPTY_FLAT;
  const n = Math.max(1, total || 17);
  const slot = (id * wheelStride(n)) % n;
  return hslToRgb((slot / n) * 360, 0.62, slot % 2 === 0 ? 0.46 : 0.60);
}

function stopLerp(stops, t) {
  const n = stops.length - 1, f = M.clamp01(t) * n, i = Math.min(n - 1, Math.floor(f)), fr = f - i;
  const a = stops[i], b = stops[i + 1];
  return [Math.round(M.lerp(a[0], b[0], fr)), Math.round(M.lerp(a[1], b[1], fr)), Math.round(M.lerp(a[2], b[2], fr))];
}

const HEAT_STOPS = [[18, 20, 46], [24, 116, 132], [237, 202, 64], [214, 44, 36]];
function heatColor(t) { return stopLerp(HEAT_STOPS, t); }

// hidden() already returns 0 (clear) .. 1 (buried), so this is a straight
// read of that scale: green at 0, red at 1, amber the midpoint between.
const HID_STOPS = [[46, 160, 67], [224, 168, 44], [199, 42, 42]];
function hidColor(t) { return stopLerp(HID_STOPS, t); }

/**
 * Pale parchment at merge=0 (two forms genuinely merging, the renderer's own
 * weight floor) through to near-black graphite at merge=1 (a contour
 * standing clear of whatever is behind it, or drawn against nothing at
 * all). Reading this as ink density rather than an abstract heat scale is
 * deliberate - it is literally answering "how dark would this line draw".
 */
function overColor(t) {
  t = M.clamp01(t);
  return [Math.round(M.lerp(232, 26, t)), Math.round(M.lerp(224, 24, t)), Math.round(M.lerp(206, 22, t))];
}

/**
 * Renderer._contours()'s own step -> weight curve, copied verbatim from
 * emit() in src/60-render.js:
 *   const merge = step === Infinity ? 1 : 0.16 + 0.84 * smoothstep(clamp01(step / 13));
 * An infinite step (a contour drawn against open air) is full strength;
 * anything within about 13mm of the next surface eases toward the 0.16
 * floor instead of vanishing outright, because a shallow step can still sit
 * on a real, hard turn of the surface (emit()'s `turn` term, folded in
 * there from slopeAt() - not reproduced here, since this panel is
 * specifically about what the step alone says).
 */
function mergeFromStep(step) {
  return step === Infinity ? 1 : 0.16 + 0.84 * M.smoothstep(M.clamp01(step / 13));
}

// =========================================================================
//  DEPTH-FIELD CELL IMAGES  (z, id, layer2, slope)
// =========================================================================

/** walk the field once, colouring every screen pixel by its owning cell */
function renderCellField(df, size, cellColor) {
  const buf = new Uint8ClampedArray(size * size * 4);
  const div = df.div, W = df.w, H = df.h;
  for (let y = 0; y < size; y++) {
    const cy = Math.min(H - 1, (y / div) | 0);
    for (let x = 0; x < size; x++) {
      const cx = Math.min(W - 1, (x / div) | 0);
      const c = cellColor(cx, cy);
      const o = (y * size + x) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  }
  return buf;
}

function buildZRange(df) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < df.i0.length; i++) {
    if (df.i0[i] === -1) continue;
    const z = df.z0[i];
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return isFinite(lo) ? [lo, hi] : [0, 1];
}

function renderZ(df, size) {
  const [lo, hi] = buildZRange(df);
  const span = Math.max(1e-6, hi - lo);
  return renderCellField(df, size, (cx, cy) => {
    const i = cy * df.w + cx;
    return df.i0[i] === -1 ? EMPTY_FLAT : greyOf((df.z0[i] - lo) / span);
  });
}

function renderId(df, size, layer, total) {
  const arr = layer === 'i0' ? df.i0 : df.i1;
  return renderCellField(df, size, (cx, cy) => idColor(arr[cy * df.w + cx], total));
}

function renderSlope(df, size) {
  const W = df.w, H = df.h;
  const sl = new Float32Array(W * H);
  let hi = 1e-6;
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      const s = df.slope(cx, cy);
      sl[i] = s;
      if (df.i0[i] !== -1 && s > hi) hi = s;
    }
  }
  return renderCellField(df, size, (cx, cy) => {
    const i = cy * W + cx;
    return df.i0[i] === -1 ? EMPTY_FLAT : heatColor(sl[i] / hi);
  });
}

// =========================================================================
//  CONTOUR AND CURVE POINTS  (hidden, over)
//
//  These two modes re-run the SAME emission the renderer does - the same
//  border walks, the same ladders, the same feature curves - and then read
//  hidden()/stepBehind() straight off the real DepthField for every point,
//  rather than inferring anything from the finished ink. What gets
//  duplicated here is only the plumbing that turns rig geometry into (x, y,
//  z, partId) tuples; _contours()'s own weighting for stroke width, taper,
//  search lines and ghosting is not, because none of that changes whether a
//  point is occluded.
// =========================================================================

/**
 * The digit outlines, knuckle rings, palm silhouette, first-web band, the
 * three inter-finger web margins and the ball outline: every contour source
 * _contours() emits, gathered via the exact same rig functions and options
 * it calls, before any occlusion test runs.
 */
function gatherContourSources(built) {
  const { rig, view, ids } = built;
  const src = [];
  const fw = RG.firstWeb(rig, view);

  for (let d = 0; d < 5; d++) {
    const sil = RG.digitSilhouette(rig, view, d);
    if (sil.use) {
      let outline = sil.outline;
      // The thumb's own edge running into the first web is tissue shared
      // with the web, not a free edge of the thumb - _contours() damps the
      // outline's weight there so it never draws a seam across the
      // commissure. Skip that damping here and every hand shows a false
      // "defect" running the length of the thumb's ulnar flank.
      if (d === AN.THUMB) {
        const webAngles = fw.thSide.map(P => view.px(P));
        outline = outline.map((p) => {
          let near = 9;
          for (const w of webAngles) {
            const dd = Math.hypot(p[0] - w[0], p[1] - w[1]);
            if (dd < near) near = dd;
          }
          return [p[0], p[1], p[2], p[3], p[4] * M.smoothstep(M.clamp01((near - 5) / 16))];
        });
      }
      src.push({ name: 'outline/' + AN.DIGIT_NAMES[d], selfTest: false, pts: outline });
    }
    for (const ring of RG.knuckleRings(rig, view, d)) {
      src.push({ name: 'knuckle/' + AN.DIGIT_NAMES[d], selfTest: true, pts: ring });
    }
  }

  // Same options _contours() passes to palmSilhouette(), and the same fade
  // it tags sideA/sideB/cap with (tagPalm() there) - copied verbatim so a
  // point near the wrist, already fading out for framing reasons, is not
  // misread here as an occlusion casualty.
  const u0 = -0.44, u1 = 1.030;
  const psil = RG.palmSilhouette(rig, view, { nu: 56, nb: 96, u0, u1 });
  const tagPalm = (arr, fade) => arr.map((p, k) => {
    const u = M.lerp(u0, u1, k / (arr.length - 1));
    const gain = fade === false ? 1 : M.smoothstep(M.clamp01((u + 0.40) / 0.30));
    return [p[0], p[1], p[2], ids.palm, gain];
  });
  src.push({ name: 'palm/sideA', selfTest: true, pts: tagPalm(psil.sideA, true) });
  src.push({ name: 'palm/sideB', selfTest: true, pts: tagPalm(psil.sideB, true) });
  src.push({ name: 'palm/cap', selfTest: true, pts: tagPalm(psil.cap, false) });

  src.push({ name: 'web/commissure', selfTest: true, pts: fw.band });
  RG.webContours(rig, view).forEach((w, i) => src.push({ name: 'web/margin' + i, selfTest: false, pts: w }));

  if (rig.ball) {
    const bo = REND.ballOutline(rig.ball, view).map(p => [p[0], p[1], p[2], ids.ball, 1]);
    src.push({ name: 'ball/outline', selfTest: false, pts: bo });
  }
  return src;
}

/** score every gathered contour point against the real depth field */
function scoreContourPoints(built, sources) {
  const { df, view } = built;
  // The exact tolerances Renderer.draw() derives from view.mmPerPx, one
  // line above its call into _contours() in src/60-render.js:
  //   const eps = Math.max(0.30, view.mmPerPx * 1.1);
  //   const gap = Math.max(0.90, view.mmPerPx * 3.2);
  // Copied verbatim so this tool tests occlusion at the tolerance a real
  // render actually uses, not a guessed one.
  const eps = Math.max(0.30, view.mmPerPx * 1.1);
  const gap = Math.max(0.90, view.mmPerPx * 3.2);
  // emit()'s own selfTest pass (palm sheet, first-web band, knuckle rings):
  //   const selfTol = opts.selfTest ? eps * 3 + 1.6 : 0;
  //   v *= 1 - df.hidden(..., selfTol, gap * 2, true);
  const selfTol = eps * 3 + 1.6, selfGap = gap * 2;
  const out = [];
  for (const s of sources) {
    for (const p of s.pts) {
      const x = p[0], y = p[1], near = p[2], id = p[3];
      const gain = p[4] === undefined ? 1 : p[4];
      const hidBase = df.hidden(x, y, near, id, eps, gap);
      let hid = hidBase;
      if (s.selfTest) {
        const hidSelf = df.hidden(x, y, near, id, selfTol, selfGap, true);
        hid = 1 - (1 - hidBase) * (1 - hidSelf);
      }
      out.push({ x, y, near, id, alpha: gain, hid, step: df.stepBehind(x, y, near, id), src: s.name });
    }
  }
  return out;
}

/** project every feature curve exactly as draw()'s curve loop does, plus the raw hidden()/stepBehind() the render loop never exposes */
function projectAllCurves(built) {
  const { rig, view, df, ids, curves } = built;
  const eps = Math.max(0.30, view.mmPerPx * 1.1);
  const gap = Math.max(0.90, view.mmPerPx * 3.2);
  const out = [];
  for (const cv of curves) {
    // The skeleton (xray) layer takes no occlusion test at all in the real
    // renderer - it is construction, drawn straight through the flesh that
    // contains it - so a hidden() value for it would describe a test the
    // drawing never actually runs.
    if (cv.xray) continue;
    const myId = cv.on === 'digit' ? ids.digit[cv.d][cv.seg] : cv.on === 'palm' ? ids.palm : -1;
    const proj = REND.projectCurve(rig, view, df, cv, { eps, gap, ids });
    for (const p of proj) {
      const x = p[0], y = p[1], finalVis = p[2], near = p[3];
      out.push({
        x, y, near, id: myId, alpha: finalVis,
        hid: df.hidden(x, y, near, myId, eps, gap),
        step: df.stepBehind(x, y, near, myId),
        src: 'curve/' + ((cv.style && cv.style.layer) || '?')
      });
    }
  }
  return out;
}

function gatherAllPoints(built) {
  const curvePts = projectAllCurves(built);
  const contourPts = scoreContourPoints(built, gatherContourSources(built));
  return { curvePts, contourPts, all: contourPts.concat(curvePts) };
}

// =========================================================================
//  PLOTTING  (backdrop + dots + colour-bar, shared by hidden/over/split)
// =========================================================================

/** the actual pencil render, pushed toward paper so colour dots read clearly on top */
function fadeBackdrop(px, size) {
  const buf = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    buf[o] = M.lerp(px[o], 236, 0.60);
    buf[o + 1] = M.lerp(px[o + 1], 233, 0.60);
    buf[o + 2] = M.lerp(px[o + 2], 224, 0.60);
    buf[o + 3] = 255;
  }
  return buf;
}

function plotDot(buf, size, x, y, rgb, a) {
  const xi = Math.round(x), yi = Math.round(y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = xi + dx, yy = yi + dy;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const w = (dx === 0 && dy === 0) ? 1 : (dx * dx + dy * dy <= 1 ? 0.55 : 0.16);
      const k = a * w;
      const o = (yy * size + xx) * 4;
      buf[o] = buf[o] * (1 - k) + rgb[0] * k;
      buf[o + 1] = buf[o + 1] * (1 - k) + rgb[1] * k;
      buf[o + 2] = buf[o + 2] * (1 - k) + rgb[2] * k;
      buf[o + 3] = 255;
    }
  }
}

/**
 * A low-weight point - a knuckle ring's non-grazing arc, a curve sample the
 * horizon has nearly faded out - would draw little or no graphite in the
 * real render. Shown at full strength here it would swamp the picture with
 * marks that never actually appear, so prominence follows the same weight
 * the renderer would give the point (curves: projectCurve's own visibility;
 * contours: the geometry generator's own gain), floored so nothing is ever
 * fully invisible in a diagnostic - the point still exists and can still be
 * inspected, just quietly.
 */
function plotDotsInPlace(buf, size, pts, colorFn) {
  for (const p of pts) {
    if (p.x < -3 || p.y < -3 || p.x >= size + 3 || p.y >= size + 3) continue;
    const a = 0.14 + 0.86 * M.clamp01(p.alpha === undefined ? 1 : p.alpha);
    plotDot(buf, size, p.x, p.y, colorFn(p), a);
  }
}

function paintColorbar(buf, size, colorFn) {
  const h = Math.max(10, Math.round(size * 0.018));
  for (let y = size - h; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = colorFn(x / (size - 1));
      const o = (y * size + x) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  }
}

// =========================================================================
//  SCENE
// =========================================================================

function buildScene(presetKey, seed, az, el, size, ballMm) {
  const A = AN.buildAnatomy(seed);
  let pose = PO.preset(A, presetKey);
  let contacts, soft;
  if (ballMm > 0) {
    pose = PO.holdBall(A, pose, ballMm);
    // holdBall() already resolves the finger contacts against the ball
    // itself; re-running the generic contact solve on top would fight that
    // solve, which is why tools/ball.js turns it off too.
    contacts = false;
    soft = process.env.SOFT === undefined ? 1 : +process.env.SOFT;
  }
  const r = new REND.Renderer(size, size);
  const built = r.draw({
    seed, pose, ball: pose.ball,
    view: { az, el, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0.20, search: 0.55 },
    detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
    contacts, soft, quality: 1
  });
  const px = r.resolve({ style: {} });
  return { A, r, built, px };
}

function idNames(rig, ids) {
  const names = new Map();
  names.set(ids.palm, 'palm');
  for (let d = 0; d < 5; d++) {
    for (const sg of rig.digits[d].segs) {
      if (sg.pid === undefined || sg.pid === -1) continue;
      names.set(sg.pid, rig.digits[d].name + '/' + sg.name);
    }
  }
  if (ids.ball !== undefined) names.set(ids.ball, 'ball');
  return names;
}

// =========================================================================
//  MODE DISPATCH
// =========================================================================

function renderMode(mode, scene, size, pts) {
  const { built } = scene;
  const df = built.df;
  if (mode === 'z') { const b = renderZ(df, size); paintColorbar(b, size, greyOf); return b; }
  if (mode === 'id') return renderId(df, size, 'i0', built.ids.count);
  if (mode === 'layer2') return renderId(df, size, 'i1', built.ids.count);
  if (mode === 'slope') { const b = renderSlope(df, size); paintColorbar(b, size, heatColor); return b; }
  if (mode === 'hidden') {
    const b = fadeBackdrop(scene.px, size);
    plotDotsInPlace(b, size, pts.all, p => hidColor(p.hid));
    paintColorbar(b, size, hidColor);
    return b;
  }
  if (mode === 'over') {
    // stepBehind() is only ever consulted by _contours()/emit() - the real
    // renderer never calls it for feature curves (their loop in draw() uses
    // only hidden() and behind()). Folding curve points in here anyway
    // would be actively misleading rather than merely superfluous: a crease
    // or ridge drawn on an otherwise-exposed patch of skin has nothing
    // behind it by construction, so it would test as step=Infinity and
    // paint full-strength black regardless of whether anything is actually
    // wrong there - a permanent false alarm, not a diagnostic. Restricting
    // this panel to contour points keeps it answering the question the
    // task actually asks: how big a step the *contour* is describing.
    const b = fadeBackdrop(scene.px, size);
    plotDotsInPlace(b, size, pts.contourPts, p => overColor(mergeFromStep(p.step)));
    paintColorbar(b, size, overColor);
    return b;
  }
  throw new Error('unknown mode ' + mode);
}

function composeMontage(scene, size, out, pts) {
  const order = ['z', 'id', 'layer2', 'slope', 'hidden', 'over'];
  const gutter = Math.max(2, Math.round(size * 0.012));
  const cols = 3, rows = 2;
  const W = cols * size + gutter * (cols - 1), H = rows * size + gutter * (rows - 1);
  const big = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    big[o] = 200; big[o + 1] = 196; big[o + 2] = 188; big[o + 3] = 255;
  }
  order.forEach((mode, idx) => {
    const buf = renderMode(mode, scene, size, pts);
    const cx = (idx % cols) * (size + gutter), cy = Math.floor(idx / cols) * (size + gutter);
    for (let y = 0; y < size; y++) {
      const src = y * size * 4, dst = ((cy + y) * W + cx) * 4;
      big.set(buf.subarray(src, src + size * 4), dst);
    }
  });
  writePNG(out, big, W, H);
  console.log('split -> ' + out + '  ' + W + 'x' + H +
    '   (top row: z, id, layer2  |  bottom row: slope, hidden, over)');
}

// =========================================================================
//  TEXT SUMMARY — the measurable half of this tool
// =========================================================================

function printIdLegend(built) {
  const names = idNames(built.rig, built.ids);
  const parts = [];
  for (let id = 0; id < built.ids.count; id++) parts.push(id + '=' + (names.get(id) || '?'));
  console.log('ids: ' + parts.join('  '));
}

function printSummary(built, pts) {
  const { rig, ids, df } = built;
  const names = idNames(rig, ids);
  const N = df.w * df.h;
  const i0Count = new Array(ids.count).fill(0), i1Count = new Array(ids.count).fill(0);
  const lo = new Array(ids.count).fill(Infinity), hi = new Array(ids.count).fill(-Infinity);
  for (let i = 0; i < N; i++) {
    const a = df.i0[i];
    if (a >= 0) { i0Count[a]++; const z = df.z0[i]; if (z < lo[a]) lo[a] = z; if (z > hi[a]) hi[a] = z; }
    const b = df.i1[i];
    if (b >= 0) { i1Count[b]++; const z = df.z1[i]; if (z < lo[b]) lo[b] = z; if (z > hi[b]) hi[b] = z; }
  }
  console.log('\nper-part depth-field occupancy (cells at div=' + df.div + ', ' + df.w + 'x' + df.h +
    '; depth in mm along the view axis, larger = nearer the eye):');
  for (let id = 0; id < ids.count; id++) {
    const range = isFinite(lo[id]) ? lo[id].toFixed(1) + ' .. ' + hi[id].toFixed(1) : 'n/a (owns nothing)';
    console.log('  ' + String(id).padStart(2) + '  ' + (names.get(id) || '?').padEnd(14) +
      'front ' + String(i0Count[id]).padStart(6) + '   back ' + String(i1Count[id]).padStart(6) +
      '   z ' + range);
  }

  const bucket = (arr) => {
    const b = { visible: 0, partial: 0, buried: 0 };
    for (const p of arr) { if (p.hid < 0.15) b.visible++; else if (p.hid > 0.85) b.buried++; else b.partial++; }
    return b;
  };
  const cb = bucket(pts.contourPts), fb = bucket(pts.curvePts);
  console.log('\ncontour points by hidden()  [visible <0.15, buried >0.85, partial between]');
  console.log('  visible ' + cb.visible + '   partial ' + cb.partial + '   buried ' + cb.buried +
    '   of ' + pts.contourPts.length + ' (the silhouette walk: outlines, knuckle rings, palm, web, ball)');
  console.log('feature-curve points by hidden()');
  console.log('  visible ' + fb.visible + '   partial ' + fb.partial + '   buried ' + fb.buried +
    '   of ' + pts.curvePts.length + ' (creases, ridges, prints, veins, hair, lattice, ...)');

  console.log('\ncontour occlusion by source  (visible/partial/buried of total points tested):');
  const bySrc = new Map();
  for (const p of pts.contourPts) {
    if (!bySrc.has(p.src)) bySrc.set(p.src, { visible: 0, partial: 0, buried: 0, total: 0 });
    const s = bySrc.get(p.src);
    s.total++;
    if (p.hid < 0.15) s.visible++; else if (p.hid > 0.85) s.buried++; else s.partial++;
  }
  for (const name of [...bySrc.keys()].sort()) {
    const s = bySrc.get(name);
    console.log('  ' + name.padEnd(18) + s.visible + '/' + s.partial + '/' + s.buried + '  of ' + s.total);
  }

  const finite = pts.contourPts.map(p => p.step).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = (f) => finite.length ? finite[Math.min(finite.length - 1, Math.floor(finite.length * f))].toFixed(1) : 'n/a';
  const infCount = pts.contourPts.length - finite.length;
  console.log('\ncontour stepBehind, mm  (how strong an edge the contour is describing; this is what sets contour weight):');
  console.log('  p10 ' + pct(0.1) + '   median ' + pct(0.5) + '   p90 ' + pct(0.9) +
    '   drawn against open air (step=Infinity): ' + infCount + ' of ' + pts.contourPts.length);
}

// =========================================================================
//  CLI
// =========================================================================

function main() {
  const MODES = ['z', 'id', 'layer2', 'slope', 'hidden', 'over', 'split'];
  const args = process.argv.slice(2);
  const mode = args[0];
  if (!mode || !MODES.includes(mode)) {
    console.log('Usage: node tools/depth.js <mode> <preset> <seed> <az> <el> [out.png] [size]');
    console.log('  mode: ' + MODES.join(' | ') + '   (split, or env MONTAGE=1, writes all six as one 2x3 grid)');
    console.log('  env BALL=<mm>    put a ball in the hand, as tools/ball.js does');
    console.log('  env SOFT=<0..1>  contact softness when BALL is set (default 1)');
    process.exit(mode ? 1 : 0);
    return;
  }
  const presetKey = args[1] || 'rest';
  const seed = parseInt(args[2] || '12345', 10);
  const az = parseFloat(args[3] || '0') * DEG;
  const el = parseFloat(args[4] || '0') * DEG;
  const out = args[5] || '/tmp/depth.png';
  const size = parseInt(args[6] || '900', 10);
  const ballMm = process.env.BALL ? parseFloat(process.env.BALL) : 0;
  const montage = mode === 'split' || process.env.MONTAGE === '1';

  const t0 = Date.now();
  const scene = buildScene(presetKey, seed, az, el, size, ballMm);
  const built = scene.built;
  const pts = gatherAllPoints(built);

  console.log('== ' + presetKey + '  seed ' + seed + '  az ' + (az / DEG).toFixed(0) +
    '  el ' + (el / DEG).toFixed(0) + (ballMm ? '  ball ' + ballMm + 'mm' : '') +
    '  curves ' + built.curves.length + '  draw ' + built.ms + 'ms ==');
  printIdLegend(built);

  if (montage) {
    composeMontage(scene, size, out, pts);
  } else {
    const buf = renderMode(mode, scene, size, pts);
    writePNG(out, buf, size, size);
    console.log(mode + ' -> ' + out + '  ' + size + 'x' + size);
  }
  printSummary(built, pts);
  console.log('\n' + (Date.now() - t0) + 'ms total');
}

main();
