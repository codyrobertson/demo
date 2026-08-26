/* ============================================================================
   GRAPHITE FIGURE — src/50-field.js
   The body as four nested layers, and the skin as an isosurface over them.

   WHAT THIS REPLACES, AND WHY. The first surface here lofted a superelliptical
   section along each bone and called the result a body. It is worth being
   precise about why that failed, because it failed in the way every
   procedural figure fails: it was the skeleton inflated. A tube around a
   femur is a tube. It has no idea that a vastus lateralis sits on its lateral
   side and not its medial one, that the tissue over a tibial crest is two
   millimetres thick and over a calf is forty, or that a shoulder is wide
   because a deltoid wraps a joint rather than because a bone is fat there.
   Rendered, it read as a slab, and no amount of tuning the section would have
   fixed it, because the missing thing was not shape — it was layers.

       SKELETON  ->  MUSCLE / TENDON  ->  FASCIA + FAT  ->  SKIN

   Each contributes to one scalar field, and the skin is where that field
   crosses a threshold. So a muscle bulging pushes the skin out because it
   pushes the FIELD out; fat is its own regional term rather than a fudge on a
   radius; and fascia is the smoothness of the union rather than a filter
   applied afterwards.

   THE RINGS SURVIVE. The drawing pipeline wants rings of surface samples — it
   traces the border of what a part covers, which is the one silhouette
   construction that does not fall apart when a limb points at the eye. So the
   field is not marched as a mesh. Each ring is found by root-finding outward
   from the bone axis: for a given station along a bone and a given angle
   around it, walk out until the field crosses the threshold. That keeps the
   whole traced-silhouette and depth-field pipeline exactly as it is, and
   makes the surface an isosurface rather than a loft.

   WHY THE SKIN MUST NOT TRACE THE MUSCLES. A skin laid directly on the muscle
   field draws an anatomy chart, not a person: every intermuscular groove
   shows, at full depth, everywhere. Real skin sits over epimysium, deep
   fascia and subcutaneous tissue, which bridge the small gaps and suppress
   most of the grooves while leaving the few that genuinely show. That is the
   smooth-union radius below, and it is why the union is smooth rather than a
   max().
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { lerp, clamp, clamp01, vadd, vsub, vmad, vdot, vlen, vmul, vnorm } = M;

  /**
   * Smooth minimum, the polynomial form. This is the fascia: two bellies a
   * few millimetres apart merge into one surface with a shallow valley
   * between them rather than a crevasse, and the width of the blend is how
   * much soft tissue lies over them. A hard min() draws the anatomy chart.
   */
  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = clamp01(0.5 + 0.5 * (b - a) / k);
    return lerp(b, a, h) - k * h * (1 - h);
  }

  /** signed distance to a capsule: the primitive every bone and every muscle belly is made of */
  function sdCapsule(P, A, B, ra, rb) {
    const ab = vsub(B, A), ap = vsub(P, A);
    const t = clamp01(vdot(ap, ab) / Math.max(1e-9, vdot(ab, ab)));
    const c = vmad(A, ab, t);
    return vlen(vsub(P, c)) - lerp(ra, rb, t);
  }

  /**
   * An elliptical capsule — a capsule whose cross-section is not round.
   * Muscles are flattened against the bone they lie on and limbs are not
   * cylinders; a field built only from round primitives produces the balloon
   * animal directly, however good the layering above it is.
   */
  function sdCapsuleE(P, A, B, frame, ra, rb, ratio) {
    const ab = vsub(B, A), ap = vsub(P, A);
    const t = clamp01(vdot(ap, ab) / Math.max(1e-9, vdot(ab, ab)));
    const c = vmad(A, ab, t);
    const d = vsub(P, c);
    const y = vdot(d, frame[1]), z = vdot(d, frame[2]), x = vdot(d, frame[0]);
    const r = lerp(ra, rb, t);
    // scale the two transverse axes apart, then measure as if round
    const e = Math.hypot(y / ratio, z * ratio);
    return Math.hypot(e, Math.max(0, Math.abs(x) - vlen(ab) * 0)) - r;
  }

  // =========================================================================
  //  THE LAYERS
  // =========================================================================

  /**
   * Bone. Tight, and deliberately so: these are the places the skin is close
   * to the skeleton, and they are what stop a figure reading as upholstered.
   * A clavicle, an olecranon, a tibial crest, a malleolus and an ASIS all
   * show through on a living body at any body fat, and they show because the
   * tissue over them is a couple of millimetres, not because they are bigger.
   */
  function boneField(rig, P) {
    let d = 1e9;
    for (const id of rig.order) {
      const b = rig.bones[id];
      if (!b.len) continue;
      const r = boneRadius(rig.figure, id);
      d = Math.min(d, sdCapsule(P, b.A, b.B, r, r * 0.92));
    }
    return d;
  }

  // EST throughout: ANSUR measures no bone breadths this project can use, and
  // Rajagopal carries inertias rather than shaft radii. These are the radius
  // of the bone plus its immediate periosteal tissue, as a fraction of the
  // bone's own length — which at least scales with the figure.
  const BONE_R = {
    pelvis: 0.55, skull: 0.62,
    clavicle: 0.09, scapula: 0.30,
    humerus: 0.085, forearm: 0.075,
    femur: 0.075, tibia: 0.070, foot: 0.22,
  };
  function boneRadius(fig, id) {
    const base = id.replace(/\.[LR]$/, '');
    if (/^[LTC]\d+$/.test(base)) return fig.stature * 0.017;   // a vertebral body
    const k = BONE_R[base];
    if (k === undefined) return fig.stature * 0.008;
    return Math.max(4, (fig.len[base] || fig.stature * 0.05) * k);
  }

  /**
   * Muscle. Delegated to GK.muscle when it is present; until then the field
   * has bone and fat only, and says so rather than quietly substituting a
   * bigger bone. A figure drawn without this layer is a figure with no
   * deltoid, no calf and no glute, and it should look like it.
   */
  function muscleField(rig, P) {
    if (!GK.muscle || !GK.muscle.fieldAt) return 1e9;
    return GK.muscle.fieldAt(rig, P);
  }

  /**
   * Fat, as its own regional field rather than a constant offset. Body fat is
   * not spread evenly and the places it collects are what distinguish two
   * bodies with the same skeleton and the same muscles — so it is thickness
   * per region, scaled by one global amount, and NOT a radius fudge.
   *
   * The regional weights are EST. The global amount is not: it is solved per
   * figure so the resulting girths match the measured circumferences, in
   * fitFat() below, which is what keeps this honest.
   */
  const FAT_REGION = {
    trunk: 1.00, pelvis: 1.25, femur: 0.85, tibia: 0.55,
    humerus: 0.70, forearm: 0.42, skull: 0.20, foot: 0.20,
  };
  function fatAt(fig, id) {
    const base = id.replace(/\.[LR]$/, '');
    const w = FAT_REGION[/^[LTC]\d+$/.test(base) ? 'trunk' : base];
    return (w === undefined ? 0.6 : w) * (fig.fat === undefined ? 12 : fig.fat);
  }

  // =========================================================================
  //  THE SKIN
  // =========================================================================

  /**
   * How far out from a bone's axis the skin sits, at station `s` along it and
   * angle `beta` around it. Root-found rather than evaluated: the field is a
   * union of things that do not compose into a closed form, and bisection on
   * a monotone-enough ray is both simple and exactly as accurate as it is
   * asked to be.
   */
  function skinRadius(rig, id, s, beta, opts) {
    opts = opts || {};
    const b = rig.bones[id];
    if (!b) return null;
    const C = vmad(b.A, b.frame[0], b.len * clamp01(s));
    const dir = vadd(vmul(b.frame[1], Math.cos(beta)), vmul(b.frame[2], Math.sin(beta)));
    const fascia = opts.fascia === undefined ? 14 : opts.fascia;
    const fat = fatAt(rig.figure, id);

    const f = (r) => {
      const P = vmad(C, dir, r);
      // fascia is the smoothness of the union; fat is an offset on the result
      return smin(boneField(rig, P), muscleField(rig, P), fascia) - fat;
    };
    let lo = 1, hi = Math.max(60, rig.figure.stature * 0.14);
    if (f(hi) < 0) return hi;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) * 0.5;
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /**
   * The trunk is ONE part, not twelve. Sampling per vertebra and tracing each
   * separately draws a stack of discs — every ring becomes its own closed
   * silhouette and the seams between them are all visible. The spine is a
   * centreline: walk it, and root-find outward from the local frame.
   */
  function spineChain(rig) {
    const ids = [];
    for (let i = 5; i >= 1; i--) if (rig.bones['L' + i]) ids.push('L' + i);
    for (let i = 12; i >= 1; i--) if (rig.bones['T' + i]) ids.push('T' + i);
    for (let i = 7; i >= 1; i--) if (rig.bones['C' + i]) ids.push('C' + i);
    return ids;
  }

  /** a ring on the trunk at station u along the whole spine */
  function trunkRing(rig, u, na, opts) {
    const ids = rig.spine || (rig.spine = spineChain(rig));
    const f = clamp01(u) * (ids.length - 1);
    const i = Math.min(ids.length - 1, Math.floor(f)), t = f - i;
    const b = rig.bones[ids[i]];
    const s = Math.min(1, t);
    const out = [];
    for (let k = 0; k < na; k++) {
      const beta = (k / na) * Math.PI * 2;
      const r = skinRadius(rig, ids[i], s, beta, opts);
      const C = vmad(b.A, b.frame[0], b.len * s);
      const dir = vadd(vmul(b.frame[1], Math.cos(beta)), vmul(b.frame[2], Math.sin(beta)));
      out.push(vmad(C, dir, r));
    }
    return out;
  }

  /** a ring of skin samples around a bone, ready for the tracer and the depth field */
  function skinRing(rig, id, s, na, opts) {
    const b = rig.bones[id];
    if (!b) return null;
    const C = vmad(b.A, b.frame[0], b.len * clamp01(s));
    const out = [];
    for (let k = 0; k < na; k++) {
      const beta = (k / na) * Math.PI * 2;
      const r = skinRadius(rig, id, s, beta, opts);
      const dir = vadd(vmul(b.frame[1], Math.cos(beta)), vmul(b.frame[2], Math.sin(beta)));
      out.push(vmad(C, dir, r));
    }
    return out;
  }

  /**
   * Solve the one global fat amount that makes this figure's girths the
   * measured ones. The regional weights say WHERE fat sits; ANSUR says how
   * much there is in total, through circumferences it actually measured. So
   * the shape of the distribution is estimated and its magnitude is not.
   */
  function fitFat(rig, sites) {
    const fig = rig.figure;
    sites = sites || [
      { id: 'femur.L', s: 0.35, girth: 'thigh' },
      { id: 'tibia.L', s: 0.28, girth: 'calf' },
      { id: 'humerus.L', s: 0.45, girth: 'biceps' },
      { id: 'forearm.L', s: 0.22, girth: 'forearm' },
    ];
    const perim = (id, s) => {
      const R = skinRing(rig, id, s, 28);
      let L = 0;
      for (let i = 0; i < R.length; i++) L += vlen(vsub(R[(i + 1) % R.length], R[i]));
      return L;
    };
    let lo = 0, hi = 60;
    const err = (v) => {
      fig.fat = v;
      let e = 0;
      for (const st of sites) e += perim(st.id, st.s) - fig.girth[st.girth];
      return e;
    };
    if (err(hi) < 0) { fig.fat = hi; return hi; }
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) * 0.5;
      if (err(mid) < 0) lo = mid; else hi = mid;
    }
    fig.fat = (lo + hi) * 0.5;
    return fig.fat;
  }

  GK.field = {
    smin, sdCapsule, sdCapsuleE,
    boneField, boneRadius, muscleField, fatAt, FAT_REGION, BONE_R,
    skinRadius, skinRing, trunkRing, spineChain, fitFat,
  };
})(window.GK = window.GK || {});
