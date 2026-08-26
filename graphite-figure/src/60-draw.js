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
     modelling()   the shadow band, terminator to silhouette
     landmarks()   the creases and folds, anchored to measured heights
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
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
    // Toward the silhouette, whichever end that is: the terminator is the end
    // where the surface is closest to facing the lamp.
    const flip = Math.abs(lam[wrap(k0)]) >= Math.abs(lam[wrap(k1)]);
    const ks = [];
    for (let k = k0; k <= k1; k++) ks.push(flip ? k1 - (k - k0) : k);
    // Spaced by how much of the PAGE each step covers, not by angle. The far
    // end of a band is turning away and projects to a sliver; spaced by angle,
    // every mark there lands on the same few pixels and the edge goes black.
    const cum = [0];
    for (let i = 1; i < ks.length; i++) {
      cum.push(cum[i - 1] + Math.max(0.05, fac[wrap(ks[i])]));
    }
    const total = cum[cum.length - 1] || 1;
    const at = (t) => {
      const want = clamp01(t) * total;
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < want) i++;
      const f = (want - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
      const kf = ks[i] + (ks[i + 1] - ks[i]) * f;
      const k = wrap(Math.floor(kf)), k2 = wrap(k + 1), fr = kf - Math.floor(kf);
      return {
        P: M.vlerp(row[k], row[k2], fr),
        lam: lerp(lam[k], lam[k2], fr),
        fac: lerp(fac[k], fac[k2], fr),
      };
    };
    let lo = 9;
    for (const k of ks) lo = Math.min(lo, lam[wrap(k)]);
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
  //  LANDMARKS
  //  The few lines that say "person" rather than "form". Each is authored in
  //  the part's own (station, beta) space so it rides the surface, and each
  //  station is a MEASURED height wherever ANSUR reaches it.
  // =========================================================================

  // beta runs from +Y (the figure's left) toward +Z (anterior), so 0 is the
  // left flank, a quarter turn is dead front, a half is the right flank and
  // three quarters is the back.
  const FRONT = Math.PI * 0.5, BACK = Math.PI * 1.5;

  /**
   * `at` is a measured ANSUR height where one exists and a station otherwise;
   * `arc` is [from, to] in beta; `tone` is how firmly it is stated. A crease
   * is not a contour — it is a fold in skin over a structure — so these are
   * short, and the ones that are longest are the ones lying over bone.
   */
  const LANDMARKS = {
    trunk: [
      // the collar bones, which are the most visible bone on a dressed body
      { id: 'clavicle.L', at: 'suprasternaleheight', arc: [FRONT + 0.12, FRONT + 0.95], tone: 0.55, bow: 0.16 },
      { id: 'clavicle.R', at: 'suprasternaleheight', arc: [FRONT - 0.12, FRONT - 0.95], tone: 0.55, bow: -0.16 },
      // the midline: sternum above the navel, linea alba below
      { id: 'midline', at: null, s0: 0.34, s1: 0.62, beta: FRONT, tone: 0.34 },
      // the inguinal creases, from the iliac crest down to the pubis
      { id: 'inguinal.L', at: null, s0: 0.10, s1: -0.02, b0: FRONT + 0.85, b1: FRONT + 0.12, tone: 0.62 },
      { id: 'inguinal.R', at: null, s0: 0.10, s1: -0.02, b0: FRONT - 0.85, b1: FRONT - 0.12, tone: 0.62 },
      // and the gluteal fold behind, at the height ANSUR measures the buttock
      { id: 'gluteal.L', at: 'buttockheight', arc: [BACK - 0.10, BACK - 0.80], tone: 0.5, bow: -0.1 },
      { id: 'gluteal.R', at: 'buttockheight', arc: [BACK + 0.10, BACK + 0.80], tone: 0.5, bow: 0.1 },
    ],
  };

  /** a curve on a part's surface, from its sampled rings, in (station, beta) */
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

  function landmarks(name, rows, stationOf, opts) {
    const spec = LANDMARKS[name];
    if (!spec) return [];
    const out = [];
    for (const L of spec) {
      const N = 26;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        let s, beta;
        if (L.arc) {
          s = stationOf(L.at);
          beta = lerp(L.arc[0], L.arc[1], u);
          // a collar bone is not a circle of latitude: it rises laterally
          if (L.bow) s += L.bow * Math.sin(u * Math.PI) * 0.06;
        } else if (L.beta !== undefined) {
          s = lerp(L.s0, L.s1, u); beta = L.beta;
        } else {
          s = lerp(L.s0, L.s1, u); beta = lerp(L.b0, L.b1, u);
        }
        const P = onSurface(rows, s, beta);
        if (!P) continue;
        // ends fade: a crease is deepest in its middle and runs out at both
        const fade = Math.sin(clamp01(u) * Math.PI);
        pts.push([P[0], P[1], P[2], L.tone * (0.25 + 0.75 * fade)]);
      }
      if (pts.length > 3) out.push({ pts, id: L.id });
    }
    return out;
  }

  GK.draw = { lamp, normals, bandAt, modelling, landmarks, onSurface, LANDMARKS, HZ };
})(window.GK = window.GK || {});
