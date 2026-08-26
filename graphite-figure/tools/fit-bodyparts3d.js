/* Turn the BodyParts3D/Anatomography anatomical mesh database into a compact
   catalogue-plus-geometry-summary the figure project can check in, without
   checking in 1.3GB of triangle meshes to get there.
   Usage: node tools/fit-bodyparts3d.js [path-to-BodyParts3D_data] [out.json]
   Defaults: data/BodyParts3D_data -> data/bodyparts3d.json

   WHAT THIS IS AND WHY IT IS COMPACT. BodyParts3D is not a musculoskeletal
   model like data/rajagopal.json or data/mobl-arms.json -- it is 934
   individually-named 3D surface meshes (skin, every bone, every named
   muscle and organ FMA has a term for) segmented from ONE adult male
   reference individual, in binary STL, 1.3GB total, one file up to 79MB
   (the skin). Checking that in, or converting every triangle to JSON,
   would not be "compact extracted data" the way tools/fit-osim.js's output
   is -- it would just be the same geometry in a worse format. What IS
   compact, and is what this script actually does: read every one of those
   934 meshes for real (nothing below is guessed) and reduce each to a
   catalogue entry, a triangle count, an axis-aligned bounding box, a
   simple vertex-mean point, and an enclosed-volume estimate -- real numbers
   computed from real geometry, at about 1/2000th the size of the source.
   To use an actual mesh rather than its summary, fetch that one structure's
   FMA<id>.stl from the source below; this file is an index onto that, not a
   replacement for it.

   To regenerate:
     git clone --depth 1 https://github.com/Kevin-Mattheus-Moerman/bodyparts3d
     node tools/fit-bodyparts3d.js bodyparts3d/assets/BodyParts3D_data

   PROVENANCE. Original database: Mitsuhashi N, Fujieda K, Tamura T,
   Kawamoto S, Takagi T, Okubo K. "BodyParts3D: 3D structure database for
   anatomical concepts." Nucleic Acids Res. 2009 Jan;37(Database
   issue):D782-5. Canonical source: http://lifesciencedb.jp/bp3d/ (also
   ftp://ftp.biosciencedbc.jp/archive/bodyparts3d/). Release 3.0 / dataset
   date 20110915 -- the version this script reads, and (per the mirror's own
   README) chosen specifically over the newer 4.0 because 4.0's skin/muscle
   surfaces are reported to intersect. This project fetched it not from that
   FTP site directly but from a public GitHub mirror -- Kevin Moerman's
   conversion of the same official archive (obtained, per that repo's own
   README, via `wget -r --no-parent` against the dbarchive FTP mirror,
   OBJ converted to binary STL because the OBJ skin alone exceeds 100MB,
   non-English documents removed, nothing else changed) --
   https://github.com/Kevin-Mattheus-Moerman/bodyparts3d
   pinned commit f0eeb6e843380cfe6b83797cf8c3e1af74de5e61 (2024-10-16).

   LICENSE. Creative Commons Attribution-ShareAlike 2.1 Japan. Required
   credit line, quoted verbatim from the redistributed LICENSE_content file:
   "BodyParts3D, Copyright(c) 2008 Life Science Integrated Database Center
   licensed by CC Display-Inheritance 2.1 Japan" -- reproduced in canonical
   English on the license deed as "BodyParts3D, (c) The Database Center for
   Life Science licensed under CC Attribution-Share Alike 2.1 Japan". This
   credit line MUST accompany any use of the data extracted here.

   UNITS AND AXES — EMPIRICAL, NOT ASSUMED. Nothing in the redistributed
   text files states units or axis directions in words (the source's own
   release notes reserve a "Coordinate system of BodyParts3D" section for an
   image, coordinate_system.png, that is not machine-readable text, so it is
   not relied on here). Instead this script did what tools/fit-osim.js does
   for Rajagopal's file: read the actual geometry and check it against a
   known anatomical fact. FMA7163 (skin, the whole-body surface) has a
   bounding box 658.6 x 285.6 x 1655.2 in the file's raw units. 1655 as a
   STANDING HEIGHT in millimetres (165.5cm) is an entirely plausible adult
   male height; as centimetres (16.55m) or metres (1.655mm) it is not. So:
   millimetres, confirmed from the data, not the documentation. By the same
   read, the tallest axis is the file's third coordinate, so THAT axis is
   superior, with the low end (-13.5) sitting just below zero -- consistent
   with zero being approximately ground level at the sole of the foot. This
   is a DIFFERENT convention from every OpenSim file in this project (which
   are Y-up); it is presented here as (x, y, z) exactly as the STL stores
   it, unrotated, same discipline as tools/fit-osim.js applies to Rajagopal:
   documented, not remapped.

   VOLUME IS APPROXIMATE. enclosedVolumeMm3 is the exact divergence-theorem
   volume of a closed, consistently-wound triangle mesh (V = sum over
   triangles of v1.(v2 x v3) / 6). It is a real computation, not invented --
   but the source's own release notes admit "organs might be spatially
   overlapped", so for a self-intersecting or non-manifold mesh this number
   can be wrong in a way this script cannot detect from the mesh alone. Use
   it as an order-of-magnitude check, not a measurement.

   WHAT IS NOT INCLUDED. FMA.csv, also in the source directory, is the
   generic Foundational Model of Anatomy parent/child ontology -- ~104,700
   terms, nearly all of which have no BodyParts3D mesh at all. It is a
   standard external ontology, not something BodyParts3D itself produced,
   and pulling all of it in would roughly 40x the size of this file for
   almost entirely irrelevant rows. catalog{}/hierarchy[]/compositeOf{}
   below come from BodyParts3D's own three tables instead (parts_list_e.txt,
   conventional_part_of.txt, composite_parts.txt), which is exactly the
   organ-level scope this project actually has meshes for. */
'use strict';
const fs = require('fs');
const path = require('path');

const srcDir = process.argv[2] || path.join(__dirname, '..', 'data', 'BodyParts3D_data');
const outPath = process.argv[3] || path.join(__dirname, '..', 'data', 'bodyparts3d.json');
if (!fs.existsSync(srcDir)) {
  console.error('no directory at ' + srcDir + ' -- see the header of this file for how to fetch one');
  process.exit(1);
}
const stlDir = path.join(srcDir, 'stl');

// ---------------------------------------------------------------------------
//  TSV tables. Every one of these files is "id<TAB>name..." with a quoted
//  header row (`"id"\ten`); stripped generically rather than by line count,
//  in case a future release adds or removes a header line.
// ---------------------------------------------------------------------------
function readTsv(file) {
  const txt = fs.readFileSync(path.join(srcDir, file), 'utf8').replace(/^﻿/, '');
  return txt.split(/\r?\n/)
    .filter((l) => l.length)
    .map((l) => l.split('\t').map((c) => c.replace(/^"|"$/g, '').trim()))
    .filter((cols) => !/(^|\s)id$/i.test(cols[0])); // drop the header row ("id" or "composite id"), wherever it is
}

const catalog = {}; // id -> English name, for all 1524 concepts BodyParts3D names (mesh or not)
for (const [id, name] of readTsv('parts_list_e.txt')) catalog[id] = name;

// part-of: [{id, partId}], names resolved through catalog rather than duplicated
const hierarchy = readTsv('conventional_part_of.txt').map(([id, , partId]) => ({ id, partId }));

// composite organs, grouped: compositeOf[id] = { name, primitives: [ids] }.
// Names of primitives are NOT repeated here -- look them up in catalog, same
// reasoning as hierarchy above, and the reason this stays compact despite
// covering 12,531 source rows.
const compositeOf = {};
for (const [cid, cname, pid] of readTsv('composite_parts.txt')) {
  (compositeOf[cid] = compositeOf[cid] || { name: cname, primitives: [] }).primitives.push(pid);
}

// ---------------------------------------------------------------------------
//  MESHES — binary STL: 80-byte header, uint32 LE triangle count, then
//  50 bytes/triangle (12B normal + 3x12B vertex + 2B attribute), verified
//  against this dataset's own files before writing this (file size ==
//  84 + 50*count on every file checked). One pass per file computes the
//  bounding box, a simple vertex mean, and the enclosed volume together --
//  see header for what each does and does not mean.
// ---------------------------------------------------------------------------
function readStl(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  const expected = 84 + 50 * n;
  if (buf.length !== expected) throw new Error(file + ': size ' + buf.length + ' != expected ' + expected + ' for ' + n + ' triangles -- not the binary STL layout this script assumes');
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  let sx = 0, sy = 0, sz = 0, vol6 = 0;
  let off = 84;
  for (let i = 0; i < n; i++) {
    off += 12; // skip the stored normal -- recomputed by nothing here, not needed for bbox/mean/volume
    const x1 = buf.readFloatLE(off), y1 = buf.readFloatLE(off + 4), z1 = buf.readFloatLE(off + 8);
    const x2 = buf.readFloatLE(off + 12), y2 = buf.readFloatLE(off + 16), z2 = buf.readFloatLE(off + 20);
    const x3 = buf.readFloatLE(off + 24), y3 = buf.readFloatLE(off + 28), z3 = buf.readFloatLE(off + 32);
    off += 36 + 2; // 3 vertices + the trailing attribute byte count
    for (const [x, y, z] of [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]]) {
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
      sx += x; sy += y; sz += z;
    }
    // divergence-theorem tetrahedron volume relative to the origin -- see header
    vol6 += x1 * (y2 * z3 - z2 * y3) - y1 * (x2 * z3 - z2 * x3) + z1 * (x2 * y3 - y2 * x3);
  }
  const nv = n * 3;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    triangles: n,
    fileSizeBytes: buf.length,
    boundingBoxMm: { min: [minx, miny, minz].map(r2), max: [maxx, maxy, maxz].map(r2), sizeMm: [maxx - minx, maxy - miny, maxz - minz].map(r2) },
    vertexMeanMm: nv ? [r2(sx / nv), r2(sy / nv), r2(sz / nv)] : null,
    enclosedVolumeMm3: Math.round(Math.abs(vol6) / 6),
  };
}

// 10 files carry a trailing "nsn" before .stl (e.g. FMA7198nsn.stl, pancreas)
// with no plain-named duplicate alongside them and no separate "...nsn"
// catalog entry -- the suffix is this file's own naming quirk, not a
// different structure, so the "nsn" is stripped to key these the same way
// the catalog and every other mesh already are (checked: no ID below is
// ever seen both with and without "nsn").
const STL_RE = /^((?:FMA|BP)\d+)(nsn)?\.stl$/;
const stlFiles = fs.readdirSync(stlDir).filter((f) => STL_RE.test(f));
console.log('scanning ' + stlFiles.length + ' meshes...');
const meshes = {};
let totalTriangles = 0, totalBytes = 0;
for (const f of stlFiles) {
  const id = f.match(STL_RE)[1];
  if (meshes[id]) throw new Error('duplicate mesh id ' + id + ' (from ' + f + ') -- the nsn-stripping assumption above no longer holds, fix needed');
  const g = readStl(path.join(stlDir, f));
  meshes[id] = g;
  totalTriangles += g.triangles;
  totalBytes += g.fileSizeBytes;
}
console.log('  ' + totalTriangles.toLocaleString() + ' triangles, ' + (totalBytes / 1e6).toFixed(0) + ' MB of source STL read');

// ---------------------------------------------------------------------------
//  ASSEMBLE + WRITE
// ---------------------------------------------------------------------------
const parts = Object.keys(catalog).sort().map((id) => ({
  id, name: catalog[id], hasMesh: Object.prototype.hasOwnProperty.call(meshes, id),
  ...(meshes[id] || {}),
}));

const bp3d = {
  meta: {
    source: 'BodyParts3D/Anatomography. Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K (2009) "BodyParts3D: 3D structure database for anatomical concepts." Nucleic Acids Res 37(Database issue):D782-5. doi:10.1093/nar/gkn613',
    authoritativeSource: 'http://lifesciencedb.jp/bp3d/ ; ftp://ftp.biosciencedbc.jp/archive/bodyparts3d/ -- release 3.0, dataset 20110915 (chosen over the newer 4.0, whose skin/muscle surfaces reportedly intersect)',
    fetchedFrom: 'https://github.com/Kevin-Mattheus-Moerman/bodyparts3d (public mirror: OBJ->binary-STL conversion of the same official archive; not the point of origin, see authoritativeSource)',
    fetchedFromCommit: 'f0eeb6e843380cfe6b83797cf8c3e1af74de5e61 (2024-10-16)',
    extractedDate: new Date().toISOString().slice(0, 10),
    subject: 'ONE adult male reference individual -- a segmentation atlas, not a population sample (contrast data/ansur-model.json, which is 6,068 people)',
    license: 'Creative Commons Attribution-ShareAlike 2.1 Japan. Required credit line: "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan" -- MUST accompany any use of this data.',
    units: 'millimetres, EMPIRICALLY confirmed (not documented in words anywhere in the source) from FMA7163 (skin)\'s own bounding box -- see this script\'s header for the reasoning.',
    axes: 'exactly as stored in each STL: (x, y, z), third component tallest/superior on the whole-body skin mesh, near-zero at its low end (approx ground level at the sole). NOT rotated to match any other file in this project -- see header. Every meshes[id].boundingBoxMm/vertexMeanMm is in this same raw per-file frame; nothing here establishes that separate structures share a common origin beyond what "same STL coordinate space, one whole-body segmentation" implies.',
    vertexMeanIsNotCentroid: 'meshes[id].vertexMeanMm is the unweighted mean of every (repeated) triangle-corner vertex -- a cheap orientation check, not a true volumetric or area-weighted centroid.',
    volumeIsApproximate: 'meshes[id].enclosedVolumeMm3 assumes a closed, consistently-wound mesh; the source\'s own release notes admit overlap and non-solid tube-shaped organs exist, so treat this as order-of-magnitude, not measurement -- see header.',
    notCovered: 'No triangle/vertex geometry is included -- this is a catalogue and per-mesh summary, not the meshes themselves (see header for why, and how to fetch one specific mesh). FMA.csv (the ~104,700-term generic FMA ontology also present in the source directory) is intentionally not included -- see header. composite_parts.txt entries whose primitives are themselves composite (no mesh) are preserved as given, not recursively expanded to atomic parts.',
  },
  catalog,
  hierarchy,
  compositeOf,
  meshes,
  parts,
  counts: {
    catalogEntries: Object.keys(catalog).length,
    meshes: stlFiles.length,
    catalogEntriesWithoutMesh: Object.keys(catalog).length - stlFiles.length,
    hierarchyRelations: hierarchy.length,
    compositeOrgans: Object.keys(compositeOf).length,
    totalTriangles,
    totalSourceMB: Math.round(totalBytes / 1e6),
  },
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(bp3d));
console.log('-> ' + outPath + '  ' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' kB');

// ---------------------------------------------------------------------------
//  VERIFICATION
// ---------------------------------------------------------------------------
const issues = [];

// every mesh's id is in the catalogue
for (const id in meshes) if (!(id in catalog)) issues.push('mesh ' + id + ' has no catalog entry (name unknown)');

// every hierarchy id/partId is in the catalogue
for (const h of hierarchy) {
  if (!(h.id in catalog)) issues.push('hierarchy: id "' + h.id + '" not in catalog');
  if (!(h.partId in catalog)) issues.push('hierarchy: partId "' + h.partId + '" not in catalog');
}

// every compositeOf id and its primitives are in the catalogue
for (const cid in compositeOf) {
  if (!(cid in catalog)) issues.push('compositeOf: composite id "' + cid + '" not in catalog');
  for (const pid of compositeOf[cid].primitives) if (!(pid in catalog)) issues.push('compositeOf: primitive id "' + pid + '" (of ' + cid + ') not in catalog');
}

// every mesh's bounding box has min <= max on every axis, and a positive triangle count
for (const id in meshes) {
  const g = meshes[id];
  if (g.triangles <= 0) issues.push('mesh ' + id + ': non-positive triangle count ' + g.triangles);
  for (let a = 0; a < 3; a++) if (g.boundingBoxMm.min[a] > g.boundingBoxMm.max[a]) issues.push('mesh ' + id + ': bbox min > max on axis ' + a);
}

// the two structures this whole project cares about most -- skin and skeleton -- are actually present
for (const [id, expect] of [['FMA7163', 'skin'], ['FMA24474', 'right femur']]) {
  if (!(id in meshes)) issues.push('expected mesh ' + id + ' (' + expect + ') is missing');
  else if (catalog[id] !== expect) issues.push('catalog[' + id + '] = "' + catalog[id] + '", expected "' + expect + '"');
}

console.log(issues.length === 0 ? 'verification: PASS' : ('verification: FAIL (' + issues.length + ' issue(s))'));
for (const iss of issues.slice(0, 30)) console.log('  - ' + iss);
if (issues.length > 30) console.log('  ... and ' + (issues.length - 30) + ' more');

console.log('\ncounts: ' + JSON.stringify(bp3d.counts, null, 2).replace(/[{}"]/g, '').trim());
const skin = meshes.FMA7163;
if (skin) {
  console.log('\nskin (FMA7163): ' + skin.triangles.toLocaleString() + ' triangles, bbox size ' + skin.boundingBoxMm.sizeMm.join(' x ') + ' mm');
  console.log('  implied standing height (largest bbox axis): ' + Math.max(...skin.boundingBoxMm.sizeMm).toFixed(0) + ' mm');
}
if (issues.length) process.exitCode = 1;
