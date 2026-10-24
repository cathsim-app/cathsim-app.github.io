// CT-gesteuerte Interventionen in der Station: Fälle, Material, Bild mit Artefakten, Nadel,
// Dreischuss – gesteuert von Tastatur, Maus und Handy. Die Schichten kommen aus dem
// Ganzkörper-CT der Station (ct_body.vol); der Herd ist synthetisch.
window.CathSimCT = (() => {
  const $ = (id) => document.getElementById(id);
  const MODULE = 'DeGIR Modul D · Nichtvaskuläre Verfahren';
  const CASES = [
    { id: 'ct_liver_biopsy', ct: true, domain: 'CT-Intervention', module: MODULE, playable: true, symbol: 'target',
      title: 'CT-gesteuerte Leberbiopsie', targetSegment: '',
      brief: 'Rundherd im rechten Leberlappen, 2 cm, hypodens. Zugang von rechts anterolateral in Atemstillstand, Koaxialnadel 17 G, Biopsie 18 G. Lagekontrolle mit dem Dreischuss.',
      steps: ['Planungsschicht wählen, Einstich auf der Haut und Ziel im Herd festlegen', 'Einstechen – der erste Dreischuss zeigt, wie die Nadel liegt', 'Blind in 5-mm-Schritten vorschieben, bei Bedarf kippen', 'Dreischuss: drei 3-mm-Schichten um die Spitze – liegt die Nadel in der Ebene?', 'Richtung korrigieren, bis die Spitze im Herd liegt', 'Biopsie entnehmen'],
      notes: ['Rippe und Pleura meiden – der Weg soll kurz und in der Schicht liegen.', 'Jeder Dreischuss kostet Dosis: lieber ein guter Plan als viele Kontrollen.'],
      recommended: ['coax17_10', 'biop18_16'], lesion: { x: -75, y: -100, z: 25, r: 11 }, y0: -100, source: '' },
    { id: 'ct_liver_biopsy_dome', ct: true, domain: 'CT-Intervention', module: MODULE, playable: true, symbol: 'target',
      title: 'Leberbiopsie – Herd unter dem Zwerchfell', targetSegment: '',
      brief: 'Kleiner Herd hoch im rechten Leberlappen, 1,4 cm, nahe der Zwerchfellkuppel. Ein Zugang in der Schicht geht an der Lunge vorbei nur von kaudal angewinkelt – oder tief in der Schicht mit langem Weg.',
      steps: ['Planungsschicht und Weg so wählen, dass die Lungenbasis nicht durchstochen wird', 'Einstechen, erster Dreischuss', 'Blind vorschieben, bei Bedarf nach kranial kippen', 'Dreischuss: Spitze in der Ebene halten', 'Biopsie entnehmen'],
      notes: ['Transpulmonaler Weg: Pneumothoraxgefahr.', 'Die Nadel weicht beim Vorschieben ab – nach jedem Zentimeter prüfen.'],
      recommended: ['coax17_15', 'biop18_16'], lesion: { x: -60, y: -72, z: 35, r: 7 }, y0: -78, source: '' },
  ];
  const MATERIAL = [
    { id: 'coax17_10', vendor: 'Argon', product: 'Koaxialnadel 17 G', variant: '10 cm', cat: 'Nadeln', kind: 'needle', short: 'Koaxial 17 G × 10 cm', name: 'Koaxialnadel 17 G × 10 cm', desc: 'Führungsnadel mit Mandrin; durch sie geht die 18-G-Biopsienadel', len: 100, g: 17 },
    { id: 'coax17_15', vendor: 'Argon', product: 'Koaxialnadel 17 G', variant: '15 cm', cat: 'Nadeln', kind: 'needle', short: 'Koaxial 17 G × 15 cm', name: 'Koaxialnadel 17 G × 15 cm', desc: 'Führungsnadel mit Mandrin; für tiefe Herde', len: 150, g: 17 },
    { id: 'biop18_16', vendor: 'Bard', product: 'Biopsiepistole 18 G', variant: '16 cm', cat: 'Nadeln', kind: 'needle', short: 'Biopsie 18 G × 16 cm', name: 'Biopsiepistole 18 G × 16 cm', desc: 'halbautomatische Stanze, Probe 2 cm', len: 160, g: 18 },
    { id: 'chiba22_15', vendor: 'Cook', product: 'Chiba 22 G', variant: '15 cm', cat: 'Nadeln', kind: 'needle', short: 'Chiba 22 G × 15 cm', name: 'Chiba 22 G × 15 cm', desc: 'feine Nadel für die Zytologie und zur Markierung', len: 150, g: 22 },
  ];

  // ---- Volumen ----
  let VOL = null, loading = null;
  async function load() {
    if (VOL) return VOL;
    if (!loading) loading = (async () => {
      const url = 'ct_body.vol' + (window.CATHSIM_BUILD ? '?v=' + window.CATHSIM_BUILD : '');
      const buf = await (await fetch(url, { cache: 'default' })).arrayBuffer();
      const dv = new DataView(buf);
      const n = [dv.getInt32(4, true), dv.getInt32(8, true), dv.getInt32(12, true)];
      const f = [0, 1, 2, 3, 4, 5].map(i => dv.getFloat32(16 + 4 * i, true));
      VOL = { n, org: [f[0], f[1], f[2]], sp: [f[3], f[4], f[5]], data: new Uint8Array(buf, 40, n[0] * n[1] * n[2]) };
      return VOL;
    })();
    return loading;
  }
  const raw = (i, j, k) => { const [nx, ny, nz] = VOL.n; return (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? 0 : VOL.data[(k * ny + j) * nx + i]; };
  const sample = (x, y, z) => {
    const fi = (x - VOL.org[0]) / VOL.sp[0], fk = (z - VOL.org[2]) / VOL.sp[2], j = Math.round((y - VOL.org[1]) / VOL.sp[1]);
    const i0 = Math.floor(fi), k0 = Math.floor(fk), ti = fi - i0, tk = fk - k0;
    return (raw(i0, j, k0) * (1 - ti) + raw(i0 + 1, j, k0) * ti) * (1 - tk) + (raw(i0, j, k0 + 1) * (1 - ti) + raw(i0 + 1, j, k0 + 1) * ti) * tk;
  };
  // Die Werte sind Dichte über Wasser (≈ HU/8, unter null geklippt): Fett und Luft sind beide 0.
  const HU = (v) => v <= 0.3 ? -120 : v * 8;
  const WIN = { soft: [400, 40], lung: [1500, -600], bone: [1800, 400] };

  // ---- Zustand ----
  // Phasen: Planung (Schicht, Einstich, Ziel) → Einstechen (Nadel 8 mm in der Haut, erster Dreischuss)
  // → blindes Vorschieben, Kippen → Dreischuss → Biopsie. Nach dem Einstechen zeigt das große Bild
  // immer den letzten Dreischuss; die wahre Spitzenlage sieht man erst wieder beim nächsten.
  const ST = { on: false, sc: null, ys: -100, entry: null, target: null, path: [], phi: 0, psi: 0, shots: 0, dlp: 0, t0: 0, done: false, win: 'soft', msg: '', cls: '', shotMsg: '', shotCls: '', drift: 1, dirty: true, lastShot: null, needleLen: 100, dangers: 0, stuck: false, sinceShot: 0, showPlan: false, anim: null, miniRect: null };
  const tip = () => ST.path.length ? ST.path[ST.path.length - 1] : null;
  const needleLen = () => { let l = 0; for (let i = 1; i < ST.path.length; i++) l += Math.hypot(ST.path[i][0] - ST.path[i - 1][0], ST.path[i][1] - ST.path[i - 1][1], ST.path[i][2] - ST.path[i - 1][2]); return l; };
  const outside = () => Math.max(0, ST.needleLen - needleLen());
  const dist = (p) => { const L = ST.sc.lesion; return Math.hypot(p[0] - L.x, p[1] - L.y, p[2] - L.z); };
  // Geplante Richtung in der Schicht, gedreht um die Abweichung psi, die beim Einstechen entstand
  const planDir = () => { const dx = ST.target[0] - ST.entry[0], dz = ST.target[1] - ST.entry[1], l = Math.hypot(dx, dz) || 1, c = Math.cos(ST.psi), sn = Math.sin(ST.psi); return [(dx * c - dz * sn) / l, (dx * sn + dz * c) / l]; };

  // ---- Bild ----
  let imgCache = {};
  const grey = (v) => { const [w, l] = WIN[ST.win] || WIN.soft; return Math.max(0, Math.min(255, (HU(v) - (l - w / 2)) / w * 255)); };
  function sliceImage(y, cx, cz, ext, size, seed) {
    const key = `${ST.win}|${y.toFixed(1)}|${cx.toFixed(1)}|${cz.toFixed(1)}|${ext}|${size}|${seed}`; if (imgCache[key]) return imgCache[key];
    const img = new ImageData(size, size), d = img.data, s = size / (2 * ext), L = ST.sc.lesion;
    let rnd = seed * 9301 + 49297; const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
    const bone = [];
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = cx + (px - size / 2) / s, z = cz - (py - size / 2) / s;
      const v = sample(x, y, z); let g = grey(v);
      if (v > 40 && ((px + py) & 7) === 0) bone.push([px, py]);
      const dl = Math.hypot(x - L.x, y - L.y, z - L.z); if (dl < L.r + 1 && v > 3) g = grey(v * 0.72 + 0.3 * Math.max(0, Math.min(1, (dl - L.r + 1) / 2)));
      // Rauschen: Quantenrauschen, im Körperinneren stärker (mehr Schwächung)
      const inside = v > 0.3 ? 1.6 : 0.6; g += (rand() + rand() - 1) * 9 * inside;
      const o = (py * size + px) * 4; d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, g)); d[o + 3] = 255;
    }
    // Aufhärtungsstreifen zwischen dichten Knochen: dunkle Linien zwischen entfernten Knochenpunkten
    if (bone.length > 20) {
      for (let k = 0; k < 26; k++) {
        const a = bone[Math.floor(rand() * bone.length)], b = bone[Math.floor(rand() * bone.length)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < size * 0.25) continue;
        const nsteps = Math.ceil(len); const amp = 4 + rand() * 5;
        for (let q = 0; q <= nsteps; q++) { const t = q / nsteps, px = Math.round(a[0] + (b[0] - a[0]) * t), py = Math.round(a[1] + (b[1] - a[1]) * t); const o = (py * size + px) * 4; const gg = Math.max(0, d[o] - amp * Math.sin(Math.PI * t)); d[o] = d[o + 1] = d[o + 2] = gg; }
      }
    }
    if (Object.keys(imgCache).length > 30) imgCache = {};
    imgCache[key] = img; return img;
  }
  // Nadel in einer Schicht: nur die Stücke, die in der 3-mm-Schicht liegen – mit Metallartefakt.
  function drawNeedle(c, ys, P, pxPerMm, full) {
    const t = tip(); if (!t) return;
    c.lineCap = 'round';
    const segs = [];
    for (let i = 1; i < ST.path.length; i++) {
      const a = ST.path[i - 1], b = ST.path[i];
      let t0 = 0, t1 = 1;
      if (!full) {
        const ya = a[1] - ys, yb = b[1] - ys;
        if (Math.abs(yb - ya) < 1e-9) { if (Math.abs(ya) > 1.5) continue; }
        else { const tA = (1.5 - ya) / (yb - ya), tB = (-1.5 - ya) / (yb - ya); t0 = Math.max(0, Math.min(tA, tB)); t1 = Math.min(1, Math.max(tA, tB)); }
        if (t1 <= t0) continue;
      }
      segs.push([P(a[0] + (b[0] - a[0]) * t0, a[2] + (b[2] - a[2]) * t0), P(a[0] + (b[0] - a[0]) * t1, a[2] + (b[2] - a[2]) * t1)]);
    }
    if (!segs.length) return;
    // Metallartefakt: dunkle und helle Strahlen entlang der Nadelrichtung über die Spitze hinaus
    const last = segs[segs.length - 1], dx = last[1][0] - last[0][0], dy = last[1][1] - last[0][1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const tipIn = !full ? Math.abs(t[1] - ys) <= 1.5 : true;
    if (tipIn) {
      for (const [ang, col, w, len] of [[0, 'rgba(0,0,0,.35)', 2.2, 28], [0.1, 'rgba(255,255,255,.18)', 1, 22], [-0.1, 'rgba(255,255,255,.18)', 1, 22], [0.22, 'rgba(0,0,0,.14)', 1.2, 18], [-0.22, 'rgba(0,0,0,.14)', 1.2, 18]]) {
        const ca = Math.cos(ang), sa = Math.sin(ang), vx = ux * ca - uy * sa, vy = ux * sa + uy * ca;
        c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(last[1][0], last[1][1]); c.lineTo(last[1][0] + vx * len * pxPerMm, last[1][1] + vy * len * pxPerMm); c.stroke();
        c.beginPath(); c.moveTo(segs[0][0][0], segs[0][0][1]); c.lineTo(segs[0][0][0] - vx * len * 0.6 * pxPerMm, segs[0][0][1] - vy * len * 0.6 * pxPerMm); c.stroke();
      }
    }
    for (const [p0, p1] of segs) {
      c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 2.4 * pxPerMm + 3; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = Math.max(1.6, 1.3 * pxPerMm); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
    }
    if (tipIn) { const q = P(t[0], t[2]); c.fillStyle = '#fff'; c.beginPath(); c.arc(q[0], q[1], Math.max(1.5, 1.1 * pxPerMm), 0, Math.PI * 2); c.fill(); }
  }
  const FONT = '-apple-system, "SF Pro Text", sans-serif', MONO = '"SF Mono", Menlo, monospace';
  const fmtY = (y) => y.toFixed(1).replace('-', '−');
  const winLabel = () => ST.win === 'soft' ? 'W 400 / L 40' : ST.win === 'lung' ? 'W 1500 / L −600' : 'W 1800 / L 400';
  // Planungsschicht: Einstich, Ziel und geplante Linie – ohne Nadel. Groß in der Planung, später als Miniatur.
  function drawPlan(c, ox, oy, size, big) {
    const ext = 230, s = size / (2 * ext), px = Math.min(460, Math.round(size));
    const off = document.createElement('canvas'); off.width = px; off.height = px;
    off.getContext('2d').putImageData(sliceImage(ST.ys, 0, 0, ext, px, 1), 0, 0);
    c.drawImage(off, ox, oy, size, size);
    const P = (x, z) => [ox + size / 2 + x * s, oy + size / 2 - z * s];
    if (big) {
      c.font = '600 11px ' + FONT; c.fillStyle = 'rgba(255,255,255,.6)';
      c.textAlign = 'left'; c.fillText('R', ox + 10, oy + size / 2 + 4); c.textAlign = 'right'; c.fillText('L', ox + size - 10, oy + size / 2 + 4);
      c.textAlign = 'center'; c.fillText('ANTERIOR', ox + size / 2, oy + 16);
    }
    if (ST.entry) { const q = P(ST.entry[0], ST.entry[1]); c.strokeStyle = '#0a84ff'; c.lineWidth = big ? 2 : 1.5; c.beginPath(); c.arc(q[0], q[1], big ? 6 : 4, 0, Math.PI * 2); c.stroke(); }
    if (ST.entry && ST.target) {
      const a = P(ST.entry[0], ST.entry[1]), b = P(ST.target[0], ST.target[1]);
      c.setLineDash([5, 5]); c.strokeStyle = 'rgba(10,132,255,.9)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]);
      c.strokeStyle = '#ff9f0a'; c.lineWidth = big ? 2 : 1.5; c.beginPath(); c.arc(b[0], b[1], big ? 5 : 3.5, 0, Math.PI * 2); c.stroke();
    }
  }
  // Nadel von außen, wie man sie am Patienten sieht: Haut, Schaft, Ansatz – nur die Länge außerhalb
  // ändert sich beim Vorschieben. Wohin die Spitze innen läuft, zeigt erst der Dreischuss.
  function drawNeedleOutside(c, x0, y0, w, h, now) {
    c.fillStyle = 'rgba(28,28,30,.92)'; c.beginPath(); c.roundRect(x0, y0, w, h, 12); c.fill();
    let out = outside();
    if (ST.anim) { const u = Math.min(1, (now - ST.anim.t0) / 300); const e = 1 - Math.pow(1 - u, 3); out = ST.anim.from + (ST.anim.to - ST.anim.from) * e; if (u >= 1) ST.anim = null; else ST.dirty = true; }
    const pad = 14, skinY = y0 + h - 46, scale = Math.min(1.3, (h - 76) / (Math.max(ST.needleLen, 60) * 0.906));
    // Haut: Linie mit leichter Wölbung, darunter Gewebe
    c.fillStyle = 'rgba(118,118,128,.18)'; c.fillRect(x0 + pad, skinY, w - 2 * pad, 46 - pad);
    c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x0 + pad, skinY); c.quadraticCurveTo(x0 + w / 2, skinY - 4, x0 + w - pad, skinY); c.stroke();
    // Nadel schräg von rechts oben; der Teil im Körper ist nur angedeutet (gestrichelt), ohne Richtung
    const ang = -65 * Math.PI / 180, ex = x0 + w * 0.36, ey = skinY, ux = Math.cos(ang), uy = Math.sin(ang);
    const hx = ex + ux * out * scale, hy = ey + uy * out * scale;
    if (ST.stuck) { c.setLineDash([3, 4]); c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - ux * 14, ey - uy * 14); c.stroke(); c.setLineDash([]); }
    c.strokeStyle = '#e5e5ea'; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(ex, ey); c.lineTo(hx, hy); c.stroke();
    // Ansatz (Hub) als kleines Rechteck quer zum Schaft
    c.save(); c.translate(hx, hy); c.rotate(ang); c.fillStyle = '#0a84ff'; c.beginPath(); c.roundRect(0, -6, 16, 12, 3); c.fill(); c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(16, -4, 6, 8); c.restore();
    c.font = '600 10px ' + FONT; c.fillStyle = 'rgba(235,235,245,.6)'; c.textAlign = 'left'; c.fillText(`NADEL VON AUSSEN · ${ST.needleLen} mm`, x0 + pad, y0 + 18);
    c.font = '12px ' + MONO; c.fillStyle = '#fff'; c.textAlign = 'right'; c.fillText(`außerhalb noch ${Math.round(out)} mm`, x0 + w - pad, y0 + h - 16);
  }
  // Der letzte Dreischuss, groß: drei Schichten nebeneinander um die Spitze von damals.
  function drawShots(c, x0, y0, wAvail, hAvail) {
    const gap = 10, sz = Math.floor(Math.min((wAvail - 2 * gap) / 3, hAvail)); if (sz < 40) return;
    const ext2 = 60, px = Math.min(400, Math.round(sz)); const shot = ST.lastShot, cx = shot.cx, cz = shot.cz;
    const oy = y0 + (hAvail - sz) / 2, ox0 = x0 + (wAvail - (3 * sz + 2 * gap)) / 2;
    for (const [i, dy] of [[0, -3], [1, 0], [2, 3]]) {
      const ox = ox0 + i * (sz + gap), y = shot.y + dy;
      const off = document.createElement('canvas'); off.width = px; off.height = px;
      off.getContext('2d').putImageData(sliceImage(y, cx, cz, ext2, px, 7 + i), 0, 0);
      c.save(); c.beginPath(); c.roundRect(ox, oy, sz, sz, 10); c.clip(); c.drawImage(off, ox, oy, sz, sz);
      const s2 = sz / (2 * ext2), P2 = (x, z) => [ox + sz / 2 + (x - cx) * s2, oy + sz / 2 - (z - cz) * s2];
      const saved = ST.path; ST.path = shot.path; drawNeedle(c, y, P2, s2, false); ST.path = saved;
      c.restore();
      c.strokeStyle = i === 1 ? 'rgba(10,132,255,.8)' : 'rgba(255,255,255,.15)'; c.lineWidth = i === 1 ? 1.5 : 1; c.beginPath(); c.roundRect(ox + 0.5, oy + 0.5, sz - 1, sz - 1, 10); c.stroke();
      c.font = '600 11px ' + FONT; c.fillStyle = 'rgba(255,255,255,.85)'; c.textAlign = 'left'; c.fillText(['kaudal −3 mm', 'Mitte', 'kranial +3 mm'][i], ox + 10, oy + 18);
      c.font = '11px ' + MONO; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText(`y ${fmtY(y)}`, ox + 10, oy + sz - 10);
    }
    c.font = '600 11px ' + FONT; c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText(`${ST.shots}. DREISCHUSS · 3 × 3 mm · ${winLabel()}`, ox0, oy - 10);
  }
  function renderMain() {
    const cv = $('ctCanvas'); if (!cv || !VOL) return;
    const W = cv.clientWidth || 800, H = cv.clientHeight || 600; const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (Math.min(W, H) < 10) { ST.dirty = true; return; }
    const now = performance.now(); ST.miniRect = null;
    const planBig = !ST.stuck || ST.showPlan || !ST.lastShot;
    if (planBig) {
      const size = Math.min(W, H), ox = (W - size) / 2, oy = (H - size) / 2;
      drawPlan(c, ox, oy, size, true);
      c.font = '12px ' + MONO; c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText(`Planungsschicht  y ${fmtY(ST.ys)} mm · 3 mm · ${winLabel()}`, W - 14, 20);
      if (ST.stuck) { c.font = '600 11px ' + FONT; c.textAlign = 'left'; c.fillStyle = '#0a84ff'; c.fillText('PLANUNG – klicken für den Dreischuss', 14, 20); ST.miniRect = [0, 0, W, H]; }
      return;
    }
    // Nach dem Einstechen: oben der letzte Dreischuss so groß wie möglich, darunter links die Nadel
    // von außen und rechts die Miniatur der Planung
    const topH = 46, gap = 10;
    const sz = Math.floor(Math.min((W - 28 - 2 * gap) / 3, H * 0.62)); const rowH = Math.min(260, H - topH - sz - 24);
    const y0 = topH + Math.max(0, (H - topH - sz - 24 - rowH) / 2);
    c.font = '600 12px ' + FONT; c.textAlign = 'left';
    if (ST.sinceShot > 0.5) { c.fillStyle = '#ff9f0a'; c.fillText(`Dreischuss vor ${Math.round(ST.sinceShot)} mm Vorschub – wo die Spitze jetzt liegt, zeigt erst der nächste Dreischuss`, 14, 24); }
    else { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillText(ST.done ? 'Biopsie entnommen.' : 'Aktueller Stand der Nadel – vorschieben, kippen, dann wieder Dreischuss', 14, 24); }
    drawShots(c, 14, y0, W - 28, sz);
    const mini = Math.max(120, rowH), mx = W - 14 - mini, my = y0 + sz + 24;
    drawPlan(c, mx, my, mini, false);
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 1; c.strokeRect(mx + 0.5, my + 0.5, mini - 1, mini - 1);
    c.font = '600 10px ' + FONT; c.fillStyle = 'rgba(255,255,255,.8)'; c.textAlign = 'left'; c.fillText('PLANUNG · antippen', mx + 8, my + 15); c.font = '10px ' + MONO; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText(`y ${fmtY(ST.ys)}`, mx + 8, my + mini - 8);
    ST.miniRect = [mx, my, mini, mini];
    const nw = Math.min(360, mx - 28 - 14), nh = mini; if (rowH > 100 && nw > 160) drawNeedleOutside(c, mx - 14 - nw, my, nw, nh, now);
  }
  function render(force) { if (!ST.on) return; if (!ST.dirty && !force) return; ST.dirty = false; renderMain(); updateSide(); }

  // ---- Seitenleiste ----
  const set = (id, html, cls) => { const el = $(id); if (!el) return; if (el.innerHTML !== html) el.innerHTML = html; if (cls !== undefined) el.className = cls; };
  function updateSide() {
    const planned = !!(ST.entry && ST.target);
    set('ctPlan', !ST.entry ? 'Planungsschicht mit dem Schieber wählen, dann auf die Haut klicken: Einstich.' : (!ST.target ? 'Einstich gesetzt. Jetzt auf den Herd klicken: Ziel.' : (ST.stuck ? (ST.msg || 'Nadel steckt.') : (ST.msg || 'Weg geplant.'))), 'info ' + (ST.cls || ''));
    set('ctStickInfo', !planned ? 'Erst die Planung.' : (ST.stuck ? `Nadel steckt – ${Math.round(outside())} mm außerhalb.` : 'Nadel an der Haut ansetzen und einstechen; der erste Dreischuss folgt sofort.'), 'info');
    set('ctNeedle', ST.stuck ? `Seit dem letzten Dreischuss ${Math.round(ST.sinceShot)} mm bewegt · Richtung ${(ST.phi * 180 / Math.PI).toFixed(0).replace('-', '−')}° ${ST.phi > 0.001 ? 'kranial' : ST.phi < -0.001 ? 'kaudal' : 'in der Ebene'} – wirkt beim weiteren Vorschub` : 'Erst einstechen.', 'info');
    set('ctShotInfo', ST.shotMsg || 'Noch kein Dreischuss.', 'info ' + (ST.shotCls || ''));
    set('ctStats', `<div><b>${ST.shots}</b><span>Dreischüsse</span></div><div><b>${ST.dlp.toFixed(1)}</b><span>DLP mGy·cm</span></div><div><b>${fmtT()}</b><span>Zeit</span></div>`);
    for (const [id, on] of [['ctStick', planned && !ST.stuck && !ST.done], ['ctAdv', ST.stuck && !ST.done], ['ctBack', ST.stuck && ST.path.length > 1 && !ST.done], ['ctUp', ST.stuck && !ST.done], ['ctDown', ST.stuck && !ST.done], ['ctShot', ST.stuck && !ST.done], ['ctBiopsy', ST.stuck && !ST.done]]) { const b = $(id); if (b) b.disabled = !on; }
    const sl = $('ctY'); if (sl) { const v = ST.stuck ? (ST.yShot ?? ST.ys) : ST.ys; if (+sl.value !== v) sl.value = v; } set('ctYInfo', ST.stuck ? `Dreischuss-Mitte y ${fmtY(ST.yShot ?? ST.ys)} mm (Tisch verschieben)` : `Planungsschicht y ${fmtY(ST.ys)} mm`, 'info');
    document.querySelectorAll('#ctWin button').forEach(b => b.classList.toggle('lit', b.dataset.win === ST.win));
    const rp = $('ctResetPlan'); if (rp) rp.disabled = ST.stuck || !ST.entry;
    const el = $('ctDone'); if (el) { el.style.display = ST.done ? '' : 'none'; }
  }
  const fmtT = () => { const s = Math.max(0, Math.round((performance.now() - ST.t0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---- Handlung ----
  function say(msg, cls) { ST.msg = msg; ST.cls = cls || ''; ST.dirty = true; }
  function clickAt(x, z) {
    if (ST.stuck || ST.done) return;
    if (!ST.entry) {
      const v = sample(x, ST.ys, z); let skin = false;
      for (let d = 1.5; d <= 7.5; d += 1.5) for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if ((sample(x + dx, ST.ys, z + dz) > 2) !== (v > 2)) skin = true;
      if (!skin) { say('Der Einstich liegt auf der Haut – auf die Körperkontur klicken.', 'warn'); return; }
      ST.entry = [x, z]; ST.path = [[x, ST.ys, z]]; say('', '');
    } else if (!ST.target) {
      ST.target = [x, z]; const L = ST.sc.lesion;
      const dx = x - ST.entry[0], dz = z - ST.entry[1], len = Math.hypot(dx, dz), ang = Math.atan2(dx, -dz) * 180 / Math.PI;
      const onLesion = Math.hypot(x - L.x, z - L.z) <= L.r + 2 && Math.abs(ST.ys - L.y) <= L.r;
      // Weg durch Luft (Lunge) oder Knochen?
      let air = false, bone = false; for (let q = 0; q <= len; q += 1) { const v = sample(ST.entry[0] + dx / len * q, ST.ys, ST.entry[1] + dz / len * q); if (q > 8 && v <= 0.3) air = true; if (v > 40) bone = true; }
      say(`Weg ${len.toFixed(0)} mm, ${Math.abs(ang).toFixed(0)}° ${ang < 0 ? 'nach rechts' : 'nach links'} von der Senkrechten.` + (onLesion ? '' : ' Das Ziel liegt nicht im Herd.') + (bone ? ' Knochen im Weg.' : '') + (air ? ' Luft im Weg (Lunge oder Darm).' : '') + ' Jetzt einstechen.', onLesion && !bone && !air ? 'ok' : 'warn');
      if (len > ST.needleLen) say(ST.msg + ` Die Nadel ist nur ${ST.needleLen} mm lang.`, 'warn');
    }
    ST.dirty = true;
  }
  // Einstechen: die Nadel kommt 8 mm in die Haut – und nie ganz so, wie geplant. Die Abweichung aus
  // der Ebene (und ein wenig in der Ebene) zeigt der erste Dreischuss, der sofort folgt.
  function stick() {
    if (!(ST.entry && ST.target) || ST.stuck || ST.done) return;
    const sgn = Math.random() < 0.5 ? -1 : 1;
    ST.phi = sgn * (2 + Math.random() * 2) * ST.drift * Math.PI / 180;
    ST.psi = 0; // in der Schicht (tisch-/himmelwärts) bleibt die Nadel auf dem geplanten Weg – trainiert wird kranial/kaudal
    ST.stuck = true; ST.yShot = ST.ys; ST.path = [[ST.entry[0], ST.ys, ST.entry[1]]];
    const from = outside(); step(8); ST.anim = { t0: performance.now(), from, to: outside() };
    say('Nadel steckt 8 mm in der Haut. Der erste Dreischuss zeigt, wie sie liegt.', '');
    shot();
  }
  // Ein Stück vorschieben – mit der Abweichung, die jeder Millimeter im Gewebe bringt
  function step(mm) {
    const t = tip(); const dir = planDir();
    if (needleLen() + mm > ST.needleLen) { say(`Die Nadel ist am Anschlag (${ST.needleLen} mm).`, 'warn'); return false; }
    ST.phi += (Math.random() - 0.5) * (0.35 * mm) * ST.drift * Math.PI / 180;
    const nxt = [t[0] + dir[0] * mm * Math.cos(ST.phi), t[1] + mm * Math.sin(ST.phi), t[2] + dir[1] * mm * Math.cos(ST.phi)];
    for (let q = 1; q <= Math.ceil(mm); q++) { const u = q / Math.ceil(mm); const v = sample(t[0] + (nxt[0] - t[0]) * u, t[1] + (nxt[1] - t[1]) * u, t[2] + (nxt[2] - t[2]) * u);
      if (v > 40) { say(`Harter Widerstand bei ${needleLen().toFixed(0)} mm – Knochen (Rippe). Zurückziehen und den Zugang ändern.`, 'bad'); ST.dangers++; return false; }
      if (v <= 0.3 && needleLen() > 10) { ST.lungHits = (ST.lungHits || 0) + 1; if (ST.lungHits === 1) { say('Die Nadel läuft durch Luft – Lungenbasis oder Darm. Pneumothorax- und Perforationsgefahr.', 'bad'); ST.dangers++; } } }
    ST.path.push(nxt); return true;
  }
  function advance(mm) {
    if (!ST.stuck || ST.done) return;
    const from = outside();
    if (mm < 0) { let back = -mm; while (back > 0 && ST.path.length > 1) { ST.path.pop(); back -= 5; } }
    else { if (!step(mm)) { ST.dirty = true; return; } say(`Vorgeschoben – ${Math.round(needleLen())} mm im Körper. Lage erst im nächsten Dreischuss.`, ''); }
    const to = outside(); ST.sinceShot += Math.abs(to - from);
    ST.anim = { t0: performance.now(), from: ST.anim ? ST.anim.from : from, to };
    ST.dirty = true;
  }
  function tilt(deg) { if (!ST.stuck || ST.done) return; ST.phi += deg * Math.PI / 180; say(`Nadel ${(ST.phi * 180 / Math.PI).toFixed(0).replace('-', '−')}° ${ST.phi > 0.001 ? 'nach kranial' : ST.phi < -0.001 ? 'nach kaudal' : 'in der Ebene'} gerichtet – wirkt beim weiteren Vorschieben.`, ''); ST.dirty = true; }
  function shot() {
    const t = tip(); if (!t || !ST.stuck) return;
    ST.shots++; ST.dlp += 3 * 0.3 * 5.0; ST.sinceShot = 0; ST.showPlan = false;
    // Die drei Schichten liegen um die Tischposition (Schieber), wie am Gerät – wo die Spitze liegt, muss man im Bild suchen.
    const yS = ST.yShot ?? ST.ys;
    ST.lastShot = { y: yS, tip: t.slice(), path: ST.path.map(p => p.slice()), cx: (ST.entry[0] + ST.target[0]) / 2, cz: (ST.entry[1] + ST.target[1]) / 2 };
    const L = ST.sc.lesion, d = dist(t), dy = t[1] - L.y, dS = t[1] - yS, inPlane = Math.abs(dS) <= 1.5;
    const where = inPlane ? 'in der mittleren Schicht' : Math.abs(dS) <= 4.5 ? `in der ${dS > 0 ? 'kranialen' : 'kaudalen'} Schicht` : `in keiner der drei Schichten – ${Math.abs(dS).toFixed(0)} mm ${dS > 0 ? 'kranial' : 'kaudal'} der Mitte`;
    if (d <= L.r) { ST.shotMsg = `Spitze im Herd (${where}). Biopsie möglich.`; ST.shotCls = 'ok'; }
    else { const inPl = Math.hypot(t[0] - L.x, t[2] - L.z); ST.shotMsg = `Spitze ${d.toFixed(0)} mm von der Herdmitte, ${where}` + (inPl > L.r ? `, in der Ebene noch ${Math.max(0, inPl - L.r).toFixed(0)} mm vor dem Herd.` : '.') + (Math.abs(dy) > L.r * 0.6 ? ` Richtung korrigieren: nach ${dy > 0 ? 'kaudal' : 'kranial'} kippen.` : ''); ST.shotCls = Math.abs(dy) > L.r * 0.6 ? 'warn' : ''; }
    ST.dirty = true;
  }
  function biopsy() {
    const t = tip(); if (!t || !ST.stuck) return;
    const d = dist(t);
    if (d <= ST.sc.lesion.r) { ST.done = true; say(`Biopsie aus dem Herd entnommen – ${ST.shots} Dreischüsse, ${needleLen().toFixed(0)} mm Stichkanal, ${fmtT()}.`, 'ok'); if (onDone) onDone({ caseTime: (performance.now() - ST.t0) / 1000, fluoroSeconds: 0, dap: ST.dlp, km: 0, dangers: new Array(ST.dangers).fill(1), completed: true }); }
    else { say(`Die Spitze liegt ${d.toFixed(0)} mm von der Herdmitte – das wäre eine Fehlbiopsie. Lage mit dem Dreischuss prüfen.`, 'bad'); ST.dangers++; }
    ST.dirty = true;
  }
  let onDone = null;

  // ---- Start und Ende ----
  async function start(sc, difficulty, stage, tray, done) {
    onDone = done;
    Object.assign(ST, { on: true, sc, ys: sc.y0, entry: null, target: null, path: [], phi: 0, psi: 0, shots: 0, dlp: 0, t0: performance.now(), done: false, win: 'soft', msg: '', cls: '', shotMsg: '', shotCls: '', lastShot: null, dangers: 0, lungHits: 0, stuck: false, sinceShot: 0, showPlan: false, anim: null, dirty: true });
    ST.drift = [0.6, 1, 1.6, 2.2][difficulty] || 1;
    await load(); if (!ST.on || ST.sc !== sc) return;
    const needles = MATERIAL.filter(m => tray.includes(m.id) && m.g <= 18 && m.product.includes('Koaxial'));
    ST.needleLen = needles.length ? Math.max(...needles.map(m => m.len)) : 100;
    // Startstufe: 1 = Nadel steckt in der Haut (Planung vorgegeben, erster Dreischuss), 2 = Nadel 3 cm tief
    if (stage >= 1) { const L = sc.lesion; ST.entry = sc.entry || findEntry(L); ST.target = [L.x, L.z]; ST.path = [[ST.entry[0], ST.ys, ST.entry[1]]]; stick(); say('Einstich und Ziel sind vorgegeben, die Nadel steckt.', ''); }
    if (stage >= 2) { for (let k = 0; k < 6; k++) advance(5); shot(); ST.anim = null; }
    imgCache = {};
    const sl = $('ctY'); if (sl) { sl.min = sc.y0 - 60; sl.max = sc.y0 + 40; sl.value = sc.y0; }
    ST.dirty = true; render(true);
  }
  // Ein Einstichpunkt rechts anterolateral: von der Läsion nach außen laufen, bis Luft kommt.
  function findEntry(L) { const dir = [-0.55, 0.83]; let x = L.x, z = L.z; for (let q = 0; q < 200; q++) { x += dir[0]; z += dir[1]; if (sample(x, L.y, z) <= 0.3) return [x - dir[0] * 2, z - dir[1] * 2]; } return [L.x - 40, L.z + 50]; }
  function stop() { ST.on = false; ST.lastShot = null; }

  // Bedienung an der Station
  function bind() {
    const cv = $('ctCanvas'); if (!cv || cv.dataset.bound) return; cv.dataset.bound = '1';
    cv.addEventListener('pointerdown', (e) => { if (!ST.on) return; const r = cv.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
      // Nach dem Einstechen: Klick auf die Planungsminiatur zeigt sie groß, Klick ins große Planungsbild zurück
      if (ST.stuck) { const m = ST.miniRect; if (m && px >= m[0] && px <= m[0] + m[2] && py >= m[1] && py <= m[1] + m[3]) { ST.showPlan = !ST.showPlan; ST.dirty = true; render(); } return; }
      const W = r.width, H = r.height, size = Math.min(W, H), s = size / (2 * 230), ox = (W - size) / 2, oy = (H - size) / 2; clickAt((px - ox - size / 2) / s, -(py - oy - size / 2) / s); render(); });
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { fn(); render(); }); };
    on('ctStick', stick); on('ctAdv', () => advance(5)); on('ctBack', () => advance(-5)); on('ctUp', () => tilt(2)); on('ctDown', () => tilt(-2)); on('ctShot', shot); on('ctBiopsy', biopsy);
    on('ctResetPlan', () => { if (ST.stuck) return; ST.entry = null; ST.target = null; ST.path = []; say('', ''); });
    const sl = $('ctY'); if (sl) sl.addEventListener('input', () => { if (ST.stuck) { ST.yShot = +sl.value; ST.dirty = true; render(); return; } ST.ys = +sl.value; if (ST.entry) ST.path = [[ST.entry[0], ST.ys, ST.entry[1]]]; ST.dirty = true; render(); });
    const win = $('ctWin'); if (win) win.addEventListener('click', (e) => { const b = e.target.closest('button[data-win]'); if (!b) return; ST.win = b.dataset.win; imgCache = {}; ST.dirty = true; render(); });
    document.addEventListener('keydown', (e) => { if (!ST.on || e.target.tagName === 'INPUT') return; if (e.key === 'ArrowUp') { advance(5); render(); } else if (e.key === 'ArrowDown') { advance(-5); render(); } else if (e.key === 'ArrowLeft') { tilt(-2); render(); } else if (e.key === 'ArrowRight') { tilt(2); render(); } else if (e.key === ' ') { e.preventDefault(); shot(); render(); } else if (e.key === 'Enter') { stick(); render(); } });
    window.addEventListener('resize', () => { if (ST.on) { ST.dirty = true; render(); } });
  }
  // Vom Handy: Wischen = Nadel in 5-mm-Stufen, Drehen = Kippen, dazu Einstechen, Dreischuss, Biopsie
  function control(m) {
    if (!ST.on) return false;
    if (m.t === 'adv') { ST.acc = (ST.acc || 0) + m.mm; while (ST.acc >= 5) { advance(5); ST.acc -= 5; } while (ST.acc <= -5) { advance(-5); ST.acc += 5; } render(); return true; }
    if (m.t === 'tq') { tilt(m.rad * 180 / Math.PI * 0.5); render(); return true; }
    if (m.t === 'act') { if (m.a === 'ctStick') stick(); else if (m.a === 'ctShot') shot(); else if (m.a === 'ctBiopsy') biopsy(); else if (m.a === 'ctUp') tilt(2); else if (m.a === 'ctDown') tilt(-2); else if (m.a === 'ctBack') advance(-5); else return false; render(); return true; }
    return m.t === 'sheath';
  }
  function status() {
    if (!ST.on) return null;
    const planned = !!(ST.entry && ST.target);
    return { ct: true, title: ST.sc.title, tip: ST.shotMsg || ST.msg || (planned ? (ST.stuck ? 'Nadel vorschieben, Lage mit dem Dreischuss prüfen' : 'Einstechen – der erste Dreischuss folgt sofort') : 'Erst an der Station planen'), depth: needleLen(), phi: ST.phi * 180 / Math.PI, planned, stuck: ST.stuck, sinceShot: Math.round(ST.sinceShot), outside: Math.round(outside()), done: ST.done, shots: ST.shots, dlp: ST.dlp, alert: ST.cls === 'bad' ? { k: 'danger', t: ST.msg } : (ST.shotCls === 'ok' ? { k: 'success', t: ST.shotMsg } : null) };
  }
  return { CASES, MATERIAL, start, stop, render, bind, control, status, get active() { return ST.on; }, get state() { return ST; } };
})();
