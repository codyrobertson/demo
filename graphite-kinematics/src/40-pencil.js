/* ============================================================================
   GRAPHITE KINEMATICS — 40 · pencil
   A graphite deposition field. Marks are not composited, they are *added*:
   density accumulates into a float buffer and is tone-mapped once, at the end,
   through a saturating response. Overlapping passes therefore darken exactly
   as layered graphite darkens, and never as stacked opacity.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const { clamp, clamp01, lerp, smoothstep } = M;

  // Pencil grades: nib radius, deposit strength, grain break-up, wobble scale.
  //            2H     H      HB      B      2B      4B      6B
  const GRADES = [
    { name: '2H', nib: 0.46, dep: 0.52, grain: 0.86, wob: 0.62 },
    { name: 'H', nib: 0.55, dep: 0.66, grain: 0.78, wob: 0.72 },
    { name: 'HB', nib: 0.68, dep: 0.82, grain: 0.68, wob: 0.85 },
    { name: 'B', nib: 0.84, dep: 1.00, grain: 0.58, wob: 1.00 },
    { name: '2B', nib: 1.02, dep: 1.20, grain: 0.48, wob: 1.16 },
    { name: '4B', nib: 1.28, dep: 1.46, grain: 0.38, wob: 1.34 },
    { name: '6B', nib: 1.62, dep: 1.78, grain: 0.30, wob: 1.55 }
  ];

  function gradeAt(x) {
    const f = clamp(x, 0, GRADES.length - 1.001);
    const i = Math.floor(f), t = f - i;
    const a = GRADES[i], b = GRADES[Math.min(GRADES.length - 1, i + 1)];
    return {
      name: t < 0.5 ? a.name : b.name,
      nib: lerp(a.nib, b.nib, t), dep: lerp(a.dep, b.dep, t),
      grain: lerp(a.grain, b.grain, t), wob: lerp(a.wob, b.wob, t)
    };
  }

  class Graphite {
    /**
     * @param w,h  logical canvas size
     * @param ss   supersample factor (1 for draft, 2 for the finished plate)
     */
    constructor(w, h, ss, seed) {
      this.resize(w, h, ss, seed);
    }

    resize(w, h, ss, seed) {
      ss = Math.max(1, Math.round(ss || 1));
      const W = Math.round(w * ss), H = Math.round(h * ss);
      if (this.W === W && this.H === H && this.seed === seed) { this.clear(); return this; }
      this.w = w; this.h = h; this.ss = ss; this.W = W; this.H = H; this.seed = seed;
      this.buf = new Float32Array(W * H);
      this.rgba = new Uint8ClampedArray(w * h * 4);
      this._buildPaper();
      return this;
    }

    /** paper tooth: fine grain over a coarse undulation, generated once */
    _buildPaper() {
      const { W, H } = this;
      const n = new M.Noise(this.seed ^ 0x5f3a);
      // coarse undulation at 1/4 resolution, bilinearly upsampled
      const CW = Math.ceil(W / 4) + 2, CH = Math.ceil(H / 4) + 2;
      const coarse = new Float32Array(CW * CH);
      for (let y = 0; y < CH; y++) {
        for (let x = 0; x < CW; x++) {
          coarse[y * CW + x] = n.fbm(x * 0.055, y * 0.055, 3.7, 3, 0.55, 2.1);
        }
      }
      const tooth = new Float32Array(W * H);
      // deterministic per-pixel hash for the tooth itself
      const s0 = (this.seed >>> 0) || 1;
      for (let y = 0; y < H; y++) {
        const cy = y / 4, y0 = cy | 0, fy = cy - y0;
        for (let x = 0; x < W; x++) {
          const cx = x / 4, x0 = cx | 0, fx = cx - x0;
          const c00 = coarse[y0 * CW + x0], c10 = coarse[y0 * CW + x0 + 1];
          const c01 = coarse[(y0 + 1) * CW + x0], c11 = coarse[(y0 + 1) * CW + x0 + 1];
          const c = lerp(lerp(c00, c10, fx), lerp(c01, c11, fx), fy);
          let hsh = (x * 374761393 + y * 668265263 + s0 * 2246822519) >>> 0;
          hsh = (hsh ^ (hsh >>> 13)) >>> 0;
          hsh = Math.imul(hsh, 1274126177) >>> 0;
          const fine = ((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296;
          tooth[y * W + x] = 0.34 + 0.52 * fine + 0.42 * c;
        }
      }
      this.tooth = tooth;
      this.noise = n;
      return this;
    }

    clear() { this.buf.fill(0); return this; }

    /** deposit into the field; x,y in supersampled space */
    splat(x, y, r, amt) {
      const { W, H, buf, tooth } = this;
      if (!(amt > 0)) return;
      const rr = r * r;
      const R = Math.ceil(r);
      const x0 = Math.max(0, (x - R) | 0), x1 = Math.min(W - 1, (x + R + 1) | 0);
      const y0 = Math.max(0, (y - R) | 0), y1 = Math.min(H - 1, (y + R + 1) | 0);
      if (x1 < x0 || y1 < y0) return;
      // quartic kernel, normalised so peak deposit is independent of radius
      const k = amt * 3.05 / (rr + 0.35);
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - y;
        const row = yy * W;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + 0.5 - x;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr) continue;
          const t = 1 - d2 / rr;
          const i = row + xx;
          buf[i] += k * t * t * tooth[i];
        }
      }
    }

    /**
     * Lay a stroke along a 2-D polyline.
     * pts     [[x,y],...] in logical canvas pixels
     * o.tone      base darkness 0..1+
     * o.weight    nib radius multiplier
     * o.passes    overlapping passes (contour 3, crease 2, detail 1)
     * o.taper     entry/exit lift, 0..1
     * o.wobble    low-frequency deviation in logical px
     * o.jitter    per-pass lateral offset in logical px
     * o.grade     pencil grade descriptor from gradeAt()
     * o.vis       array of per-point visibility 0..1, or a function(i,t)
     * o.press     optional function(t) -> extra pressure
     * o.phase     decorrelates the wobble between strokes
     * o.close     treat the path as closed (no taper)
     */
    stroke(pts, o) {
      if (!pts || pts.length < 2) return;
      o = o || {};
      const ss = this.ss;
      const g = o.grade || gradeAt(3);
      const tone = (o.tone === undefined ? 1 : o.tone) * g.dep;
      if (tone <= 0.0015) return;
      const weight = (o.weight === undefined ? 1 : o.weight) * g.nib;
      const passes = Math.max(1, o.passes || 1);
      const taper = o.taper === undefined ? 0.55 : o.taper;
      const wobble = (o.wobble === undefined ? 1 : o.wobble) * g.wob;
      const jitter = o.jitter === undefined ? 0.55 : o.jitter;
      const grain = o.grain === undefined ? 1 : o.grain;
      const phase = o.phase || 0;
      const n = this.noise;
      const vis = o.vis, press = o.press;

      // Per-point visibility is supplied against the *incoming* points; the
      // path is about to be resampled, so build an arclength lookup first or
      // occlusion would smear along the whole mark.
      let visAt = null;
      if (vis && typeof vis !== 'function') {
        const srcT = new Float32Array(pts.length);
        let sl = 0;
        for (let i = 1; i < pts.length; i++) {
          sl += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          srcT[i] = sl;
        }
        if (sl > 1e-9) { for (let i = 0; i < pts.length; i++) srcT[i] /= sl; }
        visAt = (t) => {
          let lo = 0, hi = srcT.length - 1;
          if (t <= 0) return vis[0];
          if (t >= 1) return vis[hi];
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (srcT[m] <= t) lo = m; else hi = m; }
          const span = srcT[hi] - srcT[lo];
          const f = span > 1e-9 ? (t - srcT[lo]) / span : 0;
          return vis[lo] + (vis[hi] - vis[lo]) * f;
        };
      }

      // resample to a fixed deposition spacing in supersampled space
      const spacing = 0.85;
      const path = M.resample(pts, spacing / ss);
      const NP = path.length;
      if (NP < 2) return;

      // arclength parameter and per-point normals
      const tArr = new Float32Array(NP);
      let L = 0;
      for (let i = 1; i < NP; i++) {
        L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        tArr[i] = L;
      }
      if (L < 1e-6) return;
      for (let i = 0; i < NP; i++) tArr[i] /= L;

      const Lpx = L * ss;
      // short marks keep their weight; long ones may modulate along the run
      for (let p = 0; p < passes; p++) {
        const ph = phase + p * 17.31;
        // a whole-stroke lateral bias, as if the hand re-entered the line
        const bias = (n.n1(ph * 3.1 + 0.5) - 0.5) * 2 * jitter;
        const passTone = tone * (p === 0 ? 1 : lerp(0.86, 0.52, (p - 1) / Math.max(1, passes - 1)));
        // each pass covers a sub-span, as a searching hand does
        const p0 = p === 0 ? 0 : Math.max(0, (n.n1(ph * 5.7) - 0.55) * 0.30);
        const p1 = p === 0 ? 1 : Math.min(1, 1 - Math.max(0, (n.n1(ph * 5.7 + 9.1) - 0.55) * 0.30));

        for (let i = 0; i < NP; i++) {
          const t = tArr[i];
          if (t < p0 || t > p1) continue;
          const a = path[i], b = path[Math.min(NP - 1, i + 1)], c = path[Math.max(0, i - 1)];
          let dx = b[0] - c[0], dy = b[1] - c[1];
          const dl = Math.hypot(dx, dy) || 1;
          const nx = -dy / dl, ny = dx / dl;

          // low-frequency hand wobble along the run, plus the pass bias
          const wob = (n.n1(t * Lpx * 0.021 + ph) - 0.5) * 2 * wobble * 1.35 +
            (n.n1(t * Lpx * 0.075 + ph * 2.3) - 0.5) * 2 * wobble * 0.42 + bias;

          // pressure: lift at both ends, breathe in the middle
          let pr = 1;
          if (!o.close && taper > 0) {
            const span = clamp01(Math.min(t - p0, p1 - t) / Math.max(0.001, (p1 - p0)));
            const tt = clamp01(Math.min(t - p0, p1 - t) / (o.taperLen || 0.16));
            pr *= lerp(1 - taper, 1, Math.pow(tt, 0.62)) * (0.55 + 0.45 * smoothstep(span * 6));
          }
          pr *= 0.80 + 0.34 * n.n1(t * Lpx * 0.013 + ph * 0.77);
          if (press) pr *= press(t);

          let v = 1;
          if (visAt) v = visAt(t);
          else if (typeof vis === 'function') v = vis(i, t);
          if (v <= 0.002) continue;

          // grain: the nib skips where the paper is low
          const gk = n.n1(t * Lpx * 0.55 + ph * 4.1);
          const skip = g.grain * grain;
          const gmul = clamp01((gk - skip * 0.30) / (1 - skip * 0.30 + 1e-6)) * 0.55 + 0.55;

          const amt = passTone * pr * v * gmul;
          if (amt <= 0.002) continue;
          const rad = Math.max(0.34, weight * (0.80 + 0.42 * pr)) * ss;
          this.splat((a[0] + nx * wob) * ss, (a[1] + ny * wob) * ss, rad, amt * spacing);
        }
      }
    }

    /** a single short tick — cheaper than stroke() for ridges and hair */
    tick(x0, y0, x1, y1, o) {
      this.stroke([[x0, y0], [x1, y1]], o);
    }

    /**
     * Tone-map the density field into RGBA.
     * @param o.paper     [r,g,b] paper colour
     * @param o.ink       [r,g,b] darkest graphite
     * @param o.gamma     response curve of the deposit
     * @param o.k         saturation constant
     * @param o.sheen     specular lift of the very darkest passages
     * @param o.vignette  0..1
     */
    resolve(o) {
      o = o || {};
      const paper = o.paper || [244, 241, 232];
      const ink = o.ink || [26, 25, 23];
      const K = o.k === undefined ? 1.55 : o.k;
      const gamma = o.gamma === undefined ? 1.0 : o.gamma;
      const sheen = o.sheen === undefined ? 0.13 : o.sheen;
      const vig = o.vignette === undefined ? 0.30 : o.vignette;
      const grainAmt = o.paperGrain === undefined ? 0.030 : o.paperGrain;
      const { w, h, ss, W, buf, tooth, rgba } = this;
      const inv = 1 / (ss * ss);
      const cx = w * 0.5, cy = h * 0.5;
      const maxR = Math.hypot(cx, cy);
      // slightly cool, slightly lifted where the deposit is heaviest
      const sheenR = 62, sheenG = 64, sheenB = 72;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let d = 0;
          if (ss === 1) {
            d = buf[y * W + x];
          } else {
            for (let sy = 0; sy < ss; sy++) {
              const row = (y * ss + sy) * W + x * ss;
              for (let sx = 0; sx < ss; sx++) d += buf[row + sx];
            }
            d *= inv;
          }
          let v = 1 - Math.exp(-K * d);
          if (gamma !== 1) v = Math.pow(v, gamma);

          // paper: tooth grain and a soft vignette
          const tt = tooth[Math.min(W - 1, x * ss) + Math.min(this.H - 1, y * ss) * W];
          const pg = 1 - grainAmt * (tt - 0.72);
          const rr = Math.hypot(x - cx, y - cy) / maxR;
          const vg = 1 - vig * 0.16 * Math.pow(clamp01(rr * 1.12), 3.0);

          const sh = sheen * clamp01((v - 0.72) / 0.28);
          const ir = lerp(ink[0], sheenR, sh), ig = lerp(ink[1], sheenG, sh), ib = lerp(ink[2], sheenB, sh);

          const i = (y * w + x) * 4;
          rgba[i] = lerp(paper[0] * pg * vg, ir, v);
          rgba[i + 1] = lerp(paper[1] * pg * vg, ig, v);
          rgba[i + 2] = lerp(paper[2] * pg * vg, ib, v);
          rgba[i + 3] = 255;
        }
      }
      return this.rgba;
    }
  }

  GK.pencil = { Graphite, GRADES, gradeAt };
})(window.GK = window.GK || {});
