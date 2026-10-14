// CathSim Station im Browser: lädt die Engine (WebAssembly), das CT und bedient sie.
(function () {
  const cfg = window.CATHSIM_CONFIG;
  const $ = (id) => document.getElementById(id);

  const makeWasi = () => CathSimWasi.makeWasi();

  // ---------- Engine ----------
  const E = { ex: null, mem: null, dec: new TextDecoder(), enc: new TextEncoder() };
  E.result = () => JSON.parse(E.dec.decode(new Uint8Array(E.ex.memory.buffer, E.ex.cs_result_ptr(), E.ex.cs_result_len())));
  E.str = (s) => { const b = E.enc.encode(s); const p = E.ex.cs_alloc(b.length); new Uint8Array(E.ex.memory.buffer).set(b, p); return [p, b.length]; };

  // ---------- Ladeanimation ----------
  const LD = { len: 0, frac: 0, text: '', raf: 0, t0: 0 };
  function loaderInit() {
    const c = document.getElementById('ldCath'); if (!c) return;
    LD.len = c.getTotalLength(); c.style.strokeDasharray = `${LD.len}`; c.style.strokeDashoffset = `${LD.len}`;
    LD.t0 = performance.now();
    const tick = () => {
      if (!$('loader').classList.contains('on')) { LD.raf = 0; return; }
      // Die Spitze zittert ein wenig, wie unter Durchleuchtung
      const wob = Math.sin((performance.now() - LD.t0) / 180) * 0.004;
      const f = Math.max(0, Math.min(1, LD.frac + wob));
      c.style.strokeDashoffset = `${LD.len * (1 - f)}`;
      const p = c.getPointAtLength(LD.len * f); const tip = $('ldTip'); tip.setAttribute('cx', p.x); tip.setAttribute('cy', p.y);
      LD.raf = requestAnimationFrame(tick);
    };
    if (!LD.raf) LD.raf = requestAnimationFrame(tick);
  }
  function setLoad(frac, text) {
    LD.frac = Math.max(LD.frac, Math.min(1, frac));
    if (text !== undefined) { LD.text = text; $('ldText').textContent = text; $('loadtext').textContent = ''; }
    $('progress').style.width = (LD.frac * 100) + '%';
  }
  function loaderShow() { LD.frac = 0; $('loader').classList.add('on'); loaderInit(); }
  function loaderHide() { $('loader').classList.remove('on'); $('progress').style.width = '0'; }
  async function fetchProgress(url, label, expect, base = 0, span = 1) {
    const r = await fetch(url, { cache: 'force-cache' }); if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    // Bei gzip-Auslieferung nennt content-length nur die gepackte Größe – dann zählt die erwartete Endgröße.
    const packed = !!r.headers.get('content-encoding'); const total = packed ? (expect || 0) : (+r.headers.get('content-length') || expect || 0);
    const reader = r.body.getReader(); const chunks = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length;
      const f = total ? Math.min(1, got / total) : 0.3; setLoad(base + span * f, `${label} ${(got / 1e6).toFixed(0)}${total ? ' / ' + (total / 1e6).toFixed(0) : ''} MB`); }
    const all = new Uint8Array(got); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    return all;
  }
  // Einmal geladen, bleibt es im Browser (Cache API, nach Version getrennt): beim nächsten
  // Öffnen kommen Engine und CT in Sekundenbruchteilen aus dem Speicher statt aus dem Netz.
  async function fetchCached(url, label, expect, base = 0, span = 1) {
    const ver = window.CATHSIM_BUILD || 'dev'; const key = `${url}?v=${ver}`; let cache = null;
    try { if (window.caches) { cache = await caches.open('cathsim-data'); const hit = await cache.match(key); if (hit) { setLoad(base + span * 0.9, `${label} aus dem Speicher …`); return new Uint8Array(await hit.arrayBuffer()); } } } catch (e) { cache = null; }
    const bytes = await fetchProgress(url, label, expect, base, span);
    if (cache) { try { await cache.put(key, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
      const base = new URL(url, location.href).pathname; for (const k of await cache.keys()) { const u = new URL(k.url); if (u.pathname === base && u.search !== `?v=${ver}`) cache.delete(k); } } catch (e) { console.warn('Cache', e); } }
    return bytes;
  }

  const W = { worker: null, ready: false, seq: 0, want: null };
  function startWorker(module, ct) {
    try {
      W.worker = new Worker('bodyworker.js');
      W.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { W.ready = true; T.bodyKey = ''; T.dirty = true; return; }
        if (m.type === 'failed') { console.warn('Worker:', m.error); W.worker = null; W.ready = false; T.bodyKey = ''; T.dirty = true; return; }
        if (m.type === 'body' && m.ok && W.want && m.id === W.want.id) {
          const c = document.createElement('canvas'); c.width = c.height = m.size;
          c.getContext('2d').putImageData(new ImageData(m.rgba, m.size, m.size), 0, 0);
          T.body = { canvas: c, coverage: W.want.coverage, pan: W.want.pan, sid: W.want.sid, sod: W.want.sod, size: m.size };
          T.dirty = true;
        }
      };
      W.worker.onerror = (e) => { console.warn('Worker-Fehler, Körperbild im Hauptthread', e); W.worker = null; W.ready = false; T.bodyKey = ''; T.dirty = true; };
      // Das fertig übersetzte Modul und die CT-Bytes gehen direkt an den Worker – nichts wird zweimal geladen.
      const ctCopy = ct.slice(); W.worker.postMessage({ type: 'init', module, ct: ctCopy }, [ctCopy.buffer]);
    } catch (e) { console.warn('Kein Worker, Körperbild im Hauptthread', e); W.worker = null; }
  }
  async function loadEngine() {
    const wasi = makeWasi();
    const bytes = await fetchCached(cfg.wasmFile, 'Engine', 54.6e6, 0, 0.55);
    setLoad(0.58, 'Engine wird übersetzt …');
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, wasi.imports);
    wasi.setMemory(instance.exports.memory);
    instance.exports._initialize();
    E.ex = instance.exports;
    setLoad(0.66, 'CT wird geladen …');
    const ct = await fetchCached(cfg.ctFile, 'CT', 39.0e6, 0.66, 0.3);
    const p = E.ex.cs_alloc(ct.length); new Uint8Array(E.ex.memory.buffer).set(ct, p);
    if (!E.ex.cs_set_volume(p, ct.length)) throw new Error('CT konnte nicht gelesen werden');
    startWorker(module, ct);
    setLoad(1, 'Fertig – Fall wählen');
    await new Promise(r => setTimeout(r, 450));
    loaderHide();
    E.ex.cs_catalog(); return E.result();
  }

  // ---------- Startmenü ----------
  const S = { page: 0, domain: 'Neuro', scenario: 0, difficulty: 1, stage: 0, tray: [], catalog: null };
  const pages = [['Fall', 'list'], ['Bedingungen', 'sliders'], ['Material', 'tray'], ['Handy', 'phone']];
  const symbols = { 'circle.hexagongrid': 'aneurysm', 'octagon': 'thrombus', 'capsule.portrait': 'stent', 'drop': 'drop', 'magnifyingglass': 'search' };
  function renderSetup() {
    $('steps').innerHTML = pages.map((p, i) => `<button class="${i === S.page ? 'lit' : ''}" data-page="${i}">${ic(p[1])}${p[0]}</button>${i < pages.length - 1 ? `<span style="color:rgba(255,255,255,.3)">${ic('chevR')}</span>` : ''}`).join('');
    document.querySelectorAll('.page').forEach((el, i) => el.classList.toggle('on', i === S.page));
    const cat = S.catalog; const sc = cat.scenarios[S.scenario];
    $('domains').innerHTML = ['Neuro', 'Allgemeine Radiologie'].map(d => `<button class="${S.domain === d ? 'lit' : ''}" data-domain="${d}">${ic(d === 'Neuro' ? 'brain' : 'body')}<span>${d}</span></button>`).join('');
    $('cases').innerHTML = cat.scenarios.map((s, i) => s.domain !== S.domain ? '' : `<button class="card glass ${i === S.scenario ? 'sel' : ''}" data-sc="${i}"><span class="ico">${ic(symbols[s.symbol] || 'circle')}</span><span><div class="t">${s.title}</div><div class="s">${s.brief}</div></span>${s.playable ? '' : '<span class="s" style="color:#ffa030">in Vorbereitung</span>'}</button>`).join('');
    $('caseDetail').innerHTML = `<h3>ABLAUF</h3><div style="font-size:16px;font-weight:700;margin-bottom:6px">${sc.title}</div><div style="color:rgba(255,255,255,.7);margin-bottom:12px">${sc.brief}</div>` +
      sc.steps.map((st, i) => `<div style="font-size:11px;color:var(--dim);margin:3px 0">${i + 1}. ${st}</div>`).join('') +
      (sc.source ? `<div style="font-size:10px;color:var(--dim);margin-top:8px">Quelle: ${sc.source}</div>` : '') +
      sc.notes.map(n => `<div style="font-size:11px;color:rgba(255,220,100,.85);margin-top:6px">${ic('warn')} ${n}</div>`).join('');
    $('difficulties').innerHTML = cat.difficulties.map((d, i) => `<button class="card glass ${i === S.difficulty ? 'sel' : ''}" data-diff="${i}"><span class="ico">${ic(['circle', 'fine', 'dot', 'flame'][i] || 'circle')}</span><span><div class="t">${d.name}</div><div class="s">${d.note}</div></span></button>`).join('');
    $('stages').innerHTML = cat.stages.map((s, i) => `<button class="card glass ${i === S.stage ? 'sel' : ''}" data-stage="${i}"><span class="ico">${ic(['flag', 'route', 'target'][i] || 'circle')}</span><span><div class="t">${s.label}</div><div class="s">${s.note}</div></span></button>`).join('');
    const cats = [...new Set(cat.catalog.map(d => d.cat))];
    $('tray').innerHTML = cats.map(c => { const items = cat.catalog.filter(d => d.cat === c); const n = items.filter(d => S.tray.includes(d.id)).length;
      return `<details><summary style="cursor:pointer;font-size:10px;letter-spacing:.1em;color:rgba(255,255,255,.55);margin:8px 0">${c.toUpperCase()} ${n ? `<span style="color:var(--accent)">${n}</span>` : ''} <span style="color:rgba(255,255,255,.3)">${items.length}</span></summary>` +
        items.map(d => `<button class="card ${S.tray.includes(d.id) ? 'sel' : ''}" data-tray="${d.id}"><span class="ico">${ic(S.tray.includes(d.id) ? 'check' : 'circle')}</span><span><div class="t">${d.short}</div><div class="s">${d.desc}</div></span></button>`).join('') + '</details>'; }).join('');
    $('footInfo').innerHTML = `<b>${sc.title}</b><br>${cat.difficulties[S.difficulty].name} · Start: ${cat.stages[S.stage].label} · ${S.tray.length} Teile auf dem Tisch`;
    $('back').style.visibility = S.page > 0 ? 'visible' : 'hidden'; $('next').style.display = S.page < pages.length - 1 ? '' : 'none';
    // Der Fall startet erst am Ende des Wegs – jede Seite wird einmal gesehen.
    $('start').style.display = S.page === pages.length - 1 ? '' : 'none';
    if (S.page === pages.length - 1) ensureLink();
    $('start').disabled = !sc.playable || !S.tray.length;
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b || !S.catalog) return;
    const d = b.dataset;
    if (d.page !== undefined) S.page = +d.page;
    else if (d.domain) { S.domain = d.domain; const first = S.catalog.scenarios.findIndex(s => s.domain === d.domain); if (S.catalog.scenarios[S.scenario].domain !== d.domain && first >= 0) { S.scenario = first; S.tray = [...S.catalog.scenarios[first].recommended || []]; resetTray(); } }
    else if (d.sc !== undefined) { S.scenario = +d.sc; resetTray(); }
    else if (d.diff !== undefined) S.difficulty = +d.diff;
    else if (d.stage !== undefined) S.stage = +d.stage;
    else if (d.tray) { const i = S.tray.indexOf(d.tray); if (i >= 0) S.tray.splice(i, 1); else S.tray.push(d.tray); }
    else return;
    renderSetup();
  });
  function resetTray() { S.tray = [...(S.catalog.scenarios[S.scenario].recommended || [])]; }
  $('back').onclick = () => { S.page = Math.max(0, S.page - 1); renderSetup(); };
  $('next').onclick = () => { S.page = Math.min(pages.length - 1, S.page + 1); renderSetup(); };
  $('start').onclick = () => startCase();
  $('change').onclick = () => { stopLoop(); $('station').classList.remove('on'); $('setup').classList.add('on'); renderSetup(); };

  // ---------- Station ----------
  const T = { running: false, last: 0, snap: null, hud: null, body: null, bodyKey: '', bodyTimer: null, fine: false, noisePhase: 0, dirty: true, lastHud: 0 };
  const fluoro = $('fluoro');
  function startCase() {
    const [p, n] = E.str(S.tray.join(','));
    E.ex.cs_start(S.scenario, S.difficulty, S.stage, p, n);
    E.ex.cs_refresh();
    $('setup').classList.remove('on'); $('station').classList.add('on');
    T.snap = null; T.body = null; T.bodyKey = ''; T.dirty = true;
    fillAddMenu(); startLoop();
  }
  function fillAddMenu() {
    const sel = $('addDevice'); sel.innerHTML = '<option value="">Weiteres Material …</option>' + S.catalog.catalog.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    sel.onchange = () => { if (sel.value) { const [p, n] = E.str(sel.value); E.ex.cs_add_device(p, n); sel.value = ''; T.dirty = true; } };
  }
  function readFrame() { E.ex.cs_frame(); T.snap = E.result(); }
  function readHud() { E.ex.cs_hud(); T.hud = E.result(); }

  // Tischfahren rechnet das Körperbild nicht neu: es ist größer als das Bildfeld und wird
  // nur verschoben — erst wenn der Rand erreicht ist, kommt ein neues.
  function bodyKeyOf() { const sn = T.snap; if (!sn) return ''; const mag0 = sn.sid / sn.sod;
    // Verschoben wird das fertige Bild; neu gerechnet erst, wenn der mitgerechnete Rand halb aufgebraucht ist.
    const reach = (1.3 - 1) / 2 * sn.fov / mag0 * 0.96;
    // Verglichen wird mit der zuletzt *angeforderten* Tischstellung, nicht mit dem fertigen
    // Bild – sonst zählt jeder Aufruf hoch, solange der Worker noch rechnet, und keine
    // Antwort passt mehr zur Anfrage.
    const ref = T.bodyReq ? T.bodyReq.pan : (T.body ? T.body.pan : null);
    if (ref && Math.max(Math.abs(sn.pan[0] - ref[0]), Math.abs(sn.pan[1] - ref[1])) > reach * 0.5) T.panGen = (T.panGen || 0) + 1;
    return `${sn.lao}|${sn.cranial}|${sn.fov}|${T.panGen || 0}`; }
  function renderBody(size) {
    const sn = T.snap; const coverage = 1.3;
    // Tischstellung auf ein Achtel des Bildfelds gerastert — wie auf dem Mac
    const mag0 = sn.sid / sn.sod, step = sn.fov / 8 / mag0;
    const qx = Math.round(sn.pan[0] / step) * step, qy = Math.round(sn.pan[1] / step) * step;
    T.bodyReq = { pan: [qx, qy], lao: sn.lao, cranial: sn.cranial, fov: sn.fov };
    if (W.worker && W.ready) {
      // Im Hintergrund rechnen; das alte Bild bleibt stehen, bis das neue da ist.
      W.want = { id: ++W.seq, coverage, pan: [qx, qy], sid: sn.sid, sod: sn.sod };
      W.worker.postMessage({ id: W.seq, size, coverage, lao: sn.lao, cranial: sn.cranial, fov: sn.fov, pan: [qx, qy], iso: sn.iso });
      return;
    }
    const ptr = E.ex.cs_body(size, coverage, sn.lao, sn.cranial, sn.fov, qx, qy); if (!ptr) return;
    const gray = new Uint8Array(E.ex.memory.buffer, ptr, size * size);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
    // Die Schwächungsrechnung liefert die Zeilen von unten nach oben (Core-Graphics-Konvention der Mac-App).
    for (let y = 0; y < size; y++) { const src = (size - 1 - y) * size; for (let x = 0; x < size; x++) { const g = gray[src + x]; const o = (y * size + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = g; img.data[o + 3] = 255; } }
    ctx.putImageData(img, 0, 0);
    T.body = { canvas: c, coverage, pan: [qx, qy], sid: sn.sid, sod: sn.sod, size };
  }
  function updateBody() {
    if (!T.snap) return; const key = bodyKeyOf();
    if (key !== T.bodyKey) { T.bodyKey = key; renderBody(224); T.fine = false; clearTimeout(T.bodyTimer); T.bodyTimer = setTimeout(() => { if (T.bodyKey === key) { renderBody(448); T.fine = true; T.dirty = true; } }, 400); }
  }

  function loop(ts) {
    if (!T.running) return;
    const dt = Math.min(0.1, (ts - T.last) / 1000 || 0.016); T.last = ts;
    const t0 = performance.now(); const fresh = E.ex.cs_tick(dt); T.stats.tick += performance.now() - t0; T.stats.tickN++;
    if (fresh || T.dirty) { const t1 = performance.now(); readFrame(); T.noisePhase++; T.stats.frame += performance.now() - t1; T.stats.frameN++; }
    if (ts - T.lastHud > 60 || fresh || T.dirty) { const t0 = performance.now(); readHud(); T.lastHud = ts; updateBody(); updateHud(); T.stats.hud += performance.now() - t0; T.stats.hudN++; }
    if (fresh || T.dirty) {
      const t2 = performance.now();
      CathSimFluoro.render(fluoro, T.snap, T.body, { pulse: T.hud.pulse, fluoroOn: T.hud.fluoroOn, noisePhase: T.noisePhase });
      CathSimFluoro.renderStrip($('stripCanvas'), T.hud); T.dirty = false; T.stats.render += performance.now() - t2; T.stats.renderN++;
    }
    const col = CathSimFluoro.renderECG($('ecg'), T.hud.vitals, T.hud.elapsed);
    requestAnimationFrame(loop);
  }
  function startLoop() { T.running = true; T.last = performance.now(); T.stats = { tick: 0, tickN: 0, frame: 0, frameN: 0, hud: 0, hudN: 0, render: 0, renderN: 0 }; requestAnimationFrame(loop); }
  function stopLoop() { T.running = false; }

  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; T.dirty = true; }, true);
  function setHTML(id, html) { const el = $(id); if (pointerDown || el.dataset.sig === html) return; el.dataset.sig = html; el.innerHTML = html; }
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function updateHud() {
    const h = T.hud, c = h.carm, m = T.snap ? T.snap.mode : 'fluoro';
    $('title').textContent = h.title;
    $('hudTL').textContent = `${c.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(c.lao))}°   ${c.cranial >= 0 ? 'CRA' : 'CAU'} ${Math.abs(Math.round(c.cranial))}°\nFOV ${Math.round(c.fov)} mm\n${m === 'dsa' ? 'DSA' : (m.startsWith('roadmap') ? 'ROADMAP' : '')}\n${Math.round(h.pulse)} P/s   ${Math.round(h.hr)}/min`;
    $('hudTR').innerHTML = `<span style="color:${h.fluoroOn ? '#ff8a2a' : 'rgba(255,255,255,.35)'};font-weight:700">STRAHLUNG ${ic(h.fluoroOn ? 'dot' : 'circle')}</span>\n${fmt(h.caseTime)}\nDL ${h.fluoroSeconds.toFixed(1)} s\nDFP ${h.dap.toFixed(2)} Gy·cm²\nKa ${Math.round(h.ka)} mGy\nKM ${Math.round(h.km)} ml${h.hasAneurysm ? `\nPackung ${Math.round(h.packing * 100)} % · Verschluss ${Math.round((h.occl || 0) * 100)} %` : ''}`;
    const act = h.devices[h.active];
    $('hudBL').innerHTML = `${h.tip}<br><span class="mono" style="font-weight:400;color:rgba(255,255,255,.5)">${act ? `${act.name} · ${Math.round(act.ins)} mm · ${Math.round(act.rot * 180 / Math.PI)}°` : ''}</span>${L.allowed ? `<br><span style="color:var(--accent2);font-weight:600">${ic('phone')} ${L.allowed} steuert</span>` : ''}`;
    const v = h.vitals; const cls = (v.shock > 0.55 || (v.arr || 0) >= 0.7) ? 'red' : ((v.shock > 0.25 || (v.arr || 0) > 0.25) ? 'orange' : '');
    $('vitals').className = cls; $('vHr').textContent = Math.round(v.hr); $('vRr').textContent = `${Math.round(v.sys)}/${Math.round(v.dia)}`; $('vSp').textContent = Math.round(v.spo2);
    $('vHr').style.color = v.hr > 110 ? (cls === 'red' ? '#ff5a5a' : '#ffa030') : '#fff'; $('vRr').style.color = v.sys < 95 ? (cls === 'red' ? '#ff5a5a' : '#ffa030') : '#fff';
    setHTML('badges', (h.force > 0.15 ? `<span class="badge ${h.force > 0.7 ? 'red' : 'warn'}">${ic('warn')} Widerstand</span> ` : '') + (h.completed ? `<span class="badge ok">${ic('check')} Ziel erreicht</span>` : ''));
    const msg = $('msg'); if (h.dead) { msg.innerHTML = ic('stop') + ' Patient verstorben – Fall beenden'; msg.className = 'on danger'; } else if (h.alert) { msg.innerHTML = ic(h.alert.k === 'danger' ? 'stop' : 'warn') + ' ' + h.alert.t.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); msg.className = 'on ' + h.alert.k; } else msg.className = '';
    setHTML('devices', h.devices.map(d => `<button class="dev ${d.i === h.active ? 'active' : ''}" data-dev="${d.i}"><span>${d.wire ? '╱' : '▭'}</span><span class="n">${d.name}<span class="d">${d.desc}</span></span><span class="mm">${d.inserted ? Math.round(d.ins) + ' mm' : ''}</span></button>`).join(''));
    setHTML('shapes', act && act.shapeable ? `<span style="width:100%;font-size:9px;letter-spacing:.1em;color:rgba(255,255,255,.5)">SPITZE FORMEN${act.inserted ? ' · erst herausziehen' : ''}</span>` + h.shapes.map(s => `<button class="${(s.d < 0 ? act.stock : (!act.stock && Math.abs(act.tip - s.d) < 1)) ? 'lit' : ''}" data-shape="${s.d}">${s.l}</button>`).join('') : '');
    $('bFluoro').classList.toggle('lit', h.fluoroOn); $('bRoad').classList.toggle('lit', h.roadmapArmed || h.roadmapActive);
    const hasFiller = h.devices.some(d => d.kind === 'coil' || d.kind === 'web');
    $('bDetach').style.display = hasFiller ? '' : 'none'; $('bDetach').textContent = act && act.kind === 'web' ? 'WEB ablösen' : 'Coil ablösen'; $('bDetach').classList.toggle('lit', h.coilReady);
    $('vLao').textContent = `${c.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(c.lao))}°`; $('vCra').textContent = `${c.cranial >= 0 ? 'CRAN' : 'CAUD'} ${Math.abs(Math.round(c.cranial))}°`;
    setHTML('fovs', [48, 42, 31, 27, 22, 19, 15].map(cm => `<button class="${Math.abs(c.fov - cm * 7) < 6 ? 'lit' : ''}" data-fov="${cm * 7}">${cm}</button>`).join(''));
    setHTML('events', h.events.slice().reverse().map(e => `<div class="${e.k}">${e.t}</div>`).join(''));
    $('stripLoc').textContent = h.tip;
  }

  // Bedienung
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return; const d = b.dataset; const ex = E.ex;
    if (d.allow !== undefined) { L.allowed = d.allow; L.lead = d.allow; renderWho(); return; }
    if (!T.running) return;
    if (d.dev !== undefined) ex.cs_select(+d.dev);
    else if (d.adv) ex.cs_advance(+d.adv, -1);
    else if (d.tq) ex.cs_torque(+d.tq, -1);
    else if (d.lao) { const c = T.hud.carm; ex.cs_carm(c.lao + (+d.lao), c.cranial, c.fov); }
    else if (d.cra) { const c = T.hud.carm; ex.cs_carm(c.lao, c.cranial + (+d.cra), c.fov); }
    else if (d.fov) { const c = T.hud.carm; ex.cs_carm(c.lao, c.cranial, +d.fov); }
    else if (d.shape !== undefined) ex.cs_shape(T.hud.active, +d.shape);
    else if (b.id === 'bFluoro') ex.cs_fluoro(T.hud.fluoroOn ? 0 : 1);
    else if (b.id === 'bKM') ex.cs_inject(6);
    else if (b.id === 'bDSA') ex.cs_dsa();
    else if (b.id === 'bRoad') ex.cs_roadmap();
    else if (b.id === 'bAsp') ex.cs_aspirate();
    else if (b.id === 'bDetach') ex.cs_detach();
    else if (b.id === 'bWithdraw') ex.cs_withdraw(T.hud.active);
    else if (b.id === 'bCenter') ex.cs_center();
    else return;
    T.dirty = true;
  });
  const held = new Set();
  document.addEventListener('keydown', (ev) => {
    if (!T.running || ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
    held.add(ev.key); const fine = held.has('f') || held.has('F'); const ex = E.ex; let used = true;
    switch (ev.key) {
      case 'ArrowUp': ex.cs_advance(fine ? 1 : 5, -1); break;
      case 'ArrowDown': ex.cs_advance(fine ? -1 : -5, -1); break;
      case 'ArrowLeft': ex.cs_torque(fine ? -0.05 : -0.2, -1); break;
      case 'ArrowRight': ex.cs_torque(fine ? 0.05 : 0.2, -1); break;
      case ' ': if (!ev.repeat) ex.cs_fluoro(T.hud.fluoroOn ? 0 : 1); break;
      case 'c': if (!ev.repeat) ex.cs_inject(6); break;
      case 'd': if (!ev.repeat) ex.cs_dsa(); break;
      case 'r': if (!ev.repeat) ex.cs_roadmap(); break;
      case 'x': if (!ev.repeat) ex.cs_aspirate(); break;
      case 'Tab': if (!ev.repeat) ex.cs_select((T.hud.active + 1) % T.hud.devices.length); break;
      case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': ex.cs_select(+ev.key - 1); break;
      default: used = false;
    }
    if (used) { ev.preventDefault(); T.dirty = true; }
  });
  document.addEventListener('keyup', (ev) => held.delete(ev.key));
  // Ziehen im Bild fährt den Tisch
  let drag = null;
  fluoro.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; fluoro.setPointerCapture(e.pointerId); });
  fluoro.addEventListener('pointermove', (e) => { if (!drag || !T.hud) return; const c = T.hud.carm; const side = Math.min(fluoro.clientWidth, fluoro.clientHeight); const k = c.fov / side * c.sod / c.sid; E.ex.cs_table((e.clientX - drag[0]) * k, (e.clientY - drag[1]) * k); drag = [e.clientX, e.clientY]; T.dirty = true; });
  fluoro.addEventListener('pointerup', () => { drag = null; }); fluoro.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('resize', () => { T.dirty = true; });

  window.CS = { T, E, S, W, loop, updateHud, readHud, readFrame, bodyKeyOf, updateBody };
  // ---------- Handy-Verbindung ----------
  const L = { link: null, code: null, lastStatus: 0, people: {}, lead: '', rejected: {}, allowed: '' };
  const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  function applyControl(m) {
    const ex = E.ex;
    if (m.by) { L.people[m.by] = Date.now(); if (!L.allowed && sameName(m.by, userName())) L.allowed = m.by; renderWho(); }
    if (!T.running) return;
    if (m.t === 'hb') return;
    // Es steuert nur, wen die Station ausgewählt hat; alle anderen schauen zu.
    if (!m.by || m.by !== L.allowed) return;
    L.lead = m.by;
    switch (m.t) {
      case 'adv': ex.cs_advance(m.mm, m.i ?? -1); break;
      case 'tq': ex.cs_torque(m.rad, m.i ?? -1); break;
      case 'sel': ex.cs_select(m.i); break;
      case 'wd': ex.cs_withdraw(m.i); break;
      case 'shape': ex.cs_shape(m.i, m.deg); break;
      case 'sheath': ex.cs_sheath(m.i, m.mm); break;
      case 'carm': ex.cs_carm(m.lao, m.cra, m.fov); break;
      case 'table': ex.cs_table(m.dx, m.dy); break;
      case 'act':
        if (m.a === 'fluoro') ex.cs_fluoro(T.hud && T.hud.fluoroOn ? 0 : 1); else if (m.a === 'km') ex.cs_inject(6); else if (m.a === 'dsa') ex.cs_dsa();
        else if (m.a === 'road') ex.cs_roadmap(); else if (m.a === 'asp') ex.cs_aspirate(); else if (m.a === 'detach') ex.cs_detach(); else if (m.a === 'center') ex.cs_center();
        break;
    }
    T.dirty = true;
  }
  function peopleList() { const now = Date.now(); for (const k of Object.keys(L.people)) if (now - L.people[k] > 15000) delete L.people[k]; return Object.keys(L.people); }
  const esc = (t) => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  function renderWho() {
    const names = peopleList();
    if (L.allowed && !names.includes(L.allowed)) L.allowed = '';
    if (!L.allowed && names.length) L.allowed = names.find(n => sameName(n, userName())) || names[0];
    // Im Fenster: alle Verbundenen als Chips, der Steuernde hervorgehoben
    const html = names.length
      ? names.map(n => `<button class="chip ${n === L.allowed ? 'lead' : ''}" data-allow="${esc(n)}">${ic(n === L.allowed ? 'phone' : 'eye')}${esc(n)}${n === L.allowed ? ' · steuert' : ''}</button>`).join('')
      : `<div class="none">${ic('wifi')} noch kein Handy verbunden – Code ${esc(L.code || '')} eingeben oder QR-Code scannen</div>`;
    for (const w of document.querySelectorAll('.whobox')) { if (w.dataset.sig !== html && !pointerDown) { w.dataset.sig = html; w.innerHTML = html; } }
    // In der Seitenleiste nur eine Zeile
    const others = names.filter(n => n !== L.allowed);
    setHTML('linkWho', !L.link ? '' : `<span class="code">${esc(L.code)}</span> · ${names.length ? `<b>${esc(L.allowed)}</b> steuert${others.length ? ` · ${others.map(esc).join(', ')} ${others.length > 1 ? 'schauen' : 'schaut'} zu` : ''}` : 'wartet auf Handys'}`);
    $('hudBL').dataset.who = L.lead;
  }
  function phoneStatus() {
    const h = T.hud; if (!h) return null;
    return { title: h.title, tip: h.tip, active: h.active, fluoroOn: h.fluoroOn, roadmapArmed: h.roadmapArmed, roadmapActive: h.roadmapActive, completed: h.completed, coilReady: h.coilReady,
      alert: h.alert, vitals: h.vitals, shapes: h.shapes, carm: h.carm, people: peopleList(), lead: L.lead, allowed: L.allowed, user: userName(),
      devices: h.devices.map(d => ({ name: d.name, kind: d.kind, inserted: d.inserted, ins: d.ins, rot: d.rot, od: d.od, rank: d.rank, deployed: d.deployed, implant: d.implant, tip: d.tip, wire: d.wire, shapeable: d.shapeable, stock: d.stock })) };
  }
  function controllerURL() { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}controller.html?code=${L.code}`; }
  const all = (cls) => Array.from(document.querySelectorAll('.' + cls));
  function ensureLink() {
    if (L.link) { renderWho(); return; }
    L.code = CathSimLink.makeCode();
    for (const q of all('qrbox')) { q.innerHTML = ''; try { new QRCode(q, { text: controllerURL(), width: 212, height: 212, correctLevel: QRCode.CorrectLevel.M }); } catch (e) {} }
    for (const c of all('codebox')) c.textContent = L.code;
    for (const u of all('urlbox')) u.textContent = controllerURL();
    const setState = (html, ok) => { for (const st of all('statebox')) { st.innerHTML = `<span class="led"></span>${html}`; st.classList.toggle('ok', ok); } };
    setState('verbinde …', false);
    L.link = CathSimLink.connect(L.code, 'station', (kind, msg) => {
      if (kind === 'ctrl') applyControl(msg);
      if (kind === 'hello' && msg.role === 'controller' && msg.name) { L.people[msg.name] = Date.now(); renderWho(); }
    }, (st) => { const ok = st === 'verbunden'; setState(ok ? 'bereit – Code scannen oder eingeben' : esc(st), ok); });
    $('bLink').innerHTML = `${ic('phone')} Handys`; $('bLink').classList.add('lit');
    renderWho();
  }
  function openLink() { ensureLink(); $('linkModal').classList.add('on'); }
  function dropLink() {
    if (L.link) { L.link.close(); L.link = null; }
    L.code = null; L.people = {}; L.lead = ''; L.allowed = '';
    $('bLink').innerHTML = `${ic('phone')} Handy verbinden`; $('bLink').classList.remove('lit'); $('linkModal').classList.remove('on'); renderWho();
  }
  $('bLink').onclick = openLink;
  Object.defineProperty(window.CS, 'L', { get: () => L }); Object.assign(window.CS, { renderWho, openLink, dropLink });
  $('linkDrop').onclick = dropLink;
  $('linkClose').onclick = $('linkDone').onclick = () => $('linkModal').classList.remove('on');
  $('linkModal').addEventListener('click', (e) => { if (e.target === $('linkModal')) $('linkModal').classList.remove('on'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('linkModal').classList.contains('on')) $('linkModal').classList.remove('on'); });
  setInterval(() => { if (!L.link || !L.link.connected) return; if (T.running) { const st = phoneStatus(); if (st) L.link.send(st); } else if ((Date.now() / 1000 | 0) % 2 === 0) L.link.send({ waiting: true, people: peopleList(), lead: L.lead, allowed: L.allowed, user: userName() }); }, 100);

  // ---------- Start ----------
  function gateOk() { try { return !!localStorage.getItem('cathsim.token') && !!localStorage.getItem('cathsim.user'); } catch (e) { return false; } }
  function userName() { try { return (localStorage.getItem('cathsim.user') || '').trim(); } catch (e) { return ''; } }
  function logout() { try { ['cathsim.code', 'cathsim.user', 'cathsim.token', 'cathsim.role'].forEach(k => localStorage.removeItem(k)); } catch (e) {} location.reload(); }
  $('logout1').onclick = logout; $('logout2').onclick = logout;
  // Neue Version veröffentlicht? Dann einmal frisch laden, statt mit alten Skripten weiterzumachen.
  async function checkVersion() {
    if (!window.CATHSIM_BUILD) return;
    try { const v = (await (await fetch('version.txt', { cache: 'no-store' })).text()).trim();
      if (v && v !== window.CATHSIM_BUILD && sessionStorage.getItem('cathsim.reloaded') !== v) { sessionStorage.setItem('cathsim.reloaded', v); try { await fetch(location.pathname || '/', { cache: 'reload' }); } catch (e) {} location.reload(); }
    } catch (e) {}
  }
  checkVersion();
  { const b = window.CATHSIM_BUILD; const el = document.getElementById('buildTag'); if (el) el.textContent = b ? `Build ${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)} ${b.slice(8, 10)}:${b.slice(10, 12)}` : 'Build lokal'; }
  // ---------- Anmeldung über den Worker ----------
  const EP = () => (cfg.logEndpoint || '').replace(/\/$/, '');
  async function authRequest(body) {
    if (!EP()) throw new Error('Anmeldeserver nicht eingerichtet');
    let r; try { r = await fetch(EP() + '/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ build: window.CATHSIM_BUILD || 'dev' }, body)) }); }
    catch (e) { throw new Error('Anmeldeserver nicht erreichbar'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'Anmeldung fehlgeschlagen');
    return j;
  }
  const token = () => { try { return localStorage.getItem('cathsim.token') || ''; } catch (e) { return ''; } };
  const isAdmin = () => { try { return localStorage.getItem('cathsim.role') === 'admin'; } catch (e) { return false; } };
  async function adminGet(path) { const r = await fetch(EP() + path + '?x=' + Date.now(), { headers: { 'x-token': token() }, cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
  const fmtT = (t) => { const d = new Date(t); return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  async function openAdmin() {
    $('admin').classList.add('on'); $('adminWho').textContent = userName();
    try { const u = await adminGet('/admin/users'); $('adminUsers').value = u.join('\n'); } catch (e) { $('adminUsers').value = ''; }
    try {
      const rows = await adminGet('/admin/logins');
      $('adminLogins').innerHTML = rows.length ? rows.slice(-200).reverse().map(r => `<div><b>${esc(r.name)}</b> <span class="r">${r.role === 'controller' ? 'Handy' : (r.role === 'admin' ? 'Admin' : 'Station')} · ${fmtT(r.t)}</span></div>`).join('') : '<span style="color:var(--dim)">noch keine Anmeldungen</span>';
    } catch (e) { $('adminLogins').innerHTML = `<span style="color:var(--dim)">${esc(e.message)}</span>`; }
    try {
      const cs = await adminGet('/admin/comments');
      $('adminComments').innerHTML = cs.length ? cs.slice(-200).reverse().map(c => `<div class="c"><div class="m"><b style="color:var(--fg)">${esc(c.name)}</b> · ${esc(c.caseTitle || 'Allgemein')} · ${fmtT(c.t)}</div><div>${esc(c.text).replace(/\n/g, '<br>')}</div></div>`).join('') : '<span style="color:var(--dim)">noch keine Kommentare</span>';
    } catch (e) { $('adminComments').innerHTML = `<span style="color:var(--dim)">${esc(e.message)}</span>`; }
  }
  $('adminSave').onclick = async () => {
    const users = $('adminUsers').value.split('\n').map(s => s.trim()).filter(Boolean);
    try { const r = await fetch(EP() + '/admin/users', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-token': token() }, body: JSON.stringify({ users }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Fehler'); $('adminUsers').value = j.users.join('\n'); $('adminSaved').textContent = `gespeichert – ${j.users.length} Namen`; setTimeout(() => { $('adminSaved').textContent = ''; }, 3000); }
    catch (e) { $('adminSaved').textContent = e.message; }
  };
  $('adminToStation').onclick = () => { $('admin').classList.remove('on'); if (!S.catalog) boot(); };
  // ---------- Kommentare zu Fällen (Testphase, später wieder abbauen) ----------
  function currentCase() { const sc = S.catalog && S.catalog.scenarios[S.scenario]; return sc ? { caseId: sc.id, caseTitle: sc.title } : { caseId: '', caseTitle: '' }; }
  $('bNote').onclick = () => { const c = currentCase(); $('noteCase').textContent = c.caseTitle ? `Fall: ${c.caseTitle}` : 'Allgemein'; $('noteState').textContent = 'Geht direkt an Jonathan. Testphase.'; $('noteModal').classList.add('on'); $('noteText').focus(); };
  $('noteClose').onclick = () => $('noteModal').classList.remove('on');
  $('noteModal').addEventListener('click', (e) => { if (e.target === $('noteModal')) $('noteModal').classList.remove('on'); });
  $('noteSend').onclick = async () => {
    const text = $('noteText').value.trim(); if (!text) { $('noteState').textContent = 'Bitte etwas schreiben'; return; }
    $('noteSend').disabled = true;
    try {
      const r = await fetch(EP() + '/comment', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': token() }, body: JSON.stringify(Object.assign({ text, build: window.CATHSIM_BUILD || 'dev' }, currentCase())) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Fehler');
      $('noteText').value = ''; $('noteState').textContent = 'Danke – angekommen.'; setTimeout(() => $('noteModal').classList.remove('on'), 900);
    } catch (e) { $('noteState').textContent = 'Nicht gesendet: ' + e.message; }
    $('noteSend').disabled = false;
  };
  $('adminOpen').onclick = openAdmin;
  $('adminLogout').onclick = () => logout();
  $('toAdmin').onclick = () => { $('gateUser').style.display = 'none'; $('gateAdmin').style.display = ''; $('toAdmin').style.display = 'none'; $('toUser').style.display = ''; $('adminEmail').focus(); };
  $('toUser').onclick = () => { $('gateAdmin').style.display = 'none'; $('gateUser').style.display = ''; $('toUser').style.display = 'none'; $('toAdmin').style.display = ''; };
  $('adminGo').onclick = async () => {
    $('adminErr').textContent = '';
    try { const j = await authRequest({ email: $('adminEmail').value.trim(), password: $('adminPw').value });
      try { localStorage.setItem('cathsim.user', j.name); localStorage.setItem('cathsim.token', j.token); localStorage.setItem('cathsim.role', 'admin'); } catch (e) {}
      $('adminPw').value = ''; $('gate').style.display = 'none'; openAdmin();
    } catch (e) { $('adminErr').textContent = e.message; }
  };
  $('adminEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('adminPw').focus(); });
  $('adminPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('adminGo').click(); });
  // Anmeldung ins Protokoll schreiben (nur wenn ein Endpunkt eingerichtet ist)
  function logLogin(name, role) {
    if (!cfg.logEndpoint || !name) return Promise.resolve();
    try { return fetch(cfg.logEndpoint.replace(/\/$/, '') + '/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cathsim': cfg.logKey || '' }, body: JSON.stringify({ name, role, t: Date.now(), build: window.CATHSIM_BUILD || 'dev', ua: navigator.userAgent.slice(0, 80) }), keepalive: true }).catch(() => {}); } catch (e) { return Promise.resolve(); }
  }
  async function loadLogins() {
    const box = $('loginList'); if (!box) return;
    if (!cfg.logEndpoint) { box.innerHTML = `<span style="color:var(--dim)">Protokoll nicht eingerichtet – siehe worker/README.md</span>`; return; }
    if (!isAdmin()) { box.innerHTML = `<span style="color:var(--dim)">Die Anmeldungen sieht der Admin unter „Verwaltung" auf der Startseite.</span>`; return; }
    try {
      const rows = await adminGet('/admin/logins');
      const fmt = (t) => { const d = new Date(t); return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      box.innerHTML = rows.length ? rows.slice(-40).reverse().map(r => `<div><b>${esc(r.name)}</b> <span style="color:var(--dim)">${r.role === 'controller' ? 'Handy' : 'Station'} · ${fmt(r.t)}</span></div>`).join('') : `<span style="color:var(--dim)">noch keine Anmeldungen</span>`;
    } catch (e) { box.innerHTML = `<span style="color:var(--dim)">Protokoll nicht erreichbar</span>`; }
  }
  async function boot() {
    $('gate').style.display = 'none';
    loadLogins();
    $('setupUser').textContent = userName();
    $('adminOpen').style.display = isAdmin() ? '' : 'none';
    loaderShow(); setLoad(0.02, 'Engine wird geladen …');
    try {
      S.catalog = await loadEngine();
      // Empfohlenes Material steckt nicht im Katalog-JSON: über den Fall nachladen
      S.catalog.scenarios.forEach((s, i) => { s.recommended = s.recommended || []; });
      E.ex.cs_start(0, 1, 0, 0, 0); E.ex.cs_hud(); const h = E.result(); S.catalog.scenarios[0].recommended = h.devices.map(d => d.id);
      for (let i = 1; i < S.catalog.scenarios.length; i++) { E.ex.cs_start(i, 1, 0, 0, 0); E.ex.cs_hud(); S.catalog.scenarios[i].recommended = E.result().devices.map(d => d.id); }
      resetTray(); $('setup').classList.add('on'); renderSetup();
    } catch (err) { setLoad(LD.frac, 'Fehler: ' + err.message); $('ldSub').textContent = 'Seite neu laden und noch einmal versuchen'; console.error(err); }
  }
  $('codeGo').onclick = async () => {
    const u = $('user').value.trim();
    if (!u) { $('codeErr').textContent = 'Bitte einen Namen eingeben'; return; }
    $('codeErr').textContent = ''; $('codeGo').disabled = true;
    try { const j = await authRequest({ name: u, password: $('code').value, role: 'station' });
      try { localStorage.setItem('cathsim.user', j.name); localStorage.setItem('cathsim.token', j.token); localStorage.setItem('cathsim.role', j.role); } catch (e) {}
      $('code').value = ''; boot();
    } catch (e) { $('codeErr').textContent = e.message; }
    $('codeGo').disabled = false;
  };
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('codeGo').click(); });
  $('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('code').focus(); });
  try { const n = localStorage.getItem('cathsim.user'); if (n) $('user').value = n; } catch (e) {}
  if (gateOk()) boot(); else $('user').focus();
})();
