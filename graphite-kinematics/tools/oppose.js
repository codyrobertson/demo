/* Read out an opposition pose as angles and contacts, so the four presets
   that bring the thumb to a finger can be authored by eye and checked by
   number instead of being handed to a search that hits the target and draws
   badly. Usage: node tools/oppose.js [preset ...] */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose'].forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, M = G.math, RG = G.rig, PO = G.pose, DEG = M.DEG;
const A = G.anatomy.buildAnatomy(parseInt(process.env.SEED || '12345'));
const TARGET = { pinch: 1, ok: 1, tripod: 2, grip: 2, clenchMax: 2 };
const NAMES = ['', 'index', 'middle', 'ring', 'little'];

const keys = process.argv.slice(2);
for (const k of (keys.length ? keys : Object.keys(TARGET))) {
  const tgt = TARGET[k] === undefined ? 1 : TARGET[k];
  const pose = PO.resolveContacts(A, PO.preset(A, k));
  const rig = RG.solve(A, pose);
  const d0 = rig.digits[0], dt = rig.digits[tgt];
  const tip = d0.tip, ftip = dt.tip;
  const dir = M.vnorm(M.vsub(ftip, tip));
  const tS = d0.segs[d0.segs.length - 1], fS = dt.segs[dt.segs.length - 1];
  const P = pose.digits[0];
  const deg = (v) => (v / DEG).toFixed(0).padStart(4);
  console.log(k.padEnd(10) +
    ' cmc rad' + deg(P.cmcRad) + ' abd' + deg(P.cmcAbd) + ' opp' + deg(P.cmcOpp) +
    ' | mcp' + deg(P.mcpFlex) + ' ip' + deg(P.ipFlex) +
    ' | tip->' + NAMES[tgt] + ' ' + M.vdist(tip, ftip).toFixed(1).padStart(5) + 'mm' +
    ' | pads ' + M.vdot(tS.frame[2], dir).toFixed(2) +
    '/' + M.vdot(fS.frame[2], M.vmul(dir, -1)).toFixed(2));
}
