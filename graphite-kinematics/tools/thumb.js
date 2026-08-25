/* Ground truth for the thumb ray.
   Every check below is a measurement with a published or directly observable
   range, so "the thumb is wrong" becomes a number instead of an opinion.
   Usage: node tools/thumb.js [seed]                                        */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose'].forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, M = G.math, AN = G.anatomy, RG = G.rig, PO = G.pose;
const DEG = M.DEG;
const seed = parseInt(process.argv[2] || '12345');
const A = AN.buildAnatomy(seed);

let pass = 0, fail = 0;
function check(label, value, lo, hi, unit) {
  const ok = value >= lo && value <= hi;
  ok ? pass++ : fail++;
  const v = (typeof value === 'number' ? value.toFixed(1) : value);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(52) +
    String(v).padStart(7) + (unit || '') + '   want ' + lo + '..' + hi + (unit || ''));
}
const rigFor = (k) => RG.solve(A, PO.resolveContacts(A, PO.preset(A, k)));
const inPlane = (t) => M.vnorm([t[0], t[1], 0]);
const angBetween = (a, b) => Math.acos(M.clamp(M.vdot(a, b), -1, 1)) / DEG;

// ---------------------------------------------------------------- skeleton
console.log('\n— where the ray starts —');
{
  const rig = rigFor('flat');
  const c1 = rig.digits[0].segs[0].A, c2 = rig.digits[1].segs[0].A;
  // The trapezium is in the DISTAL carpal row: the first metacarpal base sits
  // at roughly the same proximo-distal level as the second, give or take.
  check('CMC1 distal offset from CMC2', c1[0] - c2[0], -5, 7, 'mm');
  check('CMC1 radial position', -c1[1], 15, 28, 'mm');
  check('CMC1 palmar position', c1[2], 3, 15, 'mm');
}

console.log('\n— how the ray is set, at rest —');
{
  const rig = rigFor('rest');
  const mc1 = rig.digits[0].segs[0].t, mc2 = rig.digits[1].segs[0].t;
  check('MC1 radial from MC2, in the palm plane', angBetween(inPlane(mc1), inPlane(mc2)), 25, 50, 'deg');
  check('MC1 out of the palm plane, palmar', Math.asin(M.clamp(mc1[2], -1, 1)) / DEG, 25, 50, 'deg');
  // the nail of a relaxed thumb faces radially and a little dorsally
  const dp = rig.digits[0].segs[2];
  const nailDir = M.vmul(dp.frame[2], -1);          // dorsal of the thumb
  check('thumbnail faces radially (-Y component)', -nailDir[1], 0.35, 1.0, '');
  check('thumbnail dorsal component', -nailDir[2], -0.2, 0.8, '');
}

console.log('\n— the thenar is palmar-radial, not a sleeve —');
{
  // Its muscles lie on the palmar and radial aspects; the dorsal surface of
  // the first metacarpal is subcutaneous bone you can feel through the skin.
  const palmarR = AN.segmentProfile(A, 0, 0, 0.5)[1];
  const lateralR = AN.segmentProfile(A, 0, 0, 0.5)[0];
  check('thenar half-breadth at mid-metacarpal', lateralR, 13, 22, 'mm');
  check('thenar half-depth at mid-metacarpal', palmarR, 10, 20, 'mm');
  const rig = rigFor('flat');
  const mc = rig.digits[0].segs[0];
  const mid = M.vmad(mc.A, mc.t, mc.len * 0.5);
  const palmarPt = RG.digitSurface(rig, 0, 0, 0.5, -Math.PI / 2).P;
  const dorsalPt = RG.digitSurface(rig, 0, 0, 0.5, Math.PI / 2).P;
  // Measured in the HAND's frame, which is the frame the anatomy is stated
  // in: the bone you feel through the skin is on the back of the hand, not
  // on some axis of the metacarpal's own that swings with its axial set.
  // Take the furthest the flesh reaches either way, over the whole section.
  const pal = rig.root[2], dor = M.vmul(rig.root[2], -1);
  let reachP = -1e9, reachD = -1e9;
  for (let i = 0; i < 64; i++) {
    const q = M.vsub(RG.digitSurface(rig, 0, 0, 0.5, (i / 64) * M.TAU).P, mid);
    reachP = Math.max(reachP, M.vdot(q, pal));
    reachD = Math.max(reachD, M.vdot(q, dor));
  }
  check('flesh palmar of the MC1 axis', reachP, 13, 24, 'mm');
  check('flesh dorsal of the MC1 axis', reachD, 4, 11, 'mm');
}

console.log('\n— is the ray attached to the hand? —');
{
  // Opposition brings the thumb forward off the palm - that is what the
  // gesture IS - so a single bound calibrated on poses that barely oppose
  // reads a correct OK sign as a detached one. The measure itself is sound:
  // it tracks a lifted ray at about 0.9mm per mm and reports 99 once the ray
  // leaves the hand entirely. So state it per regime, and cover pinch and
  // tripod, which were never checked at all.
  // Every preset, not a chosen handful: thumbsUp and countThree both had the
  // ray clean off the hand - the drawing showed the metacarpal as a free
  // third segment - and neither was among the poses being sampled.
  const OPPOSES = { ok: 1, pinch: 1, tripod: 1 };
  for (const k of Object.keys(PO.PRESETS)) {
    const rig = rigFor(k);
    const mc = rig.digits[0].segs[0];
    let worst = -1e9;
    for (const sv of [0.25, 0.5, 0.75]) {
      const P = M.vmad(mc.A, mc.t, mc.len * sv);
      const r = AN.segmentProfile(A, 0, 0, sv)[1];
      let best = 1e9;
      for (let iu = 0; iu <= 26; iu++) for (let iv = 0; iv <= 26; iv++) {
        const u = M.lerp(-0.1, 1.1, iu / 26);
        const v = M.lerp(rig.palm.vLo(u), rig.palm.vHi(u), iv / 26);
        const sp = RG.palmSpine(rig, u, v);
        const off = M.vdot(M.vsub(P, sp.P), sp.n);
        const lat = M.vlen(M.vsub(M.vsub(P, sp.P), M.vmul(sp.n, off)));
        if (lat > 16) continue;
        best = Math.min(best, off - RG.palmThickPalmar(A, u, v) - r);
      }
      worst = Math.max(worst, best === 1e9 ? 99 : best);
    }
    check('MC1 clear of the palm surface (' + k + ')', worst,
      -99, OPPOSES[k] ? 7 : 1.5, 'mm');
  }
}

console.log('\n— where the thumb gets to —');
{
  const flat = rigFor('flat');
  const tip = flat.digits[0].tip, ixMCP = flat.digits[1].segs[1].A;
  // flat on a table, the thumb tip lies about level with the index knuckle
  check('flat: thumb tip distal offset from index MCP', tip[0] - ixMCP[0], -18, 22, 'mm');
  check('flat: thumb tip radial of the index MCP', ixMCP[1] - tip[1], 22, 62, 'mm');

  const sp = rigFor('spread');
  const s1 = sp.digits[0].segs[0].t, s2 = sp.digits[1].segs[0].t;
  check('spread: MC1 radial from MC2', angBetween(inPlane(s1), inPlane(s2)), 42, 72, 'deg');
  check('spread: MC1 out of the palm plane', Math.asin(M.clamp(s1[2], -1, 1)) / DEG, -5, 40, 'deg');

  // opposition has to actually reach: pad to pad with each finger in turn
  const names = ['', 'index', 'middle', 'ring', 'little'];
  for (const [key, target] of [['ok', 1], ['pinch', 1], ['tripod', 2]]) {
    const rig = rigFor(key);
    const d = M.vdist(rig.digits[0].tip, rig.digits[target].tip);
    check(key + ': thumb tip to ' + names[target] + ' tip', d, 8, 26, 'mm');
  }
}

console.log('\n— the first web —');
{
  for (const k of ['flat', 'spread', 'fist']) {
    const rig = rigFor(k);
    const view = new RG.View(0, 0, 0, 1, [0, 0, 0], 0, 0);
    const w = RG.firstWeb ? RG.firstWeb(rig, view) : null;
    if (!w) { console.log('  ..   firstWeb() not present'); break; }
    const span = M.vdist(w.PT, w.PI);
    const chordMid = M.vlerp(w.PT, w.PI, 0.5);
    const depth = M.vdist(chordMid, w.sag);
    check('web span, thumb flank to index flank (' + k + ')', span, k === 'fist' ? 18 : 30, 78, 'mm');
    check('web apex proximal of its chord (' + k + ')', depth, 3, 30, 'mm');
  }
}

console.log('\n— the thenar, as the radial border of the palm —');
{
  // The border is what the eye reads as the outline of the palm on the thumb
  // side. It has to swell over the thenar, open a bounded amount when the
  // thumb abducts, survive opposition, and be off the sheet by the metacarpal
  // heads - past them the space between the rays is web, not palm.
  for (const k of ['rest', 'flat', 'spread', 'ok', 'fist']) {
    const rig = rigFor(k);
    let peak = 0, peakU = 0;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, r = -rig.palm.vLo(u);
      if (r > peak) { peak = r; peakU = u; }
    }
    check('thenar width at its widest (' + k + ')', peak, 0.60, 1.10, 'v');
    check('...and that widest point sits over the thenar (' + k + ')', peakU, 0.20, 0.70, 'u');
    check('border back to the rim by the heads (' + k + ')', -rig.palm.vLo(1.0), 0.15, 0.40, 'v');
  }
}

console.log('\n— the commissure runs deep —');
{
  // A web strung only between the two proximal phalanges leaves the space
  // between the metacarpals open, and a thumb with open space beside it reads
  // as a finger stuck on the side of the hand.
  for (const k of ['flat', 'spread', 'ok']) {
    const rig = rigFor(k);
    const view = new RG.View(0, 0, 0, 1, [0, 0, 0], 0, 0);
    const w = RG.firstWeb(rig, view);
    const thMCP = rig.digits[0].segs[1].A;
    check('web starts down the metacarpal, not at the MCP (' + k + ')',
      M.vdist(w.thSide[0], thMCP), 18, 45, 'mm');
    check('commissure apex spans thumb ray to palm border (' + k + ')',
      M.vdist(w.thSide[0], w.ixSide[0]), 10, 40, 'mm');
  }
}

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
