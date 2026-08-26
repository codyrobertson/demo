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
/* A STANCE, NOT ANATOMICAL ZERO.
   Every joint at zero puts the legs exactly vertical, and with a measured
   581mm thigh circumference and hip centres 82mm apart that means the two
   thighs interpenetrate by about 22mm — which is not a modelling error, it is
   what a body with those two measurements does. But it leaves them perfectly
   coplanar, so neither occludes the other, neither one's silhouette survives
   inside the other, and the pair draws as a single column with no groin in it
   however well the crotch itself is carved.

   A standing person does not stand like that. The feet are a hand's breadth
   apart, which is three degrees of hip abduction, and at that the legs part,
   converge toward the knees and separate again at the feet — and the crotch
   reads. This is a default for the DRAWING and not a change to the skeleton:
   the rest pose is still every angle at zero, which is what checkfit.js
   measures the chain against. Any POSE= key overrides it, `{"hipAbd":0}`
   included. */
/* Elbows very slightly bent and the arms fractionally out, because nobody
   stands with locked elbows and arms glued to their seams — and because dead
   straight, the hands hang exactly in the thighs' plane and bury themselves
   in them from every camera. */
const STANCE = { hipAbd: 0.05, ghAbd: 0.09, elbow: 0.22 };
const POSE = Object.assign({}, STANCE, process.env.POSE ? JSON.parse(process.env.POSE) : {});
const ONLY = process.env.ONLY || null;
// NOMUSCLE=1 draws the same figure with the muscle layer switched off, which
// is the only way to answer "is this layer helping?" with a picture rather
// than with an opinion.
if (process.env.NOMUSCLE) delete G.muscle;
// NOBULK=1 takes the muscle layer back out of limb BULK, leaving the limbs
// to bone-with-measured-epiphyses plus a solved thickness. That comparison
// is how the chirality bug in the pelvis-anchored groups was found, so it
// stays available.
if (process.env.NOBULK) G.field.useMuscleBulk(false);

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
    /* Between 'rest' and 'flat'. The rest preset was tuned for the hand's
       own plates, where a relaxed part-curl reads as ease; hanging off a
       standing figure and seen from above-front, that same 39-degree PIP
       curl reads as a claw about to grab something. A standing hand is
       straighter — fingers together, a shadow of curl left in. */
    const pR = G.pose.preset(HA, 'rest'), pF = G.pose.preset(HA, 'flat');
    const pose = pR;
    for (let d = 0; d < 5; d++) {
      for (const k in pose.digits[d]) {
        const a = pose.digits[d][k], b = (pF.digits[d] || {})[k];
        if (typeof a === 'number' && typeof b === 'number') {
          pose.digits[d][k] = a + (b - a) * 0.55;
        }
      }
    }
    /* Mid-pronation. The mount hands over the forearm's distal frame as-is,
       whose +Z is anterior — anatomical position, palms to the camera, which
       nobody standing at ease does. A resting hand hangs palm toward the
       thigh: rotate the mount about the forearm's own axis, mirrored per
       side, stopping short of a full quarter-turn because a relaxed palm
       still shows a sliver of itself to the front. */
    /* 0.9 rad, not the full quarter-turn: at 72 degrees the front view saw
       the hand edge-on — a thin strip with fingers — and read as a claw
       hanging off a stump. At ~50 the front view gets the dorsum at
       three-quarter, which is what a standing figure's hand shows. */
    const spin = (side === 'L' ? -1 : 1) * 0.9;
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const f1 = mount.frame[1], f2 = mount.frame[2];
    mount.frame = [mount.frame[0],
      M.vadd(M.vmul(f1, cs), M.vmul(f2, sn)),
      M.vadd(M.vmul(f2, cs), M.vmul(f1, -sn))];
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
/* FRAME=<low>,<high> in millimetres above the floor crops the plate to a
   band of the body, so one region can be worked on at the size it deserves
   rather than at the size a whole figure leaves it. The band is measured in
   the body's own units, not in pixels, so the same FRAME means the same
   anatomy on every seed. */
if (process.env.FRAME) {
  const [lo, hi] = process.env.FRAME.split(',').map(Number);
  const yTop = view.px([hi - fig.rootHeight, 0, 0])[1];
  const yBot = view.px([lo - fig.rootHeight, 0, 0])[1];
  y0 = Math.min(yTop, yBot); y1 = Math.max(yTop, yBot);
  // keep the horizontal centred on the body, widened to the band's own aspect
  const cx0 = (x0 + x1) * 0.5, half = Math.max((x1 - x0) * 0.5, (y1 - y0) * 0.5);
  x0 = cx0 - half; x1 = cx0 + half;
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
// how many identities each hand reserves in the shared depth field
const HAND_ID_SPAN = 100;
const fitPin = { scale: view.scale, cx: view.cx, cy: view.cy };
// how many pixels of plate this body's hand actually gets
const handPx = fig.m.handlength * view.scale;
const fine = handPx >= 190;
const HAND_STATE = HANDS.map((H, i) => ({
  seed, anatomy: H.anatomy, pose: H.pose, contacts: false,
  mount: { origin: H.mount.origin, frame: H.mount.frame },
  view: { az, el, roll: 0 }, fit: fitPin,
  df, idBase: 1000 + i * HAND_ID_SPAN, graphite: null,
  style: { grade: 3, tone: handPx >= 330 ? 1 : 0.85, wobble: 1, ghost: 0, search: 0 },
  // At full-figure scale a hand is eighty pixels across. Everything the
  // hand project knows how to draw INSIDE its own outline — prints, ridges,
  // creases, folds, nails, tendons — is finer than that, and drawn anyway
  // it is not detail but a grey smudge where a hand should be. So the
  // interior is spent only when there are pixels to spend it in, measured
  // against the hand's own size on this plate rather than against the
  // plate's size, which is what makes the rule hold at any framing.
  detail: { print: 0, ridge: 0, lattice: 0, hair: 0, vein: 0 },
  /* Graduated, not binary. At 190px the old rule switched EVERYTHING on —
     folds, knuckle fields, tendons — and a 240px hand came out a dark
     tangled knot, far past what a pencil would state at that size. Full
     apparatus only when the hand approaches the size of its own standalone
     plates; in between, outline plus the few creases and nails that read. */
  layers: handPx >= 330 ? { print: false, ridge: false, hair: false, vein: false, hatch: false, model: false }
    : fine ? {
      print: false, ridge: false, hair: false, vein: false, hatch: false, model: false,
      fold: false, tendon: false,
    }
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

/* ...and now the hands.

   A hand gets about ninety pixels in a full-figure plate, and its own
   renderer draws it as five closed digit outlines plus a palm, each tested
   against the others. At that size a finger is seven pixels across and the
   occlusion tolerances — which are correct, being set by the depth field's
   own rasterisation error — are comparable to a whole finger's width, so the
   digits bury one another and what survives is a handful of disconnected
   arcs. A cloud of scribble where a hand should be.

   Turning the interior detail off was necessary and not sufficient: the
   problem is not what is drawn INSIDE the outline, it is that five outlines
   is the wrong number of outlines at this size. At ninety pixels a hand is
   one form, and a person drawing one would draw one shape.

   Which is already computed. The depth field holds, per pixel, which part
   the viewer can see — so the hand's visible coverage is sitting in it, at
   exactly the plate's own resolution, with occlusion by the body already
   resolved. Walking the border of that is the same construction the whole
   project uses for every other silhouette, applied to a mask that came from
   somewhere else. No geometry is rebuilt and nothing new is approximated. */
function coverageOutline(idLo) {
  const W = df.w, H = df.h, D = df.div, idHi = idLo + HAND_ID_SPAN;
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = df.i0[y * W + x];
      if (id < idLo || id >= idHi) continue;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
  }
  if (bx1 < bx0) return null;
  const PAD = 2, w = (bx1 - bx0 + 1) + PAD * 2, h = (by1 - by0 + 1) + PAD * 2;
  const cov = new Uint8Array(w * h), dep = new Float32Array(w * h);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const i = y * W + x, id = df.i0[i];
      if (id < idLo || id >= idHi) continue;
      const j = (y - by0 + PAD) * w + (x - bx0 + PAD);
      cov[j] = 1; dep[j] = df.z0[i];
    }
  }
  /* Smoothing scaled to the hand's size on the page. At 250px of hand the
     border walk's detail is real — knuckle scallops, a thumb's silhouette.
     At 60px those same scallops are two cells wide and alias into wiggles
     that read as a cartoon mitten drawn with a shaky pen. What a pencil
     drawing does at that size is state the hand as one calm shape with at
     most a notch for the thumb — which is exactly what heavier smoothing
     leaves behind. */
  const hp = (typeof handPx === 'number') ? handPx : 200;
  return G.trace.traceMask({
    w, h, cov, dep, cell: D, x0: bx0 * D, y0: by0 * D, pad: PAD, defaultOwn: idLo,
  }, { smooth: hp < 75 ? 7 : hp < 130 ? 5 : 3 });
}

if (fine) {
  HAND_STATE.forEach((st, i) => { st.graphite = g; HAND_R[i].draw(st); });
} else {
  for (const st of HAND_STATE) {
    const sil = coverageOutline(st.idBase);
    if (!sil || !sil.use) continue;
    /* Part of that border is not the hand's edge at all — it is where the
       thigh in front of it cuts across, and the thigh has already drawn that
       line itself. So each point is asked what is at it now that the outline
       has been pushed outward: if the answer is a nearer part of the body,
       the hand does not have an edge there and the point is dropped. */
    const pts = sil.outline.map((q) => {
      const cx = Math.round(q[0] / df.div), cy = Math.round(q[1] / df.div);
      let v = 1;
      if (cx >= 0 && cy >= 0 && cx < df.w && cy < df.h) {
        const i = cy * df.w + cx, id = df.i0[i];
        if (id >= 0 && (id < st.idBase || id >= st.idBase + HAND_ID_SPAN) &&
            df.z0[i] > q[2] + eps) v = 0;
      }
      return [q[0], q[1], v];
    });
    for (const run of RE.runs(pts, 0.06, 2, 40)) {
      g.stroke(run.pts, {
        grade, tone: 1.0, weight: 1.05, passes: 1, taper: 0.5,
        wobble: 1, jitter: 0.5, phase: st.idBase * 0.37, vis: run.vis,
      });
      drawn++;
    }
  }
}

// ---------------------------------------------------------------------------
//  THE INSIDE OF THE OUTLINE
//  Drawn after every silhouette, because graphite accumulates: a mark gives
//  way where the page is already dark, and modelling laid down before the
//  contours would be pressing on bare paper and then buried under them.
// ---------------------------------------------------------------------------
const DRAW = G.draw;
const LAMP = DRAW.lamp(view);
let shaded = 0;
if (!process.env.NOMODEL) {
  const put = (P, id, style) => {
    const pts = P.map((q) => {
      const p = view.px(q);
      const z = view.near(q);
      const v = (1 - df.hidden(p[0], p[1], z, id, eps, gap)) * (q[3] === undefined ? 1 : q[3]);
      return [p[0], p[1], v];
    });
    for (const run of RE.runs(pts, 0.05, 2, 30)) {
      g.stroke(run.pts, Object.assign({ grade, passes: 1, wobble: 1 }, style, { vis: run.vis }));
      shaded++;
    }
  };
  for (const P of PARTS) {
    const rows = RING[P.id];
    // the shadow band, running along the form
    // A head is a hundred pixels of page. Hatching it at the density a
    // thigh takes draws hair, not a head.
    /* Enough marks that they read as TONE rather than as lines. Graphite
       accumulates into a field and is tone-mapped once, so twenty light
       passes are a grey and five heavy ones are five lines — the count is
       the lever here, not the pressure. A head gets few because a head is a
       hundred pixels of page and hatching it at a thigh's density draws
       hair. */
    const marks = P.name === 'trunk' ? 26 : P.name === 'head' ? 16 : 17;
    const mrng = new M.Rng(seed ^ (0x9e37 + P.id * 2654435761));
    for (const b of DRAW.modelling(P, rows, view, { lamp: LAMP, marks, rng: mrng })) {
      put(b.pts, P.id, {
        tone: 0.44, weight: 0.62, taper: 0.9, jitter: 0.9, phase: P.id * 3.1 + b.t * 17,
      });
    }
    // and the creases, which are anchored to measured heights where ANSUR
    // reaches them and to a station along the part where it does not
    const stationOf = (key) => (key && P.chain)
      ? G.field.stationAtHeight(rig, P, fig.m[key]) : 0.5;
    for (const c of DRAW.landmarks(P.name, rows, stationOf)) {
      put(c.pts, P.id, {
        tone: 0.95, weight: 1.0, taper: 0.6, jitter: 0.45, phase: c.id.length * 7.7,
      });
    }
  }
}

const px = g.resolve({ paper: [244, 241, 232], ink: [26, 25, 23], k: 1.55, gamma: 1 });
writePNG(out, px, S, S);

console.log('seed ' + seed + '  stature ' + fig.stature.toFixed(0) + 'mm  ' +
  PARTS.length + ' parts, ' + drawn + ' runs' + (empty ? ', ' + empty + ' traced to nothing' : '') +
  (HANDS.length ? ', ' + HANDS.length + ' hands at ' + handPx.toFixed(0) + 'px' +
    (fine ? '' : ' (outline only)') : '') +
  (shaded ? ', ' + shaded + ' modelling' : ''));
console.log('muscle layer: ' + (!G.muscle ? 'ABSENT' :
  (process.env.NOBULK ? 'loaded, shaping only (NOBULK=1)' : 'loaded, driving limb bulk')));
console.log('soft tissue each region needed, to reach its measured girth:');
for (const r of fit.report) {
  console.log('  ' + (r.region + ' @ ' + r.girth).padEnd(24) + r.t.toFixed(1).padStart(6) + 'mm   girth ' +
    r.got.toFixed(0).padStart(5) + ' vs ' + r.want.toFixed(0).padStart(5) +
    (r.capped ? '   NOT REACHED' : ''));
}
console.log('-> ' + out);
