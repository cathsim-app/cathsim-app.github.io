// Der Hirngefäßbaum aus der 3D-Rekonstruktion als langsam drehendes Drahtgitter – auf der
// Startseite und auf dem Ladebildschirm. Aus dem Schwarzen baut sich erst das Gitter auf, dann
// läuft alle paar Sekunden eine blaue Füllung wie Kontrastmittel vom Siphon in die Peripherie
// und wäscht wieder aus. Zurückhaltend: das Bild bleibt Hintergrund.
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const VS = `attribute vec3 aPos; attribute vec3 aNrm; attribute float aDist;
    uniform mat3 uR; uniform vec3 uC; uniform float uSc; uniform vec2 uWH; uniform vec2 uPan; uniform float uExt;
    varying vec3 vN; varying float vZ; varying float vDist;
    void main() { vec3 q = uR * (aPos - uC); vec2 s = vec2(uWH.x * 0.5 + q.x * uSc + uPan.x, uWH.y * 0.5 - q.y * uSc + uPan.y);
      gl_Position = vec4(s.x / uWH.x * 2.0 - 1.0, 1.0 - s.y / uWH.y * 2.0, -q.z / uExt, 1.0); vN = uR * aNrm; vZ = q.z; vDist = aDist; }`;
  const FS = `precision mediump float; varying vec3 vN; varying float vZ; varying float vDist;
    uniform float uZmin; uniform float uZmax; uniform float uMode; uniform float uAlpha; uniform float uFill;
    void main() {
      float f = clamp((vZ - uZmin) / max(uZmax - uZmin, 1.0), 0.0, 1.0);
      if (uMode == 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      if (uMode == 2.0) { float a = uAlpha * (0.35 + 0.65 * f); gl_FragColor = vec4(vec3(0.33, 0.62, 1.0) * a, a); return; }
      // Füllung: nur bis zur Front, dort weich auslaufend; Glanz wie bei den roten Röhren, in Blau
      float front = clamp((uFill - vDist) / 18.0, 0.0, 1.0); if (front <= 0.001) discard;
      bool outside = vN.z >= 0.0; vec3 n = normalize(outside ? vN : -vN);
      vec3 L = normalize(vec3(-0.45, 0.6, 0.72)); vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
      float diff = max(dot(n, L), 0.0); float spec = pow(max(dot(n, H), 0.0), 40.0);
      vec3 c = vec3(0.04, 0.52, 1.0) * (0.3 + 0.7 * diff) + vec3(0.75, 0.88, 1.0) * spec * 0.45;
      float a = uAlpha * front * (0.55 + 0.45 * f);
      gl_FragColor = vec4(c * a, a); }`;

  // Weg jedes Punkts vom Siphon aus, entlang des Baums – damit die Füllung Ast für Ast läuft.
  function fillDistances(r) {
    let seed = null, best = Infinity;
    for (const t of r.t) for (let i = 0; i < t.r.length; i++) { const y = t.p[3 * i + 1]; if (t.r[i] > 1.6 && y < best) { best = y; seed = [t.p[3 * i], y, t.p[3 * i + 2]]; } }
    if (!seed) seed = r.c;
    const starts = r.t.map(t => ({ d: Infinity, len: [] }));
    r.t.forEach((t, ti) => { let acc = 0; const len = [0]; for (let i = 1; i < t.r.length; i++) { acc += Math.hypot(t.p[3 * i] - t.p[3 * i - 3], t.p[3 * i + 1] - t.p[3 * i - 2], t.p[3 * i + 2] - t.p[3 * i - 1]); len.push(acc); } starts[ti].len = len; });
    let bd = Infinity, st = 0, si = 0; r.t.forEach((t, ti) => { for (let i = 0; i < t.r.length; i++) { const d = Math.hypot(t.p[3 * i] - seed[0], t.p[3 * i + 1] - seed[1], t.p[3 * i + 2] - seed[2]); if (d < bd) { bd = d; st = ti; si = i; } } });
    starts[st].d = -starts[st].len[si];
    let changed = true, guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      r.t.forEach((t, ti) => {
        if (starts[ti].d < Infinity) return;
        let bd = Infinity, bv = Infinity;
        r.t.forEach((u, ui) => { if (ui === ti || starts[ui].d === Infinity) return; for (let i = 0; i < u.r.length; i++) { const d = Math.hypot(u.p[3 * i] - t.p[0], u.p[3 * i + 1] - t.p[1], u.p[3 * i + 2] - t.p[2]); if (d < bd) { bd = d; bv = starts[ui].d + starts[ui].len[i] + d; } } });
        if (bd < 12) { starts[ti].d = bv; changed = true; }
      });
    }
    return r.t.map((t, ti) => { const d0 = starts[ti].d === Infinity ? 400 : starts[ti].d; return starts[ti].len.map(l => d0 + l); });
  }
  function rot3(lao, cra) {
    const a = lao * Math.PI / 180, b = cra * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    return [[ca, 0, sa], [-sb * -sa, cb, -sb * ca], [cb * -sa, sb, cb * ca]];
  }
  const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

  // Ein Betrachter je Leinwand: eigener WebGL-Kontext, eigene Uhr (startet, sobald er sichtbar wird)
  function makeViewer(cv, o) {
    const gl = cv.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true }) || cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return null;
    if (!(window.WebGL2RenderingContext && gl instanceof WebGL2RenderingContext) && !gl.getExtension('OES_element_index_uint')) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    const A = {}, U = {};
    for (const n of ['aPos', 'aNrm', 'aDist']) A[n] = gl.getAttribLocation(prog, n);
    for (const n of ['uR', 'uC', 'uSc', 'uWH', 'uPan', 'uExt', 'uZmin', 'uZmax', 'uMode', 'uAlpha', 'uFill']) U[n] = gl.getUniformLocation(prog, n);
    const buf = { pos: gl.createBuffer(), nrm: gl.createBuffer(), dist: gl.createBuffer(), tri: gl.createBuffer(), wire: gl.createBuffer() };
    return { cv, gl, prog, A, U, buf, o, t0: 0, loaded: false };
  }
  function upload(v, g) {
    const gl = v.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, v.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, v.buf.nrm); gl.bufferData(gl.ARRAY_BUFFER, g.nrm, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, v.buf.dist); gl.bufferData(gl.ARRAY_BUFFER, g.dist, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, v.buf.tri); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.tri, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, v.buf.wire); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.wire, gl.STATIC_DRAW);
    v.loaded = true;
  }
  function render(v, G, ts) {
    const cv = v.cv, gl = v.gl, o = v.o;
    if (!v.t0) v.t0 = ts;
    const t = (ts - v.t0) / 1000;
    const dpr = Math.min(2, window.devicePixelRatio || 1), Wd = cv.clientWidth, Hd = cv.clientHeight; if (!Wd) return;
    if (cv.width !== Math.round(Wd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); }
    // Ablauf: kurz schwarz, dann baut sich das Gitter auf; danach periodisch eine Füllung
    // (hin, kurz stehen, auswaschen).
    const meshA = reduce ? o.mesh : o.mesh * ease((t - o.black) / o.build);
    let fillA = 0, fill = 0;
    if (!reduce && t > o.fillStart) {
      const k = (t - o.fillStart) % o.period, up = o.period * 0.43, hold = o.period * 0.21, down = o.period * 0.21;
      if (k < up) { fill = ease(k / up) * (G.dmax + 30); fillA = Math.min(1, k / 0.8); }
      else if (k < up + hold) { fill = G.dmax + 30; fillA = 1; }
      else if (k < up + hold + down) { fill = G.dmax + 30; fillA = 1 - ease((k - up - hold) / down); }
    }
    // Langsame, volle Drehung um die Längsachse, leicht gekippt
    const lao = reduce ? 90 : 90 + t * o.spin, cra = reduce ? 4 : 4 + 5 * Math.sin(t / 23 + 1);
    const R = rot3(lao, cra), c = G.c, sc = Math.min(Wd, Hd) * 0.42 / G.e * o.zoom;
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < G.pos.length; i += 30) { const x = G.pos[i] - c[0], y = G.pos[i + 1] - c[1], z = G.pos[i + 2] - c[2]; const q = R[2][0] * x + R[2][1] * y + R[2][2] * z; if (q < zmin) zmin = q; if (q > zmax) zmax = q; }
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(v.prog); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const bind = (name, b, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(v.A[name]); gl.vertexAttribPointer(v.A[name], size, gl.FLOAT, false, 0, 0); };
    bind('aPos', v.buf.pos, 3); bind('aNrm', v.buf.nrm, 3); bind('aDist', v.buf.dist, 1);
    const U = v.U;
    gl.uniformMatrix3fv(U.uR, false, [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]);
    gl.uniform3f(U.uC, c[0], c[1], c[2]); gl.uniform1f(U.uSc, sc); gl.uniform2f(U.uWH, Wd, Hd); gl.uniform2f(U.uPan, 0, 0); gl.uniform1f(U.uExt, G.maxR * 1.5);
    gl.uniform1f(U.uZmin, zmin); gl.uniform1f(U.uZmax, zmax);
    // 1. Verdeckung: die Röhren nur in den Tiefenpuffer, als Sichtschutz für die Linien dahinter
    gl.disable(gl.BLEND); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); gl.uniform1f(U.uMode, 1);
    gl.colorMask(false, false, false, false);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, v.buf.tri); gl.drawElements(gl.TRIANGLES, G.tri.length, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true); gl.disable(gl.POLYGON_OFFSET_FILL);
    // 2. Gitterlinien, mit Tiefe verblassend
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (meshA > 0.001) { gl.uniform1f(U.uMode, 2); gl.uniform1f(U.uAlpha, meshA); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, v.buf.wire); gl.drawElements(gl.LINES, G.wire.length, gl.UNSIGNED_INT, 0); }
    // 3. Die Füllung: blaue, glänzende Röhren bis zur Front
    if (fillA > 0.001) { gl.depthFunc(gl.LEQUAL); gl.uniform1f(U.uMode, 0); gl.uniform1f(U.uAlpha, o.fill * fillA); gl.uniform1f(U.uFill, fill); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, v.buf.tri); gl.drawElements(gl.TRIANGLES, G.tri.length, gl.UNSIGNED_INT, 0); gl.depthFunc(gl.LESS); }
  }

  const viewers = [];
  const gate = document.getElementById('gateCanvas');
  if (gate) { const v = makeViewer(gate, { black: 0, build: 2.2, fillStart: 2.8, period: 14, mesh: 0.42, fill: 0.8, spin: 6, zoom: 1.08 }); if (v) viewers.push(v); }
  const ld = document.getElementById('loaderCanvas');
  if (ld) { const v = makeViewer(ld, { black: 0, build: 1.6, fillStart: 1.8, period: 9, mesh: 0.34, fill: 0.7, spin: 10, zoom: 1.0 }); if (v) viewers.push(v); }
  if (!viewers.length) return;
  let G = null, raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!G) return;
    for (const v of viewers) {
      if (!v.cv.getClientRects().length) { v.t0 = 0; continue; }   // unsichtbar: Uhr steht, startet beim nächsten Zeigen neu
      if (!v.loaded) upload(v, G);
      render(v, G, ts);
    }
  }
  // Die Daten liegen inline in brain-recon.js; die Hülle rechnet ein Worker, sobald sie da ist, geht es los.
  if (window.CATHSIM_BRAIN) {
    const r = window.CATHSIM_BRAIN, dists = fillDistances(r);
    const tubes = r.t.map((t, ti) => ({ p: t.p, r: t.r, a: dists[ti] }));
    try {
      const w = new Worker('mesh.js' + (window.CATHSIM_BUILD ? '?v=' + window.CATHSIM_BUILD : ''));
      w.onmessage = (e) => { const g = e.data.geo; if (!g) return; let dmax = 0; for (const d of g.dist) if (d < 1e6) dmax = Math.max(dmax, d); G = { pos: g.pos, nrm: g.nrm, dist: g.dist, tri: g.tri, wire: g.wire, maxR: g.maxR, dmax, c: r.c, e: r.e }; raf = requestAnimationFrame(frame); w.terminate(); };
      w.postMessage({ id: 1, recon: { tubes, center: r.c }, opts: { h: 0.5 } });
    } catch (e) {}
  }
})();
