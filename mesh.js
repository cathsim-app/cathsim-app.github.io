// Geschlossene Gefäßoberfläche aus Mittellinien und Radien – wie eine echte 3D-Rekonstruktion:
// ein Abstandsfeld aus Kapseln (Kugel-Union), daraus mit Surface Nets eine glatte Hülle. An
// Abgängen gehen die Röhren ineinander über, ein Sack wird zur runden Kugel statt zum Kegel.
// Läuft im Web Worker (postMessage) oder direkt (buildSurface).
(function (root) {
  function buildSurface(recon, opts) {
    opts = opts || {};
    const tubes = recon.tubes || recon.t || [];
    const pts = []; // [ti, i, x, y, z, r, arc, extra]
    let maxR = 0, minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    tubes.forEach((t, ti) => {
      let along = 0;
      for (let i = 0; i < t.r.length; i++) {
        const x = t.p[3 * i], y = t.p[3 * i + 1], z = t.p[3 * i + 2];
        if (i > 0) along += Math.hypot(x - t.p[3 * i - 3], y - t.p[3 * i - 2], z - t.p[3 * i - 1]);
        pts.push([ti, i, x, y, z, t.r[i], along, t.a ? t.a[i] : 0]);
        maxR = Math.max(maxR, t.r[i]);
        minX = Math.min(minX, x - t.r[i]); maxX = Math.max(maxX, x + t.r[i]);
        minY = Math.min(minY, y - t.r[i]); maxY = Math.max(maxY, y + t.r[i]);
        minZ = Math.min(minZ, z - t.r[i]); maxZ = Math.max(maxZ, z + t.r[i]);
      }
    });
    if (!pts.length) return null;
    // Auflösung nach Ausdehnung: fein genug für 1-mm-Äste, grob genug für den ganzen Baum
    const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const h = opts.h || Math.max(0.3, Math.min(0.5, ext / 200));
    // Feine Äste dürfen nicht in Striche zerfallen: unter einem Gitterschritt werden sie
    // auf gut einen Schritt aufgedickt (nur für die Hülle, Kaliber und Fluss bleiben echt).
    const rmin = 0.85 * h;
    const pad = 2 * h;
    const ox = minX - pad, oy = minY - pad, oz = minZ - pad;
    const nx = Math.ceil((maxX - minX + 2 * pad) / h) + 1, ny = Math.ceil((maxY - minY + 2 * pad) / h) + 1, nz = Math.ceil((maxZ - minZ + 2 * pad) / h) + 1;
    // Dünn besetzte Blöcke von B³ Zellen; je Block (B+1)³ Eckwerte
    const B = 8, S = B + 1, bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
    const blocks = new Map();
    const blockOf = (i, j, k) => { const key = (i * by + j) * bz + k; let b = blocks.get(key); if (!b) { b = { i, j, k, d: new Float32Array(S * S * S).fill(1e9), id: new Int32Array(S * S * S).fill(-1) }; blocks.set(key, b); } return b; };
    // Geschwindigkeit je Punkt (für die Flussfarbe): weit = langsam, eng = schnell, geglättet
    const allR = pts.map(p => p[5]).sort((a, b) => a - b), rref = allR[Math.floor(allR.length / 2)] || 1;
    const velRaw = new Float32Array(pts.length);
    // Geschwindigkeit aus der Engine (cm/s, Volumenstrom nach Kaliber, Lumen nach Stenose);
    // ohne Angabe grob aus dem Radius. Farbskala fest: 8 cm/s blau, 160 cm/s rot.
    const hasV = tubes.every(t => t.v && t.v.length === t.r.length);
    { let q = 0; tubes.forEach((t) => { for (let i = 0; i < t.r.length; i++) { if (hasV) { velRaw[q++] = Math.max(t.v[i], 0.5); continue; } let a = 0, n = 0; for (let k = Math.max(0, i - 5); k <= Math.min(t.r.length - 1, i + 5); k++) { a += t.r[k]; n++; } velRaw[q++] = Math.pow(rref / Math.max(a / n, 0.2), 1.2); } }); }
    let lo, hi; if (hasV) { lo = Math.log(8); hi = Math.log(160); } else { const lv = Array.from(velRaw).map(Math.log).sort((a, b) => a - b); lo = lv[Math.floor(lv.length * 0.12)] || 0; hi = lv[Math.floor(lv.length * 0.94)] || 1; }
    const vel = new Float32Array(pts.length); for (let i = 0; i < pts.length; i++) { const x = Math.max(0, Math.min(1, (Math.log(velRaw[i]) - lo) / Math.max(hi - lo, 1e-6))); vel[i] = x * x * (3 - 2 * x); }
    // Kapseln ins Feld eintragen: Abstand zur Strecke abzüglich des interpolierten Radius
    let pi = 0;
    tubes.forEach((t, ti) => {
      const n = t.r.length, base = pi; pi += n;
      for (let i = 0; i + 1 < n; i++) {
        const a = pts[base + i], b = pts[base + i + 1];
        const ax = a[2], ay = a[3], az = a[4], ra = Math.max(a[5], rmin), bxp = b[2], byp = b[3], bzp = b[4], rb = Math.max(b[5], rmin);
        const rm = Math.max(ra, rb) + 1.5 * h;
        const x0 = Math.min(ax, bxp) - rm, x1 = Math.max(ax, bxp) + rm, y0 = Math.min(ay, byp) - rm, y1 = Math.max(ay, byp) + rm, z0 = Math.min(az, bzp) - rm, z1 = Math.max(az, bzp) + rm;
        const gi0 = Math.max(0, Math.floor((x0 - ox) / h)), gi1 = Math.min(nx - 1, Math.ceil((x1 - ox) / h));
        const gj0 = Math.max(0, Math.floor((y0 - oy) / h)), gj1 = Math.min(ny - 1, Math.ceil((y1 - oy) / h));
        const gk0 = Math.max(0, Math.floor((z0 - oz) / h)), gk1 = Math.min(nz - 1, Math.ceil((z1 - oz) / h));
        const dx = bxp - ax, dy = byp - ay, dz = bzp - az, l2 = dx * dx + dy * dy + dz * dz || 1e-9;
        for (let bi = Math.floor(gi0 / B); bi <= Math.floor(gi1 / B); bi++) for (let bj = Math.floor(gj0 / B); bj <= Math.floor(gj1 / B); bj++) for (let bk = Math.floor(gk0 / B); bk <= Math.floor(gk1 / B); bk++) {
          const blk = blockOf(bi, bj, bk);
          const li0 = Math.max(gi0 - bi * B, 0), li1 = Math.min(gi1 - bi * B, B), lj0 = Math.max(gj0 - bj * B, 0), lj1 = Math.min(gj1 - bj * B, B), lk0 = Math.max(gk0 - bk * B, 0), lk1 = Math.min(gk1 - bk * B, B);
          for (let li = li0; li <= li1; li++) { const px = ox + (bi * B + li) * h - ax;
            for (let lj = lj0; lj <= lj1; lj++) { const py = oy + (bj * B + lj) * h - ay;
              for (let lk = lk0; lk <= lk1; lk++) { const pz = oz + (bk * B + lk) * h - az;
                let t2 = (px * dx + py * dy + pz * dz) / l2; t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
                const qx = px - dx * t2, qy = py - dy * t2, qz = pz - dz * t2;
                const d = Math.sqrt(qx * qx + qy * qy + qz * qz) - (ra + (rb - ra) * t2);
                const idx = (li * S + lj) * S + lk;
                if (d < blk.d[idx]) { blk.d[idx] = d; blk.id[idx] = base + (t2 < 0.5 ? i : i + 1); }
              } } }
        }
      }
    });
    // Surface Nets: je Zelle mit Vorzeichenwechsel ein Punkt, verbunden über die Kanten
    const vpos = [], vnrm = [], vid = [], cellV = new Map();
    const ckey = (i, j, k) => (i * ny + j) * nz + k;
    const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    for (const blk of blocks.values()) {
      for (let li = 0; li < B; li++) for (let lj = 0; lj < B; lj++) for (let lk = 0; lk < B; lk++) {
        const gi = blk.i * B + li, gj = blk.j * B + lj, gk = blk.k * B + lk; if (gi >= nx - 1 || gj >= ny - 1 || gk >= nz - 1) continue;
        let inside = 0, any = false; const dv = new Array(8);
        for (let c = 0; c < 8; c++) { const d = blk.d[((li + corner[c][0]) * S + (lj + corner[c][1])) * S + (lk + corner[c][2])]; dv[c] = d; if (d < 0) inside++; if (d < 1e8) any = true; }
        if (!any || inside === 0 || inside === 8) continue;
        // Schnittpunkte auf den 12 Kanten mitteln
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
        for (const [a, b] of E) { const da = dv[a], db = dv[b]; if ((da < 0) === (db < 0)) continue; const t = da / (da - db); const ca = corner[a], cb = corner[b]; sx += ca[0] + (cb[0] - ca[0]) * t; sy += ca[1] + (cb[1] - ca[1]) * t; sz += ca[2] + (cb[2] - ca[2]) * t; cnt++; }
        if (!cnt) continue;
        const px = ox + (gi + sx / cnt) * h, py = oy + (gj + sy / cnt) * h, pz = oz + (gk + sz / cnt) * h;
        // Normale aus dem Gradienten der Eckwerte
        let gx = 0, gy = 0, gz = 0;
        for (let c = 0; c < 8; c++) { const d = Math.min(dv[c], 1e3); gx += corner[c][0] ? d : -d; gy += corner[c][1] ? d : -d; gz += corner[c][2] ? d : -d; }
        const gl = Math.hypot(gx, gy, gz) || 1;
        // Zugehöriger Mittellinienpunkt: die Ecke mit dem kleinsten Abstand
        let bestC = 0; for (let c = 1; c < 8; c++) if (Math.abs(dv[c]) < Math.abs(dv[bestC])) bestC = c;
        const id = blk.id[((li + corner[bestC][0]) * S + (lj + corner[bestC][1])) * S + (lk + corner[bestC][2])];
        cellV.set(ckey(gi, gj, gk), vpos.length / 3);
        vpos.push(px, py, pz); vnrm.push(gx / gl, gy / gl, gz / gl); vid.push(id < 0 ? 0 : id);
      }
    }
    // Flächen: je Kante mit Vorzeichenwechsel ein Viereck aus den vier anliegenden Zellen
    const tri = [], wireSet = new Set(), wire = [];
    const addW = (a, b) => { const k = a < b ? a * 4294967296 + b : b * 4294967296 + a; if (!wireSet.has(k)) { wireSet.add(k); wire.push(a, b); } };
    const quad = (v0, v1, v2, v3, flip) => { if (v0 === undefined || v1 === undefined || v2 === undefined || v3 === undefined) return; if (flip) { tri.push(v0, v2, v1, v0, v3, v2); } else { tri.push(v0, v1, v2, v0, v2, v3); } addW(v0, v1); addW(v1, v2); addW(v2, v3); addW(v3, v0); };
    for (const blk of blocks.values()) {
      for (let li = 0; li < B; li++) for (let lj = 0; lj < B; lj++) for (let lk = 0; lk < B; lk++) {
        const gi = blk.i * B + li, gj = blk.j * B + lj, gk = blk.k * B + lk;
        const d0 = blk.d[(li * S + lj) * S + lk]; if (d0 > 1e8) continue;
        const dxv = blk.d[((li + 1) * S + lj) * S + lk], dyv = blk.d[(li * S + lj + 1) * S + lk], dzv = blk.d[(li * S + lj) * S + lk + 1];
        const s0 = d0 < 0;
        if (dxv < 1e8 && (dxv < 0) !== s0) quad(cellV.get(ckey(gi, gj, gk)), cellV.get(ckey(gi, gj - 1, gk)), cellV.get(ckey(gi, gj - 1, gk - 1)), cellV.get(ckey(gi, gj, gk - 1)), s0);
        if (dyv < 1e8 && (dyv < 0) !== s0) quad(cellV.get(ckey(gi, gj, gk)), cellV.get(ckey(gi, gj, gk - 1)), cellV.get(ckey(gi - 1, gj, gk - 1)), cellV.get(ckey(gi - 1, gj, gk)), s0);
        if (dzv < 1e8 && (dzv < 0) !== s0) quad(cellV.get(ckey(gi, gj, gk)), cellV.get(ckey(gi - 1, gj, gk)), cellV.get(ckey(gi - 1, gj - 1, gk)), cellV.get(ckey(gi, gj - 1, gk)), s0);
      }
    }
    // Normalen zweimal über die Nachbarn glätten – der Gradient allein ist auf 0,5 mm etwas rau
    const nv = vpos.length / 3, acc = new Float32Array(nv * 3), cnt = new Float32Array(nv);
    for (let pass = 0; pass < 2; pass++) {
      acc.fill(0); cnt.fill(0);
      for (let e = 0; e < wire.length; e += 2) { const a = wire[e], b = wire[e + 1]; for (let c = 0; c < 3; c++) { acc[3 * a + c] += vnrm[3 * b + c]; acc[3 * b + c] += vnrm[3 * a + c]; } cnt[a]++; cnt[b]++; }
      for (let v = 0; v < nv; v++) { let x = vnrm[3 * v] * 2 + acc[3 * v], y = vnrm[3 * v + 1] * 2 + acc[3 * v + 1], z = vnrm[3 * v + 2] * 2 + acc[3 * v + 2]; const l = Math.hypot(x, y, z) || 1; vnrm[3 * v] = x / l; vnrm[3 * v + 1] = y / l; vnrm[3 * v + 2] = z / l; }
    }
    // Je Ecke: Mittellinienpunkt (für Schere), Radius, Lauflänge, Geschwindigkeit, Extra
    const pid = new Uint32Array(nv), rad = new Float32Array(nv), arc = new Float32Array(nv), velV = new Float32Array(nv), extra = new Float32Array(nv), keys = pts.map(p => p[0] + ':' + p[1]);
    for (let v = 0; v < nv; v++) { const p = pts[vid[v]]; pid[v] = vid[v]; rad[v] = p[5]; arc[v] = p[6]; velV[v] = vel[vid[v]]; extra[v] = p[7]; }
    const c = recon.center || recon.c || [0, 0, 0];
    let mr = 1; for (const p of pts) mr = Math.max(mr, Math.hypot(p[2] - c[0], p[3] - c[1], p[4] - c[2]) + p[5]);
    return { pos: new Float32Array(vpos), nrm: new Float32Array(vnrm), pid, hid: new Float32Array(nv), rad, arc, vel: velV, dist: extra, tri: new Uint32Array(tri), wire: new Uint32Array(wire), keys, maxR: mr, h };
  }
  root.CathSimMesh = { buildSurface };
  if (typeof importScripts === 'function') {
    root.onmessage = (e) => {
      const g = buildSurface(e.data.recon, e.data.opts);
      if (!g) { root.postMessage({ id: e.data.id, geo: null }); return; }
      const bufs = [g.pos.buffer, g.nrm.buffer, g.pid.buffer, g.hid.buffer, g.rad.buffer, g.arc.buffer, g.vel.buffer, g.dist.buffer, g.tri.buffer, g.wire.buffer];
      root.postMessage({ id: e.data.id, geo: g }, bufs);
    };
  }
})(typeof self !== 'undefined' ? self : window);
