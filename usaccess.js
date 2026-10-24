// Ultraschallgestützte Leistenpunktion (Seldinger): Schallkopf quer über der Leiste, A. und
// V. femoralis communis erkennen, zwischen Leistenband und Bifurkation punktieren, Nadelspitze
// in der Schallebene halten – und am Handy spritzt das Blut. Das B-Bild ist synthetisch.
window.CathSimUS = (() => {
  const $ = (id) => document.getElementById(id);
  const MODULE = 'Zusatzmodul 1 · Sondierung';
  const CASES = [
    { id: 'us_access_r', us: true, domain: 'Neuro', module: MODULE, playable: true, symbol: 'target', title: 'Zugang: Leistenpunktion unter Ultraschall', targetSegment: '',
      brief: 'Rechte Leiste, Schallkopf quer. A. femoralis communis von der Vene unterscheiden (Puls, Wand, Kompression), Höhe zwischen Leistenband und Bifurkation über dem Hüftkopf wählen, Nadel aus der Ebene bis ins Lumen – pulsierendes Blut, Draht, Schleuse.',
      steps: ['Schallkopf kranial/kaudal fahren: Leistenband, Hüftkopf, Bifurkation finden', 'Vene durch Kompression erkennen – die Arterie pulsiert und lässt sich nicht drücken', 'Nadel 45° aus der Ebene, Spitze mit dem Schallkopf verfolgen (nicht den Schaft)', 'Vorderwand durchstechen, bis helles pulsierendes Blut kommt', 'Draht einführen, Schleuse legen'],
      notes: ['Oberhalb des Leistenbands droht die retroperitoneale Blutung, unterhalb der Bifurkation das Pseudoaneurysma.', 'Der helle Punkt im Bild ist nur dann die Spitze, wenn der Schallkopf über der Spitze steht.'],
      recommended: ['punct18', 'gw035j_sel', 'sheath6f'], fat: 2.0 },
    { id: 'us_access_gen', us: true, domain: 'Allgemeine Angiographie', module: MODULE, playable: true, symbol: 'target', title: 'Zugang: Leistenpunktion unter Ultraschall – adipös', targetSegment: '',
      brief: 'Rechte Leiste, adipöser Patient: tiefe Gefäße, kurze Hüftkopfstrecke. Schallkopf quer, Arterie von der Vene unterscheiden, zwischen Leistenband und Bifurkation punktieren.',
      steps: ['Schallkopf kranial/kaudal fahren: Leistenband, Hüftkopf, Bifurkation finden', 'Vene durch Kompression erkennen', 'Nadel steiler als sonst – die Arterie liegt tief', 'Spitze verfolgen, Vorderwand durchstechen', 'Draht und Schleuse'],
      notes: ['Bei tiefer Arterie flach einstechen heißt lang im Gewebe – lieber 60°.'],
      recommended: ['punct18', 'gw035j_sel', 'sheath6f'], fat: 3.2 },
  ];
  const MATERIAL = [
    { id: 'punct18', vendor: 'Cook', product: 'Punktionsnadel 18 G', variant: '7 cm', cat: 'Zugang', kind: 'needle', short: 'Punktion 18 G × 7 cm', name: 'Punktionsnadel 18 G × 7 cm', desc: 'einwandige Seldinger-Nadel, für den 0.035″-Draht', len: 70, g: 18 },
    { id: 'micro21', vendor: 'Cook', product: 'Mikropunktionsset 21 G', variant: '7 cm', cat: 'Zugang', kind: 'needle', short: 'Mikropunktion 21 G', name: 'Mikropunktionsset 21 G × 7 cm', desc: '21-G-Nadel, 0.018″-Draht, Wechsel auf 0.035″ über den Dilatator', len: 70, g: 21 },
    { id: 'gw035j_sel', vendor: 'Cook', product: 'Seldinger-Draht 035 J', variant: '45 cm', cat: 'Zugang', kind: 'wire', short: 'Draht 035 J 45 cm', name: 'Seldinger-Draht 0.035″ J × 45 cm', desc: 'J-Spitze, geht durch die 18-G-Nadel', ang: 150, opq: 30 },
    { id: 'sheath5f', vendor: 'Terumo', product: 'Schleuse Radifocus', variant: '5 F · 10 cm', cat: 'Zugang', kind: 'sheath', short: 'Schleuse 5 F', name: 'Schleuse 5 F × 10 cm', desc: 'mit Dilatator, hämostatisches Ventil', fr: 5 },
    { id: 'sheath6f', vendor: 'Terumo', product: 'Schleuse Radifocus', variant: '6 F · 10 cm', cat: 'Zugang', kind: 'sheath', short: 'Schleuse 6 F', name: 'Schleuse 6 F × 10 cm', desc: 'mit Dilatator, hämostatisches Ventil', fr: 6 },
    { id: 'sheath8f', vendor: 'Terumo', product: 'Schleuse Radifocus', variant: '8 F · 10 cm', cat: 'Zugang', kind: 'sheath', short: 'Schleuse 8 F', name: 'Schleuse 8 F × 10 cm', desc: 'für Guider und Ballon-Guide', fr: 8 },
  ];

  // ---- Zustand ----
  // z: Schallkopf entlang des Beins in cm, 0 = Leistenband, positiv kaudal. Nadel: Einstich 1,2 cm
  // kaudal der Ebene, Winkel θ zur Haut, Tiefe d entlang der Nadel, lateraler Versatz u.
  const ST = { on: false, sc: null, z: 1.2, tilt: 0, press: 0, holding: false, d: 0, theta: 60, u: 0.4, zEntry: null, blood: '', msg: '', cls: '', dev: 'needle', wire: false, wireLen: 0, needleOut: false, sheathLen: 0, sheath: false, done: false, t0: 0, hr: 72, phase: 0, dirty: true, dangers: 0, events: [], punctures: 0, backwall: false, veinHit: false };
  const art = () => { // Arterie an der Ebene z: Lage, Radius; über dem Leistenband tiefer (A. iliaca externa), unter der Bifurkation zwei Äste
    const fat = ST.sc ? ST.sc.fat : 2.0; const z = ST.z; const L = LEVEL[ST.level] || LEVEL[1];
    const depth = fat + 0.9 + L.depth + (z < 0 ? -z * 0.6 : 0) + (z > 3.6 ? (z - 3.6) * 0.25 : 0);
    return { x: 0.35, y: depth, r: 0.42 * L.r * (z > 3.6 ? 0.72 : 1), split: z > 3.6 };
  };
  // Schwierigkeit: Übung (oberflächlich, groß, Vene weit weg) … Schwierig (tief, klein, Vene über der Arterie)
  const LEVEL = [{ depth: -0.5, r: 1.2, vx: -1.05, vy: 0.2 }, { depth: 0, r: 1, vx: -0.75, vy: 0.15 }, { depth: 0.5, r: 0.85, vx: -0.45, vy: -0.05 }, { depth: 0.9, r: 0.75, vx: -0.2, vy: -0.35 }];
  const vein = () => { const a = art(); const L = LEVEL[ST.level] || LEVEL[1]; return { x: L.vx, y: a.y + L.vy, rx: 0.62, ry: 0.5 * (1 - 0.85 * ST.press) }; };
  const pulse = () => { const p = ST.phase % 1; return p < 0.18 ? Math.sin(p / 0.18 * Math.PI) : Math.max(0, 0.25 * Math.sin((p - 0.18) / 0.82 * Math.PI)) * 0.6; };
  const tipPos = () => { const th = ST.theta * Math.PI / 180; return { z: (ST.zEntry ?? ST.z + 1.2) - ST.d * Math.cos(th), y: ST.d * Math.sin(th), u: ST.u }; };
  // Irreguläre Gefäßkontur: Radius winkelabhängig moduliert, Phase wandert langsam mit der Schallkopfhöhe
  const irr = (phi, z, k) => 1 + 0.035 * Math.sin(3 * phi + z * 1.7 + k) + 0.022 * Math.sin(5 * phi - z * 0.9 + 2 * k) + 0.012 * Math.sin(7 * phi + k * 0.5);

  // ---- B-Bild ----
  // Halbe Auflösung reicht: das B-Bild ist ohnehin unscharf, die Leinwand skaliert weich hoch.
  const IW = 220, IH = 183, CMW = 6.0, CMD = 5.0; const sx = IW / CMW, sy = IH / CMD;
  let noise = null; const NN = 3;
  // Speckle: lateral gröber als axial (Strahlbreite), dazu eine grobe Fleckenkomponente, die mit der
  // Tiefe zunimmt. Mehrere Felder, zwischen denen das Bild langsam wandert – so flimmert es wie live.
  function makeNoise() {
    noise = [];
    for (let v = 0; v < NN; v++) {
      const raw = new Float32Array(IW * IH); let seed = 1234 + v * 777; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < raw.length; i++) raw[i] = rnd();
      const CW = Math.ceil(IW / 4) + 2, CH = Math.ceil(IH / 4) + 2;
      const coarse = new Float32Array(CW * CH); for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
      const a = new Float32Array(IW * IH);
      for (let py = 0; py < IH; py++) for (let px = 0; px < IW; px++) {
        // lateral 5 Pixel verschmiert, axial 2
        let sum = 0, n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 0; dy++) { const qx = px + dx, qy = py + dy; if (qx >= 0 && qx < IW && qy < IH) { sum += raw[qy * IW + qx]; n++; } }
        const fine = sum / n;
        const cx = px / 4, cy = py / 4, i0 = Math.floor(cx), j0 = Math.floor(cy), tx = cx - i0, ty = cy - j0, W = CW;
        const c = coarse[j0 * W + i0] * (1 - tx) * (1 - ty) + coarse[j0 * W + i0 + 1] * tx * (1 - ty) + coarse[(j0 + 1) * W + i0] * (1 - tx) * ty + coarse[(j0 + 1) * W + i0 + 1] * tx * ty;
        const depth = py / IH;
        a[py * IW + px] = 0.35 + 1.3 * ((1 - 0.45 * depth) * fine + (0.45 * depth + 0.35) * c) / 1.35;
      }
      noise.push(a);
    }
  }
  const SMALLV = [{ x: -2.1, y: 1.6, r: 0.11, k: 1.3 }, { x: 1.9, y: 2.3, r: 0.09, k: 0.8 }, { x: -1.2, y: 3.4, r: 0.13, k: 1.7 }, { x: 2.4, y: 3.9, r: 0.08, k: 1.1 }, { x: 0.9, y: 1.4, r: 0.07, k: 2.2 }];
  const off = document.createElement('canvas'); off.width = IW; off.height = IH;
  const RAW = new Float32Array(IW * IH), TMP = new Float32Array(IW * IH), OUT = new Float32Array(IW * IH);
  let imgData = null;
  // Separierbarer Box-Blur: lateral breit (Strahlbreite), axial schmal – das macht das echte B-Bild unscharf.
  function blur(src, dst, rx, ry) {
    const W = IW, H = IH; const nx = 2 * rx + 1, ny = 2 * ry + 1;
    for (let y = 0; y < H; y++) { const row = y * W; let acc = 0; for (let x = -rx; x <= rx; x++) acc += src[row + Math.max(0, Math.min(W - 1, x))];
      for (let x = 0; x < W; x++) { TMP[row + x] = acc / nx; acc += src[row + Math.min(W - 1, x + rx + 1)] - src[row + Math.max(0, x - rx)]; } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let y = -ry; y <= ry; y++) acc += TMP[Math.max(0, Math.min(H - 1, y)) * W + x];
      for (let y = 0; y < H; y++) { dst[y * W + x] = acc / ny; acc += TMP[Math.min(H - 1, y + ry + 1) * W + x] - TMP[Math.max(0, y - ry) * W + x]; } }
  }
  function bmode(frame) {
    if (!noise) makeNoise();
    const ctx2 = off.getContext('2d'); if (!imgData) imgData = ctx2.createImageData(IW, IH); const d = imgData.data;
    const tN = frame * 0.06, kN = Math.floor(tN) % NN, fN = tN - Math.floor(tN), nzA = noise[kN], nzB = noise[(kN + 1) % NN];
    const fat = ST.sc.fat, a = art(), v = vein(), p = pulse(), ra = a.r * (1 + 0.1 * p), z = ST.z;
    const fh = z > 0.4 && z < 3.2;                  // Hüftkopf unter den Gefäßen
    const above = z < 0.3;                          // über dem Leistenband: dickere, echoreichere oberflächliche Schicht
    const tp = tipPos(); const th = ST.theta * Math.PI / 180;
    const now = performance.now();
    // Draht und Schleuse im Gefäß: der Draht läuft von der Spitze nach kranial in der Arterie, die Schleuse folgt ihm vom Einstich aus
    let lum = null; if (ST.wireLen > 0 && ST.zEntry !== null) { const zTip = tp.z; const inW = z <= zTip + 0.1 && z >= zTip - ST.wireLen; const inS = ST.needleOut && ST.sheathLen > 0 && z <= ST.zEntry && z >= ST.zEntry - ST.sheathLen * 0.7; if (inW || inS) lum = { x: a.x + 0.06, y: a.y - 0.08 + 0.1 * Math.sin(z * 3), sheath: inS }; }
    // Nadel: Schnitt des Schafts mit der Ebene; die Spitze nur, wenn die Ebene über ihr steht
    let dot = null; if (ST.d > 0.05 && ST.zEntry !== null) { const tt = Math.tan(ST.tilt * Math.PI / 180); const den = Math.cos(th) + Math.sin(th) * tt; const sN = den > 0.05 ? (ST.zEntry - z) / den : -1; if (sN > 0 && sN <= ST.d + 0.02) dot = { x: ST.u, y: sN * Math.sin(th), isTip: Math.abs(sN - ST.d) < 0.12 }; }
    // Gewebe wackelt um den Nadelschnitt, solange die Nadel bewegt wird (abklingend über 0,6 s)
    const mv = ST.moveT ? Math.max(0, 1 - (now - ST.moveT) / 600) : 0; const wob = dot && mv > 0 ? { x: dot.x, y: dot.y, a: mv * (ST.moveDir || 1), ph: now / 55 } : null;
    const prof = a.split ? [{ x: 0.2, y: a.y, r: ra * 0.78, k: 0.4 }, { x: 1.05, y: a.y + 0.45, r: ra * 0.62, k: 2.1 }] : [{ x: a.x, y: a.y, r: ra, k: 0 }];
    // bewegte Artefakte: wanderndes Nachhallband, Seitenkeulen-Streifen, Schattenband, Durchläufer, Helligkeitsschwankung
    const tS = now / 1000;
    const rev = 0.25 + 0.12 * Math.sin(tS * 0.7);                        // Nachhall-Tiefe (cm), wandert
    const lobeX = Math.sin(tS * 0.21) * 2.4, lobeOn = Math.sin(tS * 0.9) > 0.55; // Seitenkeule
    const shX = -0.6 + 0.35 * Math.sin(z * 2.2) + 0.15 * Math.sin(tS * 0.3);   // Schattenband, hängt am Schallkopf
    const sweep = ((tS * 0.45 + 0.37) % 4.5);                              // alle ~4,5 s zieht ein Band durchs Bild (1,5 s)
    const sweepX = sweep < 1.5 ? -CMW / 2 + sweep / 1.5 * CMW : null;
    const flick = 1 + 0.035 * Math.sin(tS * 9.1) + 0.02 * Math.sin(tS * 23.7);
    const nx0 = a.x + 1.15, ny0 = a.y - 0.25;
    for (let py = 0; py < IH; py++) {
      const y = py / sy; const tgc = 1.08 - 0.12 * y; const deep = Math.max(0, (y - 2.8) / 2.2);
      for (let px = 0; px < IW; px++) {
        let x = px / sx - CMW / 2, yy = y;
        if (wob) { const dx = x - wob.x, dy = yy - wob.y, r2 = dx * dx + dy * dy; if (r2 < 0.5) { const w = wob.a * 0.07 * Math.exp(-r2 * 4) * Math.sin(wob.ph + r2 * 9); const rr = Math.sqrt(r2) + 1e-4; x += dx / rr * w; yy += dy / rr * w; } }
        let g;
        const fatH = above ? fat + 0.5 : fat;
        if (yy < 0.1) g = 205;
        else if (yy < 0.32 + rev) g = 140 - (yy - 0.1) * 200 + 35 * Math.max(0, Math.cos((yy - rev * 0.3) * 55));    // Nachhall unter der Haut, wandert
        else if (yy < fatH) { const w = Math.sin(x * 2.1 + 1.3) * 0.12; g = (above ? 100 : 86) + 22 * Math.sin(x * 4.6 + yy * 3.1 + w * 9) * Math.sin(yy * 7.5 + x * 1.7);
          // wellige, unterbrochene Fettsepten
          const sep = (yy * 2.1 + x * (0.35 + w) + 0.18 * Math.sin(x * 3.3 + yy * 2) + 0.5) % 1; const gap = Math.sin(x * 9.3 + yy * 4.1) > 0.1; if (Math.abs(sep - 0.5) < 0.035 && gap) g = 142 - Math.abs(sep - 0.5) * 900; }
        else if (yy < fatH + 0.08) { g = Math.sin(x * 7.7 + 0.4) > -0.5 ? 200 : 120; }                      // Faszie, unterbrochen
        else { // Muskel: Fiederung als schräge, unterbrochene helle Linien, dazwischen gröbere Textur
          const fib = Math.sin((yy * 1.0 - x * 0.22 + 0.05 * Math.sin(x * 4 + yy * 2)) * 31); const br = Math.sin(x * 5.1 + yy * 2.3) > -0.3 ? 1 : 0.35;
          g = 96 + 16 * Math.sin(x * 2.2 + yy * 13 + 0.6) * Math.cos(yy * 4.4) + 26 * Math.max(0, fib) ** 2 * br - 6 * Math.max(0, -fib); }
        // kleine Gefäße: echofreie Punkte, die mit dem Schallkopf wandern
        for (const sv of SMALLV) { const svx = sv.x + 0.25 * Math.sin(z * sv.k), svy = sv.y + 0.1 * Math.cos(z * sv.k * 0.7); const dd = Math.hypot((x - svx) * 1.2, yy - svy); if (dd < sv.r) g = 20 + 30 * dd / sv.r; else if (dd < sv.r + 0.04) g = Math.max(g, 150); }
        // Nerv lateral der Arterie: Wabenmuster
        const nx = x - nx0, ny = yy - ny0; if (nx * nx / 0.25 + ny * ny / 0.09 < 1) g = 130 + 40 * Math.sin(x * 40) * Math.sin(yy * 40);
        // Vene: unregelmäßig ovales Lumen, dünne Wand, dahinter heller (Schallverstärkung)
        const vphi = Math.atan2(yy - v.y, x - v.x); const vi = irr(vphi, z, 1.3);
        const vx = (x - v.x) / (v.rx * vi), vy = (yy - v.y) / Math.max(v.ry * vi, 0.04);
        const vr = vx * vx + vy * vy; if (vr < 1) g = 22 + 16 * vr; else if (vr < 1.25) g = 125 + 35 * (vy < 0 ? 1 : 0) * Math.max(0, Math.sin(vphi * 4 + 1)); else if (yy > v.y) { const lat = Math.abs(x - v.x) / v.rx, fade = Math.exp(-(yy - v.y) / 1.3); if (lat < 0.9) g *= 1 + 0.2 * fade; else if (lat < 1.08) g *= 1 - 0.35 * fade; }
        // Arterie: irreguläres Lumen, ungleich helle Wand mit Plaque, pulsiert; Nachhall unter der Vorderwand, Randschatten seitlich
        for (const c of prof) { const phi = Math.atan2(yy - c.y, x - c.x); const ri = c.r * irr(phi, z, c.k); const dr = Math.hypot(x - c.x, yy - c.y); const lat = Math.abs(x - c.x) / c.r;
          const plaque = 0.07 * Math.max(0, Math.cos(phi - 2.4 - c.k)) ** 3;   // Verdickung an einer Stelle
          const wallW = 0.07 + plaque + 0.02 * Math.sin(phi * 6 + c.k);
          if (dr < ri - plaque * 1.5) { g = 14 + 12 * (dr / ri) + (yy < c.y - ri * 0.55 ? 30 * Math.max(0, Math.cos((yy - (c.y - ri)) * 70)) : 0); }
          else if (dr < ri + wallW) g = 185 + 45 * Math.max(0, Math.sin(phi * 2.3 + c.k + 0.7)) + 20 * p + (plaque > 0.02 ? 25 : 0);
          else if (dr < ri + wallW + 0.08) g = 150 + 20 * Math.sin(phi * 5); else if (dr < ri + wallW + 0.13) g = 125;
          else if (yy > c.y && lat > 0.92 && lat < 1.12) g *= 1 - 0.35 * Math.exp(-(yy - c.y) / 1.2); }
        // Hüftkopf: unregelmäßig helle Kontur, darunter Schatten
        if (fh) { const yfh = a.y + 1.25 + 0.13 * (x - 0.3) * (x - 0.3) + 0.04 * Math.sin(x * 5); if (Math.abs(yy - yfh) < 0.06) g = 200 + 40 * Math.sin(x * 13); else if (yy > yfh) g *= 0.3 + 0.1 * Math.sin(x * 7); }
        if (z > 3.6 && yy > a.y + 1.6) g *= 0.75;
        // Nadel: dezenter Punkt – flach eingestochen heller, bei 45° kaum; schwacher Nachhall
        if (dot) { const ddx = x - dot.x, ddy = yy - dot.y; const vis = 0.25 + 0.75 * Math.max(0, (60 - ST.theta) / 40); if (ddx * ddx + ddy * ddy < 0.01) g = g + (235 - g) * vis; else if (Math.abs(ddx) < 0.04 && ddy > 0 && ddy < 0.6) g = Math.max(g, g + (150 - ddy * 180) * vis * 0.5); }
        // Draht (heller Punkt mit Nachhall im Lumen) und Schleuse (dicker heller Ring)
        if (lum) { const lx = x - lum.x, ly = yy - lum.y; const rr = Math.hypot(lx, ly); if (lum.sheath) { if (rr < 0.09) g = 60; else if (rr < 0.16) g = 240; } else if (rr < 0.05) g = 250; if (!lum.sheath && Math.abs(lx) < 0.03 && ly > 0 && ly < 0.5) g = Math.max(g, 190 - ly * 300 + 30 * Math.sin(ly * 90)); }
        // Schattenband (vom Schallkopf abhängig), Seitenkeule, Durchläufer
        if (Math.abs(x - shX) < 0.18 && yy > fatH) g *= 0.72 + 0.2 * Math.abs(x - shX) / 0.18;
        if (lobeOn && Math.abs(x - lobeX) < 0.06 && yy > 0.3) g = Math.max(g, 150 - yy * 20);
        if (sweepX !== null && Math.abs(x - sweepX) < 0.35) g *= 1 + 0.25 * (1 - Math.abs(x - sweepX) / 0.35);
        // Speckle (langsam wandernd, in der Tiefe gröber/rauschiger), Tiefenausgleich, Randabfall des Schallfelds
        const i = py * IW + px; const sp = nzA[i] * (1 - fN) + nzB[i] * fN;
        g = g * tgc * (1 + (sp - 1) * (1 + 0.9 * deep)) * (1 - 0.25 * Math.pow(Math.abs(x) / (CMW / 2), 6)) * (1 - 0.3 * deep);
        RAW[i] = g;
      }
    }
    blur(RAW, OUT, 2, 1); // lateral 5 px, axial 3 px (bei halber Auflösung)
    // zweite, feine Körnung nach dem Blur, damit es nicht glatt aussieht; Logkompression
    const nzC = noise[(kN + 2) % NN];
    for (let i = 0; i < IW * IH; i++) {
      const py = (i / IW) | 0; const deep = Math.max(0, (py / IH - 0.55) / 0.45);
      let g = OUT[i] * (0.82 + 0.18 * nzC[i] + 0.12 * deep * (nzC[(i * 7) % (IW * IH)] - 1)) * flick;
      g = 255 * Math.pow(Math.max(0, g) / 255, 0.82);
      const o = i * 4; const gg = g > 255 ? 255 : g; d[o] = gg; d[o + 1] = gg; d[o + 2] = Math.min(255, gg * 1.04 + 6); d[o + 3] = 255;
    }
    ctx2.putImageData(imgData, 0, 0);
    return dot;
  }
  let frame = 0;
  function renderMain() {
    const cv = $('usCanvas'); if (!cv || !ST.on) return;
    const W = cv.clientWidth || 800, H = cv.clientHeight || 600; const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W < 10) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    const dot = bmode(frame++);
    // B-Bild mittig, Seitenverhältnis 6:5
    const iw = Math.min(W - 40, (H - 60) * CMW / CMD), ih = iw * CMD / CMW, ox = (W - iw) / 2, oy = 34;
    c.imageSmoothingEnabled = true; c.drawImage(off, ox, oy, iw, ih);
    c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '600 11px -apple-system, "SF Pro Text", sans-serif'; c.textAlign = 'left';
    c.fillText('12 MHz linear · quer · Tiefe 5 cm', ox, 22); c.textAlign = 'right'; c.fillText(`Schallkopf ${ST.z >= 0 ? ST.z.toFixed(1) + ' cm unter dem Leistenband' : (-ST.z).toFixed(1) + ' cm über dem Leistenband'}${Math.abs(ST.tilt) > 1 ? ` · gekippt ${ST.tilt > 0 ? 'kranial' : 'kaudal'} ${Math.abs(ST.tilt).toFixed(0)}°` : ''}${ST.press > 0.5 ? ' · Kompression' : ''}`, ox + iw, 22);
    c.font = '10px "SF Mono", Menlo, monospace'; c.textAlign = 'left'; for (let k = 0; k <= 5; k++) { const yy = oy + ih * k / 5; c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(ox + iw + 4, yy, 6, 1); c.fillText(`${k}`, ox + iw + 12, yy + 4); }
    c.fillStyle = 'rgba(255,255,255,.5)'; c.fillText('medial', ox + 6, oy + ih - 8); c.textAlign = 'right'; c.fillText('lateral', ox + iw - 6, oy + ih - 8);
    // Anatomische Skizze oben rechts: Becken, Hüftkopf, Symphyse, Leistenband, Gefäße, Schallkopf, Nadel
    sketch(c, ox + iw - 222, oy + 10, 212, 180);
    // Hinweis unten: Lage des Punkts
    c.font = '600 11px -apple-system, "SF Pro Text", sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.75)';
    const line = dot ? (dot.isTip ? 'heller Punkt = Nadelspitze (Ebene steht über der Spitze)' : 'heller Punkt = Nadelschaft – die Spitze liegt weiter kranial') : (ST.d > 0.05 ? 'Nadel nicht in der Ebene – Schallkopf zur Spitze fahren' : '');
    if (line) c.fillText(line, ox + iw / 2, oy + ih + 20);
  }
  // Skizze der rechten Leiste von vorn: Beckenschaufel, Acetabulum mit Hüftkopf, Symphyse, Leistenband
  // (Spina iliaca anterior superior → Tuberculum pubicum), darunter A. und V. femoralis communis mit Bifurkation.
  // Längsachse: z in cm, 0 = Leistenband, kaudal nach unten.
  function sketch(c, gx, gy, gw, gh) {
    c.save(); c.fillStyle = 'rgba(0,0,0,.6)'; c.beginPath(); c.roundRect(gx, gy, gw, gh, 12); c.fill();
    const zy = (z) => gy + 50 + z * 20;              // −1,5 … 5 cm → 20 px/cm
    const ax = gx + 96;                               // Gefäßachse (Arterie)
    // Knochen: Beckenschaufel rechts (lateral = Bildlinks), Acetabulum/Hüftkopf, oberer Schambeinast zur Symphyse
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(gx + 22, gy + 12); c.quadraticCurveTo(gx + 10, gy + 30, gx + 30, zy(-0.6)); c.quadraticCurveTo(gx + 44, zy(0.6), gx + 62, zy(1.3)); c.stroke(); // Darmbeinkamm → Spina → Acetabulumrand
    c.beginPath(); c.moveTo(gx + 62, zy(1.3)); c.quadraticCurveTo(gx + 98, zy(0.2), gx + 150, zy(0.5)); c.lineTo(gx + 170, zy(0.9)); c.stroke(); // oberer Schambeinast
    c.beginPath(); c.arc(gx + 58, zy(1.9), 17, -Math.PI * 0.95, Math.PI * 0.35); c.stroke();   // Hüftkopf
    c.beginPath(); c.moveTo(gx + 170, zy(0.9)); c.lineTo(gx + 170, zy(2.5)); c.stroke();        // Symphyse
    c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(gx + 58, zy(1.9), 15, 0, Math.PI * 2); c.fill();
    // Beschriftung
    c.fillStyle = 'rgba(255,255,255,.6)'; c.font = '9px -apple-system, "SF Pro Text", sans-serif'; c.textAlign = 'left';
    c.fillText('Hüftkopf', gx + 8, zy(2.9)); c.fillText('Symphyse', gx + 150, zy(2.9)); c.fillText('Darmbein', gx + 8, gy + 16);
    // Schallkopf: quer, gekippt um ST.tilt
    c.save(); c.translate(ax + 6, zy(ST.z)); c.rotate(ST.tilt * Math.PI / 180 * 0.5); c.fillStyle = '#fff'; c.beginPath(); c.roundRect(-30, -4, 60, 8, 3); c.fill(); c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(-30, 4, 60, 1); c.restore();
    c.fillStyle = 'rgba(255,255,255,.75)'; c.textAlign = 'left'; c.fillText('Schallkopf', ax + 42, zy(ST.z) + 3);
    // Nadel: Einstich (orange) und Spitze (weiß) in Längsrichtung
    if (ST.zEntry !== null) { const tp = tipPos(); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(ax + 6 + ST.u * 12, zy(ST.zEntry)); c.lineTo(ax + 6 + tp.u * 12, zy(tp.z)); c.stroke();
      c.fillStyle = '#ff9f0a'; c.beginPath(); c.arc(ax + 6 + ST.u * 12, zy(ST.zEntry), 3, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(ax + 6 + tp.u * 12, zy(tp.z), 2.5, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }
  function render() { if (!ST.on) return; renderMain(); updateSide(); }

  // ---- Seitenleiste ----
  const set = (id, html, cls) => { const el = $(id); if (!el) return; if (el.innerHTML !== html) el.innerHTML = html; if (cls !== undefined) el.className = cls; };
  function updateSide() {
    set('usProbeInfo', `Schallkopf ${ST.z >= 0 ? ST.z.toFixed(1) + ' cm unter' : (-ST.z).toFixed(1) + ' cm über'} dem Leistenband${ST.press > 0.5 ? ' · drückt' : ''}`, 'info');
    const th = ST.theta; set('usNeedle', ST.d > 0.05 ? `Nadel ${(ST.d * 10).toFixed(0)} mm tief · ${th.toFixed(0)}° · ${ST.u >= 0 ? 'lateral' : 'medial'} ${Math.abs(ST.u * 10).toFixed(0)} mm` : `Nadel an der Haut · ${th.toFixed(0)}°`, 'info');
    set('usMsg', ST.msg || '', 'info ' + (ST.cls || ''));
    set('usBlood', ST.blood === 'art' ? 'Helles, pulsierendes Blut – Arterie.' : ST.blood === 'ven' ? 'Dunkles Blut, stetig – das ist die Vene.' : '', 'info ' + (ST.blood === 'art' ? 'ok' : ST.blood === 'ven' ? 'warn' : ''));
    const ph = phase();
    for (const [id, on] of [['usWire', ph === 'wire'], ['usOut', ph === 'out'], ['usSheath', ph === 'sheath'], ['usAdv', ph === 'punct' || ph === 'wire' || ph === 'sheath'], ['usBack', (ph === 'punct' && ST.d > 0.05) || ph === 'wire' || ph === 'out']]) { const b = $(id); if (b) b.disabled = !on; }
    const nm = { needle: 'Nadel', wire: 'Draht', sheath: 'Schleuse' }[ST.dev];
    const adv = $('usAdv'), back = $('usBack'); if (adv) { adv.innerHTML = `${nm} 3 mm vor`; adv.disabled = ST.done; } if (back) { back.innerHTML = `${nm} 3 mm zurück`; back.disabled = ST.done; }
    document.querySelectorAll('#usDevs button').forEach(b => b.classList.toggle('lit', b.dataset.usdev === ST.dev));
    set('usSeld', ph === 'punct' ? 'Erst pulsierendes Blut, dann der Draht.' : ph === 'wire' ? `Draht ${(ST.wireLen * 10).toFixed(0)} mm durch die Nadel` : ph === 'out' ? `Draht liegt · Nadel noch ${(ST.d * 10).toFixed(0)} mm drin – zurückziehen` : ph === 'sheath' ? `Nadel draußen · Schleuse ${(ST.sheathLen * 10).toFixed(0)} mm über dem Draht` : 'Schleuse liegt.', 'info');
    set('usStats', `<div><b>${ST.punctures}</b><span>Punktionen</span></div><div><b>${ST.dangers}</b><span>Gefahren</span></div><div><b>${fmtT()}</b><span>Zeit</span></div>`);
    const el = $('usDone'); if (el) el.style.display = ST.done ? '' : 'none';
  }
  const fmtT = () => { const s = Math.max(0, Math.round((performance.now() - ST.t0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function say(m, cls) { ST.msg = m; ST.cls = cls || ''; }

  // ---- Handlung ----
  function probe(dz) { if (ST.done) return; ST.z = Math.max(-1.5, Math.min(5, ST.z + dz)); }
  function tiltProbe(deg) { if (ST.done) return; ST.tilt = Math.max(-30, Math.min(30, ST.tilt + deg)); }
  // Kamera-Handsteuerung: Lage und Kippung des Schallkopfs kommen absolut von der linken Hand
  function probeSet(z, tilt, pressOn) { if (ST.done) return; if (typeof z === 'number') ST.z = Math.max(-1.5, Math.min(5, z)); if (typeof tilt === 'number') ST.tilt = Math.max(-30, Math.min(30, tilt)); if (typeof pressOn === 'boolean') press(pressOn); }
  function press(on) { ST.press = on ? 1 : 0; if (on && ST.d > 0.05) say('Mit liegender Nadel nicht komprimieren – die Spitze verschiebt sich.', 'warn'); }
  function tilt(deg) { if (ST.wire || ST.done) return; ST.theta = Math.max(20, Math.min(75, ST.theta + deg)); }
  function lateral(cm) { if (ST.wire || ST.done || ST.dev !== 'needle') return; const k = ST.d > 0.3 ? 0.5 : 1; ST.u = Math.max(-1.5, Math.min(1.5, ST.u + cm * k)); if (ST.d > 0.3) say('Nadel seitlich nachgeführt – im Gewebe geht das zäh und verbiegt die Nadel.', ''); }
  // Seldinger als Strecken: Draht durch die Nadel (Wisch), Nadel über den Draht zurück (Wisch zurück), Schleuse über den Draht (Wisch)
  const phase = () => ST.done ? 'done' : ST.needleOut ? 'sheath' : ST.wire ? 'out' : (ST.blood === 'art' ? 'wire' : 'punct');
  function advance(cm) {
    if (ST.done) return;
    if (ST.dev === 'wire') {
      if (ST.blood !== 'art' && ST.wireLen <= 0) { say('Kein pulsierendes Blut aus der Nadel – der Draht hat keinen Weg ins Gefäß.', 'warn'); return; }
      if (ST.wire && cm < 0 && ST.needleOut) { say('Der Draht bleibt liegen – darüber kommt die Schleuse.', 'warn'); return; }
      ST.wireLen = Math.max(0, Math.min(20, ST.wireLen + cm));
      if (ST.wireLen >= 15 && !ST.wire) wire(); else if (cm > 0 && !ST.wire) say(`Draht ${(ST.wireLen * 10).toFixed(0)} mm durch die Nadel ins Gefäß – weiter, bis er sicher liegt.`, '');
      return;
    }
    if (ST.dev === 'sheath') {
      if (!ST.needleOut) { say(ST.wire ? 'Erst die Nadel über den Draht zurückziehen, dann die Schleuse.' : 'Erst Draht ins Gefäß, dann Nadel raus, dann die Schleuse.', 'warn'); return; }
      if (cm > 0) { ST.sheathLen = Math.min(10, ST.sheathLen + cm); if (ST.sheathLen >= 10) sheath(); else say(`Schleuse mit Dilatator ${(ST.sheathLen * 10).toFixed(0)} mm über den Draht – bis zum Anschlag.`, ''); }
      else ST.sheathLen = Math.max(0, ST.sheathLen + cm);
      return;
    }
    // Nadel
    if (ST.wire) { if (ST.needleOut) return; if (cm < 0) { ST.d = Math.max(0, ST.d + cm); if (ST.d < 0.05) needleOut(); } else say('Der Draht liegt – die Nadel geht jetzt nur noch zurück, über den Draht hinaus.', 'warn'); return; }
    if (ST.wireLen > 0 && cm > 0) { say('Der Draht steckt in der Nadel – Nadel jetzt nicht weiter vorschieben.', 'warn'); return; }
    if (ST.zEntry === null) { ST.zEntry = ST.z + 1.2; ST.punctures++; ST.backwall = false; ST.blood = ''; if (ST.z < 0.3) { say('Einstich oberhalb des Leistenbands – retroperitoneale Blutung droht, Kompression unmöglich.', 'bad'); ST.dangers++; } else if (ST.z > 3.6) { say('Einstich unterhalb der Bifurkation – Pseudoaneurysma- und AV-Fistel-Gefahr.', 'bad'); ST.dangers++; } else say('Nadel durch die Haut – Spitze mit dem Schallkopf verfolgen.', ''); }
    ST.d = Math.min(7, ST.d + cm);
    // Trifft die Spitze ein Lumen? Lage der Gefäße an der Längsposition der Spitze
    const tp = tipPos(); const saveZ = ST.z; ST.z = tp.z; const a = art(), v = vein(); ST.z = saveZ;
    const ra = a.r * (ST.press > 0.5 ? 0.92 : 1);
    const inArt = a.split ? (Math.hypot(tp.u - 0.2, tp.y - a.y) < ra * 0.78 || Math.hypot(tp.u - 1.05, tp.y - a.y - 0.45) < ra * 0.62) : Math.hypot(tp.u - a.x, tp.y - a.y) < ra;
    const inVein = ((tp.u - v.x) / v.rx) ** 2 + ((tp.y - v.y) / Math.max(v.ry, 0.05)) ** 2 < 1;
    const belowArt = !a.split && Math.abs(tp.u - a.x) < ra && tp.y > a.y + ra;
    if (inArt && ST.blood !== 'art') { ST.blood = 'art'; say(tp.z < 0.3 ? 'Helles pulsierendes Blut – aber oberhalb des Leistenbands!' : tp.z > 3.6 ? 'Pulsierendes Blut aus einem Ast unterhalb der Bifurkation.' : 'Helles, pulsierendes Blut aus der A. femoralis communis. Draht einführen.', tp.z < 0.3 || tp.z > 3.6 ? 'warn' : 'ok'); }
    else if (inVein && !ST.blood) { ST.blood = 'ven'; ST.veinHit = true; say('Dunkles, stetiges Blut – die Vene. Nadel zurück, Kompression, neu punktieren.', 'warn'); }
    else if (belowArt && !ST.backwall) { ST.backwall = true; ST.blood = ''; ST.dangers++; say('Hinterwand durchstochen – kein Blut mehr. Zurückziehen, bis es wieder spritzt; Hämatomgefahr.', 'bad'); }
    else if (!inArt && !inVein && ST.blood) ST.blood = '';
    if (tp.y > 5) say('Nadel sehr tief – so weit liegt kein Gefäß. Zurück und neu ausrichten.', 'warn');
  }
  function wire() { if (ST.blood !== 'art' || ST.wire) return; ST.wireLen = Math.max(ST.wireLen, 15); const tp = tipPos(); if (tp.z < 0.3 || tp.z > 3.6) { ST.dangers++; say('Draht liegt – aber die Punktionshöhe ist falsch. Im echten Leben: Nadel raus, komprimieren, neu.', 'bad'); } else say('Draht gleitet ohne Widerstand – Nadel raus, Dilatator, Schleuse.', 'ok'); ST.wire = true; }
  function selectDev(d) { if (['needle', 'wire', 'sheath'].includes(d)) ST.dev = d; }
  function needleOut() { if (!ST.wire || ST.needleOut) return; ST.d = 0; ST.needleOut = true; say('Nadel ist draußen, der Draht liegt. Dilatator und Schleuse über den Draht schieben.', 'ok'); }
  function sheath() { if (!ST.wire || !ST.needleOut || ST.sheath) return; ST.sheathLen = 10; ST.sheath = true; ST.done = true; say(`Schleuse liegt – Zugang in ${fmtT()}, ${ST.punctures} Punktion${ST.punctures === 1 ? '' : 'en'}${ST.veinHit ? ', einmal die Vene' : ''}${ST.backwall ? ', Hinterwand durchstochen' : ''}.`, ST.dangers ? 'warn' : 'ok'); if (onDone) onDone({ caseTime: (performance.now() - ST.t0) / 1000, fluoroSeconds: 0, dap: 0, km: 0, dangers: new Array(ST.dangers).fill(1), completed: true }); }
  let onDone = null;

  async function start(sc, difficulty, stage, tray, done) {
    onDone = done;
    Object.assign(ST, { on: true, sc, level: Math.max(0, Math.min(3, difficulty | 0)), z: 1.2 + (Math.random() - 0.5) * 2, tilt: 0, press: 0, d: 0, theta: 60, u: (Math.random() - 0.5) * 1.2, zEntry: null, blood: '', msg: '', cls: '', dev: 'needle', wire: false, wireLen: 0, needleOut: false, sheathLen: 0, sheath: false, done: false, t0: performance.now(), hr: 72, phase: 0, dangers: 0, punctures: 0, backwall: false, veinHit: false });
    if (stage >= 1) { ST.z = 1.5; ST.u = 0.35; }
    say(stage >= 1 ? 'Schallkopf steht über dem Hüftkopf, Nadel ist ausgerichtet.' : 'Schallkopf fahren, Gefäße erkennen, dann punktieren.', '');
    noise = null;
    render();
  }
  function stop() { ST.on = false; }
  function tick(dt) { if (!ST.on) return; ST.phase += dt * ST.hr / 60; }

  function bind() {
    const cv = $('usCanvas'); if (!cv || cv.dataset.bound) return; cv.dataset.bound = '1';
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { fn(); render(); }); };
    on('usProbeUp', () => probe(-0.5)); on('usProbeDown', () => probe(0.5)); on('usAdv', () => advance(0.3)); on('usBack', () => advance(-0.3));
    on('usSteep', () => tilt(5)); on('usFlat', () => tilt(-5)); on('usTiltUp', () => tiltProbe(5)); on('usTiltDown', () => tiltProbe(-5)); on('usMed', () => lateral(-0.2)); on('usLat', () => lateral(0.2)); on('usWire', wire); on('usOut', needleOut); on('usSheath', sheath); document.querySelectorAll('#usDevs button').forEach(b => b.addEventListener('click', () => { selectDev(b.dataset.usdev); render(); }));
    const pr = $('usPress'); if (pr) { pr.addEventListener('pointerdown', () => { press(true); pr.classList.add('lit'); }); const up = () => { press(false); pr.classList.remove('lit'); }; pr.addEventListener('pointerup', up); pr.addEventListener('pointerleave', up); }
    document.addEventListener('keydown', (e) => { if (!ST.on || e.target.tagName === 'INPUT') return;
      const k = e.key; if (k === 'ArrowUp') advance(0.3); else if (k === 'ArrowDown') advance(-0.3); else if (k === 'ArrowLeft') lateral(-0.2); else if (k === 'ArrowRight') lateral(0.2); else if (k === 'w') probe(-0.5); else if (k === 's') probe(0.5); else if (k === 'a') tiltProbe(5); else if (k === 'd') tiltProbe(-5); else if (k === ' ') { e.preventDefault(); press(!(ST.press > 0.5)); } else if (k === '+') tilt(5); else if (k === '-') tilt(-5); else return; render(); });
  }
  // Vom Handy: Wischen = Nadel vor/zurück (mm), Drehen = Winkel; Kacheln für Schallkopf, Kompression, seitlich, Draht, Schleuse
  function control(m) {
    if (!ST.on) return false;
    if (m.t === 'adv') { advance(m.mm / 10); return true; }
    if (m.t === 'tq') { tilt(m.rad * 180 / Math.PI * 0.5); return true; }
    if (m.t === 'lat') { lateral(+m.cm || 0); return true; }
    if (m.t === 'sel') { selectDev(m.dev); return true; }
    if (m.t === 'probe') { probe(+m.dz || 0); return true; }
    if (m.t === 'act') {
      const a = m.a; if (a === 'usProbe') probeSet(m.z, m.tilt, m.press); else if (a === 'usUp') probe(-0.5); else if (a === 'usDown') probe(0.5); else if (a === 'usPress') press(true); else if (a === 'usRelease') press(false); else if (a === 'usMed') lateral(-0.2); else if (a === 'usLat') lateral(0.2); else if (a === 'usWire') wire(); else if (a === 'usOut') needleOut(); else if (a === 'usSheath') sheath(); else if (a === 'usBack') advance(-0.3); else if (a === 'usFlat') tilt(-5); else if (a === 'usSteep') tilt(5); else if (a === 'usDev') selectDev(m.dev); else return false;
      return true;
    }
    return m.t === 'sheath';
  }
  function status() {
    if (!ST.on) return null;
    return { us: true, title: ST.sc.title, tip: ST.msg || 'Schallkopf fahren, Gefäße erkennen, dann punktieren', depth: ST.d * 10, theta: ST.theta, u: ST.u * 10, z: ST.z, tilt: ST.tilt, press: ST.press > 0.5, blood: ST.wire ? '' : ST.blood, hr: ST.hr, dev: ST.dev, wire: ST.wire, wireLen: ST.wireLen * 10, needleOut: ST.needleOut, sheathLen: ST.sheathLen * 10, phase: phase(), sheath: ST.sheath, done: ST.done,
             alert: ST.cls === 'bad' ? { k: 'danger', t: ST.msg } : (ST.blood === 'art' && !ST.wire ? { k: 'success', t: 'Pulsierendes Blut – Draht einführen' } : null) };
  }
  return { CASES, MATERIAL, start, stop, render, tick, bind, control, status, get active() { return ST.on; }, get state() { return ST; } };
})();
