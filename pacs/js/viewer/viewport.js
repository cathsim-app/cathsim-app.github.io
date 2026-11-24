// One image viewport: display state, rendering, mouse/touch interaction and
// measurement tools. Coordinates: annotations live in image pixel space.
import { T, h, clamp, fmtNum, fmtDate, add, scale, sub, dot, cross, orientationLabel, uid } from '../util.js';
import { renderFrame } from './render.js';
import { getAnnotations, saveAnnotations, countUse } from '../store.js';

const annCache = new Map();          // display-set uid -> { bySop }
function annotationsOf(set) {
  let a = annCache.get(set.uid);
  if (!a) { a = set.kind === 'stack' ? getAnnotations(set.uid) : {}; annCache.set(set.uid, a); }
  return a;
}
export function allAnnotations(set) { return annotationsOf(set); }
export function persistAnnotations(set) { if (set.kind === 'stack') saveAnnotations(set.uid, annotationsOf(set)); }

export const NAV_TOOLS = ['scroll', 'wl', 'pan', 'zoom', 'crosshair'];
const HANDLE = 7;

export function imageToWorld(f, x, y) {
  if (!f.iop || !f.ipp) return null;
  return add(f.ipp, add(scale(f.iop.slice(0, 3), (x - 0.5) * f.colSpacing), scale(f.iop.slice(3, 6), (y - 0.5) * f.rowSpacing)));
}
export function worldToImage(f, P) {
  if (!f.iop || !f.ipp) return null;
  const d = sub(P, f.ipp), row = f.iop.slice(0, 3), col = f.iop.slice(3, 6);
  return { x: dot(d, row) / f.colSpacing + 0.5, y: dot(d, col) / f.rowSpacing + 0.5, dist: dot(d, cross(row, col)) };
}

/** Geometry and statistics of an annotation on a frame. */
export function measure(a, f) {
  const mm = (p, q) => Math.hypot((q.x - p.x) * f.colSpacing, (q.y - p.y) * f.rowSpacing);
  const unit = f.calibrated ? 'mm' : 'px';
  const val = (v) => v * f.slope + f.intercept;
  if (a.type === 'length' || a.type === 'arrow') {
    const d = mm(a.p[0], a.p[1]);
    return { value: d, text: a.type === 'arrow' ? (a.text || '') : `${fmtNum(d, 1)} ${unit}` };
  }
  if (a.type === 'angle') {
    if (a.p.length < 3) return { text: '' };
    const v1 = [(a.p[0].x - a.p[1].x) * f.colSpacing, (a.p[0].y - a.p[1].y) * f.rowSpacing];
    const v2 = [(a.p[2].x - a.p[1].x) * f.colSpacing, (a.p[2].y - a.p[1].y) * f.rowSpacing];
    const ang = Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1), -1, 1)) * 180 / Math.PI;
    return { value: ang, text: `${fmtNum(ang, 1)}°` };
  }
  if (a.type === 'probe') {
    const x = Math.floor(a.p[0].x), y = Math.floor(a.p[0].y);
    if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return { text: '' };
    if (f.color) return { text: `RGB ${f.pixels[(y * f.cols + x) * 3]}/${f.pixels[(y * f.cols + x) * 3 + 1]}/${f.pixels[(y * f.cols + x) * 3 + 2]}` };
    const v = val(f.pixels[y * f.cols + x]);
    return { value: v, text: `${fmtNum(v, Number.isInteger(v) ? 0 : 1)} ${f.units || ''}`.trim() };
  }
  if (a.type === 'ellipse' || a.type === 'rect') {
    const x0 = Math.min(a.p[0].x, a.p[1].x), x1 = Math.max(a.p[0].x, a.p[1].x);
    const y0 = Math.min(a.p[0].y, a.p[1].y), y1 = Math.max(a.p[0].y, a.p[1].y);
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, cx = x0 + rx, cy = y0 + ry;
    const wmm = (x1 - x0) * f.colSpacing, hmm = (y1 - y0) * f.rowSpacing;
    const area = a.type === 'ellipse' ? Math.PI * wmm * hmm / 4 : wmm * hmm;
    const areaTxt = f.calibrated ? `${fmtNum(area / 100, 2)} cm²` : `${fmtNum(area, 0)} px²`;
    if (f.color || rx <= 0 || ry <= 0) return { area, text: areaTxt };
    let n = 0, sum = 0, sq = 0, mn = Infinity, mx = -Infinity;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(f.rows - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(f.cols - 1, Math.ceil(x1)); x++) {
        const ux = (x + 0.5 - cx) / rx, uy = (y + 0.5 - cy) / ry;
        if (a.type === 'ellipse' ? ux * ux + uy * uy > 1 : Math.abs(ux) > 1 || Math.abs(uy) > 1) continue;
        const v = val(f.pixels[y * f.cols + x]);
        n++; sum += v; sq += v * v; if (v < mn) mn = v; if (v > mx) mx = v;
      }
    }
    if (!n) return { area, text: areaTxt };
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    const u = f.units ? ' ' + f.units : '';
    return { area, mean, sd, min: mn, max: mx, n,
      text: `${T('MW', 'Mean')} ${fmtNum(mean, 1)}${u}  SD ${fmtNum(sd, 1)}\nMin ${fmtNum(mn, 0)}  Max ${fmtNum(mx, 0)}\n${T('Fläche', 'Area')} ${areaTxt}` };
  }
  return { text: '' };
}

export class Viewport {
  constructor(hooks) {
    this.hooks = hooks;
    this.set = null; this.index = 0; this.frame = null;
    this.view = { zoom: 1, panX: 0, panY: 0, rot: 0, flipH: false, flipV: false, invert: false, wc: null, ww: null };
    this.img = document.createElement('canvas');
    this.canvas = h('canvas');
    this.ov = { tl: h('div.ov.tl'), tr: h('div.ov.tr'), bl: h('div.ov.bl'), br: h('div.ov.br') };
    this.progress = h('div.vp-progress');
    this.message = h('div.vp-message');
    this.el = h('div.viewport', { tabIndex: 0 }, this.canvas, ...Object.values(this.ov), this.progress, this.message);
    this.selected = null; this.drag = null; this.pending = null; this.hover = null;
    this._token = 0; this._raf = 0;
    this._bind();
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(this.el);
  }

  destroy() { this._ro.disconnect(); this.el.remove(); }

  // ----- content --------------------------------------------------------------------
  async load(set, index = null) {
    this.set = set; this.frame = null; this.selected = null; this.pending = null;
    this.view = { zoom: 1, panX: 0, panY: 0, rot: 0, flipH: false, flipV: false, invert: false, wc: null, ww: null };
    this.message.textContent = '';
    if (!set) { this.draw(); this._overlay(); return; }
    await this.show(index ?? Math.floor((set.length - 1) / 2), true);
    Object.assign(this.view, this._defaultFlip()); this.draw();
    this.hooks.onLoaded?.(this);
  }

  async show(index, silent = false) {
    if (!this.set) return;
    index = clamp(Math.round(index), 0, this.set.length - 1);
    this.index = index;
    const token = ++this._token;
    let frame;
    try { frame = await this.set.getFrame(index); } catch (e) {
      if (token === this._token) { this.frame = null; this.message.textContent = T('Bild kann nicht dargestellt werden: ', 'Image cannot be displayed: ') + e.message; this.draw(); }
      return;
    }
    if (token !== this._token) return;
    this.frame = frame;
    this.message.textContent = '';
    if (this.view.wc === null && !frame.color) { this.view.wc = frame.wc; this.view.ww = frame.ww; }
    this.draw();
    if (!silent) this.hooks.onScroll?.(this);
  }

  /**
   * Hanging rule: present images in radiological convention regardless of how they are
   * stored (axial: patient right on screen left, anterior up; coronal/sagittal: head up).
   */
  _defaultFlip() {
    const f = this.frame;
    if (!f?.iop) return { flipH: false, flipV: false };
    const row = f.iop.slice(0, 3), col = f.iop.slice(3, 6), n = cross(row, col).map(Math.abs);
    const plane = n.indexOf(Math.max(...n));                 // 0 sagittal, 1 coronal, 2 axial
    const right = plane === 0 ? [0, 1, 0] : [1, 0, 0], down = plane === 2 ? [0, 1, 0] : [0, 0, -1];
    const a = dot(row, right), b = dot(col, down);
    if (Math.abs(a) < 0.5 || Math.abs(b) < 0.5) return { flipH: false, flipV: false };   // stored rotated: leave as is
    return { flipH: a < 0, flipV: b < 0 };
  }

  scrollBy(delta) { if (this.set) return this.show(this.index + delta); }

  setWindow(wc, ww) { this.view.wc = wc; this.view.ww = Math.max(ww, 0.5); this.draw(); }
  reset() {
    Object.assign(this.view, { zoom: 1, panX: 0, panY: 0, rot: 0, invert: false }, this._defaultFlip());
    if (this.frame && !this.frame.color) { this.view.wc = this.frame.wc; this.view.ww = this.frame.ww; }
    this.draw();
  }

  // ----- geometry -------------------------------------------------------------------
  matrix() {
    const f = this.frame, c = this.canvas, v = this.view;
    const wmm = f.cols * f.colSpacing, hmm = f.rows * f.rowSpacing;
    const swap = v.rot % 180 !== 0;
    const fit = Math.min(c.width / (swap ? hmm : wmm), c.height / (swap ? wmm : hmm));
    const s = fit * v.zoom;
    this._pxPerMm = s;
    return new DOMMatrix().translate(c.width / 2 + v.panX, c.height / 2 + v.panY).rotate(v.rot)
      .scale((v.flipH ? -1 : 1) * s * f.colSpacing, (v.flipV ? -1 : 1) * s * f.rowSpacing).translate(-f.cols / 2, -f.rows / 2);
  }
  toCanvas(p, m = this._m) { const q = m.transformPoint(new DOMPoint(p.x, p.y)); return { x: q.x, y: q.y }; }
  toImage(p) { const q = this._m.inverse().transformPoint(new DOMPoint(p.x, p.y)); return { x: q.x, y: q.y }; }
  eventPoint(e) {
    const r = this.canvas.getBoundingClientRect(), k = this.canvas.width / (r.width || 1);
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  // ----- rendering ------------------------------------------------------------------
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }

  _draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.el.clientWidth * dpr)), hgt = Math.max(1, Math.round(this.el.clientHeight * dpr));
    if (c.width !== w || c.height !== hgt) { c.width = w; c.height = hgt; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt);
    const f = this.frame;
    this._overlay();
    if (!f) return;
    const v = this.view;
    const key = `${f.sop}|${v.wc}|${v.ww}|${v.invert}|${f.slabCount || 1}|${f.slabMode || ''}`;
    if (this._imgKey !== key || this._imgFrame !== f) { renderFrame(f, v.wc, v.ww, v.invert, this.img); this._imgKey = key; this._imgFrame = f; }
    const m = this._m = this.matrix();
    ctx.setTransform(m);
    ctx.imageSmoothingEnabled = this.hooks.smoothing?.() !== false;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._dpr = dpr;
    this._drawReference(ctx);
    this._drawCrosshair(ctx);
    this._drawAnnotations(ctx);
    this._drawOrientation(ctx);
    this._drawScale(ctx);
  }

  _line(ctx, pts, color, width = 1.5, dash = null) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.setLineDash(dash || []);
    ctx.lineWidth = width * this._dpr; ctx.strokeStyle = color; ctx.stroke();
    ctx.setLineDash([]);
  }
  _text(ctx, text, x, y, color = '#ffd84a', align = 'left', box = false) {
    ctx.font = `${12 * this._dpr}px system-ui, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'top';
    const lines = String(text).split('\n'), lh = 15 * this._dpr;
    if (box) {
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)), pad = 3 * this._dpr;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(x - pad, y - pad, w + 2 * pad, lines.length * lh + pad);
    }
    lines.forEach((line, i) => {
      const yy = y + i * lh;
      ctx.lineWidth = 3 * this._dpr; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(line, x, yy);
      ctx.fillStyle = color; ctx.fillText(line, x, yy);
    });
  }

  currentAnnotations() {
    if (!this.set) return [];
    const by = annotationsOf(this.set), k = this.set.sopAt(this.index);
    return by[k] || (by[k] = []);
  }

  _drawAnnotations(ctx) {
    const f = this.frame;
    const list = [...this.currentAnnotations()];
    if (this.pending) list.push(this.pending);
    for (const a of list) {
      const sel = a === this.selected || a === this.pending;
      const color = sel ? '#6ee7ff' : '#ffd84a';
      const P = a.p.map((p) => this.toCanvas(p));
      let labelAt = P[P.length - 1];
      if (a.type === 'length') this._line(ctx, P, color);
      else if (a.type === 'angle') this._line(ctx, P, color);
      else if (a.type === 'arrow') {
        this._line(ctx, P, color);
        const ang = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x), L = 10 * this._dpr;
        this._line(ctx, [{ x: P[0].x - L * Math.cos(ang - 0.4), y: P[0].y - L * Math.sin(ang - 0.4) }, P[0],
          { x: P[0].x - L * Math.cos(ang + 0.4), y: P[0].y - L * Math.sin(ang + 0.4) }], color);
      } else if (a.type === 'probe') {
        const r = 4 * this._dpr;
        this._line(ctx, [{ x: P[0].x - r, y: P[0].y }, { x: P[0].x + r, y: P[0].y }], color);
        this._line(ctx, [{ x: P[0].x, y: P[0].y - r }, { x: P[0].x, y: P[0].y + r }], color);
      } else if (a.type === 'rect' || a.type === 'ellipse') {
        const corners = [a.p[0], { x: a.p[1].x, y: a.p[0].y }, a.p[1], { x: a.p[0].x, y: a.p[1].y }].map((p) => this.toCanvas(p));
        if (a.type === 'rect') this._line(ctx, [...corners, corners[0]], color);
        else {
          const pts = [];
          const cx = (a.p[0].x + a.p[1].x) / 2, cy = (a.p[0].y + a.p[1].y) / 2, rx = Math.abs(a.p[1].x - a.p[0].x) / 2, ry = Math.abs(a.p[1].y - a.p[0].y) / 2;
          for (let i = 0; i <= 64; i++) { const t = i / 64 * 2 * Math.PI; pts.push(this.toCanvas({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) })); }
          this._line(ctx, pts, color);
        }
        labelAt = corners.reduce((b, p) => (p.x + p.y > b.x + b.y ? p : b));
      }
      if (sel) for (const p of P) { ctx.fillStyle = color; ctx.fillRect(p.x - 3 * this._dpr, p.y - 3 * this._dpr, 6 * this._dpr, 6 * this._dpr); }
      const m = measure(a, f);
      if (m.text) this._text(ctx, m.text, labelAt.x + 8 * this._dpr, labelAt.y + 4 * this._dpr, color, 'left', true);
    }
  }

  _drawOrientation(ctx) {
    const f = this.frame;
    if (!f.iop) return;
    const inv = this._m.inverse();
    const dir = (dx, dy) => {
      const a = inv.transformPoint(new DOMPoint(0, 0)), b = inv.transformPoint(new DOMPoint(dx, dy));
      const ix = (b.x - a.x) * f.colSpacing, iy = (b.y - a.y) * f.rowSpacing;
      return add(scale(f.iop.slice(0, 3), ix), scale(f.iop.slice(3, 6), iy));
    };
    const right = dir(1, 0), down = dir(0, 1), c = this.canvas, pad = 6 * this._dpr;
    const norm = (v) => scale(v, 1 / (Math.hypot(...v) || 1));
    this._text(ctx, orientationLabel(norm(right)), c.width - pad, c.height / 2, '#9ad', 'right');
    this._text(ctx, orientationLabel(scale(norm(right), -1)), pad, c.height / 2, '#9ad', 'left');
    this._text(ctx, orientationLabel(scale(norm(down), -1)), c.width / 2, pad, '#9ad', 'center');
    this._text(ctx, orientationLabel(norm(down)), c.width / 2, c.height - pad - 14 * this._dpr, '#9ad', 'center');
  }

  _drawScale(ctx) {
    const f = this.frame;
    if (!f.calibrated) return;
    const c = this.canvas, target = c.width / 5 / this._pxPerMm;
    const len = [200, 100, 50, 20, 10, 5, 2, 1].find((l) => l <= target) || 1;
    const px = len * this._pxPerMm, x0 = c.width - px - 12 * this._dpr, y = c.height - 10 * this._dpr - (this.ov.br.offsetHeight || 0) * this._dpr;
    this._line(ctx, [{ x: x0, y: y - 4 * this._dpr }, { x: x0, y }, { x: x0 + px, y }, { x: x0 + px, y: y - 4 * this._dpr }], '#ddd', 1);
    this._text(ctx, len >= 10 ? `${len / 10} cm` : `${len} mm`, x0 + px / 2, y - 18 * this._dpr, '#ddd', 'center');
  }

  _drawCrosshair(ctx) {
    const P = this.hooks.cursor3d?.();
    const f = this.frame;
    if (!P || !f.iop) return;
    const q = worldToImage(f, P);
    const tol = Math.max(f.sliceThickness || 0, this.set.step || 0, 2) * 1.01;
    if (this.set.kind !== 'mpr' && Math.abs(q.dist) > tol) return;
    const c = this.toCanvas(q), w = this.canvas.width, hgt = this.canvas.height, gap = 12 * this._dpr;
    this._line(ctx, [{ x: 0, y: c.y }, { x: c.x - gap, y: c.y }], 'rgba(90,220,255,.8)', 1);
    this._line(ctx, [{ x: c.x + gap, y: c.y }, { x: w, y: c.y }], 'rgba(90,220,255,.8)', 1);
    this._line(ctx, [{ x: c.x, y: 0 }, { x: c.x, y: c.y - gap }], 'rgba(255,170,60,.8)', 1);
    this._line(ctx, [{ x: c.x, y: c.y + gap }, { x: c.x, y: hgt }], 'rgba(255,170,60,.8)', 1);
  }

  /** Intersection of the reference (active) image plane with this image. */
  _drawReference(ctx) {
    const ref = this.hooks.referenceFrame?.(this);
    const f = this.frame;
    if (!ref || !f.iop || !ref.iop || ref === f) return;
    const corners = [[0.5, 0.5], [ref.cols + 0.5, 0.5], [ref.cols + 0.5, ref.rows + 0.5], [0.5, ref.rows + 0.5]]
      .map(([x, y]) => imageToWorld(ref, x, y)).map((P) => ({ P, q: worldToImage(f, P) }));
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      if ((a.q.dist > 0) === (b.q.dist > 0)) continue;
      const t = a.q.dist / (a.q.dist - b.q.dist);
      pts.push(this.toCanvas({ x: a.q.x + t * (b.q.x - a.q.x), y: a.q.y + t * (b.q.y - a.q.y) }));
    }
    if (pts.length === 2) this._line(ctx, pts, 'rgba(120,255,140,.85)', 1.2, [6 * this._dpr, 4 * this._dpr]);
  }

  _overlay() {
    const s = this.set, f = this.frame, o = this.ov;
    if (!s) { o.tl.textContent = o.tr.textContent = o.bl.textContent = o.br.textContent = ''; this.el.classList.add('empty'); return; }
    this.el.classList.remove('empty');
    const st = s.study, se = s.series, p = st.patient;
    o.tl.textContent = [p.name, `ID ${p.id}`, [p.sex, p.age].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    o.tr.textContent = [fmtDate(st.date), st.description, s.kind === 'mpr' ? `${s.label} · ${se.description || ''}` : `${se.number ?? ''} ${se.description || ''}`.trim()].filter(Boolean).join('\n');
    if (!f) { o.bl.textContent = T('Lade …', 'Loading …'); o.br.textContent = ''; return; }
    const v = this.view, lines = [`${T('Bild', 'Im')} ${this.index + 1}/${s.length}`];
    if (f.sliceThickness) lines.push(`${T('SD', 'ST')} ${fmtNum(f.sliceThickness, 1)} mm${f.slabCount > 1 ? ` (${f.slabMode.toUpperCase()})` : ''}`);
    if (!f.color) lines.push(`W ${fmtNum(v.ww, 0)}  L ${fmtNum(v.wc, 0)}`);
    lines.push(`Zoom ${fmtNum(v.zoom * 100, 0)} %`);
    if (this.hover) lines.push(this.hover);
    o.bl.textContent = lines.join('\n');
    const ds = f.ds, tech = [];
    if (f.modality === 'CT') { const kv = ds.number('00180060'), ma = ds.number('00181151'); if (kv) tech.push(`${fmtNum(kv, 0)} kV${ma ? ` · ${fmtNum(ma, 0)} mA` : ''}`); const k = ds.string('00181210'); if (k) tech.push(k); }
    if (f.modality === 'MR') { const tr = ds.number('00180080'), te = ds.number('00180081'); if (tr) tech.push(`TR ${fmtNum(tr, 0)}  TE ${fmtNum(te ?? NaN, 0)}`); }
    if (!f.calibrated) tech.push(T('nicht kalibriert', 'not calibrated'));
    else if (f.spacingSource === 'ImagerPixelSpacing') tech.push(T('Maße in Detektorebene', 'sizes at detector plane'));
    if (ds.string('00282110') === '01') tech.push(T('verlustbehaftet komprimiert', 'lossy compressed'));
    tech.push([ds.string('00080070'), ds.string('00081090')].filter((x) => x && !/^unknown/i.test(x)).join(' '));
    o.br.textContent = tech.filter(Boolean).join('\n');
  }

  setProgress(done, total) {
    this.progress.style.width = total && done < total ? `${(done / total) * 100}%` : '0';
  }

  // ----- interaction ----------------------------------------------------------------
  _hit(pt) {
    const list = this.currentAnnotations(), r = HANDLE * this._dpr;
    for (const a of [...list].reverse()) {
      const P = a.p.map((p) => this.toCanvas(p));
      for (let i = 0; i < P.length; i++) if (Math.hypot(P[i].x - pt.x, P[i].y - pt.y) <= r) return { a, handle: i };
      const near = (p, q) => {
        const L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const t = clamp(((pt.x - p.x) * (q.x - p.x) + (pt.y - p.y) * (q.y - p.y)) / (L * L), 0, 1);
        return Math.hypot(p.x + t * (q.x - p.x) - pt.x, p.y + t * (q.y - p.y) - pt.y) <= r;
      };
      if (a.type === 'length' || a.type === 'arrow' || a.type === 'angle') {
        for (let i = 0; i + 1 < P.length; i++) if (near(P[i], P[i + 1])) return { a, handle: -1 };
      } else if (a.type === 'rect' || a.type === 'ellipse') {
        const q = this.toImage(pt);
        const x0 = Math.min(a.p[0].x, a.p[1].x), x1 = Math.max(a.p[0].x, a.p[1].x), y0 = Math.min(a.p[0].y, a.p[1].y), y1 = Math.max(a.p[0].y, a.p[1].y);
        if (q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1) return { a, handle: -1 };
      }
    }
    return null;
  }

  _bind() {
    const el = this.el;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', () => { this.drag = null; });
    el.addEventListener('pointerleave', () => { this.hover = null; this._overlay(); });
    el.addEventListener('dblclick', () => this.hooks.onMaximize?.(this));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.frame) return;
      if (e.ctrlKey || e.metaKey) this._zoomAt(this.eventPoint(e), Math.exp(-e.deltaY * 0.0015));
      else { this._wheelAcc = (this._wheelAcc || 0) + e.deltaY; const steps = Math.trunc(this._wheelAcc / 40); if (steps) { this._wheelAcc -= steps * 40; this.scrollBy(Math.sign(steps) * Math.max(1, Math.abs(steps) >> 1)); } }
    }, { passive: false });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); this.hooks.onDrop?.(this, e.dataTransfer.getData('text/plain')); });
  }

  _zoomAt(pt, factor) {
    const v = this.view, c = this.canvas, z = clamp(v.zoom * factor, 0.1, 40), k = z / v.zoom;
    v.panX = (pt.x - c.width / 2) * (1 - k) + v.panX * k;
    v.panY = (pt.y - c.height / 2) * (1 - k) + v.panY * k;
    v.zoom = z;
    this.draw();
  }

  _down(e) {
    this.hooks.onActivate?.(this);
    if (!this.frame) return;
    this.el.setPointerCapture(e.pointerId);
    const pt = this.eventPoint(e), ip = this.toImage(pt);
    let tool = this.hooks.tool?.() || 'scroll';
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) tool = 'pan';
    else if (e.button === 2) tool = 'zoom';
    else if (e.button === 0 && e.ctrlKey) tool = 'wl';

    // Second click completes an angle.
    if (this.pending?.type === 'angle' && this.pending.stage === 2) {
      const a = this.pending; delete a.stage;
      this.pending = null; this.currentAnnotations().push(a); this.selected = a;
      this._changed(); return;
    }
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey) {
      const hit = this._hit(pt);
      if (hit && (!NAV_TOOLS.includes(tool) || hit.handle >= 0 || tool === 'scroll')) {
        this.selected = hit.a;
        this.drag = { kind: 'ann', a: hit.a, handle: hit.handle, last: ip, moved: false };
        this.draw(); return;
      }
      this.selected = null;
    }
    const v = this.view;
    this.drag = { kind: tool, start: pt, last: pt, v0: { ...v }, index0: this.index, acc: 0 };
    if (tool === 'crosshair') this._setCursor(ip);
    else if (tool === 'probe') {
      const a = { id: uid(), type: 'probe', p: [ip] };
      this.currentAnnotations().push(a); this.selected = a; this.drag = { kind: 'ann', a, handle: 0, last: ip, moved: true };
      countUse('tool.probe'); this._changed();
    } else if (['length', 'angle', 'ellipse', 'rect', 'arrow'].includes(tool)) {
      this.pending = { id: uid(), type: tool, p: [ip, { ...ip }] };
      this.drag = { kind: 'create', a: this.pending, start: pt, last: pt };
    }
    this.draw();
  }

  _setCursor(ip) {
    const P = imageToWorld(this.frame, ip.x, ip.y);
    if (P) this.hooks.onCursor3d?.(P, this);
  }

  _move(e) {
    if (!this.frame) return;
    const pt = this.eventPoint(e), ip = this.toImage(pt), d = this.drag, f = this.frame;
    // Hover readout.
    const x = Math.floor(ip.x), y = Math.floor(ip.y);
    if (x >= 0 && y >= 0 && x < f.cols && y < f.rows && !f.color) {
      const val = f.pixels[y * f.cols + x] * f.slope + f.intercept;
      this.hover = `X ${x} Y ${y}  ${fmtNum(val, Number.isInteger(val) ? 0 : 1)} ${f.units || ''}`;
    } else this.hover = null;
    if (this.pending?.stage === 2) { this.pending.p[2] = ip; this.draw(); return; }
    if (!d) { this._overlay(); return; }
    const dx = pt.x - d.last.x, dy = pt.y - d.last.y, v = this.view;
    switch (d.kind) {
      case 'scroll': {
        d.acc += dy;
        const stepPx = Math.max(3 * this._dpr, Math.min(14 * this._dpr, this.canvas.height / this.set.length));
        const n = Math.trunc(d.acc / stepPx);
        if (n) { d.acc -= n * stepPx; this.scrollBy(n); }
        break;
      }
      case 'wl': {
        if (f.color) break;
        const k = Math.max(0.02, d.v0.ww / 400) / this._dpr;
        this.setWindow(v.wc + dy * k, v.ww + dx * k);
        break;
      }
      case 'pan': v.panX += dx; v.panY += dy; this.draw(); break;
      case 'zoom': this._zoomAt(d.start, Math.exp(-dy * 0.006 / this._dpr)); break;
      case 'crosshair': this._setCursor(ip); break;
      case 'create': d.a.p[1] = ip; this.draw(); break;
      case 'ann': {
        d.moved = true;
        if (d.handle >= 0) d.a.p[d.handle] = ip;
        else { const ox = ip.x - d.last.x, oy = ip.y - d.last.y; d.a.p = d.a.p.map((p) => ({ x: p.x + ox, y: p.y + oy })); }
        d.last = ip; this.draw(); return;
      }
      default:
    }
    d.last = pt;
    this._overlay();
  }

  _up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'create') {
      const a = d.a, P = a.p.map((p) => this.toCanvas(p));
      if (Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y) < 4 * this._dpr) { this.pending = null; this.draw(); return; }
      countUse('tool.' + a.type);
      if (a.type === 'angle') { a.p[2] = { ...a.p[1] }; a.stage = 2; this.draw(); return; }
      if (a.type === 'arrow') a.text = (window.prompt(T('Beschriftung (optional):', 'Label (optional):'), '') || '').slice(0, 80);
      this.pending = null; this.currentAnnotations().push(a); this.selected = a;
      this._changed();
    } else if (d.kind === 'ann' && d.moved) this._changed();
    else if (d.kind === 'wl') countUse('tool.wl');
    else if (d.kind === 'zoom') countUse('tool.zoom');
    else if (d.kind === 'pan') countUse('tool.pan');
  }

  deleteSelected() {
    if (!this.selected) return false;
    const list = this.currentAnnotations(), i = list.indexOf(this.selected);
    if (i >= 0) list.splice(i, 1);
    this.selected = null; this._changed();
    return true;
  }

  _changed() { persistAnnotations(this.set); this.draw(); this.hooks.onAnnotations?.(this); }

  /** PNG of the viewport including annotations and a burned-in caption. */
  exportPng() {
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0);
    const s = this.set, pad = 8 * this._dpr;
    this._text(ctx, `${s.study.patient.id} · ${fmtDate(s.study.date)} · ${s.label} · ${this.index + 1}/${s.length}`, pad, pad, '#fff');
    return new Promise((res) => out.toBlob(res, 'image/png'));
  }
}
