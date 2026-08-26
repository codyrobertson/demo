/* The figure with a surface on it, drawn as graphite.
   Usage: node tools/skin.js [seed] [az] [el] [out.png] [size]
          POSE='{"ghAbd":1.2}' to pose it

   Everything structural here is borrowed rather than rebuilt: the depth field
   and its two peeled layers, the graphite accumulation field, and the traced
   silhouette all come from the hand project, which already got them right.
   What is new is only the surface being traced. */
'use strict';
global.window = {};
const path = require('path');
const HAND = '/home/user/demo/graphite-kinematics';
const HERE = path.join(__dirname, '..');
['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(HAND, 'src', f + '.js')));
['00-refdata', '00-anthro', '05-trace', '10-skeleton', '30-limits', '20-build', '40-surface', '50-field']
  .forEach(f => require(path.join(HERE, 'src', f + '.js')));
const writePNG = require(path.join(HAND, 'tools', 'png.js'));

const G = window.GK, M = G.math, DEG = M.DEG, RE = G.render, PEN = G.pencil;
G.anthro.useModel(require(path.join(HERE, 'data', 'ansur-model.json')));

const a = process.argv.slice(2);
const seed = parseInt(a[0] || '12345');
const az = parseFloat(a[1] || '180') * DEG;
const el = parseFloat(a[2] || '0') * DEG;
const out = a[3] || '/tmp/skin.png';
const S = parseInt(a[4] || '900');
const POSE = process.env.POSE ? JSON.parse(process.env.POSE) : {};
// ONLY=trunk or ONLY=femur draws just the parts whose name matches, which is
// the only way to find out which solid is the one in the wrong place
const ONLY = process.env.ONLY || null;

const fig = G.figure.buildFigure(seed);
const rig = G.skel.solve(fig, POSE);

// ---------------------------------------------------------------------------
//  PARTS
//  Each is a swept surface with its own identity, so the depth field can tell
//  them apart and a silhouette is never occluded by the solid it belongs to.
// ---------------------------------------------------------------------------
const LIMBS = [];
for (const s of ['L', 'R']) {
  for (const b of ['humerus', 'forearm', 'femur', 'tibia']) LIMBS.push(b + '.' + s);
}

// One global fat amount, solved so the girths come out measured. Do this
// before anything samples the field — the skin's radius depends on it.
const fatMm = G.field.fitFat(rig);

// Every part is now a stretch of the SKIN, found by root-finding outward from
// a bone through the layered field, rather than a section lofted along it.
const PARTS = [];
// the trunk is one part: twelve per-vertebra parts trace as twelve closed
// silhouettes and draw a stack of discs
PARTS.push({
  id: PARTS.length, name: 'trunk',
  at: (u, beta) => {
    const R = G.field.trunkRing(rig, u, 1);
    return R[0];
  },
  ring: (u, na) => G.field.trunkRing(rig, u, na),
  ns: 40, na: 26,
});
for (const id of LIMBS) {
  if (!rig.bones[id]) continue;
  PARTS.push({
    id: PARTS.length, name: id,
    at: (s, beta) => {
      const b = rig.bones[id];
      const r = G.field.skinRadius(rig, id, s, beta);
      const C = M.vmad(b.A, b.frame[0], b.len * Math.max(0, Math.min(1, s)));
      const dir = M.vadd(M.vmul(b.frame[1], Math.cos(beta)), M.vmul(b.frame[2], Math.sin(beta)));
      return M.vmad(C, dir, r);
    },
    ring: (s, na) => G.field.skinRing(rig, id, s, na),
    ns: 12, na: 22,
  });
}

if (ONLY) {
  const keep = PARTS.filter(P => P.name.indexOf(ONLY) === 0);
  PARTS.length = 0; keep.forEach(P => PARTS.push(P));
  console.log('drawing only: ' + PARTS.map(P => P.name).join(', '));
}

// Sample every ring once. Root-finding through the field is the expensive
// part and it does not depend on the camera, so it must not happen three
// times — once to frame, once to rasterise and once to trace.
const RING = PARTS.map((P) => {
  const rows = [];
  for (let i = 0; i <= P.ns; i++) rows.push(P.ring(i / P.ns, P.na));
  return rows;
});

// ---------------------------------------------------------------------------
//  VIEW — measure the real surface rather than the bones, or the drawing gets
//  clipped exactly where the body is widest
// ---------------------------------------------------------------------------
const view = new G.rig.View(az, el, 0, 1, [0, 0, 0], 0, 0);
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (const P of PARTS) {
  for (let i = 0; i <= P.ns; i++) {
    for (let k = 0; k < P.na; k++) {
      const q = RING[P.id][i][k];
      if (!q) continue;
      const p = view.px(q);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
  }
}
const sc = Math.min(S * 0.88 / Math.max(1e-6, x1 - x0), S * 0.88 / Math.max(1e-6, y1 - y0));
view.scale = sc;
view.cx = S * 0.5 - sc * (x0 + x1) * 0.5;
view.cy = S * 0.5 - sc * (y0 + y1) * 0.5;
view.mmPerPx = 1 / sc;

// ---------------------------------------------------------------------------
//  DEPTH — every part written with its own id, so `hidden()` can skip self
// ---------------------------------------------------------------------------
const df = new RE.DepthField(S, S, 1);
const proj = (q) => { const p = view.px(q); return [p[0], p[1], view.near(q)]; };
for (const P of PARTS) {
  let prev = null;
  for (let i = 0; i <= P.ns; i++) {
    const ring = [];
    for (let k = 0; k < P.na; k++) {
      const q = RING[P.id][i][k];
      ring.push(q ? proj(q) : null);
    }
    if (prev) {
      for (let k = 0; k < P.na; k++) {
        const k2 = (k + 1) % P.na;
        if (prev[k] && prev[k2] && ring[k2] && ring[k]) df.quad(prev[k], prev[k2], ring[k2], ring[k], P.id);
      }
    }
    // cap the ends: an open tube lets the field see straight through the near
    // wall and write the far one, and anything in front then tests unoccluded
    if (i === 0 || i === P.ns) {
      const c = ring.filter(Boolean);
      if (c.length) {
        const ax = [c.reduce((s2, p) => s2 + p[0], 0) / c.length,
          c.reduce((s2, p) => s2 + p[1], 0) / c.length,
          c.reduce((s2, p) => s2 + p[2], 0) / c.length];
        for (let k = 0; k < P.na; k++) {
          const k2 = (k + 1) % P.na;
          if (ring[k] && ring[k2]) df.quad(ax, ring[k], ring[k2], ax, P.id);
        }
      }
    }
    prev = ring;
  }
}

// ---------------------------------------------------------------------------
//  SILHOUETTES — the border of what each part covers, not a construction
// ---------------------------------------------------------------------------
const g = new PEN.Graphite(S, S, 1, seed);
const grade = PEN.gradeAt(3);
const eps = Math.max(0.30, view.mmPerPx * 1.1);
const gap = Math.max(0.90, view.mmPerPx * 3.2);

let drawn = 0, empty = 0;
for (const P of PARTS) {
  const rings = [];
  for (let i = 0; i <= P.ns; i++) {
    const row = [];
    let ok = true;
    for (let k = 0; k < P.na; k++) {
      const q = RING[P.id][i][k];
      if (!q) { ok = false; break; }
      const p = view.px(q);
      row.push([p[0], p[1], view.near(q), 1]);
    }
    if (ok) rings.push({ row, id: P.id });
  }
  if (rings.length < 2) { empty++; continue; }
  const sil = G.trace.traceCoverage(rings, {});
  if (!sil || !sil.use) { empty++; continue; }

  // weight each point by how much of it something else covers, exactly as the
  // hand does — the identity in the depth field is what stops a part from
  // occluding its own outline
  const pts = sil.outline.map((q) => {
    const v = 1 - df.hidden(q[0], q[1], q[2], P.id, eps, gap);
    return [q[0], q[1], v];
  });
  // runs() reads visibility out of the slot it is told to, and the hand
  // passes 2 because by that point it has resolved its own per-point strength
  // into slot 2. Handing it a richer tuple with the value somewhere else
  // leaves it reading zero for every point and drawing nothing at all.
  for (const run of RE.runs(pts.map(q => [q[0], q[1], q[2]]), 0.06, 2, 40)) {
    g.stroke(run.pts, {
      grade, tone: 1.0, weight: 1.15, passes: 1, taper: 0.5,
      wobble: 1, jitter: 0.55, phase: P.id * 7.3, vis: run.vis,
    });
    drawn++;
  }
}

const px = g.resolve({ paper: [244, 241, 232], ink: [26, 25, 23], k: 1.55, gamma: 1 });
writePNG(out, px, S, S);
console.log('fat term ' + fatMm.toFixed(1) + 'mm at the reference regions');
console.log('seed ' + seed + '  stature ' + fig.stature.toFixed(0) + 'mm  ' +
  PARTS.length + ' parts, ' + drawn + ' runs' + (empty ? ', ' + empty + ' parts traced to nothing' : ''));
console.log('-> ' + out);
