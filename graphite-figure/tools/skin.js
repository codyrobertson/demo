/* The figure with a surface on it, drawn as graphite.
   Usage: node tools/skin.js [seed] [az] [el] [out.png] [size]
          POSE='{"ghAbd":1.2}' to pose it
          ONLY=trunk to draw one part, which is how you find out which solid
          is the one in the wrong place

   Everything structural here is borrowed rather than rebuilt: the depth field
   and its two peeled layers, the graphite accumulation field, and the traced
   silhouette all come from the hand project, which already got them right.
   What is new is only the surface being traced — and that now lives in
   src/50-field.js rather than here, because the parts of a body and the
   scope of each part's field are facts about the body, not about this tool. */
'use strict';
const G = require('./load.js')();
const path = require('path');
const M = G.math, DEG = M.DEG, RE = G.render, PEN = G.pencil;
const writePNG = require('/home/user/demo/graphite-kinematics/tools/png.js');

const a = process.argv.slice(2);
const seed = parseInt(a[0] || '12345');
const az = parseFloat(a[1] || '180') * DEG;
const el = parseFloat(a[2] || '0') * DEG;
const out = a[3] || '/tmp/skin.png';
const S = parseInt(a[4] || '900');
const POSE = process.env.POSE ? JSON.parse(process.env.POSE) : {};
const ONLY = process.env.ONLY || null;
// NOMUSCLE=1 draws the same figure with the muscle layer switched off, which
// is the only way to answer "is this layer helping?" with a picture rather
// than with an opinion.
if (process.env.NOMUSCLE) delete G.muscle;

const fig = G.figure.buildFigure(seed);
const rig = G.skel.solve(fig, POSE);

// One global fat amount, solved so the girths come out measured. Do this
// before anything samples the field — the skin's radius depends on it.
const fit = G.field.fitFat(rig);

const PARTS = G.field.parts(rig).filter(P => !ONLY || P.name.indexOf(ONLY) === 0);
PARTS.forEach((P, i) => { P.id = i; });
if (ONLY) console.log('drawing only: ' + PARTS.map(P => P.name).join(', '));

// Sample every ring once. Root-finding through the field is the expensive
// part and it does not depend on the camera, so it must not happen three
// times — once to frame, once to rasterise and once to trace.
const RING = PARTS.map((P) => {
  const rows = [];
  for (let i = 0; i <= P.ns; i++) {
    rows.push(P.ring(P.s0 + (P.s1 - P.s0) * (i / P.ns), P.na));
  }
  return rows;
});

// ---------------------------------------------------------------------------
//  HANDS
//  Solved by the other project and planted on the forearms' distal frames.
//  There is no adaptor and no change of basis: both projects put +X along
//  the bone running proximal to distal, so a forearm's distal frame already
//  IS what solve(A, pose, mount) wants.
// ---------------------------------------------------------------------------
const HANDS = [];
if (!ONLY) {
  // Grow the hand to fit THIS body rather than the population: build one,
  // measure its middle ray, and rebuild at the size that makes that ray the
  // hand length this stature was sampled with. Measuring rather than
  // assuming a constant keeps it right if the hand project's baseline moves.
  const probe = G.anatomy.buildAnatomy(seed ^ 0x11, {});
  const ray = probe.bones[2].lengths.reduce((x, y) => x + y, 0);
  for (const side of ['L', 'R']) {
    const mount = G.skel.wristMount(rig, side);
    if (!mount) continue;
    const HA = G.anatomy.buildAnatomy(seed ^ (side === 'L' ? 0x11 : 0x22), {
      chirality: side === 'L' ? 'left' : 'right',
      size: probe.size * fig.m.handlength / ray,
    });
    const pose = G.pose.preset(HA, 'rest');
    HANDS.push({
      side, anatomy: HA, pose, mount,
      // Contacts off, so the pose the renderer draws is the pose solved
      // here — otherwise the framing pass below measures a hand the plate
      // does not draw.
      rig: G.rig.solve(HA, pose, { origin: mount.origin, frame: mount.frame }),
    });
  }
}

// ---------------------------------------------------------------------------
//  VIEW — measure the real surface rather than the bones, or the drawing gets
//  clipped exactly where the body is widest
// ---------------------------------------------------------------------------
const view = new G.rig.View(az, el, 0, 1, [0, 0, 0], 0, 0);
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (const P of PARTS) {
  for (let i = 0; i <= P.ns; i++) {
    const row = RING[P.id][i];
    if (!row) continue;
    for (const q of row) {
      if (!q) continue;
      const p = view.px(q);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
  }
}
for (const H of HANDS) {
  for (const dg of H.rig.digits) {
    for (const sg of dg.segs) {
      if (!sg.rendered) continue;
      for (const q of [sg.A, sg.B]) {
        const p = view.px(q);
        // a fingertip's pulp sits outside its own segment endpoint, and a
        // drawing clipped at the fingertips is the classic way to find that out
        x0 = Math.min(x0, p[0] - 12); x1 = Math.max(x1, p[0] + 12);
        y0 = Math.min(y0, p[1] - 12); y1 = Math.max(y1, p[1] + 12);
      }
    }
  }
}
const sc = Math.min(S * 0.90 / Math.max(1e-6, x1 - x0), S * 0.90 / Math.max(1e-6, y1 - y0));
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
    const row = RING[P.id][i];
    const ring = row ? row.map(q => (q ? proj(q) : null)) : null;
    if (prev && ring) {
      for (let k = 0; k < P.na; k++) {
        const k2 = (k + 1) % P.na;
        if (prev[k] && prev[k2] && ring[k2] && ring[k]) df.quad(prev[k], prev[k2], ring[k2], ring[k], P.id);
      }
    }
    // cap the ends: an open tube lets the field see straight through the near
    // wall and write the far one, and anything in front then tests unoccluded.
    // The cap goes on the first and last ring that EXIST, which after
    // trimming is almost always the first and last station, but a part whose
    // middle is solid and whose ends are not would otherwise stay open.
    if (ring && (!prev || i === P.ns || !RING[P.id][i + 1])) {
      const c = ring.filter(Boolean);
      if (c.length) {
        const ax = [0, 1, 2].map(j => c.reduce((s2, p) => s2 + p[j], 0) / c.length);
        for (let k = 0; k < P.na; k++) {
          const k2 = (k + 1) % P.na;
          if (ring[k] && ring[k2]) df.quad(ax, ring[k], ring[k2], ax, P.id);
        }
      }
    }
    prev = ring;
  }
}

// Every solid has to be in the field before ANY outline is tested against
// it, so the hands are BUILT here and PAINTED later: build writes depth,
// draw makes marks. Done the other way round, the body's outline would run
// straight through the hand in front of it.
const fitPin = { scale: view.scale, cx: view.cx, cy: view.cy };
// how many pixels of plate this body's hand actually gets
const handPx = fig.m.handlength * view.scale;
const fine = handPx >= 190;
const HAND_STATE = HANDS.map((H, i) => ({
  seed, anatomy: H.anatomy, pose: H.pose, contacts: false,
  mount: { origin: H.mount.origin, frame: H.mount.frame },
  view: { az, el, roll: 0 }, fit: fitPin,
  df, idBase: 1000 + i * 100, graphite: null,
  style: { grade: 3, tone: 1, wobble: 1, ghost: 0, search: 0 },
  // At full-figure scale a hand is eighty pixels across. Everything the
  // hand project knows how to draw INSIDE its own outline — prints, ridges,
  // creases, folds, nails, tendons — is finer than that, and drawn anyway
  // it is not detail but a grey smudge where a hand should be. So the
  // interior is spent only when there are pixels to spend it in, measured
  // against the hand's own size on this plate rather than against the
  // plate's size, which is what makes the rule hold at any framing.
  detail: { print: 0, ridge: 0, lattice: 0, hair: 0, vein: 0 },
  layers: fine ? { print: false, ridge: false, hair: false, vein: false, hatch: false, model: false }
    : {
      print: false, ridge: false, hair: false, vein: false, hatch: false, model: false,
      crease: false, fold: false, nail: false, palmcrease: false, tendon: false, bone: false,
    },
  quality: 1,
}));
const HAND_R = HAND_STATE.map(() => new RE.Renderer(S, S));
HAND_STATE.forEach((st, i) => { st.built = HAND_R[i].build(st); });

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
    const row = RING[P.id][i];
    if (!row) continue;
    const r = [];
    let ok = true;
    for (const q of row) {
      if (!q) { ok = false; break; }
      const p = view.px(q);
      r.push([p[0], p[1], view.near(q), 1]);
    }
    if (ok) rings.push({ row: r, id: P.id });
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
  for (const run of RE.runs(pts, 0.06, 2, 40)) {
    g.stroke(run.pts, {
      grade, tone: 1.0, weight: 1.15, passes: 1, taper: 0.5,
      wobble: 1, jitter: 0.55, phase: P.id * 7.3, vis: run.vis,
    });
    drawn++;
  }
}

// ...and now the hands, into the same sheet and against the field that
// already holds the body.
HAND_STATE.forEach((st, i) => { st.graphite = g; HAND_R[i].draw(st); });

const px = g.resolve({ paper: [244, 241, 232], ink: [26, 25, 23], k: 1.55, gamma: 1 });
writePNG(out, px, S, S);

console.log('seed ' + seed + '  stature ' + fig.stature.toFixed(0) + 'mm  ' +
  PARTS.length + ' parts, ' + drawn + ' runs' + (empty ? ', ' + empty + ' traced to nothing' : '') +
  (HANDS.length ? ', ' + HANDS.length + ' hands at ' + handPx.toFixed(0) + 'px' +
    (fine ? '' : ' (outline only)') : ''));
console.log('muscle layer: ' + (G.muscle ? 'loaded' : 'ABSENT — the soft layer is standing in for it'));
console.log('soft tissue each region needed, to reach its measured girth:');
for (const r of fit.report) {
  console.log('  ' + (r.region + ' @ ' + r.girth).padEnd(24) + r.t.toFixed(1).padStart(6) + 'mm   girth ' +
    r.got.toFixed(0).padStart(5) + ' vs ' + r.want.toFixed(0).padStart(5) +
    (r.capped ? '   NOT REACHED' : ''));
}
console.log('-> ' + out);
