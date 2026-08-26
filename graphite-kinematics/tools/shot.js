// Offline render harness: node tools/shot.js <preset> <seed> <az> <el> [out] [size]
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose','40-pencil','50-features','55-dorsal','60-render']
  .forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, DEG = G.math.DEG;
const writePNG = require('./png.js');

const args = process.argv.slice(2);
const presetKey = args[0] || 'rest';
const seed = parseInt(args[1] || '12345');
const az = parseFloat(args[2] || '0') * DEG;
const el = parseFloat(args[3] || '0') * DEG;
const out = args[4] || '/tmp/hand.png';
const size = parseInt(args[5] || '900');
const quality = parseInt(process.env.Q || '1');

const A = G.anatomy.buildAnatomy(seed);
const pose = G.pose.preset(A, presetKey);
const r = new G.render.Renderer(size, size);
const t0 = Date.now();
const built = r.draw({
  seed, pose,
  view: { az, el, roll: 0, zoom: 1 },
  style: { grade: 3, tone: 1, wobble: 1, ghost: parseFloat(process.env.GHOST===undefined?'0.20':process.env.GHOST), search: parseFloat(process.env.SEARCH===undefined?'0.55':process.env.SEARCH) },
  detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
  layers: JSON.parse(process.env.LAYERS || 'null') || undefined,
  quality
});
const px = r.resolve({ style: {} });
writePNG(out, px, size, size);
console.log(presetKey, 'seed', seed, '| curves', built.curves.length, '| draw', built.ms + 'ms', '| total', (Date.now()-t0)+'ms ->', out);
