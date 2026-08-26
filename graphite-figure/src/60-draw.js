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
     planeBreaks() ridge/valley lines where a surface changes direction
                   sharply enough to be a facet edge, not a curve — pure
                   geometry over normals(), no per-part table
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
  const { clamp01, clamp, lerp, vadd, vsub, vmul, vdot, vnorm, vcross, vlen, DEG } = M;

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
   * How "close up" a part is being drawn, 0..1, from its own screen span —
   * the same partPx every LOD gate in this file already reads (see
   * partPxOf below; hoisted, so calling it here before its own declaration
   * is fine). 0 below LOD_CLOSE_LO, 1 at or above LOD_CLOSE_HI, a plain
   * ramp between.
   *
   * Shared by modelling() and planeBreaks() so both close-up refinements
   * below — fewer, better-placed modelling marks and a wider plane-break
   * gate — engage at the same scale. LOD_CLOSE_LO (200px) sits above every
   * whole-figure HEAD partPx measured against this file's own repro set
   * (head partPx ~159-160 at 850px, no FRAME — see this feature's report),
   * so closeUpFactor is exactly 0 there; LOD_CLOSE_HI (400px) sits below
   * every bust head partPx measured off the FRAME=1284,1668 repros
   * (415-556px across front/three-quarter/side/back at seed 12345 and 3),
   * so it is fully engaged for all of them, not fading in mid-way through
   * the very cases it exists for.
   *
   * partPx ALONE is not what keeps the whole-figure plate unchanged,
   * though — it is part-relative, not camera-relative, and a physically
   * large part (the trunk; a limb at full stretch) clears LOD_CLOSE_LO at
   * ordinary whole-figure scale simply by being big, not by being viewed
   * close up. Measured directly: leaving both call sites below open to
   * every part changed 7981 pixels of the whole-figure plate, spanning
   * head to legs, until each was additionally gated to `part.name ===
   * 'head'` — the part this was actually diagnosed on (51-head.js's own
   * planar construction, not a property either caller's geometry shares).
   * That per-call `part.name` gate, not this function, is the thing
   * actually holding the whole-figure gate; read it alongside this one.
   */
  const LOD_CLOSE_LO = 200, LOD_CLOSE_HI = 400;
  function closeUpFactor(partPx) {
    return clamp01((partPx - LOD_CLOSE_LO) / (LOD_CLOSE_HI - LOD_CLOSE_LO));
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
    const NMraw = opts.marks === undefined ? 7 : opts.marks;
    /* FEWER MARKS AT CLOSE RANGE, NOT MORE — the opposite of the usual LOD
       instinct, and the reason is this function's own scale-blindness: it
       reads no scale at all today, so the SAME sixteen strokes a whole-
       figure head needs to read as tone (this file's header: "a head is a
       hundred pixels of page") are still exactly sixteen once the same
       head fills a bust plate at 400+ partPx, where each one is big enough
       to resolve as its own discrete line rather than blend into a
       shading average. Sixteen discrete lines is corduroy. Cut by up to
       half at close range, closeUpFactor-gated so a whole-figure plate
       (partPx ~159 here, comfortably under LOD_CLOSE_LO) draws exactly the
       marks it always has — see closeUpFactor's own comment for why that
       floor is load-bearing, not incidental. Never below 3: fewer than
       that stops being hatching and starts being a couple of stray lines.
       EST, tuned against the bust repro renders (see this feature's
       report).
       HEAD ONLY. partPx is a PART-relative screen span, not a camera zoom
       level — a trunk or a stretched limb legitimately reaches 200-400+
       partPx at ORDINARY whole-figure scale simply by being physically
       bigger than a head, not by being viewed close up (measured: this
       gate, left part-agnostic, changed 7981 whole-figure pixels spanning
       head to legs — the trunk and limbs ramping on their own, unasked —
       until it was scoped down to this one part; see this feature's
       report). The problem diagnosed is specific to the head's own planar
       construction besides (51-head.js), so scoping the fix to match is
       not a compromise, it is where the numbers actually point. */
    const partPx = partPxOf(rows, view.mmPerPx);
    const closeUp = part.name === 'head' ? closeUpFactor(partPx) : 0;
    const NM = Math.max(3, Math.round(NMraw * (1 - closeUp * 0.5)));
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
        /* NOT THE GOOD PART OF THE SHADOW — A DIFFERENT, FLATLY-PRESENTED
           FACET. `edge` alone treats every fac past its own 0.40 ceiling
           as equally worth full tone, which is fine on a smoothly-turning
           limb (bandAt's qualifying arc there is narrow, so a high-fac
           point inside it is still close to the terminator) but breaks on
           the head's planar construction: several differently-tilted
           planes can each independently pass bandAt's own lamp test (see
           this feature's report), which widens the qualifying arc far
           past one coherent turn — and the wide part of it can be a
           second facet's flat, near-dead-on-to-camera face, not a
           deepening shadow. Rolled off past fac 0.55 (comfortably beyond
           edge's own saturation point, so the ordinary "off again at the
           rim" softening this file already does at the LOW end of fac is
           untouched) and only at close range: closeUp 0 leaves this
           multiplier at exactly 1, so nothing here changes the whole-
           figure plate. EST, tuned against the three-quarter bust repro
           (see this feature's report). */
        const frontRolloff = 1 - closeUp * clamp01((q.fac - 0.55) / (0.88 - 0.55));
        const tone = depth * core * (0.10 + 0.90 * edge * edge) * (0.35 + 0.65 * ends) * frontRolloff;
        if (tone < 0.05) { flush(); continue; }
        run.push([q.P[0], q.P[1], q.P[2], tone]);
      }
      flush();
    }
    return out;
  }

  // =========================================================================
  //  PLANE BREAKS
  //  A ridge/valley detector over a part's own sampled rings — the places a
  //  surface changes direction sharply enough to be a facet edge rather than
  //  a curve still turning. Built for the head's planar (Asaro-style)
  //  reconstruction, where a brow ridge, a cheekbone step and a jaw plane
  //  are real dihedral angles rather than shading cues — but there is
  //  nothing head-specific in the code below: it is pure geometry over
  //  normals(), no per-part table, so it finds whatever is actually sharp
  //  on whatever part it is handed. Which is also why it finds the heel and
  //  instep edges on a foot (53-limbs.js's ST-table segments, unioned by a
  //  hard min with no smoothing between them) and the iliac crest on the
  //  trunk (50-field.js's pelvis block, two tapers meeting at the
  //  trochanter with different slopes) even before the head goes planar —
  //  both were how this was tested and tuned; see this feature's report.
  //
  //  THE TEST IS ON THE NORMAL, NOT ON THE SURFACE ITSELF. Two neighbouring
  //  samples can sit close together in space and still be two different
  //  planes; closeness in position says nothing about whether the light
  //  would turn a corner crossing between them. So this walks normals(),
  //  the same field bandAt() and modelling() already use, and asks a purely
  //  angular question: how much the facing direction changes from one
  //  angular sample to the next, around a ring.
  // =========================================================================

  // How sharp a ring has to bend, sample to sample, to count as a break AT
  // ALL — necessary but, on its own, nowhere near sufficient; see
  // RING_REL_MULT just below for why, and read the two together.
  //
  // EST, from the task's own 18-25 degree working range. Tried alone, at
  // the low end of that range (20°), against the foot it looked right —
  // the heel/instep chained clean and continuous — but the SAME 20° on the
  // trunk drew a break down almost the entire silhouette, both flanks,
  // chest to hip. That is not sixteen anatomical corners; it is one
  // ordinary fact about an ellipse rendered at finite angular resolution.
  // The trunk's cross-section is wider than it is deep, so — exactly as an
  // ellipse's curvature is highest at the ends of its LONG axis, not its
  // short one — the flanks (beta near 0 and PI) genuinely bend faster,
  // sample to sample, than the front or back do, with nothing sharp
  // happening there at all. Measured directly (this feature's report):
  // trunk rings at na=30 carry a MEDIAN edge-to-edge bend of 9-20° almost
  // everywhere, so a single absolute threshold anywhere near that range
  // cannot separate a real facet edge from the ordinary tighter curvature
  // of a wide, shallow torso — one number cannot do the job of two. The
  // threshold stays at the low end of the task's range for the reason
  // above (nothing here should lose the faint end of a real chain before
  // downstream gates run) — RING_REL_MULT is what actually keeps this from
  // firing on every rounded flank in the body, and does the discriminating
  // this constant alone cannot.
  const BREAK_ANGLE = 20 * DEG;
  // A candidate edge also has to clear this multiple of its OWN ring's
  // median edge-bend — the local-contrast test BREAK_ANGLE alone cannot
  // run, because "sharp" only means something relative to how curved the
  // surrounding surface already is. A flank's ordinary bend is elevated
  // but roughly UNIFORM across a wide arc of the ring (an ellipse's
  // curvature changes smoothly with angle); a real facet edge is a spike
  // that stands out against its own ring's typical bend WHEREVER that
  // typical bend happens to sit, which the median captures without caring
  // whether the part is round, boxy, or already sharp on its own account.
  // Calibrated against the trunk's own numbers (see report): rings with
  // nothing but ordinary flank curvature measured 1.5-2.5x their own
  // median at the tightest point sampled; the trochanter/crotch region and
  // the sharpest thoracic-to-pelvic band both cleared 2.8x, several rows
  // running well past 4-6x. 2.6 sits in the gap — it cost the milder end of
  // the pelvis taper (a couple of rows right beside the crotch cut that
  // read closer to 2.0-2.4x) but held every clearly sharp region, and nothing
  // downstream can recover a candidate this gate never lets through, so the
  // margin is kept on the side that risks a slightly shorter chain over the
  // side that redraws a whole flank.
  const RING_REL_MULT = 2.6;
  // The dihedral a break needs before it earns the darkest tone this
  // detector will assign (buildRun's tone ceiling, 0.80). EST against the
  // sharpest thing verifiably on the page before any planar head existed —
  // the foot's sole meeting the floor clamp, a genuine Math.max() against a
  // half-space (53-limbs.js) rather than a union of two tapers — which
  // measured 55-65° at the stations it survives LOD on. Left a little above
  // that so the floor-clamp corner reads as firm rather than maximal, and
  // revisited once the planar head supplied something sharper to check it
  // against (see report).
  const BREAK_SHARP = 58 * DEG;
  // How far a break's angular position may drift from one station to the
  // next and still be counted as the SAME break. Set from the sampling
  // itself rather than guessed: a part's rings carry 20 to 52 angular
  // samples around a full turn (53-limbs.js's foot at the sparse end,
  // 51-head.js's head at the dense one — see field.parts()), which is
  // 18°-7° apart sample to sample. A real facet edge walks a few degrees a
  // station as the form turns under it, not a few tens, so several angular
  // samples of slack is enough to chain a genuine line through ordinary
  // sample-to-sample wobble while still refusing to leap onto an unrelated
  // crease a few rings later — checked by watching the chain COUNT on the
  // foot and trunk render tests: too tight (under 15°) and one continuous
  // edge fragmented into three or four short ones; at 26° it did not, and
  // widening further started merging the heel edge with the unrelated
  // ankle-waist seam a few stations above it.
  const BREAK_STEP = 26 * DEG;
  // Shortest run worth keeping, in stations. Two is one segment, which is a
  // single noisy ring wearing a chain of one link; three is the same floor
  // bandAt() uses for its own band width and landmarks() uses for a built
  // mark's point count (`pts.length > 3`).
  const BREAK_MIN_LEN = 3;
  // |dot(normal, eye)| below this and a break point is the silhouette's own
  // edge, which the outline already draws — compare bandAt's HZ (0.10,
  // "just past the horizon", the point a shaded band stops being drawable
  // at all). This is more than double HZ on purpose: a plane-break LINE
  // sitting even a little short of dead-on to the silhouette still reads as
  // a second, ghost outline a few pixels in from the real one, which is a
  // worse mark than the sawtooth this whole feature exists to avoid, so it
  // is given more margin than a shading band needs. ~75° off the view
  // direction; the task's own EST.
  const BREAK_SIL = 0.25;

  /** linear interpolation of one ring's own samples — a position or a unit
   *  normal alike — at a fractional angular position. Same kf convention
   *  onSurface() and nearestOnRows() use everywhere else in this file (beta
   *  0..2*PI maps to sample 0..NA), so a beta found here lands in exactly
   *  the space a landmark's own beta does, and the two can be compared or
   *  mixed without a further conversion. */
  function lerpRing(row, beta) {
    const NA = row.length;
    const kf = (((beta / (Math.PI * 2)) % 1) + 1) % 1 * NA;
    const k = Math.floor(kf) % NA, k2 = (k + 1) % NA, fr = kf - Math.floor(kf);
    return M.vlerp(row[k], row[k2], fr);
  }

  /** circular distance between two angles, in [0, PI] */
  function betaDist(a, b) {
    let d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  }

  /** signed shortest angular step from a to b, in (-PI, PI] — the direction
   *  and distance betaDist() only gives the distance for */
  function betaDelta(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * One ring's break candidates: fractional angular positions where the
   * normal bends more than BREAK_ANGLE crossing from one angular sample to
   * the next, refined the way bandAt() refines a band's own ends — linear
   * interpolation of the bending quantity between the last sample outside
   * threshold and the first inside it, not whichever integer sample the
   * test happened to flip on. THIS is the sawtooth fix the section header
   * promises: an early version of this function reported the break at
   * whichever raw sample first crossed the test, and chained down a form
   * that is indistinguishable from the integer-index bug bandAt's own
   * history describes — confirmed the same way, by rendering it: walked
   * down the foot's instep, it stair-stepped once a station, one sample
   * wide, exactly the old modelling() sawtooth.
   *
   * edge[k] describes the span FROM sample k TO sample k+1, so a value
   * belongs at k+0.5 in the sample grid ringAt() actually indexes — every
   * position below is built on that half-sample offset, not on k itself.
   *
   * A candidate ALSO has to clear RING_REL_MULT times this ring's own
   * median edge — see that constant's own comment for why an absolute
   * threshold alone draws a break down an ordinary rounded flank. The
   * median is of the whole ring's edge[] as computed, no candidate region
   * excluded first: with a real facet edge ever only a handful of samples
   * wide out of twenty-plus, it cannot move the MIDDLE-ranked value enough
   * to hide itself from a test built on that value.
   *
   * Returns [{beta, peak, sign}] — peak in radians, sign the run's own
   * POLARITY (see the comment on `sweep` below — this is what lets
   * chainBreaks() tell two DIFFERENT edges a few degrees apart from one
   * continuous one), one entry per separate over-threshold run found around
   * the ring (a jaw can show two corners on the one station), ordered by
   * angular position.
   */
  function ringBreaks(row, nrmRow) {
    if (!row || !nrmRow) return [];
    const NA = nrmRow.length;
    if (NA < 8) return [];
    const edge = new Float64Array(NA);
    // cx[k] is the same step from nrmRow[k] to nrmRow[k+1] edge[k] already
    // reduces to a magnitude (via acos) — kept here as the full rotation
    // vector too, and summed into `sweep`, because a MAGNITUDE is not
    // enough to tell two DIFFERENT edges apart when they sit within
    // BREAK_STEP of each other; see the POLARITY comment below for why that
    // turned out to matter and not just be a theoretical worry.
    const cx = new Array(NA);
    const sweep = [0, 0, 0];
    for (let k = 0; k < NA; k++) {
      const a = nrmRow[k], b = nrmRow[(k + 1) % NA];
      edge[k] = Math.acos(clamp(vdot(a, b), -1, 1));
      const c = vcross(a, b);
      cx[k] = c;
      sweep[0] += c[0]; sweep[1] += c[1]; sweep[2] += c[2];
    }
    const median = edge.slice().sort()[Math.floor(NA / 2)];
    const relFloor = RING_REL_MULT * median;
    const above = new Array(NA);
    let anyAbove = false, allAbove = true;
    for (let k = 0; k < NA; k++) {
      above[k] = edge[k] > BREAK_ANGLE && edge[k] > relFloor;
      if (above[k]) anyAbove = true; else allAbove = false;
    }
    // A ring with nothing over threshold has no break; one with EVERY edge
    // over it is not a break either, it is a degenerate ring — a cap
    // station, or one too close to a part's own pole for its angular
    // spacing to mean anything. A real facet edge is local to an arc of the
    // ring, never the whole circumference.
    if (!anyAbove || allAbove) return [];

    // A false->true boundary is guaranteed to exist (both anyAbove and
    // !allAbove hold), so a single linear scan from it visits every sample
    // exactly once with no run split across the k=NA-1/0 seam.
    let start = 0;
    for (let k = 0; k < NA; k++) {
      if (above[k] && !above[(k - 1 + NA) % NA]) { start = k; break; }
    }
    const val = (k) => edge[((k % NA) + NA) % NA];
    // fractional crossing of val() through BREAK_ANGLE between an `outside`
    // sample (below threshold) and an `inside` one (above), by linear
    // interpolation — the same discipline as bandAt's own crossing().
    const crossing = (outside, inside) => {
      const vo = val(outside) - BREAK_ANGLE, vi = val(inside) - BREAK_ANGLE;
      return outside + (vo / (vo - vi)) * (inside - outside);
    };
    const out = [];
    let k = 0;
    while (k < NA) {
      const idx = (start + k) % NA;
      if (!above[idx]) { k++; continue; }
      const k0 = start + k;
      while (k < NA && above[(start + k) % NA]) k++;
      const k1 = start + k - 1;
      // A run wider than a quarter ring is the same degenerate case as
      // "every edge over threshold", just local to one arc instead of the
      // whole ring — seen near a part's own capped end, never on an actual
      // facet edge, which is a handful of samples wide.
      if (k1 - k0 + 1 > NA / 4) continue;
      const k0f = crossing(k0 - 1, k0), k1f = crossing(k1 + 1, k1);
      let peak = 0;
      for (let j = k0; j <= k1; j++) peak = Math.max(peak, val(j));
      const kf = (k0f + k1f) * 0.5 + 0.5;   // edge-index run centre -> sample-grid position

      /* POLARITY — found by instrumenting exactly this function against the
         ear, where a hand-authored crease (earHelix) sits over a real
         geometric one: the ear is a capsule smoothed onto the skull, so a
         ring through it crosses the blend TWICE, once entering the ear's
         footprint and once leaving it, and on the render these two
         crossings came out as one continuous chain doing a dense zigzag
         instead of two clean lines either side of the ear. Printed
         side-by-side (this feature's probe script), the two crossings sat
         as little as ~15-20 degrees apart at some stations — inside
         BREAK_STEP — and at exactly the stations where one of them faded
         under threshold for a ring or two, chainBreaks' nearest-in-angle
         match had nothing else to prefer and jumped onto the other one,
         which is what a sawtooth IS: the same chain alternating between two
         different edges because distance-in-beta was the only thing being
         asked.

         A magnitude (edge[], peak) cannot tell these two crossings apart —
         both are real, both are sharp. What DOES separate them is which way
         the normal is turning: walking a ring, the normal sweeps through
         very close to a full turn (it has to, having started and ended
         facing the same way), and `sweep` above is that ring's own net
         rotation axis, summed from every step rather than measured once so
         one noisy sample cannot swing it. Entering a protrusion the normal
         swings the SAME way as that ambient sweep — a ridge is the surface
         turning faster than its surroundings, not against them — and
         leaving it the normal has to swing back, against the sweep, to
         rejoin the skull's own turning. Front-of-ear and back-of-ear are
         therefore opposite in sign by construction, not by anything
         particular to an ear: verified against the probe's own numbers,
         where the two crossings held a stable, opposite sign across every
         station either one existed at, including the stations where their
         BETA values alone came within eleven degrees of each other.

         Summed across the whole run rather than read off one sample, same
         reasoning as peak just above: a run a few samples wide should not
         have its polarity decided by whichever one of them is noisiest. */
      let turn = 0;
      for (let j = k0; j <= k1; j++) turn += vdot(cx[((j % NA) + NA) % NA], sweep);
      const sign = turn < 0 ? -1 : 1;

      out.push({ beta: (kf / NA) * Math.PI * 2, peak, sign });
    }
    return out;
  }

  /**
   * Chain per-ring candidates into continuous lines down a part, station by
   * station. Same continuity discipline the rest of this file uses —
   * fractional position, not an integer sample — carried into the LINKING
   * step this time rather than one ring's own refinement: a chain is
   * extended by whichever candidate on the NEXT station is nearest in
   * angle to where it last was, and only if that distance is inside
   * BREAK_STEP; a station with nothing close enough — including nothing at
   * all — ends the chain there rather than reaching over the gap, which is
   * literally what the task calls for and also what keeps this from
   * stitching two unrelated creases into one line just because they pass
   * near each other a few stations apart.
   *
   * Several chains grow at once — a jaw's two corners, both cheekbones — so
   * the matching at each station is a small greedy nearest-first
   * assignment: every candidate (active chain, ring candidate) pairing
   * within range is sorted by distance and claimed in that order, so two
   * chains converging toward the same seam cannot both claim the one ring
   * sample nearest it.
   *
   * SAME POLARITY ONLY. A chain also carries the `sign` its first candidate
   * was built with (ringBreaks() — see that function's own POLARITY
   * comment) and will only extend onto a same-sign candidate; an
   * opposite-sign one is not even offered a distance, however close in
   * beta. This is the ear-sawtooth fix: front-of-ear and back-of-ear are
   * two genuinely different edges that happen to run near each other in
   * angle, opposite in sign by construction, and without this a station
   * where the chain's own edge faded out for a ring would hand the nearest-
   * in-angle match to the OTHER edge instead, because distance was the only
   * thing being asked. Refusing that match does not bridge the gap — same
   * as running out of BREAK_STEP, the chain simply ends there, which is
   * exactly what should happen to two different edges rather than either
   * one bending to reach the other.
   */
  function chainBreaks(cands, NS) {
    let active = [];
    const chains = [];
    for (let i = 0; i < NS; i++) {
      const list = cands[i] || [];
      const pairs = [];
      for (let a = 0; a < active.length; a++) {
        for (let c = 0; c < list.length; c++) {
          if (active[a].sign !== list[c].sign) continue;
          const d = betaDist(active[a].lastBeta, list[c].beta);
          if (d <= BREAK_STEP) pairs.push([d, a, c]);
        }
      }
      pairs.sort((p, q) => p[0] - q[0]);
      const usedA = new Set(), usedC = new Set();
      for (const [, a, c] of pairs) {
        if (usedA.has(a) || usedC.has(c)) continue;
        usedA.add(a); usedC.add(c);
        active[a].pts.push({ i, beta: list[c].beta, peak: list[c].peak });
        active[a].lastBeta = list[c].beta;
      }
      const stillActive = [];
      for (let a = 0; a < active.length; a++) {
        if (usedA.has(a)) stillActive.push(active[a]);
        else chains.push(active[a]);   // no match this station: finalise it here
      }
      active = stillActive;
      for (let c = 0; c < list.length; c++) {
        if (!usedC.has(c)) {
          active.push({ pts: [{ i, beta: list[c].beta, peak: list[c].peak }], lastBeta: list[c].beta, sign: list[c].sign });
        }
      }
    }
    for (const a of active) chains.push(a);
    return chains.filter((ch) => ch.pts.length >= BREAK_MIN_LEN);
  }

  // Screen-space gap a run is kept comfortably under, in page pixels. Not
  // this feature's own number: it exists because skin.js's shared stroke
  // path — the one thing every mark from an outline to a landmark to this
  // is fed through — resamples nothing before calling RE.runs(pts, 0.05, 2,
  // 30), and that 30 is a GAP-BREAK threshold, not a resolution: two
  // consecutive points more than 30px apart on the page end the run there,
  // exactly like a station with no depth-field visibility does. A hand-
  // authored mark never meets that wall because landmarks() walks its own
  // spline at N=10-26 samples across a span of a few tens of millimetres by
  // construction; a plane break has exactly one candidate per RING STATION,
  // and a part's own stations can be real distance apart — a foot's 14
  // stations span its whole ~250mm length, close to 20mm each — which at
  // ordinary render scale is already past this margin, so a chain built
  // one point per station renders as a scatter of orphaned single points
  // and nothing else. Confirmed by rendering: every one of this feature's
  // early foot/trunk test images passed the diagnostic overlay (world
  // points landing exactly on the modelled geometry, chained smoothly) and
  // then drew NOTHING through the actual stroke path, at any tone up to 4x
  // amplified, until this margin — and the densify() below it feeds — was
  // added. Set well under 30 rather than at it, because the margin also
  // has to absorb a straight-line WORLD chord standing in for a curved
  // path between two stations, which is a slight underestimate of how far
  // a truly round form's own surface runs between them.
  const RUN_PX = 12;
  // mm-spacing densify() falls back to when ctx.mmPerPx was never measured
  // (see planeBreaks()'s own doc comment on why that stays legal) — dense
  // enough that RUN_PX would not be crossed even at a tight close-up
  // (mmPerPx well under 1), since there is no scale left to reason from
  // once the caller has opted out of one.
  const RUN_MM_FALLBACK = 8;

  /**
   * One chained run of per-STATION break candidates, turned into a dense
   * enough polyline of {P, peak} — world point plus the local sharpness —
   * to survive RE.runs()'s own RUN_PX gap-break once projected (see RUN_PX
   * above for why one point per station is not that on its own). Walks
   * each station-to-station span through onSurface() at as many fractional
   * stations as the span's own WORLD length needs to stay under RUN_PX once
   * scaled by mmPerPx, interpolating beta by the shortest way round
   * (betaDelta) and peak linearly, capped at 24 sub-steps — already finer
   * than any hand-authored mark in LANDMARKS bothers with.
   */
  function densify(run, rows, mmPerPx) {
    const NS = rows.length - 1;
    const maxMm = mmPerPx ? RUN_PX * mmPerPx : RUN_MM_FALLBACK;
    const out = [];
    for (let k = 0; k < run.length; k++) {
      const a = run[k];
      const Pa = onSurface(rows, a.i / NS, a.beta);
      if (Pa) out.push({ P: Pa, peak: a.peak });
      if (k === run.length - 1) break;
      const b = run[k + 1];
      const Pb = onSurface(rows, b.i / NS, b.beta);
      if (!Pa || !Pb) continue;
      const d = M.vdist(Pa, Pb);
      const steps = Math.min(24, Math.max(1, Math.ceil(d / maxMm)));
      const db = betaDelta(a.beta, b.beta);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const P = onSurface(rows, (a.i + (b.i - a.i) * t) / NS, a.beta + db * t);
        if (P) out.push({ P, peak: lerp(a.peak, b.peak, t) });
      }
    }
    return out;
  }

  /**
   * One chained run of break points, built into the {pts, id} shape
   * landmarks() uses: a world point plus a tone at every sample, faded at
   * both ends by Math.sin(u*PI) floored at a quarter — the exact formula
   * every LANDMARKS mark below is faded by — so a plane break sits in the
   * same visual family as a hand-authored crease instead of announcing
   * itself as a different kind of mark. Tone itself scales with the break's
   * own sharpness (peak, in radians) between BREAK_ANGLE (the floor a
   * candidate had to clear to exist at all, tone 0.35) and BREAK_SHARP
   * (tone 0.80) — a firmer line for a harder corner. Densified first (see
   * densify()) so the fade itself lands smoothly across many points rather
   * than in three or four coarse steps.
   */
  function buildRun(run, id, rows, mmPerPx) {
    const dense = densify(run, rows, mmPerPx);
    const n = dense.length;
    const pts = new Array(n);
    for (let j = 0; j < n; j++) {
      const u = n > 1 ? j / (n - 1) : 0.5;
      const fade = Math.sin(clamp01(u) * Math.PI);
      const tone = lerp(0.35, 0.80, clamp01((dense[j].peak - BREAK_ANGLE) / (BREAK_SHARP - BREAK_ANGLE)));
      const P = dense[j].P;
      pts[j] = [P[0], P[1], P[2], tone * (0.25 + 0.75 * fade)];
    }
    return { pts, id };
  }

  /**
   * planeBreaks(part, rows, ctx) -> [{pts, id}]
   *
   * See the section header above for what this finds and why it needs no
   * per-part table — it is run the same way over every part, head, foot or
   * trunk alike, and simply returns nothing where a part has no real
   * facet edge for it to find.
   *
   * @param part  the field's own part object — only part.name is read here
   *              (for the id string), but the full object is taken rather
   *              than just the name so this matches landmarks()'s own
   *              signature and a caller can pass the same variable to both.
   * @param rows  that part's sampled rings.
   * @param ctx   { eye, mmPerPx } — both optional, both degrade safely
   *              absent, the same way landmarks()'s ctx.mmPerPx does:
   *                eye      the view direction (view.e — points from the
   *                         scene toward the camera) a break's own normal
   *                         is tested against, to drop the stretch of it
   *                         that lies on the silhouette rather than on a
   *                         real interior edge. Omit it and no silhouette
   *                         test runs at all — nothing is dropped for it —
   *                         rather than every point failing a comparison
   *                         against undefined.
   *                mmPerPx  millimetres per pixel of the plate, the same
   *                         LOD floor landmarks() reads via partPxOf().
   *                         Omit it (or pass 0) to disable the filter, as
   *                         partPxOf() itself documents.
   */
  function planeBreaks(part, rows, ctx) {
    ctx = ctx || {};
    const NS = rows.length;
    if (NS < 3) return [];
    const nrm = normals(rows);
    const eye = ctx.eye;
    const partPx = partPxOf(rows, ctx.mmPerPx);

    const cands = new Array(NS);
    for (let i = 0; i < NS; i++) cands[i] = ringBreaks(rows[i], nrm[i]);

    const chains = chainBreaks(cands, NS);
    if (!chains.length) return [];

    const out = [];
    let idx = 0;
    for (const ch of chains) {
      // Classified by the RAW chain's own reach, before any silhouette
      // clipping shortens what actually gets drawn — a major ridge caught
      // edge-on for half its own length is still a major ridge, not a
      // small one that happens to be long. minPx ~90 for a chain spanning
      // a third or more of the part's own station range (a temporal line,
      // the foot's full instep run), rising toward a ceiling for one
      // barely three stations long (a single corner) — the "majors read
      // small, fine ones need scale" split landmarks() already states for
      // its own hand-authored marks (see visibleAt's own comment), turned
      // into a formula because nothing here is hand-tuned enough to give
      // each detected chain its own minPx by eye. The span fractions are
      // EST, picked against the foot and trunk test renders: the foot's
      // heel-behind-the-ankle run covers about a third of the foot's own
      // 14 stations and wants to read at ordinary foot scale; a single jaw
      // or cheekbone corner on a 44-station head covers under a tenth and
      // should not.
      //
      // THE CEILING ITSELF IS close-up-GATED, not the flat 220 a single-LOD
      // caller once made do with. A 44-station, na=52 head finds far more
      // short fragments than the foot or trunk's coarser rings ever do —
      // fifteen separate chains on the test head at bust scale, most of
      // them under a tenth of the part's own station range, because
      // 51-head.js's planar construction ties several DIFFERENT plane
      // pairs (brow-shelf/forehead, temple, the ear-adjacent parietal
      // seam, the occiput transition) to the same anchor height (browH
      // doubles as occiputH by that file's own construction) — so at any
      // one camera angle several of them line up at the same apparent
      // height and, drawn at the flat 220 ceiling every one of them
      // already clears well before ordinary bust framing, tile into what
      // reads as one continuous strap or, in three-quarter light, a
      // jagged stitched-together line, however cleanly each one is
      // individually detected and chained. A flat ceiling has no way to
      // keep asking for more scale as the plate keeps zooming in — once
      // partPx clears 220 (a fairly modest crop) EVERY chain shows at
      // once and never thins further. Ramping the ceiling itself with
      // closeUpFactor lets the short fragments keep needing MORE scale as
      // the plate keeps zooming in, the way landmarks()'s own per-mark
      // minPx already lets finer marks (eyeSocket, nostril) wait for more
      // scale than coarse ones (jaw, SCM). EST ceiling, tuned against the
      // bust repro renders (see this feature's report) to clear the short
      // fragments at bust partPx (415-556 on the FRAME=1284,1668 repro
      // set) while leaving the longer, likely-major chains (spanFrac
      // above roughly a third, minPx pinned at 90 regardless of the
      // ceiling) exactly as visible as they were.
      //
      // HEAD ONLY, same reasoning and the same measurement as
      // modelling()'s own identical gate just above: partPx is part-
      // relative, not camera-relative, and a trunk or limb reaches this
      // ceiling's engagement range at ordinary WHOLE-FIGURE scale purely
      // by being a physically bigger part, not by being zoomed in —
      // confirmed the same way, by a whole-figure pixel diff that only
      // went to zero once this, too, was scoped to the head. The dense
      // cluster of short co-height fragments this ceiling exists to thin
      // is a consequence of 51-head.js's own construction (several
      // distinct plane pairs anchored at the same browH/occiputH height —
      // see this feature's report); the foot's heel/instep run and the
      // trunk's iliac crest, this section's own header names as proof
      // this detector needs no per-part table, keep exactly the flat-220
      // behaviour they were tuned against.
      const spanFrac = (ch.pts[ch.pts.length - 1].i - ch.pts[0].i) / Math.max(1, NS - 1);
      const ceiling = lerp(220, 620, part.name === 'head' ? closeUpFactor(partPx) : 0);
      const minPx = lerp(ceiling, 90, clamp01((spanFrac - 0.08) / (0.35 - 0.08)));
      if (partPx < minPx) continue;

      // Split on whatever the raw chain does not survive — a missing ring,
      // or (with `eye` given) a stretch lying on the silhouette — the same
      // flush()-on-gap idiom modelling() uses: a gap in what is drawable
      // ends the run, it does not bridge across it as a straight segment.
      let run = [];
      const flush = () => {
        if (run.length >= BREAK_MIN_LEN) {
          out.push(buildRun(run, 'planeBreak.' + part.name + '.' + (idx++), rows, ctx.mmPerPx));
        }
        run = [];
      };
      for (const pt of ch.pts) {
        const row = rows[pt.i];
        if (!row) { flush(); continue; }
        if (eye) {
          const N = vnorm(lerpRing(nrm[pt.i], pt.beta));
          if (Math.abs(vdot(N, eye)) < BREAK_SIL) { flush(); continue; }
        }
        run.push({ i: pt.i, beta: pt.beta, peak: pt.peak });
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
      //
      // Upper anchor pulled in from LEFT-0.32 to LEFT-0.18, and tone down a
      // step (0.60 to 0.48): the "back-of-head mane" this feature's report
      // chases turned out to be mostly this mark, not the head's own —
      // "behind the ear" is real anatomy and the origin genuinely sits a
      // little past full-lateral, but at az 0/40 (dead behind, three-
      // quarter behind) that same few degrees is enough for the whole
      // 20-station run down to the notch to survive occlusion and read as
      // a strand falling past the shoulder, on BOTH sides at once. Pulled
      // in rather than cut: a neck viewed from behind ought to show a hint
      // of the SCM's posterior border, which real anatomy does too — this
      // keeps that hint and loses the full-strength double-strand version
      // of it. EST, judged against az 0/40 renders, not a measurement.
      {
        id: 'scm.L', tone: 0.48, minPx: 90, n: 22,
        ctrl: [
          [rowS(0.955), LEFT - 0.18],
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
      // Upper anchor pulled from LEFT-0.10 to LEFT+0.04 and tone down a
      // step (0.42 to 0.36) for the same reason and against the same az
      // 0/40 renders as scm.L just above — a smaller contributor to the
      // "mane" than scm was, but a contributor, and the two were tuned
      // together rather than one at a time against the same crops.
      {
        id: 'trapezius.L', tone: 0.36, minPx: 90, n: 18,
        ctrl: [[rowS(0.90), LEFT + 0.04], [rowS(0.80), LEFT + 0.32], [atH('suprasternaleheight', 8), FRONT - 0.85]],
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
    //
    // SUPERSEDED, not fixed here, once the head is planar. A hand-authored
    // brow and a real dihedral edge along the same arc double the same
    // line — the "cap brim" this feature's report diagnoses is exactly
    // that, brow doubled against the hairline right below it. This entry's
    // own tone/minPx stay the ordinary, sculptural-head numbers; the
    // supersede — checked dynamically, by whether planeBreaks() actually
    // finds anything on this part, not by a static per-part flag that
    // would go stale the moment either side's geometry moved without the
    // other's constant following it — lives in PLANE_SUPERSEDED and is
    // applied in landmarks() below, right before visibleAt() ever sees
    // this table. Demoted rather than dropped outright: a detector this
    // new failing to fire somewhere should leave a faint brow behind
    // rather than no brow at all.
    {
      id: 'brow', tone: 0.52, minPx: 130, n: 24,
      // A near-constant station swept across a wide beta range is a line of
      // LATITUDE around the head, not a frontal feature — the first pass
      // reached all the way to LEFT/RIGHT+0.34 (~70 degrees off centre,
      // basically the ear line) AND barely dropped in station on the way,
      // so it read as a headband circling the skull rather than a brow.
      // Pulled in laterally to within a radian of FRONT, and dropped hard
      // in station toward the outer end the way a real brow tapers off.
      ctrl: [
        [ofUp(0.02), (ctx) => FRONT - 0.92 * faceW(ctx)],
        [ofUp(0.11), (ctx) => FRONT - 0.55 * faceW(ctx)],
        [ofUp(0.145), FRONT],
        [ofUp(0.11), (ctx) => FRONT + 0.55 * faceW(ctx)],
        [ofUp(0.02), (ctx) => FRONT + 0.92 * faceW(ctx)],
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
        [ofDn(-0.33), (ctx) => FRONT - noseDelta(ctx) * 0.9],
        [ofDn(-0.38), FRONT],
        [ofDn(-0.33), (ctx) => FRONT + noseDelta(ctx) * 0.9],
      ],
    },

    // ---- the mouth ----------------------------------------------------
    // The line between the lips is the only one always there; the upper
    // lip's own edge and the shadow under the lower lip come and go with
    // the light, so both are carried at a lower tone than the line itself.
    {
      id: 'lipLine', tone: 0.58, minPx: 190, n: 14,
      ctrl: [
        [ofDn(-0.545), (ctx) => FRONT - mouthDelta(ctx)],
        [ofDn(-0.560), FRONT],
        [ofDn(-0.545), (ctx) => FRONT + mouthDelta(ctx)],
      ],
    },
    {
      id: 'lipUpper', tone: 0.26, minPx: 270, n: 12,
      // A first pass put this only 7-9mm below noseUnder, and with the
      // nostril wing and nasolabial fold also converging on that same small
      // patch the four marks piled into one tangle that read as a moustache
      // rather than as a nose and a mouth. Given more room below the nose.
      ctrl: [
        [ofDn(-0.505), (ctx) => FRONT - mouthDelta(ctx) * 0.85],
        [ofDn(-0.525), FRONT],
        [ofDn(-0.505), (ctx) => FRONT + mouthDelta(ctx) * 0.85],
      ],
    },
    {
      id: 'lipLowerShadow', tone: 0.22, minPx: 280, n: 12,
      ctrl: [
        [ofDn(-0.605), (ctx) => FRONT - mouthDelta(ctx) * 0.75],
        [ofDn(-0.620), FRONT],
        [ofDn(-0.605), (ctx) => FRONT + mouthDelta(ctx) * 0.75],
      ],
    },

    // ---- nasolabial fold and the crease under the cheekbone -------------
    {
      id: 'nasolabial.L', tone: 0.34, minPx: 200, n: 14,
      ctrl: [
        [ofDn(-0.29), (ctx) => FRONT - noseDelta(ctx) * 1.1],
        [ofDn(-0.49), (ctx) => FRONT - mouthDelta(ctx) * 1.35],
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
    //
    // SECOND PASS — the "cap brim". Even with the station genuinely
    // dropping from crown to temple, this and brow are both near-full-tone
    // marks sitting one above the other across most of the same beta range
    // (brow FRONT±0.92·faceW, this FRONT±1.10·faceW), and at a head-filling
    // crop (FRAME=1330,1690, az 140 — this feature's own report) the two
    // read as one striped band, not two separate features: exactly a cap's
    // brim over the eyes. Two changes, not one, because they fix different
    // halves of the same complaint. First, a hairline is a TEXTURE
    // boundary — where scalp gives way to a hundred thousand individual
    // hairs, each catching light differently — not a surface plane change,
    // so it belongs fainter and finer than a mark that stands for an
    // actual edge, and is pushed higher up the LOD floor to match (a
    // texture cue earns its keep at closer range than a structural line
    // does — compare eyeSocket/eyeLid at 240-260). Second, the arch itself
    // is widened and given two more control points: brow to vertex
    // (0.12·up to 0.93·up) is 0.81 of `up`, and the old 0.28-0.62 swing
    // used well under half of that, most of it sitting near the flatter,
    // slower-turning top of the skull where a real recession is closer to
    // the FRONT of that span. Two more points let the curve fall away
    // faster near the temple and climb more of the remaining rise near
    // the centre, rather than one smooth arc doing both at once — which
    // is what still reads as a ring at any width once it is a single
    // symmetric curve. tone and minPx are this feature's own report;
    // the ctrl heights are EST, picked against the same crop.
    {
      id: 'hairline', tone: 0.22, minPx: 260, n: 26,
      ctrl: [
        [ofUp(0.16), (ctx) => FRONT - 1.15 * faceW(ctx)],
        [ofUp(0.30), (ctx) => FRONT - 0.85 * faceW(ctx)],
        [ofUp(0.50), (ctx) => FRONT - 0.45 * faceW(ctx)],
        [ofUp(0.68), FRONT],
        [ofUp(0.50), (ctx) => FRONT + 0.45 * faceW(ctx)],
        [ofUp(0.30), (ctx) => FRONT + 0.85 * faceW(ctx)],
        [ofUp(0.16), (ctx) => FRONT + 1.15 * faceW(ctx)],
      ],
    },
    // the occiput: the back of the vault's own curve, low enough to read
    // as where the skull rounds into the neck rather than as a second
    // hairline. Tone and minPx both pulled in from the first pass (0.24,
    // 135) once az 0/40 crops (this feature's own report) showed it
    // combining with the hairline's own back-reaching temple ends and the
    // trunk's neck marks (scm.L/.R reach a little past full-lateral at
    // their own upper anchor, LEFT-0.32 — see scm's comment — which is
    // enough to read from behind) into a "mane" cascading past the
    // shoulders. This alone does not fix that — scm is tuned separately,
    // below — but a fainter, later-appearing occiput is one fewer line in
    // the same combination. Superseded outright once a real plane break
    // covers this part (PLANE_SUPERSEDED below): the occiput is a girth
    // change more than a texture boundary, so unlike the hairline it
    // stands to be a genuine geometric edge on a planar skull, not just
    // dimmed.
    {
      id: 'occipital', tone: 0.16, minPx: 190, n: 16,
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
   *
   * ctx.eye, if the caller has it (view.e — see planeBreaks()), is read
   * here too, but only ever handed onward to planeBreaks() itself, for the
   * PLANE_SUPERSEDED check below. Pass the same ctx to both calls (skin.js
   * already builds one object for exactly this) and the two agree with
   * each other about what a plate's plane breaks actually are, rather than
   * this function silently re-deriving a slightly different answer.
   */
  // Marks a real plane break can stand in for, once the geometry actually
  // HAS one where the mark is — see PLANE BREAKS above. Checked dynamically
  // per call (does planeBreaks() find anything AT ALL on this part), not by
  // a static "this part is planar" flag: a flag would need updating by
  // hand the moment either side's geometry changed, and would be wrong for
  // exactly as long as nobody remembered to. The two entries here are
  // both head-only and both explained where they are authored above:
  // brow is superseded hard, because a real dihedral in the same place
  // doubles the line and IS the "cap brim" this feature's report chases;
  // occipital the same way, because a planar skull's vault-to-neck step is
  // a genuine edge rather than the soft roll the current construction
  // gives it. hairline is deliberately absent — it is a texture boundary,
  // not a plane break, and no amount of head construction changes that.
  const PLANE_SUPERSEDED = {
    brow: { minPx: 320, tone: 0.15 },
    occipital: { minPx: 300, tone: 0.08 },
  };
  function landmarks(part, rows, ctx) {
    ctx = ctx || {};
    if (!ctx.rig) return [];
    const spec = LANDMARKS[part.name];
    if (!spec) return [];
    const partPx = partPxOf(rows, ctx.mmPerPx);
    // Computed at most once per call, and only ever forced at all when this
    // part's own spec has an entry PLANE_SUPERSEDED names — every other
    // part (and every other head mark) never pays for a plane-break pass
    // it has no use for.
    let _planar = null;
    const isPlanar = () => _planar || (_planar = planeBreaks(part, rows, ctx));
    const effSpec = spec.map((L) => {
      const demoted = PLANE_SUPERSEDED[L.id];
      return (demoted && isPlanar().length > 0) ? Object.assign({}, L, demoted) : L;
    });
    const out = [];
    for (const L of visibleAt(effSpec, partPx)) {
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
    lamp, normals, bandAt, modelling, planeBreaks, landmarks, onSurface, LANDMARKS, HZ,
    resolveStation, nativeFrac, nearestOnRows, projectBone,
    partExtentMm, partPxOf, visibleAt,
    // the two stages inside planeBreaks(), exposed the same way its other
    // internals already are (resolveStation, nearestOnRows, ...) — this is
    // what let the ear-zigzag bug get instrumented directly, ring candidates
    // in and chained beta sequence out, instead of only ever seeing the
    // already-densified world-space polyline planeBreaks() itself returns.
    ringBreaks, chainBreaks,
  };
})(window.GK = window.GK || {});
