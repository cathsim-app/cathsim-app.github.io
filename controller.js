// Handy-Bedienfeld: Wischen schiebt und torquiert, Tasten lösen Aktionen aus. Der Zustand
// kommt von der Station; gezeichnet wird das koaxiale Bedienfeld wie in der iPhone-App.
(function () {
  const $ = (id) => document.getElementById(id);
  let link = null, status = null, fine = false, partner = null, coupling = false, holding = false, tableMode = false, myName = '';
  let scanStream = null, scanning = false;
  const send = (o) => link && link.send(Object.assign({ by: myName }, o));

  // Das Handy ist frei: nur ein Name, damit die Station zeigt, wer verbunden ist.
  // Kein Passwort, keine Liste – bei Vorträgen verbindet sich, wer will.
  function connectWith(code) {
    myName = $('name').value.trim().slice(0, 24); if (!myName) { $('cstate').textContent = 'Bitte einen Namen eingeben'; return; }
    code = code.trim().toUpperCase(); if (code.length < 4) { $('cstate').textContent = 'Code zu kurz'; return; }
    try { localStorage.setItem('cathsim.room', code); localStorage.setItem('cathsim.name', myName); } catch (e) {}
    let lastSt = '';
    link = CathSimLink.connect(code, 'controller', onMessage, (st, url) => {
      $('cstate').textContent = st; $('state').className = 'state' + (st === 'verbunden' ? ' ok' : '');
      if (st === 'verbunden' && lastSt !== st) sayHello(); lastSt = st;
    });
    $('roomcode').textContent = '· ' + code; $('me').textContent = '· ' + myName;

    stopScanner();
    $('connect').style.display = 'none'; $('app').classList.add('on');
    setInterval(() => { if (link && link.connected) send({ t: 'hb' }); }, 5000);
    draw();
  }
  function sayHello() { if (link && link.connected) link.send({ role: 'controller', name: myName, t: Date.now() }, true); }
  function onMessage(kind, msg) {
    if (kind === 'status') { status = msg; render(); }
    if (kind === 'hello' && msg.role === 'station') { $('state').className = 'state ok'; sayHello(); }
  }
  $('go').onclick = () => connectWith($('code').value);
  $('logout').onclick = () => { try { localStorage.removeItem('cathsim.name'); localStorage.removeItem('cathsim.room'); } catch (e) {} location.href = location.pathname; };
  (async () => { if (!window.CATHSIM_BUILD) return; try { const v = (await (await fetch('version.txt', { cache: 'no-store' })).text()).trim(); if (v && v !== window.CATHSIM_BUILD && sessionStorage.getItem('cathsim.reloaded') !== v) { sessionStorage.setItem('cathsim.reloaded', v); location.reload(); } } catch (e) {} })();
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectWith($('code').value); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('code').focus(); });
  try { const r = localStorage.getItem('cathsim.room'); if (r) $('code').value = r; const n = localStorage.getItem('cathsim.name'); if (n) $('name').value = n; } catch (e) {}
  // Code aus dem QR-Link übernehmen
  const qp = new URLSearchParams(location.search).get('code'); if (qp) { $('code').value = qp.toUpperCase(); if ($('name').value) connectWith(qp); else $('name').focus(); }

  // Kamera: beim Öffnen gleich nach dem QR-Code der Station suchen. Dekodiert wird
  // im Bild selbst (jsQR, lokal mitgeliefert); der BarcodeDetector des Browsers hilft
  // nur, wo er QR-Codes wirklich kann – Safari hat ihn nicht.
  const scanMsg = (t) => { $('scanText').textContent = t; };
  function takeCode(text) {
    const m = /code=([A-Z0-9]{4,8})/i.exec(text) || /^\s*([A-Z0-9]{6})\s*$/i.exec(text); if (!m) return false;
    const code = m[1].toUpperCase(); $('code').value = code; scanMsg('Code erkannt: ' + code);
    if (navigator.vibrate) navigator.vibrate(30); stopScanner();
    if ($('name').value.trim()) connectWith(code); else { $('name').focus(); $('cstate').textContent = 'Jetzt noch den Namen eingeben'; }
    return true;
  }
  async function startScanner() {
    if (link || scanning) return;
    if (!window.isSecureContext) { scanMsg('Kamera gibt es nur über https – Code eintippen'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { scanMsg('Kein Kamerazugriff in diesem Browser – Code eintippen'); return; }
    if (!window.jsQR && !('BarcodeDetector' in window)) { scanMsg('QR-Leser nicht geladen – Code eintippen'); return; }
    $('camGo').style.display = 'none'; scanMsg('Kamera startet …');
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      scanMsg(e && e.name === 'NotAllowedError' ? 'Kamerazugriff abgelehnt – in den Einstellungen erlauben oder Code eintippen' : 'Kamera nicht verfügbar – Code eintippen');
      $('camGo').style.display = ''; return;
    }
    const video = $('cam'); video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = scanStream;
    try { await video.play(); } catch (e) { $('camGo').style.display = ''; scanMsg('Zum Starten antippen'); stopScanner(); return; }
    scanning = true; scanMsg('QR-Code der Station vor die Kamera halten');
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let detector = null;
    try { if ('BarcodeDetector' in window && BarcodeDetector.getSupportedFormats) { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } } catch (e) {}
    let n = 0, lastErr = '';
    const tick = async () => {
      if (!scanning) return;
      if (video.readyState >= 2 && video.videoWidth) {
        let text = null;
        try {
          // Auf ~640 px verkleinern: schnell genug für 8 Bilder/s, fein genug für den Code
          const vw = video.videoWidth, vh = video.videoHeight; const k = Math.min(1, 640 / Math.max(vw, vh));
          const w = Math.round(vw * k), h = Math.round(vh * k); if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
          ctx.drawImage(video, 0, 0, w, h);
          if (window.jsQR) { const img = ctx.getImageData(0, 0, w, h); const r = jsQR(img.data, w, h, { inversionAttempts: (n & 1) ? 'attemptBoth' : 'dontInvert' }); if (r && r.data) text = r.data; }
          if (!text && detector) { const codes = await detector.detect(canvas); if (codes.length) text = codes[0].rawValue; }
        } catch (e) { if (String(e) !== lastErr) { lastErr = String(e); console.warn('Scanner', e); } }
        n++;
        if (text && takeCode(text)) return;
        if (text && n % 8 === 0) scanMsg('Das ist kein CathSim-Code – den QR-Code der Station scannen');
      }
      setTimeout(tick, 120);
    };
    tick();
  }
  function stopScanner() { scanning = false; if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } const v = $('cam'); if (v) v.srcObject = null; }
  $('camGo').onclick = startScanner;
  $('scanBox').addEventListener('click', () => { if (!scanning && !link) startScanner(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScanner(); else if (!link) startScanner(); });
  if (!qp) startScanner();

  // ---------- Anzeige ----------
  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; }, true);
  function setHTML(id, html) { const el = $(id); if (pointerDown || el.dataset.sig === html) return; el.dataset.sig = html; el.innerHTML = html; }
  function render() {
    const s = status; if (!s) return;
    if (s.waiting) {
      // Station steht noch im Startmenü: nur zeigen, dass man gesehen wird.
      $('title').textContent = 'CathSim'; $('tip').textContent = 'Station ist im Startmenü – der Fall startet gleich';
      const others = (s.people || []).filter(n => n !== myName); const esc = (t) => String(t).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      setHTML('who', (s.allowed === myName ? `${ic('phone')} Du wirst steuern` : (s.allowed ? `${ic('eye')} ${esc(s.allowed)} steuert · du schaust zu` : 'verbunden')) + (others.length ? ` <span class="others">· auch verbunden: ${others.map(esc).join(', ')}</span>` : ''));
      return;
    }
    $('title').textContent = s.title || 'CathSim';
    $('tip').textContent = s.tip || '';
    const others = (s.people || []).filter(n => n !== myName);
    const viewer = !!s.allowed && s.allowed !== myName; $('app').classList.toggle('viewer', viewer);
    const esc = (t) => String(t).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const also = others.length ? ` <span class="others">· auch verbunden: ${others.map(esc).join(', ')}</span>` : '';
    setHTML('who', viewer ? `${ic('eye')} ${esc(s.allowed)} steuert · du schaust zu` : (s.allowed === myName ? `${ic('phone')} Du steuerst` + also : (s.lead ? (s.lead === myName ? `${ic('phone')} Du steuerst` : `${ic('phone')} ${esc(s.lead)} steuert`) : 'noch niemand hat gesteuert') + also));
    setHTML('alert', s.alert ? (ic(s.alert.k === 'danger' ? 'stop' : 'warn') + ' ' + String(s.alert.t).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))) : (s.completed ? ic('check') + ' Ziel erreicht' : ''));
    const active = s.active;
    setHTML('chips', s.devices.map((d, i) => `<button class="${i === active ? 'on' : (partner === i ? 'coupled' : '')}" data-dev="${i}">${d.name}<small>${d.inserted ? Math.round(d.ins) + ' mm' : '—'}</small></button>`).join(''));
    const a = s.devices[active];
    $('shapes').style.display = a && a.shapeable ? 'flex' : 'none';
    if (a && a.shapeable) setHTML('shapes', s.shapes.map(sh => `<button class="${(sh.d < 0 ? a.stock : (!a.stock && Math.abs(a.tip - sh.d) < 1)) ? 'lit' : ''}" data-shape="${sh.d}">${sh.l}</button>`).join(''));
    $('bFluoro').className = s.fluoroOn ? 'on' : ''; $('bRoad').className = (s.roadmapArmed || s.roadmapActive) ? 'on' : '';
    $('bCouple').textContent = partner !== null ? 'gekoppelt' : (coupling ? 'Partner wählen' : 'koppeln'); $('bCouple').className = partner !== null ? 'orange' : (coupling ? 'lit' : '');
    const hasFiller = s.devices.some(d => d.kind === 'coil' || d.kind === 'web');
    $('bDetach').style.display = hasFiller ? '' : 'none'; $('bDetach').textContent = a && a.kind === 'web' ? 'WEB ablösen' : 'Coil ablösen'; $('bDetach').className = s.coilReady ? 'orange' : '';
    $('readout').textContent = a ? `${Math.round(a.ins)} mm · ${Math.round(a.rot * 180 / Math.PI)}°` : '';
    const stent = a && a.inserted && a.kind === 'stent' && a.implant > 0 && a.deployed < 0.999;
    $('sheath').className = stent ? 'on' : '';
    if (stent) { $('sheathFill').style.width = (a.deployed * 100) + '%'; $('sheathText').textContent = a.deployed < 0.02 ? 'Applikator zurückziehen' : `entfaltet ${Math.round(a.deployed * 100)} %`; }
    const fd = a && a.inserted && (a.kind === 'flowDiverter' || a.kind === 'stentRetriever') && a.deployed < 0.999;
    $('unsheath').className = fd ? 'on' : ''; if (fd) $('unsheath').textContent = a.deployed < 0.02 ? `Freisetzen: Mikrokatheter zurückziehen, ${a.name} halten` : `${a.name} zu ${Math.round(a.deployed * 100)} % entfaltet – Mikrokatheter weiter zurück`;
    const v = s.vitals; $('vit').className = (v.shock > 0.55 || (v.arr || 0) >= 0.7) ? 'red' : ((v.shock > 0.25 || (v.arr || 0) > 0.25) ? 'warn' : '');
    $('vHr').textContent = Math.round(v.hr); $('vRr').textContent = `${Math.round(v.sys)}/${Math.round(v.dia)}`; $('vSp').textContent = Math.round(v.spo2);
    if (!tableMode) $('hint').textContent = partner !== null ? 'beide schieben · nur das aktive torquen' : 'nach links = vor · senkrecht torquen · zwei Finger = Tisch';
    draw();
  }

  // Bühne: gespiegelt — Schleuse rechts, Spitzen nach links (man steht rechts am Patienten)
  const deck = $('deck');
  function draw() {
    const s = status; const dpr = window.devicePixelRatio || 1; const W = deck.clientWidth, H = deck.clientHeight; if (!W) return;
    if (deck.width !== W * dpr) { deck.width = W * dpr; deck.height = H * dpr; }
    const ctx = deck.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!s) return;
    const axis = H / 2, win = 150;
    const devs = s.devices.map((d, i) => ({ ...d, i })).filter(d => d.inserted && !['coil', 'web', 'liquidEmbolic'].includes(d.kind)).sort((a, b) => a.rank - b.rank);
    const a = s.devices[s.active]; const anchor = a && a.inserted ? a.ins : Math.max(0, ...devs.map(d => d.ins));
    const start = Math.max(anchor - win * 0.62, 0);
    const px = (mm) => W - (Math.min(Math.max((mm - start) / win, 0), 1) * (W - 26) + 8);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.roundRect(W - 20, axis - 30, 26, 60, 8); ctx.fill();
    for (const d of devs) {
      const hh = Math.max(3, Math.min(26, d.od * 7.5)), tipX = px(d.ins), isA = d.i === s.active, col = isA ? '10,132,255' : (d.wire ? '158,158,158' : '219,219,219');
      ctx.fillStyle = `rgba(${col},${isA ? 1 : 0.7})`; ctx.beginPath(); ctx.roundRect(tipX, axis - hh, W + 14 - tipX, hh * 2, hh); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.save(); ctx.clip();
      if (d.wire) { const sp = 7; let x = ((d.rot / (2 * Math.PI)) * sp) % sp + tipX - sp; ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.2; while (x < W + 14) { ctx.beginPath(); ctx.moveTo(x, axis - hh); ctx.lineTo(x + hh * 1.4, axis + hh); ctx.stroke(); x += sp; } }
      else { ctx.strokeStyle = 'rgba(0,0,0,.2)'; for (let k = 0; k < 16; k++) { const phi = d.rot + k * 2 * Math.PI / 16; if (Math.cos(phi) <= 0.04) continue; const y = axis + hh * Math.sin(phi); ctx.beginPath(); ctx.moveTo(tipX, y); ctx.lineTo(W + 14, y); ctx.stroke(); } }
      ctx.restore();
      if (d.implant > 0 && d.deployed > 0.01) { const len = d.implant * d.deployed / (win / (W - 26)); ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,165,0,.85)'; ctx.lineWidth = 1.6; ctx.strokeRect(tipX, axis - hh * 1.9, len, hh * 3.8); ctx.restore(); }
      if (isA) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.roundRect(tipX, axis - hh, W + 14 - tipX, hh * 2, hh); ctx.stroke(); }
      if (d.ins > start + win) { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12, axis + hh * Math.sin(d.i)); ctx.lineTo(4, axis + hh * Math.sin(d.i)); ctx.stroke(); }
    }
  }
  window.addEventListener('resize', draw);

  // ---------- Steuerung ----------
  const mmPerPt = () => fine ? 0.22 : 0.9, degPerPt = () => fine ? 0.4 : 1.5;
  let last = null, acc = { mm: 0, rad: 0 }, flushTimer = null;
  function flush() {
    if (!status) return;
    const active = status.active;
    if (Math.abs(acc.mm) > 0.05) {
      let both = [active]; if (partner !== null && partner !== active && status.devices[partner] && status.devices[partner].inserted) both.push(partner);
      both.sort((x, y) => (status.devices[x].ins > status.devices[y].ins) === (acc.mm > 0) ? -1 : 1);
      for (const i of both) send({ t: 'adv', mm: +acc.mm.toFixed(2), i });
    }
    if (Math.abs(acc.rad) > 0.001) send({ t: 'tq', rad: +acc.rad.toFixed(4), i: active });
    acc = { mm: 0, rad: 0 };
  }
  const stage = $('stage'); const pointers = new Map(); let tableAcc = { dx: 0, dy: 0 }, tableTimer = null;
  function flushTable() { if (Math.abs(tableAcc.dx) + Math.abs(tableAcc.dy) > 0.1) send({ t: 'table', dx: +tableAcc.dx.toFixed(1), dy: +tableAcc.dy.toFixed(1) }); tableAcc = { dx: 0, dy: 0 }; }
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; pointers.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; stage.setPointerCapture(e.pointerId); if (navigator.vibrate) navigator.vibrate(5); });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId); const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; pointers.set(e.pointerId, [e.clientX, e.clientY]);
    // Zwei Finger oder Tisch-Modus: der Patient wird unter dem Bild verschoben (Bildpunkt ≈ 0,5 mm)
    if (tableMode || pointers.size >= 2) { if (!e.isPrimary && pointers.size >= 2) return; tableAcc.dx += dx * 0.5; tableAcc.dy += dy * 0.5; if (!tableTimer) tableTimer = setTimeout(() => { tableTimer = null; flushTable(); }, 40); return; }
    acc.mm += -dx * mmPerPt(); acc.rad += -dy * degPerPt() * Math.PI / 180;
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 40);
  });
  const endDrag = (e) => { pointers.delete(e.pointerId); if (!pointers.size) { last = null; flush(); flushTable(); } };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);

  // Stent-Applikator: Zeigefinger hält, Daumen zieht nach rechts
  $('hold').addEventListener('pointerdown', (e) => { holding = true; $('hold').className = 'on'; $('hold').textContent = 'gehalten'; e.preventDefault(); });
  const unhold = () => { holding = false; $('hold').className = ''; $('hold').textContent = 'Stent halten'; };
  $('hold').addEventListener('pointerup', unhold); $('hold').addEventListener('pointercancel', unhold);
  let lastSheath = null;
  $('sheathBar').addEventListener('pointerdown', (e) => { lastSheath = e.clientX; $('sheathBar').setPointerCapture(e.pointerId); });
  $('sheathBar').addEventListener('pointermove', (e) => { if (lastSheath === null) return; const dx = e.clientX - lastSheath; lastSheath = e.clientX;
    if (!holding) { $('sheathText').textContent = 'erst den Stent halten'; return; }
    if (dx > 0 && status) send({ t: 'sheath', i: status.active, mm: +(dx * mmPerPt()).toFixed(2) }); });
  $('sheathBar').addEventListener('pointerup', () => { lastSheath = null; }); $('sheathBar').addEventListener('pointercancel', () => { lastSheath = null; });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !status) return; const d = b.dataset;
    if (d.dev !== undefined) { const i = +d.dev; if (coupling && i !== status.active && status.devices[i].inserted) { partner = i; coupling = false; } else { if (partner === i) partner = null; coupling = false; send({ t: 'sel', i }); } render(); return; }
    if (d.shape !== undefined) { send({ t: 'shape', i: status.active, deg: +d.shape }); return; }
    if (d.lao || d.cra || d.fov) { const c = status.carm || { lao: 0, cranial: 0, fov: 220 }; send({ t: 'carm', lao: c.lao + (+(d.lao || 0)), cra: c.cranial + (+(d.cra || 0)), fov: c.fov + (+(d.fov || 0)) }); return; }
    switch (b.id) {
      case 'bCouple': if (partner !== null || coupling) { partner = null; coupling = false; } else coupling = true; render(); break;
      case 'bWithdraw': send({ t: 'wd', i: status.active }); break;
      case 'bFine': fine = !fine; b.textContent = fine ? 'fein' : 'grob'; b.className = fine ? 'lit' : ''; break;
      case 'bTable': tableMode = !tableMode; b.className = tableMode ? 'lit' : ''; stage.className = tableMode ? 'table' : ''; $('hint').textContent = tableMode ? 'Tisch fahren: Wischen verschiebt den Patienten' : 'nach links = vor · senkrecht torquen · zwei Finger = Tisch'; break;
      case 'bFluoro': send({ t: 'act', a: 'fluoro' }); break;
      case 'bKM': send({ t: 'act', a: 'km' }); break;
      case 'bDSA': send({ t: 'act', a: 'dsa' }); break;
      case 'bRoad': send({ t: 'act', a: 'road' }); break;
      case 'bAsp': send({ t: 'act', a: 'asp' }); break;
      case 'bDetach': send({ t: 'act', a: 'detach' }); break;
      case 'bCenter': send({ t: 'act', a: 'center' }); break;
    }
    if (navigator.vibrate) navigator.vibrate(8);
  });
})();
