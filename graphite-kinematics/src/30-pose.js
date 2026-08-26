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
        wrist: [0.02, 0.08, 0], arch: 0.48, thumb: [0.57, 0.00, 0.54, 0.61, 0.76],
        f: [[0.60, 0.66, 0.44, -0.10], [0.63, 0.70, 0.47, 0], [0.66, 0.73, 0.49, 0.05], [0.70, 0.76, 0.51, 0.12]]
      }
    },
    // The thumb chains below were fitted by inverse kinematics: the pads are
    // brought into contact and each is turned to face the other, then pulled
    // back toward the gesture that was asked for.
    'pinch': {
      label: 'Pinch',
      spec: {
        wrist: [0, 0, 0], arch: 0.36, thumb: [0.54, 0.50, 0.94, 0.32, 0.20],
        f: [[0.57, 0.45, -0.01, -0.56], [0.62, 0.70, 0.48, 0], [0.72, 0.82, 0.56, 0.05], [0.78, 0.86, 0.58, 0.10]]
      }
    },
    'ok': {
      label: 'OK',
      spec: {
        wrist: [-0.05, 0, 0], arch: 0.22, thumb: [0.50, 0.47, 0.87, 0.32, 0.20],
        f: [[0.57, 0.43, -0.02, -0.64], [-0.10, -0.15, -0.25, 0.30], [-0.10, -0.20, -0.30, 0.35], [-0.05, -0.20, -0.30, 0.55]]
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
        wrist: [0, 0.12, -0.35], arch: 0.52, thumb: [0.40, -0.05, -0.35, -0.20, -0.30],
        f: [[0.94, 0.97, 0.78, -0.10], [0.95, 0.98, 0.79, 0], [0.95, 0.98, 0.79, 0.05], [0.95, 0.98, 0.79, 0.10]]
      }
    },
    'claw': {
      label: 'Claw',
      spec: {
        wrist: [-0.20, 0, 0], arch: 0.30, thumb: [-0.45, 0.32, 0.18, -0.05, 0.55],
        f: [[-0.34, 0.86, 0.68, 0.55], [-0.32, 0.88, 0.70, 0.20], [-0.32, 0.88, 0.70, 0.25], [-0.34, 0.86, 0.68, 0.60]]
      }
    },
    'cup': {
      label: 'Cup',
      spec: {
        wrist: [0.10, 0, 0], arch: 0.78, thumb: [0.35, 0.30, 0.50, 0.28, 0.12],
        f: [[0.30, 0.34, 0.22, -0.45], [0.32, 0.36, 0.24, -0.20], [0.34, 0.40, 0.26, -0.20], [0.38, 0.46, 0.30, -0.40]]
      }
    },
    'tripod': {
      label: 'Writing grip',
      spec: {
        wrist: [0.06, 0.14, 0], arch: 0.46, thumb: [0.57, 0.53, 0.75, 0.32, 0.20],
        f: [[0.44, 0.40, 0.20, -0.20], [0.67, 0.41, -0.01, 0.13], [0.72, 0.84, 0.56, 0.10], [0.80, 0.90, 0.60, 0.18]]
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
        wrist: [0, 0, 0], arch: 0.30, thumb: [-0.55, 0.10, 0.05, -0.20, -0.30],
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
        wrist: [0.55, 0.20, 0], arch: 0.85, thumb: [0.70, 0.05, 0.62, 0.85, 0.75],
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
    // The solver measures its correction in world space and writes it into a
    // pose field. Three of those fields — cmcRad, cmcOpp and mcpAbd — are the
    // ones solve() negates on a left hand, so writing a world-space step
    // straight in sends it back out reversed: the correction is applied in
    // the direction opposite to the one that was measured, and the contact it
    // was solving gets deeper instead of shallower. Undoing the mirror here
    // means the round trip is the identity (chirality squared is one) and the
    // solver goes on working in world terms without knowing which hand it is
    // on. Measured before this: a left clenchMax drifted 43.9mm from its
    // mirror and the grip simply did not close.
    const ch = rig.anatomy.chirality;
    if (d === 0) {
      const c = dg.joints[0], m = dg.joints[1], i = dg.joints[2];
      push(0, c, c.axA, 0.55, x => pose.digits[0].cmcRad += x * ch);
      push(0, c, c.axF, 0.55, x => pose.digits[0].cmcAbd += x);
      push(0, c, c.axT, 0.35, x => pose.digits[0].cmcOpp -= x * ch);
      push(1, m, m.axF, 1.5, x => pose.digits[0].mcpFlex += x);
      push(2, i, i.axF, 2.4, x => pose.digits[0].ipFlex += x);
    } else {
      const m = dg.joints[1], pp = dg.joints[2], dd = dg.joints[3];
      // Splay is the stiffest thing a hand has: fingers pressed together stay
      // together and give at the joints instead. Letting abduction take the
      // correction turns every closed pose into a splayed one.
      push(1, m, m.axA, 0.035, x => pose.digits[d].mcpAbd += x * ch / (m.abdScale || 1));
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
      // The thumb-side border now swings out to track the thumb itself (see
      // rig.js vLo), so its span is no longer fixed - a thumb pulled well
      // clear widens it a lot. Sample count has to keep pace or the far
      // (ulnar) side of the same fixed budget gets too sparse to hold the
      // little finger in contact resolution.
      const NJ = Math.max(9, Math.round(9 * (hi - lo) / 1.5));
      for (let j = 0; j <= NJ; j++) {
        const v = lerp(lo + 0.06, hi - 0.06, j / NJ);
        const sp = R.palmSpine(rig, u, v);
        // the palm's pad compresses under a fingertip; it is not a wall
        out.push({ P: sp.P, n: sp.n, t: R.palmThickPalmar(A, u, v) * 0.82 });
      }
    }
    return out;
  }

  function gatherContacts(A, rig, tol, scene) {
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
    if (scene && scene.ball) for (const c of ballContacts(A, rig, scene.ball, tol)) cs.push(c);
    return cs;
  }

  // The most any one contact may move any one joint in one iteration. This is
  // a trust region, not a damping constant: the step's DIRECTION is usually
  // right even where its length is nonsense, and twenty iterations of a
  // bounded step get to the same place as one unbounded one without ever
  // passing through the nonsense. Eight degrees is loose enough that a
  // maximal clench still resolves its own pads out of its palm inside the
  // iteration budget, and tight enough that the thirty-degree throw measured
  // below cannot happen.
  //
  // A fixed damping term was tried first and is the wrong shape. The step is
  // lambda * depth / sum(w g^2), and `w` is the joint's compliance - splay is
  // deliberately the stiffest thing the hand has, at 0.035 against flexion's
  // 0.55, so `sum` for a contact resolved by abduction is naturally small.
  // Damping keyed on `sum` therefore swamps exactly the contacts that keep
  // adjacent fingers out of each other: measured, four presets went from
  // clean to 37% interpenetration between the middle and ring.
  const CONTACT_STEP = 8.0 * DEG;

  /**
   * Push the hand out of its contacts, one Jacobian-transpose step.
   *
   * `g` is how fast the contact point moves along the contact normal per
   * radian of each joint, so the step is lambda * depth / sum(w g^2) - and
   * every g goes to zero together in exactly the case a hand meets most
   * often, a fingertip arriving square on a ball. Flexing the finger there
   * moves the tip ACROSS the contact normal rather than along it, so the hand
   * genuinely cannot push itself off that contact by bending, and the
   * unbounded step reads that as needing an enormous one.
   *
   * Measured before this: the ring finger touching a 26mm ball 0.3mm deep was
   * thrown thirty degrees back out of its own grip in a single iteration, and
   * because holdBall had latched it as arrived, it stayed there - the finger
   * finished 32mm off a ball it was supposed to be holding.
   */
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
      let biggest = 0;
      for (let i = 0; i < dofs.length; i++) {
        const step = Math.abs(k * dofs[i].w * g[i]);
        if (step > biggest) biggest = step;
      }
      const scale = biggest > CONTACT_STEP ? CONTACT_STEP / biggest : 1;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(k * dofs[i].w * g[i] * scale);
    }
  }

  // =========================================================================
  //  HOLDING SOMETHING
  // =========================================================================

  /**
   * Where a ball of a given radius sits when the hand closes on it: against
   * the palm, on the palm's own outward normal, a little way into the flesh
   * so the pads have something to press. Placed from the hand rather than
   * given, because a ball positioned by hand and a hand posed to hold it are
   * two ways of getting the same thing wrong.
   */
  function ballOnPalm(A, rig, radius) {
    const R = GK.rig;
    const sp = R.palmSurface(rig, 0.52, 0.22);
    const n = R.palmNormal(rig, 0.52, 0.22);
    // Not a fraction of the radius. Sinking the centre to 92% of the radius
    // buries a big ball proportionally deeper than a small one - at 38mm that
    // is three millimetres of palm, which puts the metacarpal heads inside the
    // sphere, and a proximal phalanx whose base rim is inside a ball cannot be
    // pushed out of it by bending: the rim sweeps about the joint, so rotating
    // only moves the penetration round. It has to be got right here.
    //
    // So the ball is lowered onto the hand instead: start clear, and settle it
    // until the deepest thing it touches is one soft-tissue allowance in. The
    // palm is what it lands on - the fingers are still open at this point,
    // which is the whole reason this runs before the hand closes.
    const ALLOW = 1.6;
    const deepest = (C) => {
      let pen = -1e9;
      for (let i = 0; i <= 16; i++) {
        const u = lerp(-0.05, 1.02, i / 16);
        for (let k = 0; k <= 12; k++) {
          const P = R.palmSurface(rig, u, (k / 12) * 0.5).P;
          const v = radius - M.vdist(P, C);
          if (v > pen) pen = v;
        }
      }
      return pen;
    };
    let t = radius + 8;
    for (let it = 0; it < 18; it++) {
      const step = deepest(M.vmad(sp.P, n, t)) - ALLOW;
      if (Math.abs(step) < 0.05) break;
      t += step * 0.75;
    }
    return { C: M.vmad(sp.P, n, t), r: radius };
  }

  /**
   * Where the hand meets a ball, measured on the surface rather than the axis.
   *
   * Taking the bone's axis and calling the segment a cylinder of one radius is
   * a fair test for a fingertip, whose section is nearly round, and a poor one
   * everywhere else: a proximal phalanx is a flattened ellipse, so the axis
   * test clears it while its palmar face is already several millimetres
   * inside the ball. Measured on a 38mm ball: the ring and little proximal
   * phalanges sat 3.7 and 5.5mm through a sphere the axis test called
   * untouched, which is a solid passing through a solid.
   *
   * So sample the surface, and keep the deepest point per segment - one
   * contact per segment, because a segment resting flat on a ball touches it
   * along a whole line and feeding twenty near-identical records to the
   * solver just multiplies the same correction by twenty.
   */
  function ballContacts(A, rig, ball, tol) {
    const AN2 = GK.anatomy;
    const cs = [];
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered) continue;
        // A finger's metacarpal lives inside the palm and the palm's own
        // contacts answer for it. The thumb's is thenar mass out on its own,
        // and a ball pressed into the first web meets it directly - untested,
        // it took 8.4mm of a 38mm ball straight through the ball of the thumb.
        if (sg.seg < 1 && d !== 0) continue;
        // cheap reject: could this segment reach the ball at all?
        const mid = GK.rig.sectionCenter(rig, d, sg.seg, (sg.sMin + sg.sMax) * 0.5);
        const pr = AN2.segmentProfile(A, d, sg.seg, 0.5);
        const reach = sg.len * 0.5 + Math.max(pr[0], pr[1]) + ball.r;
        if (M.vdist(mid, ball.C) > reach) continue;
        let best = null;
        for (let i = 0; i <= 6; i++) {
          const sv = lerp(sg.sMin, sg.sMax, i / 6);
          for (let k = 0; k < 10; k++) {
            const P = GK.rig.digitSurface(rig, d, sg.seg, sv, (k / 10) * Math.PI * 2).P;
            const away = M.vsub(P, ball.C);
            const dist = M.vlen(away);
            if (dist < 1e-6) continue;
            const pen = ball.r - dist;
            if (!best || pen > best.depth) {
              best = { d, seg: sg.seg, P, n: M.vmul(away, 1 / dist), depth: pen };
            }
          }
        }
        if (best && best.depth > tol) cs.push(best);
      }
    }
    return cs;
  }

  /**
   * Close the hand on a ball.
   *
   * Not by aiming the pads at it. Driving every tip onto the sphere's surface
   * lands them all on its equator, which is five fingers touching a circle
   * rather than a hand holding anything, and for a ball too big to wrap it
   * drives the proximal phalanges straight through it instead.
   *
   * A hand closes until it meets resistance, so this does too: flex everything
   * by a few degrees, settle against the ball and against itself, and stop
   * flexing whichever digits have arrived. Each finger then stops where the
   * ball is, not where it was told, and the same code holds a marble and a
   * grapefruit.
   */
  function holdBall(A, pose, radius, opts) {
    opts = opts || {};
    const R = GK.rig;
    let p = clampPose(A, JSON.parse(JSON.stringify(pose)));
    const ball = opts.ball || ballOnPalm(A, R.solve(A, p), radius);
    const scene = { ball };
    const rested = [false, false, false, false, false];
    const bestGap = [1e9, 1e9, 1e9, 1e9, 1e9];
    const bestAt = [null, null, null, null, null];
    const past = [0, 0, 0, 0, 0];
    // how near a digit has to have been before "it is going away again" is
    // evidence of anything
    const NEARLY = 6.0;
    let settled = 0;
    const STEPS = opts.steps === undefined ? 26 : opts.steps;
    const rate = opts.rate === undefined ? 0.13 : opts.rate;
    const shut = clampPose(A, mk(A, PRESETS[opts.toward || 'fist'].spec));
    for (let it = 0; it < STEPS; it++) {
      const rig = R.solve(A, p);
      // A digit has arrived when its LAST bone is resting on the ball. Any
      // contact at all is the wrong test: a proximal phalanx lying across a
      // big ball touches it from the first step, and stopping there leaves
      // the finger straight - it was never the part that was going to close.
      // A contact only counts once it is on the segment whose flexion would
      // otherwise still be carrying the tip inward.
      const onBall = {};
      for (const c of ballContacts(A, rig, ball, -0.4))
        if (c.seg >= rig.digits[c.d].segs.length - 1) onBall[c.d] = 1;
      // Arriving is not a one-way door. The contact solver runs between
      // closing steps and can push a digit that has just touched back off the
      // ball again; latched on first contact, that digit then stands there
      // for the remaining twenty iterations with its pad in mid-air, which is
      // what left the ring finger 32mm off a ball it was holding. So the test
      // is re-read every step, with enough hysteresis that a digit resting on
      // the surface does not chatter in and out of the closing schedule.
      //
      // And a digit stops at its closest approach whether it arrived or not.
      // On a small ball a long finger curls straight past it, and from there
      // every further degree of flexion takes the pad further away - so a
      // rule that only watches for contact never fires and the finger closes
      // into a fist beside a marble it was supposed to be holding. Measured:
      // the middle finger finished 13.6mm past a 16mm ball.
      //
      // But only once the digit has actually got near the thing. The contact
      // solver runs between closing steps and jostles every gap by a
      // millimetre or so, and read without that guard the rule fires on that
      // jostle: the ring finger, still 28mm out and closing perfectly well,
      // saw its gap tick upward twice and was frozen there for the rest of
      // the run. A finger cannot be past a ball it has never reached.
      for (let d = 0; d < 5; d++) {
        const dg = rig.digits[d];
        const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        const gap = M.vdist(dg.tip, ball.C) - ball.r - pad;
        if (gap < bestGap[d] - 0.05) {
          bestGap[d] = gap;
          bestAt[d] = JSON.parse(JSON.stringify(p.digits[d]));
          past[d] = 0;
        } else if (bestGap[d] < NEARLY && gap > bestGap[d] + 0.4 && ++past[d] >= 3 && !rested[d]) {
          // it has turned away from the ball twice running: put it back where
          // it was nearest and leave it there
          if (bestAt[d]) p.digits[d] = JSON.parse(JSON.stringify(bestAt[d]));
          rested[d] = true;
          continue;
        }
        if (onBall[d] || gap <= 0.4) rested[d] = true;
        else if (gap > 2.5) rested[d] = false;
      }
      // and since a digit can un-rest, only stop once the whole hand has
      // been resting for two steps together
      if (rested.every(Boolean)) { if (settled++) break; } else settled = 0;
      // Close along an authored trajectory rather than an invented one. Which
      // joints move, and in what proportion, is exactly what the grip preset
      // already encodes - it was fitted and then hand-corrected - and a
      // schedule guessed here instead got the fingers closing while the thumb
      // waved beside the ball, because the three motions that carry a thumb
      // onto something held do not divide evenly.
      for (let d = 0; d < 5; d++) {
        if (rested[d]) continue;
        const q = p.digits[d], t = shut.digits[d];
        for (const k in q) if (typeof q[k] === 'number') q[k] += (t[k] - q[k]) * rate;
      }
      // no spring while closing, or the hand pulls back out of its own grip
      p = resolveContacts(A, clampPose(A, p), { iters: 6, scene, kappa: 0 });
    }
    // The closing trajectory gets the fingers onto the ball and leaves the
    // thumb about a pad's width short, every size, because the authored grip
    // it is following was authored around fingers rather than around this
    // object. So finish the thumb by aiming it: the reach solver respects the
    // joint stops, so if the thumb genuinely cannot get there it stays where
    // it is rather than being forced.
    // ...and so does any digit the closing schedule left short. Flexing a
    // long finger onto a small ball sweeps its pad along an arc that can miss
    // the thing entirely - a hand closing on a marble flexes at the two
    // interphalangeal joints and hardly at the knuckle, which is not a
    // proportional close and is not what any single authored grip encodes.
    // The reach solver already knows how to put a pad somewhere; ask it.
    const short = [];
    {
      const rig = R.solve(A, p);
      for (let d = 0; d < 5; d++) {
        const dg = rig.digits[d];
        const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        if (M.vdist(dg.tip, ball.C) - ball.r - pad > 1.2) short.push(d);
      }
    }
    for (const d of (opts.aim || short)) {
      const rig = R.solve(A, p);
      const dg = rig.digits[d];
      const away = M.vsub(dg.tip, ball.C);
      const len = M.vlen(away);
      if (len < 1e-6) continue;
      const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
      const target = M.vmad(ball.C, M.vmul(away, 1 / len), ball.r + pad * 0.6);
      // The step this solver takes is small on purpose, so the iteration
      // count has to cover the whole swing. A thumb reaching round a 38mm
      // ball travels ninety degrees of opposition; given twenty iterations it
      // finished 29.6mm short, and given a hundred and twenty it finishes
      // 1.2mm short. It was never that the target could not be reached.
      p = reach(A, p, d, target, { iters: 120, kappa: 0.002 });
    }
    // Settle hard against the pose that was just aimed, because by this point
    // the aim IS the answer: the reach solver has put each pad on the ball,
    // and all this pass has left to do is take a couple of millimetres of
    // penetration out of it. Left slack, it does not polish - it re-solves.
    // A thumb 2.5mm into a 38mm ball was thrown to its own extension limit,
    // 43mm clear of the thing it was holding, because swinging the whole
    // digit away is a perfectly good way to remove a penetration and nothing
    // told it otherwise. Swept over ten seeds, two starting poses and three
    // radii, every digit's gap falls monotonically as this is tightened and
    // the penetration it buys back rises slowly: at 0.35 the worst pad gap
    // across the population is 15mm where it was 41mm, and penetration is
    // 0.2mm median, 2.6mm at the ninetieth.
    const out = resolveContacts(A, p, { iters: 40, scene, kappa: 0.350, drift: 0 });
    out.ball = ball;
    // Recomputed from the hand that came out, not carried over from the
    // closing loop. `rested` is the loop's own bookkeeping and it stops being
    // true the moment the aiming pass and the final settle move a digit -
    // reported as-is it says a finger is holding the ball while the finger is
    // measurably somewhere else, which is worse than saying nothing.
    {
      const fin = R.solve(A, out);
      out.held = [];
      out.holdGap = [];
      for (let d = 0; d < 5; d++) {
        const dg = fin.digits[d];
        const pad = GK.anatomy.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        const gap = M.vdist(dg.tip, ball.C) - ball.r - pad;
        out.holdGap[d] = gap;
        out.held[d] = gap <= 1.2;
      }
    }
    return out;
  }

  /**
   * A hand taking a ball and letting it go, as a function of one number.
   *
   * Returns a closure rather than a pose, because closing a hand on something
   * is a settle inside a settle and costs a couple of hundred milliseconds -
   * far too much to pay per frame. The grasp is worked out once; every frame
   * before release is an interpolation between fixed keyframes, which is also
   * why the closing reads as one motion instead of a series of separate
   * grips. But the closure is not purely a function of its argument the way
   * the rest of this file is: from the moment the fingers begin to open, the
   * ball is a live GK.physics body, and physics has a memory - what it does
   * next depends on what it was doing a moment ago, not just on "now". So
   * this closure carries that body forward call to call, and (like every
   * other stateful animation driver in this codebase - PH.step itself, or a
   * dragged fingertip in reach()) it is meant to be sampled with a
   * monotonically increasing argument, once per frame, the way every caller
   * in this file already does. A rewind is handled - it will not throw - but
   * it cannot un-happen a bounce, so scrubbing backward through a fall just
   * holds the ball at wherever it last got to rather than replaying physics
   * in reverse.
   *
   * The hand itself does not travel: there is no translation in the rig, and
   * faking one by sliding the ball into the palm looks like the ball doing
   * the work. So the lift is carried by the wrist, which is a real degree of
   * freedom - the whole hand swings up about a fixed wrist origin - and for
   * as long as the grip holds, the ball is carried rigidly with it: attached
   * to a fixed spot on the palm sheet, not frozen at a world-space point,
   * which is what a hand that lifts its grip while the held object stays
   * exactly where it was in space would mean. Once support is lost the ball
   * answers to nothing but gravity and whatever it touches on the way out.
   */
  function pickAndDrop(A, radius, opts) {
    opts = opts || {};
    const R = GK.rig;
    const openKey = opts.open || 'spread';
    const open = clampPose(A, mk(A, PRESETS[openKey].spec));
    const grip = holdBall(A, open, radius);
    const ball0 = grip.ball;
    // Gravity is anchored here, once, to the pose the hand is in BEFORE it
    // starts moving - not re-read at the moment of release. root rotates
    // rigidly with wrist flexion (see 35-physics.js's header), so anchoring
    // at release would let a hand that had already tilted while lifting the
    // ball redefine "down" to match its own tilt: gravity would always point
    // straight out of the palm no matter how the hand held it, which is the
    // wrist rotating the world rather than the world staying put. Anchored
    // here instead, a hand that lifts a ball at an angle can show the ball
    // pressing into a different part of the cupped palm as it tips - real
    // weight against a real contact - rather than that being erased by
    // gravity quietly following the hand around.
    const rig0 = R.solve(A, open);
    // `open` is posed with no notion of the ball at all, and while
    // ballOnPalm keeps it clear for most seeds and radii, it does not for
    // every one: measured across this file's own seed/radius sweep, the
    // largest ball size put the hand a couple of millimetres into its own
    // object before the hand had moved at all. So it is settled against the
    // ball once here, the same way holdBall settles its own final pose, and
    // this corrected copy - not the raw preset - is what idle and the start
    // of the close actually blend from. `open` itself stays untouched: it
    // is still what `grip` and the gravity frame above were built from, and
    // re-settling it here must not feed back into either.
    const openClear = resolveContacts(A, open, { scene: { ball: ball0 }, iters: 20, tol: 0.2 });

    // ==== TIMING ============================================================
    // Every field below is a FRACTION of the whole looping cycle (0..1), and
    // `seconds` is what turns fractions into the physics engine's own units -
    // the ball does not know or care how fast the caller is stepping `t`, it
    // only knows how many seconds of gravity it has been given, so this is
    // the number to change if a drop should feel heavier/slower or lighter/
    // quicker without touching a single physics constant.
    const T = Object.assign({
      start:    0.05, // idle at `open` ends here; the fingers start closing
      contact:  0.34, // the fingers have arrived on the ball; grip settled
      liftTop:  0.52, // the lift is complete: ball held up and steady
      release:  0.60, // the pause at the top ends; fingers begin opening
      clear:    0.76  // the KINEMATIC opening motion finishes here. This is
                       // a fallback deadline, not the release trigger - the
                       // physics contact solver almost always lets go
                       // earlier than this, on its own, the moment the
                       // fingers have actually opened clear of the ball, the
                       // same way simtest.js's "opening the hand releases
                       // the ball into a real fall" case works.
    }, opts.timing);
    // Real gravity (G_MAG in 35-physics.js) is not adjustable to taste, so
    // this is the number that actually controls how far the ball falls
    // before the cycle loops: 1.0s means the release-to-loop-end window
    // (1-T.release, about 0.4 of the cycle) is ~0.4s of real free fall,
    // which drops a ball on the order of the hand's own size before the
    // sequence resets - long enough to read as a real fall, short enough
    // that it has not left the frame's neighbourhood by the time it does.
    const SECONDS = opts.seconds === undefined ? 1.0 : opts.seconds; // whole-cycle physics duration
    const PHYS_STEP_CAP = 1 / 60;  // no single PH.step() call covers more than this much physics time,
                                    // regardless of how coarsely the caller samples `t` - see advancePhysics
    const LIFT_FLEX = 26 * DEG, LIFT_DEV = 7 * DEG;  // unchanged from the original: the wrist carries the lift
    const SETTLE_LIFT = 0.6;       // how much of the lift is still held once the hand has fully re-opened
    const ANCHOR_UV = [0.52, 0.22]; // the same palm spot ballOnPalm itself places a held ball against

    // Per-digit stagger for the close and the open, so the fingers do not
    // arrive (or let go) in lockstep. Every digit still lands EXACTLY on the
    // pose holdBall computed - this only changes how it gets there, never
    // where. The naive way to stagger five things is five different finish
    // times, but a digit that finishes early would have to stop dead against
    // whatever it is closing on before the window itself is over, and one
    // that starts late would have to leave zero velocity behind at a
    // boundary shared with an adjacent phase that is not itself moving -
    // both are the "abrupt start or stop" this whole file is trying to get
    // away from. So instead every digit gets the SAME ease.inOut - zero
    // velocity at both ends, guaranteed - just entered late: a digit with a
    // large delay sits exactly at its start value, genuinely motionless,
    // for that fraction of the window, then eases through the rest of it no
    // differently from a digit with no delay at all, arriving with the same
    // zero velocity every one of them does. The order - index and middle
    // move first, ring and little a little behind, the thumb last - is not
    // to taste: it is the order a real hand's digits actually arrive in
    // (and, reversed, let go in), because the thumb's opposition is a
    // compound CMC rotation plus flexion and is the slowest degree of
    // freedom a hand has, where the fingers close on a comparatively simple
    // hinge.
    const DIGIT_DELAY = [0.34, 0, 0, 0.12, 0.18];   // thumb, index, middle, ring, little
    function digitProgress(cta) { return DIGIT_DELAY.map(delay => M.ease.inOut(clamp01(M.inv(cta, delay, 1)))); }

    function copyDigits(pose) { return pose.digits.map(d => Object.assign({}, d)); }
    function blendDigits(a, b, tt) {
      return a.digits.map((da, d) => {
        const db = b.digits[d], e = Array.isArray(tt) ? tt[d] : tt, out = {};
        for (const k in da) out[k] = typeof da[k] === 'number' ? M.lerp(da[k], db[k], e) : da[k];
        return out;
      });
    }
    /** 0 before the grip forms, eases up to 1 across the lift, holds through
     *  the pause, eases back down to SETTLE_LIFT as the hand re-opens, and
     *  stays there through the fall - the wrist leading the fingers in the
     *  one place this rig can show it, since it is the only joint upstream
     *  of everything else: the fingers hold the grip they already have
     *  while the wrist alone carries the ball up, and later carries it back
     *  down partway, exactly the "wrist leads, fingers follow" a real lift
     *  shows, because on this rig the wrist is the only joint that CAN lead
     *  without also having to be the thing doing the holding. */
    function liftFrac(u) {
      if (u < T.contact) return 0;
      if (u < T.liftTop) return M.ease.inOut(M.inv(u, T.contact, T.liftTop));
      if (u < T.release) return 1;
      if (u < T.clear) return M.lerp(1, SETTLE_LIFT, M.ease.inOut(M.inv(u, T.release, T.clear)));
      return SETTLE_LIFT;
    }
    function wristFor(li) {
      // Every phase before contact and after clear holds `open`'s own
      // wrist value (grip's wrist is open's wrist too - holdBall never
      // touches it), so the wrist has exactly one motion in this whole
      // sequence: the lift, and liftFrac already carries its own easing.
      return { flex: open.wrist.flex + li * LIFT_FLEX, dev: open.wrist.dev + li * LIFT_DEV, pron: open.wrist.pron };
    }

    // ==== THE BALL, ATTACHED ================================================
    // Where a held ball sits, expressed as a fixed offset off a fixed spot on
    // the palm sheet, so re-evaluating it against a rotated (lifted) rig
    // carries the ball rigidly with the palm instead of leaving it stranded
    // at a world-space point while the hand swings up and away from it.
    //
    // The offset is a full 3-D vector in the palm's own local frame at that
    // spot - the surface normal and two tangents built from it - not a
    // single distance along the normal alone. A single scalar only
    // reproduces ball0.C if ball0.C happens to sit exactly on that one
    // normal line, which it does for the rig it was actually placed
    // against and essentially never does for any other: measured, that
    // version of this function was quietly discarding upwards of a
    // millimetre of ball0.C's position every time, sideways to the normal,
    // which is exactly the direction a scalar-along-the-normal offset has
    // no way to represent. Three components does not have that blind spot -
    // it is the whole vector, decomposed rather than approximated - and it
    // still carries the ball rigidly through a pure rotation for the same
    // reason the scalar version tried to: normal, tangents and surface
    // point all rotate together, because they are all read from the same
    // rig.
    //
    // The frame itself is solved once, eagerly, against the rig the hand is
    // actually in the instant attachment begins - grip's own digits, at
    // open's own (not yet lifted) wrist, which is exactly T.contact - not
    // against rig0, whose fingers are still open. reproduces ball0.C
    // exactly at T.contact by construction, because that is precisely the
    // geometry ball0.C sits in front of at that instant.
    function tangentFrame(n) {
      // an arbitrary but CONSISTENT pair of tangents built from n alone, so
      // they rotate rigidly whenever n itself does; which two directions
      // they are does not matter, only that the same recipe is used every
      // time this is called.
      const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const t1 = M.vnorm(M.vcross(ref, n));
      return [t1, M.vcross(n, t1)];
    }
    const anchorLocal = (function () {
      const rigAtContact = R.solve(A, grip);
      const sp = R.palmSurface(rigAtContact, ANCHOR_UV[0], ANCHOR_UV[1]);
      const n = R.palmNormal(rigAtContact, ANCHOR_UV[0], ANCHOR_UV[1]);
      const [t1, t2] = tangentFrame(n);
      const d = M.vsub(ball0.C, sp.P);
      return { n: M.vdot(d, n), t1: M.vdot(d, t1), t2: M.vdot(d, t2) };
    })();
    function attachedBallC(rig) {
      const sp = R.palmSurface(rig, ANCHOR_UV[0], ANCHOR_UV[1]);
      const n = R.palmNormal(rig, ANCHOR_UV[0], ANCHOR_UV[1]);
      const [t1, t2] = tangentFrame(n);
      let C = M.vmad(sp.P, n, anchorLocal.n);
      C = M.vmad(C, t1, anchorLocal.t1);
      C = M.vmad(C, t2, anchorLocal.t2);
      return C;
    }

    // ==== THE BALL, FALLING ==================================================
    // A real GK.physics body, created the instant it is first needed (the
    // instant the caller's sampling first crosses T.release) and stepped
    // forward by exactly as much physics time as `u` has advanced since the
    // last call. Zero initial velocity is not a simplification stood in for
    // a real number: liftFrac's own ease.inOut has zero slope at u=T.release
    // (that is what ease.inOut(0) with a cubic on both sides means), so the
    // hand's own motion is already momentarily still at the instant of
    // release - a controlled let-go, not a toss - and handing the ball a
    // velocity of exactly what the hand was doing at that instant is exactly
    // what "zero" already is here, not an approximation of it.
    let sim = null;
    function advancePhysics(u, rigNow) {
      const PH = GK.physics;
      if (!sim) {
        const state = PH.createState({
          r: radius, C: attachedBallC(rigNow), v: [0, 0, 0], w: [0, 0, 0],
          density: opts.density, restitution: opts.restitution, friction: opts.friction
        });
        PH.setGravityFromRig(state, rig0);
        sim = { state, lastU: u };
        return;
      }
      let remaining = (u - sim.lastU) * SECONDS;
      sim.lastU = u;
      // Chunked rather than handed to PH.step() in one call, so accuracy
      // never depends on how densely the caller happens to sample `t`: a
      // tool taking eight frames across the whole animation gets the same
      // trajectory as one taking two hundred, just read out at coarser
      // intervals, because the physics underneath never sees a dt larger
      // than PHYS_STEP_CAP regardless.
      while (remaining > 1e-6) {
        const h = Math.min(remaining, PHYS_STEP_CAP);
        PH.step(sim.state, rigNow, h);
        remaining -= h;
      }
    }

    let gen = null;   // which lap of the loop the previous call belonged to
    return function (t) {
      const u = ((t % 1) + 1) % 1;
      const thisGen = Math.floor(t);
      // A new lap is a fresh repetition of the same gesture: a new ball, in
      // effect, so any physics body left over from the last one round has
      // nothing to do with this one. (anchorT does not need this - it no
      // longer depends on when it was first asked for, see its own note.)
      if (thisGen !== gen) { sim = null; gen = thisGen; }

      const li = liftFrac(u);
      const p = blank();
      let phase;
      if (u < T.start) {
        p.digits = copyDigits(openClear); p.arch = openClear.arch; phase = 'idle';
      } else if (u < T.contact) {
        const cta = M.inv(u, T.start, T.contact);
        p.digits = blendDigits(openClear, grip, digitProgress(cta));
        p.arch = M.lerp(openClear.arch, grip.arch, M.ease.inOut(cta)); phase = 'close';
      } else if (u < T.release) {
        p.digits = copyDigits(grip); p.arch = grip.arch; phase = u < T.liftTop ? 'lift' : 'hold';
      } else if (u < T.clear) {
        const oe = M.inv(u, T.release, T.clear);
        p.digits = blendDigits(grip, open, digitProgress(oe));
        p.arch = M.lerp(grip.arch, open.arch, M.ease.inOut(oe)); phase = 'release';
      } else {
        p.digits = copyDigits(open); p.arch = open.arch; phase = 'falling';
      }
      p.wrist = wristFor(li);

      let ball;
      if (u < T.contact) {
        ball = { C: ball0.C.slice(), r: ball0.r };
      } else {
        const rigNow = R.solve(A, p);
        if (u < T.release) ball = { C: attachedBallC(rigNow), r: ball0.r };
        else { advancePhysics(u, rigNow); ball = { C: sim.state.C.slice(), r: sim.state.r }; }
      }
      ball.roughness = opts.roughness;
      ball.anisotropy = opts.anisotropy;

      const out = clampPose(A, p);
      out.ball = ball;
      out.phase = phase;
      return out;
    };
  }

  /**
   * Pull one digit to a point in space.
   *
   * The same damped Jacobian transpose the contacts use, except the error is
   * a displacement rather than a penetration depth, so it has three
   * components instead of one and the step length is solved for rather than
   * guessed: for J-transpose the best step along the gradient has a closed
   * form, and using it is the difference between a finger that follows the
   * cursor and one that crawls.
   *
   * Every joint stays sprung toward the pose that was asked for, at a fraction
   * of the contact solver's pull. Without it a dragged fingertip will happily
   * unwind the whole chain to gain a millimetre it cannot reach, and let go
   * of a pose the moment you touch it.
   */
  function reach(A, pose, d, target, opts) {
    opts = opts || {};
    const iters = opts.iters === undefined ? 30 : opts.iters;
    const tol = opts.tol === undefined ? 0.3 : opts.tol;
    const kappa = opts.kappa === undefined ? 0.02 : opts.kappa;
    const p0 = JSON.parse(JSON.stringify(pose));
    let p = JSON.parse(JSON.stringify(pose));
    let err = 1e9;
    for (let it = 0; it < iters; it++) {
      const rig = GK.rig.solve(A, p);
      const tip = rig.digits[d].tip;
      const e = M.vsub(target, tip);
      err = M.vlen(e);
      if (err < tol) break;
      const dofs = jointDofs(rig, p, d);
      if (!dofs.length) break;
      // J is the tip's velocity per unit of each joint's rotation
      const g = new Array(dofs.length);
      let v = [0, 0, 0];
      for (let i = 0; i < dofs.length; i++) {
        const x = dofs[i];
        const j = M.vcross(x.axis, M.vsub(tip, x.O));
        g[i] = M.vdot(j, e);
        v = M.vadd(v, M.vmul(j, x.w * g[i]));
      }
      const vv = M.vdot(v, v);
      if (vv < 1e-9) break;
      const step = M.vdot(e, v) / vv;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(step * dofs[i].w * g[i]);
      const a = p.digits[d], b = p0.digits[d];
      for (const k in a) if (typeof a[k] === 'number') a[k] += (b[k] - a[k]) * kappa;
      p = clampPose(A, p);
    }
    p.reachError = err;
    return p;
  }

  /**
   * Settle a pose against its own contacts. Returns a corrected copy; the
   * deepest remaining penetration is reported on `.contactDepth`.
   */
  // How fast the spring's own target gives way to where the hand has
  // actually ended up, per iteration. Zero is a target that never moves,
  // which cannot converge against a pose the hand can't occupy; one is no
  // spring at all.
  const TARGET_DRIFT = 0.06;

  function resolveContacts(A, pose, opts) {
    opts = opts || {};
    const iters = opts.iters === undefined ? 20 : opts.iters;
    const tol = opts.tol === undefined ? 0.35 : opts.tol;
    const lambda = opts.lambda === undefined ? 0.72 : opts.lambda;
    const kappa = opts.kappa === undefined ? 0.065 : opts.kappa;
    // A caller that already knows its target is reachable should pass 0: the
    // grip solver's aimed pose was produced by the reach solver against the
    // real joint stops, so it is occupiable by construction and letting it
    // drift only lets contact walk the hand off the thing it is holding.
    // An authored preset carries no such guarantee.
    const drift = opts.drift === undefined ? TARGET_DRIFT : opts.drift;
    const p0 = JSON.parse(JSON.stringify(pose));
    let p = JSON.parse(JSON.stringify(pose));
    let deepest = 0;
    for (let it = 0; it < iters; it++) {
      const rig = GK.rig.solve(A, p);
      const cs = gatherContacts(A, rig, tol, opts.scene);
      deepest = 0;
      for (const c of cs) deepest = Math.max(deepest, c.depth);
      if (!cs.length) break;
      applyContacts(A, p, rig, cs, lambda);
      // Every joint is sprung toward the pose that was asked for. The hand
      // settles where contact balances intent, which is what a hand does;
      // letting contact win outright turns a fist into a splayed claw.
      //
      // But the target has to be allowed to move. Run as twenty separate
      // one-iteration calls - each re-reading its own target - a maximal
      // clench converges from 23.9mm of penetration to zero; run as one
      // twenty-iteration call against a target that never moves, it settles
      // at 7.6mm with the thumb inside the middle finger. The spring is not
      // balancing that contact, it is holding it, because the pose it is
      // pulling toward is one the hand cannot actually occupy.
      //
      // So the target drifts toward wherever the hand has got to, slowly
      // enough that the early iterations still answer to what was asked for
      // and late ones answer to what is possible. Weakening the spring
      // instead was tried and is worse in both directions: it lets a
      // deliberately tight pose splay open, and it turns off exactly the
      // pull that stops a contact flinging a thumb to its joint stops.
      for (let d = 0; d < 5; d++) {
        const a = p.digits[d], b = p0.digits[d];
        for (const k in a) if (typeof a[k] === 'number') {
          a[k] += (b[k] - a[k]) * kappa;
          b[k] += (a[k] - b[k]) * drift;
        }
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
    resolveContacts, gatherContacts, jointDofs, reach,
    holdBall, ballOnPalm, ballContacts, pickAndDrop,
    lerpPose, dofList, romTour, breathe, readout, nr
  };
})(window.GK = window.GK || {});
