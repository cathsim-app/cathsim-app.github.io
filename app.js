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
    const r = await fetch(url, { cache: window.CATHSIM_BUILD ? 'default' : 'no-cache' }); if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
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
    // Aus dem Netz immer mit Versionsanhang: sonst liefert der HTTP-Cache (GitHub Pages: 10 min)
    // nach einer Veröffentlichung die alte Datei, und sie landete unter der neuen Version im Speicher.
    const bytes = await fetchProgress(`${url}?v=${encodeURIComponent(ver)}`, label, expect, base, span);
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
    // Fälle nach Modulen geordnet: A Sondierung, B Rekanalisation, C Okklusion und Embolisation
    const didCase = (id) => { const rows = (S.done || []).filter(r => r.caseId === id); if (!rows.length) return ''; const last = new Date(Math.max(...rows.map(r => r.t))); return `<div class="did">${ic('check')} ${rows.length}× absolviert · zuletzt ${last.getDate()}.${last.getMonth() + 1}.</div>`; };
    const caseCard = (s, i) => `<button class="card glass ${i === S.scenario ? 'sel' : ''}${caseAllowed(s) ? '' : ' locked'}" data-sc="${i}"><span class="ico">${ic(symbols[s.symbol] || 'circle')}</span><span><div class="t">${s.title}</div><div class="s">${s.brief}</div>${caseAllowed(s) ? didCase(s.id) : `<div class="lock">${ic('stop')} für deine Organisation nicht freigegeben</div>`}</span>${s.playable ? '' : '<span class="s" style="color:#ffa030">in Vorbereitung</span>'}</button>`;
    const inDomain = cat.scenarios.map((s, i) => [s, i]).filter(([s]) => s.domain === S.domain);
    const modules = [...new Set(inDomain.map(([s]) => s.module || ''))].sort();
    // Aufklappbar; offen ist das Modul mit dem gewählten Fall, und was man selbst auf- oder zuklappt, bleibt so.
    const curMod = (cat.scenarios[S.scenario] || {}).module || '';
    $('cases').innerHTML = modules.map(m => { const list = inDomain.filter(([s]) => (s.module || '') === m);
      if (!m) return list.map(([s, i]) => caseCard(s, i)).join('');
      const open = S.modOpen && m in S.modOpen ? S.modOpen[m] : m === curMod;
      return `<details class="mod" data-mod="${m}"${open ? ' open' : ''}><summary>${ic('chevR')}Modul ${m}<span class="cnt">${list.length} Fälle</span></summary>${list.map(([s, i]) => caseCard(s, i)).join('')}</details>`; }).join('');
    document.querySelectorAll('#cases .mod').forEach(d => d.addEventListener('toggle', () => { S.modOpen = S.modOpen || {}; S.modOpen[d.dataset.mod] = d.open; }));
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
    $('start').disabled = !sc.playable || !S.tray.length || !caseAllowed(sc);
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
    E.ex.cs_plane(planeStored()); V.open = false; $('v3d').classList.remove('on');
    SR.rec = null; SR.mask = null; closeSeries(); loadSeries(); debriefShown = false; $('doneModal').classList.remove('on');
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

  // Körperbild der zweiten Ebene: im Hauptthread, klein und erst fein, wenn die Stellung steht.
  function bodyFromEngine(sn, size) {
    const coverage = 1.3, mag0 = sn.sid / sn.sod, step = sn.fov / 8 / mag0;
    const qx = Math.round(sn.pan[0] / step) * step, qy = Math.round(sn.pan[1] / step) * step;
    const ptr = E.ex.cs_body(size, coverage, sn.lao, sn.cranial, sn.fov, qx, qy); if (!ptr) return null;
    const gray = new Uint8Array(E.ex.memory.buffer, ptr, size * size);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) { const src = (size - 1 - y) * size; for (let x = 0; x < size; x++) { const g = gray[src + x]; const o = (y * size + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = g; img.data[o + 3] = 255; } }
    ctx.putImageData(img, 0, 0);
    return { canvas: c, coverage, pan: [qx, qy], sid: sn.sid, sod: sn.sod, size };
  }
  function updateBodyB() {
    const sn = T.snapB; if (!sn) return;
    const mag0 = sn.sid / sn.sod, step = sn.fov / 8 / mag0;
    const key = `${sn.lao}|${sn.cranial}|${sn.fov}|${Math.round(sn.pan[0] / step)}|${Math.round(sn.pan[1] / step)}`;
    if (key === T.bodyKeyB) return; T.bodyKeyB = key;
    T.bodyB = bodyFromEngine(sn, 224); clearTimeout(T.bodyTimerB);
    T.bodyTimerB = setTimeout(() => { if (T.bodyKeyB === key) { T.bodyB = bodyFromEngine(sn, 384); T.dirty = true; } }, 500);
  }

  // ---------- Serien ----------
  // Während einer Serie (subtrahiert) wird jedes Bild mitgeschnitten. Danach kann man durch die
  // Zeitpunkte blättern und ein Bild als Maske wählen: es liegt als Roadmap über der Durchleuchtung,
  // solange C-Bogen und Tisch dieselbe Stellung haben.
  const SR = { list: [], rec: null, open: null, idx: 0, play: false, mask: null, lastPlay: 0 };
  const sameView = (a, b) => a && b && Math.abs(a.lao - b.lao) < 0.6 && Math.abs(a.cranial - b.cranial) < 0.6 && Math.abs(a.fov - b.fov) < 0.6
    && Math.abs(a.pan[0] - b.pan[0]) < 0.6 && Math.abs(a.pan[1] - b.pan[1]) < 0.6;
  function recordSeries() {
    const sn = T.snap; if (!sn) return;
    if (sn.mode === 'dsa' && !(T.hud && T.hud.rotating)) {   // die 3D-Rotation ist keine Serie
      if (!SR.rec) SR.rec = { frames: [], t0: T.hud ? T.hud.elapsed : 0, body: T.body };
      const last = SR.rec.frames[SR.rec.frames.length - 1];
      if (!last || last.snap.gen !== sn.gen) SR.rec.frames.push({ snap: sn, t: (T.hud ? T.hud.elapsed : 0) - SR.rec.t0 });
    } else if (SR.rec) {
      const rec = SR.rec; SR.rec = null;
      if (rec.frames.length > 2) {
        const s0 = rec.frames[0].snap;
        rec.n = (SR.list.reduce((m, r) => Math.max(m, r.n || 0), 0)) + 1; rec.created = Date.now(); rec.caseKey = caseKey();
        rec.view = `${s0.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(s0.lao))}° / ${s0.cranial >= 0 ? 'CRA' : 'CAU'} ${Math.abs(Math.round(s0.cranial))}°`;
        rec.label = `Serie ${rec.n} · ${rec.view} · ${rec.frames.length} Bilder`;
        rec.best = bestFrame(rec); rec.thumb = thumbOf(rec.frames[rec.best].snap, rec.body);
        SR.list.push(rec); saveSeries(rec); renderSeriesList(); openSeries(SR.list.length - 1);
      }
    }
  }
  // Archiv: Serien bleiben je Fall im Browser gespeichert (IndexedDB) und lassen sich später
  // wieder öffnen, durchblättern und als Maske nehmen. Je Fall die letzten 16.
  const caseKey = () => (S.catalog && S.catalog.scenarios[S.scenario] ? S.catalog.scenarios[S.scenario].id : 'fall');
  let seriesDB = null;
  function sdb() {
    if (seriesDB) return seriesDB;
    seriesDB = new Promise((res) => { try { const rq = indexedDB.open('cathsim-series', 1); rq.onupgradeneeded = () => { const st = rq.result.createObjectStore('series', { keyPath: 'id', autoIncrement: true }); st.createIndex('caseKey', 'caseKey'); }; rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (e) { res(null); } });
    return seriesDB;
  }
  async function saveSeries(rec) {
    const db = await sdb(); if (!db) return;
    try {
      const tx = db.transaction('series', 'readwrite'), st = tx.objectStore('series');
      const row = { caseKey: rec.caseKey, n: rec.n, created: rec.created, view: rec.view, label: rec.label, best: rec.best, thumb: rec.thumb, frames: rec.frames };
      const rq = st.add(row); rq.onsuccess = () => { rec.id = rq.result; };
      const old = SR.list.filter(r => r.caseKey === rec.caseKey); if (old.length > 16) { const drop = old[0]; SR.list.splice(SR.list.indexOf(drop), 1); if (drop.id) st.delete(drop.id); renderSeriesList(); }
    } catch (e) { console.warn('Serie nicht gespeichert', e); }
  }
  async function deleteSeries(i) {
    const r = SR.list[i]; if (!r) return; SR.list.splice(i, 1); if (SR.open === r) closeSeries(); renderSeriesList();
    const db = await sdb(); if (db && r.id) try { db.transaction('series', 'readwrite').objectStore('series').delete(r.id); } catch (e) {}
  }
  async function loadSeries() {
    SR.list = []; renderSeriesList(); const key = caseKey();
    const db = await sdb(); if (!db) return;
    try {
      const rq = db.transaction('series').objectStore('series').index('caseKey').getAll(key);
      rq.onsuccess = () => { if (caseKey() !== key) return; SR.list = (rq.result || []).sort((a, b) => a.created - b.created); renderSeriesList(); };
    } catch (e) {}
  }
  function bestFrame(rec) { let bi = 0, bv = -1; rec.frames.forEach((f, i) => { const v = frameFill(f.snap); if (v > bv) { bv = v; bi = i; } }); return bi; }
  function thumbOf(sn, body) {
    const c = $('thumbCanvas'); try { CathSimFluoro.render(c, sn, body, { pulse: 0, fluoroOn: true, noisePhase: 0, motion: 1 }); return c.toDataURL('image/jpeg', 0.7); } catch (e) { return ''; }
  }
  function renderSeriesList() {
    const t = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    $('seriesHead').style.display = SR.list.length ? '' : 'none';
    $('seriesList').innerHTML = SR.list.map((r, i) => `<div class="sc${SR.open === r ? ' on' : ''}${SR.mask && SR.mask.from === r ? ' mask' : ''}" data-series="${i}">${r.thumb ? `<img src="${r.thumb}" alt="">` : '<div class="ph"></div>'}<div class="st"><b>Serie ${r.n}</b>${SR.mask && SR.mask.from === r ? ' · Maske' : ''}<br>${r.view}<br>${r.frames.length} Bilder · ${t(r.created)}</div><button class="sx" data-sdel="${i}" title="Serie löschen">${ic('close')}</button></div>`).join('');
  }
  // Bestes Maskenbild: das mit der meisten Gefäßfüllung (arterielle Spitze)
  function frameFill(sn) { let v = 0; for (const r of sn.vessels) { let w = 0; for (const x of r.w) w += x; v += w * r.o; } for (const b of sn.sac) v += b[2] * b[3] * 20; return v; }
  function openSeries(i) { if (!SR.list[i]) return; SR.open = SR.list[i]; $('svPrev').disabled = i <= 0; $('svNext').disabled = i >= SR.list.length - 1; renderSeriesList(); SR.idx = 0; SR.play = true; SR.lastPlay = performance.now(); $('svSlider').max = SR.open.frames.length - 1; $('svLabel').textContent = SR.open.label; $('sv').classList.add('on'); drawSeries(); }
  function closeSeries() { SR.open = null; SR.play = false; $('sv').classList.remove('on'); T.dirty = true; renderSeriesList(); }
  function drawSeries() {
    if (!SR.open) return; const f = SR.open.frames[SR.idx];
    CathSimFluoro.render($('svCanvas'), f.snap, SR.open.body, { pulse: 0, fluoroOn: true, noisePhase: SR.idx, motion: f.t });
    $('svSlider').value = SR.idx; $('svInfo').textContent = `Bild ${SR.idx + 1}/${SR.open.frames.length} · ${f.t.toFixed(1)} s`;
    $('svPlay').textContent = SR.play ? '❚❚' : '▶︎';
  }
  function tickSeries(ts) {
    if (!SR.open || !SR.play) return;
    if (ts - SR.lastPlay > 140) { SR.lastPlay = ts; SR.idx = (SR.idx + 1) % SR.open.frames.length; drawSeries(); }
  }
  // Kleber: solange gedrückt, fließt er langsam und kontinuierlich (0,1 ml/s)
  let glueTimer = null;
  const glueStop = () => { clearInterval(glueTimer); glueTimer = null; $('bGlue').classList.remove('lit'); };
  $('bGlue').addEventListener('pointerdown', (e) => { e.preventDefault(); if (glueTimer) return; $('bGlue').classList.add('lit'); E.ex.cs_glue(0.01); T.dirty = true; glueTimer = setInterval(() => { E.ex.cs_glue(0.01); T.dirty = true; }, 100); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('bGlue').addEventListener(ev, glueStop));
  $('seriesList').addEventListener('click', (e) => { if (e.target.closest('.sx')) return; const c = e.target.closest('.sc'); if (c) openSeries(+c.dataset.series); });
  $('svSlider').addEventListener('input', () => { SR.play = false; SR.idx = +$('svSlider').value; drawSeries(); });
  function useMask(frame) {
    SR.mask = { snap: frame.snap, from: SR.open, view: { lao: frame.snap.lao, cranial: frame.snap.cranial, fov: frame.snap.fov, pan: frame.snap.pan, sid: frame.snap.sid, sod: frame.snap.sod } };
    closeSeries();
  }
  // Maske auf die aktuelle Tischstellung und Vergrößerung umrechnen: Tischfahrt verschiebt,
  // Zoom skaliert um die Bildmitte. Nur eine andere Angulation macht die Maske unbrauchbar.
  function placeMask(sn) {
    const v = SR.mask.view, k = v.fov / sn.fov, m0 = sn.sid / sn.sod;
    const ox = (sn.pan[0] - v.pan[0]) * m0 / sn.fov, oy = (sn.pan[1] - v.pan[1]) * m0 / sn.fov;
    if (Math.abs(k - 1) < 1e-6 && Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) return { runs: SR.mask.snap.vessels.concat(SR.mask.snap.veins || []), sac: SR.mask.snap.sac };
    const run = (r) => ({ o: r.o, w: r.w.map(w => w * k), p: r.p.map((u, i) => u * k + (i & 1 ? oy : ox)) });
    return { runs: SR.mask.snap.vessels.concat(SR.mask.snap.veins || []).map(run), sac: SR.mask.snap.sac.map(b => [b[0] * k + ox, b[1] * k + oy, b[2] * k, b[3]]) };
  }
  function withMask(sn) {
    if (!SR.mask || !sn || sn.mode !== 'fluoro') return sn;
    const v = SR.mask.view;
    if (Math.abs(sn.lao - v.lao) > 0.6 || Math.abs(sn.cranial - v.cranial) > 0.6) { SR.mask = null; renderSeriesList(); return sn; }   // andere Angulation: Maske passt nicht mehr
    const m = placeMask(sn);
    return Object.assign({}, sn, { mode: 'roadmapNat', roadmap: m.runs, sacRoadmap: m.sac });
  }

  // ---------- 3D-Rekonstruktion ----------
  // Gedreht wird wie am C-Bogen: erst LAO/RAO um die Körperlängsachse, dann CRAN/CAUD.
  // Die Gefäße sind echte Röhren (WebGL mit Tiefenpuffer und Glanzlicht): an Abgängen
  // durchdringen sie sich glatt, statt wie zusammengesteckte Rohre zu wirken. Ansichten:
  // glänzend rot oder Drahtgitter. Drehen, Verschieben, Zoomen; Schneiden mit Ebene oder
  // Freihand-Schere; Messen von Strecke, Winkel und Gefäßkaliber.
  const V = { open: false, recon: null, lao: 0, cra: 0, drag: null, dragPan: false, anim: null, zoom: 1, pan: [0, 0], cut: 0, mode: 'rotate', view: 'solid', mtype: 'dist',
    meas: [], pts: [], hover: null, proj: [], pinch: null, pinchC: null, moved: 0, hidden: new Set(), lasso: null, gl: null, geo: null, zmin: -1, zmax: 1, zcut: 1, sc: 1 };
  function open3D() {
    E.ex.cs_recon(); const r = E.result(); if (!r) return;
    V.recon = r; V.lao = r.carm.lao; V.cra = r.carm.cranial; V.open = true; V.zoom = 1; V.pan = [0, 0]; V.cut = 0; V.meas = []; V.pts = []; V.hidden = new Set(); V.lasso = null;
    V.geo = build3D(r); if (V.gl) upload3D();
    $('v3dCut').value = 0; setMode3D('rotate'); setView3D(V.view);
    $('v3d').classList.add('on'); $('v3dLabel').textContent = r.label;
    $('v3dSug').style.display = r.suggest ? '' : 'none';
  }
  function close3D() { V.open = false; V.anim = null; $('v3d').classList.remove('on'); E.ex.cs_close3d(); T.dirty = true; }
  function setMode3D(m) {
    V.mode = m; V.pts = []; V.lasso = null;
    document.querySelectorAll('#v3dModes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('v3dMeas').style.display = m === 'measure' ? '' : 'none';
    $('v3dCanvas').style.cursor = m === 'rotate' ? 'grab' : m === 'pan' ? 'move' : 'crosshair';
    hint3D();
  }
  function setMeasType(t) { V.mtype = t; V.pts = []; document.querySelectorAll('#v3dMeas button').forEach(b => b.classList.toggle('on', b.dataset.mt === t)); hint3D(); }
  function setView3D(v) { V.view = v; document.querySelectorAll('#v3dView button').forEach(b => b.classList.toggle('on', b.dataset.view === v)); }
  function hint3D() {
    const m = V.mode;
    $('v3dHint').textContent = m === 'measure' ? ({ dist: 'Zwei Punkte auf dem Gefäß antippen: Strecke · Doppelklick löscht', angle: 'Drei Punkte antippen, der mittlere ist der Scheitel: Winkel · Doppelklick löscht', cal: 'Auf ein Gefäß zeigen: Kaliber · zwei Punkte: Abstand mit Kalibern · Doppelklick löscht' })[V.mtype]
      : m === 'cut' ? 'Mit dem Finger oder der Maus einen Kreis um das ziehen, was weg soll · Regler: Schnittebene' : m === 'pan' ? 'Ziehen verschiebt · Rad/Pinch zoomt · Doppelklick setzt zurück'
      : 'Ziehen dreht · Shift oder rechte Taste verschiebt · Rad/Pinch zoomt · Doppelklick setzt zurück';
  }
  function rot3(lao, cra) {
    const a = lao * Math.PI / 180, b = cra * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // rx * ry (Zeilen)
    return [[ca, 0, sa], [-sb * -sa, cb, -sb * ca], [cb * -sa, sb, cb * ca]];
  }
  // Röhrengeometrie: um jeden Mittellinienpunkt ein Ring aus 12 Ecken, der Rahmen wird entlang
  // des Gefäßes mitgeführt (kein Verdrehen); Dreiecke zwischen den Ringen, Deckel an den Enden.
  function build3D(r) {
    const N = 12, pos = [], nrm = [], pid = [], tri = [], wire = [], keys = [];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    let maxR = 1;
    r.tubes.forEach((t, ti) => {
      const n = t.r.length; if (n < 2) return;
      const base = pos.length / 3; let u = null, tan = null;
      for (let i = 0; i < n; i++) {
        const p = [t.p[3 * i], t.p[3 * i + 1], t.p[3 * i + 2]], a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
        tan = unit([t.p[3 * b] - t.p[3 * a], t.p[3 * b + 1] - t.p[3 * a + 1], t.p[3 * b + 2] - t.p[3 * a + 2]]);
        if (u) { const d = u[0] * tan[0] + u[1] * tan[1] + u[2] * tan[2]; u = [u[0] - d * tan[0], u[1] - d * tan[1], u[2] - d * tan[2]]; if (Math.hypot(...u) < 1e-4) u = null; }
        if (!u) u = cross(Math.abs(tan[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], tan);
        u = unit(u); const v = cross(tan, u);
        const k0 = keys.length; keys.push(ti + ':' + i);
        maxR = Math.max(maxR, Math.hypot(p[0] - r.center[0], p[1] - r.center[1], p[2] - r.center[2]) + t.r[i]);
        for (let k = 0; k < N; k++) {
          const ang = k / N * Math.PI * 2, cx = Math.cos(ang), sy = Math.sin(ang);
          const nx = u[0] * cx + v[0] * sy, ny = u[1] * cx + v[1] * sy, nz = u[2] * cx + v[2] * sy;
          pos.push(p[0] + nx * t.r[i], p[1] + ny * t.r[i], p[2] + nz * t.r[i]); nrm.push(nx, ny, nz); pid.push(k0);
        }
        const B = base + i * N;
        for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; wire.push(B + k, B + k2); }
        if (i > 0) { const A = B - N; for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; tri.push(A + k, B + k, B + k2, A + k, B + k2, A + k2); wire.push(A + k, B + k); } }
        if (i === 0 || i === n - 1) {
          // Deckel: Mittelpunkt mit Normale entlang der Achse, Fächer über den Ring
          const s = i === 0 ? -1 : 1, ci = pos.length / 3;
          pos.push(p[0], p[1], p[2]); nrm.push(tan[0] * s, tan[1] * s, tan[2] * s); pid.push(k0);
          for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; if (s < 0) tri.push(ci, B + k2, B + k); else tri.push(ci, B + k, B + k2); }
        }
      }
    });
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), pid: new Uint32Array(pid), hid: new Float32Array(pos.length / 3), tri: new Uint32Array(tri), wire: new Uint32Array(wire), keys, maxR };
  }
  function initGL() {
    const cv = $('v3dCanvas'); const gl = cv.getContext('webgl2', { antialias: true }) || cv.getContext('webgl', { antialias: true }); if (!gl) return null;
    if (!gl.getExtension('OES_element_index_uint') && !(gl instanceof WebGL2RenderingContext)) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); } return s; };
    const vs = `attribute vec3 aPos; attribute vec3 aNrm; attribute float aHid;
      uniform mat3 uR; uniform vec3 uC; uniform float uSc; uniform vec2 uWH; uniform vec2 uPan; uniform float uExt;
      varying vec3 vN; varying float vZ; varying float vHid;
      void main() { vec3 q = uR * (aPos - uC); vec2 s = vec2(uWH.x * 0.5 + q.x * uSc + uPan.x, uWH.y * 0.5 - q.y * uSc + uPan.y);
        gl_Position = vec4(s.x / uWH.x * 2.0 - 1.0, 1.0 - s.y / uWH.y * 2.0, -q.z / uExt, 1.0); vN = uR * aNrm; vZ = q.z; vHid = aHid; }`;
    const fs = `precision mediump float; varying vec3 vN; varying float vZ; varying float vHid;
      uniform float uZcut; uniform float uZmin; uniform float uZmax; uniform vec3 uCol; uniform float uMode;
      void main() { if (vHid > 0.5 || vZ > uZcut) discard;
        if (uMode == 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float f = clamp((vZ - uZmin) / max(uZmax - uZmin, 1.0), 0.0, 1.0);
        if (uMode == 2.0) { gl_FragColor = vec4(vec3(0.45 + 0.55 * f), 1.0); return; }
        // Außenseite: Normale zeigt zum Betrachter. Innenwand (nach dem Schnitt sichtbar): matt und dunkler.
        bool outside = vN.z >= 0.0; vec3 n = normalize(outside ? vN : -vN);
        vec3 L = normalize(vec3(-0.45, 0.6, 0.72)); vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
        float diff = max(dot(n, L), 0.0); float spec = pow(max(dot(n, H), 0.0), 46.0);
        vec3 base = outside ? uCol : uCol * 0.42;
        vec3 c = base * (0.24 + 0.76 * diff) + vec3(1.0, 0.92, 0.9) * spec * (outside ? 0.5 : 0.08);
        gl_FragColor = vec4(c * (0.5 + 0.5 * f), 1.0); }`;
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }
    const G = { gl, prog, a: {}, u: {}, buf: { pos: gl.createBuffer(), nrm: gl.createBuffer(), hid: gl.createBuffer(), tri: gl.createBuffer(), wire: gl.createBuffer() } };
    for (const n of ['aPos', 'aNrm', 'aHid']) G.a[n] = gl.getAttribLocation(prog, n);
    for (const n of ['uR', 'uC', 'uSc', 'uWH', 'uPan', 'uExt', 'uZcut', 'uZmin', 'uZmax', 'uCol', 'uMode']) G.u[n] = gl.getUniformLocation(prog, n);
    return G;
  }
  function upload3D() {
    const G = V.gl, gl = G.gl, g = V.geo; if (!g) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, G.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.buf.nrm); gl.bufferData(gl.ARRAY_BUFFER, g.nrm, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.buf.tri); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.tri, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.buf.wire); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.wire, gl.STATIC_DRAW);
    uploadHidden();
  }
  function uploadHidden() {
    const G = V.gl, g = V.geo; if (!G || !g) return;
    for (let i = 0; i < g.hid.length; i++) g.hid[i] = V.hidden.has(g.keys[g.pid[i]]) ? 1 : 0;
    G.gl.bindBuffer(G.gl.ARRAY_BUFFER, G.buf.hid); G.gl.bufferData(G.gl.ARRAY_BUFFER, g.hid, G.gl.DYNAMIC_DRAW);
  }
  function draw3D() {
    if (V.anim) { const k = 0.18; V.lao += (V.anim.lao - V.lao) * k; V.cra += (V.anim.cranial - V.cra) * k; if (Math.abs(V.anim.lao - V.lao) + Math.abs(V.anim.cranial - V.cra) < 0.2) { V.lao = V.anim.lao; V.cra = V.anim.cranial; V.anim = null; } }
    const cv = $('v3dCanvas'), ov = $('v3dOverlay'), dpr = Math.min(2, window.devicePixelRatio || 1), Wd = cv.clientWidth, Hd = cv.clientHeight; if (!Wd) return;
    if (cv.width !== Math.round(Wd * dpr)) { cv.width = ov.width = Math.round(Wd * dpr); cv.height = ov.height = Math.round(Hd * dpr); }
    if (V.gl === null) { V.gl = initGL() || false; if (V.gl) upload3D(); }
    const r = V.recon, R = rot3(V.lao, V.cra), c = r.center, sc = Math.min(Wd, Hd) * 0.42 / r.extent * V.zoom;
    const P = (X, Y, Z) => { const x = X - c[0], y = Y - c[1], z = Z - c[2]; return [Wd / 2 + (R[0][0] * x + R[0][1] * y + R[0][2] * z) * sc + V.pan[0], Hd / 2 - (R[1][0] * x + R[1][1] * y + R[1][2] * z) * sc + V.pan[1], R[2][0] * x + R[2][1] * y + R[2][2] * z]; };
    // Mittellinienpunkte projiziert: fürs Messen, Schneiden und die Tiefenstaffelung
    const proj = []; let zmin = Infinity, zmax = -Infinity;
    r.tubes.forEach((t, ti) => {
      for (let i = 0; i < t.r.length; i++) {
        const key = ti + ':' + i; if (V.hidden.has(key)) continue;
        const X = t.p[3 * i], Y = t.p[3 * i + 1], Z = t.p[3 * i + 2], q = P(X, Y, Z); q.push(t.r[i], X, Y, Z, key);
        proj.push(q); zmin = Math.min(zmin, q[2]); zmax = Math.max(zmax, q[2]);
      }
    });
    if (!proj.length) { zmin = -1; zmax = 1; }
    V.proj = proj; V.sc = sc; V.P = P; V.R = R; V.zmin = zmin; V.zmax = zmax; V.zcut = zmax - V.cut * (zmax - zmin) + (V.cut > 0 ? 0 : 1e9);
    // Die Röhren
    const ctx = ov.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, Wd, Hd);
    if (V.gl) {
      const G = V.gl, gl = G.gl, g = V.geo;
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.useProgram(G.prog);
      const bind = (name, buf, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(G.a[name]); gl.vertexAttribPointer(G.a[name], size, gl.FLOAT, false, 0, 0); };
      bind('aPos', G.buf.pos, 3); bind('aNrm', G.buf.nrm, 3); bind('aHid', G.buf.hid, 1);
      gl.uniformMatrix3fv(G.u.uR, false, [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]);
      gl.uniform3f(G.u.uC, c[0], c[1], c[2]); gl.uniform1f(G.u.uSc, sc); gl.uniform2f(G.u.uWH, Wd, Hd); gl.uniform2f(G.u.uPan, V.pan[0], V.pan[1]); gl.uniform1f(G.u.uExt, g.maxR * 1.5);
      gl.uniform1f(G.u.uZcut, V.zcut); gl.uniform1f(G.u.uZmin, zmin); gl.uniform1f(G.u.uZmax, zmax); gl.uniform3f(G.u.uCol, 0.78, 0.13, 0.15);
      if (V.view === 'mesh') {
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); gl.uniform1f(G.u.uMode, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.buf.tri); gl.drawElements(gl.TRIANGLES, g.tri.length, gl.UNSIGNED_INT, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL); gl.uniform1f(G.u.uMode, 2);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.buf.wire); gl.drawElements(gl.LINES, g.wire.length, gl.UNSIGNED_INT, 0);
      } else {
        gl.uniform1f(G.u.uMode, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.buf.tri); gl.drawElements(gl.TRIANGLES, g.tri.length, gl.UNSIGNED_INT, 0);
      }
    } else {
      // Ohne WebGL: flache Striche nach Tiefe sortiert
      const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.fillStyle = '#000'; c2.fillRect(0, 0, Wd, Hd); c2.lineCap = 'round';
      const byKey = new Map(proj.map(p => [p[7], p])); const segs = [];
      r.tubes.forEach((t, ti) => { let prev = null; for (let i = 0; i < t.r.length; i++) { const q = byKey.get(ti + ':' + i) || null; if (prev && q && q[2] <= V.zcut && prev[2] <= V.zcut) segs.push([prev, q]); prev = q; } });
      segs.sort((u, v) => (u[0][2] + u[1][2]) - (v[0][2] + v[1][2]));
      for (const [a, b] of segs) { const f = ((a[2] + b[2]) / 2 - zmin) / Math.max(zmax - zmin, 1); c2.strokeStyle = `hsl(358, 70%, ${Math.round(19 + 25 * f)}%)`; c2.lineWidth = Math.max(1, (a[3] + b[3]) * sc); c2.beginPath(); c2.moveTo(a[0], a[1]); c2.lineTo(b[0], b[1]); c2.stroke(); }
    }
    // Freihand-Schere: der Kreis, den man gerade zieht
    if (V.lasso && V.lasso.length > 1) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.moveTo(V.lasso[0][0], V.lasso[0][1]); for (const p of V.lasso) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    // Messen: Punkte als Ringe, Maßband mit Abstand, Winkelbogen, Kaliberring
    const place = (p) => { const q = P(p.x, p.y, p.z); q.push(p.r); return q; };
    const ring = (q, col, rr) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], rr, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[0], q[1], 2.5, 0, Math.PI * 2); ctx.fill(); };
    const dot = (q, col) => ring(q, col, 5);
    const calRing = (q, col) => ring(q, col, Math.max(4, q[3] * sc));
    const pill = (txt, x, y, bg) => { ctx.font = '600 12px ui-monospace, "SF Mono", Menlo, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; const tw = ctx.measureText(txt).width; ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - tw / 2 - 7, y - 11, tw + 14, 22, 11); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; };
    const dashed = (qa, qb, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.stroke(); ctx.setLineDash([]); };
    const dist = (A, B) => Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    const drawMeas = (m, col, bg) => {
      const q = m.pts.map(place);
      if (m.type === 'cal') {
        q.forEach(p => calRing(p, col)); m.pts.forEach((p, i) => pill(`Ø ${(2 * p.r).toFixed(1)}`, q[i][0], q[i][1] + Math.max(4, q[i][3] * sc) + 16, 'rgba(28,28,30,.85)'));
        if (q.length === 2) { dashed(q[0], q[1], col); pill(`${dist(m.pts[0], m.pts[1]).toFixed(1)} mm`, (q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2 - 16, bg); }
      } else if (m.type === 'dist') {
        q.forEach(p => dot(p, col));
        if (q.length === 2) { dashed(q[0], q[1], col); pill(`${dist(m.pts[0], m.pts[1]).toFixed(1)} mm`, (q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2 - 16, bg); }
      } else {
        q.forEach(p => dot(p, col));
        if (q.length >= 2) dashed(q[0], q[1], col);
        if (q.length === 3) {
          dashed(q[1], q[2], col);
          const [A, B, C] = m.pts, u = [A.x - B.x, A.y - B.y, A.z - B.z], w = [C.x - B.x, C.y - B.y, C.z - B.z];
          const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) || 1)))) * 180 / Math.PI;
          const a1 = Math.atan2(q[0][1] - q[1][1], q[0][0] - q[1][0]), a2 = Math.atan2(q[2][1] - q[1][1], q[2][0] - q[1][0]);
          let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q[1][0], q[1][1], 22, a1, a1 + d, d < 0); ctx.stroke();
          const mid = a1 + d / 2; pill(`${ang.toFixed(0)}°`, q[1][0] + Math.cos(mid) * 40, q[1][1] + Math.sin(mid) * 40, bg);
        }
      }
    };
    for (const m of V.meas) drawMeas(m, '#fff', '#0a84ff');
    if (V.mode === 'measure') {
      const live = { type: V.mtype, pts: V.pts.concat(V.hover ? [V.hover] : []) };
      if (live.pts.length) drawMeas(live, 'rgba(255,255,255,.8)', 'rgba(10,132,255,.8)');
      if (V.mtype === 'cal' && !V.pts.length && V.hover) { const q = place(V.hover); pill(`Ø ${(2 * V.hover.r).toFixed(1)} mm`, q[0], q[1] + Math.max(4, q[3] * sc) + 16, 'rgba(28,28,30,.85)'); }
    }
    $('v3dAng').textContent = `${V.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(V.lao))}°  ${V.cra >= 0 ? 'CRAN' : 'CAUD'} ${Math.abs(Math.round(V.cra))}°${V.zoom !== 1 ? `  ×${V.zoom.toFixed(1)}` : ''}`;
    $('v3dReset').style.display = V.hidden.size || V.meas.length || V.cut > 0 ? '' : 'none';
  }
  // Nächster Gefäßpunkt (Mittellinie) zum Zeiger: innerhalb des Gefäßes oder bis 24 px daneben
  function nearest3D(cx, cy) {
    let best = null, bd = Infinity;
    for (const q of V.proj) { if (q[2] > V.zcut) continue; const d = Math.hypot(q[0] - cx, q[1] - cy) - Math.max(0, q[3] * V.sc - 2); if (d < bd) { bd = d; best = q; } }
    if (!best || bd > 24) return null;
    return { x: best[4], y: best[5], z: best[6], r: best[3], q: best };
  }
  // Punkt auf der Gefäßoberfläche unter dem Zeiger: seitlicher Versatz zur Mittellinie in der
  // Bildebene, dazu die Höhe der Röhre zum Betrachter hin – der Punkt bleibt beim Drehen an der Wand.
  function surface3D(cx, cy) {
    const n = nearest3D(cx, cy); if (!n) return null;
    const q = n.q, R = V.R, rr = q[3]; let dx = (cx - q[0]) / V.sc, dy = -(cy - q[1]) / V.sc;
    const d2 = dx * dx + dy * dy; let dz;
    if (d2 < rr * rr) dz = Math.sqrt(rr * rr - d2); else { const f = rr / Math.sqrt(d2); dx *= f; dy *= f; dz = 0; }
    // zurück in Weltkoordinaten: R ist orthonormal, also R^T
    return { x: n.x + R[0][0] * dx + R[1][0] * dy + R[2][0] * dz, y: n.y + R[0][1] * dx + R[1][1] * dy + R[2][1] * dz, z: n.z + R[0][2] * dx + R[1][2] * dy + R[2][2] * dz, r: rr };
  }
  function pick3D(cx, cy) {
    const p = V.mtype === 'cal' ? nearest3D(cx, cy) : surface3D(cx, cy); if (!p) return;
    V.pts.push({ x: p.x, y: p.y, z: p.z, r: p.r });
    const need = V.mtype === 'angle' ? 3 : 2;
    if (V.pts.length >= need) { V.meas.push({ type: V.mtype, pts: V.pts }); V.pts = []; }
  }
  function lassoCut() {
    const L = V.lasso; V.lasso = null; if (!L || L.length < 3) return;
    const inside = (x, y) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const [xi, yi] = L[i], [xj, yj] = L[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    let n = 0; for (const q of V.proj) if (q[2] <= V.zcut && inside(q[0], q[1])) { V.hidden.add(q[7]); n++; }
    if (n) { uploadHidden(); $('v3dHint').textContent = `${n} Punkte weggeschnitten – „Zurücksetzen“ holt alles zurück`; }
  }
  function zoom3D(f, cx, cy) {
    const z = Math.max(0.4, Math.min(8, V.zoom * f)), k = z / V.zoom; V.zoom = z;
    // um den Zeiger zoomen: der Punkt darunter bleibt stehen
    const Wd = $('v3dCanvas').clientWidth, Hd = $('v3dCanvas').clientHeight;
    if (cx !== undefined) { V.pan[0] = cx - Wd / 2 - (cx - Wd / 2 - V.pan[0]) * k; V.pan[1] = cy - Hd / 2 - (cy - Hd / 2 - V.pan[1]) * k; }
  }
  { const cv = $('v3dCanvas'); const ptrs = new Map(); const local = (e) => { const rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 1) { V.drag = [e.clientX, e.clientY]; V.dragPan = V.mode === 'pan' || e.button === 2 || e.shiftKey; V.moved = 0; V.anim = null; if (V.mode === 'cut') V.lasso = [local(e)]; } cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (V.mode === 'measure') V.hover = V.mtype === 'cal' ? nearest3D(...local(e)) : surface3D(...local(e));
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size >= 2) {
        // Zwei Finger: Pinch zoomt, gemeinsames Ziehen verschiebt
        V.lasso = null; const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]), cen = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const rc = cv.getBoundingClientRect();
        if (V.pinch) { zoom3D(d / V.pinch, cen[0] - rc.left, cen[1] - rc.top); V.pan[0] += cen[0] - V.pinchC[0]; V.pan[1] += cen[1] - V.pinchC[1]; }
        V.pinch = d; V.pinchC = cen; return;
      }
      if (!V.drag) return; const dx = e.clientX - V.drag[0], dy = e.clientY - V.drag[1]; V.drag = [e.clientX, e.clientY]; V.moved += Math.abs(dx) + Math.abs(dy);
      if (V.mode === 'cut' && V.lasso) { V.lasso.push(local(e)); return; }
      if (V.dragPan) { V.pan[0] += dx; V.pan[1] += dy; return; }
      V.lao = Math.max(-95, Math.min(95, V.lao + dx * 0.4)); V.cra = Math.max(-45, Math.min(45, V.cra + dy * 0.3)); });
    const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) { V.pinch = null; V.pinchC = null; } if (!ptrs.size) { if (V.mode === 'cut') lassoCut(); else if (V.drag && V.moved < 4 && V.mode === 'measure') pick3D(...local(e)); V.drag = null; V.dragPan = false; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { V.hover = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom3D(Math.exp(-e.deltaY * 0.0015), ...local(e)); }, { passive: false });
    cv.addEventListener('dblclick', () => { if (V.mode === 'measure') { V.meas = []; V.pts = []; } else { V.zoom = 1; V.pan = [0, 0]; } });
    $('v3dCut').addEventListener('input', () => { V.cut = +$('v3dCut').value / 100; });
    $('v3dModes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode3D(b.dataset.mode); });
    $('v3dMeas').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMeasType(b.dataset.mt); });
    $('v3dView').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView3D(b.dataset.view); });
    $('v3dReset').addEventListener('click', () => { V.hidden = new Set(); uploadHidden(); V.meas = []; V.pts = []; V.cut = 0; $('v3dCut').value = 0; setMode3D(V.mode); }); }
  function planeStored() { try { const v = localStorage.getItem('cathsim.plane'); return v === null ? 2 : +v; } catch (e) { return 2; } }

  function loop(ts) {
    if (!T.running) return;
    const dt = Math.min(0.1, (ts - T.last) / 1000 || 0.016); T.last = ts;
    const t0 = performance.now(); const fresh = E.ex.cs_tick(dt); T.stats.tick += performance.now() - t0; T.stats.tickN++;
    if (fresh || T.dirty) { const t1 = performance.now(); readFrame(); T.noisePhase++; recordSeries(); T.stats.frame += performance.now() - t1; T.stats.frameN++; }
    if (ts - T.lastHud > 60 || fresh || T.dirty) { const t0 = performance.now(); readHud(); T.lastHud = ts; updateBody(); updateHud(); T.stats.hud += performance.now() - t0; T.stats.hudN++; }
    if (fresh || T.dirty) {
      const t2 = performance.now();
      CathSimFluoro.render(fluoro, withMask(T.snap), T.body, { pulse: T.hud.pulse, fluoroOn: T.hud.fluoroOn, noisePhase: T.noisePhase, motion: SR.rec ? T.hud.elapsed - SR.rec.t0 : 0 });
      // Zweite Ebene: nur im Kopf-/Halsbereich oder wenn fest eingeschaltet
      const bi = !!(T.hud && T.hud.biplane); $('view').classList.toggle('bi', bi);
      if (bi) { E.ex.cs_frame_b(); T.snapB = E.result(); updateBodyB(); CathSimFluoro.render($('fluoroB'), T.snapB, T.bodyB, { pulse: T.hud.pulse, fluoroOn: T.hud.fluoroOn, noisePhase: T.noisePhase + 7, motion: SR.rec ? T.hud.elapsed - SR.rec.t0 : 0 });
        const cb = T.hud.carmB; $('labB').textContent = `B  ${cb.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(cb.lao))}°   ${cb.cranial >= 0 ? 'CRA' : 'CAU'} ${Math.abs(Math.round(cb.cranial))}°`; }
      T.dirty = false; T.stats.render += performance.now() - t2; T.stats.renderN++;
    }
    CathSimFluoro.renderStrip($('stripCanvas'), T.hud);
    if (T.hud && T.hud.show3D && !V.open) open3D();
    tickSeries(ts); $('bMaskOff').style.display = SR.mask ? '' : 'none';
    if (V.open) draw3D();
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
    if (T.hud) { const pm = { single: '0', biplane: '1', automatic: '2' }[T.hud.planeMode]; document.querySelectorAll('#planes button').forEach(b => b.classList.toggle('lit', b.dataset.plane === pm));
      $('bRot').disabled = !!T.hud.rotating; $('bRot').textContent = T.hud.rotating ? '3D-Rotation läuft …' : '3D-Rotation'; }
    const h = T.hud, c = h.carm, m = T.snap ? T.snap.mode : 'fluoro';
    $('title').textContent = h.title;
    $('hudTL').textContent = `${c.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(c.lao))}°   ${c.cranial >= 0 ? 'CRA' : 'CAU'} ${Math.abs(Math.round(c.cranial))}°\nFOV ${Math.round(c.fov)} mm\n${m === 'dsa' ? 'DSA' : (m.startsWith('roadmap') ? 'ROADMAP' : '')}\n${Math.round(h.pulse)} P/s   ${Math.round(h.hr)}/min`;
    $('hudTR').innerHTML = `<span style="color:${h.fluoroOn ? '#ff8a2a' : 'rgba(255,255,255,.35)'};font-weight:700">STRAHLUNG ${ic(h.fluoroOn ? 'dot' : 'circle')}</span>\n${fmt(h.caseTime)}\nDL ${h.fluoroSeconds.toFixed(1)} s\nDFP ${h.dap.toFixed(2)} Gy·cm²\nKa ${Math.round(h.ka)} mGy\nKM ${Math.round(h.km)} ml${h.hasAneurysm ? `\nPackung ${Math.round(h.packing * 100)} % · Verschluss ${Math.round((h.occl || 0) * 100)} %` : ''}`;
    const act = h.devices[h.active];
    $('hudBL').innerHTML = `${h.tip}<br><span class="mono" style="font-weight:400;color:rgba(255,255,255,.5)">${act ? `${act.name} · ${Math.round(act.ins)} mm · ${Math.round(act.rot * 180 / Math.PI)}°${act.kind === 'flowDiverter' && act.deployed > 0 ? ` · Verdrehung ${Math.round((act.twist || 0) * 180 / Math.PI)}°` : ''}` : ''}</span>${act ? moveHTML(h.active) : ''}${L.allowed ? `<br><span style="color:var(--accent2);font-weight:600">${ic('phone')} ${L.allowed} steuert</span>` : ''}`;
    const v = h.vitals; const cls = (v.shock > 0.55 || (v.arr || 0) >= 0.7) ? 'red' : ((v.shock > 0.25 || (v.arr || 0) > 0.25) ? 'orange' : '');
    $('vitals').className = cls; $('vHr').textContent = Math.round(v.hr); $('vRr').textContent = `${Math.round(v.sys)}/${Math.round(v.dia)}`; $('vSp').textContent = Math.round(v.spo2);
    $('vHr').style.color = v.hr > 110 ? (cls === 'red' ? '#ff5a5a' : '#ffa030') : '#fff'; $('vRr').style.color = v.sys < 95 ? (cls === 'red' ? '#ff5a5a' : '#ffa030') : '#fff';
    // Bilanz einmal von selbst öffnen – aber nicht mitten in eine Serie hinein.
    if ((h.completed || h.dead) && !debriefShown && !h.subtracted && !SR.open) { debriefShown = true; if (h.completed) postDone(h); setTimeout(() => { if (T.hud && (T.hud.completed || T.hud.dead) && !T.hud.subtracted && !SR.open) openDebrief(T.hud); }, 1500); }
    { const b = $('bDebrief'); const txt = h.completed ? 'Bilanz des Falls' : 'Stand des Falls'; if (b.dataset.txt !== txt) { b.dataset.txt = txt; b.innerHTML = `${ic('flag')} ${txt}`; b.classList.toggle('lit', !!h.completed); } }
    { const km = h.km, cls = km >= 300 ? 'bad' : (km >= 200 ? 'warn' : '');
      setHTML('stats', `<div><b class="${cls}">${Math.round(km)} ml</b><span>Kontrastmittel</span></div><div><b>${fmt(h.fluoroSeconds)}</b><span>Durchleuchtung</span></div><div><b>${h.dap.toFixed(2)}</b><span>DFP Gy·cm²</span></div>`); }
    setHTML('badges', (h.force > 0.15 ? `<span class="badge ${h.force > 0.7 ? 'red' : 'warn'}">${ic('warn')} Widerstand</span> ` : '') + (h.completed ? `<span class="badge ok">${ic('check')} Ziel erreicht</span>` : ''));
    const msg = $('msg'); if (h.dead) { msg.innerHTML = ic('stop') + ' Patient verstorben – Fall beenden'; msg.className = 'on danger'; } else if (h.alert) { msg.innerHTML = ic(h.alert.k === 'danger' ? 'stop' : 'warn') + ' ' + h.alert.t.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); msg.className = 'on ' + h.alert.k; } else msg.className = '';
    setHTML('devices', h.devices.map(d => `<button class="dev ${d.i === h.active ? 'active' : ''}" data-dev="${d.i}"><span>${d.wire ? '╱' : '▭'}</span><span class="n">${d.name}<span class="d">${d.desc}</span></span><span class="mm">${d.inserted ? Math.round(d.ins) + ' mm' : ''}</span></button>`).join(''));
    setHTML('shapes', act && act.shapeable ? `<span style="width:100%;font-size:9px;letter-spacing:.1em;color:rgba(255,255,255,.5)">SPITZE FORMEN${act.inserted ? ' · erst herausziehen' : ''}</span>` + h.shapes.map(s => `<button class="${(s.d < 0 ? act.stock : (!act.stock && Math.abs(act.tip - s.d) < 1)) ? 'lit' : ''}" data-shape="${s.d}">${s.l}</button>`).join('') : '');
    $('bFluoro').classList.toggle('lit', h.fluoroOn); $('bRoad').classList.toggle('lit', h.roadmapArmed || h.roadmapActive);
    // Befehle gehören zum aktiven Instrument – wie die Freisetzung beim Stent.
    const canDetach = !!(act && act.inserted && (act.kind === 'coil' || act.kind === 'web'));
    const canAsp = !!(act && act.inserted && act.kind === 'aspirationCatheter');
    $('bDetach').style.display = canDetach ? '' : 'none'; $('bAsp').style.display = canAsp ? '' : 'none';
    if (canDetach) { $('bDetach').textContent = `${act.name} ablösen`; $('bDetach').classList.toggle('lit', h.coilReady); }
    if (canAsp) $('bAsp').textContent = `${act.name}: aspirieren`;
    // Karotisstent: Freisetzung durch Rückzug der Applikatorschleuse
    const canSheath = !!(act && act.inserted && act.kind === 'stent' && act.od >= 1 && act.deployed < 0.999);
    $('sheathRow').style.display = canSheath ? '' : 'none';
    if (canSheath) $('bSheathBack').textContent = act.deployed > 0.01 ? `Applikator zurück · ${Math.round(act.deployed * 100)} % frei` : 'Applikator 2 mm zurück';
    const canBalloon = !!(act && act.inserted && act.kind === 'balloon');
    $('balloonRow').style.display = canBalloon ? '' : 'none';
    const canGlue = !!(act && act.kind === 'liquidEmbolic'), g = T.hud.glue;
    $('glueRow').style.display = canGlue ? '' : 'none';
    $('glueInfo').classList.toggle('on', !!(g && (canGlue || g.ml > 0)));
    if (g) { const el = $('glueInfo'), html = `Kleber ${g.ml.toFixed(2)} ml${g.active ? ` · Front ${Math.round(g.front)} mm · <span class="${g.reflux > 12 ? 'bad' : (g.reflux > 4 ? 'warn' : '')}">Reflux ${g.reflux.toFixed(0)} mm</span>` : ''}${g.stuck ? ' · <span class="bad">Katheter klebt</span>' : ''}${g.hasMembrane ? `<br>Membran erreicht: ${Math.round(g.membrane * 100)} %` : ''}`; if (el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; } }
    if (canBalloon) { $('bInflate').textContent = `Füllen · ${Math.round(act.atm)} atm`; $('bInflate').classList.toggle('lit', act.inflation > 0.05); }
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
    else if (b.id === 'bRot') ex.cs_run3d();
    else if (d.sdel !== undefined) { deleteSeries(+d.sdel); return; }
    else if (b.id === 'svPrev' || b.id === 'svNext') { const i = SR.list.indexOf(SR.open) + (b.id === 'svPrev' ? -1 : 1); openSeries(i); return; }
    else if (b.id === 'svPlay') { SR.play = !SR.play; SR.lastPlay = performance.now(); drawSeries(); return; }
    else if (b.id === 'svBest') { if (SR.open) { let bi = 0, bv = -1; SR.open.frames.forEach((f, i) => { const v = frameFill(f.snap); if (v > bv) { bv = v; bi = i; } }); SR.play = false; SR.idx = bi; drawSeries(); } return; }
    else if (b.id === 'svMask') { if (SR.open) useMask(SR.open.frames[SR.idx]); }
    else if (b.id === 'svClose') { closeSeries(); return; }
    else if (b.id === 'bMaskOff') { SR.mask = null; renderSeriesList(); }
    else if (b.id === 'bSheathBack') ex.cs_sheath(T.hud.active, 2);
    else if (b.id === 'bInflate') ex.cs_inflate(T.hud.active, 0.125);
    else if (b.id === 'bDeflate') ex.cs_inflate(T.hud.active, -2);
    else if (b.id === 'v3dSug') { if (V.recon && V.recon.suggest) V.anim = V.recon.suggest; return; }
    else if (b.id === 'v3dAdopt') { ex.cs_adopt(V.lao, V.cra); close3D(); }
    else if (b.id === 'v3dClose') { close3D(); return; }
    else if (d.plane !== undefined) { ex.cs_plane(+d.plane); try { localStorage.setItem('cathsim.plane', d.plane); } catch (e) {} }
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
  fluoro.addEventListener('pointermove', (e) => { if (!drag || !T.hud) return; const c = T.hud.carm; const side = Math.min(fluoro.clientWidth, fluoro.clientHeight); const k = c.fov / side * c.sod / c.sid; E.ex.cs_table((e.clientX - drag[0]) * k, (e.clientY - drag[1]) * k, 0); drag = [e.clientX, e.clientY]; T.dirty = true; });
  fluoro.addEventListener('pointerup', () => { drag = null; }); fluoro.addEventListener('pointercancel', () => { drag = null; });
  // Zweite Ebene: derselbe Tisch, gezogen im Rahmen dieser Ebene
  { const fB = $('fluoroB'); let dragB = null;
    fB.addEventListener('pointerdown', (e) => { dragB = [e.clientX, e.clientY]; fB.setPointerCapture(e.pointerId); });
    fB.addEventListener('pointermove', (e) => { if (!dragB || !T.hud) return; const c = T.hud.carmB; const side = Math.min(fB.clientWidth, fB.clientHeight); const k = c.fov / side * T.hud.carm.sod / T.hud.carm.sid; E.ex.cs_table((e.clientX - dragB[0]) * k, (e.clientY - dragB[1]) * k, 1); dragB = [e.clientX, e.clientY]; T.dirty = true; });
    fB.addEventListener('pointerup', () => { dragB = null; }); fB.addEventListener('pointercancel', () => { dragB = null; }); }
  window.addEventListener('resize', () => { T.dirty = true; });

  window.CS = { T, E, S, W, V, loop, updateHud, readHud, readFrame, bodyKeyOf, updateBody, pick3D, nearest3D, lassoCut };
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
    noteMove(m);
    switch (m.t) {
      case 'adv': ex.cs_advance(m.mm, m.i ?? -1); break;
      case 'tq': ex.cs_torque(m.rad, m.i ?? -1); break;
      case 'sel': ex.cs_select(m.i); break;
      case 'wd': ex.cs_withdraw(m.i); break;
      case 'shape': ex.cs_shape(m.i, m.deg); break;
      case 'sheath': ex.cs_sheath(m.i, m.mm); break;
      case 'glue': ex.cs_glue(Math.min(0.05, Math.max(0, +m.ml || 0))); break;
      case 'carm': ex.cs_carm(m.lao, m.cra, m.fov); break;
      case 'table': ex.cs_table(m.dx, m.dy, m.plane === 1 ? 1 : 0); break;
      case 'act':
        if (m.a === 'fluoro') ex.cs_fluoro(T.hud && T.hud.fluoroOn ? 0 : 1); else if (m.a === 'km') ex.cs_inject(6); else if (m.a === 'dsa') ex.cs_dsa();
        else if (m.a === 'road') ex.cs_roadmap(); else if (m.a === 'asp') ex.cs_aspirate(); else if (m.a === 'detach') ex.cs_detach(); else if (m.a === 'center') ex.cs_center(); else if (m.a === 'rot') ex.cs_run3d(); else if (m.a === 'inflate') ex.cs_inflate(-1, 0.125); else if (m.a === 'deflate') ex.cs_inflate(-1, -2);
        break;
    }
    T.dirty = true;
  }
  // Was das Handy gerade überträgt, je Instrument und Zug (nach 1,5 s Ruhe beginnt ein neuer Zug)
  const MOVE = {};
  function noteMove(m) {
    if (m.t !== 'adv' && m.t !== 'tq' && m.t !== 'sheath') return;
    const i = m.i ?? (T.hud ? T.hud.active : -1), now = performance.now(); let v = MOVE[i];
    if (!v || now - v.t > 1500) v = MOVE[i] = { mm: 0, deg: 0, sh: 0, t: now };
    if (m.t === 'adv') v.mm += m.mm; else if (m.t === 'tq') v.deg += m.rad * 180 / Math.PI; else v.sh += m.mm;
    v.t = now;
  }
  function moveHTML(i) {
    const v = MOVE[i]; if (!v) return ''; const age = performance.now() - v.t; if (age > 6000) return '';
    const op = age < 1500 ? 1 : 0.5, sp = (t, c) => `<span style="color:${c}">${t}</span>`, parts = [];
    if (Math.abs(v.mm) > 0.05) parts.push(sp((v.mm >= 0 ? '▲ ' : '▼ ') + Math.abs(v.mm).toFixed(1) + ' mm', v.mm >= 0 ? '#30d158' : '#ff9f0a'));
    if (Math.abs(v.deg) > 0.5) parts.push(sp((v.deg >= 0 ? '↻ ' : '↺ ') + Math.abs(v.deg).toFixed(0) + '°', v.deg >= 0 ? '#0a84ff' : '#64d2ff'));
    if (v.sh > 0.05) parts.push(sp('◀ ' + v.sh.toFixed(1) + ' mm', '#ff9f0a'));
    return parts.length ? `<br><span class="mono" style="font-weight:500;opacity:${op}">${parts.join(' &nbsp;')}</span>` : '';
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
  // Haptik am Handy: neue Warnungen und Gefahren (Dissektion, Perforation) als Zähler,
  // dazu die aktuelle Vorschubkraft. Das Handy vibriert, wenn ein Zähler springt.
  const HAP = { seen: new Map(), warn: 0, danger: 0 };
  function hapticCount(h) {
    const now = Date.now();
    for (const e of h.events || []) {
      if (e.age > 1.5 || (e.k !== 'danger' && e.k !== 'warning')) continue;
      const last = HAP.seen.get(e.t); HAP.seen.set(e.t, now);
      if (last && now - last < 3000) continue;
      if (e.k === 'danger') HAP.danger++; else HAP.warn++;
    }
    for (const [k, t] of HAP.seen) if (now - t > 10000) HAP.seen.delete(k);
  }
  function phoneStatus() {
    const h = T.hud; if (!h) return null;
    hapticCount(h);
    return { title: h.title, km: h.km, force: h.force, hap: [HAP.warn, HAP.danger], tip: h.tip, active: h.active, fluoroOn: h.fluoroOn, roadmapArmed: h.roadmapArmed, roadmapActive: h.roadmapActive, completed: h.completed, coilReady: h.coilReady,
      alert: h.alert, vitals: h.vitals, shapes: h.shapes, carm: h.carm, people: peopleList(), lead: L.lead, allowed: L.allowed, user: userName(),
      glue: h.glue, devices: h.devices.map(d => ({ name: d.name, kind: d.kind, inserted: d.inserted, ins: d.ins, rot: d.rot, od: d.od, rank: d.rank, deployed: d.deployed, implant: d.implant, tip: d.tip, wire: d.wire, shapeable: d.shapeable, stock: d.stock, inflation: d.inflation, atm: d.atm })) };
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
  // Ablauf des Falls: Kurzbeschreibung, Schritte, Hinweise – jederzeit während des Falls.
  function openPlan() {
    const sc = S.catalog.scenarios[S.scenario]; if (!sc) return;
    $('planBody').innerHTML = `<div class="pbrief">${esc(sc.brief)}</div><h4>VORGEHEN</h4>` +
      (sc.steps.length ? `<ol class="psteps">${sc.steps.map(st => `<li>${esc(st)}</li>`).join('')}</ol>` : '<div class="pbrief">Für diesen Fall ist noch kein Ablauf hinterlegt.</div>') +
      (sc.notes.length ? `<h4>WORAUF ES ANKOMMT</h4>${sc.notes.map(n => `<div class="pnote">${ic('warn')} ${esc(n)}</div>`).join('')}` : '');
    $('planTitle').textContent = sc.title; $('planModal').classList.add('on');
  }
  // Absolvierte Übung an den Server melden und in der Fallauswahl zeigen
  S.done = []; S.access = null;
  // Absolvierte Übungen liegen auch lokal (je Nutzer): dann sieht man seinen Fortschritt, selbst
  // wenn der Server gerade nicht erreichbar ist.
  const doneKey = () => 'cathsim.done.' + userName().toLowerCase();
  function doneLocal() { try { return JSON.parse(localStorage.getItem(doneKey()) || '[]'); } catch (e) { return []; } }
  function mergeDone(a, b) { const seen = new Set(); const out = []; for (const r of a.concat(b)) { const k = r.caseId + '|' + Math.round(r.t / 2000); if (!seen.has(k)) { seen.add(k); out.push(r); } } return out.sort((p, q) => p.t - q.t); }
  async function loadDone() {
    S.done = doneLocal();
    if (!EP() || !token()) return;
    try { const r = await fetch(EP() + '/done?x=' + Date.now(), { headers: { 'x-token': token() }, cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j)) { S.done = mergeDone(S.done, j); try { localStorage.setItem(doneKey(), JSON.stringify(S.done.slice(-300))); } catch (e) {} } } } catch (e) {}
  }
  async function loadAccess() {
    S.access = null; if (!EP() || !token() || isAdmin()) return;
    try { const r = await fetch(EP() + '/access?x=' + Date.now(), { headers: { 'x-token': token() }, cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j.cases)) S.access = new Set(j.cases); } } catch (e) {}
  }
  function postCatalog() {
    if (!EP() || !token() || !S.catalog) return;
    const cases = S.catalog.scenarios.map(s => ({ id: s.id, title: s.title, module: s.module || '', domain: s.domain }));
    try { fetch(EP() + '/catalog', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': token() }, body: JSON.stringify({ cases }) }).catch(() => {}); } catch (e) {}
  }
  const caseAllowed = (s) => !S.access || S.access.has(s.id);
  function openProgress() {
    const cat = S.catalog; if (!cat) return;
    const mine = cat.scenarios.filter(s => s.playable && caseAllowed(s));
    const by = (id) => S.done.filter(r => r.caseId === id);
    const doneIds = new Set(S.done.map(r => r.caseId));
    const n = mine.filter(s => doneIds.has(s.id)).length;
    const mods = [...new Set(mine.map(s => s.module || s.domain))];
    $('progressBody').innerHTML = `<div class="prog"><b>${n} / ${mine.length}</b><div class="bar"><div style="width:${mine.length ? n / mine.length * 100 : 0}%"></div></div><span style="color:var(--dim);font-size:12px">Fälle absolviert · ${S.done.length} Durchgänge</span></div>` +
      mods.map(m => `<h4>${esc(m)}</h4><div class="plist">` + mine.filter(s => (s.module || s.domain) === m).map(s => { const rows = by(s.id); const last = rows.length ? new Date(Math.max(...rows.map(r => r.t))) : null; const best = rows.length ? Math.min(...rows.map(r => r.caseTime || 1e9)) : 0;
        return `<span class="${rows.length ? 'done' : 'open'}">${rows.length ? ic('check') : ic('circle')} ${esc(s.title)}</span><span class="n" style="color:var(--dim)">${rows.length ? rows.length + '×' : '–'}</span><span class="n" style="color:var(--dim)">${last ? `${last.getDate()}.${last.getMonth() + 1}.` + (best < 1e9 ? ` · beste ${fmt(best)}` : '') : ''}</span>`; }).join('') + '</div>').join('');
    $('progressModal').classList.add('on');
  }
  $('setupUser').onclick = openProgress; $('progressClose').onclick = () => $('progressModal').classList.remove('on');
  $('progressModal').addEventListener('click', (e) => { if (e.target === $('progressModal')) $('progressModal').classList.remove('on'); });
  async function postDone(h) {
    const sc = S.catalog.scenarios[S.scenario]; if (!sc || !EP() || !token()) return;
    const row = { caseId: sc.id, caseTitle: sc.title, module: sc.module || '', difficulty: (S.catalog.difficulties[S.difficulty] || {}).name || '', stage: (S.catalog.stages[S.stage] || {}).label || '',
      caseTime: h.caseTime, fluoro: h.fluoroSeconds, dap: h.dap, km: h.km, dangers: (h.dangers || []).length, build: window.CATHSIM_BUILD || 'dev' };
    S.done.push(Object.assign({ t: Date.now() }, row));
    try { localStorage.setItem(doneKey(), JSON.stringify(S.done.slice(-300))); } catch (e) {}
    try { await fetch(EP() + '/done', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': token() }, body: JSON.stringify(row), keepalive: true }); } catch (e) {}
  }
  // Bilanz am Ende: Zeiten, Dosis, Kontrastmittel, was gelang und was schiefging.
  let debriefShown = false;
  function openDebrief(h) {
    const sc = S.catalog.scenarios[S.scenario] || { title: h.title, steps: [], notes: [] };
    const stat = (v, l) => `<div class="dstat"><b>${v}</b><span>${l}</span></div>`;
    const state = h.completed ? `<div class="dgoal ok">${ic('check')} Ziel erreicht</div>` : h.dead ? `<div class="dgoal bad">${ic('stop')} Patient verstorben – ${esc(h.goal || '')}</div>` : `<div class="dgoal open">${ic('warn')} Noch offen: ${esc(h.goal || '')}</div>`;
    $('doneHead').textContent = h.completed ? 'Bilanz des Falls' : 'Stand des Falls';
    $('doneBody').innerHTML = state + `<div class="dstats">${stat(fmt(h.caseTime), 'Eingriffsdauer')}${stat(fmt(h.fluoroSeconds), 'Durchleuchtung')}${stat(h.dap.toFixed(2) + ' Gy·cm²', 'Dosisflächenprodukt')}${stat(Math.round(h.km) + ' ml', 'Kontrastmittel')}</div>` +
      `<h4>WAS GELANG</h4>${(h.successes || []).length ? h.successes.map(t => `<div class="dok">${ic('check')} ${esc(t)}</div>`).join('') : '<div class="pbrief">–</div>'}` +
      `<h4>KOMPLIKATIONEN</h4>${(h.dangers || []).length ? h.dangers.map(t => `<div class="dbad">${ic('stop')} ${esc(t)}</div>`).join('') : '<div class="dok">' + ic('check') + ' keine</div>'}` +
      (sc.notes.length ? `<h4>ZUM MITNEHMEN</h4>${sc.notes.map(n => `<div class="pnote">${ic('warn')} ${esc(n)}</div>`).join('')}` : '');
    $('doneTitle').textContent = sc.title; $('doneModal').classList.add('on');
  }
  $('bPlan').onclick = openPlan; $('planClose').onclick = () => $('planModal').classList.remove('on');
  $('planModal').addEventListener('click', (e) => { if (e.target === $('planModal')) $('planModal').classList.remove('on'); });
  $('doneClose').onclick = () => $('doneModal').classList.remove('on'); $('doneAgain').onclick = () => { $('doneModal').classList.remove('on'); $('change').click(); };
  $('doneModal').addEventListener('click', (e) => { if (e.target === $('doneModal')) $('doneModal').classList.remove('on'); });
  $('bDebrief').onclick = () => { if (T.hud) openDebrief(T.hud); };
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
  // Ist der Anmeldeserver auf dem Stand der Seite? Sonst gehen Registrierung, Konten und Übungen ins Leere.
  let serverOK = null;
  async function checkServer() {
    if (!EP()) return;
    try { const r = await fetch(EP() + '/version?x=' + Date.now(), { cache: 'no-store' }); const j = r.ok ? await r.json() : {}; serverOK = (j.v || 0) >= 2; }
    catch (e) { serverOK = null; }
    const note = serverOK === false ? 'Anmeldeserver veraltet – im Ordner worker „wrangler deploy“ ausführen, sonst gehen Registrierung, Konten und Übungen ins Leere' : '';
    for (const id of ['gateNote', 'adminNote']) { const el = $(id); if (el) { el.textContent = note; el.style.display = note ? '' : 'none'; } }
  }
  checkServer();
  const isAdmin = () => { try { return localStorage.getItem('cathsim.role') === 'admin'; } catch (e) { return false; } };
  async function adminGet(path) { const r = await fetch(EP() + path + '?x=' + Date.now(), { headers: { 'x-token': token() }, cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler'); return r.json(); }
  const fmtT = (t) => { const d = new Date(t); return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const adminPut = async (path, body) => { const r = await fetch(EP() + path, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-token': token() }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Fehler'); return j; };
  document.querySelectorAll('#adminCard .atabs button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#adminCard .atabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('#adminCard .apane').forEach(p => p.classList.toggle('on', p.dataset.apane === b.dataset.atab)); }));
  const fmtD = (t) => { const d = new Date(t); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };
  const ADM = { accounts: [], done: {} };
  function renderAccounts() {
    const row = (a, btns) => `<div class="row2"><div class="who"><b>${esc(a.first)} ${esc(a.last)}</b><span>${esc(a.email)} · ${esc(a.org)} · ${fmtT(a.t)}</span></div>${btns}</div>`;
    const by = (st) => ADM.accounts.filter(a => a.status === st);
    $('adminPending').innerHTML = by('pending').map(a => row(a, `<button class="ok" data-acc="${esc(a.email)}" data-st="approved">Freischalten</button><button class="no" data-acc="${esc(a.email)}" data-st="declined">Ablehnen</button>`)).join('') || '<div class="empty">keine offenen Anfragen</div>';
    $('adminApproved').innerHTML = by('approved').map(a => { const n = (ADM.done[a.email.toLowerCase()] || []).length; return row(a, `<span style="color:var(--dim);font-size:11px">${n} Übung${n === 1 ? '' : 'en'}</span><button data-acc="${esc(a.email)}" data-st="removed">Entfernen</button>`); }).join('') || '<div class="empty">noch niemand freigeschaltet</div>';
    $('adminDeclined').innerHTML = by('declined').map(a => row(a, `<button class="ok" data-acc="${esc(a.email)}" data-st="approved">Doch freischalten</button><button data-acc="${esc(a.email)}" data-st="removed">Löschen</button>`)).join('') || '<div class="empty">–</div>';
  }
  function renderDone() {
    const who = (key) => { const a = ADM.accounts.find(x => x.email.toLowerCase() === key); return a ? { name: `${a.first} ${a.last}`, org: a.org } : { name: key.replace(/^name:/, ''), org: '' }; };
    const keys = Object.keys(ADM.done).sort((p, q) => (ADM.done[q].at(-1) || {}).t - (ADM.done[p].at(-1) || {}).t);
    $('adminDone').innerHTML = keys.map(k => { const rows = ADM.done[k], w = who(k); const cases = new Set(rows.map(r => r.caseId)).size;
      return `<details><summary><div class="n"><b>${esc(w.name)}</b> <span class="cnt">${esc(w.org)}</span></div><span class="cnt">${cases} Fälle · ${rows.length} Durchgänge · zuletzt ${fmtD(rows.at(-1).t)}</span></summary><div class="ex"><span class="hd">FALL</span><span class="hd">DATUM</span><span class="hd">DAUER</span><span class="hd">DL</span><span class="hd">KM</span><span class="hd">KOMPL.</span>${rows.slice().reverse().map(r => `<b>${esc(r.caseTitle || r.caseId)}</b><span>${fmtT(r.t)}</span><span>${fmt(r.caseTime)}</span><span>${fmt(r.fluoro)}</span><span>${Math.round(r.km)} ml</span><span class="${r.dangers ? 'bad' : ''}">${r.dangers}</span>`).join('')}</div></details>`; }).join('') || '<div class="empty">noch keine absolvierten Übungen</div>';
  }
  function renderAccess() {
    const orgsAll = [...new Set((ADM.orgs || []).concat(ADM.accounts.map(a => a.org)).filter(Boolean))];
    const sel = $('accessOrg'); const cur = sel.value; sel.innerHTML = orgsAll.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join(''); if (cur) sel.value = cur;
    const org = sel.value; const list = org ? ADM.access[org.toLowerCase()] : undefined;
    if (!ADM.catalog.length) { $('accessList').innerHTML = '<div class="empty">Die Fallliste fehlt noch – einmal die Station starten, dann meldet sie die Fälle.</div>'; return; }
    $('accessState').textContent = !org ? '' : (Array.isArray(list) ? `${list.length} von ${ADM.catalog.length} Fällen frei` : 'alle Fälle frei (keine Einschränkung)');
    const mods = [...new Set(ADM.catalog.map(c => c.module || c.domain))];
    $('accessList').innerHTML = mods.map(m => `<div class="mod2">${esc(m)}</div>` + ADM.catalog.filter(c => (c.module || c.domain) === m).map(c => `<label class="ck"><input type="checkbox" data-case="${esc(c.id)}" ${!Array.isArray(list) || list.includes(c.id) ? 'checked' : ''}> ${esc(c.title)}</label>`).join('')).join('');
  }
  async function saveAccess(cases) {
    const org = $('accessOrg').value; if (!org) return;
    try { const j = await adminPut('/admin/access', { org, cases }); ADM.access = j.access; renderAccess(); } catch (e) { $('accessState').textContent = e.message; }
  }
  $('accessOrg').addEventListener('change', renderAccess);
  $('accessAll').onclick = () => saveAccess(null);
  $('accessNone').onclick = () => saveAccess([]);
  $('accessList').addEventListener('change', () => { const all = [...document.querySelectorAll('#accessList input[data-case]')]; const on = all.filter(i => i.checked).map(i => i.dataset.case); saveAccess(on.length === all.length ? null : on); });
  document.getElementById('admin').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-acc]'); if (!b) return;
    if (b.dataset.st === 'removed' && !confirm('Konto wirklich entfernen?')) return;
    try { const j = await adminPut('/admin/accounts', { email: b.dataset.acc, status: b.dataset.st }); ADM.accounts = j.accounts; renderAccounts(); } catch (err) { alert(err.message); }
  });
  $('adminOrgsSave').onclick = async () => {
    try { const j = await adminPut('/admin/orgs', { orgs: $('adminOrgs').value.split('\n').map(s => s.trim()).filter(Boolean) }); $('adminOrgs').value = j.orgs.join('\n'); $('adminOrgsSaved').textContent = 'gespeichert'; setTimeout(() => { $('adminOrgsSaved').textContent = ''; }, 3000); }
    catch (e) { $('adminOrgsSaved').textContent = e.message; }
  };
  async function openAdmin() {
    $('admin').classList.add('on'); $('adminWho').textContent = userName();
    try { const a = await adminGet('/admin/accounts'); ADM.accounts = a.accounts || []; $('adminOrgs').value = (a.orgs || []).join('\n'); $('adminUsers').value = (a.users || []).join('\n'); }
    catch (e) { ADM.accounts = []; $('adminPending').innerHTML = `<div class="empty">${esc(e.message)} – Worker aktualisieren?</div>`; }
    try { ADM.done = await adminGet('/admin/done'); } catch (e) { ADM.done = {}; }
    try { const a = await adminGet('/admin/access'); ADM.access = a.access || {}; ADM.catalog = a.catalog || []; ADM.orgs = a.orgs || []; } catch (e) { ADM.access = {}; ADM.catalog = []; ADM.orgs = []; }
    renderAccounts(); renderDone(); renderAccess();
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
    loadLogins(); Promise.all([loadDone(), loadAccess()]).then(() => { if (S.catalog) renderSetup(); });
    $('setupUser').innerHTML = `${ic('users')} ${esc(userName())}`;
    $('adminOpen').style.display = isAdmin() ? '' : 'none';
    loaderShow(); setLoad(0.02, 'Engine wird geladen …');
    try {
      S.catalog = await loadEngine();
      // Empfohlenes Material steckt nicht im Katalog-JSON: über den Fall nachladen
      S.catalog.scenarios.forEach((s, i) => { s.recommended = s.recommended || []; });
      E.ex.cs_start(0, 1, 0, 0, 0); E.ex.cs_hud(); const h = E.result(); S.catalog.scenarios[0].recommended = h.devices.map(d => d.id);
      for (let i = 1; i < S.catalog.scenarios.length; i++) { E.ex.cs_start(i, 1, 0, 0, 0); E.ex.cs_hud(); S.catalog.scenarios[i].recommended = E.result().devices.map(d => d.id); }
      resetTray(); $('setup').classList.add('on'); renderSetup(); postCatalog();
    } catch (err) { setLoad(LD.frac, 'Fehler: ' + err.message); $('ldSub').textContent = 'Seite neu laden und noch einmal versuchen'; console.error(err); }
  }
  $('codeGo').onclick = async () => {
    const u = $('user').value.trim();
    if (!u) { $('codeErr').textContent = 'Bitte einen Namen eingeben'; return; }
    $('codeErr').textContent = ''; $('codeGo').disabled = true;
    try { const j = await authRequest({ name: u, password: $('code').value, role: 'station' });
      try { localStorage.setItem('cathsim.user', j.name); localStorage.setItem('cathsim.token', j.token); localStorage.setItem('cathsim.role', j.role); localStorage.setItem('cathsim.org', j.org || ''); } catch (e) {}
      $('code').value = ''; boot();
    } catch (e) { $('codeErr').textContent = e.message; }
    $('codeGo').disabled = false;
  };
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('codeGo').click(); });
  // ---------- Registrierung ----------
  const showReg = (on) => { $('gateLogin').style.display = on ? 'none' : ''; $('gateReg').style.display = on ? '' : 'none'; $('tabLogin').classList.toggle('on', !on); $('tabReg').classList.toggle('on', on); if (on) { loadOrgs(); $('regFirst').focus(); } };
  $('tabLogin').onclick = () => showReg(false); $('tabReg').onclick = () => showReg(true);
  async function loadOrgs() {
    if (!EP()) return;
    try { const r = await fetch(EP() + '/orgs?x=' + Date.now(), { cache: 'no-store' }); const list = await r.json(); if (!Array.isArray(list)) return;
      const sel = $('regOrg'), cur = sel.value; sel.innerHTML = '<option value="">Organisation wählen …</option>' + list.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('') + '<option value="__new">Andere Organisation …</option>'; sel.value = cur;
    } catch (e) {}
  }
  $('regOrg').addEventListener('change', () => { const n = $('regOrg').value === '__new'; $('regOrgNew').style.display = n ? '' : 'none'; if (n) $('regOrgNew').focus(); });
  $('regGo').onclick = async () => {
    const err = $('regErr'); err.className = 'err'; err.textContent = '';
    const org = $('regOrg').value === '__new' ? $('regOrgNew').value.trim() : $('regOrg').value;
    const body = { first: $('regFirst').value.trim(), last: $('regLast').value.trim(), email: $('regEmail').value.trim(), org };
    if (!body.first || !body.last) { err.textContent = 'Vor- und Nachname eingeben'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { err.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben'; return; }
    if (!org) { err.textContent = 'Organisation auswählen oder eintragen'; return; }
    if (!EP()) { err.textContent = 'Anmeldeserver nicht eingerichtet'; return; }
    $('regGo').disabled = true;
    try {
      const r = await fetch(EP() + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) throw new Error('Der Anmeldeserver kennt noch keine Registrierung – Worker aktualisieren');
      if (!r.ok || !j.ok) throw new Error(j.error || 'Registrierung fehlgeschlagen');
      err.className = 'err ok'; err.textContent = j.note || 'Danke! Sobald der Admin dich freigeschaltet hat, kannst du dich mit deiner E-Mail anmelden.';
      $('user').value = body.email;
    } catch (e) { err.textContent = e.message; }
    $('regGo').disabled = false;
  };
  for (const id of ['regFirst', 'regLast', 'regEmail', 'regOrgNew']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('regGo').click(); });
  $('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('code').focus(); });
  try { const n = localStorage.getItem('cathsim.user'); if (n) $('user').value = n; } catch (e) {}
  if (gateOk()) boot(); else $('user').focus();
})();
