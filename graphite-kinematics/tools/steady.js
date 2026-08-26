// Does the same hand drawn twice come out the same drawing?
//
// It has to, or an animation boils: every stroke's wobble is decorrelated
// from its neighbours by a phase, and if that phase depends on anything but
// the mark's own identity then holding perfectly still still redraws the
// whole plate differently. That is not the same thing as a hand-drawn line
// having life in it - it is noise sitting on top of the movement, and it
// hides the movement.
//
// A wrong answer looks like: a nonzero difference in the first block, where
// nothing whatever has changed between the two renders. The second block is
// context rather than a check - it says how much a real change of a quarter
// of a degree moves, so the first number can be read against something.
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, M = G.math, DEG = M.DEG, PO = G.pose;

const S = 500;
const STYLE = { grade: 3, tone: 1, wobble: 1, ghost: 0.2, search: 0.55 };
const DET = { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 };

function shot(A, pose, az, el) {
  const r = new G.render.Renderer(S, S);
  r.draw({ seed: 12345, pose, view: { az: az * DEG, el: el * DEG, roll: 0, zoom: 1 },
    style: STYLE, detail: DET, quality: 1 });
  return r.resolve({ style: {} });
}
const changed = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 6) n++;
  return 100 * n / (S * S);
};

let worst = 0;
console.log('the same state, drawn twice');
for (const key of ['rest', 'fist', 'point', 'claw', 'cup', 'spread']) {
  for (const [az, el] of [[180, 0], [0, 0], [250, 15]]) {
    const A = G.anatomy.buildAnatomy(12345);
    const pose = PO.preset(A, key);
    const d = changed(shot(A, pose, az, el), shot(A, pose, az, el));
    if (d > worst) worst = d;
  }
  console.log('  ' + key.padEnd(8) + ' worst so far ' + worst.toFixed(3) + '%');
}
console.log('\nfor scale, a quarter of a degree of real movement:');
{
  const A = G.anatomy.buildAnatomy(12345);
  const pose = PO.preset(A, 'rest');
  console.log('  view  +0.25deg  ' + changed(shot(A, pose, 180, 0), shot(A, pose, 180.25, 0)).toFixed(2) + '%');
  const p2 = JSON.parse(JSON.stringify(pose));
  for (let d = 1; d < 5; d++) p2.digits[d].pipFlex += 0.25 * DEG;
  console.log('  joint +0.25deg  ' + changed(shot(A, pose, 180, 0), shot(A, p2, 180, 0)).toFixed(2) + '%');
}
console.log(worst > 0.01 ? 'FAIL' : 'ok');
process.exit(worst > 0.01 ? 1 : 0);
