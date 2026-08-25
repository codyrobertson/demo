/* ============================================================================
   GRAPHITE KINEMATICS — 30 · pose
   The manifold of reachable hands. Every pose is expressed in normalised
   units (-1 = full extension, +1 = full flexion) and converted through the
   measured joint envelopes, so no sample can ever leave the possible.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const { DEG, clamp, clamp01, lerp, smoothstep, Rng } = M;

  const FINGERS = [1, 2, 3, 4];

  /** normalised -1..1 -> radians, using the separate flexion/extension limits */
  function nr(lim, x, key) {
    const flex = (lim[key] || 0) * DEG;
    const ext = (lim[(key === 'flex' ? 'ext' : key === 'abd' ? 'add' : 'ext')] || 0) * DEG;
    return x >= 0 ? x * flex : x * ext;
  }
  function sym(limDeg, x) { return x * limDeg * DEG; }

  // ------------------------------------------------------------ empty pose
  function blank() {
    return {
      wrist: { flex: 0, dev: 0, pron: 0 },
      arch: 0,
      digits: [
        { cmcRad: 0, cmcAbd: 0, cmcOpp: 0, mcpFlex: 0, mcpAbd: 0, ipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 },
        { cmcFlex: 0, mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 }
      ]
    };
  }

  /**
   * Build a pose from a compact normalised spec.
   *   wrist   [flex, dev, pron]      -1..1
   *   arch    0..1
   *   thumb   [cmcRad, cmcAbd, cmcOpp, mcp, ip]
   *   f       [[mcp, pip, dip, abd], x4]   index..little
   */
  function mk(A, spec) {
    const L = A.limits;
    const p = blank();
    const w = spec.wrist || [0, 0, 0];
    p.wrist.flex = w[0] >= 0 ? w[0] * L.wrist.flex * DEG : w[0] * L.wrist.ext * DEG;
    p.wrist.dev = w[1] >= 0 ? w[1] * L.wrist.ulnar * DEG : w[1] * L.wrist.radial * DEG;
    p.wrist.pron = sym(L.wrist.pron, w[2] || 0);
    p.arch = clamp01(spec.arch || 0);

    const t = spec.thumb || [0, 0, 0, 0, 0];
    const TL = L.digits[0];
    p.digits[0].cmcRad = t[0] >= 0 ? t[0] * TL.cmc.flex * DEG : t[0] * TL.cmc.ext * DEG;
    p.digits[0].cmcAbd = t[1] >= 0 ? t[1] * TL.cmc.abd * DEG : t[1] * TL.cmc.add * DEG;
    p.digits[0].cmcOpp = t[2] >= 0 ? t[2] * TL.cmc.opp * DEG : t[2] * TL.cmc.rep * DEG;
    p.digits[0].mcpFlex = t[3] >= 0 ? t[3] * TL.mcp.flex * DEG : t[3] * TL.mcp.ext * DEG;
    p.digits[0].ipFlex = t[4] >= 0 ? t[4] * TL.ip.flex * DEG : t[4] * TL.ip.ext * DEG;

    const f = spec.f || [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < 4; i++) {
      const d = i + 1, DL = L.digits[d], v = f[i] || [0, 0, 0, 0];
      p.digits[d].mcpFlex = v[0] >= 0 ? v[0] * DL.mcp.flex * DEG : v[0] * DL.mcp.ext * DEG;
      p.digits[d].pipFlex = v[1] >= 0 ? v[1] * DL.pip.flex * DEG : v[1] * DL.pip.ext * DEG;
      p.digits[d].dipFlex = v[2] >= 0 ? v[2] * DL.dip.flex * DEG : v[2] * DL.dip.ext * DEG;
      // abduction is signed away from the middle finger
      const away = d === 1 ? -1 : d === 2 ? -0.35 : d === 3 ? 0.55 : 1;
      p.digits[d].mcpAbd = (v[3] || 0) * DL.mcp.abd * DEG * away;
      p.digits[d].cmcFlex = 0;
    }
    return p;
  }

  /**
   * The inverse of mk(): recover the normalised spec from a pose in radians,
   * so a pose arrived at any way at all can be handed back to the sliders.
   */
  function specOf(A, pose) {
    const L = A.limits;
    const un = (v, flexDeg, extDeg) => {
      if (v >= 0) return flexDeg > 0 ? clamp(v / (flexDeg * DEG), -1, 1) : 0;
      return extDeg > 0 ? clamp(v / (extDeg * DEG), -1, 1) : 0;
    };
    const spec = { wrist: [], arch: clamp01(pose.arch || 0), thumb: [], f: [] };
    spec.wrist[0] = un(pose.wrist.flex, L.wrist.flex, L.wrist.ext);
    spec.wrist[1] = un(pose.wrist.dev, L.wrist.ulnar, L.wrist.radial);
    spec.wrist[2] = clamp(pose.wrist.pron / (L.wrist.pron * DEG), -1, 1);
    const T = pose.digits[0], TL = L.digits[0];
    spec.thumb = [
      un(T.cmcRad, TL.cmc.flex, TL.cmc.ext),
      un(T.cmcAbd, TL.cmc.abd, TL.cmc.add),
      un(T.cmcOpp, TL.cmc.opp, TL.cmc.rep),
      un(T.mcpFlex, TL.mcp.flex, TL.mcp.ext),
      un(T.ipFlex, TL.ip.flex, TL.ip.ext)
    ];
    for (let d = 1; d < 5; d++) {
      const v = pose.digits[d], DL = L.digits[d];
      const away = d === 1 ? -1 : d === 2 ? -0.35 : d === 3 ? 0.55 : 1;
      // abduction is gated by flexion on the way in; undo that first
      const gate = 1 - 0.88 * smoothstep(clamp01(Math.max(0, v.mcpFlex) / (78 * DEG)));
      spec.f.push([
        un(v.mcpFlex, DL.mcp.flex, DL.mcp.ext),
        un(v.pipFlex, DL.pip.flex, DL.pip.ext),
        un(v.dipFlex, DL.dip.flex, DL.dip.ext),
        clamp(v.mcpAbd / (DL.mcp.abd * DEG * away * (gate > 0.05 ? 1 : 1)), -1, 1)
      ]);
    }
    return spec;
  }

  /** hard-clamp any pose back inside the envelope */
  function clampPose(A, pose) {
    const L = A.limits;
    const p = JSON.parse(JSON.stringify(pose));
    p.wrist.flex = clamp(p.wrist.flex, -L.wrist.ext * DEG, L.wrist.flex * DEG);
    p.wrist.dev = clamp(p.wrist.dev, -L.wrist.radial * DEG, L.wrist.ulnar * DEG);
    p.wrist.pron = clamp(p.wrist.pron, -L.wrist.sup * DEG, L.wrist.pron * DEG);
    p.arch = clamp01(p.arch);
    const T = p.digits[0], TL = L.digits[0];
    T.cmcRad = clamp(T.cmcRad, -TL.cmc.ext * DEG, TL.cmc.flex * DEG);
    T.cmcAbd = clamp(T.cmcAbd, -TL.cmc.add * DEG, TL.cmc.abd * DEG);
    T.cmcOpp = clamp(T.cmcOpp, -TL.cmc.rep * DEG, TL.cmc.opp * DEG);
    T.mcpFlex = clamp(T.mcpFlex, -TL.mcp.ext * DEG, TL.mcp.flex * DEG);
    T.ipFlex = clamp(T.ipFlex, -TL.ip.ext * DEG, TL.ip.flex * DEG);
    for (let d = 1; d < 5; d++) {
      const v = p.digits[d], DL = L.digits[d];
      v.mcpFlex = clamp(v.mcpFlex, -DL.mcp.ext * DEG, DL.mcp.flex * DEG);
      v.pipFlex = clamp(v.pipFlex, -DL.pip.ext * DEG, DL.pip.flex * DEG);
      v.dipFlex = clamp(v.dipFlex, -DL.dip.ext * DEG, DL.dip.flex * DEG);
      v.mcpAbd = clamp(v.mcpAbd, -DL.mcp.abd * DEG, DL.mcp.abd * DEG);
      // the proximal interphalangeal joint cannot fully close against a
      // hyperextended knuckle: the long flexors run out of excursion
      const hyper = clamp01(-v.mcpFlex / (30 * DEG));
      v.pipFlex = Math.min(v.pipFlex, DL.pip.flex * DEG * (1 - 0.20 * hyper));
    }
    return p;
  }

  // =========================================================================
  //  PRESETS
  // =========================================================================
  const PRESETS = {
    'rest': {
      label: 'At rest',
      spec: {
        wrist: [0.06, 0.06, 0], arch: 0.28, thumb: [0.16, 0.20, 0.18, 0.16, 0.12],
        f: [[0.20, 0.36, 0.26, 0.10], [0.23, 0.42, 0.30, 0.02], [0.26, 0.47, 0.33, -0.05], [0.30, 0.52, 0.36, 0.10]]
      }
    },
    'flat': {
      label: 'Flat',
      spec: { wrist: [0, 0, 0], arch: 0.02, thumb: [-0.25, 0.14, 0.05, 0, 0], f: [[0, 0, 0, 0.18], [0, 0, 0, 0.05], [0, 0, 0, 0.05], [0, 0, 0, 0.22]] }
    },
    'spread': {
      label: 'Spread',
      spec: { wrist: [-0.10, 0, 0], arch: 0, thumb: [-0.90, 0.22, -0.15, -0.20, -0.25], f: [[-0.15, -0.4, -0.5, 1], [-0.12, -0.4, -0.5, 1], [-0.12, -0.4, -0.5, 1], [-0.15, -0.4, -0.5, 1]] }
    },
    'fist': {
      label: 'Fist',
      spec: {
        wrist: [0.05, 0.10, 0], arch: 0.55, thumb: [0.66, 0.14, 0.50, 0.62, 0.52],
        f: [[0.94, 0.96, 0.78, -0.15], [0.96, 0.98, 0.80, -0.05], [0.96, 0.98, 0.80, 0.05], [0.96, 0.98, 0.80, 0.15]]
      }
    },
    'grip': {
      label: 'Cylinder grip',
      spec: {
        wrist: [0.02, 0.08, 0], arch: 0.48, thumb: [0.64, 0.20, 0.46, 0.58, 0.55],
        f: [[0.60, 0.66, 0.44, -0.10], [0.63, 0.70, 0.47, 0], [0.66, 0.73, 0.49, 0.05], [0.70, 0.76, 0.51, 0.12]]
      }
    },
    // The thumb chains below were fitted by inverse kinematics: the pads are
    // brought into contact and each is turned to face the other, then pulled
    // back toward the gesture that was asked for.
    'pinch': {
      label: 'Pinch',
      spec: {
        wrist: [0, 0, 0], arch: 0.36, thumb: [0.70, 0.35, 0.61, 0.22, -0.02],
        f: [[0.49, 0.42, 0.24, -0.25], [0.62, 0.70, 0.48, 0], [0.72, 0.82, 0.56, 0.05], [0.78, 0.86, 0.58, 0.10]]
      }
    },
    'ok': {
      label: 'OK',
      spec: {
        wrist: [-0.05, 0, 0], arch: 0.22, thumb: [0.83, 0.43, 0.78, 0.14, 0.00],
        f: [[0.70, 0.22, 0.13, -0.30], [-0.10, -0.15, -0.25, 0.30], [-0.10, -0.20, -0.30, 0.35], [-0.05, -0.20, -0.30, 0.55]]
      }
    },
    'point': {
      label: 'Point',
      spec: {
        wrist: [0, -0.10, 0], arch: 0.40, thumb: [0.34, 0.16, 0.30, 0.44, 0.20],
        f: [[-0.12, -0.10, -0.20, -0.15], [0.94, 0.97, 0.76, 0], [0.94, 0.97, 0.76, 0.05], [0.92, 0.96, 0.74, 0.10]]
      }
    },
    'peace': {
      label: 'Two',
      spec: {
        wrist: [-0.05, 0, 0], arch: 0.34, thumb: [0.44, 0.14, 0.36, 0.52, 0.34],
        f: [[-0.10, -0.10, -0.20, 0.85], [-0.08, -0.10, -0.20, 0.85], [0.92, 0.96, 0.74, 0], [0.92, 0.96, 0.74, 0.10]]
      }
    },
    'thumbsUp': {
      label: 'Thumb up',
      spec: {
        wrist: [0, 0.12, -0.35], arch: 0.52, thumb: [-0.72, 0.34, -0.55, -0.18, -0.35],
        f: [[0.94, 0.97, 0.78, -0.10], [0.95, 0.98, 0.79, 0], [0.95, 0.98, 0.79, 0.05], [0.95, 0.98, 0.79, 0.10]]
      }
    },
    'claw': {
      label: 'Claw',
      spec: {
        wrist: [-0.20, 0, 0], arch: 0.30, thumb: [-0.55, 0.52, 0.15, -0.10, 0.55],
        f: [[-0.34, 0.86, 0.68, 0.55], [-0.32, 0.88, 0.70, 0.20], [-0.32, 0.88, 0.70, 0.25], [-0.34, 0.86, 0.68, 0.60]]
      }
    },
    'cup': {
      label: 'Cup',
      spec: {
        wrist: [0.10, 0, 0], arch: 0.78, thumb: [0.30, 0.66, 0.54, 0.24, 0.10],
        f: [[0.30, 0.34, 0.22, -0.45], [0.32, 0.36, 0.24, -0.20], [0.34, 0.40, 0.26, -0.20], [0.38, 0.46, 0.30, -0.40]]
      }
    },
    'tripod': {
      label: 'Writing grip',
      spec: {
        wrist: [0.06, 0.14, 0], arch: 0.46, thumb: [0.79, 0.46, 0.51, 0.30, -0.09],
        f: [[0.44, 0.40, 0.20, -0.20], [0.58, 0.49, 0.09, 0], [0.72, 0.84, 0.56, 0.10], [0.80, 0.90, 0.60, 0.18]]
      }
    },
    'hook': {
      label: 'Hook',
      spec: {
        wrist: [-0.10, 0, 0], arch: 0.30, thumb: [-0.62, 0.24, 0.00, -0.10, -0.20],
        f: [[0.05, 0.94, 0.80, -0.05], [0.05, 0.96, 0.82, 0], [0.05, 0.96, 0.82, 0.05], [0.05, 0.94, 0.80, 0.10]]
      }
    },
    'wave': {
      label: 'Open, palm out',
      spec: {
        wrist: [-0.35, 0, 1.0], arch: 0.10, thumb: [-0.78, 0.30, -0.05, -0.10, -0.15],
        f: [[-0.20, -0.10, -0.20, 0.55], [-0.18, -0.10, -0.20, 0.20], [-0.18, -0.10, -0.20, 0.25], [-0.20, -0.10, -0.20, 0.60]]
      }
    },
    'countThree': {
      label: 'Three',
      spec: {
        wrist: [0, 0, 0], arch: 0.30, thumb: [-0.80, 0.28, -0.10, -0.10, -0.20],
        f: [[-0.10, -0.10, -0.20, 0.70], [-0.08, -0.10, -0.20, 0.30], [0.90, 0.95, 0.72, 0.05], [0.92, 0.96, 0.74, 0.10]]
      }
    },
    'hyperextend': {
      label: 'Hyperextended',
      spec: {
        wrist: [-0.60, 0, 0], arch: 0, thumb: [-0.95, 0.30, -0.85, -0.60, -0.90],
        f: [[-0.95, -0.9, -0.95, 0.45], [-0.95, -0.9, -0.95, 0.15], [-0.95, -0.9, -0.95, 0.20], [-0.95, -0.9, -0.95, 0.50]]
      }
    },
    'clenchMax': {
      label: 'Full flexion',
      spec: {
        wrist: [0.55, 0.20, 0], arch: 0.85, thumb: [0.95, 0.05, 0.55, 0.95, 0.90],
        f: [[1, 1, 1, -0.2], [1, 1, 1, -0.05], [1, 1, 1, 0.05], [1, 1, 1, 0.2]]
      }
    }
  };
  const PRESET_KEYS = Object.keys(PRESETS);

  function preset(A, key) {
    const P = PRESETS[key] || PRESETS.rest;
    return clampPose(A, mk(A, P.spec));
  }

  // =========================================================================
  //  COUPLING — the tendons the fingers share
  // =========================================================================
  function couple(A, spec, amount) {
    amount = amount === undefined ? 1 : amount;
    const f = spec.f;
    const out = f.map(v => v.slice());
    // juncturae tendinum: neighbouring knuckles are dragged along
    const K = [[0, 1, 0.10], [1, 0, 0.10], [1, 2, 0.20], [2, 1, 0.20], [2, 3, 0.30], [3, 2, 0.34]];
    for (const [a, b, k] of K) out[a][0] += (f[b][0] - f[a][0]) * k * amount;
    // the two-thirds rule: the distal joint follows the middle one
    for (let i = 0; i < 4; i++) {
      out[i][2] = lerp(out[i][2], out[i][1] * 0.66, 0.72 * amount);
    }
    // quadriga: the little finger cannot lag far behind the ring
    out[3][1] = lerp(out[3][1], Math.max(out[3][1], out[2][1] * 0.82), 0.5 * amount);
    // spreading closes down as the knuckles flex
    for (let i = 0; i < 4; i++) out[i][3] *= 1 - 0.55 * clamp01(out[i][0]) * amount;
    return out;
  }

  // =========================================================================
  //  GENERATIVE SAMPLING
  //  entropy 0 -> a named intention, barely perturbed
  //  entropy 1 -> a free walk of the manifold
  // =========================================================================
  function generate(A, seed, entropy) {
    const rng = new Rng(seed);
    entropy = clamp01(entropy === undefined ? 0.55 : entropy);

    // ---- an intention to depart from --------------------------------------
    const key = rng.pick(PRESET_KEYS);
    const base = PRESETS[key].spec;
    const jitter = 0.12 + 0.55 * entropy;

    // ---- a free sample of the manifold ------------------------------------
    const curl = rng.f();                       // how closed the hand is
    const splay = rng.gaussIn(0.2, 0.5, -1, 1); // how spread
    const cascade = rng.range(-0.25, 0.45);     // ulnar-ward increase in curl
    const free = { wrist: [], arch: 0, thumb: [], f: [] };
    free.wrist = [
      rng.gaussIn(0, 0.34, -0.9, 0.9),
      rng.gaussIn(0.05, 0.3, -0.9, 0.9),
      rng.gaussIn(0, 0.55, -1, 1)
    ];
    free.arch = clamp01(curl * 0.6 + rng.gaussIn(0.15, 0.25, -0.3, 0.8));
    free.thumb = [
      rng.gaussIn(curl * 0.55 - 0.1, 0.42, -1, 1),
      rng.gaussIn(0.35 - curl * 0.25, 0.32, -0.2, 1),
      rng.gaussIn(curl * 0.5, 0.35, -0.6, 1),
      rng.gaussIn(curl * 0.6, 0.3, -0.6, 1),
      rng.gaussIn(curl * 0.55, 0.32, -0.9, 1)
    ];
    for (let i = 0; i < 4; i++) {
      const local = clamp(curl + cascade * (i / 3 - 0.5) * 2 + rng.gaussIn(0, 0.18 * (0.4 + entropy), -0.6, 0.6), -0.9, 1);
      const mcp = clamp(local * 0.92 + rng.gaussIn(0, 0.13, -0.4, 0.4), -0.95, 1);
      const pip = clamp(local * 1.04 + rng.gaussIn(0.03, 0.15, -0.4, 0.4), -0.9, 1);
      const dip = clamp(pip * 0.66 + rng.gaussIn(0, 0.12, -0.35, 0.35), -0.95, 1);
      const away = clamp(splay + rng.gaussIn(0, 0.28, -0.7, 0.7), -1, 1);
      free.f.push([mcp, pip, dip, away]);
    }

    // ---- blend intention with freedom -------------------------------------
    const w = entropy;
    const spec = {
      wrist: (base.wrist || [0, 0, 0]).map((v, i) => lerp(v, free.wrist[i], w) + rng.sym(0.06 * jitter)),
      arch: lerp(base.arch || 0, free.arch, w) + rng.sym(0.08 * jitter),
      thumb: (base.thumb || [0, 0, 0, 0, 0]).map((v, i) => lerp(v, free.thumb[i], w) + rng.sym(0.10 * jitter)),
      f: (base.f || [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])
        .map((v, i) => v.map((x, j) => lerp(x, free.f[i][j], w) + rng.sym(0.09 * jitter)))
    };
    spec.f = couple(A, spec, 0.55 + 0.45 * (1 - entropy));
    for (let i = 0; i < 3; i++) spec.wrist[i] = clamp(spec.wrist[i], -1, 1);
    for (let i = 0; i < 5; i++) spec.thumb[i] = clamp(spec.thumb[i], -1, 1);
    spec.arch = clamp01(spec.arch);
    spec.f = spec.f.map(v => v.map(x => clamp(x, -1, 1)));
    const p = clampPose(A, mk(A, spec));
    p.intent = key;
    p.spec = spec;
    return p;
  }

  // =========================================================================
  //  INTERPOLATION & ANIMATION
  // =========================================================================
  function lerpPose(a, b, t) {
    const e = M.ease.inOut(clamp01(t));
    const p = blank();
    p.wrist.flex = lerp(a.wrist.flex, b.wrist.flex, e);
    p.wrist.dev = lerp(a.wrist.dev, b.wrist.dev, e);
    p.wrist.pron = lerp(a.wrist.pron, b.wrist.pron, e);
    p.arch = lerp(a.arch, b.arch, e);
    for (let d = 0; d < 5; d++) {
      const A0 = a.digits[d], B0 = b.digits[d], P = p.digits[d];
      for (const k in P) if (typeof P[k] === 'number') P[k] = lerp(A0[k] || 0, B0[k] || 0, e);
    }
    return p;
  }

  /** the full degree-of-freedom inventory, in the order a tour visits them */
  function dofList(A) {
    const L = A.limits;
    const out = [
      { path: ['wrist', 'flex'], label: 'wrist flexion / extension', lo: -L.wrist.ext, hi: L.wrist.flex },
      { path: ['wrist', 'dev'], label: 'wrist radial / ulnar deviation', lo: -L.wrist.radial, hi: L.wrist.ulnar },
      { path: ['wrist', 'pron'], label: 'forearm pronation / supination', lo: -L.wrist.sup, hi: L.wrist.pron },
      { path: ['arch'], label: 'transverse metacarpal arch', lo: 0, hi: 1, unit: '' },
      { path: ['digits', 0, 'cmcRad'], label: 'thumb CMC flexion / extension', lo: -L.digits[0].cmc.ext, hi: L.digits[0].cmc.flex },
      { path: ['digits', 0, 'cmcAbd'], label: 'thumb CMC palmar abduction', lo: -L.digits[0].cmc.add, hi: L.digits[0].cmc.abd },
      { path: ['digits', 0, 'cmcOpp'], label: 'thumb opposition', lo: -L.digits[0].cmc.rep, hi: L.digits[0].cmc.opp },
      { path: ['digits', 0, 'mcpFlex'], label: 'thumb MCP flexion', lo: -L.digits[0].mcp.ext, hi: L.digits[0].mcp.flex },
      { path: ['digits', 0, 'ipFlex'], label: 'thumb IP flexion', lo: -L.digits[0].ip.ext, hi: L.digits[0].ip.flex }
    ];
    const names = ['', 'index', 'middle', 'ring', 'little'];
    for (let d = 1; d < 5; d++) {
      const DL = L.digits[d];
      out.push({ path: ['digits', d, 'mcpFlex'], label: names[d] + ' MCP flexion', lo: -DL.mcp.ext, hi: DL.mcp.flex });
      out.push({ path: ['digits', d, 'mcpAbd'], label: names[d] + ' MCP abduction', lo: -DL.mcp.abd, hi: DL.mcp.abd });
      out.push({ path: ['digits', d, 'pipFlex'], label: names[d] + ' PIP flexion', lo: -DL.pip.ext, hi: DL.pip.flex });
      out.push({ path: ['digits', d, 'dipFlex'], label: names[d] + ' DIP flexion', lo: -DL.dip.ext, hi: DL.dip.flex });
    }
    return out;
  }

  const getPath = (o, path) => path.reduce((a, k) => a[k], o);
  const setPath = (o, path, v) => { let a = o; for (let i = 0; i < path.length - 1; i++) a = a[path[i]]; a[path[path.length - 1]] = v; };

  /**
   * A tour of the whole range of motion: each degree of freedom in turn is
   * carried from one end of its envelope to the other and back, against a
   * resting hand.
   */
  function romTour(A, t, basePose) {
    const dofs = dofList(A);
    const base = basePose || preset(A, 'rest');
    const n = dofs.length;
    const ft = (t % 1 + 1) % 1;
    const idx = Math.floor(ft * n);
    const local = ft * n - idx;
    const dof = dofs[idx];
    const p = JSON.parse(JSON.stringify(base));
    // ease out to the extremes and back through the rest value
    const tri = local < 0.5 ? local * 2 : (1 - local) * 2;
    const phase = local < 0.5 ? 1 : -1;
    const amt = M.ease.inOut(tri);
    const target = (phase > 0 ? dof.hi : dof.lo) * (dof.unit === '' ? 1 : DEG);
    const cur = getPath(p, dof.path);
    setPath(p, dof.path, lerp(cur, target, amt));
    const out = clampPose(A, p);
    out.active = dof;
    out.activeValue = getPath(out, dof.path);
    out.tourIndex = idx; out.tourCount = n;
    return out;
  }

  /** a small idle motion, so a still hand is never quite still */
  function breathe(A, pose, t, amount) {
    if (!amount) return pose;
    const n = new M.Noise(A.seed ^ 0x9911);
    const p = JSON.parse(JSON.stringify(pose));
    const k = amount * 0.055;
    p.wrist.flex += (n.n1(t * 0.31) - 0.5) * k * 2;
    p.wrist.dev += (n.n1(t * 0.27 + 8) - 0.5) * k * 1.4;
    for (let d = 0; d < 5; d++) {
      const P = p.digits[d];
      const o = d * 13.7;
      if (d === 0) {
        P.cmcRad += (n.n1(t * 0.33 + o) - 0.5) * k * 1.6;
        P.mcpFlex += (n.n1(t * 0.41 + o + 3) - 0.5) * k * 1.2;
        P.ipFlex += (n.n1(t * 0.37 + o + 6) - 0.5) * k * 1.2;
      } else {
        P.mcpFlex += (n.n1(t * 0.29 + o) - 0.5) * k * 1.5;
        P.pipFlex += (n.n1(t * 0.35 + o + 4) - 0.5) * k * 1.8;
        P.dipFlex += (n.n1(t * 0.39 + o + 9) - 0.5) * k * 1.3;
        P.mcpAbd += (n.n1(t * 0.23 + o + 12) - 0.5) * k * 0.8;
      }
    }
    return clampPose(A, p);
  }

  /** human-readable angle table, for the annotation layer */
  function readout(A, pose) {
    const rows = [];
    const R = (x) => Math.round(x / DEG);
    rows.push(['wrist', 'flex ' + R(pose.wrist.flex) + '°  dev ' + R(pose.wrist.dev) + '°  pron ' + R(pose.wrist.pron) + '°']);
    rows.push(['thumb', 'CMC ' + R(pose.digits[0].cmcRad) + '/' + R(pose.digits[0].cmcAbd) + '/' + R(pose.digits[0].cmcOpp) +
      '  MCP ' + R(pose.digits[0].mcpFlex) + '  IP ' + R(pose.digits[0].ipFlex)]);
    const names = ['', 'index', 'middle', 'ring', 'little'];
    for (let d = 1; d < 5; d++) {
      const p = pose.digits[d];
      rows.push([names[d], 'MCP ' + R(p.mcpFlex) + '° (' + (p.mcpAbd >= 0 ? '+' : '') + R(p.mcpAbd) +
        ')  PIP ' + R(p.pipFlex) + '°  DIP ' + R(p.dipFlex) + '°']);
    }
    return rows;
  }


  // =========================================================================
  //  CONTACT
  //  A hand is not a linkage in free space: fingers meet each other and meet
  //  the palm, and where they meet, they stop. Without this a fist drives its
  //  fingertips ten millimetres through its own palm and the thumb passes
  //  clean through the index — the mechanism is right and the hand is
  //  impossible.
  //
  //  Contacts are resolved by a damped Jacobian-transpose relaxation: each
  //  penetration asks the joints proximal to it how much moving them would
  //  separate the pair, and every joint gives a share proportional to how much
  //  good it can do. Distal joints are weighted higher, because a hand meeting
  //  an obstruction gives at its fingertips before it gives at its knuckles.
  // =========================================================================

  /** the adjustable degrees of freedom of one digit, proximal to distal */
  function jointDofs(rig, pose, d) {
    const dg = rig.digits[d];
    const out = [];
    const push = (seg, j, axis, w, add) => {
      if (!axis) return;
      out.push({ seg, axis, O: j.P, w, add });
    };
    if (d === 0) {
      const c = dg.joints[0], m = dg.joints[1], i = dg.joints[2];
      push(0, c, c.axA, 0.55, x => pose.digits[0].cmcRad += x);
      push(0, c, c.axF, 0.55, x => pose.digits[0].cmcAbd += x);
      push(0, c, c.axT, 0.35, x => pose.digits[0].cmcOpp -= x);
      push(1, m, m.axF, 1.5, x => pose.digits[0].mcpFlex += x);
      push(2, i, i.axF, 2.4, x => pose.digits[0].ipFlex += x);
    } else {
      const m = dg.joints[1], pp = dg.joints[2], dd = dg.joints[3];
      // Splay is the stiffest thing a hand has: fingers pressed together stay
      // together and give at the joints instead. Letting abduction take the
      // correction turns every closed pose into a splayed one.
      push(1, m, m.axA, 0.035, x => pose.digits[d].mcpAbd += x / (m.abdScale || 1));
      push(1, m, m.axF, 0.55, x => pose.digits[d].mcpFlex += x);
      push(2, pp, pp.axF, 1.5, x => pose.digits[d].pipFlex += x);
      push(3, dd, dd.axF, 2.6, x => pose.digits[d].dipFlex += x);
    }
    return out;
  }

  /** coarse palmar surface samples: spine point, outward normal, thickness */
  function palmSamples(rig) {
    const R = GK.rig, A = rig.anatomy;
    const out = [];
    for (let i = 0; i <= 13; i++) {
      const u = lerp(-0.02, 1.01, i / 13);
      const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
      for (let j = 0; j <= 9; j++) {
        const v = lerp(lo + 0.06, hi - 0.06, j / 9);
        const sp = R.palmSpine(rig, u, v);
        // the palm's pad compresses under a fingertip; it is not a wall
        out.push({ P: sp.P, n: sp.n, t: R.palmThickPalmar(A, u, v) * 0.82 });
      }
    }
    return out;
  }

  function gatherContacts(A, rig, tol) {
    const AN2 = GK.anatomy;
    const segs = [];
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered) continue;
        const r = (AN2.segmentProfile(A, d, sg.seg, 0.2)[0] + AN2.segmentProfile(A, d, sg.seg, 0.8)[0]) * 0.5;
        segs.push({ d, seg: sg.seg, A: sg.A, B: sg.B, r, sg });
      }
    }
    const cs = [];
    // digit against digit
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j];
        if (a.d === b.d && Math.abs(a.seg - b.seg) <= 1) continue;
        if (a.d === 0 && b.d === 0) continue;
        const cc = M.closestSeg(a.A, a.B, b.A, b.B);
        // soft tissue may flatten a little where two digits press together
        const sameRow = a.d > 0 && b.d > 0;
        const pen = (a.r + b.r) * (sameRow ? 0.76 : 0.84) - cc.d;
        if (pen <= tol) continue;
        const n = M.vnorm(M.vsub(cc.P1, cc.P2));
        if (!isFinite(n[0])) continue;
        cs.push({ d: a.d, seg: a.seg, P: cc.P1, n, depth: pen * 0.5 });
        cs.push({ d: b.d, seg: b.seg, P: cc.P2, n: M.vmul(n, -1), depth: pen * 0.5 });
      }
    }
    // digit against palm
    const ps = palmSamples(rig);
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const n0 = dg.segs.length;
      for (const sg of dg.segs) {
        if (!sg.rendered || sg.seg < (d === 0 ? 1 : 2)) continue;
        const isLast = sg.seg === n0 - 1;
        const sList = isLast ? [0.35, 0.75, 1.0, sg.sMax * 0.94] : [0.4, 0.85];
        for (const sv of sList) {
          const C = M.vmad(sg.A, sg.t, sg.len * sv);
          const r = AN2.segmentProfile(A, d, sg.seg, Math.min(sv, 1))[1];
          let best = null;
          for (const q of ps) {
            const off = M.vdot(M.vsub(C, q.P), q.n);
            if (off < -6 || off > q.t + r) continue;
            const lat = M.vlen(M.vsub(M.vsub(C, q.P), M.vmul(q.n, off)));
            if (lat > 11) continue;
            const pen = q.t + r - off;
            if (pen > tol && (!best || pen > best.depth)) best = { d, seg: sg.seg, P: C, n: q.n, depth: pen };
          }
          if (best) cs.push(best);
        }
      }
    }
    return cs;
  }

  function applyContacts(A, pose, rig, cs, lambda) {
    for (const c of cs) {
      const dofs = jointDofs(rig, pose, c.d).filter(x => x.seg <= c.seg);
      if (!dofs.length) continue;
      const g = new Array(dofs.length);
      let sum = 0;
      for (let i = 0; i < dofs.length; i++) {
        const x = dofs[i];
        g[i] = M.vdot(M.vcross(x.axis, M.vsub(c.P, x.O)), c.n);
        sum += x.w * g[i] * g[i];
      }
      if (sum < 1e-7) continue;
      const k = lambda * c.depth / sum;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(k * dofs[i].w * g[i]);
    }
  }

  /**
   * Settle a pose against its own contacts. Returns a corrected copy; the
   * deepest remaining penetration is reported on `.contactDepth`.
   */
  function resolveContacts(A, pose, opts) {
    opts = opts || {};
    const iters = opts.iters === undefined ? 20 : opts.iters;
    const tol = opts.tol === undefined ? 0.35 : opts.tol;
    const lambda = opts.lambda === undefined ? 0.72 : opts.lambda;
    const kappa = opts.kappa === undefined ? 0.065 : opts.kappa;
    const p0 = JSON.parse(JSON.stringify(pose));
    let p = JSON.parse(JSON.stringify(pose));
    let deepest = 0;
    for (let it = 0; it < iters; it++) {
      const rig = GK.rig.solve(A, p);
      const cs = gatherContacts(A, rig, tol);
      deepest = 0;
      for (const c of cs) deepest = Math.max(deepest, c.depth);
      if (!cs.length) break;
      applyContacts(A, p, rig, cs, lambda);
      // Every joint is sprung toward the pose that was asked for. The hand
      // settles where contact balances intent, which is what a hand does;
      // letting contact win outright turns a fist into a splayed claw.
      for (let d = 0; d < 5; d++) {
        const a = p.digits[d], b = p0.digits[d];
        for (const k in a) if (typeof a[k] === 'number') a[k] += (b[k] - a[k]) * kappa;
      }
      p = clampPose(A, p);
    }
    p.contactDepth = deepest;
    if (pose.active) p.active = pose.active;
    if (pose.intent) p.intent = pose.intent;
    if (pose.spec) p.spec = pose.spec;
    return p;
  }

  GK.pose = {
    blank, mk, clampPose, specOf, preset, PRESETS, PRESET_KEYS, couple, generate,
    resolveContacts, gatherContacts, jointDofs,
    lerpPose, dofList, romTour, breathe, readout, nr
  };
})(window.GK = window.GK || {});
