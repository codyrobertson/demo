/* ============================================================================
   GRAPHITE FIGURE — src/60-draw.js
   The inside of the outline.

   A traced silhouette is a paper cutout. Two edges and a cap say the same
   thing whether what lies between them is round, flat or hollow, which is why
   a figure drawn as outline alone reads as a shape of a person rather than as
   a person. Everything that makes the hand project's plates read as hands
   happens INSIDE the outline — tone that turns, creases that answer joints,
   the few places bone comes to the surface — and none of it was here.

   It ports rather than being reinvented, because the two projects share the
   one thing that matters: every surface is parameterised the same way. A
   digit segment is (s, alpha) along and around a bone; a figure part is
   (station, beta) along and around its own axis. A mark authored in that
   space is correct in any pose from any angle — it curves where the form
   curves, foreshortens where the form turns, and goes over the horizon of the
   form's own silhouette — and that is as true of a gluteal fold as it is of a
   knuckle crease.

   WHAT IS HERE
     lamp()        one studio light, raked off the view
     normals()     surface normals from the sampled rings, no extra field work
     bandAt()      the shadow band at one ring, terminator to silhouette
     modelling()   the shadow band strokes, walked along a form
     landmarks()   the creases, folds and bone-derived lines of the head,
                   neck, shoulders and trunk, filtered to the scale they are
                   actually being drawn at

   STATION VS ROW-FRACTION — read this before authoring a mark.
   `onSurface(rows, s, beta)` takes `s` as a fraction of the SAMPLED RING
   ARRAY: 0 is rows[0], 1 is rows[NS]. That is not the same number as a
   part's own NATIVE station — the chain-fraction stationAtHeight() returns,
   or the bone-fraction a bone-based part's own axis uses — because a part's
   rows only ever span [part.s0, part.s1], and neither end of that is [0,1]
   for anything but an arm or a leg. Feed a native station into onSurface
   directly and it lands at the wrong ring: fed a chain-fraction of 0.85 on a
   trunk whose own range is [-0.22, 1.10], onSurface treats 0.85 as already
   being 85% of the way up the SAMPLED range and the mark sits noticeably
   higher than intended; fed a negative native station — every head landmark
   below the tragion — clamp01() flattens it to the very first ring and every
   one of them stacks at the jaw's own lower edge regardless of where it was
   meant to sit. Both of those are real, not theoretical: measured against
   this file's own gluteal crease (anchored to buttockheight, a genuinely
   negative-leaning native station on the trunk's [-0.22, 1.10] range) the old
   unrescaled code landed it at row 0 of 52 — clamped to the trunk's bottom
   edge, not at the buttock. See `resolveStation()` below, which is where
   every new landmark's station is actually produced, native station in and
   onSurface-ready fraction out, and see `LANDMARKS` for the three surviving
   pre-existing trunk entries that were authored (by eye, against renders)
   directly in the row-fraction domain and are deliberately left there rather
   than reinterpreted.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const FIELD = GK.field;
  const { clamp01, lerp, vadd, vsub, vmul, vdot, vnorm, vcross, vlen } = M;

  /**
   * One lamp, mostly defined off the view.
   *
   * Seventy-five degrees off the eye, not forty-five, for the reason the hand
   * project found: the drawable shadow runs from the terminator to the
   * silhouette, and how much of the PAGE that covers falls away fast as the
   * lamp swings toward the camera. At forty-five it is the outer sixth of a
   * limb's width and reads as a line drawn beside the edge; at seventy-five
   * it is most of the form and the limb goes round.
   *
   * Raked sideways rather than raised, and tipped a little from above because
   * a figure is lit in a room and rooms light from overhead.
   */
  function lamp(view) {
    return vnorm(vadd(vmul(view.e, 0.24),
      vadd(vmul(view.u, 0.42), vmul(view.r, -0.88))));
  }

  /**
   * Surface normals for a part's sampled rings.
   *
   * Taken from the rings themselves rather than from the field. The field
   * could be differenced for a gradient, but that is six more root-finds per
   * normal on a surface that is already sampled, and the ring grid carries
   * the same information: the cross product of the way round and the way
   * along IS the normal, up to a sign that the axis settles.
   */
  function normals(rows) {
    const NS = rows.length;
    const out = new Array(NS);
    for (let i = 0; i < NS; i++) {
      const row = rows[i];
      if (!row) { out[i] = null; continue; }
      const NA = row.length;
      // the ring's own centre, which is what tells an outward normal from an
      // inward one without needing the axis passed in
      const C = [0, 0, 0];
      for (const q of row) { C[0] += q[0]; C[1] += q[1]; C[2] += q[2]; }
      C[0] /= NA; C[1] /= NA; C[2] /= NA;
      const prev = rows[i - 1] || rows[i + 1];
      const next = rows[i + 1] || rows[i - 1];
      const nn = new Array(NA);
      for (let k = 0; k < NA; k++) {
        const a = row[(k + 1) % NA], b = row[(k - 1 + NA) % NA];
        const dBeta = vsub(a, b);
        const dS = (prev && next && prev !== next) ? vsub(next[k], prev[k])
          : vsub(row[k], C);
        let n = vcross(dBeta, dS);
        const L = vlen(n);
        n = L > 1e-9 ? vmul(n, 1 / L) : vnorm(vsub(row[k], C));
        if (vdot(n, vsub(row[k], C)) < 0) n = vmul(n, -1);
        nn[k] = n;
      }
      out[i] = nn;
    }
    return out;
  }

  // the surface is turning away this much before it counts as over the
  // horizon and stops being drawable at all
  const HZ = 0.10;

  /**
   * The shadow band at one ring: which arc of it is in shadow and still
   * facing, walked from the terminator toward the silhouette.
   *
   * Running it from the terminator matters. That is the end the light has
   * only just left, so a fraction across the band means the same thing at
   * every station, and a stroke drawn at a constant fraction follows the
   * terminator as it walks round a limb that bends.
   *
   * THE BAND'S ENDS ARE FRACTIONAL, NOT INTEGER, AND THAT IS NOT A NICETY.
   * A first version found k0/k1 by scanning whole angular samples for where
   * the test flipped and stopped there. That snaps both ends of the band to
   * whichever sample happened to be first on the inside of the test, so as
   * the station walks down a form the boundary does not slide — it holds for
   * a run of stations and then jumps a whole angular step at once, because
   * that is what an integer index does. A stroke drawn at a constant
   * fraction `t` across the band therefore steps sideways by a full angular
   * sample every time the boundary jumps, and modelling() draws exactly that:
   * a sawtooth standing in for a line, worst on a head at high angular
   * resolution where the geometry is finest and the eye is least forgiving
   * of a stair-step. So both ends are refined to the fractional index where
   * the BINDING quantity — `lam` or `fac`, whichever crosses first — actually
   * crosses its threshold, by linear interpolation between the last sample
   * inside the band and the first sample outside it. The band is then
   * RESAMPLED at a fixed number of fractional positions between those two
   * refined ends, and the cumulative used by at() is built from that
   * resampling rather than from the original integer steps — which is the
   * part that actually matters: refining just the ends and still summing the
   * old integer steps in between would smooth the boundary and leave every
   * interior stride exactly as coarse as before.
   */
  function bandAt(row, nrm, L, e) {
    if (!row || !nrm) return null;
    const NA = row.length;
    const lam = new Float64Array(NA), fac = new Float64Array(NA);
    let any = false;
    for (let k = 0; k < NA; k++) {
      lam[k] = vdot(nrm[k], L);
      fac[k] = vdot(nrm[k], e);
      if (lam[k] < 0.02 && fac[k] > HZ) any = true;
    }
    if (!any) return null;
    const wrap = (k) => ((k % NA) + NA) % NA;
    const ok = (k) => lam[wrap(k)] < 0.02 && fac[wrap(k)] > HZ;
    let k0 = 0;
    while (!ok(k0) && k0 < NA) k0++;
    if (k0 >= NA) return null;
    let g = 0;
    while (ok(k0 - 1) && g++ < NA) k0--;
    let k1 = k0; g = 0;
    while (ok(k1 + 1) && g++ < NA) k1++;
    if (k1 - k0 < 2) return null;

    // fractional index between `inside` (known ok) and `outside` (known not
    // ok, one step further out) at which the binding quantity crosses —
    // whichever of the two tests flips first, since either can bind
    const crossing = (a, b, arr, thresh, keepBelow) => {
      const va = arr[wrap(a)] - thresh, vb = arr[wrap(b)] - thresh;
      const insideOk = keepBelow ? va < 0 : va > 0;
      const outsideOk = keepBelow ? vb < 0 : vb > 0;
      if (insideOk === outsideOk) return null;   // this quantity never crosses here
      return va / (va - vb);
    };
    const refine = (inside, outside) => {
      const tl = crossing(inside, outside, lam, 0.02, true);   // lam < 0.02
      const tf = crossing(inside, outside, fac, HZ, false);    // fac > HZ
      let t = 1;
      if (tl !== null) t = Math.min(t, clamp01(tl));
      if (tf !== null) t = Math.min(t, clamp01(tf));
      return inside + t * (outside - inside);
    };
    const k0f = refine(k0, k0 - 1);
    const k1f = refine(k1, k1 + 1);

    const lamAt = (kf) => { const k = Math.floor(kf), fr = kf - k; return lerp(lam[wrap(k)], lam[wrap(k + 1)], fr); };
    const facAt = (kf) => { const k = Math.floor(kf), fr = kf - k; return lerp(fac[wrap(k)], fac[wrap(k + 1)], fr); };
    const posAt = (kf) => { const k = wrap(Math.floor(kf)), k2 = wrap(k + 1), fr = kf - Math.floor(kf); return M.vlerp(row[k], row[k2], fr); };

    // Toward the silhouette, whichever end that is: the terminator is the end
    // where the surface is closest to facing the lamp.
    const flip = Math.abs(lamAt(k0f)) >= Math.abs(lamAt(k1f));
    const loEnd = flip ? k1f : k0f, hiEnd = flip ? k0f : k1f;

    // Resample at a fixed number of FRACTIONAL positions across the refined
    // band and build the cumulative from those — this is the step that
    // actually removes the staircase, not the refined ends on their own.
    const NR = 24;
    const kfs = new Array(NR + 1), lams = new Array(NR + 1), facs = new Array(NR + 1);
    for (let i = 0; i <= NR; i++) {
      const kf = lerp(loEnd, hiEnd, i / NR);
      kfs[i] = kf; lams[i] = lamAt(kf); facs[i] = facAt(kf);
    }
    // Spaced by how much of the PAGE each step covers, not by angle. The far
    // end of a band is turning away and projects to a sliver; spaced by angle,
    // every mark there lands on the same few pixels and the edge goes black.
    const cum = [0];
    for (let i = 1; i <= NR; i++) cum.push(cum[i - 1] + Math.max(0.05, facs[i]));
    const total = cum[cum.length - 1] || 1;
    const at = (t) => {
      const want = clamp01(t) * total;
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < want) i++;
      const f = (want - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
      return {
        P: posAt(lerp(kfs[i], kfs[i + 1], f)),
        lam: lerp(lams[i], lams[i + 1], f),
        fac: lerp(facs[i], facs[i + 1], f),
      };
    };
    let lo = 9;
    for (const v of lams) lo = Math.min(lo, v);
    return { at, lo };
  }

  /**
   * The modelling: strokes running ALONG a form, inside its shadow.
   *
   * Along rather than across, because a stroke that follows the length of a
   * limb describes the limb, and one that rings it describes a pipe. Tone is
   * deepest a little in from the terminator and eases off again right at the
   * edge — light comes back round off whatever the figure is standing over,
   * and a band that simply darkens to the silhouette welds the form to its
   * own outline.
   */
  function modelling(part, rows, view, opts) {
    opts = opts || {};
    const L = opts.lamp || lamp(view);
    const nrm = normals(rows);
    const NM = opts.marks === undefined ? 7 : opts.marks;
    const rng = opts.rng || new M.Rng(0x5eed);
    const NS = rows.length;
    const out = [];
    const bands = rows.map((row, i) => bandAt(row, nrm[i], L, view.e));
    for (let m = 0; m < NM; m++) {
      /* WHERE THIS MARK SITS ACROSS THE BAND.
         Evenly spaced and identical in length, a set of these reads as
         corduroy — the first pass drew a limb as a comb. Two things fix it
         and neither is noise for its own sake: real hatching varies its
         spacing slightly, and it varies its LENGTH a lot, because a hand
         lifts off. So each mark is nudged off its slot by a fraction of the
         gap, and each covers its own span of the form rather than all of
         them running end to end. */
      const t = clamp01((m + 0.8 + rng.f(-0.30, 0.30)) / (NM + 0.6));
      const span = rng.f(0.45, 1.0);
      const mid = rng.f(0.18, 0.82);
      const i0 = Math.floor((mid - span * 0.5) * NS), i1 = Math.ceil((mid + span * 0.5) * NS);
      let run = [];
      const flush = () => {
        if (run.length > 2) out.push({ pts: run, t });
        run = [];
      };
      for (let i = Math.max(0, i0); i < Math.min(NS, i1); i++) {
        const b = bands[i];
        if (!b) { flush(); continue; }
        const q = b.at(t);
        /* HOW DARK. Three things multiply, and the third is the one that
           stops a form welding itself to its own outline: light comes back
           round off whatever the figure stands over, so the very edge is
           NOT the darkest part of a shadow — the darkest part is a little
           way in from it. */
        const depth = clamp01(-q.lam / 0.55);           // into the shadow
        const edge = clamp01((q.fac - HZ) / 0.30);      // and off again at the rim
        const core = Math.pow(Math.sin(clamp01(t) * Math.PI), 0.55);
        const ends = Math.sin(clamp01((i - i0) / Math.max(1, i1 - i0)) * Math.PI);
        const tone = depth * core * (0.10 + 0.90 * edge * edge) * (0.35 + 0.65 * ends);
        if (tone < 0.05) { flush(); continue; }
        run.push([q.P[0], q.P[1], q.P[2], tone]);
      }
      flush();
    }
    return out;
  }

  // =========================================================================
  //  LANDMARK AUTHORING HELPERS
  // =========================================================================

  // beta runs from +Y (the figure's left) toward +Z (anterior), so 0 is the
  // left flank, a quarter turn is dead front, a half is the right flank and
  // three quarters is the back. Confirmed against the head's own frame
  // comment in 50-field.js ("+X up, +Y left, +Z front") and, separately,
  // against the humerus: in the rest pose used to render, humerus.frame[2]
  // comes out [0,0,1] exactly — pure global anterior, untouched by however
  // the shoulder swings the bone — so FRONT/BACK below read as anatomical
  // anterior/posterior on an arm as well as on the trunk and head, and only
  // the medial/lateral axis (beta=0 / beta=PI) is local to the limb.
  const FRONT = Math.PI * 0.5, BACK = Math.PI * 1.5, LEFT = 0, RIGHT = Math.PI;

  /** a curve on a part's surface, from its sampled rings, in (station, beta).
   *  `s` is the ROWS-ARRAY fraction (0=rows[0], 1=rows[NS]) — see the header
   *  comment for why that is a different number from a part's own native
   *  station, and resolveStation() below for the one place that conversion
   *  is made. */
  function onSurface(rows, s, beta) {
    const NS = rows.length - 1;
    const f = clamp01(s) * NS;
    let i = Math.min(NS - 1, Math.max(0, Math.floor(f)));
    let t = f - i;
    let a = rows[i], b = rows[i + 1];
    if (!a || !b) {
      for (let j = 0; j <= NS && (!a || !b); j++) {
        if (!a) { a = rows[Math.min(NS, i + j)]; }
        if (!b) { b = rows[Math.max(0, i - j)]; }
      }
      if (!a || !b) return null;
      t = 0;
    }
    const NA = a.length;
    const kf = (((beta / (Math.PI * 2)) % 1) + 1) % 1 * NA;
    const k = Math.floor(kf) % NA, k2 = (k + 1) % NA, fr = kf - Math.floor(kf);
    const pa = M.vlerp(a[k], a[k2], fr), pb = M.vlerp(b[k], b[k2], fr);
    return M.vlerp(pa, pb, t);
  }

  /**
   * The (row, angle) sample nearest a given world point, as (s, beta)
   * already in onSurface's own row-fraction domain — no rescaling needed,
   * because the row INDEX already IS that domain by construction: row i was
   * built at native station part.s0 + (part.s1-part.s0)*i/ns, so i/NS is
   * exactly the `s` onSurface wants.
   *
   * This is what makes a landmark that lies over a bone DERIVED rather than
   * guessed: walk the bone in world space and ask the sampled skin which of
   * its own samples is nearest. Brute force over every ring sample — a few
   * thousand points for a whole part — because nothing here runs per frame
   * or per pixel: it runs once, when a plate's landmark set is built.
   */
  function nearestOnRows(rows, P) {
    let bi = -1, bk = -1, bd = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      for (let k = 0; k < row.length; k++) {
        const q = row[k];
        const dx = q[0] - P[0], dy = q[1] - P[1], dz = q[2] - P[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; bi = i; bk = k; }
      }
    }
    if (bi < 0) return null;
    const NS = rows.length - 1, NA = rows[bi].length;
    return { s: bi / NS, beta: (bk / NA) * Math.PI * 2, dist: Math.sqrt(bd) };
  }

  /**
   * A bone, projected onto a part's own sampled surface: N+1 points from A
   * to B (or the [f0,f1] fraction of that span), each nearest-matched onto
   * the rings. Used for the clavicle and the acromion — real bones the
   * trunk's rig carries, that the trunk's own field folds into its skin
   * (KEEP.trunk keeps clavicle.L/.R), so a line laid over one of them is
   * reporting where the bone actually is rather than an arc picked by eye.
   */
  function projectBone(rows, A, B, n, f0, f1) {
    f0 = f0 === undefined ? 0 : f0; f1 = f1 === undefined ? 1 : f1;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = f0 + (f1 - f0) * (i / n);
      const hit = nearestOnRows(rows, M.vlerp(A, B, u));
      if (hit) pts.push(hit);
    }
    return pts;
  }

  /**
   * A native station — a chain-fraction from stationAtHeight, or a head
   * bone-fraction — rescaled into onSurface's row-fraction domain. This is
   * the fix described in the header comment, applied at the one point every
   * new landmark's station actually passes through.
   */
  function nativeFrac(part, nativeS) {
    const span = part.s1 - part.s0;
    return span ? (nativeS - part.s0) / span : 0.5;
  }

  /**
   * Resolve one control point's station spec into onSurface's row-fraction
   * domain. Three shapes:
   *   {row:N}        already in that domain — the escape hatch that lets a
   *                  mark tuned directly against renders (as the three
   *                  surviving pre-existing trunk creases were) stay exactly
   *                  where it was tuned, and the one shape a limb's own
   *                  along-the-chain stations use too, since an arm's rows
   *                  span its FULL chain (s0=0, s1=1 — checked by trimRange
   *                  finding both the shoulder and the wrist already inside
   *                  the solid, not at its edge, on every seed tried) and so
   *                  never need rescaling in the first place.
   *   {at, dMm}      an ANSUR height (plus an EST offset in mm) on a CHAIN
   *                  part, via stationAtHeight — the notch, the nipple row,
   *                  the buttock.
   *   {frac, of}     head only: a fraction of a measured head/face length —
   *                  'up' is tragiontopofhead, 'dn' is mentonsellionlength —
   *                  taken from the skull bone's own origin and rescaled by
   *                  its own solved length. This is how the head's negative
   *                  stations (everything below the tragion) and its
   *                  above-one stations (the vertex, on a bone axis whose
   *                  own length is a different measure) turn into the same
   *                  domain as every other landmark, and how the anchors the
   *                  head's own volumes are built from — the coordinator's
   *                  own ST table in 50-field.js: brow at 0.12·up, cheekbone
   *                  at −0.16·dn, the jaw angle at −0.55·dn, the chin at
   *                  −0.90·dn, the vertex at 0.93·up — turn into stations
   *                  here without re-guessing them.
   */
  function resolveStation(part, spec, ctx) {
    if (spec.row !== undefined) return spec.row;
    const rig = ctx.rig;
    if (spec.of) {
      const sk = rig.bones.skull, m = rig.figure.m;
      const base = spec.of === 'up' ? m.tragiontopofhead : m.mentonsellionlength;
      return nativeFrac(part, spec.frac * base / sk.len);
    }
    if (spec.at !== undefined) {
      if (!part.chain || !FIELD || !FIELD.stationAtHeight) return 0.5;
      const mm = rig.figure.m[spec.at] + (spec.dMm || 0);
      return nativeFrac(part, FIELD.stationAtHeight(rig, part, mm));
    }
    return 0.5;
  }

  /**
   * The real-world size of a part's sampled surface: the diagonal of its
   * rings' own bounding box, in millimetres. Not exact — a limb pointed at
   * the camera reads bigger here than it projects to — but it does not need
   * to be: a level-of-detail gate only has to say, consistently, "this part
   * is big on this plate" or "this part is small", and a bounding diagonal
   * says that from geometry already in hand, with no extra field query and
   * no per-part table of which ANSUR measure stands in for "how big".
   */
  function partExtentMm(rows) {
    let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity;
    let hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
    for (const row of rows) {
      if (!row) continue;
      for (const p of row) {
        if (p[0] < lo0) lo0 = p[0]; if (p[0] > hi0) hi0 = p[0];
        if (p[1] < lo1) lo1 = p[1]; if (p[1] > hi1) hi1 = p[1];
        if (p[2] < lo2) lo2 = p[2]; if (p[2] > hi2) hi2 = p[2];
      }
    }
    if (!isFinite(lo0)) return 0;
    const dx = hi0 - lo0, dy = hi1 - lo1, dz = hi2 - lo2;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** a part's own screen span, in pixels, on a plate of this scale */
  function partPxOf(rows, mmPerPx) {
    if (!mmPerPx) return Infinity;   // no scale given: gate nothing
    return partExtentMm(rows) / mmPerPx;
  }

  /**
   * Keep only the landmarks that earn their keep at this plate's scale.
   * `partPx` is the part's own screen span — the same idea skin.js already
   * uses to gate a hand's whole interior at 190px of hand, generalised so
   * that a mark on a head declares its OWN threshold rather than the head
   * being all-or-nothing: the jaw line and the sternocleidomastoid hold
   * their minPx low because they read at a hundred pixels of head; the eye,
   * the nostril and the lip line hold theirs high, because under it they are
   * not a smaller version of the mark, they are a smudge standing in for
   * one, and a smudge is worse than the bare surface it replaces.
   */
  function visibleAt(spec, partPx) {
    return spec.filter((L) => partPx >= (L.minPx || 0));
  }

  const mirrorBeta = (b) => Math.PI - b;
  /** an L-suffixed entry, reflected to its R counterpart: every beta flips
   *  (b = PI - b, which fixes FRONT and BACK and swaps LEFT with RIGHT),
   *  every station spec is reused as-is since a station is a height, and a
   *  height does not have a side. A beta may itself be a function of ctx
   *  (see resolveBeta below, used where a face measurement scales a lateral
   *  offset) — mirrored by wrapping it rather than by calling it. */
  function mirror(entry) {
    const e = Object.assign({}, entry);
    e.id = entry.id.replace(/\.L\b/, '.R');
    if (entry.ctrl) e.ctrl = entry.ctrl.map((c) => {
      const b = c[1];
      return [c[0], typeof b === 'function' ? (ctx) => mirrorBeta(b(ctx)) : mirrorBeta(b)];
    });
    return e;
  }
  /** a beta may be a plain radian or, where a face measurement scales it, a
   *  function of ctx — resolved here rather than inline everywhere a beta
   *  is read. */
  function resolveBeta(spec, ctx) { return typeof spec === 'function' ? spec(ctx) : spec; }

  // station-spec shorthands, so a landmark table entry reads as anatomy
  // rather than as a call to resolveStation()
  const ofUp = (frac) => ({ frac, of: 'up' });      // head: fraction of tragiontopofhead
  const ofDn = (frac) => ({ frac, of: 'dn' });      // head: fraction of mentonsellionlength
  const atH = (key, dMm) => ({ at: key, dMm: dMm || 0 });  // an ANSUR height (+ EST mm)
  const rowS = (r) => ({ row: r });                 // already onSurface's own domain

  // =========================================================================
  //  LANDMARKS
  //  The few lines that say "person" rather than "form". Each is authored in
  //  the part's own (station, beta) space so it rides the surface, and each
  //  station is a MEASURED height wherever ANSUR reaches it, a bone wherever
  //  one is there to derive it from, and marked EST where neither reaches
  //  and a proportion had to stand in.
  // =========================================================================
  const LANDMARKS = {
    trunk: [
      // ---- the midline and groin: pre-existing, and left in the domain
      // they were tuned in -------------------------------------------------
      // These three predate resolveStation() and were tuned by eye directly
      // in the rows-fraction domain, against renders, with no ANSUR height
      // behind them to make reinterpreting them as native stations any more
      // correct — only different. So `row()` is used, which is the literal
      // escape hatch back to the old, unrescaled behaviour, and they render
      // exactly as they did before this file grew a head, a neck and a
      // second station domain to be careful about.
      { id: 'midline', tone: 0.34, minPx: 0, ctrl: [[rowS(0.34), FRONT], [rowS(0.62), FRONT]] },
      { id: 'inguinal.L', tone: 0.62, minPx: 0, ctrl: [[rowS(0.10), FRONT + 0.85], [rowS(-0.02), FRONT + 0.12]] },
      { id: 'inguinal.R', tone: 0.62, minPx: 0, ctrl: [[rowS(0.10), FRONT - 0.85], [rowS(-0.02), FRONT - 0.12]] },
      // the gluteal fold, at the height ANSUR measures the buttock. This one
      // IS native (buttockheight, via `at`), and fixing the native/row-
      // fraction conflation moved it: the old code fed stationAtHeight's
      // result into onSurface unrescaled, and on this file's own test
      // figure (seed 12345) that is a NEGATIVE native station — buttockheight
      // sits below the trunk chain's own zero at L5 — which clamp01 then
      // flattened to row 0, the trunk's bottom edge, not the buttock.
      // Measured: native station -0.166 on a trunk whose range is
      // [-0.215, 1.10]; old code's row 0 of 52; this file's row 1.9 of 52.
      {
        id: 'gluteal.L', tone: 0.5, minPx: 0,
        ctrl: [
          [atH('buttockheight'), BACK - 0.10],
          [atH('buttockheight', -8), BACK - 0.45],   // EST: the fold bows up a little at its centre
          [atH('buttockheight'), BACK - 0.80],
        ],
      },
      {
        id: 'gluteal.R', tone: 0.5, minPx: 0,
        ctrl: [
          [atH('buttockheight'), BACK + 0.10],
          [atH('buttockheight', -8), BACK + 0.45],
          [atH('buttockheight'), BACK + 0.80],
        ],
      },

      // ---- the clavicle, and the acromion at its end ---------------------
      // A landmark lying over a bone is DERIVED from that bone rather than
      // guessed at: rig.bones['clavicle.L'/'.R'] runs sternoclavicular joint
      // to acromion (10-skeleton.js: aimTo:'acromion' — its direction and
      // length both fall out of acromialheight and biacromialbreadth, not
      // authored), and projectBone() walks it and asks the trunk's own
      // sampled skin which of its own samples is nearest, station by
      // station. The trunk's field already keeps the clavicle bones in its
      // KEEP set (52-torso.js/50-field.js), so the surface is already
      // informed by them; this traces what is already there.
      { id: 'clavicle.L', tone: 0.60, minPx: 60, n: 16, bone: 'clavicle.L' },
      { id: 'clavicle.R', tone: 0.60, minPx: 60, n: 16, bone: 'clavicle.R' },
      // the acromion itself: a bony point, so a short firm stub right at the
      // bone's own distal end rather than a line along it — it shows as a
      // small shadow where the skin has almost nothing over it, not a length.
      { id: 'acromion.L', tone: 0.70, minPx: 110, n: 6, noFade: true, bone: 'clavicle.L', boneFrac: [0.90, 1.0] },
      { id: 'acromion.R', tone: 0.70, minPx: 110, n: 6, noFade: true, bone: 'clavicle.R', boneFrac: [0.90, 1.0] },

      // ---- the neck -------------------------------------------------------
      // The sternocleidomastoid: the single most identifying line on a neck,
      // running from behind the ear forward and down to the suprasternal
      // notch — it is what makes a neck read as a neck and not a tube. The
      // lower end is measured (suprasternaleheight); the upper is anchored
      // near the trunk chain's own top (row-fraction close to 1: the top of
      // C1, where the skull sits) rather than reaching across into the
      // head part's own surface, which is a different part with a different
      // sampling and does not need a seam-crossing trick — the two already
      // overlap there and each reads correctly drawn on its own.
      {
        id: 'scm.L', tone: 0.60, minPx: 90, n: 22,
        ctrl: [
          [rowS(0.955), LEFT - 0.32],
          [rowS(0.78), FRONT - 0.62],
          [atH('suprasternaleheight'), FRONT - 0.07],
        ],
      },
      // the suprasternal notch itself: a short, firm double stroke rather
      // than a long one, because the notch is a small hollow, not a seam
      {
        id: 'notch', tone: 0.55, minPx: 70, n: 8, noFade: true,
        ctrl: [[atH('suprasternaleheight', 5), FRONT - 0.11], [atH('suprasternaleheight', -6), FRONT + 0.11]],
      },
      // the laryngeal prominence. EST: no ANSUR measure reaches the thyroid
      // cartilage, so it is anchored above the notch by a typical adult
      // offset (~30-40mm) rather than by a bare guess at a station.
      {
        id: 'larynx', tone: 0.38, minPx: 140, n: 12,
        ctrl: [[atH('suprasternaleheight', 28), FRONT - 0.10], [atH('suprasternaleheight', 42), FRONT], [atH('suprasternaleheight', 28), FRONT + 0.10]],
      },
      // the anterior border of the trapezius: the line the shoulder hangs
      // from. Runs from near the base of the neck out to the shoulder point.
      {
        id: 'trapezius.L', tone: 0.42, minPx: 90, n: 18,
        ctrl: [[rowS(0.90), LEFT - 0.10], [rowS(0.80), LEFT + 0.32], [atH('suprasternaleheight', 8), FRONT - 0.85]],
      },

      // ---- the chest --------------------------------------------------
      // The sternum: no ANSUR sternal-length measure, so its lower end is
      // EST (~175mm below the notch, a typical adult sternum).
      { id: 'sternum', tone: 0.30, minPx: 70, n: 16, ctrl: [[atH('suprasternaleheight'), FRONT], [atH('suprasternaleheight', -175), FRONT]] },
      // the costal margin, diverging from the sternum's foot
      {
        id: 'costal.L', tone: 0.34, minPx: 110, n: 16,
        ctrl: [[atH('suprasternaleheight', -172), FRONT - 0.04], [atH('suprasternaleheight', -230), FRONT - 0.58]],
      },
      // the nipples: at chest height (ANSUR reaches the height, not the
      // spacing — the lateral offset below is EST)
      {
        id: 'nipple.L', tone: 0.26, minPx: 170, n: 8,
        ctrl: [[atH('chestheight', 7), FRONT - 0.35], [atH('chestheight', -7), FRONT - 0.41]],
      },
      // the pectoral's lower border, sweeping from the sternum up to the
      // armpit, and its lateral border forming the armpit's front wall
      {
        id: 'pecLower.L', tone: 0.40, minPx: 100, n: 18,
        ctrl: [[atH('suprasternaleheight', -158), FRONT - 0.06], [atH('chestheight', 12), FRONT - 0.44], [atH('suprasternaleheight', -18), FRONT - 0.64]],
      },
      {
        id: 'pecArmpit.L', tone: 0.36, minPx: 120, n: 12,
        ctrl: [[atH('suprasternaleheight', -18), FRONT - 0.64], [atH('suprasternaleheight', 32), FRONT - 0.74]],
      },
    ],
  };
  // mirror every .L trunk entry that has one, onto .R
  for (const id of ['scm.L', 'trapezius.L', 'costal.L', 'nipple.L', 'pecLower.L', 'pecArmpit.L']) {
    const e = LANDMARKS.trunk.find((L) => L.id === id);
    if (e) LANDMARKS.trunk.push(mirror(e));
  }

  // ---------------------------------------------------------------------
  //  THE HEAD
  //  Every station below is ofUp()/ofDn() — a fraction of tragiontopofhead
  //  or mentonsellionlength, taken off the skull bone (see resolveStation).
  //  Several reuse the exact fractions the head's own volumes are built
  //  from (51-head.js's ST table): brow 0.12·up, cheekbone -0.16·dn, jaw
  //  angle -0.55·dn, chin -0.90·dn, vertex 0.93·up. The rest are EST,
  //  proportions of a face rather than measurements ANSUR took, and are
  //  marked as such.
  //
  //  Lateral (beta) placement has no ANSUR measure to anchor to directly —
  //  nothing in the survey is an interocular distance or a nostril width —
  //  so where a face measurement bears on it at all it is used as a SCALE
  //  on a hand-tuned offset rather than left a bare constant: faceW below
  //  is how much narrower the face is at the cheekbones than the skull is
  //  at its widest, and it scales the eyes', the mouth's and the nostrils'
  //  distance from the midline together, so a narrow-faced figure gets all
  //  three closer to the centre line and a wide-faced one gets all three
  //  further out, consistently, rather than three independent guesses that
  //  could drift apart on an unusual head.
  // ---------------------------------------------------------------------
  const faceW = (ctx) => ctx.rig.figure.m.bizygomaticbreadth / ctx.rig.figure.m.headbreadth;
  const eyeDelta = (ctx) => 0.50 * faceW(ctx);
  const mouthDelta = (ctx) => 0.32 * faceW(ctx);
  const noseDelta = (ctx) => 0.20 * faceW(ctx);

  LANDMARKS.head = [
    // ---- the brow ridge and the supraorbital line ----------------------
    // One continuous arc: a real brow ridge runs across the glabella, and
    // cut in two at the midline it reads as permanently surprised rather
    // than as bone.
    {
      id: 'brow', tone: 0.52, minPx: 130, n: 24,
      // A near-constant station swept across a wide beta range is a line of
      // LATITUDE around the head, not a frontal feature — the first pass
      // reached all the way to LEFT/RIGHT+0.34 (~70 degrees off centre,
      // basically the ear line) and read as a headband circling the skull
      // rather than a brow. Pulled in to within a radian of FRONT either way.
      ctrl: [
        [ofUp(0.10), (ctx) => FRONT - 0.92 * faceW(ctx)],
        [ofUp(0.135), (ctx) => FRONT - 0.55 * faceW(ctx)],
        [ofUp(0.145), FRONT],
        [ofUp(0.135), (ctx) => FRONT + 0.55 * faceW(ctx)],
        [ofUp(0.10), (ctx) => FRONT + 0.92 * faceW(ctx)],
      ],
    },

    // ---- the eyes: three marks each, not an illustration ----------------
    // The socket's shadow (the hollow the brow casts and the socket cuts),
    // the lid crease above it, and the line of the lashes at the margin —
    // in that order, from faintest/broadest to firmest/tightest.
    {
      id: 'eyeSocket.L', tone: 0.30, minPx: 240, n: 14,
      ctrl: [
        [ofDn(0.02), (ctx) => FRONT - eyeDelta(ctx) - 0.24],
        [ofDn(-0.07), (ctx) => FRONT - eyeDelta(ctx)],
        [ofDn(0.02), (ctx) => FRONT - eyeDelta(ctx) + 0.20],
      ],
    },
    {
      id: 'eyeLid.L', tone: 0.42, minPx: 260, n: 12,
      ctrl: [
        [ofDn(0.005), (ctx) => FRONT - eyeDelta(ctx) - 0.20],
        [ofDn(0.035), (ctx) => FRONT - eyeDelta(ctx)],
        [ofDn(0.005), (ctx) => FRONT - eyeDelta(ctx) + 0.17],
      ],
    },
    {
      id: 'eyeLash.L', tone: 0.62, minPx: 240, n: 12,
      ctrl: [
        [ofDn(-0.055), (ctx) => FRONT - eyeDelta(ctx) - 0.19],
        [ofDn(-0.042), (ctx) => FRONT - eyeDelta(ctx)],
        [ofDn(-0.055), (ctx) => FRONT - eyeDelta(ctx) + 0.16],
      ],
    },

    // ---- the nose ---------------------------------------------------
    // The bridge's side planes (root to tip, one each side), the wing of
    // the nostril, and the shadow under the tip. The nose is a real form
    // now (51-head.js) — these lines describe it, they do not draw it.
    // Stations re-derived against the fixed anchors below (not just off
    // brow/chin fractions picked independently): subnasale sits roughly at
    // the midpoint of brow-to-chin (the classic facial-thirds proportion,
    // used here as the EST it is), which put the first pass of this nose
    // and mouth noticeably too low — every station in this group and the
    // mouth group below was raised to match.
    {
      id: 'noseBridge.L', tone: 0.30, minPx: 200, n: 14,
      ctrl: [[ofDn(0.05), (ctx) => FRONT - 0.07 * faceW(ctx)], [ofDn(-0.27), (ctx) => FRONT - 0.11 * faceW(ctx)]],
    },
    {
      id: 'noseWing.L', tone: 0.44, minPx: 260, n: 10,
      ctrl: [
        [ofDn(-0.27), (ctx) => FRONT - noseDelta(ctx) * 0.3],
        [ofDn(-0.38), (ctx) => FRONT - noseDelta(ctx)],
        [ofDn(-0.31), (ctx) => FRONT - noseDelta(ctx) * 1.25],
      ],
    },
    {
      id: 'noseUnder', tone: 0.36, minPx: 250, n: 10,
      ctrl: [
        [ofDn(-0.35), (ctx) => FRONT - noseDelta(ctx) * 0.9],
        [ofDn(-0.41), FRONT],
        [ofDn(-0.35), (ctx) => FRONT + noseDelta(ctx) * 0.9],
      ],
    },

    // ---- the mouth ----------------------------------------------------
    // The line between the lips is the only one always there; the upper
    // lip's own edge and the shadow under the lower lip come and go with
    // the light, so both are carried at a lower tone than the line itself.
    {
      id: 'lipLine', tone: 0.58, minPx: 190, n: 14,
      ctrl: [
        [ofDn(-0.51), (ctx) => FRONT - mouthDelta(ctx)],
        [ofDn(-0.525), FRONT],
        [ofDn(-0.51), (ctx) => FRONT + mouthDelta(ctx)],
      ],
    },
    {
      id: 'lipUpper', tone: 0.26, minPx: 270, n: 12,
      ctrl: [
        [ofDn(-0.475), (ctx) => FRONT - mouthDelta(ctx) * 0.85],
        [ofDn(-0.495), FRONT],
        [ofDn(-0.475), (ctx) => FRONT + mouthDelta(ctx) * 0.85],
      ],
    },
    {
      id: 'lipLowerShadow', tone: 0.22, minPx: 280, n: 12,
      ctrl: [
        [ofDn(-0.56), (ctx) => FRONT - mouthDelta(ctx) * 0.75],
        [ofDn(-0.575), FRONT],
        [ofDn(-0.56), (ctx) => FRONT + mouthDelta(ctx) * 0.75],
      ],
    },

    // ---- nasolabial fold and the crease under the cheekbone -------------
    {
      id: 'nasolabial.L', tone: 0.34, minPx: 200, n: 14,
      ctrl: [
        [ofDn(-0.29), (ctx) => FRONT - noseDelta(ctx) * 1.1],
        [ofDn(-0.43), (ctx) => FRONT - mouthDelta(ctx) * 1.35],
      ],
    },
    // the cheekbone's own crease, from near the ear down under the eye —
    // following 51-head.js's own cheekbone ridge (A near the ear, B forward
    // and down under the eye), one station lower and fainter: the ridge is
    // the bone's own light/shadow step, this is the soft crease under it.
    {
      id: 'cheekbone.L', tone: 0.26, minPx: 175, n: 14,
      ctrl: [
        [ofDn(-0.12), LEFT + 0.22],
        [ofDn(-0.30), (ctx) => FRONT - eyeDelta(ctx) * 1.05],
      ],
    },

    // ---- the jaw line, angle of the mandible to the chin -----------------
    {
      id: 'jaw.L', tone: 0.50, minPx: 75, n: 20,
      ctrl: [
        [ofDn(-0.55), LEFT + 0.34],
        [ofDn(-0.78), (ctx) => FRONT - 0.95 * faceW(ctx)],
        [ofDn(-0.90), (ctx) => FRONT - 0.30 * faceW(ctx)],
      ],
    },

    // ---- the ear: the helix and the tragus, two or three marks ----------
    // 51-head.js's own ear is a small capsule projecting laterally, near
    // native offset dn*0.06 vertically and cz*0.06 back from sk.A, so
    // that is where the helix is centred; the tragus sits in front of it.
    {
      id: 'earHelix.L', tone: 0.40, minPx: 165, n: 14,
      ctrl: [
        [ofDn(0.32), LEFT - 0.02],
        [ofDn(0.08), LEFT - 0.16],
        [ofDn(-0.18), LEFT - 0.05],
      ],
    },
    {
      id: 'earTragus.L', tone: 0.34, minPx: 220, n: 6, noFade: true,
      ctrl: [[ofDn(0.02), LEFT + 0.14], [ofDn(-0.08), LEFT + 0.10]],
    },

    // ---- the hairline and the occipital curve ---------------------------
    // EST: no ANSUR measure fixes a hairline. Placed a little over halfway
    // from the brow to the vertex (0.12·up to 0.93·up — most of that span
    // is crown, not forehead, so "halfway" is a full, ordinary forehead
    // rather than a low one), and swept the width of the front. The first
    // pass used 0.16/0.34/0.40 of `up`, which put it only ~27mm above the
    // brow — a headband, not a hairline — because the gap from brow to
    // vertex (94.7mm on the test figure) is mostly crown and a fraction
    // read as "most of the way up" in that space is still a long way short
    // of where hair actually starts.
    {
      id: 'hairline', tone: 0.36, minPx: 115, n: 22,
      // Same latitude-ring failure as the brow, worse here because the span
      // reached to within 0.20 rad of the pure flank — nearly the ear line.
      // A temple recedes, it does not reach the side of the head; pulled in
      // to a bit over a radian off FRONT at its widest.
      ctrl: [
        [ofUp(0.46), (ctx) => FRONT - 1.10 * faceW(ctx)],
        [ofUp(0.56), (ctx) => FRONT - 0.70 * faceW(ctx)],
        [ofUp(0.60), FRONT],
        [ofUp(0.56), (ctx) => FRONT + 0.70 * faceW(ctx)],
        [ofUp(0.46), (ctx) => FRONT + 1.10 * faceW(ctx)],
      ],
    },
    // the occiput: the back of the vault's own curve, low enough to read
    // as where the skull rounds into the neck rather than as a second
    // hairline
    {
      id: 'occipital', tone: 0.24, minPx: 135, n: 16,
      ctrl: [[ofUp(0.30), BACK - 0.30], [ofUp(0.20), BACK], [ofUp(0.30), BACK + 0.30]],
    },
  ];
  // mirror every .L head entry that has an .R counterpart onto it
  for (const id of ['eyeSocket.L', 'eyeLid.L', 'eyeLash.L', 'noseBridge.L', 'noseWing.L',
    'nasolabial.L', 'cheekbone.L', 'jaw.L', 'earHelix.L', 'earTragus.L']) {
    const e = LANDMARKS.head.find((L) => L.id === id);
    if (e) LANDMARKS.head.push(mirror(e));
  }

  // ---------------------------------------------------------------------
  //  THE DELTOID
  //  arm.L / arm.R are chain parts over ['humerus.S','forearm.S'] with
  //  s0=0, s1=1 EXACTLY (trimRange finds both the shoulder and the wrist
  //  already inside the solid on every seed tried, never at its edge, so
  //  there is nothing to trim) — so a native chain-station and onSurface's
  //  own row-fraction are the same number here, and rowS() is exact rather
  //  than a shortcut. The humerus occupies the first half of the two-bone
  //  chain (station 0 to 0.5); deltoid insertion is classically a little
  //  short of halfway down the humeral shaft, so station ~0.19.
  //
  //  Beta: in the rest pose this renders, humerus.frame[2] comes out
  //  [0,0,1] exactly — pure global anterior — so FRONT/BACK below are
  //  genuinely anatomical front/back on the arm, the same as on the trunk
  //  and head. The medial/lateral axis (beta 0 / beta PI) is local to the
  //  limb and is NOT the figure's own left/right; LEFT/RIGHT are reused
  //  below only as the numeric constants 0 and PI, for "toward the body"
  //  and "away from it", verified against a render rather than derived.
  // ---------------------------------------------------------------------
  const deltoidL = [
    {
      id: 'deltoid.anterior', tone: 0.40, minPx: 90, n: 16,
      ctrl: [[rowS(0.015), FRONT - 0.30], [rowS(0.10), FRONT - 0.08], [rowS(0.19), FRONT + 0.15]],
    },
    {
      id: 'deltoid.posterior', tone: 0.38, minPx: 100, n: 16,
      ctrl: [[rowS(0.015), BACK + 0.30], [rowS(0.10), BACK + 0.08], [rowS(0.19), BACK - 0.15]],
    },
    {
      id: 'deltoid.insertion', tone: 0.46, minPx: 130, n: 10,
      ctrl: [[rowS(0.165), RIGHT - 0.24], [rowS(0.195), RIGHT], [rowS(0.165), RIGHT + 0.24]],
    },
  ];
  LANDMARKS['arm.L'] = deltoidL;
  LANDMARKS['arm.R'] = deltoidL;   // same numbers: beta 0/PI is medial/lateral either side, not left/right

  /**
   * The landmarks for one part, filtered to the scale they are actually
   * being drawn at.
   *
   * @param part  the field's own part object (from G.field.parts(rig)) —
   *              carries .name (which LANDMARKS set), .s0/.s1 (how a
   *              native station rescales into onSurface's domain) and,
   *              for a chain part, .chain (which resolveStation checks
   *              before calling stationAtHeight).
   * @param rows  that part's sampled rings, as before.
   * @param ctx   { rig, mmPerPx }
   *                rig      the solved rig: bones for a mark DERIVED from
   *                         one (the clavicle, the acromion) rather than
   *                         guessed, rig.figure.m for the ANSUR measures,
   *                         rig.bones.skull for the head's own axis scale.
   *                         Required for every part with any landmarks —
   *                         a call without it returns [] rather than
   *                         guessing.
   *                mmPerPx  millimetres per pixel of the plate. Every
   *                         landmark declares the part's own screen-span
   *                         floor (minPx) below which it is dropped; this
   *                         is what that is measured against, via
   *                         partPxOf(). Omit it (or pass 0) to disable the
   *                         filter and draw every landmark regardless of
   *                         scale — the pre-filtering behaviour, kept
   *                         available for a caller that has not measured
   *                         a plate scale yet.
   *
   * SIGNATURE CHANGE from `landmarks(name, rows, stationOf)`: `name` (a
   * string) became `part` (the object skin.js already builds it from —
   * `P.name` still gets you the string, but the object is what a bone-
   * or ANSUR-anchored station needs), the `stationOf` closure is gone
   * (this now calls G.field.stationAtHeight itself, so it can reach any
   * ANSUR height rather than only the ones a caller's closure knew about),
   * and a fourth argument carries the rig and the plate's mmPerPx.
   */
  function landmarks(part, rows, ctx) {
    ctx = ctx || {};
    if (!ctx.rig) return [];
    const spec = LANDMARKS[part.name];
    if (!spec) return [];
    const partPx = partPxOf(rows, ctx.mmPerPx);
    const out = [];
    for (const L of visibleAt(spec, partPx)) {
      const N = L.n || 26;
      const pts = [];
      if (L.bone) {
        const b = ctx.rig.bones[L.bone];
        if (!b) continue;
        const fr = L.boneFrac || [0, 1];
        const hits = projectBone(rows, b.A, b.B, N, fr[0], fr[1]);
        for (let i = 0; i < hits.length; i++) {
          const P = onSurface(rows, hits[i].s, hits[i].beta);
          if (!P) continue;
          const u = hits.length > 1 ? i / (hits.length - 1) : 0;
          const fade = L.noFade ? 1 : Math.sin(clamp01(u) * Math.PI);
          pts.push([P[0], P[1], P[2], L.tone * (0.25 + 0.75 * fade)]);
        }
      } else if (L.ctrl) {
        const cpts = L.ctrl.map((c) => [resolveStation(part, c[0], ctx), resolveBeta(c[1], ctx), 0]);
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          const fi = u * (cpts.length - 1);
          const q = M.splineAt(cpts, fi);
          const P = onSurface(rows, q[0], q[1]);
          if (!P) continue;
          const fade = L.noFade ? 1 : Math.sin(clamp01(u) * Math.PI);
          pts.push([P[0], P[1], P[2], L.tone * (0.25 + 0.75 * fade)]);
        }
      }
      if (pts.length > 3) out.push({ pts, id: L.id });
    }
    return out;
  }

  GK.draw = {
    lamp, normals, bandAt, modelling, landmarks, onSurface, LANDMARKS, HZ,
    resolveStation, nativeFrac, nearestOnRows, projectBone,
    partExtentMm, partPxOf, visibleAt,
  };
})(window.GK = window.GK || {});
