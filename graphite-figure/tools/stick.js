/* The bone tree as line segments, nothing else.
   Usage: node tools/stick.js [seed] [az] [el] [out.png] [size]

   Rest orientations are the one part of a skeleton that cannot be reasoned
   about on paper: a 180-degree rotation has to flip two axes and which two
   it flips decides whether hip flexion lifts the knee or kicks it backwards.
   So they get looked at. This draws the solved tree with each chain in its
   own colour and each bone's distal axis ticked, which is enough to see a
   limb pointing the wrong way, a chain rotating about the wrong axis, or a
   joint sitting somewhere no joint goes. */
'use strict';
global.window = {};
const path = require('path');
const HAND = '/home/user/demo/graphite-kinematics';
const HERE = path.join(__dirname, '..');
// Order matters: each of these captures the namespaces below it at load
// time, so 20-rig.js reaching for GK.anatomy before 10-anatomy.js has run
// leaves it holding undefined and the failure surfaces much later, inside
// solve(), as a missing constant.
['00-math', '10-anatomy', '20-rig', '30-pose']
  .forEach(f => require(path.join(HAND, 'src', f + '.js')));
['00-anthro', '10-skeleton', '20-build'].forEach(f => require(path.join(HERE, 'src', f + '.js')));
window.GK.anthro.useModel(require(path.join(HERE, 'data', 'ansur-model.json')));
const writePNG = require(path.join(HAND, 'tools', 'png.js'));

const G = window.GK, M = G.math, DEG = M.DEG;
const a = process.argv.slice(2);
const seed = parseInt(a[0] || '12345');
const az = parseFloat(a[1] || '0') * DEG;
const el = parseFloat(a[2] || '0') * DEG;
const out = a[3] || '/tmp/stick.png';
const S = parseInt(a[4] || '900');

const fig = G.figure.buildFigure(seed);
const rig = G.skel.solve(fig, {});

// ---- colour by chain, so a limb in the wrong place is obvious at a glance
const CHAIN = (id) =>
  /^(L\d|T\d|C\d|skull|pelvis)/.test(id) ? 'spine'
    : /clavicle|scapula/.test(id) ? 'girdle'
      : /humerus|forearm/.test(id) ? 'arm'
        : 'leg';
const HUE = { spine: [40, 45, 55], girdle: [200, 120, 40], arm: [40, 110, 190], leg: [50, 140, 80] };

const buf = new Uint8ClampedArray(S * S * 4);
for (let i = 0; i < S * S; i++) { buf[i * 4] = 246; buf[i * 4 + 1] = 244; buf[i * 4 + 2] = 238; buf[i * 4 + 3] = 255; }
const px = (x, y, c, al) => {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const o = (y * S + x) * 4;
  for (let k = 0; k < 3; k++) buf[o + k] += (c[k] - buf[o + k]) * al;
};
const dot = (x, y, r, c, al) => {
  for (let j = Math.floor(y - r - 1); j <= y + r + 1; j++)
    for (let i = Math.floor(x - r - 1); i <= x + r + 1; i++) {
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
      const t = 1 - M.smoothstep(M.clamp01((d - (r - 0.5)) / 1));
      if (t > 0.01) px(i, j, c, al * t);
    }
};
const line = (p, q, r, c, al) => {
  const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5));
  for (let i = 0; i <= n; i++) dot(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n, r, c, al);
};

// ---- frame it on the bones' own extent
const view = new G.rig.View(az, el, 0, 1, [0, 0, 0], 0, 0);
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (const id of rig.order) {
  for (const P of [rig.bones[id].A, rig.bones[id].B]) {
    const p = view.px(P);
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
}
const sc = Math.min(S * 0.86 / Math.max(1e-6, x1 - x0), S * 0.86 / Math.max(1e-6, y1 - y0));
view.scale = sc;
view.cx = S * 0.5 - sc * (x0 + x1) * 0.5;
view.cy = S * 0.5 - sc * (y0 + y1) * 0.5;

// ---- bones, then each bone's own axes as short ticks
for (const id of rig.order) {
  const b = rig.bones[id];
  const c = HUE[CHAIN(id)];
  line(view.px(b.A), view.px(b.B), 1.6, c, 0.95);
  dot(view.px(b.A)[0], view.px(b.A)[1], 3.2, [200, 60, 40], 0.9);
  // the local Y and Z, at a fixed screen length, so an axis flip is visible
  const L = 26 / sc;
  line(view.px(b.A), view.px(M.vmad(b.A, b.frame[1], L)), 0.8, [180, 60, 180], 0.75);
  line(view.px(b.A), view.px(M.vmad(b.A, b.frame[2], L)), 0.8, [40, 170, 170], 0.75);
}

// ---- and the hands, solved by the other project and planted on those
//      mounts. The forearm's distal frame already has +X running distally,
//      which is exactly what solve(A, pose, mount) wants, so there is no
//      adaptor here and no change of basis — that was the whole reason both
//      projects put +X along the bone.
for (const s of ['L', 'R']) {
  const m = G.skel.wristMount(rig, s);
  if (!m) continue;
  // Grow the hand to fit this body rather than to fit the population: build
  // one, measure its middle ray, and rebuild at the size that makes that ray
  // the hand length this stature calls for. Measuring rather than assuming a
  // constant keeps it right if the hand project's baseline ever moves.
  // measured hand length for this body, not a fraction of its height
  const want = fig.m.handlength;
  const probe = G.anatomy.buildAnatomy(seed ^ 0x11, {});
  const ray = probe.bones[2].lengths.reduce((x, y) => x + y, 0);
  const HA = G.anatomy.buildAnatomy(seed ^ (s === 'L' ? 0x11 : 0x22), {
    chirality: s === 'L' ? 'left' : 'right',
    size: probe.size * want / ray,
  });
  const hand = G.rig.solve(HA, G.pose.preset(HA, 'rest'), { origin: m.origin, frame: m.frame });
  for (const dg of hand.digits) {
    for (const sg of dg.segs) {
      if (!sg.rendered) continue;
      line(view.px(sg.A), view.px(sg.B), 1.0, [150, 60, 150], 0.9);
      dot(view.px(sg.A)[0], view.px(sg.A)[1], 1.6, [200, 60, 40], 0.85);
    }
  }
  const p = view.px(m.origin);
  dot(p[0], p[1], 6, [220, 140, 40], 0.45);
}

writePNG(out, buf, S, S);
const h = (id) => rig.bones[id];
console.log('seed ' + seed + '  stature ' + fig.stature.toFixed(0) + 'mm');
// The check that matters: the skeleton's own height has to agree with the
// stature the body was sampled at, and its sole has to sit on the floor.
const vertex = fig.rootHeight + h('skull').B[0];
const sole = fig.rootHeight + h('tibia.L').B[0] - fig.m.lateralmalleolusheight;
console.log('  vertex   ' + vertex.toFixed(0) + 'mm vs stature ' + fig.stature.toFixed(0) +
  'mm   (' + (vertex - fig.stature >= 0 ? '+' : '') + (vertex - fig.stature).toFixed(0) + 'mm)');
console.log('  sole     ' + sole.toFixed(0) + 'mm off the floor');
console.log('  wrist L  ' + h('forearm.L').B.map(v => v.toFixed(0)).join(', '));
console.log('  ankle L  ' + h('tibia.L').B.map(v => v.toFixed(0)).join(', '));
console.log('  toe   L  ' + h('foot.L').B.map(v => v.toFixed(0)).join(', '));
console.log('-> ' + out);
