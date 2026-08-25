/* Ground-truth interpenetration for the generative hand model.

   Every other check in this repository measures a proxy for interpenetration
   - two bone segments treated as capsules of a fixed radius, or a fingertip
   sampled at three points and compared to one probe of the palm. Those are
   cheap and they have caught real bugs, but they are not what the renderer
   actually draws: a digit's true cross-section is an elliptical profile that
   changes with s and, for the thumb's metacarpal, is not even centred on the
   bone axis, and the palm is a swept sheet with separate palmar and dorsal
   thickness fields rather than a slab of constant depth. A capsule proxy can
   both under- and over-report against that shape. So this file re-derives
   "inside" from the same surface functions the renderer itself calls -
   digitSurface, segmentProfile, sectionCenter, palmSpine, palmThickPalmar/
   Dorsal - and asks, for a dense sample of one part's surface, how far each
   point sits inside every other part's solid. That is a slower measurement
   than a capsule check and a noisier one to write, but it cannot be lied to
   by a shape the capsule never modelled.

   Two checks live here. The first sweeps all eighteen presets across many
   seeds and measures digit-against-digit and digit-against-palm
   interpenetration - the hand against itself. The second closes the hand on
   a ball at a few radii and measures the hand against something it holds:
   whether each pad actually reaches the ball, whether anything is driven
   through it, and whether the joint chain that got it there is a plausible
   one. The second check exists because of a specific, documented history:
   src/30-pose.js's contact solver once threw the ring finger thirty degrees
   back out of its own grip in a single iteration and then left it stranded
   there, latched as "arrived" when it was thirty-two millimetres off the
   ball. That is exactly the kind of defect a capsule-radius check cannot
   see, because by the time the pose is handed to one, the joint angles
   already look like numbers rather than like a mistake.

   Measured throughout against the RIGID, undeformed surfaces - rig.soft is
   never set here, so digitSurface and palmSurface return the true kinematic
   solid rather than the surface softContact would push back to the ball's
   radius at render time. Rendering's soft press is a cosmetic fix for a
   surface that is already known to be interpenetrating; asking it "how deep"
   would just measure how good the cosmetic fix is, which is a different and
   much less useful question than the one this file exists to answer.

   This file lives outside the project tree - it is developed and run
   against a checkout it is not permitted to write into - so the source
   modules below are loaded by an absolute path rather than one relative to
   this file.

   Usage: node collide.js                                                   */
global.window = {};
const path = require('path');
const SRC = '/home/user/demo/graphite-kinematics/src';
['00-math', '10-anatomy', '20-rig', '30-pose'].forEach(f => require(path.join(SRC, f + '.js')));
const G = window.GK, M = G.math, AN = G.anatomy, RG = G.rig, PO = G.pose;
const DEG = M.DEG;

// A couple of millimetres is soft tissue: real skin over a knuckle or a
// fingerpad compresses that much under ordinary contact, and the renderer's
// own contact solver is deliberately left with slack of a similar order (see
// `tol` in resolveContacts) rather than driven to an exact zero. Past a
// centimetre or so there is no tissue left to give - that is two solids
// occupying the same bone-and-cartilage space, which is what this file is
// for. The threshold below sits close to the tissue end of that range, so it
// flags real defects without flagging the ordinary give of a closed fist.
const ISSUE_MM = 2.0;

/* ==========================================================================
   INSIDE-TESTS
   One per kind of solid in the scene. Each takes a world point and returns
   either null (outside) or a millimetre depth: how far the point would have
   to move outward - along the section's own radial direction for a digit,
   along the spine's normal for the palm, along the radius for the ball - to
   reach that solid's surface. Depth is therefore always a distance to a
   *specific* surface point, not merely a same-sign inequality, which is what
   lets the two checks below report "how bad", not just "bad or not".
   ========================================================================== */

/**
 * How far P sits inside digit d's segment `seg`, in mm, or null if P falls
 * outside the segment's own span of s. sg.t/ul/dor are an orthonormal frame
 * (mOrtho guarantees it at every joint), so projecting P onto them recovers
 * its position along the bone and its offset from the section centre with no
 * approximation. The offset is then measured against the elliptical profile
 * segmentProfile actually draws with, in the plane perpendicular to the
 * bone at that s - which is what makes this correct for the thumb's
 * metacarpal, whose section centre is not the bone axis (see sectionOffset
 * in rig.js): sectionCenter already carries that displacement, so it falls
 * out of the offset for free rather than needing special-casing here.
 */
function insideDigit(rig, d, seg, P) {
  const sg = rig.digits[d].segs[seg];
  const s = M.vdot(M.vsub(P, sg.A), sg.t) / sg.len;
  if (s < sg.sMin || s > sg.sMax) return null;
  const pr = AN.segmentProfile(rig.anatomy, d, seg, s);
  const a = Math.max(1e-6, pr[0]), b = Math.max(1e-6, pr[1]);
  const C = RG.sectionCenter(rig, d, seg, s);
  const rel = M.vsub(P, C);
  const du = M.vdot(rel, sg.ul), dd = M.vdot(rel, sg.dor);
  const dist = Math.hypot(du, dd);
  // dead centre: no radial direction to name, so report the depth to the
  // nearest wall rather than divide by a zero distance
  if (dist < 1e-9) return { depth: Math.min(a, b), s, alpha: 0 };
  const ratio = Math.hypot(du / a, dd / b);        // 1 on the ellipse, <1 inside
  if (ratio >= 1) return null;
  return { depth: dist * (1 / ratio - 1), s, alpha: Math.atan2(dd, du) };
}

// How far, laterally, a point may sit from the nearest interior point of the
// palm sheet and still be considered "over" it rather than beside it. This
// is the same probe radius validate.js's intoPalm has used since the palm
// first carried real thickness; it is generous enough to survive the search
// grid's own discretisation error and tight enough that a point genuinely
// off the sheet's edge is not mistaken for one buried in its thickness.
const PALM_LAT_TOL = 6;
// slack on the distal cap, in u (the palm's own parameter, not millimetres);
// one metacarpal-length in u is roughly 60-70mm, so this is under a
// millimetre of give at the edge where the solid ends and the web begins
const PALM_UCAP_SLACK = 0.015;

/**
 * Locate the point on the palm sheet nearest P, by grid search rather than
 * closed form - the sheet is a Catmull-Rom surface over an irregular v range
 * that itself depends on u (vLo/vHi), so there is no direct inverse. Coarse
 * first, over the whole sheet, so nothing can hide from it in a pose that
 * puts P somewhere unexpected; then a local refinement around the coarse
 * winner, since the sheet is smooth enough that the coarse cell already
 * contains the true nearest point.
 */
function nearestPalmPatch(rig, P) {
  const palm = rig.palm;
  let best = null;
  const probe = (u, v) => {
    const sp = RG.palmSpine(rig, u, v);
    const rel = M.vsub(P, sp.P);
    const off = M.vdot(rel, sp.n);
    const lat = M.vlen(M.vsub(rel, M.vmul(sp.n, off)));
    if (!best || lat < best.lat) best = { u, v, off, lat };
  };
  const NU1 = 14, NV1 = 12;
  for (let iu = 0; iu <= NU1; iu++) {
    const u = M.lerp(palm.u0, palm.u1, iu / NU1);
    const lo = palm.vLo(u), hi = palm.vHi(u);
    for (let iv = 0; iv <= NV1; iv++) probe(u, M.lerp(lo, hi, iv / NV1));
  }
  const cu = best.u, cv = best.v;
  const uStep = (palm.u1 - palm.u0) / NU1;
  const vStep = (palm.vHi(cu) - palm.vLo(cu)) / NV1;
  const NU2 = 8, NV2 = 8;
  for (let iu = 0; iu <= NU2; iu++) {
    const u = M.clamp(cu + uStep * (iu / NU2 * 2 - 1), palm.u0, palm.u1);
    const lo = palm.vLo(u), hi = palm.vHi(u);
    for (let iv = 0; iv <= NV2; iv++) {
      const v = M.clamp(cv + vStep * (iv / NV2 * 2 - 1), lo, hi);
      probe(u, v);
    }
  }
  return best;
}

/**
 * beta on the palmar (or dorsal) half of the section at (u) whose v matches
 * `target`. v runs vLo->vHi monotonically as beta sweeps the palmar half
 * (0..0.5) and vHi->vLo as it sweeps the dorsal half (0.5..1) - see
 * palmSurface - so each half has one root and bisection finds it safely.
 */
function bisectBetaForV(rig, u, target, b0, b1, increasing) {
  for (let i = 0; i < 24; i++) {
    const bm = (b0 + b1) / 2;
    const vm = RG.palmSurface(rig, u, bm).v;
    const tooLow = increasing ? vm < target : vm > target;
    if (tooLow) b0 = bm; else b1 = bm;
  }
  return (b0 + b1) / 2;
}

/**
 * The offset the real palmar (or dorsal) surface actually reaches at (u, v),
 * in mm - NOT palmThickPalmar/Dorsal alone. That field is the thickness at
 * the section's widest; the drawn surface multiplies it by a superelliptical
 * wrap and by the sine of where v sits between the sheet's own borders
 * (palmSurface's `off = thick * wrap * |sin(phi)|`), both of which fall to
 * zero at vLo and vHi. A point near either border can sit at v where the
 * untapered field is still large - the thenar's own thickness peak, for
 * instance, has no reason to fall inside the sheet's interior - so comparing
 * an offset directly to palmThickPalmar there over-reports depth by a wide
 * margin: verified against one such point below, where the untapered field
 * read 20.1mm but the surface it actually draws sits 12.9mm out. There is no
 * closed form from v back to the beta that produces it (v is itself built
 * from a spline plus a superellipse), so this recovers the true boundary the
 * same way the renderer reaches it: by searching palmSurface, not by
 * re-deriving its formula by hand.
 */
function palmBoundaryAt(rig, u, v, palmar) {
  const beta = palmar ? bisectBetaForV(rig, u, v, 0, 0.5, true) : bisectBetaForV(rig, u, v, 0.5, 1, false);
  return RG.palmSurface(rig, u, beta).off;
}

/**
 * How far P sits inside the palm's soft-tissue solid, in mm, or null. Finds
 * the nearest patch of the spine, rejects it as outside the sheet's own
 * footprint if the lateral residual is too large or if it falls distal to
 * where the solid actually ends (rig.palm.uDistal - past that the sheet
 * continues as parametrisation but the flesh does not, see buildPalm), then
 * compares the signed offset along the local normal to the real, tapered
 * boundary on whichever side it fell.
 */
function insidePalm(rig, P) {
  const palm = rig.palm;
  const best = nearestPalmPatch(rig, P);
  if (best.lat > PALM_LAT_TOL) return null;
  const palmar = best.off >= 0;
  const uCap = palm.uDistal(best.v, palmar);
  if (best.u > uCap + PALM_UCAP_SLACK) return null;
  const boundary = palmBoundaryAt(rig, best.u, best.v, palmar);
  const off = Math.abs(best.off);
  if (off >= boundary) return null;
  return { depth: boundary - off, u: best.u, v: best.v, palmar };
}

/** how far P sits inside a sphere, in mm, or null - r minus the distance to centre */
function insideBall(ball, P) {
  if (!ball) return null;
  const depth = ball.r - M.vdist(P, ball.C);
  return depth > 0 ? { depth } : null;
}

/* ==========================================================================
   SELF-TEST
   Each inside-test is checked against a point placed at a known fraction of
   a known radius, so "inside" and "depth" are verified against arithmetic
   done independently of the function under test, not just against its own
   other branch.
   ========================================================================== */
function selfTest(rig) {
  const lines = [];
  let ok = true;
  const check = (name, cond, detail) => {
    lines.push((cond ? 'PASS ' : 'FAIL ') + name + '  ' + detail);
    if (!cond) ok = false;
  };

  // digit: probe the index proximal phalanx at s=0.5, at 50% and 150% of its
  // ulnar radius, and dead centre.
  {
    const d = 1, seg = 1, s = 0.5;
    const sg = rig.digits[d].segs[seg];
    const pr = AN.segmentProfile(rig.anatomy, d, seg, s);
    const a = pr[0];
    const C = RG.sectionCenter(rig, d, seg, s);
    const pIn = M.vmad(C, sg.ul, a * 0.5);
    const rIn = insideDigit(rig, d, seg, pIn);
    check('insideDigit: 50% of ulnar radius is inside',
      rIn && Math.abs(rIn.depth - a * 0.5) < 1e-6,
      'a=' + a.toFixed(3) + ' depth=' + (rIn && rIn.depth.toFixed(4)) + ' expected=' + (a * 0.5).toFixed(4));
    const pOut = M.vmad(C, sg.ul, a * 1.5);
    const rOut = insideDigit(rig, d, seg, pOut);
    check('insideDigit: 150% of ulnar radius is outside', rOut === null, 'result=' + JSON.stringify(rOut));
    const rC = insideDigit(rig, d, seg, C);
    check('insideDigit: the section centre is inside, depth = min(a,b)',
      rC && Math.abs(rC.depth - Math.min(pr[0], pr[1])) < 1e-6,
      'depth=' + (rC && rC.depth.toFixed(4)) + ' expected=' + Math.min(pr[0], pr[1]).toFixed(4));
    const pBeyond = M.vmad(sg.A, sg.t, sg.len * (sg.sMax + 0.5));
    check('insideDigit: past sMax along the bone is outside', insideDigit(rig, d, seg, pBeyond) === null,
      's beyond range should reject');
  }

  // palm: probe at (u,v)=(0.5, 0.3), which sits well inside the sheet, at
  // 50% of the REAL (tapered) boundary on both the palmar and dorsal faces
  // - ground truth here is palmSurface itself, read via the same bisection
  // insidePalm uses, not the untapered palmThickPalmar/Dorsal field, which
  // is a different and larger number near the sheet's own edges (see
  // palmBoundaryAt) - and a point far to the side and a point well distal
  // of uDistal, both of which must miss.
  {
    const u = 0.5, v = 0.3;
    const sp = RG.palmSpine(rig, u, v);
    const boundP = palmBoundaryAt(rig, u, v, true);
    const boundD = palmBoundaryAt(rig, u, v, false);
    const pPalmar = M.vmad(sp.P, sp.n, boundP * 0.5);
    const rP = insidePalm(rig, pPalmar);
    check('insidePalm: 50% of the real palmar boundary is inside',
      rP && Math.abs(rP.depth - boundP * 0.5) < 0.3 && rP.palmar === true,
      'depth=' + (rP && rP.depth.toFixed(3)) + ' expected~' + (boundP * 0.5).toFixed(3));
    const pDorsal = M.vmad(sp.P, sp.n, -boundD * 0.5);
    const rD = insidePalm(rig, pDorsal);
    check('insidePalm: 50% of the real dorsal boundary is inside',
      rD && Math.abs(rD.depth - boundD * 0.5) < 0.3 && rD.palmar === false,
      'depth=' + (rD && rD.depth.toFixed(3)) + ' expected~' + (boundD * 0.5).toFixed(3));
    // ground truth for the taper fix itself: a point known to sit near the
    // sheet's own radial border, where the untapered field and the real
    // boundary disagree by nearly 8mm (see palmBoundaryAt's docstring) -
    // insidePalm must follow the real surface, not the untapered field.
    const uB = 0.8407, vB = -0.1300;
    const spB = RG.palmSpine(rig, uB, vB);
    const realBoundary = palmBoundaryAt(rig, uB, vB, true);
    const untaperedField = RG.palmThickPalmar(rig.anatomy, uB, vB);
    const pEdge = M.vmad(spB.P, spB.n, realBoundary - 1);   // 1mm shy of the true surface
    const rEdge = insidePalm(rig, pEdge);
    check('insidePalm: near the radial border, depth follows the tapered surface, not the untapered field',
      rEdge && Math.abs(rEdge.depth - 1) < 0.5 && rEdge.depth < untaperedField * 0.5,
      'depth=' + (rEdge && rEdge.depth.toFixed(2)) + ' expected~1.00  untapered field=' + untaperedField.toFixed(1) + 'mm (would have said ~' + (untaperedField - (realBoundary - 1)).toFixed(1) + 'mm)');
    const pFar = M.vmad(sp.P, M.vnorm(rig.digits[1].segs[1].ul), 200);
    check('insidePalm: 200mm off to the side is outside', insidePalm(rig, pFar) === null, 'lateral escape should reject');
    const pDistal = M.vmad(sp.P, rig.digits[2].segs[0].t, 400);
    check('insidePalm: 400mm past the fingertips is outside', insidePalm(rig, pDistal) === null, 'far distal escape should reject');
  }

  // ball: centre, surface, and outside.
  {
    const ball = { C: [10, -5, 30], r: 26 };
    const rC = insideBall(ball, ball.C);
    check('insideBall: centre is inside by exactly r', rC && Math.abs(rC.depth - 26) < 1e-9, 'depth=' + (rC && rC.depth));
    const onSurface = M.vmad(ball.C, [0, 0, 1], 26);
    const rS = insideBall(ball, onSurface);
    check('insideBall: exactly on the surface is depth 0 (not inside)', rS === null, 'result=' + JSON.stringify(rS));
    const beyond = M.vmad(ball.C, [0, 0, 1], 30);
    check('insideBall: beyond the surface is outside', insideBall(ball, beyond) === null, 'result=' + JSON.stringify(insideBall(ball, beyond)));
  }

  for (const l of lines) console.log('  ' + l);
  return ok;
}

console.log('== self-test: each inside-test checked against a point placed by independent arithmetic ==');
{
  const A0 = AN.buildAnatomy(12345);
  const rig0 = RG.solve(A0, PO.preset(A0, 'rest'));
  const ok = selfTest(rig0);
  console.log(ok ? '  all self-tests passed\n' : '  SELF-TEST FAILURE - results below are not trustworthy\n');
  if (!ok) process.exit(2);
}

/* ==========================================================================
   SURFACE SAMPLING
   ========================================================================== */

/** every rendered segment of every digit, with a name for reporting */
function renderedSegs(rig) {
  const out = [];
  for (let d = 0; d < 5; d++) {
    for (const sg of rig.digits[d].segs) {
      if (sg.rendered) out.push({ d, seg: sg.seg, name: rig.digits[d].name + '/' + sg.name });
    }
  }
  return out;
}

function sampleDigitSurface(rig, d, seg, NS, NA) {
  const sg = rig.digits[d].segs[seg];
  const out = [];
  for (let i = 0; i <= NS; i++) {
    const s = M.lerp(sg.sMin, sg.sMax, i / NS);
    for (let k = 0; k < NA; k++) {
      const alpha = (k / NA) * M.TAU;
      out.push({ P: RG.digitSurface(rig, d, seg, s, alpha).P, s, alpha });
    }
  }
  return out;
}

// The palm solid's own working span: from a little short of the wrist to
// just past the metacarpal heads. Sampling stops short of PALM_U1 (1.22 in
// rig.js) because beyond about u=1.05 the sheet is parametrising the web,
// not flesh, and insidePalm's own uDistal cap would reject anything sampled
// there anyway - there is no point spending samples on points that can only
// ever return null.
const PALM_SAMPLE_U0 = -0.30, PALM_SAMPLE_U1 = 1.06;

function samplePalmSurface(rig, Nu, Nb, u0, u1) {
  const out = [];
  for (let i = 0; i <= Nu; i++) {
    const u = M.lerp(u0, u1, i / Nu);
    for (let k = 0; k < Nb; k++) {
      const beta = k / Nb;
      const sp = RG.palmSurface(rig, u, beta);
      // The sheet is defined past the end of the flesh - palmSurface will
      // happily evaluate at u = 1.06 on a dorsum whose solid stops at 1.045,
      // and the point it returns is inside the base of a finger, every time,
      // in every pose. Those phantom samples were the worst hits in this
      // whole check. Where the solid ends is uDistal's answer, per v and per
      // face, so ask it.
      if (u > rig.palm.uDistal(sp.v, sp.palmar)) continue;
      out.push({ P: sp.P, u, beta });
    }
  }
  return out;
}

/* ==========================================================================
   PAIR-CLASS MEASUREMENT
   Each returns { worst, worstInfo, pairWorst } for one rig: the single
   deepest penetration found in that class, where it was, and a map from a
   canonical part-pair id to the worst depth found for that specific pair -
   which is what lets the caller report one issue per offending pair rather
   than one per raw sample.
   ========================================================================== */

// Source-side sampling density for digit-vs-digit. Cheap per pair (the
// target's inside-test is closed form), so this can afford to be dense.
const DD_NS = 10, DD_NA = 16;

/**
 * Digit segment vs digit segment: different digits, and non-adjacent
 * segments of the same digit. Adjacent segments of one digit share real
 * tissue at the joint between them - the proximal end of a middle phalanx
 * IS the distal condyle of the phalanx behind it - so they are excluded
 * here exactly as they are in the renderer's own contact solver
 * (gatherContacts, src/30-pose.js). Unlike that solver's capsule-with-one-
 * radius proxy, this also safely tests the thumb against itself: the
 * elliptical inside-test carries the thenar's off-axis section centre
 * (sectionOffset) properly, where a capsule built on the bone axis alone
 * would misjudge how much of the thenar's bulk actually sits where.
 */
function digitDigitWorst(rig) {
  const segs = renderedSegs(rig);
  const cache = new Map();
  const samplesOf = (d, seg) => {
    const key = d + ':' + seg;
    if (!cache.has(key)) cache.set(key, sampleDigitSurface(rig, d, seg, DD_NS, DD_NA));
    return cache.get(key);
  };
  let worst = 0, worstInfo = null;
  const pairWorst = new Map();
  for (const a of segs) {
    for (const b of segs) {
      if (a.d === b.d && Math.abs(a.seg - b.seg) <= 1) continue;
      const pts = samplesOf(a.d, a.seg);
      let localWorst = 0, localAt = null;
      for (const pt of pts) {
        const r = insideDigit(rig, b.d, b.seg, pt.P);
        if (r && r.depth > localWorst) { localWorst = r.depth; localAt = { s: pt.s, alpha: pt.alpha }; }
      }
      if (localWorst <= 0) continue;
      const id = a.d + '.' + a.seg + ' -> ' + b.d + '.' + b.seg;
      const rec = { depth: localWorst, from: a, to: b, at: localAt };
      pairWorst.set(id, rec);
      if (localWorst > worst) { worst = localWorst; worstInfo = rec; }
    }
  }
  return { worst, worstInfo, pairWorst };
}

// Source-side digit density feeding the palm search (expensive per point,
// so kept leaner than DD_NS/DD_NA), and palm surface density for the
// reverse direction (cheap per point, since the digit inside-test is
// closed form, so this can afford to be denser).
const DP_NS = 9, DP_NA = 14;
const PALM_NU = 34, PALM_NB = 40;

/**
 * Digit segment vs palm solid, tested in both directions: does a digit sink
 * into the palm (the ordinary case - a curled fingertip, a knuckle driven
 * dorsally into the back of the hand), and does the palm's own surface sink
 * into a digit (the palm folding hard enough, in a tight fist or a deep
 * cup, that its dorsum or a web margin brushes the base of a bent finger).
 * Both directions share the palm's own uDistal boundary for what counts as
 * solid at all, so neither can register a hit out past where the flesh
 * actually ends.
 */
// How far along a proximal phalanx the shared knuckle reaches. Past this the
// finger has left its own joint and any overlap with the palm is real.
const JOINT_SHARE = 0.18;
// The thumb's metacarpal is excluded from the palm pair outright rather than
// over a window: 10-anatomy.js sizes the thenar AROUND that bone, so the two
// are one mass by construction and no amount of it being inside the other is
// a collision. What that costs is the ability to catch a thumb ray genuinely
// driven through the hand, which tools/thumb.js measures directly instead.

function digitPalmWorst(rig) {
  const segs = renderedSegs(rig);
  let worst = 0, worstInfo = null;
  const pairWorst = new Map();

  for (const a of segs) {
    const pts = sampleDigitSurface(rig, a.d, a.seg, DP_NS, DP_NA);
    let localWorst = 0, localAt = null;
    for (const pt of pts) {
      // The palm is the parent of every proximal phalanx, and their solids
      // share the knuckle the way two adjacent segments of a finger share a
      // joint - which is why that case is already excluded above. A proximal
      // phalanx is authored to start at s = -0.12 so it reaches back into the
      // metacarpal head and the knuckle is not swallowed, so its base is
      // inside the palm by about its own radius BY CONSTRUCTION, in every
      // pose including flat ones. Left in, that overlap was every one of the
      // fifteen worst hits in this whole sweep, at s = -0.12 or s = 0.00, and
      // it drowned out everything that is actually a collision.
      if (a.seg === 1 && pt.s < JOINT_SHARE) continue;
      // Same argument for the thumb's metacarpal, which is not a tube laid on
      // the palm: 20-rig.js authors it as thenar mass over its proximal reach
      // and fades its own rail out there for exactly this reason. Inside the
      // palm is where it belongs.
      if (a.d === 0 && a.seg === 0) continue;
      const r = insidePalm(rig, pt.P);
      if (r && r.depth > localWorst) { localWorst = r.depth; localAt = { dir: 'digit->palm', s: pt.s, alpha: pt.alpha, u: r.u, v: r.v }; }
    }
    if (localWorst <= 0) continue;
    const id = a.d + '.' + a.seg + ' -> palm';
    const rec = { depth: localWorst, from: a, to: { name: 'palm' }, at: localAt };
    pairWorst.set(id, rec);
    if (localWorst > worst) { worst = localWorst; worstInfo = rec; }
  }

  const ppts = samplePalmSurface(rig, PALM_NU, PALM_NB, PALM_SAMPLE_U0, PALM_SAMPLE_U1);
  for (const b of segs) {
    let localWorst = 0, localAt = null;
    for (const pt of ppts) {
      // The knuckle again, approached from the palm's side: the sheet runs on
      // to u = 1.045 past the metacarpal heads, so its own distal end is
      // inside the base of every proximal phalanx. Excluded to the same
      // depth, from the same argument, or the check just measures the
      // shared joint twice.
      if (b.d === 0 && b.seg === 0) continue;
      const r = insideDigit(rig, b.d, b.seg, pt.P);
      // the shared knuckle again, judged on the digit's own parameter so the
      // two directions exclude exactly the same piece of tissue
      if (r && b.seg === 1 && r.s < JOINT_SHARE) continue;
      if (r && r.depth > localWorst) { localWorst = r.depth; localAt = { dir: 'palm->digit', u: pt.u, beta: pt.beta, s: r.s, alpha: r.alpha }; }
    }
    if (localWorst <= 0) continue;
    const id = 'palm -> ' + b.d + '.' + b.seg;
    const rec = { depth: localWorst, from: { name: 'palm' }, to: b, at: localAt };
    pairWorst.set(id, rec);
    if (localWorst > worst) { worst = localWorst; worstInfo = rec; }
  }
  return { worst, worstInfo, pairWorst };
}

function percentiles(arr) {
  if (!arr.length) return { median: 0, p90: 0, max: 0 };
  const s = arr.slice().sort((a, b) => a - b);
  const at = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  return { median: at(0.5), p90: at(0.9), max: s[s.length - 1] };
}

/** a part descriptor, as either a digit segment or the palm, into one string */
function partName(x) { return x.name; }

function describePair(rec) {
  const at = rec.at || {};
  const where = at.dir ? at.dir + ', ' : '';
  const loc = ('s' in at ? 's=' + at.s.toFixed(2) : '') +
    ('alpha' in at ? ' alpha=' + (at.alpha / DEG).toFixed(0) + 'deg' : '') +
    ('u' in at ? ' u=' + at.u.toFixed(2) : '') +
    ('v' in at ? ' v=' + at.v.toFixed(2) : '') +
    ('beta' in at ? ' beta=' + at.beta.toFixed(2) : '');
  return partName(rec.from) + ' -> ' + partName(rec.to) + '  (' + where + loc + ')';
}

/* ==========================================================================
   SECTION A - the hand against itself, across every preset and many seeds.
   One seed is not evidence: a bug tied to one hand's particular proportions
   (a short thumb metacarpal, a wide little finger) can hide in a single
   seed's worth of poses and show up only once anatomy varies. Crossing all
   eighteen presets with a spread of seeds is what makes the summary below a
   claim about the model rather than about one hand.
   ========================================================================== */
const SEEDS = [12345, 777, 4242, 99, 1, 2023, 55555, 8080, 31337, 90210];

console.log('== section A: the hand against itself (' + PO.PRESET_KEYS.length + ' presets x ' + SEEDS.length + ' seeds) ==');
const ddPerCase = [], dpPerCase = [];
const issuesA = [];
let worstA = { depth: -Infinity };
const tA0 = Date.now();
for (const key of PO.PRESET_KEYS) {
  for (const seed of SEEDS) {
    const A = AN.buildAnatomy(seed);
    // Measure the settled pose, the one resolveContacts hands to the
    // renderer by default (src/60-render.js Renderer.build) - that is the
    // hand actually drawn, and the tool this project already leans on for
    // the same judgement (tools/validate.js) makes the identical choice.
    const pose = PO.resolveContacts(A, PO.preset(A, key));
    const rig = RG.solve(A, pose);
    const dd = digitDigitWorst(rig);
    const dp = digitPalmWorst(rig);
    ddPerCase.push(dd.worst);
    dpPerCase.push(dp.worst);
    for (const rec of dd.pairWorst.values()) {
      if (rec.depth > ISSUE_MM) issuesA.push({ cls: 'digit-digit', seed, preset: key, ...rec });
    }
    for (const rec of dp.pairWorst.values()) {
      if (rec.depth > ISSUE_MM) issuesA.push({ cls: 'digit-palm', seed, preset: key, ...rec });
    }
    if (dd.worst > worstA.depth) worstA = { depth: dd.worst, cls: 'digit-digit', seed, preset: key, ...dd.worstInfo };
    if (dp.worst > worstA.depth) worstA = { depth: dp.worst, cls: 'digit-palm', seed, preset: key, ...dp.worstInfo };
  }
}
const tA1 = Date.now();

const ddStats = percentiles(ddPerCase), dpStats = percentiles(dpPerCase);
console.log('  ' + (PO.PRESET_KEYS.length * SEEDS.length) + ' (preset, seed) pairs measured in ' + (tA1 - tA0) + 'ms');
console.log('  digit-digit   median ' + ddStats.median.toFixed(2) + 'mm  p90 ' + ddStats.p90.toFixed(2) +
  'mm  max ' + ddStats.max.toFixed(2) + 'mm');
console.log('  digit-palm    median ' + dpStats.median.toFixed(2) + 'mm  p90 ' + dpStats.p90.toFixed(2) +
  'mm  max ' + dpStats.max.toFixed(2) + 'mm');
console.log('  worst overall: ' + worstA.depth.toFixed(2) + 'mm  ' + worstA.cls + '  preset=' + worstA.preset +
  ' seed=' + worstA.seed + '  ' + describePair(worstA));
const issuesDD = issuesA.filter(it => it.cls === 'digit-digit'), issuesDP = issuesA.filter(it => it.cls === 'digit-palm');
console.log('  issues over ' + ISSUE_MM + 'mm: ' + issuesA.length + '  (' + issuesDD.length + ' digit-digit, ' + issuesDP.length + ' digit-palm)');

issuesA.sort((a, b) => b.depth - a.depth);
console.log('  worst 15 overall:');
for (const it of issuesA.slice(0, 15)) {
  console.log('    ' + it.depth.toFixed(2) + 'mm  ' + it.cls.padEnd(11) + ' preset=' + it.preset.padEnd(11) +
    ' seed=' + String(it.seed).padEnd(6) + describePair(it));
}
issuesDD.sort((a, b) => b.depth - a.depth);
console.log('  worst 8 digit-digit specifically (dwarfed above by digit-palm, but a separate pair class in its own right):');
for (const it of issuesDD.slice(0, 8)) {
  console.log('    ' + it.depth.toFixed(2) + 'mm  preset=' + it.preset.padEnd(11) + ' seed=' + String(it.seed).padEnd(6) + describePair(it));
}
console.log('');

/* ==========================================================================
   SECTION B - grip quality: the hand against something it holds.
   holdBall closes the hand until each digit's own last bone rests on the
   ball, so "did it work" is not one number but three, per digit: does the
   pad actually get there (a gap says the closing schedule ran out of travel
   before the pad arrived), is anything driven through the ball once it does
   (a solid grip should stop at the surface, not inside it), and are the
   joint angles that produced the result ones a hand can actually be in. The
   last of those matters because the contact solver (src/30-pose.js) reaches
   its answer by iterated correction, not by construction, and a solver that
   corrects a deep penetration in one bad step can park a digit somewhere
   the pose was never meant to visit even after the depth itself looks fine
   - which is exactly the documented history behind this section: the ring
   finger, thrown thirty degrees back out of its own grip and then latched
   as arrived thirty-two millimetres short of the ball it was holding (see
   applyContacts and holdBall in src/30-pose.js). That failure would not
   show up as a penetration at all - it undershoots - so it is checked for
   directly, by digit, rather than folded into a single interpenetration
   number.
   ========================================================================== */
const RADII = [16, 26, 38];              // small marble, the 26mm the historical bug was measured at, a grapefruit
const START_POSES = ['flat', 'rest'];    // fully open, and already part-curled - two different closing distances
const DIGIT_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];

/** closest approach of a digit's pad (the distal end of its last segment) to the ball, signed: negative = buried */
function padGap(rig, d, ball) {
  const dg = rig.digits[d];
  const last = dg.segs[dg.segs.length - 1];
  const sLo = Math.max(0.55, last.sMin);
  let best = Infinity, at = null;
  const NS = 16, NA = 24;
  for (let i = 0; i <= NS; i++) {
    const s = M.lerp(sLo, last.sMax, i / NS);
    for (let k = 0; k < NA; k++) {
      const alpha = (k / NA) * M.TAU;
      const P = RG.digitSurface(rig, d, last.seg, s, alpha).P;
      const gap = M.vdist(P, ball.C) - ball.r;
      if (gap < best) { best = gap; at = { s, alpha }; }
    }
  }
  return { gap: best, at };
}

/** worst penetration anywhere on a digit's whole rendered surface into the ball */
function digitBallWorst(rig, d, ball) {
  let worst = 0, at = null;
  for (const sg of rig.digits[d].segs) {
    if (!sg.rendered) continue;
    for (const pt of sampleDigitSurface(rig, d, sg.seg, DD_NS, DD_NA)) {
      const r = insideBall(ball, pt.P);
      if (r && r.depth > worst) { worst = r.depth; at = { seg: sg.seg, s: pt.s, alpha: pt.alpha }; }
    }
  }
  return { worst, at };
}

/** worst penetration anywhere on the palm's surface into the ball */
function palmBallWorst(rig, ball) {
  let worst = 0, at = null;
  for (const pt of samplePalmSurface(rig, PALM_NU, PALM_NB, PALM_SAMPLE_U0, PALM_SAMPLE_U1)) {
    const r = insideBall(ball, pt.P);
    if (r && r.depth > worst) { worst = r.depth; at = { u: pt.u, beta: pt.beta }; }
  }
  return { worst, at };
}

function jointAnglesDeg(pose, d) {
  const p = pose.digits[d];
  const R = (x) => Math.round(x / DEG);
  if (d === 0) return 'cmc(rad ' + R(p.cmcRad) + ' abd ' + R(p.cmcAbd) + ' opp ' + R(p.cmcOpp) + ') mcp ' + R(p.mcpFlex) + ' ip ' + R(p.ipFlex);
  return 'mcp ' + R(p.mcpFlex) + ' (abd ' + (p.mcpAbd >= 0 ? '+' : '') + R(p.mcpAbd) + ') pip ' + R(p.pipFlex) + ' dip ' + R(p.dipFlex);
}

/**
 * Heuristic flags for a joint chain that has settled somewhere anatomically
 * odd. None of these can fire from a hard limit alone - clampPose already
 * enforces those - so each names a specific shape a grip should not take:
 * a knuckle splayed sideways instead of curling (abduction doing flexion's
 * job, which is what a contact correction with too little leverage on the
 * right axis falls back to), a distal joint bent backwards against a flexed
 * knuckle (the chain folding rather than curling), or a joint sitting within
 * a degree of its own mechanical stop (plausible occasionally, suspicious
 * as a pattern across many seeds at the same radius).
 */
function jointFlags(A, pose, d) {
  const p = pose.digits[d], L = A.limits.digits[d];
  const R = (x) => x / DEG;
  const flags = [];
  const nearStop = (v, hiDeg, loDeg) => v > (hiDeg - 1) * DEG || v < -(loDeg - 1) * DEG;
  if (d === 0) {
    if (nearStop(p.cmcOpp, L.cmc.opp, L.cmc.rep)) flags.push('CMC opposition pinned at its stop (' + R(p.cmcOpp).toFixed(0) + 'deg)');
    if (nearStop(p.mcpFlex, L.mcp.flex, L.mcp.ext)) flags.push('MCP pinned at its stop (' + R(p.mcpFlex).toFixed(0) + 'deg)');
    if (nearStop(p.ipFlex, L.ip.flex, L.ip.ext)) flags.push('IP pinned at its stop (' + R(p.ipFlex).toFixed(0) + 'deg)');
    return flags;
  }
  if (Math.abs(R(p.mcpAbd)) > 22) flags.push('MCP splayed ' + R(p.mcpAbd).toFixed(0) + 'deg sideways instead of curling');
  if (R(p.mcpFlex) > 25 && R(p.pipFlex) < -3) flags.push('PIP extended ' + R(p.pipFlex).toFixed(0) + 'deg against a flexed MCP (' + R(p.mcpFlex).toFixed(0) + 'deg) - the chain has folded backwards');
  if (R(p.pipFlex) > 25 && R(p.dipFlex) < -3) flags.push('DIP extended ' + R(p.dipFlex).toFixed(0) + 'deg against a flexed PIP (' + R(p.pipFlex).toFixed(0) + 'deg) - the chain has folded backwards');
  if (nearStop(p.mcpFlex, L.mcp.flex, L.mcp.ext)) flags.push('MCP pinned at its stop (' + R(p.mcpFlex).toFixed(0) + 'deg)');
  if (nearStop(p.pipFlex, L.pip.flex, L.pip.ext)) flags.push('PIP pinned at its stop (' + R(p.pipFlex).toFixed(0) + 'deg)');
  if (nearStop(p.dipFlex, L.dip.flex, L.dip.ext)) flags.push('DIP pinned at its stop (' + R(p.dipFlex).toFixed(0) + 'deg)');
  return flags;
}

console.log('== section B: grip quality (' + RADII.length + ' radii x ' + START_POSES.length + ' starting poses x ' + SEEDS.length + ' seeds) ==');
// per-digit running stats, pooled across every trial, so one digit's
// behaviour can be read off against its neighbours rather than against a
// single run that might itself be the odd one out
const perDigit = DIGIT_NAMES.map(() => ({ gaps: [], buried: 0, notTouching: 0, touching: 0, flagged: 0, worstBuried: -Infinity, worstBuriedAt: null }));
const gripIssues = [];
// tracked separately from gripIssues (which is sorted by burial depth, so a
// wide-open gap with zero burial would always sort to its bottom): every
// trial where the pad did not reach the ball, and, sharper still, every
// trial where holdBall's OWN bookkeeping (held.held[d]) says a digit arrived
// while this measurement finds it did not - the exact shape of the
// documented ring-finger failure, where the solver's internal "rested" flag
// and the true geometry disagreed.
const notTouchingIssues = [];
const mismatches = [];
let worstB = { depth: -Infinity };
const tB0 = Date.now();
let trials = 0;
for (const seed of SEEDS) {
  const A = AN.buildAnatomy(seed);
  for (const startKey of START_POSES) {
    for (const r of RADII) {
      trials++;
      const held = PO.holdBall(A, PO.preset(A, startKey), r);
      const rig = RG.solve(A, held);
      const ball = held.ball;
      for (let d = 0; d < 5; d++) {
        const pg = padGap(rig, d, ball);
        const bw = digitBallWorst(rig, d, ball);
        const flags = jointFlags(A, held, d);
        const rec = perDigit[d];
        rec.gaps.push(pg.gap);
        if (pg.gap > ISSUE_MM) rec.notTouching++;
        else if (pg.gap < -ISSUE_MM) rec.buried++;
        else rec.touching++;
        if (flags.length) rec.flagged++;
        if (bw.worst > rec.worstBuried) {
          rec.worstBuried = bw.worst;
          rec.worstBuriedAt = { seed, startKey, r, at: bw.at };
        }
        if (bw.worst > ISSUE_MM || pg.gap < -ISSUE_MM || flags.length) {
          gripIssues.push({
            digit: DIGIT_NAMES[d], seed, startKey, r, padGap: pg.gap,
            worstAnywhere: bw.worst, flags, angles: jointAnglesDeg(held, d), held: held.held[d]
          });
        }
        if (pg.gap > ISSUE_MM) {
          notTouchingIssues.push({ digit: DIGIT_NAMES[d], seed, startKey, r, gap: pg.gap, held: held.held[d], angles: jointAnglesDeg(held, d) });
        }
        // the sharpest possible finding: the solver believes this digit is
        // resting on the ball (held.held[d] === true) while the actual pad
        // is still a real distance away - bookkeeping and geometry disagree
        if (held.held[d] && pg.gap > ISSUE_MM) {
          mismatches.push({ digit: DIGIT_NAMES[d], seed, startKey, r, gap: pg.gap, angles: jointAnglesDeg(held, d) });
        }
        if (bw.worst > worstB.depth) {
          worstB = { depth: bw.worst, digit: DIGIT_NAMES[d], seed, startKey, r, at: bw.at, kind: 'digit->ball' };
        }
      }
      const pbw = palmBallWorst(rig, ball);
      if (pbw.worst > worstB.depth) worstB = { depth: pbw.worst, digit: 'palm', seed, startKey, r, at: pbw.at, kind: 'palm->ball' };
      if (pbw.worst > ISSUE_MM) gripIssues.push({ digit: 'palm', seed, startKey, r, padGap: null, worstAnywhere: pbw.worst, flags: [], angles: '' });
      // and the grip itself, checked against the same digit-digit / digit-palm
      // battery section A uses - a hand closing on something is exactly the
      // pose most likely to drive its own fingers into each other
      const dd = digitDigitWorst(rig), dp = digitPalmWorst(rig);
      if (dd.worst > ISSUE_MM * 2) gripIssues.push({ digit: describePair(dd.worstInfo), seed, startKey, r, padGap: null, worstAnywhere: dd.worst, flags: ['self-collision (digit-digit) while holding the ball'], angles: '' });
      if (dp.worst > ISSUE_MM * 4) gripIssues.push({ digit: describePair(dp.worstInfo), seed, startKey, r, padGap: null, worstAnywhere: dp.worst, flags: ['self-collision (digit-palm) while holding the ball'], angles: '' });
    }
  }
}
const tB1 = Date.now();
console.log('  ' + trials + ' grip trials measured in ' + (tB1 - tB0) + 'ms\n');

console.log('  per-digit pad-to-ball gap, pooled over all ' + trials + ' trials (negative = buried in the ball):');
console.log('  ' + 'digit'.padEnd(8) + 'median'.padStart(8) + 'p90'.padStart(8) + 'max gap'.padStart(10) +
  'worst buried'.padStart(14) + '  touching/not/buried  flagged');
for (let d = 0; d < 5; d++) {
  const rec = perDigit[d];
  const st = percentiles(rec.gaps);
  const maxGap = Math.max(...rec.gaps);
  console.log('  ' + DIGIT_NAMES[d].padEnd(8) + (st.median.toFixed(1) + 'mm').padStart(8) +
    (st.p90.toFixed(1) + 'mm').padStart(8) + (maxGap.toFixed(1) + 'mm').padStart(10) +
    (rec.worstBuried.toFixed(1) + 'mm').padStart(14) +
    '  ' + rec.touching + '/' + rec.notTouching + '/' + rec.buried + '  ' + rec.flagged);
}
console.log('');
for (let d = 0; d < 5; d++) {
  const rec = perDigit[d];
  if (rec.worstBuried > ISSUE_MM) {
    console.log('  ' + DIGIT_NAMES[d] + ' worst burial ' + rec.worstBuried.toFixed(2) + 'mm at ' +
      JSON.stringify(rec.worstBuriedAt));
  }
}

console.log('\n  worst-of-section-B: ' + worstB.depth.toFixed(2) + 'mm  ' + worstB.kind + '  digit=' + worstB.digit +
  '  seed=' + worstB.seed + ' start=' + worstB.startKey + ' r=' + worstB.r + '  at=' + JSON.stringify(worstB.at));

gripIssues.sort((a, b) => (b.worstAnywhere || 0) - (a.worstAnywhere || 0));
console.log('\n  grip issues flagged (buried beyond ' + ISSUE_MM + 'mm, gap beyond ' + ISSUE_MM +
  'mm short of contact, or a joint-chain flag): ' + gripIssues.length);
for (const it of gripIssues.slice(0, 40)) {
  console.log('    ' + it.digit.padEnd(24) + ' seed=' + String(it.seed).padEnd(6) + ' start=' + it.startKey.padEnd(5) +
    ' r=' + String(it.r).padEnd(3) + ' padGap=' + (it.padGap === null ? '   - ' : it.padGap.toFixed(1) + 'mm') +
    ' worstAnywhere=' + it.worstAnywhere.toFixed(1) + 'mm' +
    (it.angles ? '  [' + it.angles + ']' : '') + (it.flags.length ? '  ' + it.flags.join('; ') : ''));
}

notTouchingIssues.sort((a, b) => b.gap - a.gap);
console.log('\n  pad-to-ball gaps beyond ' + ISSUE_MM + 'mm (the pad never actually arrived): ' + notTouchingIssues.length + ' / ' + (trials * 5));
for (const it of notTouchingIssues.slice(0, 20)) {
  console.log('    ' + it.digit.padEnd(8) + ' seed=' + String(it.seed).padEnd(6) + ' start=' + it.startKey.padEnd(5) +
    ' r=' + String(it.r).padEnd(3) + ' gap=' + it.gap.toFixed(1) + 'mm' +
    '  holdBall says held=' + it.held + '  [' + it.angles + ']');
}

mismatches.sort((a, b) => b.gap - a.gap);
console.log('\n  solver/geometry mismatches - holdBall marked the digit as resting on the ball' +
  ' (held.held[d] === true) while the pad is demonstrably still short of it: ' + mismatches.length);
for (const it of mismatches) {
  console.log('    ' + it.digit.padEnd(8) + ' seed=' + String(it.seed).padEnd(6) + ' start=' + it.startKey.padEnd(5) +
    ' r=' + String(it.r).padEnd(3) + ' gap=' + it.gap.toFixed(1) + 'mm  [' + it.angles + ']');
}

// ---- the ring finger, specifically, held up against every other digit ----
console.log('\n  == every digit, against its neighbours (same pooled trials; thumb included since the closing ==');
console.log('  == trajectory and the aim-by-reach step it alone gets could just as easily single it out) ==');
for (let d = 0; d < 5; d++) {
  const rec = perDigit[d];
  const st = percentiles(rec.gaps);
  const mm = mismatches.filter(m => m.digit === DIGIT_NAMES[d]).length;
  console.log('  ' + DIGIT_NAMES[d].padEnd(8) + ' pad-gap median ' + st.median.toFixed(2) + 'mm  p90 ' + st.p90.toFixed(2) +
    'mm  worst-buried ' + rec.worstBuried.toFixed(2) + 'mm  not-touching ' + rec.notTouching + '/' + trials +
    '  flagged-joints ' + rec.flagged + '/' + trials + '  solver/geometry mismatches ' + mm + '/' + trials);
}
const ringIssues = gripIssues.filter(it => it.digit === 'ring');
const ringNotTouching = notTouchingIssues.filter(it => it.digit === 'ring');
console.log('  ring: ' + ringIssues.length + ' burial/joint-flag issues, ' + ringNotTouching.length +
  ' not-touching trials beyond ' + ISSUE_MM + 'mm' +
  (ringIssues.length || ringNotTouching.length ? ' (see the flagged lists above for detail)' : ' - no ring-finger trial crossed either threshold in this run'));
console.log('');

const worstOverall = Math.max(worstA.depth, worstB.depth);
console.log('== verdict ==');
console.log('  section A worst: ' + worstA.depth.toFixed(2) + 'mm (' + worstA.cls + ')');
console.log('  section B worst: ' + worstB.depth.toFixed(2) + 'mm (' + worstB.kind + ')');
console.log('  threshold: ' + ISSUE_MM + 'mm');
console.log(worstOverall > ISSUE_MM ? 'FAIL' : 'ok');
process.exit(worstOverall > ISSUE_MM ? 1 : 0);
