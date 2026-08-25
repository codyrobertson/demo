// Does a digit's traced outline actually contain the digit?
//
// The silhouette is the border of what the digit covers, so the check is the
// definition: sample the surface, project it, and every sample must land
// inside the outline. A point outside means the outline has cut a piece of
// the finger off - which on paper is a tube sliced square, a tip floating
// free of its shaft, or an edge ruled across a form. It also checks the
// outline closes and takes no jumps, since a broken loop draws as a gap.
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, M = G.math, RG = G.rig, PO = G.pose, DEG = M.DEG;

// signed distance from p to a closed polyline: negative inside
function sdf(p, poly) {
  let d = 1e9, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy;
    let t = L2 > 1e-12 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)));
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

const POSES = ['rest', 'flat', 'fist', 'point', 'claw', 'pinch', 'hook', 'cup', 'spread', 'countThree'];
let outside = [], gaps = 0, unused = 0, worst = 0, worstWhat = '', n = 0;
for (const seed of [12345, 777, 4242, 99]) {
  const A = G.anatomy.buildAnatomy(seed);
  const r = new G.render.Renderer(900, 900);
  for (const name of POSES) {
    for (const az of [180, 140, 220, 90, 260]) {
      for (const el of [0, 35, -35, 70]) {
        const { rig, view } = r.draw({
          seed, pose: PO.preset(A, name),
          view: { az: az * DEG, el: el * DEG, roll: 0, zoom: 1 },
          style: { grade: 3, tone: 1, wobble: 0, ghost: 0, search: 0 },
          detail: { print: 0, ridge: 0, lattice: 0, hair: 0, vein: 0 }, quality: 0.4,
        });
        for (let d = 0; d < 5; d++) {
          const sil = RG.digitSilhouette(rig, view, d);
          n++;
          if (!sil.use) { unused++; continue; }
          const o = sil.outline;
          // closed, and no jumps: a resampled border steps evenly
          const close = Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]);
          // relative, not absolute: the loop is resampled evenly, so a break
          // shows as one step far longer than the rest whatever its size.
          let jump = 0, span = 0;
          for (let i = 1; i < o.length; i++) {
            const s2 = Math.hypot(o[i][0] - o[i - 1][0], o[i][1] - o[i - 1][1]);
            span += s2; if (s2 > jump) jump = s2;
          }
          if (close > 3 || jump > (span / (o.length - 1)) * 3.5) gaps++;
          // and it contains the surface it was traced from
          let far = 0;
          for (const sg of rig.digits[d].segs) {
            if (!sg.rendered) continue;
            for (let i = 0; i <= 5; i++) {
              const sv = sg.sMin + (sg.sMax - sg.sMin) * (i / 5);
              for (let k = 0; k < 10; k++) {
                const q = RG.digitSurface(rig, d, sg.seg, sv, (k / 10) * Math.PI * 2).P;
                far = Math.max(far, sdf(view.px(q), o));
              }
            }
          }
          outside.push(Math.max(0, far));
          if (far > worst) { worst = far; worstWhat = `${seed} ${name} az${az} el${el} ${rig.digits[d].name}`; }
        }
      }
    }
  }
}
outside.sort((a, b) => a - b);
const q = (f) => outside[Math.min(outside.length - 1, Math.floor(outside.length * f))].toFixed(2);
console.log(`${n} digit-views, ${unused} with nothing rendered`);
console.log(`surface outside its own outline (px):  median ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${worst.toFixed(2)}`);
console.log(`  worst: ${worstWhat}`);
console.log(`broken or jumping loops: ${gaps}`);
const bad = worst > 4 || gaps > 0;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
