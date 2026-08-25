/* ============================================================================
   GRAPHITE KINEMATICS — 50 · features
   Every crease, fold, nail, print and palmar line, authored as curves in the
   surface parameter space of the rig. Nothing here knows about the camera:
   a fold is a fact about skin, not a mark about a picture.

   Curve records:
     { on:'digit', d, seg, pts:[[s, alpha, offMm?], ...], style }
     { on:'palm',  pts:[[u, beta, offMm?], ...], style }
     { on:'world', pts:[[x,y,z], ...], style }
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const R = GK.rig;
  const { TAU, DEG, clamp, clamp01, lerp, smoothstep, inv, remap } = M;

  const HALF = Math.PI / 2;
  const PALMAR = -HALF, DORSAL = HALF;

  // ---------------------------------------------------------------- styles
  const S = {
    contour: { tone: 0.92, weight: 1.10, passes: 3, taper: 0.42, wobble: 0.85, jitter: 0.62, layer: 'contour' },
    contourSoft: { tone: 0.52, weight: 0.95, passes: 2, taper: 0.55, wobble: 1.05, jitter: 0.75, layer: 'contour' },
    crease: { tone: 0.74, weight: 0.86, passes: 2, taper: 0.62, wobble: 0.80, jitter: 0.42, layer: 'crease' },
    creaseFine: { tone: 0.40, weight: 0.68, passes: 1, taper: 0.72, wobble: 0.95, jitter: 0.38, layer: 'crease' },
    fold: { tone: 0.34, weight: 0.66, passes: 1, taper: 0.80, wobble: 1.05, jitter: 0.35, layer: 'fold' },
    wrinkle: { tone: 0.26, weight: 0.60, passes: 1, taper: 0.85, wobble: 1.20, jitter: 0.32, layer: 'fold' },
    nail: { tone: 0.60, weight: 0.76, passes: 2, taper: 0.50, wobble: 0.62, jitter: 0.30, layer: 'nail' },
    nailFine: { tone: 0.30, weight: 0.58, passes: 1, taper: 0.70, wobble: 0.70, jitter: 0.26, layer: 'nail' },
    print: { tone: 0.20, weight: 0.46, passes: 1, taper: 0.55, wobble: 0.55, jitter: 0.18, layer: 'print' },
    palmRidge: { tone: 0.13, weight: 0.44, passes: 1, taper: 0.60, wobble: 0.70, jitter: 0.20, layer: 'ridge' },
    palmCrease: { tone: 0.70, weight: 0.94, passes: 2, taper: 0.52, wobble: 0.95, jitter: 0.50, layer: 'palmcrease' },
    palmMinor: { tone: 0.30, weight: 0.62, passes: 1, taper: 0.78, wobble: 1.10, jitter: 0.40, layer: 'palmcrease' },
    tendon: { tone: 0.28, weight: 0.72, passes: 1, taper: 0.88, wobble: 0.90, jitter: 0.45, layer: 'tendon' },
    vein: { tone: 0.22, weight: 0.58, passes: 1, taper: 0.86, wobble: 0.85, jitter: 0.35, layer: 'vein' },
    hair: { tone: 0.21, weight: 0.42, passes: 1, taper: 0.90, wobble: 0.60, jitter: 0.15, layer: 'hair' },
    hatch: { tone: 0.10, weight: 0.40, passes: 1, taper: 0.70, wobble: 0.90, jitter: 0.20, layer: 'hatch' },
    bone: { tone: 0.30, weight: 0.60, passes: 1, taper: 0.60, wobble: 0.70, jitter: 0.30, layer: 'bone' }
  };
  /**
   * Derive a style. A tone given here is a FACTOR on the base style's tone,
   * not a replacement: that is what keeps the value hierarchy — silhouette
   * over crease over fold over ridge — intact no matter how hard a joint is
   * flexed or how deep a crease has gathered.
   */
  const st = (base, over) => {
    const o = Object.assign({}, base, over || {});
    if (over && over.tone !== undefined && base.tone !== undefined) o.tone = base.tone * over.tone;
    return o;
  };
  // every mark gets its own wobble; shared phases make neighbours twins
  let PHASE = 0;
  const nextPhase = () => (PHASE = (PHASE + 1) % 100000);

  // --------------------------------------------------------------- helpers
  /** beta on the palm cross-section that lands on across-value v */
  function betaForV(rig, u, v, palmar) {
    const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
    const frac = clamp01((v - lo) / (hi - lo));
    const phi = Math.acos(clamp(1 - 2 * frac, -1, 1));
    return palmar === false ? 1 - phi / TAU : phi / TAU;
  }
  /**
   * A palm curve given as (u, v) samples on the palmar or dorsal face. The v
   * values are rebased onto the sheet's live borders, so a feature authored
   * over the thenar stays over the thenar whatever the thumb is doing.
   */
  function palmCurve(rig, uvs, palmar, off) {
    return uvs.map(p => [p[0], betaForV(rig, p[0], rig.palm.mapV(p[0], p[1]), palmar), off || p[2] || 0]);
  }
  /** sample a smooth curve through (u,v) control points */
  function uvSpline(ctrl, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const fi = (i / n) * (ctrl.length - 1);
      const p = M.splineAt(ctrl.map(c => [c[0], c[1], 0]), fi);
      out.push([p[0], p[1]]);
    }
    return out;
  }

  /** how far into its range a joint is flexed, 0..1 */
  function flexFrac(A, d, jointName, angle) {
    const L = A.limits.digits[d];
    let max = 90 * DEG;
    if (jointName === 'MCP') max = (L.mcp.flex) * DEG;
    else if (jointName === 'PIP') max = (L.pip.flex) * DEG;
    else if (jointName === 'DIP') max = (L.dip.flex) * DEG;
    else if (jointName === 'IP') max = (L.ip.flex) * DEG;
    return clamp01(angle / max);
  }

  // =========================================================================
  //  A · DIGIT JOINT FOLDS
  //  Skin does not stretch, it gathers. On the flexion side one faint line
  //  becomes a bunched sheaf as the joint closes; on the extension side the
  //  wrinkle lattice is drawn taut and erased.
  // =========================================================================

  /** one transverse crease across the palmar face of a digit segment */
  function creaseArc(d, seg, s, span, bow, style, res) {
    const pts = [];
    const n = res || 22;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = PALMAR + (t * 2 - 1) * span;
      const k = 1 - Math.pow(t * 2 - 1, 2);        // 0 at the ends, 1 at centre
      pts.push([s + bow * k, a, -0.32 * k]);        // creases sit *into* the skin
    }
    return { on: 'digit', d, seg, pts, style };
  }

  function digitFolds(rig, out) {
    const A = rig.anatomy;
    const rngRoot = new M.Rng(A.seed ^ 0x1f01);

    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const isThumb = d === AN.THUMB;
      const nSeg = dg.segs.length;
      const rng = rngRoot.fork(d * 7 + 3);

      for (let seg = 1; seg < nSeg; seg++) {
        const jn = dg.joints[seg].name;
        const flex = dg.joints[seg].flex;
        const f = flexFrac(A, d, jn, Math.max(0, flex));
        const ext = clamp01(-flex / (30 * DEG));       // hyperextension amount

        // ---- palmar flexion creases -------------------------------------
        // The metacarpophalangeal crease lies *distal* to its own joint, over
        // the base of the proximal phalanx. Almost nobody draws this right.
        const isMCP = (jn === 'MCP');
        const base = isMCP ? 0.235 : (jn === 'PIP' ? 0.055 : 0.075);
        const twin = (jn === 'PIP');                   // the PIP takes two
        const span = lerp(1.02, 1.30, f) * (isMCP ? 1.16 : 1.0);
        const bow = (isMCP ? 0.030 : 0.016) * lerp(1, 1.5, f);
        const mainTone = lerp(0.42, 1.0, Math.pow(f, 0.72)) * (isMCP ? 0.94 : 1.0);
        const sJit = () => rng.sym(0.008);

        const primaries = twin ? [base - 0.030, base + 0.034] : [base];
        for (let pi = 0; pi < primaries.length; pi++) {
          out.push(creaseArc(d, seg, primaries[pi] + sJit(), span, bow,
            st(S.crease, { tone: mainTone * (pi === 0 ? 1 : 0.88), phase: nextPhase() })));
        }

        // gathered secondary lines: they multiply and crowd as the joint shuts
        const nExtra = Math.floor(f * 3.4 + (twin ? 0.4 : 0));
        for (let i = 0; i < nExtra; i++) {
          const side = (i % 2 === 0) ? -1 : 1;
          const rank = Math.floor(i / 2) + 1;
          const gap = lerp(0.052, 0.030, f) * rank;
          const sPos = (twin ? (side < 0 ? primaries[0] : primaries[1]) : base) + side * gap + sJit();
          if (sPos < -0.06 || sPos > 0.92) continue;
          out.push(creaseArc(d, seg, sPos, span * lerp(0.86, 0.62, rank / 4), bow * 0.7,
            st(S.creaseFine, {
              tone: lerp(0.42, 1.35, f) * (1 - rank * 0.18),
              phase: nextPhase()
            }), 16));
        }

        // ---- lateral gathering wedges -----------------------------------
        // Where the crease runs out onto the flank the skin puckers into
        // short obliques converging on the crease.
        if (f > 0.12) {
          for (let sideI = 0; sideI < 2; sideI++) {
            const sgn = sideI === 0 ? -1 : 1;
            const nW = 1 + Math.floor(f * 2.6);
            for (let i = 0; i < nW; i++) {
              const a0 = PALMAR + sgn * (span * 0.80 + i * 0.16);
              const pts = [];
              const L = lerp(0.05, 0.11, f) * (1 - i * 0.2);
              for (let k = 0; k <= 6; k++) {
                const t = k / 6;
                pts.push([base + (t - 0.5) * L * 1.4, a0 + sgn * t * 0.30 * (1 - i * 0.15), -0.2]);
              }
              out.push({
                on: 'digit', d, seg, pts,
                style: st(S.fold, { tone: lerp(0.28, 1.30, f) * (1 - i * 0.22), phase: nextPhase() })
              });
            }
          }
        }

        // ---- dorsal extension wrinkles ----------------------------------
        // Present over a straight knuckle, erased as the joint closes.
        const taut = clamp01(1 - f * 1.45) * (1 - ext * 0.35);
        if (taut > 0.05) {
          const rows = A.knuckles.wrinkleRows + (jn === 'MCP' ? 1 : 0);
          const spread = lerp(0.16, 0.30, taut) * (jn === 'MCP' ? 1.35 : 1.0);
          const dspan = lerp(0.62, 1.02, taut) * (jn === 'MCP' ? 1.25 : 1.0);
          for (let i = 0; i < rows; i++) {
            const t = (i + 0.5) / rows;
            let sPos = -spread * 0.5 + spread * t;
            let useSeg = seg, ss = sPos;
            if (ss < 0.012) {   // wrap back onto the proximal segment
              useSeg = seg - 1; ss = 1 + ss;
              if (useSeg < 1) continue;
            }
            const pts = [];
            for (let k = 0; k <= 14; k++) {
              const q = k / 14;
              const a = DORSAL + (q * 2 - 1) * dspan;
              const kk = 1 - Math.pow(q * 2 - 1, 2);
              pts.push([ss + 0.014 * kk * (i % 2 ? 1 : -1), a, -0.16]);
            }
            out.push({
              on: 'digit', d: d, seg: useSeg, pts,
              style: st(S.wrinkle, {
                tone: lerp(0.20, 1.55, taut) * (0.6 + 0.4 * Math.sin(Math.PI * t)),
                phase: nextPhase()
              })
            });
          }
          // the oblique cross-set that turns the rows into a diamond lattice
          const nObl = Math.round(3 + taut * 4);
          for (let i = 0; i < nObl; i++) {
            const sgn = i % 2 ? 1 : -1;
            const aC = DORSAL + (i / (nObl - 1) - 0.5) * dspan * 1.5;
            const pts = [];
            for (let k = 0; k <= 8; k++) {
              const q = k / 8;
              let ss = -spread * 0.45 + spread * 0.9 * q;
              let useSeg = seg;
              if (ss < 0.012) { useSeg = seg - 1; ss = 1 + ss; }
              if (useSeg < 1) continue;
              pts.push([ss, aC + sgn * (q - 0.5) * 0.34, -0.14]);
            }
            if (pts.length > 3) out.push({
              on: 'digit', d, seg: pts[0][0] > 0.5 && seg > 1 ? seg : seg, pts,
              style: st(S.wrinkle, { tone: lerp(0.12, 0.92, taut), phase: nextPhase() })
            });
          }
        }

        // ---- knuckle prominence contour ---------------------------------
        // A flexed knuckle presents a hard dorsal corner; draw its crest.
        if (f > 0.30 && jn !== 'DIP') {
          const pts = [];
          for (let k = 0; k <= 16; k++) {
            const q = k / 16;
            const a = DORSAL + (q * 2 - 1) * 0.86;
            pts.push([0.02 + 0.02 * (1 - Math.pow(q * 2 - 1, 2)), a, 0.15]);
          }
          out.push({
            on: 'digit', d, seg, pts,
            style: st(S.crease, { tone: lerp(0, 0.70, (f - 0.3) / 0.7), weight: 0.9, phase: nextPhase() })
          });
        }
      }

      // ---- lateral digital line -----------------------------------------
      // The seam where dorsal skin meets the pulp, running the whole digit.
      for (let sideI = 0; sideI < 2; sideI++) {
        const a0 = sideI === 0 ? 0.02 : Math.PI - 0.02;
        for (let seg = 1; seg < nSeg; seg++) {
          const sg = dg.segs[seg];
          const pts = [];
          const nS = 14;
          for (let k = 0; k <= nS; k++) {
            const s = (k / nS) * (seg === nSeg - 1 ? sg.sMax * 0.94 : 1);
            if (seg === 1 && s < AN.webStart(A, d, a0) + 0.02) continue;
            pts.push([s, a0 + Math.sin(s * 5 + seg) * 0.035, 0]);
          }
          if (pts.length > 3) out.push({
            on: 'digit', d, seg, pts,
            style: st(S.fold, { tone: 0.46, weight: 0.6, taper: 0.9, phase: nextPhase() })
          });
        }
      }
    }
  }

  // =========================================================================
  //  B · WEB SPACES
  //  The interdigital commissures: the skin bridging adjacent digits.
  // =========================================================================
  function webs(rig, out) {
    const A = rig.anatomy;
    for (let d = 1; d < 4; d++) {
      const h1 = AN.webStart(A, d, 0.0);          // ulnar flank of digit d
      const h2 = AN.webStart(A, d + 1, Math.PI);  // radial flank of digit d+1
      // palmar margin of the web, drawn on each digit's own flank
      for (const [dd, hh, a0, sgn] of [[d, h1, 0.0, 1], [d + 1, h2, Math.PI, -1]]) {
        const pts = [];
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const a = a0 + sgn * (-0.05 - t * 1.25);
          pts.push([hh * (1 - t * t * 0.92), a, -0.25]);
        }
        out.push({
          on: 'digit', d: dd, seg: 1, pts,
          style: st(S.crease, { tone: 0.60, weight: 0.82, taper: 0.7, phase: nextPhase() })
        });
      }
    }
    // first web: the thumb-index commissure, a broad free margin
    const pts = [];
    for (let k = 0; k <= 18; k++) {
      const t = k / 18;
      pts.push([lerp(1.00, 0.76, t), lerp(-0.72, -0.24, t)]);
    }
    out.push({
      on: 'palm', pts: palmCurve(rig, pts, true, -0.3),
      style: st(S.crease, { tone: 0.54, weight: 0.8, phase: nextPhase() })
    });
  }

  // =========================================================================
  //  C · NAILS
  // =========================================================================
  function nails(rig, out) {
    const A = rig.anatomy;
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const seg = dg.segs.length - 1;
      const N = A.nails[d];
      const sg = dg.segs[seg];
      const sB = 1 + AN.tipExtent(A, d) * N.free;     // free edge
      const sA = sB - N.len;                          // proximal fold
      const w = 0.95 * N.wide + 0.18;                 // half-width in alpha
      const off = 0.55 * N.curve;                     // the plate stands proud

      const bowP = 0.055 * N.curve;   // proximal fold arcs distally at the sides
      const bowD = 0.050;             // free edge arcs distally at the centre

      const edge = (sBase, bow, sgn, n, extra) => {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const a = DORSAL + (t * 2 - 1) * w;
          const k = Math.pow(t * 2 - 1, 2);
          pts.push([sBase + sgn * bow * k + (extra || 0), a, off]);
        }
        return pts;
      };

      // proximal nail fold (eponychium) — the cuticle line
      out.push({ on: 'digit', d, seg, pts: edge(sA, bowP, 1, 20), style: st(S.nail, { tone: 1.03, phase: nextPhase() }) });
      // free edge
      out.push({ on: 'digit', d, seg, pts: edge(sB, bowD, -1, 20), style: st(S.nail, { tone: 1.17, phase: nextPhase() }) });
      // hyponychium: the line where the plate lifts off the skin
      if (N.free > 0.05) {
        out.push({
          on: 'digit', d, seg, pts: edge(sB - N.free * 0.32, bowD * 0.9, -1, 18),
          style: st(S.nailFine, { tone: 1.13, phase: nextPhase() })
        });
      }
      // lunula
      if (N.lunula > 0.03) {
        const pts = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const a = DORSAL + (t * 2 - 1) * w * 0.66;
          const k = Math.pow(t * 2 - 1, 2);
          pts.push([sA + N.lunula * N.len * (1 - k * 0.55) + bowP * k, a, off]);
        }
        out.push({ on: 'digit', d, seg, pts, style: st(S.nailFine, { tone: 1.00, phase: nextPhase() }) });
      }
      // lateral nail folds
      for (const sgn of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push([lerp(sA + bowP * 0.9, sB - bowD * 0.15, t), DORSAL + sgn * w * (1 + 0.03 * Math.sin(t * 3)), off * 0.55]);
        }
        out.push({ on: 'digit', d, seg, pts, style: st(S.nail, { tone: 0.80, weight: 0.7, phase: nextPhase() }) });
        // the fold of skin outside the plate
        const pts2 = pts.map(p => [p[0], p[1] + sgn * 0.10, 0]);
        out.push({ on: 'digit', d, seg, pts: pts2, style: st(S.nailFine, { tone: 0.73, phase: nextPhase() }) });
      }
      // a couple of longitudinal striations across the plate
      const rng = new M.Rng(A.seed ^ (0x2a00 + d));
      const nStr = rng.int(1, 3);
      for (let i = 0; i < nStr; i++) {
        const aa = DORSAL + rng.sym(w * 0.7);
        out.push({
          on: 'digit', d, seg,
          pts: [[sA + N.len * 0.12, aa, off], [sB - N.len * 0.1, aa + rng.sym(0.03), off]],
          style: st(S.nailFine, { tone: 0.33, weight: 0.5, phase: nextPhase() })
        });
      }
    }
  }

  // =========================================================================
  //  D · EVENLY SPACED STREAMLINES
  //  Ridge fields are integrated, not drawn. Lines terminate when they crowd
  //  a neighbour, which yields realistic endings and bifurcations for free.
  // =========================================================================
  function streamlines(orient, o) {
    const spacing = o.spacing;
    const dTest = spacing * (o.dSep === undefined ? 0.82 : o.dSep);
    const step = o.step || spacing * 0.55;
    const maxSteps = o.maxSteps || 400;
    const inside = o.inside;
    const cell = spacing;
    const grid = new Map();
    const key = (x, y) => ((x / cell) | 0) + ',' + ((y / cell) | 0);
    const near = (x, y, r) => {
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      const n = Math.ceil(r / cell);
      for (let j = cy - n; j <= cy + n; j++) {
        for (let i = cx - n; i <= cx + n; i++) {
          const b = grid.get(i + ',' + j);
          if (!b) continue;
          for (let k = 0; k < b.length; k += 2) {
            const dx = b[k] - x, dy = b[k + 1] - y;
            if (dx * dx + dy * dy < r * r) return true;
          }
        }
      }
      return false;
    };
    const add = (x, y) => {
      const k = key(x, y);
      let b = grid.get(k); if (!b) { b = []; grid.set(k, b); }
      b.push(x, y);
    };

    const lines = [];
    const queue = [];
    const seed0 = o.seed0 || [(o.x0 + o.x1) * 0.5, (o.y0 + o.y1) * 0.5];
    queue.push(seed0);

    const integrate = (sx, sy, dir) => {
      const pts = [];
      let x = sx, y = sy, px = null, py = null;
      for (let i = 0; i < maxSteps; i++) {
        if (!inside(x, y)) break;
        if (i > 0 && near(x, y, dTest)) break;
        pts.push([x, y]);
        // RK2 with direction continuity
        let a = orient(x, y);
        let vx = Math.cos(a), vy = Math.sin(a);
        if (px !== null && (vx * px + vy * py) < 0) { vx = -vx; vy = -vy; }
        else if (px === null && dir < 0) { vx = -vx; vy = -vy; }
        const mx = x + vx * step * 0.5, my = y + vy * step * 0.5;
        let a2 = orient(mx, my);
        let wx = Math.cos(a2), wy = Math.sin(a2);
        if ((wx * vx + wy * vy) < 0) { wx = -wx; wy = -wy; }
        x += wx * step; y += wy * step;
        px = wx; py = wy;
        if (!isFinite(x) || !isFinite(y)) break;
      }
      return pts;
    };

    let guard = 0;
    while (queue.length && lines.length < (o.maxLines || 700) && guard++ < 20000) {
      const [sx, sy] = queue.shift();
      if (!inside(sx, sy) || near(sx, sy, dTest)) continue;
      const fwd = integrate(sx, sy, 1);
      const bwd = integrate(sx, sy, -1);
      const line = bwd.slice(1).reverse().concat(fwd);
      if (line.length < 3) continue;
      for (const p of line) add(p[0], p[1]);
      lines.push(line);
      // propose new seeds perpendicular to this line
      for (let i = 0; i < line.length; i += Math.max(1, Math.round(spacing / step))) {
        const a = orient(line[i][0], line[i][1]);
        const nx = -Math.sin(a), ny = Math.cos(a);
        queue.push([line[i][0] + nx * spacing, line[i][1] + ny * spacing]);
        queue.push([line[i][0] - nx * spacing, line[i][1] - ny * spacing]);
      }
    }
    return lines;
  }

  // ------------------------------------------------ fingerprint orientation
  function printField(type, p) {
    const cx = 0 + p.coreY, cy = p.coreS;
    const side = p.deltaSide;
    const dx = side * 0.62, dy = cy - 0.46;
    const sw = p.swirl;
    switch (type) {
      case 'arch':
        return (x, y) => {
          const h = 0.34, w = 0.52;
          const dydx = -2 * x / (w * w) * h * Math.exp(-(x * x) / (w * w));
          return Math.atan2(dydx, 1) + sw * 0.08;
        };
      case 'tentedArch':
        return (x, y) => {
          const w = 0.34, h = 0.66;
          const dydx = -h * Math.sign(x) * Math.exp(-Math.abs(x) / w) / w;
          return Math.atan2(dydx * 0.9, 1) + sw * 0.06;
        };
      case 'whorl':
        return (x, y) => {
          const a1 = Math.atan2(y - cy, x - cx);
          const a2 = Math.atan2(y - dy, x - dx);
          const a3 = Math.atan2(y - dy, x + dx);
          return a1 + HALF - 0.5 * (a2 + a3) + sw * 0.25;
        };
      case 'doubleLoop':
        return (x, y) => {
          const a1 = Math.atan2(y - (cy + 0.16), x - (cx - 0.14));
          const a2 = Math.atan2(y - (cy - 0.18), x - (cx + 0.14));
          const a3 = Math.atan2(y - dy, x - dx);
          const a4 = Math.atan2(y - dy, x + dx);
          return 0.5 * (a1 + a2) - 0.5 * (a3 + a4) + HALF + sw * 0.2;
        };
      default: // ulnarLoop / radialLoop
        return (x, y) => {
          const a1 = Math.atan2(y - cy, x - cx);
          const a2 = Math.atan2(y - dy, x - dx);
          return 0.5 * (a1 - a2) + sw * 0.12;
        };
    }
  }

  function fingerprints(rig, out, quality) {
    const A = rig.anatomy;
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      const seg = dg.segs.length - 1;
      const sg = dg.segs[seg];
      const P = A.prints[d];
      const bone = A.bones[d];
      // pad extent in surface coordinates
      const sLo = 0.16, sHi = sg.sMax * 0.96;
      const aHalf = 1.12;
      // ~0.5 mm of ridge pitch over a pad about fifteen millimetres across:
      // the parameter domain below spans the pad, so pitch it directly
      const spacing = 0.062 / P.density;

      const field = printField(P.type, P);
      const lines = streamlines(field, {
        x0: -1, y0: -1, x1: 1, y1: 1.6,
        spacing: spacing,
        step: spacing * 0.52,
        maxSteps: quality > 0 ? 420 : 170,
        maxLines: quality > 0 ? 320 : 110,
        seed0: [0, P.coreS - 0.35],
        inside: (x, y) => {
          if (y < -0.02 || y > 1.34) return false;
          const rx = x / 1.0;
          const ry = (y - 0.62) / 0.72;
          return rx * rx + ry * ry < 1.0;
        }
      });

      const rng = new M.Rng(A.seed ^ (0x3b00 + d));
      for (let i = 0; i < lines.length; i++) {
        let ln = lines[i];
        if (ln.length < 4) continue;
        // random ridge breaks, so minutiae read as endings not perfect arcs
        if (rng.chance(P.broken * 2.2) && ln.length > 10) {
          const c = rng.int(3, ln.length - 4);
          ln = rng.chance(0.5) ? ln.slice(0, c) : ln.slice(c);
        }
        const pts = ln.map(p => [
          lerp(sLo, sHi, clamp01(p[1] / 1.3)),
          PALMAR + p[0] * aHalf,
          -0.08
        ]);
        out.push({
          on: 'digit', d, seg, pts,
          style: st(S.print, { tone: 0.70 + 0.50 * rng.f(), phase: nextPhase() })
        });
      }
      // flexion-crease-free zone: a faint boundary at the pad's proximal edge
    }
  }

  // =========================================================================
  //  E · PALMAR CREASES
  //  Palmistry named them; anatomy did not. They are flexion creases of the
  //  metacarpophalangeal row and of the thumb's opposition arc.
  // =========================================================================
  function palmCreases(rig, out) {
    const A = rig.anatomy;
    const C = A.creases;
    const rng = new M.Rng(A.seed ^ 0x4c01);
    const pose = rig.pose;

    // how hard the finger row and the thumb are working
    let mcpF = 0;
    for (let d = 1; d < 5; d++) mcpF += flexFrac(A, d, 'MCP', Math.max(0, pose.digits[d].mcpFlex));
    mcpF /= 4;
    const oppF = clamp01((pose.digits[0].cmcOpp || 0) / (60 * DEG)) * 0.6 +
      clamp01((pose.digits[0].cmcRad || 0) / (40 * DEG)) * 0.4;
    const arch = clamp01(pose.arch || 0);

    const gather = (ctrl, count, spreadU, spreadV, style, tone, phase) => {
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const c2 = ctrl.map(p => [p[0] + t * spreadU, p[1] + t * spreadV]);
        out.push({
          on: 'palm', pts: palmCurve(rig, uvSpline(c2, 40), true, -0.4),
          style: st(style, { tone: tone * (1 - Math.abs(t) * 0.42), phase: nextPhase() })
        });
      }
    };

    if (A.creasePattern === 'simian') {
      // a single transverse crease crossing the whole palm
      gather([[0.84, -0.10], [0.80, 0.24], [0.76, 0.62], [0.70, 1.06]],
        1 + Math.round(mcpF * 2.4), 0.030, 0, S.palmCrease, 0.86 + 0.52 * mcpF, 900);
    } else {
      // distal transverse crease — flexion of the ulnar three metacarpals
      const dArc = C.distalArc;
      gather([
        [0.870 + 0.02 * arch, 0.12], [0.880, 0.42], [0.860, 0.70], [0.795, 0.95], [0.720, 1.10]
      ], 1 + Math.round(mcpF * 2.6), 0.026 * dArc, 0, S.palmCrease, 0.83 + 0.54 * mcpF, 910);

      // proximal transverse crease — flexion of the index and middle rays
      const sydney = A.creasePattern === 'sydney';
      gather([
        [0.800, -0.22], [0.762, 0.00], [0.690, 0.34], [0.590, 0.66], [sydney ? 0.505 : 0.520, sydney ? 1.08 : 0.86]
      ], 1 + Math.round(mcpF * 2.0), 0.024 * C.proximalArc, 0, S.palmCrease, 0.77 + 0.49 * mcpF, 920);
    }

    // thenar crease — the arc the thumb sweeps in opposition
    gather([
      [0.810, -0.26], [0.700, -0.46], [0.505, -0.60], [0.315, -0.58], [0.145, -0.44], [0.020, -0.28]
    ], 1 + Math.round(oppF * 2.8), 0.020 * C.thenarArc, 0.020, S.palmCrease, 0.74 + 0.57 * oppF, 930);

    // vertical creases: not everyone has them
    if (C.fateLine) {
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([[0.05, 0.54], [0.30, 0.52], [0.55, 0.49], [0.80, 0.44]], 34), true, -0.35),
        style: st(S.palmMinor, { tone: 1.13, phase: nextPhase() })
      });
    }
    if (C.sunLine) {
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([[0.40, 0.80], [0.60, 0.78], [0.82, 0.74]], 24), true, -0.3),
        style: st(S.palmMinor, { tone: 0.87, phase: nextPhase() })
      });
    }

    // minor creases: the grille of the thenar and hypothenar
    for (let i = 0; i < C.minorCount; i++) {
      const zone = rng.f();
      let a, b;
      if (zone < 0.45) {          // thenar
        const u = rng.range(0.14, 0.70), v = rng.range(-0.62, -0.14);
        const L = rng.range(0.06, 0.17), ang = rng.range(-1.2, 0.4);
        a = [u - Math.cos(ang) * L, v - Math.sin(ang) * L * 0.9];
        b = [u + Math.cos(ang) * L, v + Math.sin(ang) * L * 0.9];
      } else if (zone < 0.80) {   // hypothenar
        const u = rng.range(0.10, 0.62), v = rng.range(0.88, 1.22);
        const L = rng.range(0.05, 0.14), ang = rng.range(0.4, 1.9);
        a = [u - Math.cos(ang) * L, v - Math.sin(ang) * L * 0.8];
        b = [u + Math.cos(ang) * L, v + Math.sin(ang) * L * 0.8];
      } else {                    // mid palm
        const u = rng.range(0.42, 0.80), v = rng.range(0.16, 0.88);
        const L = rng.range(0.04, 0.10), ang = rng.range(-0.5, 1.6);
        a = [u - Math.cos(ang) * L, v - Math.sin(ang) * L];
        b = [u + Math.cos(ang) * L, v + Math.sin(ang) * L];
      }
      out.push({
        on: 'palm', pts: palmCurve(rig, uvSpline([a, [(a[0] + b[0]) / 2 + rng.sym(0.012), (a[1] + b[1]) / 2 + rng.sym(0.02)], b], 14), true, -0.25),
        style: st(S.palmMinor, { tone: rng.range(0.47, 1.13), phase: nextPhase() })
      });
    }

    // creases at the base of each finger, on the palm side of the knuckle line
    for (let d = 1; d < 5; d++) {
      const v = (d - 1) / 3;
      const f = flexFrac(A, d, 'MCP', Math.max(0, pose.digits[d].mcpFlex));
      const n = 1 + Math.round(f * 1.6);
      for (let i = 0; i < n; i++) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([
            [0.975 - i * 0.035, v - 0.13], [0.995 - i * 0.035, v], [0.975 - i * 0.035, v + 0.13]
          ], 16), true, -0.3),
          style: st(S.palmMinor, { tone: (0.73 + 1.13 * f) * (1 - i * 0.3), phase: nextPhase() })
        });
      }
    }

    // ---- wrist creases (rascettes) --------------------------------------
    const wf = clamp01(Math.max(0, pose.wrist.flex) / (70 * DEG));
    const nW = C.wristCreases + Math.round(wf * 2);
    for (let i = 0; i < nW; i++) {
      const u = -0.012 - i * 0.052 - wf * 0.01;
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([
          [u + 0.024, -0.26], [u - 0.004, 0.12], [u - 0.012, 0.52], [u + 0.004, 0.94], [u + 0.032, 1.24]
        ], 30), true, -0.4),
        style: st(S.palmCrease, {
          tone: (0.60 + 0.60 * wf) * (1 - i * 0.16), weight: 0.88, phase: nextPhase()
        })
      });
    }

    // ---- cupping folds ---------------------------------------------------
    if (arch > 0.25) {
      for (let i = 0; i < 3; i++) {
        const v = 0.55 + i * 0.20;
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[0.30, v - 0.06], [0.52, v], [0.74, v + 0.05]], 20), true, -0.3),
          style: st(S.palmMinor, { tone: (arch - 0.25) * 1.83 * (1 - i * 0.2), phase: nextPhase() })
        });
      }
    }
  }

  // =========================================================================
  //  F · PALMAR FRICTION RIDGES
  //  The same field machinery as the fingerprints, at a coarser pitch and a
  //  whisper of tone, flowing around the thenar and hypothenar.
  // =========================================================================
  function palmRidges(rig, out, quality) {
    const A = rig.anatomy;
    const rng = new M.Rng(A.seed ^ 0x5d01);
    const noise = new M.Noise(A.seed ^ 0x5d02);
    // A bounded orientation field: broadly transverse across the palm, tilted
    // into arcs where the thenar and hypothenar masses rise under it. Built as
    // a sum of bounded tilts rather than a potential, so it can carry no
    // singularity and the streamline sweep never stalls against a saddle.
    const tilt = (u, v, u0, v0, su, sv, amp) => {
      const x = (u - u0) / su, y = (v - v0) / sv;
      return amp * x * Math.exp(-(x * x + y * y));
    };
    const field = (u, v) => HALF
      + tilt(u, v, 0.48, -0.40, 0.40, 0.38, 1.05)
      + tilt(u, v, 0.42, 1.14, 0.38, 0.28, 0.80)
      + 0.20 * (v - 0.40)
      + (noise.n2(u * 2.0, v * 2.0) - 0.5) * 0.22;
    const lines = streamlines(field, {
      x0: -0.4, y0: -0.4, x1: 1.1, y1: 1.2,
      spacing: quality > 0 ? 0.020 : 0.038,
      step: quality > 0 ? 0.011 : 0.020,
      maxSteps: quality > 0 ? 420 : 190,
      maxLines: quality > 0 ? 900 : 300,
      seed0: [0.5, 0.45],
      inside: (u, v) => u > -0.10 && u < 1.03 &&
        v > rig.palm.vLoRef(u) + 0.02 && v < rig.palm.vHi(u) - 0.02
    });
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.length < 5) continue;
      out.push({
        on: 'palm', pts: palmCurve(rig, ln, true, -0.05),
        style: st(S.palmRidge, { tone: 0.58 + 0.38 * rng.f(), phase: nextPhase() })
      });
    }
  }

  GK.features = {
    S, st, nextPhase, PALMAR, DORSAL, betaForV, palmCurve, uvSpline, flexFrac,
    digitFolds, webs, nails, fingerprints, palmCreases, palmRidges, streamlines, printField
  };
})(window.GK = window.GK || {});
