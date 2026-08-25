/* ============================================================================
   GRAPHITE KINEMATICS — 10 · anatomy
   Skeletal metrics, joint envelopes, and the per-seed generation of a single
   unique hand. Lengths are in millimetres; the renderer scales at the end.

   Nominal segment lengths follow published hand anthropometry (adult mean);
   each seed perturbs them within real population variance, correlated by an
   overall size factor so a hand stays internally consistent.

   Frame convention (right hand, neutral):
       +X  distal      (toward the fingertips)
       +Y  ulnar       (thumb -> little finger)
       +Z  dorsal      (out the back of the hand;  -Z is palmar)
   Joint rotations:  rotY = flexion(+) / extension(-)
                     rotZ = ulnar deviation(+) / radial(-)
                     rotX = axial twist (pronation / opposition)
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const { DEG, clamp, lerp, Rng } = M;

  // Digit indices
  const THUMB = 0, INDEX = 1, MIDDLE = 2, RING = 3, LITTLE = 4;
  const DIGIT_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];

  // ------------------------------------------------------------ bone lengths
  // metacarpal / proximal / middle / distal  (mm, adult mean)
  const NOMINAL = {
    meta: [46.2, 68.1, 64.6, 58.0, 53.6],
    prox: [31.6, 39.8, 44.6, 41.8, 32.6],
    mid: [0, 22.4, 27.6, 25.6, 18.1],   // thumb has no middle phalanx
    dist: [21.7, 15.8, 17.4, 17.5, 15.8]
  };

  // half-breadth of each digit at its metacarpophalangeal joint (mm)
  const NOMINAL_BREADTH = [11.0, 10.2, 10.1, 9.4, 8.2];

  // ---------------------------------------------------- carpometacarpal bases
  // Origin of each metacarpal in the carpal frame, and its rest orientation.
  //   fan  : splay within the palm plane (rotZ), negative = radial
  //   tilt : how far palmar the metacarpal head sits (rotY), builds the arch
  //   roll : axial set of the metacarpal (rotX)
  const CMC_BASE = [
    // thumb — the trapezium is in the DISTAL carpal row, so CMC1 sits at
    // roughly the same proximodistal level as CMC2 (index), not behind it;
    // it is far radial and palmar, and rolled ~63 deg out of the palm plane
    // so the nail faces radially and a little dorsally at rest, not palmar.
    // At 63 degrees the nail came out radial and a little PALMAR, which is
    // the wrong side of the textbook line, and it left the pad near enough
    // edge-on that a palmar view of the hand showed the thumb's flank rather
    // than its print and creases. Two things had to be fixed before this
    // angle could move: the thenar's offset, which used to be tied to the
    // bone and slid off it as soon as this rotated, and the four opposition
    // presets, whose chains leaned on the old set.
    { pos: [17.5, -20.0, 10.0], fan: -42 * DEG, tilt: 20 * DEG, roll: -48 * DEG },
    { pos: [20.0, -11.5, -2.5], fan: -9.5 * DEG, tilt: 4 * DEG, roll: -8 * DEG },
    { pos: [21.0, -1.5, -3.5], fan: -0.5 * DEG, tilt: 0 * DEG, roll: 0 * DEG },
    { pos: [18.5, 7.5, -1.5], fan: 8.0 * DEG, tilt: 5 * DEG, roll: 9 * DEG },
    { pos: [15.0, 15.5, 2.0], fan: 17.0 * DEG, tilt: 12 * DEG, roll: 20 * DEG }
  ];

  // Mobility of the 4th/5th carpometacarpal joints — this is what lets the palm
  // cup. Digits 2 and 3 are effectively rigid against the carpus.
  const CMC_MOBILITY = [0, 0.0, 0.0, 11 * DEG, 26 * DEG];

  // ------------------------------------------------------------ joint limits
  // Range of motion per degree of freedom, in degrees. ext is negative flexion.
  //   mcp.flex/.ext/.abd   pip.flex   dip.flex/.ext
  const LIMITS = {
    wrist: { flex: 80, ext: 70, ulnar: 33, radial: 19, pron: 85, sup: 85 },
    digits: [
      { // thumb: cmc(flex,abd,opp) mcp(flex) ip(flex,ext)
        // In-plane radial abduction is the thumb's largest excursion — it is
        // what opens the hand flat — and it was being given less range than
        // adduction across the palm, so a spread hand threw the thumb forward
        // out of the plane instead of out to the side.
        cmc: { flex: 55, ext: 30, abd: 68, add: 10, opp: 92, rep: 15 },
        mcp: { flex: 58, ext: 12, abd: 9 },
        ip: { flex: 82, ext: 24 }
      },
      { mcp: { flex: 88, ext: 34, abd: 28 }, pip: { flex: 108, ext: 3 }, dip: { flex: 78, ext: 12 } },
      { mcp: { flex: 92, ext: 30, abd: 16 }, pip: { flex: 114, ext: 3 }, dip: { flex: 82, ext: 12 } },
      { mcp: { flex: 96, ext: 32, abd: 18 }, pip: { flex: 118, ext: 4 }, dip: { flex: 84, ext: 14 } },
      { mcp: { flex: 98, ext: 38, abd: 30 }, pip: { flex: 116, ext: 5 }, dip: { flex: 86, ext: 16 } }
    ]
  };

  // ---------------------------------------------------- dermatoglyphic types
  // Population frequencies of fingerprint pattern classes (approximate).
  const PRINT_TYPES = [
    { v: 'ulnarLoop', w: 0.52 },
    { v: 'whorl', w: 0.26 },
    { v: 'radialLoop', w: 0.08 },
    { v: 'arch', w: 0.07 },
    { v: 'tentedArch', w: 0.04 },
    { v: 'doubleLoop', w: 0.03 }
  ];

  /* --------------------------------------------------------------------------
     buildAnatomy(seed, opts) -> a single unique hand
     Everything here is structural: it does not depend on pose or on view.
     -------------------------------------------------------------------------- */
  function buildAnatomy(seed, opts) {
    opts = opts || {};
    const rng = new Rng(seed);
    // A left hand is not a right hand with a flipped label: it is a genuine
    // mirror image, built by negating every quantity measured along the
    // ulnar axis (never distal or palmar, which stay shared) wherever one is
    // authored below or, for a pose term, wherever the rig reads it. That
    // keeps every frame a proper rotation of the last — never a reflection —
    // so handedness survives intact and nothing downstream has to know which
    // hand it is looking at.
    const A = { seed, chirality: opts.chirality === 'left' ? -1 : 1 };

    // ---- global build ------------------------------------------------------
    // One size factor correlates every bone; slenderness is a second axis.
    // Drawn from the population unless a caller names it. A figure project
    // needs to grow a hand that fits a particular body rather than one that
    // fits the distribution, and scaling the geometry after the fact would
    // leave the features — print ridge spacing, hair, crease depth — at the
    // size they were built for, on a hand that is no longer that size.
    // The draw happens either way and is discarded if a caller named a size,
    // rather than being skipped: skipping it shifts every subsequent draw and
    // the same seed would then grow a different hand, not the same hand at a
    // different size.
    const drawnSize = rng.gaussIn(1.0, 0.062, 0.84, 1.18);
    const size = opts.size === undefined ? drawnSize : opts.size;
    const slender = rng.gaussIn(1.0, 0.085, 0.80, 1.22);   // >1 = narrower digits
    const digitLengthBias = rng.gaussIn(1.0, 0.035, 0.90, 1.10);
    A.size = size; A.slender = slender;

    // 2D:4D ratio — index/ring length relation, a real and visible variation
    A.ratio2d4d = rng.gaussIn(0.965, 0.032, 0.88, 1.06);

    A.bones = [];
    for (let d = 0; d < 5; d++) {
      const jitter = () => rng.gaussIn(1.0, 0.028, 0.92, 1.08);
      let lenBias = digitLengthBias;
      if (d === INDEX) lenBias *= A.ratio2d4d / 0.965 * 0.5 + 0.5;
      if (d === RING) lenBias *= (2 - A.ratio2d4d / 0.965) * 0.5 + 0.5;

      const meta = NOMINAL.meta[d] * size * jitter();
      const prox = NOMINAL.prox[d] * size * lenBias * jitter();
      const mid = NOMINAL.mid[d] * size * lenBias * jitter();
      const dist = NOMINAL.dist[d] * size * lenBias * jitter();
      const breadth = NOMINAL_BREADTH[d] * size / slender * rng.gaussIn(1.0, 0.03, 0.9, 1.1);

      // Width control at each joint of the digit, as a fraction of its
      // breadth at the knuckle. A single continuous chain: the value at the
      // end of one bone IS the value at the start of the next, so the
      // silhouette never steps at a joint.
      const jw = d === THUMB
        ? [1.06, 0.945, 0.865]                 // MCP, IP, tip
        : [1.00, 0.900, 0.805, 0.745];         // MCP, PIP, DIP, tip
      const jb = d === THUMB
        ? [0.095, 0.105, 0]
        : [0.100, 0.118, 0.098, 0];
      // depth-to-breadth ratio at each joint: a digit is always a flattened
      // oval, flatter at the pulp than at the knuckle
      const jd = d === THUMB
        ? [0.985, 0.945, 0.905]
        : [0.980, 0.948, 0.918, 0.892];
      for (let i = 0; i < jw.length - 1; i++) jw[i] *= rng.gaussIn(1, 0.018, 0.95, 1.05);

      A.bones.push({
        digit: d,
        name: DIGIT_NAMES[d],
        jw, jb, jd,
        lengths: d === THUMB ? [meta, prox, dist] : [meta, prox, mid, dist],
        segNames: d === THUMB ? ['MC', 'PP', 'DP'] : ['MC', 'PP', 'MP', 'DP'],
        jointNames: d === THUMB ? ['CMC', 'MCP', 'IP'] : ['CMC', 'MCP', 'PIP', 'DIP'],
        breadth,
        // per-digit resting camber: fingers are never perfectly straight
        camber: [
          0,
          rng.gaussIn(d === LITTLE ? 3.0 : 1.2, 1.4, -2, 7) * DEG,
          rng.gaussIn(d === LITTLE ? 4.5 : 2.0, 1.6, -1, 9) * DEG,
          rng.gaussIn(1.5, 1.2, -1, 5) * DEG
        ],
        // little-finger clinodactyly: a slight ulnar bow at the DIP, common.
        // Same lateral sense as fan/roll below, so it mirrors with them.
        clino: (d === LITTLE ? rng.gaussIn(5.5, 3.2, 0, 14) : rng.gaussIn(0.6, 1.0, -2, 3)) * DEG * A.chirality
      });
    }

    // ---- carpometacarpal layout -------------------------------------------
    // pos.y, fan and roll are the three numbers CMC_BASE authors along the
    // radial(-)/ulnar(+) gradient (see the field comments above CMC_BASE);
    // tilt does not run thumb-to-little the way they do, and FLEX(tilt) does
    // not change sense under mirroring the way ABD(fan)/TWIST(roll) do, so
    // it is left alone. Miss one of these three on a left hand and the
    // metacarpal fan stays right-handed while its origin mirrors, or the
    // reverse - either way the palm tents instead of cupping.
    A.cmc = CMC_BASE.map((b, i) => ({
      pos: [b.pos[0] * size, b.pos[1] * size * A.chirality, b.pos[2] * size],
      fan: b.fan * A.chirality * rng.gaussIn(1, 0.07, 0.8, 1.2),
      tilt: b.tilt * rng.gaussIn(1, 0.1, 0.75, 1.3),
      roll: b.roll * A.chirality * rng.gaussIn(1, 0.045, 0.88, 1.12),
      mobility: CMC_MOBILITY[i]
    }));

    // Depth of the transverse metacarpal arch at rest
    A.archRest = rng.gaussIn(0.30, 0.08, 0.12, 0.52);

    // ---- soft tissue -------------------------------------------------------
    A.palm = {
      thenar: rng.gaussIn(1.0, 0.14, 0.68, 1.36),     // ball of the thumb
      hypothenar: rng.gaussIn(1.0, 0.13, 0.70, 1.32), // ulnar pad
      hollow: rng.gaussIn(1.0, 0.16, 0.62, 1.40),     // central concavity
      padding: rng.gaussIn(1.0, 0.11, 0.74, 1.28),    // overall fleshiness
      wristW: rng.gaussIn(1.0, 0.06, 0.86, 1.16)
    };

    // Web (interdigital commissure) height, as a fraction along the proximal
    // phalanx. The first web (thumb/index) is much lower than the rest.
    A.web = [
      rng.gaussIn(0.16, 0.03, 0.08, 0.26),
      rng.gaussIn(0.40, 0.035, 0.30, 0.50),
      rng.gaussIn(0.42, 0.035, 0.32, 0.52),
      rng.gaussIn(0.44, 0.038, 0.33, 0.55)
    ];

    // ---- creases -----------------------------------------------------------
    // Simian crease (single transverse palmar crease) occurs in ~1.5% of hands;
    // a Sydney crease somewhat more often. Both are real, both are rare.
    const creaseRoll = rng.f();
    A.creasePattern = creaseRoll < 0.015 ? 'simian' : (creaseRoll < 0.055 ? 'sydney' : 'normal');
    A.creases = {
      distalArc: rng.gaussIn(1.0, 0.13, 0.7, 1.3),
      proximalArc: rng.gaussIn(1.0, 0.13, 0.7, 1.3),
      thenarArc: rng.gaussIn(1.0, 0.12, 0.72, 1.3),
      fateLine: rng.chance(0.72),           // vertical crease, not universal
      sunLine: rng.chance(0.34),
      minorCount: rng.int(4, 11),
      wristCreases: rng.int(2, 3)
    };

    // ---- nails -------------------------------------------------------------
    A.nails = [];
    for (let d = 0; d < 5; d++) {
      A.nails.push({
        // length as a fraction of the distal phalanx, width as fraction of breadth
        len: rng.gaussIn(d === THUMB ? 0.60 : 0.63, 0.05, 0.44, 0.78),
        wide: rng.gaussIn(d === THUMB ? 0.78 : 0.70, 0.055, 0.54, 0.88),
        free: rng.gaussIn(0.14, 0.06, 0.0, 0.32),     // free edge overhang
        lunula: rng.gaussIn(d === THUMB ? 0.26 : 0.15, 0.07, 0.0, 0.36),
        curve: rng.gaussIn(1.0, 0.16, 0.6, 1.45)      // transverse curvature
      });
    }

    // ---- fingerprints ------------------------------------------------------
    // Whorls cluster: if a hand has one it is likelier to have more.
    const whorlBias = rng.f() * 0.55;
    A.prints = [];
    for (let d = 0; d < 5; d++) {
      const table = PRINT_TYPES.map(t => ({
        v: t.v,
        w: t.w * (t.v === 'whorl' || t.v === 'doubleLoop' ? 1 + whorlBias * 3 : 1)
      }));
      A.prints.push({
        type: rng.weighted(table),
        // ridge count / density and the position of the core and delta
        density: rng.gaussIn(1.0, 0.13, 0.72, 1.32),
        coreY: rng.gaussIn(0.0, 0.14, -0.32, 0.32),
        coreS: rng.gaussIn(0.58, 0.06, 0.44, 0.74),
        deltaSide: rng.chance(0.5) ? 1 : -1,
        swirl: rng.sym(0.5),
        broken: rng.range(0.04, 0.16)   // fraction of ridge endings/bifurcations
      });
    }
    // ulnar loops open toward the little finger; radial toward the thumb
    for (let d = 0; d < 5; d++) {
      const p = A.prints[d];
      if (p.type === 'ulnarLoop') p.deltaSide = A.chirality;
      if (p.type === 'radialLoop') p.deltaSide = -A.chirality;
    }

    // ---- dorsal detail -----------------------------------------------------
    A.veins = {
      strength: rng.gaussIn(1.0, 0.30, 0.15, 1.85),
      branchProb: rng.range(0.42, 0.78),
      caliber: rng.gaussIn(1.0, 0.18, 0.6, 1.5),
      meander: rng.range(0.4, 1.5),
      trunks: rng.int(2, 4)
    };
    A.hair = {
      density: Math.max(0, rng.gaussIn(0.55, 0.42, 0, 1.6)),
      length: rng.gaussIn(1.0, 0.22, 0.5, 1.6),
      lean: rng.sym(0.55)
    };
    A.knuckles = {
      prominence: rng.gaussIn(1.0, 0.17, 0.6, 1.5),
      wrinkleRows: rng.int(3, 6),
      dimple: rng.chance(0.55)
    };
    A.tendons = {
      prominence: rng.gaussIn(1.0, 0.28, 0.35, 1.7)
    };

    // ---- knuckle / joint bulge ---------------------------------------------
    A.condyle = rng.gaussIn(1.0, 0.12, 0.72, 1.34);
    // fingertip pulp overhang past the end of the distal phalanx
    A.pulp = rng.gaussIn(1.0, 0.13, 0.7, 1.35);

    A.limits = LIMITS;
    return A;
  }

  // ------------------------------------------------------ cross-section shape
  /**
   * Half-breadth (a, along the mediolateral axis) and half-depth (b, along the
   * dorsopalmar axis) at parameter s of segment `seg` of digit `d`. s runs
   * 0..1 over the bone and beyond 1 into the fingertip dome.
   *
   * A third and fourth value, when present, displace the cross-section's
   * CENTRE off the bone axis (medio-lateral, dorso-palmar) without changing
   * a/b. Every digit is centred (0,0) except the thumb's metacarpal, whose
   * flesh is not a tube around the bone: the thenar muscles sit palmar and
   * radial to it, and its dorsal aspect is subcutaneous bone you can feel
   * through the skin. Centring that mass on the bone draws a sausage; the
   * offset is what makes it read as a hand's thenar instead.
   */
  // The thenar's swell, and how hard the compounded variation behind it is
  // damped. Both fitted across three hundred seeds, not against one.
  const TH_SWELL = 0.70, TH_DAMP = 0.40;

  function segmentProfile(A, d, seg, s) {
    const bone = A.bones[d];
    const isThumb = d === THUMB;
    const nSeg = bone.lengths.length;
    const W = bone.breadth;
    const cond = A.condyle;

    if (seg === 0) {
      if (isThumb) {
        // The thumb's metacarpal is not buried: it is the thenar eminence,
        // a muscular mass that swells at mid-shaft and narrows to the knuckle.
        // The thenar's bulk is one biological quantity, and building it as a
        // product over-disperses it: the bone's breadth already carries the
        // hand's slenderness, and the eminence's own factor and the hand's
        // fleshiness then multiply on top. Three independent draws gave a
        // twofold spread of thenars across seeds - and muscle does not scale
        // one for one with the bone it sits on anyway. So take the whole
        // compounded deviation from nominal and damp it in log space, which
        // pulls both tails in without moving the middle, and set the swell so
        // a median hand lands mid-range instead of over the top of it.
        const nomW = NOMINAL_BREADTH[THUMB] * A.size;
        const dev = (W / nomW) * A.palm.thenar * A.palm.padding;
        const bulk = Math.pow(Math.max(0.2, dev), TH_DAMP);
        const a = nomW * bulk * M.profile(
          [[0, 1.95 * TH_SWELL], [0.26, 2.29 * TH_SWELL], [0.56, 2.18 * TH_SWELL],
           [0.82, 1.55 * TH_SWELL], [1, bone.jw[0]]], s);
        const b = a * lerp(0.70, 0.92, s);
        // The mass is not centred on the bone: abductor/flexor/opponens
        // pollicis brevis pile onto its palmar-radial side, while the dorsal
        // side is just skin over bone. Push the cross-section centre palmar
        // (positive dor) so the palmar half-thickness grows and the dorsal
        // half shrinks, tapering to zero by the knuckle where the thumb's
        // own column takes over and has to sit back on the bone axis again.
        const offD = -b * M.profile([[0, 0.32], [0.30, 0.46], [0.62, 0.40], [1, 0]], s);
        return [a, b, 0, offD];
      }
      // finger metacarpals are buried in the palm; only the head reads as form
      const a = W * lerp(1.18, bone.jw[0], s);
      return [a, a * 0.90];
    }

    // Interpolate along the continuous chain, waist the shaft, and add the
    // condylar swelling at whichever ends of this bone carry a joint.
    const i0 = seg - 1, i1 = seg;
    const w0 = bone.jw[i0], w1 = bone.jw[i1];
    const b0 = bone.jb[i0] * cond, b1 = bone.jb[i1] * cond;
    const sc = clamp(s, 0, 1);
    let w = lerp(w0, w1, sc) * (1 - 0.075 * Math.sin(Math.PI * sc));
    const eIn = Math.max(0, 1 - sc / 0.34), eOut = Math.max(0, (sc - 0.66) / 0.34);
    w += b0 * eIn * eIn + b1 * eOut * eOut;

    const isLast = seg === nSeg - 1;
    let a = W * w;
    let bDepth = a * lerp(bone.jd[i0], bone.jd[i1], sc);
    if (isLast) {
      // the distal phalanx widens for the pulp before the tuft narrows, and
      // the pad stands proud further than it spreads
      a *= M.profile([[0, 1], [0.30, 0.985], [0.62, 1.035], [0.88, 1.005], [1, 0.96]], sc);
      bDepth *= M.profile([[0, 1], [0.28, 1.01], [0.60, 1.0 + 0.14 * A.pulp], [0.88, 1.0 + 0.08 * A.pulp], [1, 0.97]], sc);
    }

    if (isLast && s > 1) {
      // rounded fingertip: a quarter-ellipse closing of the generalised tube
      const u = clamp((s - 1) / tipExtent(A, d), 0, 1);
      const k = Math.sqrt(Math.max(0, 1 - u * u));
      a *= k; bDepth *= k;
    }
    return [a, bDepth];
  }

  /** how far past the end of the distal phalanx the pulp dome extends, in s units */
  function tipExtent(A, d) {
    const bone = A.bones[d];
    const distLen = bone.lengths[bone.lengths.length - 1];
    return (bone.breadth * bone.jw[bone.jw.length - 1] * 0.92 * A.pulp) / distLen;
  }

  /**
   * The web line: at surface angle alpha (0 = ulnar side, +pi/2 = dorsal,
   * -pi/2 = palmar) the finger's surface begins at this value of s on the
   * proximal phalanx. Palmar web is high, dorsal web is at the knuckle.
   */
  function webStart(A, d, alpha) {
    if (d === THUMB) return 0;
    const palmarness = 0.5 - 0.5 * Math.sin(alpha);   // 1 at palmar, 0 at dorsal
    const radialWeb = A.web[d - 1];
    // the little finger has no web on its ulnar side: its border runs free
    const ulnarWeb = d < 4 ? A.web[d] : 0.02;
    const ulnarness = 0.5 + 0.5 * Math.cos(alpha);    // 1 on the ulnar side
    const h = lerp(radialWeb, ulnarWeb, ulnarness);
    return h * M.smoothstep(palmarness * 1.25) * 0.98;
  }

  GK.anatomy = {
    THUMB, INDEX, MIDDLE, RING, LITTLE, DIGIT_NAMES,
    NOMINAL, LIMITS, PRINT_TYPES, CMC_BASE,
    buildAnatomy, segmentProfile, tipExtent, webStart
  };
})(window.GK = window.GK || {});
