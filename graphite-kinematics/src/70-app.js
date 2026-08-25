/* ============================================================================
   GRAPHITE KINEMATICS — 70 · app
   The viewer: parameter surface, interaction, and the two-speed render loop
   that draws roughly while you move and refines once you stop.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math, AN = GK.anatomy, RG = GK.rig, PO = GK.pose, RE = GK.render, PEN = GK.pencil;
  const { DEG, clamp, clamp01, lerp } = M;

  const SIZE = 1000;      // the finished plate
  const DRAFT = 520;      // what you see while dragging

  // ------------------------------------------------------------------ state
  const DEFAULTS = () => ({
    seed: 12345,
    presetKey: 'rest',
    entropy: 0.55,
    speed: 1,
    motion: 'still',
    artic: { curl: 0, spread: 0, opposition: 0, arch: 0, wristFlex: 0, wristDev: 0, pronation: 0 },
    // a mild oblique reads far better than a flat dorsal view: a curled
    // pose seen straight on foreshortens into a stack of rings
    view: { az: -32 * DEG, el: 14 * DEG, roll: 0, zoom: 1 },
    style: {
      grade: 3, tone: 1, wobble: 1, ghost: 0.14, search: 0.35,
      paper: [244, 241, 232], ink: [26, 25, 23]
    },
    detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
    layers: Object.assign({}, RE.DEFAULT_LAYERS, { label: false })
  });

  let params = DEFAULTS();
  let spec = null;              // the normalised pose: 25 numbers
  let rFull = null, rDraft = null;
  let offCanvas = null, offCtx = null;
  let ctx = null;
  let needDraft = true, needFull = false, lastChange = 0;
  let tAnim = 0, lastFrame = 0;
  let cycleFrom = null, cycleTo = null, cycleT = 0;
  let lastBuilt = null, lastMs = 0, lastQuality = 0;
  let dragging = false, dragX = 0, dragY = 0;

  const cloneSpec = (s) => JSON.parse(JSON.stringify(s));

  function specFromPreset(key) {
    return cloneSpec(PO.PRESETS[key].spec);
  }

  /** the pose actually drawn: the chosen spec plus the articulation offsets */
  function effectivePose(A) {
    const s = cloneSpec(spec);
    const a = params.artic;
    s.wrist = [
      clamp(s.wrist[0] + a.wristFlex, -1, 1),
      clamp(s.wrist[1] + a.wristDev, -1, 1),
      clamp(s.wrist[2] + a.pronation, -1, 1)
    ];
    s.arch = clamp01(s.arch + a.arch);
    s.thumb = s.thumb.slice();
    s.thumb[2] = clamp(s.thumb[2] + a.opposition, -1, 1);
    s.f = s.f.map(v => [
      clamp(v[0] + a.curl, -1, 1),
      clamp(v[1] + a.curl * 1.06, -1, 1),
      clamp(v[2] + a.curl * 0.70, -1, 1),
      clamp(v[3] + a.spread, -1, 1)
    ]);
    return PO.clampPose(A, PO.mk(A, s));
  }

  /** the pose after motion is applied */
  function posedFor(A) {
    if (params.motion === 'rom') return PO.romTour(A, tAnim * 0.045 * params.speed, effectivePose(A));
    if (params.motion === 'breathe') return PO.breathe(A, effectivePose(A), tAnim * params.speed, 1);
    if (params.motion === 'cycle') {
      if (!cycleFrom) { cycleFrom = effectivePose(A); cycleTo = PO.generate(A, (params.seed + 1) | 0, params.entropy); }
      return PO.lerpPose(cycleFrom, cycleTo, cycleT);
    }
    return effectivePose(A);
  }

  // ----------------------------------------------------------------- render
  function renderAt(renderer, quality, canvasCtx, w) {
    const A = renderer.anatomyFor(params.seed);
    const pose = posedFor(A);
    const t0 = performance.now();
    const built = renderer.draw({
      seed: params.seed, pose,
      view: params.view,
      style: params.style,
      detail: quality === 0 ? {
        print: params.detail.print * 0.55, ridge: params.detail.ridge * 0.45,
        lattice: params.detail.lattice * 0.5, hair: params.detail.hair * 0.6,
        vein: params.detail.vein
      } : params.detail,
      layers: params.layers,
      quality
    });
    const px = renderer.resolve({ style: params.style });
    canvasCtx.putImageData(new ImageData(px, w, w), 0, 0);
    lastBuilt = built; lastMs = Math.round(performance.now() - t0); lastQuality = quality;
    return built;
  }

  function renderDraft() {
    renderAt(rDraft, 0, offCtx, DRAFT);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offCanvas, 0, 0, SIZE, SIZE);
    afterDraw();
  }

  function renderFull() {
    renderAt(rFull, 1, ctx, SIZE);
    afterDraw();
  }

  /** annotations ride on top of the graphite, in the browser's own type */
  function afterDraw() {
    if (params.layers.label && lastBuilt) drawLabels();
    updateReadout();
  }

  function drawLabels() {
    const { rig, view } = lastBuilt;
    ctx.save();
    ctx.font = '500 13px Poppins, sans-serif';
    ctx.fillStyle = 'rgba(217,119,87,0.92)';
    ctx.strokeStyle = 'rgba(217,119,87,0.42)';
    ctx.lineWidth = 1;
    for (const dg of rig.digits) {
      for (let i = 1; i < dg.joints.length; i++) {
        const j = dg.joints[i];
        const p = view.px(j.P);
        if (p[0] < 0 || p[1] < 0 || p[0] > SIZE || p[1] > SIZE) continue;
        ctx.beginPath(); ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2); ctx.fill();
        const dir = dg.digit === 0 ? -1 : 1;
        const lx = p[0] + 16 * dir, ly = p[1] - 10;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(lx, ly); ctx.stroke();
        ctx.textAlign = dir > 0 ? 'left' : 'right';
        ctx.fillText(j.name + ' ' + Math.round(j.flex / DEG) + '°', lx + 3 * dir, ly - 2);
      }
    }
    ctx.restore();
  }

  function updateReadout() {
    const A = rFull.anatomyFor(params.seed);
    const pose = lastBuilt ? lastBuilt.rig.pose : effectivePose(A);
    const rows = PO.readout(A, pose);
    let txt = rows.map(r => r[0].padEnd(7) + r[1]).join('\n');
    if (pose.active) txt = 'tour · ' + pose.active.label + '\n' + txt;
    const el = document.getElementById('readout');
    if (el) el.textContent = txt;
    const badge = document.getElementById('badge');
    if (badge) {
      const g = PEN.gradeAt(params.style.grade);
      badge.textContent = 'seed ' + params.seed + '  ·  ' + g.name + '\n' +
        (lastQuality === 0 ? 'draft' : 'plate') + '  ' + lastMs + ' ms' +
        (lastBuilt ? '  ·  ' + lastBuilt.curves.length + ' curves' : '');
    }
  }

  function markDirty() { needDraft = true; lastChange = performance.now(); }

  // ------------------------------------------------------------------ setup
  window.setup = function () {
    const c = createCanvas(SIZE, SIZE);
    c.parent('canvas-container');
    pixelDensity(1);
    ctx = drawingContext;
    offCanvas = document.createElement('canvas');
    offCanvas.width = offCanvas.height = DRAFT;
    offCtx = offCanvas.getContext('2d');
    rFull = new RE.Renderer(SIZE, SIZE);
    rDraft = new RE.Renderer(DRAFT, DRAFT);
    spec = specFromPreset(params.presetKey);
    buildUI();
    const l = document.querySelector('.loading');
    if (l) l.style.display = 'none';
    // wheel zoom on the canvas itself
    c.elt.addEventListener('wheel', (e) => {
      e.preventDefault();
      params.view.zoom = clamp(params.view.zoom * (e.deltaY > 0 ? 0.94 : 1.064), 0.35, 4);
      syncOne('zoom', params.view.zoom);
      markDirty();
    }, { passive: false });
    lastFrame = performance.now();
    markDirty();
  };

  window.draw = function () {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (params.motion !== 'still') {
      tAnim += dt;
      if (params.motion === 'cycle') {
        cycleT += dt * 0.28 * params.speed;
        if (cycleT >= 1) {
          cycleT = 0;
          cycleFrom = cycleTo;
          const A = rFull.anatomyFor(params.seed);
          cycleTo = PO.generate(A, Math.floor(Math.random() * 1e6), params.entropy);
        }
      }
      renderDraft();
      needFull = true;
      lastChange = now;
      return;
    }

    if (needDraft) {
      needDraft = false; needFull = true;
      renderDraft();
      return;
    }
    if (needFull && now - lastChange > 380) {
      needFull = false;
      renderFull();
    }
  };

  // ------------------------------------------------------------- interaction
  const overCanvas = () => mouseX >= 0 && mouseY >= 0 && mouseX <= SIZE && mouseY <= SIZE;
  window.mousePressed = function () {
    if (!overCanvas()) return;
    dragging = true; dragX = mouseX; dragY = mouseY;
  };
  window.mouseReleased = function () { dragging = false; };
  window.mouseDragged = function () {
    if (!dragging) return;
    params.view.az -= (mouseX - dragX) * 0.0075;
    params.view.el = clamp(params.view.el + (mouseY - dragY) * 0.0060, -1.35, 1.35);
    dragX = mouseX; dragY = mouseY;
    syncOne('az', params.view.az / DEG);
    syncOne('el', params.view.el / DEG);
    markDirty();
    return false;
  };
  window.keyPressed = function () {
    if (key === ' ') { generatePose(); return false; }
    if (key === 's' || key === 'S') { randomSeedAndUpdate(); return false; }
    if (key === 'l' || key === 'L') { toggleLayer('label'); return false; }
    if (keyCode === LEFT_ARROW) { params.view.az -= 6 * DEG; syncOne('az', params.view.az / DEG); markDirty(); return false; }
    if (keyCode === RIGHT_ARROW) { params.view.az += 6 * DEG; syncOne('az', params.view.az / DEG); markDirty(); return false; }
    if (keyCode === UP_ARROW) { params.view.el = clamp(params.view.el + 5 * DEG, -1.35, 1.35); syncOne('el', params.view.el / DEG); markDirty(); return false; }
    if (keyCode === DOWN_ARROW) { params.view.el = clamp(params.view.el - 5 * DEG, -1.35, 1.35); syncOne('el', params.view.el / DEG); markDirty(); return false; }
  };

  // ---------------------------------------------------------------- UI build
  const $ = (id) => document.getElementById(id);
  const els = {};

  function slider(host, id, label, min, max, step, value, fmt, onInput) {
    const g = document.createElement('div');
    g.className = 'control-group';
    g.innerHTML = '<label>' + label + '</label><div class="slider-container">' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '">' +
      '<span class="value-display"></span></div>';
    const inp = g.querySelector('input'), out = g.querySelector('span');
    inp.value = value;
    out.textContent = fmt(value);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      out.textContent = fmt(v);
      onInput(v);
      markDirty();
    });
    host.appendChild(g);
    els[id] = { inp, out, fmt };
  }
  function syncOne(id, v) {
    const e = els[id]; if (!e) return;
    e.inp.value = v; e.out.textContent = e.fmt(v);
  }
  const f2 = (v) => (+v).toFixed(2);
  const fdeg = (v) => Math.round(v) + '°';
  const fpc = (v) => Math.round(v * 100) + '%';

  // the 25 degrees of freedom, in the order a tour visits them
  const DOF_SPEC = [
    ['Wrist', [
      ['wrist0', 'flex/ext', s => s.wrist[0], (s, v) => s.wrist[0] = v],
      ['wrist1', 'rad/uln', s => s.wrist[1], (s, v) => s.wrist[1] = v],
      ['wrist2', 'pronate', s => s.wrist[2], (s, v) => s.wrist[2] = v],
      ['arch', 'arch', s => s.arch, (s, v) => s.arch = clamp01(v)]
    ]],
    ['Thumb', [
      ['th0', 'CMC f/e', s => s.thumb[0], (s, v) => s.thumb[0] = v],
      ['th1', 'CMC abd', s => s.thumb[1], (s, v) => s.thumb[1] = v],
      ['th2', 'opposition', s => s.thumb[2], (s, v) => s.thumb[2] = v],
      ['th3', 'MCP', s => s.thumb[3], (s, v) => s.thumb[3] = v],
      ['th4', 'IP', s => s.thumb[4], (s, v) => s.thumb[4] = v]
    ]]
  ];
  ['Index', 'Middle', 'Ring', 'Little'].forEach((nm, i) => {
    DOF_SPEC.push([nm, [
      ['f' + i + '0', 'MCP', s => s.f[i][0], (s, v) => s.f[i][0] = v],
      ['f' + i + '1', 'PIP', s => s.f[i][1], (s, v) => s.f[i][1] = v],
      ['f' + i + '2', 'DIP', s => s.f[i][2], (s, v) => s.f[i][2] = v],
      ['f' + i + '3', 'abduct', s => s.f[i][3], (s, v) => s.f[i][3] = v]
    ]]);
  });

  const dofEls = {};
  function buildDOF(host) {
    host.innerHTML = '';
    for (const [group, rows] of DOF_SPEC) {
      const box = document.createElement('div');
      box.className = 'dof-group';
      box.innerHTML = '<h4>' + group + '</h4>';
      for (const [id, label, get, set] of rows) {
        const row = document.createElement('div');
        row.className = 'dof-row';
        row.innerHTML = '<span class="n">' + label + '</span>' +
          '<input type="range" min="-1" max="1" step="0.01"><span class="v"></span>';
        const inp = row.querySelector('input'), out = row.querySelector('.v');
        inp.value = get(spec);
        out.textContent = (+inp.value).toFixed(2);
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          out.textContent = v.toFixed(2);
          set(spec, v);
          markDirty();
        });
        box.appendChild(row);
        dofEls[id] = { inp, out, get };
      }
      host.appendChild(box);
    }
  }
  function syncDOF() {
    for (const [, rows] of DOF_SPEC) {
      for (const [id, , get] of rows) {
        const e = dofEls[id]; if (!e) continue;
        const v = get(spec);
        e.inp.value = v; e.out.textContent = (+v).toFixed(2);
      }
    }
  }

  const LAYER_LABELS = {
    contour: 'Contour', crease: 'Creases', fold: 'Folds', nail: 'Nails',
    print: 'Fingerprints', palmcrease: 'Palm lines', ridge: 'Palm ridges',
    vein: 'Veins', tendon: 'Tendons', hair: 'Hair', hatch: 'Skin lattice',
    bone: 'Bones (27)', label: 'Joint labels'
  };

  function buildUI() {
    // preset chips
    const chips = $('preset-chips');
    chips.innerHTML = '';
    PO.PRESET_KEYS.forEach(k => {
      const b = document.createElement('button');
      b.className = 'chip' + (k === params.presetKey ? ' active' : '');
      b.textContent = PO.PRESETS[k].label;
      b.dataset.key = k;
      b.onclick = () => setPreset(k);
      chips.appendChild(b);
    });

    const art = $('artic-sliders'); art.innerHTML = '';
    slider(art, 'curl', 'Curl', -1, 1, 0.01, 0, f2, v => params.artic.curl = v);
    slider(art, 'spread', 'Spread', -1, 1, 0.01, 0, f2, v => params.artic.spread = v);
    slider(art, 'opposition', 'Thumb opposition', -1, 1, 0.01, 0, f2, v => params.artic.opposition = v);
    slider(art, 'archOff', 'Palm arch', -1, 1, 0.01, 0, f2, v => params.artic.arch = v);
    slider(art, 'wristFlex', 'Wrist flexion', -1, 1, 0.01, 0, f2, v => params.artic.wristFlex = v);
    slider(art, 'wristDev', 'Wrist deviation', -1, 1, 0.01, 0, f2, v => params.artic.wristDev = v);
    slider(art, 'pronation', 'Forearm rotation', -1, 1, 0.01, 0, f2, v => params.artic.pronation = v);
    buildDOF($('dof-sliders'));

    const vw = $('view-sliders'); vw.innerHTML = '';
    slider(vw, 'az', 'Azimuth  (0 dorsal · 180 palmar)', -180, 180, 1, Math.round(params.view.az / DEG), fdeg, v => params.view.az = v * DEG);
    slider(vw, 'el', 'Elevation', -78, 78, 1, Math.round(params.view.el / DEG), fdeg, v => params.view.el = v * DEG);
    slider(vw, 'zoom', 'Zoom', 0.35, 4, 0.01, params.view.zoom, f2, v => params.view.zoom = v);

    const pn = $('pencil-sliders'); pn.innerHTML = '';
    slider(pn, 'grade', 'Grade', 0, 6, 0.05, 3, v => PEN.gradeAt(v).name, v => params.style.grade = v);
    slider(pn, 'tone', 'Pressure', 0.3, 1.8, 0.01, 1, f2, v => params.style.tone = v);
    slider(pn, 'wobble', 'Hand wobble', 0, 2.5, 0.01, 1, f2, v => params.style.wobble = v);
    slider(pn, 'ghost', 'Ghosted construction', 0, 0.6, 0.005, 0.14, f2, v => params.style.ghost = v);
    slider(pn, 'search', 'Searching lines', 0, 1.2, 0.01, 0.35, f2, v => params.style.search = v);

    const dt = $('detail-sliders'); dt.innerHTML = '';
    slider(dt, 'print', 'Fingerprints', 0, 2, 0.01, 1, fpc, v => params.detail.print = v);
    slider(dt, 'ridge', 'Palm ridges', 0, 2, 0.01, 0.5, fpc, v => params.detail.ridge = v);
    slider(dt, 'lattice', 'Skin lattice', 0, 2, 0.01, 0.55, fpc, v => params.detail.lattice = v);
    slider(dt, 'hair', 'Hair', 0, 2, 0.01, 1, fpc, v => params.detail.hair = v);
    slider(dt, 'vein', 'Veins', 0, 2, 0.01, 1, fpc, v => params.detail.vein = v);

    const lc = $('layer-checks'); lc.innerHTML = '';
    Object.keys(LAYER_LABELS).forEach(k => {
      const lab = document.createElement('label');
      lab.className = 'check';
      lab.innerHTML = '<input type="checkbox"' + (params.layers[k] ? ' checked' : '') + '><span>' + LAYER_LABELS[k] + '</span>';
      lab.querySelector('input').addEventListener('change', (e) => {
        params.layers[k] = e.target.checked;
        markDirty();
      });
      lc.appendChild(lab);
      els['layer_' + k] = { inp: lab.querySelector('input') };
    });
  }

  // ------------------------------------------------------------- UI handlers
  window.setPreset = function (k) {
    params.presetKey = k;
    spec = specFromPreset(k);
    document.querySelectorAll('#preset-chips .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.key === k));
    resetArtic();
    syncDOF();
    cycleFrom = null;
    markDirty();
  };
  function resetArtic() {
    params.artic = { curl: 0, spread: 0, opposition: 0, arch: 0, wristFlex: 0, wristDev: 0, pronation: 0 };
    ['curl', 'spread', 'opposition', 'archOff', 'wristFlex', 'wristDev', 'pronation'].forEach(k => syncOne(k, 0));
  }

  window.generatePose = function () {
    const A = rFull.anatomyFor(params.seed);
    const seed = Math.floor(Math.random() * 1e6);
    const p = PO.generate(A, seed, params.entropy);
    spec = p.spec || PO.specOf(A, p);
    params.presetKey = p.intent || params.presetKey;
    document.querySelectorAll('#preset-chips .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.key === params.presetKey));
    resetArtic();
    syncDOF();
    cycleFrom = null;
    markDirty();
  };

  window.setMotion = function (v) {
    params.motion = v;
    if (v === 'cycle') { cycleFrom = null; cycleT = 0; }
    markDirty();
  };

  window.updateParam = function (name, value) {
    const v = parseFloat(value);
    if (name === 'entropy') params.entropy = v;
    if (name === 'speed') params.speed = v;
    const el = $(name + '-value');
    if (el) el.textContent = v.toFixed(2);
    markDirty();
  };

  window.updateColor = function (which, hex) {
    const c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    params.style[which] = c;
    const el = $(which + '-value');
    if (el) el.textContent = hex;
    const box = document.getElementById('canvas-container');
    if (which === 'paper' && box) box.style.background = hex;
    markDirty();
  };

  window.toggleLayer = function (k) {
    params.layers[k] = !params.layers[k];
    const e = els['layer_' + k];
    if (e) e.inp.checked = params.layers[k];
    markDirty();
  };

  // ------------------------------------------------------- seed (always kept)
  function updateSeedDisplay() { $('seed-input').value = params.seed; }
  window.updateSeed = function () {
    const n = parseInt($('seed-input').value);
    if (n && n > 0) { params.seed = n; cycleFrom = null; markDirty(); }
    else updateSeedDisplay();
  };
  window.previousSeed = function () { params.seed = Math.max(1, params.seed - 1); updateSeedDisplay(); cycleFrom = null; markDirty(); };
  window.nextSeed = function () { params.seed += 1; updateSeedDisplay(); cycleFrom = null; markDirty(); };
  window.randomSeedAndUpdate = function () {
    params.seed = Math.floor(Math.random() * 999999) + 1;
    updateSeedDisplay(); cycleFrom = null; markDirty();
  };
  window.regenerate = function () { cycleFrom = null; markDirty(); };

  window.resetParameters = function () {
    const seed = params.seed;
    params = DEFAULTS();
    params.seed = seed;
    spec = specFromPreset(params.presetKey);
    buildUI();
    updateSeedDisplay();
    $('motion').value = 'still';
    $('entropy').value = params.entropy; $('entropy-value').textContent = params.entropy.toFixed(2);
    $('speed').value = params.speed; $('speed-value').textContent = params.speed.toFixed(2);
    $('paper').value = '#f4f1e8'; $('paper-value').textContent = '#f4f1e8';
    $('ink').value = '#1a1917'; $('ink-value').textContent = '#1a1917';
    document.getElementById('canvas-container').style.background = '#f4f1e8';
    cycleFrom = null;
    markDirty();
  };

  /**
   * Hand the plate to the viewer. Inside the Artifact viewer a page cannot
   * download anything itself — the host mediates it and the viewer confirms —
   * so ask for the capability first and fall back to an object URL only when
   * we are running as an ordinary page.
   */
  async function savePlate(blob, filename) {
    let dl = null;
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        dl = await window.claude.use('downloads');
      }
    } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename, data: blob }); return 'Saved'; }
      catch (err) {
        const code = err && err.code;
        if (code === 'declined') return 'Cancelled';
        if (code === 'too_large') return 'Too large';
        if (code === 'rate_limited') return 'Try again';
        return 'Unavailable';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = filename;
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'Saved';
  }

  window.downloadPNG = async function (ev) {
    const btn = ev && ev.currentTarget ? ev.currentTarget : null;
    const label = btn ? btn.textContent : null;
    if (btn) { btn.textContent = 'Drawing the plate…'; btn.disabled = true; }
    // let the button repaint before the renderer takes the thread
    await new Promise(r => setTimeout(r, 30));
    try {
      // a proper plate: higher resolution, supersampled, full detail
      const N = 1400;
      const big = new RE.Renderer(N, N);
      const A = big.anatomyFor(params.seed);
      big.draw({
        seed: params.seed, pose: posedFor(A), view: params.view,
        style: params.style, detail: params.detail, layers: params.layers, quality: 2
      });
      const px = big.resolve({ style: params.style });
      const cv = document.createElement('canvas');
      cv.width = cv.height = N;
      cv.getContext('2d').putImageData(new ImageData(px, N, N), 0, 0);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      const name = 'graphite-kinematics-' + params.seed + '-' + params.presetKey + '.png';
      const status = await savePlate(blob, name);
      if (btn) { btn.textContent = status; setTimeout(() => { btn.textContent = label; }, 1800); }
    } catch (e) {
      if (btn) { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = label; }, 1800); }
      throw e;
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.addEventListener('load', () => { updateSeedDisplay(); });
})(window.GK = window.GK || {});
