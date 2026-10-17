// Handy-Bedienfeld: Wischen schiebt und torquiert, Tasten lösen Aktionen aus. Der Zustand
// kommt von der Station; gezeichnet wird das koaxiale Bedienfeld wie in der iPhone-App.
(function () {
  const $ = (id) => document.getElementById(id);
  let link = null, status = null, fine = false, partner = null, coupling = false, holding = false, tableMode = false, myName = '';
  let scanStream = null, scanning = false;
  const send = (o) => { noteMotion(o); return link && link.send(Object.assign({ by: myName }, o)); };
  // Was gerade übertragen wird, je Instrument und Zug: Vorschub, Torque, Schleuse. Nach kurzer Ruhe beginnt ein neuer Zug.
  var MOT = {};
  function noteMotion(o) {
    if (o.t !== 'adv' && o.t !== 'tq' && o.t !== 'sheath') return;
    const now = performance.now(); let m = MOT[o.i];
    if (!m || now - m.t > 1500) m = MOT[o.i] = { mm: 0, deg: 0, sh: 0, t0: now, t: now };
    if (o.t === 'adv') m.mm += o.mm; else if (o.t === 'tq') m.deg += o.rad * 180 / Math.PI; else m.sh += o.mm;
    m.t = now;
  }

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
    setTimeout(() => { if (cfg.mode === 'gest') startGestures(); }, 0);   // erst wenn alles weiter unten initialisiert ist
  }
  function sayHello() { if (link && link.connected) link.send({ role: 'controller', name: myName, t: Date.now() }, true); }
  function onMessage(kind, msg) {
    if (kind === 'status') {
      // eben gegriffen: bis die Station den Wechsel bestätigt, bleibt das gegriffene Instrument aktiv
      if (pendingSel) { if (msg.active === pendingSel.i || performance.now() - pendingSel.t > 800) pendingSel = null; else msg.active = pendingSel.i; }
      if (status && msg.active !== status.active) MOT = {}; status = msg; if (!msg.waiting) feelStatus(msg); render(); }
    if (kind === 'hello' && msg.role === 'station') { $('state').className = 'state ok'; sayHello(); }
  }
  $('go').onclick = () => connectWith($('code').value);
  $('logout').onclick = () => { try { localStorage.removeItem('cathsim.name'); localStorage.removeItem('cathsim.room'); } catch (e) {} location.href = location.pathname; };
  (async () => { if (!window.CATHSIM_BUILD) return; try { const v = (await (await fetch('version.txt', { cache: 'no-store' })).text()).trim(); if (v && v !== window.CATHSIM_BUILD && sessionStorage.getItem('cathsim.reloaded') !== v) { sessionStorage.setItem('cathsim.reloaded', v); try { await fetch(location.pathname, { cache: 'reload' }); } catch (e) {} location.reload(); } } catch (e) {} })();
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

  // ---------- Haptik ----------
  // Android kann vibrieren (Dauer in ms). iOS hat dafür keine Schnittstelle; Safari löst aber
  // beim Umschalten eines Schalters (<input switch>) einen kurzen Taptic-Impuls aus – das
  // ergibt einen Tick, längere Muster werden aus mehreren Ticks gebaut.
  const canVibrate = typeof navigator.vibrate === 'function';
  // Einstellungen (Menü oben rechts), bleiben auf dem Handy gespeichert.
  const DEF = { mode: 'touch', sound: false, haptic: true, hapStr: 1, hapPush: true, swipe: 1, grip: 0.32, gPush: 1, gTwist: 1, gSmooth: 0.45, gInv: false, gPrev: true };
  var cfg = Object.assign({}, DEF);   // var: draw() kann schon beim Verbinden laufen try { Object.assign(cfg, JSON.parse(localStorage.getItem('cathsim.ctl') || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem('cathsim.ctl', JSON.stringify(cfg)); } catch (e) {} };
  // Klick-Ton als Ersatz, wo nichts vibriert (iPhone ohne Taptic-Impuls, Gestenmodus ohne Fingertipp).
  let actx = null;
  function unlockAudio() { if (!cfg.sound) return; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== 'running') actx.resume(); } catch (e) {} }
  // Bass-Puls statt Klick: tiefer Sinus mit fallender Tonhöhe (wie ein Kick), dazu die Oktave,
  // damit ihn auch kleine Handylautsprecher wiedergeben. Vorschub-Ticks ganz leise, Widerstand
  // tiefer und länger, Alarme kräftig.
  function click(ms) {
    if (!cfg.sound || !actx || actx.state !== 'running') return;
    const t = actx.currentTime, d = Math.min(0.3, 0.05 + ms / 600), f0 = ms > 30 ? 62 : 78;
    const vol = (ms <= 6 ? 0.12 : Math.min(0.55, 0.2 + ms / 250)) * cfg.hapStr;
    const out = actx.createGain(); out.connect(actx.destination);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(vol, t + 0.004); out.gain.exponentialRampToValueAtTime(0.0001, t + d);
    for (const [mul, g0] of [[1, 1], [2, 0.45]]) {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f0 * mul * 1.6, t); o.frequency.exponentialRampToValueAtTime(f0 * mul, t + 0.03);
      g.gain.value = g0; o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.02);
    }
  }
  // Ein dauerhafter, unsichtbarer, aber gerenderter Schalter im Dokument: Safari gibt den
  // Impuls nur für Schalter, die wirklich im Layout stehen.
  let tapSw = null;
  function tick() {
    if (canVibrate) return;
    try {
      if (!tapSw) { const l = document.createElement('label'); l.ariaHidden = 'true'; l.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;overflow:hidden;pointer-events:none'; const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i); document.body.appendChild(l); tapSw = l; }
      tapSw.click();
    } catch (e) {}
  }
  function buzz(pattern, force) {
    if (!cfg.haptic && !force) return;
    const p0 = Array.isArray(pattern) ? pattern : [pattern];
    for (let k = 0, t = 0; k < p0.length; k += 2) { const ms = p0[k]; if (t === 0) click(ms); else setTimeout(() => click(ms), t); t += p0[k] + (p0[k + 1] || 0); }
    if (canVibrate) { const k = cfg.hapStr; navigator.vibrate(Array.isArray(pattern) ? pattern.map((v, i) => i % 2 ? v : Math.max(1, Math.round(v * k))) : Math.max(1, Math.round(pattern * k))); return; }
    const p = Array.isArray(pattern) ? pattern : [pattern]; let t = 0;
    // Der erste Impuls muss synchron im Fingerereignis kommen, sonst verwirft Safari ihn.
    for (let k = 0; k < p.length; k += 2) { const n = Math.max(1, Math.round(p[k] / 40)); for (let j = 0; j < n; j++) { const at = t + j * 45; if (at === 0) tick(); else setTimeout(tick, at); } t += p[k] + (p[k + 1] || 0); }
  }
  // Vorschub fühlt sich an wie Draht durch das Ventil: alle paar Millimeter ein ganz feiner Tick,
  // bei Widerstand dichter und kräftiger.
  let feelMM = 0, lastFeel = 0, hapSeen = null, pendingAlarm = null;
  function feelAdvance(mm) {
    if (!status || !cfg.haptic) return;
    const f = status.force || 0; feelMM += Math.abs(mm);
    const every = (fine ? 0.6 : 1.8) * (1 - 0.6 * Math.min(f, 1));
    if (feelMM < every) return; feelMM = 0;
    const now = performance.now(); if (now - lastFeel < 35) return; lastFeel = now;
    if (pendingAlarm) { const p = pendingAlarm; pendingAlarm = null; buzz(p); return; }   // iOS: Muster im Fingerereignis nachholen
    if (f > 0.15) buzz(Math.round(8 + 32 * Math.min(f, 1))); else if (cfg.hapPush) buzz(4);
  }
  function feelStatus(s) {
    const h = s.hap || [0, 0];
    if (hapSeen && (h[1] > hapSeen[1] || h[0] > hapSeen[0])) {
      const p = h[1] > hapSeen[1] ? [90, 50, 90, 50, 220] : [45, 60, 45];   // Dissektion/Perforation: kräftig; Warnung: doppelt
      buzz(p); if (!canVibrate) pendingAlarm = p;
    }
    hapSeen = h.slice();
  }

  // ---------- Anzeige ----------
  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; }, true);
  const lbl = (id, text) => { const el = $(id); const l = el && el.querySelector('.l'); if (l) l.textContent = text; else if (el) el.textContent = text; };
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
    $('bFluoro').className = 'tile ' + (s.fluoroOn ? 'on' : ''); $('bRoad').className = 'tile ' + ((s.roadmapArmed || s.roadmapActive) ? 'on' : '');
    lbl('bCouple', partner !== null ? 'gekoppelt' : (coupling ? 'Partner wählen' : 'koppeln')); $('bCouple').className = 'tile ' + (partner !== null ? 'orange' : (coupling ? 'lit' : ''));
    // Befehle gehören zum aktiven Instrument: Ablösen nur bei Coil/WEB, Aspiration nur am Aspirationskatheter.
    const canDetach = !!(a && a.inserted && (a.kind === 'coil' || a.kind === 'web'));
    const canAsp = !!(a && a.inserted && a.kind === 'aspirationCatheter');
    $('bDetach').style.display = canDetach ? '' : 'none'; $('bAsp').style.display = canAsp ? '' : 'none';
    const canBalloon = !!(a && a.inserted && a.kind === 'balloon');
    $('bInflate').style.display = canBalloon ? '' : 'none'; $('bDeflate').style.display = canBalloon ? '' : 'none';
    if (canBalloon) { lbl('bInflate', `Füllen · ${Math.round(a.atm || 0)} atm`); $('bInflate').className = 'tile wide ' + (a.inflation > 0.05 ? 'lit' : ''); }
    const canGlue = !!(a && a.kind === 'liquidEmbolic'), g = s.glue;
    $('bGlue').style.display = canGlue ? '' : 'none';
    if (canGlue && g) lbl('bGlue', g.stuck ? 'Katheter klebt fest' : `Kleber · ${g.ml.toFixed(2)} ml${g.active ? ` · Reflux ${g.reflux.toFixed(0)} mm` : ''}`);
    $('devActs').className = 'tiles' + (canDetach || canAsp || canBalloon || canGlue ? ' on' : '');
    if (canDetach) { lbl('bDetach', `${a.name} ablösen`); $('bDetach').className = 'tile wide ' + (s.coilReady ? 'orange' : ''); }
    if (canAsp) lbl('bAsp', `${a.name}: aspirieren`);
    $('readout').textContent = a ? `${Math.round(a.ins)} mm · ${Math.round(a.rot * 180 / Math.PI)}°` : '';
    const stent = a && a.inserted && a.kind === 'stent' && a.od >= 1 && a.implant > 0 && a.deployed < 0.999;   // Karotisstent: Schleuse
    $('sheath').className = stent ? 'on' : '';
    if (stent) { $('sheathFill').style.width = (a.deployed * 100) + '%'; $('sheathText').textContent = a.deployed < 0.02 ? 'Applikator zurückziehen' : `entfaltet ${Math.round(a.deployed * 100)} %`; }
    const fd = a && a.inserted && (a.kind === 'flowDiverter' || a.kind === 'stentRetriever' || (a.kind === 'stent' && a.od < 1)) && a.deployed < 0.999;
    $('unsheath').className = fd ? 'on' : ''; if (fd) $('unsheath').textContent = a.deployed < 0.02 ? `Freisetzen: Mikrokatheter zurückziehen, ${a.name} halten` : `${a.name} zu ${Math.round(a.deployed * 100)} % entfaltet – Mikrokatheter weiter zurück`;
    if (s.carm) { $('stLao').textContent = `${s.carm.lao >= 0 ? 'LAO' : 'RAO'} ${Math.abs(Math.round(s.carm.lao))}°`; $('stCra').textContent = `${s.carm.cranial >= 0 ? 'CRAN' : 'CAUD'} ${Math.abs(Math.round(s.carm.cranial))}°`; $('stFov').textContent = `${Math.round(s.carm.fov / 7)} cm`; }
    const v = s.vitals; $('vit').className = (v.shock > 0.55 || (v.arr || 0) >= 0.7) ? 'red' : ((v.shock > 0.25 || (v.arr || 0) > 0.25) ? 'warn' : '');
    $('vKm').textContent = Math.round(s.km || 0); $('vKm').style.color = (s.km || 0) >= 300 ? '#ff453a' : ((s.km || 0) >= 200 ? '#ff9f0a' : '');
    $('vHr').textContent = Math.round(v.hr); $('vRr').textContent = `${Math.round(v.sys)}/${Math.round(v.dia)}`; $('vSp').textContent = Math.round(v.spo2);
    if (!tableMode) $('hint').textContent = gest.on && gest.msg ? gest.msg : partner !== null ? 'beide schieben · nur das aktive torquen' : 'nach links = vor · senkrecht torquen · zwei Finger = Tisch';
    draw();
  }

  // Bühne: gespiegelt — Schleuse rechts, Spitzen nach links (man steht rechts am Patienten).
  // Oben die ganze Länge von der Schleuse bis zur Spitze, darunter der Ausschnitt, der immer
  // die führende Spitze und das aktive Instrument zeigt.
  const deck = $('deck');
  function draw() {
    const s = status; const dpr = window.devicePixelRatio || 1; const W = deck.clientWidth, H = deck.clientHeight; if (!W) return;
    if (deck.width !== Math.round(W * dpr) || deck.height !== Math.round(H * dpr)) { deck.width = Math.round(W * dpr); deck.height = Math.round(H * dpr); }
    const ctx = deck.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const G = gest && gest.on ? handLayer(ctx, W, H) : null;
    if (!s) return;
    const devs = s.devices.map((d, i) => ({ ...d, i })).filter(d => d.inserted && !['coil', 'web', 'liquidEmbolic'].includes(d.kind)).sort((a, b) => a.rank - b.rank);
    if (!devs.length) return;
    const lead = Math.max(...devs.map(d => d.ins));
    const a = devs.find(d => d.i === s.active); const act = a ? a.ins : lead;
    const colOf = (d) => d.i === s.active ? '10,132,255' : (d.wire ? '142,142,147' : '209,209,214');

    // Übersicht: ganze Länge
    const oy = 38, L = Math.max(lead * 1.08, 200);
    const ox = (mm) => W - 14 - Math.min(Math.max(mm / L, 0), 1) * (W - 28);
    ctx.fillStyle = 'rgba(118,118,128,.24)'; ctx.beginPath(); ctx.roundRect(10, oy - 5, W - 20, 10, 5); ctx.fill();
    // Ausschnitt: führende Spitze vorn, aktives Instrument und etwas Weg dahinter
    const win = Math.max(150, (lead - act) * 1.25 + 70);
    const end = lead + win * 0.12, start = Math.max(end - win, 0);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(ox(end), oy - 8, ox(start) - ox(end), 16, 4); ctx.stroke();
    devs.forEach((d, k) => {
      const y = oy - 2.5 + (k % 3) * 2.5;
      ctx.strokeStyle = `rgba(${colOf(d)},${d.i === s.active ? 1 : 0.8})`; ctx.lineWidth = d.i === s.active ? 2.2 : 1.4;
      ctx.beginPath(); ctx.moveTo(ox(0), y); ctx.lineTo(ox(d.ins), y); ctx.stroke();
      ctx.fillStyle = `rgb(${colOf(d)})`; ctx.beginPath(); ctx.arc(ox(d.ins), y, d.i === s.active ? 3 : 2.2, 0, 2 * Math.PI); ctx.fill();
    });
    ctx.fillStyle = 'rgba(235,235,245,.45)'; ctx.font = '500 9px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('Schleuse', W - 12, oy + 18); ctx.textAlign = 'left'; ctx.fillText(Math.round(L / 10) + ' cm', 12, oy + 18);

    // Ausschnitt
    const axis = Math.max(oy + 50, H / 2 + 14);
    const px = (mm) => W - (Math.min(Math.max((mm - start) / win, 0), 1) * (W - 26) + 8);
    // Maßstab: Striche alle 1 cm (ab 25 cm Fenster alle 5 cm)
    const tick = win > 250 ? 50 : 10; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let m = Math.ceil(start / tick) * tick; m <= end; m += tick) { const x = px(m); ctx.beginPath(); ctx.moveTo(x, axis - 34); ctx.lineTo(x, axis + 34); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.roundRect(W - 20, axis - 30, 26, 60, 8); ctx.fill();
    for (const d of devs) {
      const hh = Math.max(3, Math.min(26, d.od * 7.5)), tipX = px(d.ins), isA = d.i === s.active, col = colOf(d);
      ctx.fillStyle = `rgba(${col},${isA ? 1 : 0.7})`; ctx.beginPath(); ctx.roundRect(tipX, axis - hh, W + 14 - tipX, hh * 2, hh); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.save(); ctx.clip();
      if (d.wire) { const sp = 7; let x = ((d.rot / (2 * Math.PI)) * sp) % sp + tipX - sp; ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.2; while (x < W + 14) { ctx.beginPath(); ctx.moveTo(x, axis - hh); ctx.lineTo(x + hh * 1.4, axis + hh); ctx.stroke(); x += sp; } }
      else { ctx.strokeStyle = 'rgba(0,0,0,.2)'; for (let k = 0; k < 16; k++) { const phi = d.rot + k * 2 * Math.PI / 16; if (Math.cos(phi) <= 0.04) continue; const y = axis + hh * Math.sin(phi); ctx.beginPath(); ctx.moveTo(tipX, y); ctx.lineTo(W + 14, y); ctx.stroke(); } }
      ctx.restore();
      if (d.implant > 0 && d.deployed > 0.01) { const len = d.implant * d.deployed / (win / (W - 26)); ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,159,10,.85)'; ctx.lineWidth = 1.6; ctx.strokeRect(tipX, axis - hh * 1.9, len, hh * 3.8); ctx.restore(); }
      if (isA) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.roundRect(tipX, axis - hh, W + 14 - tipX, hh * 2, hh); ctx.stroke(); }
    }
    if (G) {
      if (G.inner && a) drawClamp(ctx, G.inner, a, px(a.ins), axis, W, '#0a84ff');
      if (G.outer && gest.two) { const o = devs.find(d => d.i === gest.two.outer); if (o) drawClamp(ctx, G.outer, o, px(o.ins) + (o === a ? (o.implant || 0) * (W - 26) / win : 0), axis, W, '#ff9f0a'); }
    }
    drawValues(ctx, W, H, s, G);
    // Beschriftung direkt auf dem Katheter, kurz hinter der Spitze: Name und Abstand zur führenden Spitze
    ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let right = -Infinity;
    devs.slice().sort((p, q) => q.ins - p.ins).forEach((d) => {
      const hh = Math.max(3, Math.min(26, d.od * 7.5)), x0 = px(d.ins);
      const gap = lead - d.ins, name = (d.name || '').split(' ')[0];
      const text = gap > 0.5 ? `${name}  −${Math.round(gap)} mm` : name;
      const tw = ctx.measureText(text).width;
      // Etikett auf dem eigenen Schaft, hinter der Spitze; liegt dort schon eins, rückt es weiter zur Schleuse.
      const x = Math.min(Math.max(x0 + Math.min(hh, 8) + 4, right + 12, 6), W - 26 - tw); right = x + tw;
      const pill = hh < 8;
      if (pill) { ctx.fillStyle = 'rgba(28,28,30,.88)'; ctx.beginPath(); ctx.roundRect(x - 5, axis - 8, tw + 10, 16, 8); ctx.fill(); ctx.strokeStyle = `rgba(${colOf(d)},.9)`; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = pill ? (d.i === s.active ? '#0a84ff' : 'rgba(235,235,245,.85)') : (d.i === s.active ? '#fff' : 'rgba(0,0,0,.75)');
      ctx.fillText(text, x, axis + 0.5);
    });
    ctx.textBaseline = 'alphabetic';
  }
  window.addEventListener('resize', draw);

  var deckGeom = null, pendingSel = null;

  // Gestenmodus: Kamerabild ganz blass hinter den Kathetern, darüber das Handskelett und
  // ein paar Messwerte an der Hand. Liefert die Lage des Griffs in Bühnenkoordinaten.
  const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
  // Farben der Werte: vor grün, zurück orange; Torque im Uhrzeigersinn blau, gegen ihn hellblau.
  const colMM = (v) => v >= 0 ? '#30d158' : '#ff9f0a', colTQ = (v) => v >= 0 ? '#0a84ff' : '#64d2ff';
  function handLayer(ctx, W, H) {
    const v = $('gcam'); const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
    const k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
    const at = (q) => [ox + q[0] * dw, oy + q[1] * dh]; gest.toStage = at;
    if (cfg.gPrev && v.readyState >= 2) {
      ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, W, H, 20); ctx.clip();
      ctx.globalAlpha = 0.17; if ('filter' in ctx) ctx.filter = 'grayscale(1) contrast(1.15)';
      ctx.translate(ox + dw, oy); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, dw, dh); ctx.restore();
    }
    const out = {};
    for (const role of ['outer', 'inner']) {
      const st = gest.H[role], h = st.pts; if (!h) continue;
      const grip = st.grip, col = grip ? (role === 'outer' ? '255,159,10' : '10,132,255') : '235,235,245';
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(${col},${grip ? 0.55 : 0.32})`; ctx.lineWidth = 1.5; ctx.beginPath();
      for (const [i, j] of BONES) { const p = at(h[i]), q = at(h[j]); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); } ctx.stroke();
      ctx.fillStyle = `rgba(${col},${grip ? 0.8 : 0.5})`;
      for (let i = 0; i < 21; i++) { const p = at(h[i]); ctx.beginPath(); ctx.arc(p[0], p[1], i % 4 === 0 && i ? 2.6 : 1.8, 0, 2 * Math.PI); ctx.fill(); }
      // Griff: Ring zwischen Daumen und Zeigefinger, füllt sich bis zur Greifschwelle
      const t = at(h[4]), f = at(h[8]), g = [(t[0] + f[0]) / 2, (t[1] + f[1]) / 2];
      ctx.strokeStyle = `rgba(${col},.7)`; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(f[0], f[1]); ctx.stroke(); ctx.setLineDash([]);
      const fill = Math.max(0, Math.min(1, (cfg.grip * 2.2 - st.pinch) / (cfg.grip * 1.2)));
      ctx.strokeStyle = 'rgba(118,118,128,.5)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(g[0], g[1], 11, 0, 2 * Math.PI); ctx.stroke();
      ctx.strokeStyle = grip ? `rgb(${col})` : 'rgba(235,235,245,.85)'; ctx.beginPath(); ctx.arc(g[0], g[1], 11, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (grip ? 1 : fill)); ctx.stroke();
      if (grip) {
        ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(g[0], g[1], 4, 0, 2 * Math.PI); ctx.fill();
        // Torque: zwei gebogene Pfeile um den Griff, sie drehen sich mit dem übertragenen Winkel
        if (Math.abs(st.w) > 0.12) {
          const dir = st.w > 0 ? 1 : -1, r = 18, rot = st.sRad, c = colTQ(st.w);
          ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
          for (const base of [0, Math.PI]) {
            const a0 = base + rot, a1 = a0 + dir * 1.1;
            ctx.beginPath(); ctx.arc(g[0], g[1], r, a0, a1, dir < 0); ctx.stroke();
            const hx = g[0] + r * Math.cos(a1), hy = g[1] + r * Math.sin(a1), tx = -Math.sin(a1) * dir, ty = Math.cos(a1) * dir, nx = Math.cos(a1), ny = Math.sin(a1);
            ctx.beginPath(); ctx.moveTo(hx + tx * 5, hy + ty * 5); ctx.lineTo(hx - tx * 1 + nx * 3.5, hy - ty * 1 + ny * 3.5); ctx.lineTo(hx - tx * 1 - nx * 3.5, hy - ty * 1 - ny * 3.5); ctx.closePath(); ctx.fill();
          }
        }
      }
      ctx.restore();
      out[role] = { x: g[0], y: g[1], grip, st };
    }
    return out;
  }
  // Werte dezent unten im Feld, farbkodiert: aktives Instrument immer, im Zwei-Hand-Schritt
  // auch das äußere. Grün vor, orange zurück, blau/hellblau Torque; nach einer Pause verblassen sie.
  function drawValues(ctx, W, H, s, G) {
    const el = $('vals'); const a = s.devices[s.active];
    if (!a || !a.inserted) { if (el.dataset.sig !== '') { el.dataset.sig = ''; el.innerHTML = ''; } return; }
    const two = (gest && gest.on && twoHand()) || (isCarotidStent(a) ? { kind: 'sheath', outer: s.active } : null);
    const rows = [];
    if (two && two.kind === 'sheath') rows.push({ side: 'L', name: 'Applikator', m: MOT[s.active], sheath: true, col: '#ff9f0a', st: G && G.outer && G.outer.st });
    else if (two) rows.push({ side: 'L', name: s.devices[two.outer].name, m: MOT[two.outer], col: '#ff9f0a', st: G && G.outer && G.outer.st });
    rows.push({ side: two ? 'R' : '', name: a.name, m: MOT[s.active], col: '#0a84ff', st: G && G.inner && G.inner.st });
    const now = performance.now(), esc = (t) => String(t).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const html = rows.map(r => {
      const m = r.m, live = m && now - m.t < 1500, dim = m && !live && now - m.t > 4000;
      const pill = (txt, c, on) => `<span class="vp${on ? '' : ' off'}"${on ? ` style="color:${c}"` : ''}>${txt}</span>`;
      let p = '';
      if (r.sheath) { const v = m ? m.sh : 0; p = pill('◀ ' + v.toFixed(1) + ' mm', '#ff9f0a', v > 0.05); }
      else {
        const mm = m ? m.mm : 0, deg = m ? m.deg : 0;
        p = pill((mm >= 0 ? '▲ ' : '▼ ') + Math.abs(mm).toFixed(1) + ' mm', colMM(mm), Math.abs(mm) > 0.05) + pill((deg >= 0 ? '↻ ' : '↺ ') + Math.abs(deg).toFixed(0) + '°', colTQ(deg), Math.abs(deg) > 0.5);
      }
      const sp = live ? Math.abs((r.sheath ? m.sh : m.mm) / Math.max(0.2, (m.t - m.t0) / 1000)).toFixed(0) + ' mm/s' : '';
      return `<div class="vr${dim ? ' dim' : ''}"><b${r.st && r.st.grip ? ` style="color:${r.col}"` : ''}>${esc((r.side ? r.side + ' · ' : '') + r.name.split(' ')[0])}</b>${p}<em>${sp}</em></div>`;
    }).join('');
    if (el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; }
  }
  // Klemme am gehaltenen Instrument, dort, wo die Hand steht. Beim Greifen schließen sich die Backen;
  // Pfeile laufen in Schubrichtung, ein Bogen zeigt den Torque.
  function drawClamp(ctx, C, d, tipX, axis, W, color) {
    const st = C.st, hh = Math.max(3, Math.min(26, d.od * 7.5)), x = Math.min(Math.max(C.x, tipX + 16), W - 30);
    const gap = C.grip ? 1.5 : 7, col = C.grip ? color : 'rgba(235,235,245,.55)';
    ctx.save();
    ctx.strokeStyle = C.grip ? 'rgba(255,255,255,.25)' : 'rgba(235,235,245,.18)'; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(x, axis + (C.y < axis ? -hh - gap - 6 : hh + gap + 6)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(x - 9, axis - hh - gap - 6, 18, 6, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x - 9, axis + hh + gap, 18, 6, 3); ctx.fill();
    if (C.grip && Math.abs(st.v) > 2) {
      const dir = st.v > 0 ? -1 : 1, ph = ((performance.now() / 1000 * Math.min(Math.abs(st.v), 60) * 0.8) % 14);
      ctx.strokeStyle = colMM(st.v); ctx.lineWidth = 1.6;
      for (let j = 0; j < 3; j++) { const cx = x + dir * (16 + j * 14 + ph); if (cx < tipX || cx > W - 14) continue; ctx.beginPath(); ctx.moveTo(cx - dir * 3, axis - 3.5); ctx.lineTo(cx + dir * 1.5, axis); ctx.lineTo(cx - dir * 3, axis + 3.5); ctx.stroke(); }
    }
    if (C.grip && Math.abs(st.w) > 0.15) {
      const r = hh + gap + 12, sw = Math.max(-2.4, Math.min(2.4, st.w * 0.6));
      ctx.strokeStyle = colTQ(st.w); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, axis, r * 0.45, r, 0, -Math.PI / 2, -Math.PI / 2 + sw, sw < 0); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Steuerung ----------
  const mmPerPt = () => (fine ? 0.22 : 0.9) * cfg.swipe, degPerPt = () => (fine ? 0.4 : 1.5) * cfg.swipe;
  let last = null, acc = { mm: 0, rad: 0 }, accO = { mm: 0, rad: 0, i: -1 }, flushTimer = null;
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
    // zweite Hand: äußeres Instrument
    if (accO.i >= 0 && status.devices[accO.i]) {
      if (Math.abs(accO.mm) > 0.05) send({ t: 'adv', mm: +accO.mm.toFixed(2), i: accO.i });
      if (Math.abs(accO.rad) > 0.001) send({ t: 'tq', rad: +accO.rad.toFixed(4), i: accO.i });
    }
    accO = { mm: 0, rad: 0, i: -1 };
    if (!(gest && gest.on)) draw();
  }
  const stage = $('stage'); const pointers = new Map(); let tableAcc = { dx: 0, dy: 0 }, tableTimer = null;
  function flushTable() { if (Math.abs(tableAcc.dx) + Math.abs(tableAcc.dy) > 0.1) send({ t: 'table', dx: +tableAcc.dx.toFixed(1), dy: +tableAcc.dy.toFixed(1) }); tableAcc = { dx: 0, dy: 0 }; }
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; stage.setPointerCapture(e.pointerId); unlockAudio(); buzz(5); });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId); const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; pointers.set(e.pointerId, [e.clientX, e.clientY]);
    // Zwei Finger oder Tisch-Modus: der Patient wird unter dem Bild verschoben (Bildpunkt ≈ 0,5 mm)
    if (tableMode || pointers.size >= 2) { if (!e.isPrimary && pointers.size >= 2) return; tableAcc.dx += dx * 0.5; tableAcc.dy += dy * 0.5; if (!tableTimer) tableTimer = setTimeout(() => { tableTimer = null; flushTable(); }, 40); return; }
    acc.mm += -dx * mmPerPt(); acc.rad += -dy * degPerPt() * Math.PI / 180; feelAdvance(dx * mmPerPt());
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 40);
  });
  const endDrag = (e) => { pointers.delete(e.pointerId); if (!pointers.size) { last = null; flush(); flushTable(); } };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);

  // Stent-Applikator: Zeigefinger hält, Daumen zieht nach rechts
  $('hold').addEventListener('pointerdown', (e) => { holding = true; $('hold').className = 'on'; lbl('hold', 'gehalten'); e.preventDefault(); });
  const unhold = () => { holding = false; $('hold').className = ''; lbl('hold', 'Stent halten'); };
  $('hold').addEventListener('pointerup', unhold); $('hold').addEventListener('pointercancel', unhold);
  let lastSheath = null;
  $('sheathBar').addEventListener('pointerdown', (e) => { lastSheath = e.clientX; $('sheathBar').setPointerCapture(e.pointerId); });
  $('sheathBar').addEventListener('pointermove', (e) => { if (lastSheath === null) return; const dx = e.clientX - lastSheath; lastSheath = e.clientX;
    if (!holding) { $('sheathText').textContent = 'erst den Stent halten'; return; }
    if (dx > 0 && status) send({ t: 'sheath', i: status.active, mm: +(dx * mmPerPt()).toFixed(2) }); });
  $('sheathBar').addEventListener('pointerup', () => { lastSheath = null; }); $('sheathBar').addEventListener('pointercancel', () => { lastSheath = null; });

  // ---------- Gesten über die Frontkamera ----------
  // Das Handy liegt vor einem; die Hand führt den Draht in der Luft. Daumen und Zeigefinger
  // zusammen = greifen. Nur solange gegriffen ist, bewegt die Hand das Instrument:
  // zur Bildschirmseite links = vor (wie beim Wischen), Handgelenk drehen = torquen.
  // Loslassen, Hand zurücksetzen, neu greifen – wie Hand über Hand am Tisch.
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  // Zwei Hände: die patientennahe (links im Bild) hält das äußere Instrument – Mikrokatheter oder
  // Applikator –, die hintere das aktive. So wird freigesetzt wie am Tisch: hinten halten, vorn zurückziehen.
  const newHand = () => ({ pts: null, pinch: 1, grip: false, last: null, roll: null, sm: null, sMM: 0, sRad: 0, v: 0, w: 0, t: 0, lost: 99 });
  var gest = { on: false, toStage: null, msg: '', n: 0, H: { inner: newHand(), outer: newHand() }, stream: null, lm: null, raf: 0, lastT: -1 };
  const gMsg = (t) => { if (gest.msg === t) return; gest.msg = t; if (!tableMode) $('hint').textContent = t; };
  async function loadLandmarker() {
    if (gest.lm) return gest.lm;
    const vision = await import(MP + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
    const make = (delegate) => vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { gest.lm = await make('GPU'); } catch (e) { gest.lm = await make('CPU'); }
    return gest.lm;
  }
  async function startGestures() {
    if (gest.on) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { gMsg('Kamera nur über https'); return; }
    gest.on = true; gMsg('Handerkennung lädt …');
    try {
      gest.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      const v = $('gcam'); v.setAttribute('playsinline', ''); v.muted = true; v.srcObject = gest.stream; await v.play();
      await loadLandmarker();
    } catch (e) { console.warn('Gesten', e); gMsg(e && e.name === 'NotAllowedError' ? 'Kamerazugriff abgelehnt' : 'Handerkennung nicht verfügbar'); stopGestures(true); return; }
    if (!gest.on) return;
    gMsg('Hand zeigen, Daumen und Zeigefinger zusammen = greifen');
    const loop = () => { if (!gest.on) return; gest.raf = requestAnimationFrame(loop); detect(); draw(); };
    loop();
  }
  function stopGestures(keepMsg) {
    gest.on = false; cancelAnimationFrame(gest.raf); releaseGrip(gest.H.inner); releaseGrip(gest.H.outer);
    if (gest.stream) { gest.stream.getTracks().forEach(t => t.stop()); gest.stream = null; }
    const v = $('gcam'); if (v) v.srcObject = null;
    gest.H.inner.pts = gest.H.outer.pts = null; gest.n = 0; if (!keepMsg) { gest.msg = ''; render(); } draw();
  }
  function releaseGrip(st) { if (st.grip) { st.grip = false; flush(); buzz(6); } st.last = null; st.roll = null; st.v = 0; st.w = 0; }
  function detect() {
    const v = $('gcam'); if (!gest.lm || v.readyState < 2 || v.currentTime === gest.lastT) return;
    gest.lastT = v.currentTime;
    let res; try { res = gest.lm.detectForVideo(v, performance.now()); } catch (e) { return; }
    onHands((res && res.landmarks) || []);
  }
  // Das äußere Instrument zum aktiven: das nächst äußere eingeführte, kein Draht.
  function outerIndex() {
    if (!status) return -1; const a = status.devices[status.active]; if (!a) return -1; let best = -1;
    status.devices.forEach((d, i) => { if (i !== status.active && d.inserted && !d.wire && d.rank < a.rank && (best < 0 || d.rank > status.devices[best].rank)) best = i; });
    return best;
  }
  const isCarotidStent = (a) => a && a.inserted && a.kind === 'stent' && a.od >= 1 && a.implant > 0 && a.deployed < 0.999;
  // Zwei Hände nur, wo es am Tisch zwei Hände braucht: Karotisstent-Applikator zurückziehen, oder ein
  // Retriever/Flow-Diverter/Stent liegt an der Mikrokatheterspitze und wird durch Rückzug freigesetzt.
  function twoHand() {
    if (!status) return null; const a = status.devices[status.active];
    if (isCarotidStent(a)) return { kind: 'sheath', outer: status.active };
    if (!a || !a.inserted || a.deployed >= 0.999 || !(a.kind === 'stentRetriever' || a.kind === 'flowDiverter' || (a.kind === 'stent' && a.od < 1))) return null;
    const oi = outerIndex(), o = status.devices[oi]; if (!o) return null;
    return a.ins >= o.ins - 20 || a.deployed > 0.01 ? { kind: 'unsheath', outer: oi } : null;
  }
  // Landmarken: 0 Handgelenk, 4 Daumenspitze, 8 Zeigefingerspitze, 5/17 Grundgelenke Zeige-/Kleinfinger, 9 Mittelfinger.
  // Das Bild ist gespiegelt; x wird deshalb gespiegelt gelesen.
  function onHand(h) { onHands(h ? [h] : []); }
  function onHands(list) {
    let hands = list.map(h => h.map(q => [1 - q.x, q.y])).sort((p, q) => ((p[4][0] + p[8][0]) - (q[4][0] + q[8][0])));
    const two = twoHand();
    // Sonst zählt nur eine Hand: die, die schon geführt hat (nächste zum letzten Griffpunkt), sonst die rechte.
    if (!two && hands.length > 1) {
      const ref = gest.H.inner.sm; const mid = (h) => [(h[4][0] + h[8][0]) / 2, (h[4][1] + h[8][1]) / 2];
      hands = [ref ? hands.slice().sort((p, q) => Math.hypot(mid(p)[0] - ref[0], mid(p)[1] - ref[1]) - Math.hypot(mid(q)[0] - ref[0], mid(q)[1] - ref[1]))[0] : hands[hands.length - 1]];
    }
    gest.n = hands.length; gest.two = two;
    const roles = hands.length >= 2 ? { outer: hands[0], inner: hands[1] } : { inner: hands[0] || null, outer: null };
    const m = { inner: track(gest.H.inner, roles.inner), outer: track(gest.H.outer, roles.outer) };
    meter(gest.H.inner.pts ? gest.H.inner.pinch : null);
    const a = status && status.devices[status.active], In = gest.H.inner, Out = gest.H.outer;
    if (!In.pts && !Out.pts) { gMsg('keine Hand im Bild'); }
    else if (two && two.kind === 'sheath') gMsg(gest.n < 2 ? 'Zwei Hände: rechts Stent halten, links Applikator zurückziehen' : In.grip ? (Out.grip ? 'Stent gehalten – links den Applikator zurückziehen' : 'Stent gehalten – links den Applikator greifen') : 'rechts den Stent halten (greifen)');
    else if (two) { const o = status.devices[two.outer]; gMsg(gest.n < 2 ? `Zwei Hände: rechts ${a.name} halten, links ${o.name} zurückziehen` : In.grip ? (Out.grip ? `${a.name} gehalten – ${o.name} zurückziehen` : `${a.name} gehalten – links ${o.name} greifen`) : `rechts ${a.name} halten (greifen)`); }
    else gMsg(In.grip ? 'greift – links/rechts schieben, Handgelenk drehen = torquen' : 'offen – Daumen und Zeigefinger zusammen = greifen');
    if (m.inner.mm || m.inner.rad) { acc.mm += m.inner.mm; acc.rad += m.inner.rad; feelAdvance(m.inner.mm); }
    if (m.outer.mm || m.outer.rad) {
      if (isCarotidStent(a)) { if (In.grip && m.outer.mm < 0) send({ t: 'sheath', i: status.active, mm: +(-m.outer.mm).toFixed(2) }); feelAdvance(m.outer.mm); }
      else if (two) { accO.i = two.outer; accO.mm += m.outer.mm; accO.rad += m.outer.rad; feelAdvance(m.outer.mm); }
    }
    if (!flushTimer && (acc.mm || acc.rad || accO.mm || accO.rad)) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 40);
  }
  function track(st, h) {
    const none = { mm: 0, rad: 0 };
    if (!h) { if (++st.lost > 6) { releaseGrip(st); st.pts = null; st.sm = null; } return none; }
    const fresh = st.lost > 6; st.lost = 0;
    const palm = Math.hypot(h[0][0] - h[9][0], h[0][1] - h[9][1]) || 0.1;
    const pinch = Math.hypot(h[4][0] - h[8][0], h[4][1] - h[8][1]) / palm;
    const g = [(h[4][0] + h[8][0]) / 2, (h[4][1] + h[8][1]) / 2];
    // Springt die Rolle auf die andere Hand (eine Hand verschwindet), nicht als Bewegung werten
    const jump = !st.sm || fresh || Math.hypot(g[0] - st.sm[0], g[1] - st.sm[1]) > 0.12;
    const k = cfg.gSmooth; st.sm = jump ? g : [st.sm[0] * k + g[0] * (1 - k), st.sm[1] * k + g[1] * (1 - k)];
    const roll = Math.atan2(h[17][1] - h[5][1], h[17][0] - h[5][0]);
    st.pts = h; st.pinch = pinch;
    if (jump && st.grip) { st.last = st.sm.slice(); st.roll = roll; }
    const want = st.grip ? pinch < cfg.grip * 1.5 : pinch < cfg.grip;   // Hysterese
    if (want && !st.grip) { st.grip = true; st.last = st.sm.slice(); st.roll = roll; st.sMM = 0; st.sRad = 0; st.v = 0; st.w = 0; st.t = performance.now(); buzz(10); }
    else if (!want && st.grip) releaseGrip(st);
    if (!st.grip) return none;
    const dx = st.sm[0] - st.last[0]; st.last = st.sm.slice();
    let dr = roll - st.roll; if (dr > Math.PI) dr -= 2 * Math.PI; if (dr < -Math.PI) dr += 2 * Math.PI; st.roll = roll;
    // Bildbreite ≈ 40 cm Handweg: grob 1 : 0,6, fein 1 : 0,15; Drehung 1 : 1,5
    const mm = Math.abs(dx) > 0.0015 ? -dx * (fine ? 60 : 240) * cfg.gPush * (cfg.gInv ? -1 : 1) : 0;
    const rad = Math.abs(dr) > 0.012 ? dr * 1.5 * cfg.gTwist : 0;
    const now = performance.now(), dt = Math.max(0.016, (now - (st.t || now)) / 1000); st.t = now;
    st.v = st.v * 0.8 + (mm / dt) * 0.2; st.w = st.w * 0.8 + (rad / dt) * 0.2;
    st.sMM += mm; st.sRad += rad;
    return { mm, rad };
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && gest.on) stopGestures(); else if (!document.hidden && link && cfg.mode === 'gest' && !gest.on) startGestures(); });

  // ---------- Menü ----------
  const SL = { sSwipe: ['swipe', v => '×' + v.toFixed(2)], sHapStr: ['hapStr', v => '×' + v.toFixed(1)], sGrip: ['grip', v => v.toFixed(2)],
    sGPush: ['gPush', v => '×' + v.toFixed(2)], sGTwist: ['gTwist', v => '×' + v.toFixed(2)], sGSmooth: ['gSmooth', v => Math.round(v * 100) + ' %'] };
  const SW = { sSound: 'sound', sHap: 'haptic', sHapPush: 'hapPush', sGInv: 'gInv', sGPrev: 'gPrev' };
  function meter(p) {
    if (!$('menu').classList.contains('on')) return;
    const full = 0.8;   // Balken: 0 = Finger zusammen … 0,8 Handflächen = weit offen
    $('mPinch').style.width = p == null ? '0' : Math.min(100, p / full * 100) + '%'; $('mPinch').className = gest.H.inner.grip ? 'grip' : '';
    $('vPinch').textContent = p == null ? (gest.on ? 'keine Hand' : 'aus') : p.toFixed(2);
  }
  function syncMenu() {
    for (const [id, [k, fmt]] of Object.entries(SL)) { $(id).value = cfg[k]; $('v' + id.slice(1)).textContent = fmt(+cfg[k]); }
    for (const [id, k] of Object.entries(SW)) $(id).checked = !!cfg[k];
    for (const b of $('mMode').querySelectorAll('button')) b.className = b.dataset.mode === cfg.mode ? 'on' : '';
    $('mThr').style.left = Math.min(100, cfg.grip / 0.8 * 100) + '%';
    $('hapNote').textContent = canVibrate ? '' : 'iPhone: vibriert beim Antippen der Knöpfe; beim Wischen und im Gestenmodus ersetzt der Bass-Ton die Vibration.';
    const b = window.CATHSIM_BUILD; $('mBuild').textContent = b ? `Build ${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)} ${b.slice(8, 10)}:${b.slice(10, 12)}` : 'Build lokal';
    meter(null);
  }
  for (const id of Object.keys(SL)) $(id).addEventListener('input', () => { cfg[SL[id][0]] = +$(id).value; saveCfg(); syncMenu(); });
  for (const id of Object.keys(SW)) $(id).addEventListener('change', () => { cfg[SW[id]] = $(id).checked; saveCfg(); unlockAudio(); syncMenu(); });
  $('menu').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (e.target === $('menu') || (b && b.id === 'mDone')) { $('menu').classList.remove('on'); return; }
    if (!b) return;
    if (b.dataset.mode) { cfg.mode = b.dataset.mode; saveCfg(); if (cfg.mode === 'gest') startGestures(); else stopGestures(); syncMenu(); }
    else if (b.id === 'mReset') { const mode = cfg.mode; cfg = Object.assign({}, DEF, { mode }); saveCfg(); syncMenu(); }
  });
  $('bMenu').addEventListener('click', () => { syncMenu(); $('menu').classList.add('on'); });
  window.CathSimGest = { onHand, onHands, gest, deck: () => deckGeom };
  // iPhone: Safari vibriert nur, wenn der Finger selbst einen echten Schalter trifft. Unter jeden
  // Knopf kommt deshalb ein unsichtbarer Schalter; der Tipp schaltet ihn (Impuls) und geht als
  // Klick weiter an den Knopf.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function underlaySwitch(el) { if (!isIOS || el.querySelector('.hx')) return; const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); i.className = 'hx'; i.tabIndex = -1; i.setAttribute('aria-hidden', 'true'); el.appendChild(i); }
  function underlayAll() { if (cfg.haptic) document.querySelectorAll('#app .tiles button, #app .stepper button, #app #hold').forEach(underlaySwitch); }
  underlayAll();

  // Kleber: gedrückt halten, er fließt langsam und kontinuierlich (0,1 ml/s)
  let glueTimer = null;
  const glueStop = () => { clearInterval(glueTimer); glueTimer = null; $('bGlue').classList.remove('lit'); };
  $('bGlue').addEventListener('pointerdown', () => { if (glueTimer || !status) return; $('bGlue').classList.add('lit'); send({ t: 'glue', ml: 0.01 }); glueTimer = setInterval(() => { send({ t: 'glue', ml: 0.01 }); }, 100); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('bGlue').addEventListener(ev, glueStop));

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !status) return; const d = b.dataset;
    if (d.dev !== undefined) { const i = +d.dev; if (coupling && i !== status.active && status.devices[i].inserted) { partner = i; coupling = false; } else { if (partner === i) partner = null; coupling = false; flush(); send({ t: 'sel', i }); if (i !== status.active) { status.active = i; pendingSel = { i, t: performance.now() }; MOT = {}; } } render(); return; }
    if (d.shape !== undefined) { send({ t: 'shape', i: status.active, deg: +d.shape }); return; }
    if (d.lao || d.cra || d.fov) { const c = status.carm || { lao: 0, cranial: 0, fov: 220 }; send({ t: 'carm', lao: c.lao + (+(d.lao || 0)), cra: c.cranial + (+(d.cra || 0)), fov: c.fov + (+(d.fov || 0)) }); return; }
    switch (b.id) {
      case 'bCouple': if (partner !== null || coupling) { partner = null; coupling = false; } else coupling = true; render(); break;
      case 'bWithdraw': send({ t: 'wd', i: status.active }); break;
      case 'bFine': fine = !fine; lbl('bFine', fine ? 'fein' : 'grob'); b.className = 'tile ' + (fine ? 'lit' : ''); break;
      case 'bTable': tableMode = !tableMode; b.className = 'tile ' + (tableMode ? 'lit' : ''); stage.className = tableMode ? 'table' : ''; $('hint').textContent = tableMode ? 'Tisch fahren: Wischen verschiebt den Patienten' : 'nach links = vor · senkrecht torquen · zwei Finger = Tisch'; break;
      case 'bFluoro': send({ t: 'act', a: 'fluoro' }); break;
      case 'bKM': send({ t: 'act', a: 'km' }); break;
      case 'bDSA': send({ t: 'act', a: 'dsa' }); break;
      case 'bRoad': send({ t: 'act', a: 'road' }); break;
      case 'bRot': send({ t: 'act', a: 'rot' }); break;
      case 'bInflate': send({ t: 'act', a: 'inflate' }); break;
      case 'bDeflate': send({ t: 'act', a: 'deflate' }); break;
      case 'bAsp': send({ t: 'act', a: 'asp' }); break;
      case 'bDetach': send({ t: 'act', a: 'detach' }); break;
      case 'bCenter': send({ t: 'act', a: 'center' }); break;
    }
    buzz(8);
  });
})();
