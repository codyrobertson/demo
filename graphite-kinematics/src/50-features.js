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
    palmCrease: { tone: 0.80, weight: 0.98, passes: 2, taper: 0.52, wobble: 0.95, jitter: 0.50, layer: 'palmcrease' },
    palmMinor: { tone: 0.30, weight: 0.62, passes: 1, taper: 0.78, wobble: 1.10, jitter: 0.40, layer: 'palmcrease' },
    tendon: { tone: 0.28, weight: 0.72, passes: 1, taper: 0.88, wobble: 0.90, jitter: 0.45, layer: 'tendon' },
    vein: { tone: 0.22, weight: 0.58, passes: 1, taper: 0.86, wobble: 0.85, jitter: 0.35, layer: 'vein' },
    hair: { tone: 0.21, weight: 0.42, passes: 1, taper: 0.90, wobble: 0.60, jitter: 0.15, layer: 'hair' },
    hatch: { tone: 0.10, weight: 0.40, passes: 1, taper: 0.70, wobble: 0.90, jitter: 0.20, layer: 'hatch' },
    // form modelling: its own layer, because tone that describes a solid is
    // not the same job as the lattice of the skin over it, and must not be
    // turned down with it
    model: { tone: 0.52, weight: 0.54, passes: 1, taper: 0.82, wobble: 1.15, jitter: 0.30, layer: 'model' },
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
  /**
   * The first web's own surface, as (t, k): t runs from the depth of the
   * commissure out to the free margin, k across it from thumb to index. The
   * commissure is not part of the palm's sheet - it spans between two rays -
   * so a mark authored in palm coordinates gets rebased onto the palm's own
   * border and lands as a straight line lying across the hand. Marks stand a
   * little proud of the sheet, so it occludes them from behind instead of
   * fighting them for the same depth.
   */
  function webSheet(rig) {
    const w = R.firstWeb(rig, new R.View(0, 0, 0, 1, [0, 0, 0], 0, 0));
    const N = w.thSide.length - 1;
    const prox = M.vnorm(M.vadd(rig.digits[0].segs[1].t, rig.digits[1].segs[1].t));
    let face = M.vnorm(M.vcross(M.vsub(w.ixSide[N], w.thSide[N]),
      M.vsub(w.thSide[N], w.thSide[0])));
    if (M.vdot(face, rig.root[2]) < 0) face = M.vmul(face, -1);
    const at = (t, k, lift) => {
      const f = clamp01(t) * N;
      const i = Math.min(N - 1, Math.floor(f)), fr = f - i;
      const a = M.vlerp(w.thSide[i], w.thSide[i + 1], fr);
      const b = M.vlerp(w.ixSide[i], w.ixSide[i + 1], fr);
      const bow = clamp01(t) * Math.sin(Math.PI * k) * 0.18;
      const base = M.vmad(M.vlerp(a, b, clamp01(k)), prox, -M.vdist(a, b) * bow);
      return M.vmad(base, face, lift || 0);
    };
    // How taut the commissure is, read off the sheet itself rather than off
    // the joint angles that produced it. Opposition and a wrapped grip slacken
    // the web without touching either abduction angle, so an angle-driven
    // guess calls them open when they are gathered.
    const open = smoothstep(inv(M.vdist(w.PT, w.PI) / rig.anatomy.size, 20, 68));
    return { at, open };
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
        // The proximal interphalangeal joint takes two creases — and so does
        // the thumb's metacarpophalangeal, which is the joint that does the
        // same work in a ray with one fewer bone.
        const twin = (jn === 'PIP') || (isThumb && jn === 'MCP');
        // The thumb's creases wrap further round than a finger's. Its palmar
        // surface is broad and flat where a finger's is round, and it is the
        // one digit whose pad never squarely faces a palmar view, so a crease
        // cut to a finger's arc shows only its middle few degrees and the
        // thumb comes out bare.
        const span = lerp(1.02, 1.30, f) * (isMCP ? 1.16 : 1.0) * (isThumb ? 1.34 : 1.0);
        const bow = (isMCP ? 0.030 : 0.016) * lerp(1, 1.5, f);
        const mainTone = lerp(0.60, 1.0, Math.pow(f, 0.72)) * (isMCP ? 0.94 : 1.0);
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
            let useSeg = seg, ss = -spread * 0.5 + spread * t;
            if (ss < 0.012) {
              // a wrinkle set straddles its joint: the proximal half of it
              // belongs to the bone behind. The metacarpophalangeal joint has
              // no drawable bone behind it, so there it stacks distally instead
              // of being dropped, which used to leave the row half-drawn.
              if (seg > 1) { useSeg = seg - 1; ss = 1 + ss; }
              else ss = 0.012 + spread * t * 0.5;
            }
            // Each wrinkle reaches its own distance round the finger and sits
            // at its own height. Equal arcs at equal spacing read as tape.
            const reach = dspan * rng.range(0.62, 1.06);
            const drift = rng.sym(0.016);
            const pts = [];
            for (let k = 0; k <= 14; k++) {
              const q = k / 14;
              const a = DORSAL + (q * 2 - 1) * reach + rng.sym(0.012);
              const kk = 1 - Math.pow(q * 2 - 1, 2);
              pts.push([ss + drift + 0.014 * kk * (i % 2 ? 1 : -1), a, -0.16]);
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
          // The oblique set that turns the rows into a diamond lattice. Each
          // oblique crosses the joint, so it has to be emitted as two curves —
          // one per bone. Built as a single point list spanning both, the
          // proximal points land at s ~ 0.97 of the WRONG segment and the
          // lattice collapses into a row of brackets at the finger's base.
          const nObl = Math.round(3 + taut * 4);
          for (let i = 0; i < nObl; i++) {
            const sgn = i % 2 ? 1 : -1;
            const aC = DORSAL + (i / Math.max(1, nObl - 1) - 0.5) * dspan * 1.5;
            const here = [], back = [];
            for (let k = 0; k <= 8; k++) {
              const q = k / 8;
              const ss = -spread * 0.45 + spread * 0.9 * q;
              const a = aC + sgn * (q - 0.5) * 0.34;
              if (ss >= 0.012) here.push([ss, a, -0.14]);
              else if (seg > 1) back.push([1 + ss, a, -0.14]);
            }
            const style = st(S.wrinkle, { tone: lerp(0.12, 0.92, taut), phase: nextPhase() });
            if (here.length > 2) out.push({ on: 'digit', d, seg, pts: here, style });
            if (back.length > 2) out.push({
              on: 'digit', d, seg: seg - 1, pts: back,
              style: st(S.wrinkle, { tone: style.tone / S.wrinkle.tone, phase: nextPhase() })
            });
          }
        }

        // ---- knuckle rim -------------------------------------------------
        // A bent joint presents a hard dorsal corner where the skin turns off
        // the head onto the phalanx. On a closed hand this rim is the strongest
        // mark on the whole back of the digit, and the wrinkle sets above have
        // by then been drawn taut and erased — so without it a fist has nothing
        // describing its joints at all.
        if (f > 0.26 && jn !== 'DIP') {
          const k = (f - 0.26) / 0.74;
          for (let r = 0; r < (k > 0.55 ? 2 : 1); r++) {
            const pts = [];
            const span = 0.90 - r * 0.16;
            for (let q2 = 0; q2 <= 18; q2++) {
              const q = q2 / 18;
              const a = DORSAL + (q * 2 - 1) * span;
              pts.push([0.015 + r * 0.055 + 0.022 * (1 - Math.pow(q * 2 - 1, 2)), a, 0.18]);
            }
            out.push({
              on: 'digit', d, seg, pts,
              style: st(S.crease, {
                tone: (0.34 + 0.95 * k) * (r ? 0.52 : 1), weight: 0.95 - r * 0.2, phase: nextPhase()
              })
            });
          }
        }
      }

      // ---- knuckle pads --------------------------------------------------
      // The skin over an interphalangeal joint is thicker and coarser than the
      // skin either side of it, and reads as a patch of texture rather than as
      // a line. It is what stops an extended finger drawing as a plain tube.
      for (let seg = 2; seg < nSeg; seg++) {
        const jn = dg.joints[seg].name;
        const flex = dg.joints[seg].flex;
        const taut = clamp01(1 - flexFrac(A, d, jn, Math.max(0, flex)) * 1.3);
        if (taut < 0.15) continue;
        // A lozenge mesh of short crossing marks, scattered. Drawn as evenly
        // spaced arcs instead it reads as a bandage wrapped round the finger.
        const nP = Math.round(16 + taut * 14);
        for (let i = 0; i < nP; i++) {
          const s0 = rng.range(-0.055, 0.135);
          const a0 = DORSAL + rng.sym(0.62);
          const L = rng.range(0.030, 0.058);
          const lean = rng.chance(0.5) ? 1 : -1;
          const skew = (0.16 + rng.range(0, 0.10)) * lean;
          out.push({
            on: 'digit', d, seg,
            pts: [[s0 - L * 0.5, a0 - skew, -0.05], [s0, a0, -0.05], [s0 + L * 0.5, a0 + skew, -0.05]],
            style: st(S.hatch, { tone: (0.8 + 0.9 * rng.f()) * taut, phase: nextPhase() })
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
    // ---- the first web -------------------------------------------------
    // Two regimes, and they look nothing alike. Adducted, the skin of the
    // commissure has surplus and buckles across the line of compression into
    // folds stacked back from the margin. Abducted, it is a taut sheet and
    // what shows is the pull running from the depth of the commissure out to
    // the margin. The margin itself the renderer draws as a contour, so it is
    // not repeated here.
    const sheet = webSheet(rig);
    const web = sheet.at, open = sheet.open;
    const wRng = new M.Rng(A.seed ^ 0x7b21);
    const gathered = 1 - open;

    const nFold = Math.round(gathered * 4);
    for (let i = 0; i < nFold; i++) {
      const t0 = 0.93 - i * 0.11;
      const pts = [];
      for (let j = 0; j <= 18; j++) {
        const k = lerp(0.12, 0.88, j / 18);
        // a slack fold hangs toward the margin at its middle
        const t = t0 + 0.05 * gathered * Math.sin(Math.PI * inv(k, 0.12, 0.88));
        pts.push(web(t, k, 1.1 + i * 0.25));
      }
      out.push({
        on: 'world', pts,
        style: st(S.crease, {
          tone: (0.50 + 0.90 * gathered) * (1 - i * 0.18), phase: nextPhase()
        })
      });
    }

    const nTaut = Math.round(open * 4);
    for (let i = 0; i < nTaut; i++) {
      const k0 = 0.24 + 0.54 * (i / Math.max(1, nTaut - 1)) + wRng.sym(0.05);
      // each pull runs its own length: a sheet under tension does not crease
      // in a comb of equal strokes
      const tA = 0.44 + wRng.f() * 0.14, tB = 0.86 + wRng.f() * 0.08;
      const pts = [];
      for (let j = 0; j <= 12; j++) {
        const t = lerp(tA, tB, j / 12);
        // the pull fans as it runs out, the way a sheet does off two anchors
        const k = k0 + (k0 - 0.5) * 0.26 * inv(t, tA, tB);
        pts.push(web(t, k, 1.1));
      }
      out.push({
        on: 'world', pts,
        style: st(S.fold, {
          tone: (0.34 + 0.62 * open) * (0.7 + 0.5 * wRng.f()), phase: nextPhase()
        })
      });
    }
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
      // The bone ends at s = 1 but the fingertip does not: the pulp and the
      // nail carry on past it. A free edge placed at the bone's end leaves the
      // nail stranded in the middle of the phalanx.
      const sB = 1 + AN.tipExtent(A, d) * (0.46 + 0.38 * N.free);
      const sA = sB - N.len;                          // proximal fold
      const w = 0.95 * N.wide + 0.18;                 // half-width in alpha
      const off = 0.55 * N.curve;                     // the plate stands proud

      const bowP = 0.055 * N.curve;   // proximal fold arcs distally at the sides
      const bowD = 0.050;             // free edge arcs distally at the centre

      // The plate as one closed outline. Drawn as four edges — proximal fold,
      // free edge and two straight sides — it meets at square corners and
      // reads as a sticker. A nail is a rounded rectangle with a strong free
      // edge, narrowing a little toward the cuticle.
      const sMid = (sA + sB) * 0.5, sHalf = (sB - sA) * 0.5;
      const plate = [];
      const NN = 64;
      for (let i = 0; i <= NN; i++) {
        const th = (i / NN) * TAU;
        const c = Math.cos(th), sn = Math.sin(th);
        // superelliptical corners
        const cx = Math.sign(c) * Math.pow(Math.abs(c), 0.60);
        const cy = Math.sign(sn) * Math.pow(Math.abs(sn), 0.60);
        const taperW = 0.88 + 0.12 * (cx * 0.5 + 0.5);     // narrower at the fold
        const bow = cx >= 0 ? -bowD * (1 - Math.abs(cy)) : bowP * (1 - Math.abs(cy));
        plate.push([sMid + sHalf * cx + bow, DORSAL + w * cy * taperW, off]);
      }
      out.push({ on: 'digit', d, seg, pts: plate, style: st(S.nail, { tone: 1.10, phase: nextPhase() }) });

      // the free edge again, pressed harder: it is the one hard line a nail has
      const freeEdge = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const cy = (t * 2 - 1) * 0.82;
        freeEdge.push([sB - bowD * (1 - Math.abs(cy)), DORSAL + w * cy, off]);
      }
      out.push({ on: 'digit', d, seg, pts: freeEdge, style: st(S.nail, { tone: 1.25, phase: nextPhase() }) });

      // hyponychium: where the plate lifts off the skin
      if (N.free > 0.05) {
        const hy = [];
        for (let i = 0; i <= 18; i++) {
          const t = i / 18;
          const cy = (t * 2 - 1) * 0.80;
          hy.push([sB - N.free * 0.32 - bowD * 0.9 * (1 - Math.abs(cy)), DORSAL + w * cy, off]);
        }
        out.push({ on: 'digit', d, seg, pts: hy, style: st(S.nailFine, { tone: 1.05, phase: nextPhase() }) });
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
        style: st(S.palmRidge, { tone: 0.40 + 0.28 * rng.f(), phase: nextPhase() })
      });
    }
  }


  // =========================================================================
  //  F2 · THE FORM OF A DIGIT, AS TONE
  // =========================================================================

  /**
   * Where the light comes from.
   *
   * Two parts, and both are needed. A lamp fixed to the hand is what makes
   * the hand and whatever it is holding answer to one light, and what gives a
   * pose its own consistent modelling however it is turned. On its own it
   * fails badly: fixed to the hand, the light ends up behind the camera from
   * some directions, and a form lit down the axis you are looking along has
   * no visible shadow at all. Measured on a resting hand at azimuth 250, one
   * section in sixty-four came out both turned from the light and facing the
   * eye - the fingers drew as bare tubes, which is the complaint this exists
   * to answer.
   *
   * So most of it is a studio light instead: sixty-odd degrees off the camera
   * axis, and the offset mostly sideways rather than up. That matters more
   * than it sounds - fingers run up the page, so a light raised above the
   * camera is displaced ALONG the form, and a terminator along the form is
   * one nobody can see. Raked across instead, it cuts every finger at a
   * slant. Left and a little high, which is where a right-handed draughtsman
   * puts the lamp so their own hand does not shadow the page.
   */
  function lightDir(rig, view) {
    const hand = M.vnorm(M.vadd(M.vmul(rig.root[0], -0.18),
      M.vadd(M.vmul(rig.root[1], -0.86), M.vmul(rig.root[2], 0.48))));
    if (!view || !view.u) return hand;
    // Seventy-five degrees, not forty-five. On a cylinder the drawable
    // shadow runs from the terminator to the silhouette, and how much of the
    // page that covers falls away fast as the lamp swings toward the camera:
    // at forty-five degrees it is the outer sixth of a finger's width, which
    // reads as a line drawn beside the edge rather than as a form turning.
    // At seventy-five it is nearly two thirds, and the finger goes round.
    const key = M.vnorm(M.vadd(M.vmul(view.e, 0.26),
      M.vadd(M.vmul(view.u, 0.36), M.vmul(view.r, -0.90))));
    return M.vnorm(M.vlerp(hand, key, 0.80));
  }

  /**
   * A finger is a cylinder, and nothing in an outline says so.
   *
   * Two rails and a dome are the same drawing whether the form between them
   * is round, flat or hollow - which is why a finger drawn as outline alone
   * reads as a length of pipe. What says "round" is tone: a band that begins
   * at the terminator, deepens as the surface turns away, and eases off again
   * right at the edge, where light bouncing back off whatever the hand is
   * over creeps round the form. That last easing is the whole of it. A shadow
   * running solid to the silhouette flattens the finger into a cut-out; a
   * shadow that lifts before it gets there puts air behind the form.
   *
   * Two things have to be got right about where the marks go.
   *
   * The band is the arc that is turned from the light AND still facing the
   * eye - not the arc that is dark. Most of what is dark is round the back,
   * and a stroke put there costs the same as one on the paper and is thrown
   * away by the visibility test.
   *
   * And within that arc, marks are spaced by how much of the PAGE each step
   * covers rather than by angle. The far end of the band is turning away, so
   * it projects to a sliver; spread evenly round the section, every stroke
   * piles against the silhouette in a stack that reads as a liner drawn round
   * the edge. Spaced by projected width, the shadow opens out across the
   * finger the way it does on the thing itself.
   *
   * Built as an accumulation rather than a value: three passes over the same
   * band, each shorter and narrower than the last, so the paper ends up with
   * one stroke in the half-light, two where it turns and three in the core.
   */
  function digitShading(rig, view, out, amount) {
    const A = rig.anatomy;
    const amt = amount === undefined ? 1 : amount;
    if (amt <= 0.02) return;
    const rngRoot = new M.Rng(A.seed ^ 0x7a11);
    const L = lightDir(rig, view);
    const NA = 64, HZ = 0.12;

    const bandAt = (d, seg, s) => {
      const lam = new Float64Array(NA), fac = new Float64Array(NA);
      let any = false;
      for (let k = 0; k < NA; k++) {
        const n = R.digitNormal(rig, d, seg, s, (k / NA) * Math.PI * 2);
        lam[k] = M.vdot(n, L);
        fac[k] = view ? M.vdot(n, view.e) : 1;
        if (lam[k] < 0.02 && fac[k] > HZ) any = true;
      }
      if (!any) return null;
      const wrap = (k) => ((k % NA) + NA) % NA;
      const ok = (k) => lam[wrap(k)] < 0.02 && fac[wrap(k)] > HZ;
      let k0 = 0;
      while (!ok(k0)) k0++;
      let g = 0;
      while (ok(k0 - 1) && g++ < NA) k0--;
      let k1 = k0; g = 0;
      while (ok(k1 + 1) && g++ < NA) k1++;
      if (k1 - k0 < 2) return null;
      const T = Math.PI * 2 / NA;
      // run the band from the terminator - the end the light has only just
      // left - toward the silhouette, so a fraction across it means the same
      // thing at every section along the bone
      const flip = Math.abs(lam[wrap(k0)]) >= Math.abs(lam[wrap(k1)]);
      const ks = [], cum = [0];
      for (let k = k0; k <= k1; k++) ks.push(flip ? k1 - (k - k0) : k);
      for (let i = 1; i < ks.length; i++) {
        cum.push(cum[i - 1] + Math.max(0.05, fac[wrap(ks[i])]));
      }
      const total = cum[cum.length - 1] || 1;
      let lo = 9;
      for (const k of ks) lo = Math.min(lo, lam[wrap(k)]);
      const alphaOf = (t) => {
        const want = clamp01(t) * total;
        let i = 0;
        while (i < cum.length - 2 && cum[i + 1] < want) i++;
        const f = (want - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
        return (ks[i] + (ks[i + 1] - ks[i]) * f) * T;
      };
      return { alphaOf, lo };
    };

    for (let dd = 0; dd < 5; dd++) {
      const rng = rngRoot.fork(dd * 11 + 5);
      for (const sg of rig.digits[dd].segs) {
        if (!sg.rendered) continue;
        // The thumb's metacarpal is thenar mass. The palm models it; a
        // cylinder's shading laid over it would carve a tube out of the ball
        // of the thumb, which is the one place on a hand there isn't one.
        if (dd === AN.THUMB && sg.seg === 0) continue;
        // read the band at a few stations, so a stroke can follow the
        // terminator as it walks round a bending bone
        const NB = 5, stn = [];
        for (let i = 0; i <= NB; i++) {
          const sv = lerp(sg.sMin, Math.min(sg.sMax, 1.02), i / NB);
          stn.push({ sv, b: bandAt(dd, sg.seg, sv) });
        }
        const have = stn.filter(z => z.b);
        if (have.length < 3) continue;
        for (const z of stn) if (!z.b) z.b = have[0].b;
        const lo = have.reduce((m, z) => Math.min(m, z.b.lo), 9);
        const depth = clamp01(-lo / 0.9);

        const alphaAt = (sv, t) => {
          let i = 0;
          while (i < stn.length - 2 && stn[i + 1].sv < sv) i++;
          let a = stn[i].b.alphaOf(t), b = stn[i + 1].b.alphaOf(t);
          while (b - a > Math.PI) b -= Math.PI * 2;
          while (a - b > Math.PI) b += Math.PI * 2;
          const f = clamp01((sv - stn[i].sv) / Math.max(1e-6, stn[i + 1].sv - stn[i].sv));
          return lerp(a, b, f);
        };
        // up out of the light at the terminator, held through the turn, and
        // lifted again at the very edge for the light coming back round
        const value = (t) => M.smoothstep(clamp01(t / 0.30)) *
          (1 - 0.55 * M.smoothstep(clamp01((t - 0.80) / 0.20)));

        const PASS = [
          { n: 8, t0: 0.02, t1: 0.98, span: [0.06, 0.96], tone: 0.62 },
          { n: 6, t0: 0.20, t1: 0.90, span: [0.18, 0.88], tone: 0.74 },
          { n: 4, t0: 0.36, t1: 0.80, span: [0.28, 0.78], tone: 0.90 },
        ];
        for (let p = 0; p < PASS.length; p++) {
          const P = PASS[p];
          if (depth < p * 0.20) continue;
          const n = Math.max(2, Math.round(P.n * (0.55 + 0.45 * depth) * amt));
          for (let i = 0; i < n; i++) {
            const t = P.t0 + (P.t1 - P.t0) * ((i + 0.5) / n) + rng.sym(0.030);
            const v = value(clamp01(t));
            if (v < 0.10) continue;
            const s0 = lerp(sg.sMin, sg.sMax, P.span[0] + rng.f() * 0.18);
            const s1 = lerp(sg.sMin, sg.sMax, P.span[1] - rng.f() * 0.18);
            if (s1 - s0 < 0.12) continue;
            const pts = [];
            const NP = 12;
            for (let k = 0; k <= NP; k++) {
              const q = k / NP;
              const sv = lerp(s0, s1, q);
              // each stroke wanders off the band's own parallel: a set of
              // exact parallels is a screen, not a shadow
              const drift = rng.sym(0.034) * Math.sin(q * Math.PI) + (p - 1) * 0.018;
              pts.push([sv, alphaAt(sv, clamp01(t + drift)), -0.10]);
            }
            out.push({
              on: 'digit', d: dd, seg: sg.seg, pts,
              style: st(S.model, {
                tone: P.tone * v * (0.45 + 0.55 * depth) * amt, phase: nextPhase()
              })
            });
          }
        }
        // Short obliques through the core only. A crossing that runs the
        // whole length is a plaid; a few laid across the darkest part are
        // what keep a deep shadow from going flat and grey.
        if (depth > 0.42) {
          const nX = Math.max(1, Math.round(3 * depth * amt));
          for (let i = 0; i < nX; i++) {
            const sc = lerp(sg.sMin, Math.min(sg.sMax, 1.0), 0.24 + rng.f() * 0.56);
            const tc = 0.52 + rng.sym(0.16);
            const pts = [];
            for (let k = 0; k <= 6; k++) {
              const q = k / 6;
              pts.push([sc + (q - 0.5) * 0.22, alphaAt(sc, clamp01(tc + (q - 0.5) * 0.40)), -0.09]);
            }
            out.push({
              on: 'digit', d: dd, seg: sg.seg, pts,
              style: st(S.model, { tone: 0.70 * depth * amt, phase: nextPhase() })
            });
          }
        }
      }
    }
  }

  // =========================================================================
  //  G · WHAT THE HAND IS HOLDING
  // =========================================================================

  /**
   * The surface of a held ball.
   *
   * A bare circle is not a sphere - it is a hole in the paper - and the only
   * thing that makes it read as a solid is marks that follow its form. So the
   * hatching runs as circles about the light's own axis, which is what a
   * draughtsman does and what makes the curvature legible: the arcs crowd and
   * fatten as the surface turns away, and stop where it turns to face the
   * light.
   *
   * Two properties, because a ball is made of something.
   *
   * `roughness` is how the surface takes the pencil. At zero the arcs are
   * continuous and the silhouette is one clean line: a billiard ball. Raised,
   * the arcs break into dashes, wander off their circles, and the silhouette
   * frays - stone, or a worn tennis ball. It also brings up a stipple, which
   * a smooth ball has none of.
   *
   * `anisotropy` is whether the surface has a grain. At zero the arcs are
   * true circles about the light and the ball reads as uniform. Raised, they
   * stretch along one axis of the ball's own frame, so the form still reads
   * but the material has a direction to it - wound thread, brushed metal,
   * the seam-ward grain of a leather ball.
   */
  function heldBall(rig, view, out, detail) {
    const b = rig.ball;
    if (!b) return;
    const amt = detail && detail.ball !== undefined ? detail.ball : 1;
    if (amt <= 0.02) return;
    const rough = clamp01(b.roughness === undefined ? 0.25 : b.roughness);
    const aniso = clamp01(b.anisotropy === undefined ? 0 : b.anisotropy);
    const rng = new M.Rng((rig.anatomy.seed ^ 0x5bb1) >>> 0);
    const noise = new M.Noise((rig.anatomy.seed ^ 0x2f7d) >>> 0);

    // The light, in the hand's own frame rather than the camera's, because a
    // ball is lit by a room and not by whoever is looking at it. From the
    // palm side, up and to the radial side: a ball held in a hand is nearly
    // always seen from the palm, and lighting it from behind there leaves the
    // whole visible face in shadow and the drawing reading as a dark disc.
    // Strongly to one side rather than square on. A light behind the ball
    // leaves the whole visible face in shadow; a light straight down the eye
    // leaves it bare, and a bare circle is a hole in the paper. Across the
    // form is the only place a terminator lands where it can be seen, which
    // is the whole point of drawing one.
    const L = lightDir(rig, view);
    // a frame about it, and the grain direction the anisotropy stretches along
    const T0 = M.vnorm(M.vcross(L, rig.root[0]));
    const T1 = M.vnorm(M.vcross(L, T0));
    const grainAx = rig.root[1];

    // Arcs at constant angle from the light. Past 90 degrees the surface has
    // turned away; the terminator is where the tone has to start, and it
    // thickens from there into the far limb.
    const N = Math.round(lerp(7, 16, amt) * (1 - aniso * 0.25));
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const th = lerp(Math.PI * 0.40, Math.PI * 0.99, t);
      const shade = Math.pow(t, 0.72);
      const pts = [];
      const NP = 84;
      for (let k = 0; k <= NP; k++) {
        const ph = (k / NP) * M.TAU;
        // stretch the circle along the grain: the form still reads, the
        // material gains a direction
        const wob = rough * 0.055 * (noise.n2(Math.cos(ph) * 2.2 + i * 3.1,
          Math.sin(ph) * 2.2) - 0.5) * 2;
        const a = th + wob;
        let dir = M.vadd(M.vmul(T0, Math.cos(ph)), M.vmul(T1, Math.sin(ph)));
        if (aniso > 0.01) {
          const along = M.vdot(dir, grainAx);
          dir = M.vnorm(M.vadd(dir, M.vmul(grainAx, along * aniso * 1.35)));
        }
        const P = M.vadd(b.C, M.vmul(M.vadd(M.vmul(L, Math.cos(a)),
          M.vmul(dir, Math.sin(a))), b.r * 1.002));
        pts.push(P);
      }
      // rough surfaces do not take a continuous line
      const runs = rough < 0.12 ? [pts] : dash(pts, rng, rough);
      for (const run of runs) {
        if (run.length < 3) continue;
        out.push({
          on: 'world', pts: run,
          style: st(S.hatch, {
            tone: (0.55 + 1.5 * shade) * amt * (0.8 + 0.4 * rng.f()),
            weight: lerp(1.0, 1.5, shade),
            wobble: 0.8 + rough * 1.9, jitter: 0.3 + rough * 1.5,
            phase: nextPhase()
          })
        });
      }
    }

    // stipple, which only a rough ball has
    const nDots = Math.round(rough * rough * 520 * amt);
    for (let i = 0; i < nDots; i++) {
      const u = rng.f() * 2 - 1, ph = rng.f() * M.TAU;
      const sr = Math.sqrt(Math.max(0, 1 - u * u));
      const dir = M.vadd(M.vmul(T0, Math.cos(ph) * sr), M.vmul(T1, Math.sin(ph) * sr));
      const n = M.vadd(M.vmul(L, u), dir);
      const lit = M.vdot(n, L);
      if (lit > 0.35 - rough * 0.3) continue;      // the lit side stays bare
      const P = M.vadd(b.C, M.vmul(n, b.r * 1.002));
      const q = M.vmad(P, M.vnorm(M.vcross(n, L)), 0.5 + rng.f() * 1.1);
      out.push({
        on: 'world', pts: [P, q],
        style: st(S.hatch, { tone: 0.5 + 1.1 * rng.f(), weight: 0.8, phase: nextPhase() })
      });
    }
  }

  /** break a path into dashes, the way a rough surface breaks a pencil line */
  function dash(pts, rng, rough) {
    const runs = [];
    let cur = [];
    for (const p of pts) {
      cur.push(p);
      if (cur.length > 4 && rng.f() < 0.035 + rough * 0.10) {
        runs.push(cur);
        cur = [];
        const skip = 1 + Math.floor(rng.f() * (1 + rough * 5));
        for (let s = 0; s < skip; s++) cur.push(null);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    return runs;
  }

  GK.features = {
    S, st, nextPhase, PALMAR, DORSAL, betaForV, palmCurve, uvSpline, flexFrac,
    digitFolds, digitShading, lightDir, webs, nails, fingerprints, palmCreases, palmRidges, streamlines, printField,
    heldBall
  };
})(window.GK = window.GK || {});
