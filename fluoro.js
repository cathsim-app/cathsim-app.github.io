// Bildaufbau des Durchleuchtungsbilds — Portierung von FluoroDisplay.swift.
// Alles in normalisierten Detektorkoordinaten (-0.5 … 0.5) × Bildseite.
(function () {
  const CYL = [[1.00, 0.30], [0.86, 0.32], [0.68, 0.34], [0.42, 0.36]];

  // Zwei Rauschkacheln: Struktur (steht still) und Quantenrauschen (flackert).
  function makeNoise(size, octaves, seed) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const grid = [];
    for (let o = 0; o < octaves; o++) {
      const n = 8 << o; const g = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) g[i] = rnd();
      grid.push({ n, g });
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.6, tot = 0;
      for (const { n, g } of grid) {
        const fx = x / size * n, fy = y / size * n;
        const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = g[y0 * n + x0] * (1 - sx) + g[y0 * n + x1] * sx;
        const b = g[y1 * n + x0] * (1 - sx) + g[y1 * n + x1] * sx;
        v += (a * (1 - sy) + b * sy) * amp; tot += amp; amp *= 0.55;
      }
      const gray = Math.round(205 + (v / tot - 0.5) * 60);
      const i = (y * size + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = gray; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return c;
  }
  function makeGrain(size, seed) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
    let s = seed;
    for (let i = 0; i < size * size; i++) {
      s = (s * 1664525 + 1013904223) >>> 0; const u = s / 4294967296;
      s = (s * 1664525 + 1013904223) >>> 0; const v = s / 4294967296;
      const g = Math.round(228 + (u + v - 1) * 34);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return c;
  }
  let texture = null, grains = null, layer = null;
  function layerFor(canvas) { if (!layer || layer.width !== canvas.width || layer.height !== canvas.height) { layer = document.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height; } return layer; }

  function octagon(ctx, f) {
    const c = f.w * 0.16;
    ctx.beginPath();
    ctx.moveTo(f.x + c, f.y); ctx.lineTo(f.x + f.w - c, f.y); ctx.lineTo(f.x + f.w, f.y + c);
    ctx.lineTo(f.x + f.w, f.y + f.h - c); ctx.lineTo(f.x + f.w - c, f.y + f.h); ctx.lineTo(f.x + c, f.y + f.h);
    ctx.lineTo(f.x, f.y + f.h - c); ctx.lineTo(f.x, f.y + c); ctx.closePath();
  }

  function render(canvas, snap, body, opts) {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    let ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!snap) return;
    const side = Math.min(W, H), cx = W / 2, cy = H / 2;
    const f = { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
    const px = (u) => cx + u * side, py = (v) => cy + v * side;
    if (!texture) { texture = makeNoise(256, 3, 7); grains = [0, 1, 2, 3].map(i => makeGrain(180, 99 + i * 31)); }

    const cylinder = true;
    function ribbon(run, scale) {
      const pts = []; for (let i = 0; i < run.p.length; i += 2) pts.push([px(run.p[i]), py(run.p[i + 1])]);
      const n = pts.length; if (n < 2) return null;
      const half = new Array(n), nx = new Array(n), ny = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = run.w[Math.max(i - 1, 0)], b = run.w[i], c = run.w[Math.min(i + 1, n - 1)];
        half[i] = Math.max((a + 2 * b + c) / 4 * side * scale, 0.3) / 2;
      }
      for (let i = 1; i < n - 1; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [qx, qy] = pts[i + 1];
        const area = Math.abs((bx - ax) * (qy - ay) - (by - ay) * (qx - ax)) / 2;
        if (area > 1e-5) { const r = Math.hypot(bx - ax, by - ay) * Math.hypot(qx - bx, qy - by) * Math.hypot(ax - qx, ay - qy) / (4 * area); half[i] = Math.min(half[i], r * 0.9); }
      }
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
        if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
        nx[i] = -dy; ny[i] = dx;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + nx[0] * half[0], pts[0][1] + ny[0] * half[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0] + nx[i] * half[i], pts[i][1] + ny[i] * half[i]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(pts[i][0] - nx[i] * half[i], pts[i][1] - ny[i] * half[i]);
      ctx.closePath();
      return true;
    }
    function polyline(run) {
      ctx.beginPath();
      for (let i = 0; i < run.p.length; i += 2) { const x = px(run.p[i]), y = py(run.p[i + 1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    }
    function avgWidth(run) { let s = 0; for (const w of run.w) s += w; return Math.max(s / run.w.length * side, 0.8); }
    function maxWidth(run) { let m = 0; for (const w of run.w) if (w > m) m = w; return m * side; }
    function strokeRun(run, rgb, alpha, profiled) {
      const w = avgWidth(run);
      if (!profiled || w <= 2.5) {
        polyline(run); ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
        ctx.strokeStyle = `rgba(${rgb},${alpha})`; ctx.stroke(); return;
      }
      for (const [ws, a] of CYL) { if (ribbon(run, ws)) { ctx.fillStyle = `rgba(${rgb},${alpha * a})`; ctx.fill(); } }
    }
    function drawVessels(runs, rgb, scale, multiply, profiled = true) {
      ctx.save(); ctx.globalCompositeOperation = multiply ? 'multiply' : 'source-over';
      for (const r of runs) strokeRun(r, rgb, Math.min(1, r.o * scale), profiled);
      ctx.restore();
    }
    function drawSac(blobs, rgb, scale) {
      if (!blobs.length) return;
      let peak = 0; for (const b of blobs) peak = Math.max(peak, b[3]);
      ctx.save(); ctx.globalAlpha = Math.min(1, peak * scale); ctx.fillStyle = `rgb(${rgb})`;
      ctx.beginPath();
      for (const b of blobs) { const r = b[2] * side; ctx.moveTo(px(b[0]) + r, py(b[1])); ctx.arc(px(b[0]), py(b[1]), r, 0, Math.PI * 2); }
      ctx.fill(); ctx.restore();
    }
    function drawBlush() {
      for (const b of snap.blush) {
        const c = [px(b[0]), py(b[1])], rx = Math.max(b[2] * side, 2), ry = Math.max(b[3] * side, 2), r = Math.max(rx, ry);
        ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = Math.min(0.58, b[4] * 0.55);
        ctx.translate(c[0], c[1]); ctx.scale(rx / r, ry / r);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        if (b[5]) { g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.6, 'rgba(0,0,0,.7)'); g.addColorStop(0.86, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
        else { g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(0.6, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    function drawStructures() {
      drawBlush();
      drawVessels(snap.vessels, '0,0,0', 1.0, true, cylinder);
      drawVessels(snap.veins, '0,0,0', 0.9, true, cylinder);
      if (snap.extra.length) {
        ctx.save(); ctx.globalCompositeOperation = 'multiply';
        for (const b of snap.extra) { ctx.globalAlpha = b[3]; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(px(b[0]), py(b[1]), b[2] * side, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      drawSac(snap.sac, '0,0,0', 0.85);
      drawVessels(snap.falseLumen, '0,0,0', 0.9, true, cylinder);
      for (const r of snap.flap) { polyline(r); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(maxWidth(r), 0.9); ctx.strokeStyle = `rgba(0,0,0,${r.o})`; ctx.stroke(); }
      for (const r of snap.coil) { polyline(r); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(maxWidth(r), 0.8); ctx.strokeStyle = `rgba(0,0,0,${r.o})`; ctx.stroke(); }
      ctx.setLineDash([1.5, 3.5]);
      for (const r of snap.stents) { polyline(r); ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(maxWidth(r), 1); ctx.strokeStyle = 'rgba(0,0,0,.30)'; ctx.stroke(); }
      ctx.setLineDash([]);
      for (const r of snap.devices) {
        const w = Math.max(maxWidth(r), 1.4);
        polyline(r); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = w + 1.6; ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.stroke();
        ctx.lineWidth = w; ctx.strokeStyle = `rgba(0,0,0,${Math.min(1, 0.35 + r.o * 0.6)})`; ctx.stroke();
      }
      for (const m of snap.markers) {
        const len = Math.max(m[3] * side, 1.2), wid = Math.max(m[2] * side, 1.2);
        ctx.save(); ctx.translate(px(m[0]), py(m[1])); ctx.rotate(m[4]);
        if (m[6]) { ctx.strokeStyle = `rgba(0,0,0,${m[5]})`; ctx.lineWidth = Math.max(wid * 0.35, 0.8); ctx.beginPath(); ctx.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
        else { ctx.fillStyle = `rgba(0,0,0,${m[5]})`; ctx.fillRect(-len / 2, -wid / 2, len, wid); }
        ctx.restore();
      }
    }

    ctx.save(); octagon(ctx, f); ctx.clip();
    const base = snap.mode === 'roadmapSub' ? ['#707070', '#4f4f4f'] : (snap.mode === 'dsa' ? ['#e6e6e6', '#e3e3e3'] : ['#ededed', '#dbdbdb']);
    const lg = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y + f.h); lg.addColorStop(0, base[0]); lg.addColorStop(1, base[1]);
    ctx.fillStyle = lg; ctx.fillRect(f.x, f.y, f.w, f.h);
    // Körper als Schwächungsbild, multiplizierend und flau
    if (body && (snap.mode === 'fluoro' || snap.mode === 'roadmapNat')) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.8;
      const s = side * body.coverage; const m0 = body.sid / body.sod;
      // Versatz gegenüber der Tischstellung, für die das Bild gerechnet wurde (wie auf dem Mac: plus).
      const dx = (snap.pan[0] - body.pan[0]) * m0 / snap.fov * side, dy = (snap.pan[1] - body.pan[1]) * m0 / snap.fov * side;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(body.canvas, cx - s / 2 + dx, cy - s / 2 + dy, s, s); ctx.restore();
    }
    if (snap.mode === 'roadmapSub') { drawVessels(snap.roadmap, '247,247,247', 0.95, false, cylinder); drawSac(snap.sacRoadmap, '247,247,247', 1.7); }
    if (snap.mode === 'roadmapNat') { drawVessels(snap.roadmap, '255,255,255', 1.0, false, cylinder); drawSac(snap.sacRoadmap, '255,255,255', 1.8); }
    // Strukturen einmal in eine eigene Ebene zeichnen, dann zweimal auflegen:
    // stark unscharf als Streustrahlenschleier, dann scharf. Ein Weichzeichner je
    // Zug wäre hundertfach teurer als einer je Ebene.
    const L = layerFor(canvas); const lctx = L.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, W, H);
    const main = ctx; ctx = lctx; drawStructures(); ctx = main;
    const canBlur = 'filter' in ctx;
    ctx.save(); if (canBlur) ctx.filter = `blur(${side * 0.018}px)`; ctx.globalAlpha = 0.45; ctx.drawImage(L, 0, 0, W, H); ctx.restore();
    ctx.save(); if (canBlur) ctx.filter = `blur(${Math.max(side * 0.0012, 0.4)}px)`; ctx.drawImage(L, 0, 0, W, H); ctx.restore();
    // Strukturrauschen (klebt am Patienten) und Quantenrauschen
    if (snap.mode !== 'dsa' && snap.mode !== 'roadmapSub') {
      const scale = side * Math.min(3.2, Math.max(0.45, 150 / snap.fov)); const m0 = snap.sid / snap.sod;
      const dx = snap.pan[0] * m0 / snap.fov * side, dy = snap.pan[1] * m0 / snap.fov * side;
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = snap.mode === 'roadmapNat' ? 0.25 : 0.45;
      ctx.translate(f.x + dx % scale, f.y + dy % scale);
      const pat = ctx.createPattern(texture, 'repeat'); const k = scale / 256;
      ctx.scale(k, k); ctx.fillStyle = pat; ctx.fillRect(-scale / k, -scale / k, (f.w + 2 * scale) / k, (f.h + 2 * scale) / k); ctx.restore();
    }
    {
      const g = grains[(snap.gen + (opts.noisePhase || 0)) & 3];
      let grain = 0.55 + 0.45 * Math.min(1, 15 / Math.max(opts.pulse || 15, 3));
      if (snap.mode === 'roadmapSub' || snap.mode === 'roadmapNat') grain *= 1.5;
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = opts.fluoroOn ? Math.min(grain, 1) : 0.3;
      const k = side / 3.2 / 180; ctx.translate(f.x, f.y); ctx.scale(k, k);
      ctx.fillStyle = ctx.createPattern(g, 'repeat'); ctx.fillRect(0, 0, f.w / k, f.h / k); ctx.restore();
    }
    // Vignette
    const rg = ctx.createRadialGradient(cx, cy, side * 0.33, cx, cy, side * 0.72);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.22)');
    ctx.fillStyle = rg; ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.restore();
    octagon(ctx, f); ctx.strokeStyle = '#404040'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // Senkrechte Koaxialleiste: Schleuse unten, Spitzen oben, gewähltes Device blau.
  function renderStrip(canvas, hud) {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1); const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const devs = hud.devices.filter(d => d.inserted && !['coil', 'web', 'liquidEmbolic'].includes(d.kind)).sort((a, b) => a.rank - b.rank);
    const active = hud.devices[hud.active];
    const anchor = active && active.inserted ? active.ins : Math.max(0, ...devs.map(d => d.ins));
    const win = 240, start = Math.max(anchor - win * 0.62, 0), axis = W * 0.38;
    const py = (mm) => H - (Math.min(Math.max((mm - start) / win, 0), 1) * (H - 30) + 16);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.roundRect(axis - 16, H - 14, 32, 16, 4); ctx.fill(); ctx.stroke();
    for (const d of devs) {
      const hw = Math.max(2.5, Math.min(14, d.od * 4.5)), tipY = py(d.ins), isA = d.i === hud.active;
      const col = isA ? '59,156,255' : (d.wire ? '153,153,153' : '217,217,217');
      ctx.fillStyle = `rgba(${col},${isA ? 0.95 : 0.7})`;
      ctx.beginPath(); ctx.roundRect(axis - hw, tipY, hw * 2, H + 12 - tipY, hw); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.8; ctx.stroke();
      if (d.wire) { ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,.22)'; const sp = 6; let y = ((d.rot / (2 * Math.PI)) * sp) % sp + tipY - sp; while (y < H + 12) { ctx.beginPath(); ctx.moveTo(axis - hw, y); ctx.lineTo(axis + hw, y + hw * 1.4); ctx.stroke(); y += sp; } ctx.restore(); }
      if (d.implant > 0 && d.deployed > 0.01) { const len = d.implant * d.deployed / (win / (H - 30)); ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,165,0,.85)'; ctx.lineWidth = 1.4; ctx.strokeRect(axis - hw * 1.9, tipY, hw * 3.8, len); ctx.restore(); }
      if (isA) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.roundRect(axis - hw, tipY, hw * 2, H + 12 - tipY, hw); ctx.stroke(); }
      const ly = Math.min(Math.max(tipY, 12), H - 12);
      ctx.fillStyle = isA ? '#3b9cff' : 'rgba(255,255,255,.7)'; ctx.font = `${isA ? 700 : 500} 9px -apple-system, system-ui, sans-serif`;
      ctx.fillText(d.name, axis + 22, ly - 2);
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '8px Menlo, monospace'; ctx.fillText(`${Math.round(d.ins)} mm`, axis + 22, ly + 8);
      if (d.ins > start + win) { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(axis - hw, 10); ctx.lineTo(axis, 2); ctx.lineTo(axis + hw, 10); ctx.stroke(); }
    }
  }

  function renderECG(canvas, v, t) {
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h);
    const arr = v.arr || 0;
    const col = (v.shock > 0.55 || arr >= 0.7) ? '#ff5a5a' : ((v.shock > 0.25 || arr > 0.25) ? '#ffa030' : '#59e68c');
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const x = i / 120, tt = t - 3 * (1 - x), cycles = tt * v.hr / 60, beat = ((cycles % 1) + 1) % 1; let y = 0;
      // Extrasystolen: einzelne Schläge breit und ohne P-Welle; bei VT alle Komplexe breit
      const k = Math.max(0, Math.floor(cycles)); const hash = ((k * 2654435761) % 1000) / 1000;
      const wide = arr >= 0.7 || hash < arr * 0.8;
      if (wide) { if (beat >= 0.08 && beat < 0.26) y = 0.85 * Math.sin((beat - 0.08) / 0.18 * Math.PI); else if (beat >= 0.26 && beat < 0.44) y = -0.5 * Math.sin((beat - 0.26) / 0.18 * Math.PI); }
      else { if (beat > 0.08 && beat < 0.11) y = -0.15; else if (beat >= 0.11 && beat < 0.16) y = 1 - Math.abs(beat - 0.135) / 0.025;
      else if (beat >= 0.16 && beat < 0.19) y = -0.3; else if (beat > 0.32 && beat < 0.48) y = 0.22 * Math.sin((beat - 0.32) / 0.16 * Math.PI); }
      y *= Math.max(0.35, 1 - v.shock * 0.5);
      const X = x * w, Y = h * 0.62 - y * h * 0.5; if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke(); return col;
  }

  window.CathSimFluoro = { render, renderStrip, renderECG };
})();
