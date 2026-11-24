// Volume assembly and orthogonal multiplanar reformation (MPR) with slab projections.
import { T, add, scale, dot } from '../util.js';
import { planeOf } from '../archive.js';

export async function buildVolume(stack, onProgress) {
  const frames = await stack.loadAll(onProgress);
  if (frames.length < 5) throw new Error(T('Zu wenige Schichten für MPR', 'Too few slices for MPR'));
  const f0 = frames[0], p0 = planeOf(f0);
  if (!p0 || f0.color) throw new Error(T('Serie hat keine 3D-Geometrie', 'Series has no 3D geometry'));
  const items = [];
  for (const f of frames) {
    const p = planeOf(f);
    if (!p || f.rows !== f0.rows || f.cols !== f0.cols || Math.abs(dot(p.normal, p0.normal)) < 0.999) {
      throw new Error(T('Schichten sind nicht parallel/gleich groß', 'Slices are not parallel or differ in size'));
    }
    items.push({ f, pos: dot(f.ipp, p0.normal) });
  }
  items.sort((a, b) => a.pos - b.pos);
  const nz = items.length, nx = f0.cols, ny = f0.rows;
  const dz = (items[nz - 1].pos - items[0].pos) / (nz - 1);
  if (!(dz > 0)) throw new Error(T('Schichtpositionen nicht eindeutig', 'Slice positions are not distinct'));
  let uniform = true;
  for (let i = 1; i < nz; i++) if (Math.abs(items[i].pos - items[i - 1].pos - dz) > 0.1 * dz + 0.01) uniform = false;
  const sameScale = items.every((it) => it.f.slope === f0.slope && it.f.intercept === f0.intercept);
  const Arr = sameScale ? f0.pixels.constructor : Float32Array;
  const data = new Arr(nx * ny * nz);
  items.forEach((it, z) => {
    if (sameScale) data.set(it.f.pixels, z * nx * ny);
    else { const o = z * nx * ny, px = it.f.pixels; for (let i = 0; i < px.length; i++) data[o + i] = px[i] * it.f.slope + it.f.intercept; }
  });
  return {
    nx, ny, nz, dx: f0.colSpacing, dy: f0.rowSpacing, dz, data, uniform,
    slope: sameScale ? f0.slope : 1, intercept: sameScale ? f0.intercept : 0,
    row: p0.row, col: p0.col, normal: p0.normal, origin: items[0].f.ipp,
    wc: f0.wc, ww: f0.ww, ref: f0, stack,
  };
}

const AXIS_NAME = () => [T('Sagittal', 'Sagittal'), T('Koronar', 'Coronal'), T('Axial', 'Axial')];
function planeName(normal) {
  const a = normal.map(Math.abs);
  return AXIS_NAME()[a.indexOf(Math.max(...a))];
}

/**
 * Display set for one of the three orthogonal planes of a volume.
 * plane: 0 = acquisition plane, 1 = fixed row (y), 2 = fixed column (x).
 */
export function mprSet(vol, plane) {
  const { nx, ny, nz, dx, dy, dz, data } = vol;
  const negN = scale(vol.normal, -1);
  const geo = [
    { length: nz, cols: nx, rows: ny, colSpacing: dx, rowSpacing: dy, step: dz, iop: [...vol.row, ...vol.col], n: vol.normal },
    { length: ny, cols: nx, rows: nz, colSpacing: dx, rowSpacing: dz, step: dy, iop: [...vol.row, ...negN], n: vol.col },
    { length: nx, cols: ny, rows: nz, colSpacing: dy, rowSpacing: dz, step: dx, iop: [...vol.col, ...negN], n: vol.row },
  ][plane];
  const set = {
    kind: 'mpr', plane, vol, uid: `${vol.stack.uid}/mpr${plane}`, study: vol.stack.study, series: vol.stack.series,
    length: geo.length, label: `MPR ${planeName(geo.n)}`, slab: 1, slabMode: 'mip', step: geo.step,
    sopAt: (i) => `mpr${plane}:${i}`,
    /** Index of the reformatted image that contains world point P. */
    indexOfWorld(P) {
      const d = [P[0] - vol.origin[0], P[1] - vol.origin[1], P[2] - vol.origin[2]];
      if (plane === 0) return Math.round(nz - 1 - dot(d, vol.normal) / dz);
      if (plane === 1) return Math.round(dot(d, vol.col) / dy);
      return Math.round(dot(d, vol.row) / dx);
    },
    ippOf(i) {
      const top = add(vol.origin, scale(vol.normal, (nz - 1) * dz));
      if (plane === 0) return add(vol.origin, scale(vol.normal, (nz - 1 - i) * dz));
      if (plane === 1) return add(top, scale(vol.col, i * dy));
      return add(top, scale(vol.row, i * dx));
    },
    getFrame(i) {
      const half = Math.floor((set.slab - 1) / 2);
      const lo = Math.max(0, i - half), hi = Math.min(geo.length - 1, i + half);
      const n = geo.cols * geo.rows;
      let px;
      const extract = (k, out) => {
        if (plane === 0) { const z = nz - 1 - k; return data.subarray(z * nx * ny, (z + 1) * nx * ny); }
        if (plane === 1) {
          for (let r = 0; r < nz; r++) { const src = (nz - 1 - r) * nx * ny + k * nx; out.set(data.subarray(src, src + nx), r * nx); }
        } else {
          for (let r = 0; r < nz; r++) { let src = (nz - 1 - r) * nx * ny + k; const o = r * ny; for (let c = 0; c < ny; c++, src += nx) out[o + c] = data[src]; }
        }
        return out;
      };
      if (lo === hi) { px = extract(i, plane === 0 ? null : new data.constructor(n)); }
      else {
        const mode = set.slabMode;
        const acc = mode === 'avg' ? new Float32Array(n) : new data.constructor(n);
        const tmp = new data.constructor(n);
        for (let k = lo; k <= hi; k++) {
          const cur = extract(k, tmp);
          if (k === lo && mode !== 'avg') { acc.set(cur); continue; }
          if (mode === 'mip') for (let j = 0; j < n; j++) { if (cur[j] > acc[j]) acc[j] = cur[j]; }
          else if (mode === 'minip') for (let j = 0; j < n; j++) { if (cur[j] < acc[j]) acc[j] = cur[j]; }
          else for (let j = 0; j < n; j++) acc[j] += cur[j];
        }
        if (mode === 'avg') { const c = hi - lo + 1; for (let j = 0; j < n; j++) acc[j] /= c; }
        px = acc;
      }
      const ref = vol.ref;
      return Promise.resolve({
        pixels: px, rows: geo.rows, cols: geo.cols, samples: 1, color: false, slope: vol.slope, intercept: vol.intercept,
        photometric: 'MONOCHROME2', invertDefault: false, min: 0, max: 0,
        rowSpacing: geo.rowSpacing, colSpacing: geo.colSpacing, calibrated: true, spacingSource: 'MPR',
        iop: geo.iop, ipp: set.ippOf(i), wc: vol.wc, ww: vol.ww, ds: ref.ds, sop: set.sopAt(i),
        modality: ref.modality, units: ref.units, instanceNumber: i + 1, sliceThickness: geo.step * (hi - lo + 1),
        derived: true, slabCount: hi - lo + 1, slabMode: set.slabMode,
      });
    },
  };
  return set;
}
