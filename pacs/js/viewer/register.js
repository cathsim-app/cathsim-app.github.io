// Automatic longitudinal alignment of two parallel image stacks (current vs prior study).
// The stacks usually have different frames of reference, so slice positions cannot be compared
// directly. For every slice a few anatomical profiles are computed (body, dense and air-like
// cross-sectional area, in-plane centroid); the cranio-caudal offset is the shift that
// maximises the normalised cross-correlation of these profiles combined with the correlation
// of downsampled, centroid-aligned images of the candidate slice pairs.
import { dot } from '../util.js';
import { planeOf } from '../archive.js';

const STEP = 3;                       // pixel subsampling

function sliceFeatures(f, thr) {
  const px = f.pixels, s = f.slope, b = f.intercept;
  let body = 0, dense = 0, air = 0, sx = 0, sy = 0;
  for (let y = 0; y < f.rows; y += STEP) {
    for (let x = 0, i = y * f.cols; x < f.cols; x += STEP, i += STEP) {
      const v = px[i] * s + b;
      if (v > thr.body) { body++; sx += x; sy += y; if (v > thr.dense) dense++; } else if (v > thr.airLo) air++;
    }
  }
  const a = STEP * STEP * f.rowSpacing * f.colSpacing;
  return { body: body * a, dense: dense * a, air: air * a, cx: body ? sx / body : f.cols / 2, cy: body ? sy / body : f.rows / 2 };
}

function thresholds(frames) {
  if (frames[0].modality === 'CT') return { body: -300, dense: 200, airLo: -950 };
  // Other modalities: thresholds relative to a robust maximum of the middle slice.
  const f = frames[frames.length >> 1], vals = [];
  for (let i = 0; i < f.pixels.length; i += 37) vals.push(f.pixels[i] * f.slope + f.intercept);
  vals.sort((p, q) => p - q);
  const hi = vals[Math.floor(vals.length * 0.99)] || 1;
  return { body: hi * 0.12, dense: hi * 0.55, airLo: Infinity };
}

const N = 40;                         // side length of the comparison patches

/** Downsampled patch of fixed physical size centred on the body centroid. */
function patch(f, cx, cy, fov, ct) {
  const out = new Float32Array(N * N), px = f.pixels, s = f.slope, b = f.intercept;
  for (let j = 0; j < N; j++) {
    const y = Math.round(cy + ((j + 0.5) / N - 0.5) * fov / f.rowSpacing);
    for (let i = 0; i < N; i++) {
      const x = Math.round(cx + ((i + 0.5) / N - 0.5) * fov / f.colSpacing);
      let v = x >= 0 && y >= 0 && x < f.cols && y < f.rows ? px[y * f.cols + x] * s + b : (ct ? -1000 : 0);
      if (ct) v = v < -1000 ? -1000 : v > 600 ? 600 : v;
      out[j * N + i] = v;
    }
  }
  return out;
}

/** Profiles of a loaded stack, ordered by position along `axis`. */
export function profileOf(frames, axis) {
  const thr = thresholds(frames);
  return frames.map((f, index) => ({ index, f, z: dot(f.ipp, axis), ...sliceFeatures(f, thr) })).sort((p, q) => p.z - q.z);
}

function sampler(profile, key) {
  return (z) => {
    if (z < profile[0].z || z > profile[profile.length - 1].z) return null;
    let lo = 0, hi = profile.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (profile[m].z <= z) lo = m; else hi = m; }
    const p = profile[lo], q = profile[hi], t = q.z === p.z ? 0 : (z - p.z) / (q.z - p.z);
    return p[key] + t * (q[key] - p[key]);
  };
}

function ncc(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * Registers stack B (prior) to stack A (current). Both must be fully loaded.
 * Returns { ok, offset, sign, score, axis } so that for a position zA along A's normal the
 * matching position along the same axis in B is zA + offset.
 */
export function registerStacks(framesA, framesB) {
  const pa = planeOf(framesA[0]), pb = planeOf(framesB[0]);
  if (!pa || !pb || framesA.length < 8 || framesB.length < 8) return { ok: false, reason: 'geometry' };
  const align = dot(pa.normal, pb.normal);
  if (Math.abs(align) < 0.85) return { ok: false, reason: 'orientation' };
  const axis = pa.normal;
  const A = profileOf(framesA, axis), B = profileOf(framesB, axis);
  const lenA = A[A.length - 1].z - A[0].z, lenB = B[B.length - 1].z - B[0].z;
  const shorter = Math.min(lenA, lenB);
  const minOverlap = Math.min(Math.max(40, 0.45 * shorter), 0.8 * shorter);
  const dz = Math.max(0.5, Math.min(2, shorter / 40));
  const keys = ['body', 'dense', 'air'].filter((k) => A.some((p) => p[k] > 0) && B.some((p) => p[k] > 0));
  const sa = Object.fromEntries(keys.map((k) => [k, sampler(A, k)])), sb = Object.fromEntries(keys.map((k) => [k, sampler(B, k)]));
  // Image patches (same physical field of view in both stacks, flipped to a common orientation).
  const ct = framesA[0].modality === 'CT';
  const fov = 0.9 * Math.min(framesA[0].cols * framesA[0].colSpacing, framesA[0].rows * framesA[0].rowSpacing, framesB[0].cols * framesB[0].colSpacing, framesB[0].rows * framesB[0].rowSpacing);
  const flipX = dot(pa.row, pb.row) < 0, flipY = dot(pa.col, pb.col) < 0;
  for (const p of A) p.patch = patch(p.f, p.cx, p.cy, fov, ct);
  for (const p of B) {
    const q = patch(p.f, p.cx, p.cy, fov, ct);
    if (flipX || flipY) {
      const r = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) r[j * N + i] = q[(flipY ? N - 1 - j : j) * N + (flipX ? N - 1 - i : i)];
      p.patch = r;
    } else p.patch = q;
  }
  const nearest = (profile, z) => { let lo = 0, hi = profile.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (profile[m].z <= z) lo = m; else hi = m; } return Math.abs(profile[lo].z - z) <= Math.abs(profile[hi].z - z) ? profile[lo] : profile[hi]; };
  let best = { score: -2, offset: 0 }, second = -2;
  const far = Math.max(4, 0.15 * shorter);
  const lo = B[0].z - A[A.length - 1].z + minOverlap, hi = B[B.length - 1].z - A[0].z - minOverlap;
  for (let d = lo; d <= hi; d += dz / 2) {
    const z0 = Math.max(A[0].z, B[0].z - d), z1 = Math.min(A[A.length - 1].z, B[B.length - 1].z - d);
    if (z1 - z0 < minOverlap) continue;
    let total = 0;
    for (const k of keys) {
      const va = [], vb = [];
      for (let z = z0; z <= z1; z += dz) { const x = sa[k](z), y = sb[k](z + d); if (x !== null && y !== null) { va.push(x); vb.push(y); } }
      total += va.length > 5 ? ncc(va, vb) : 0;
    }
    // Image agreement at up to 12 levels spread over the overlap.
    let img = 0, cnt = 0;
    for (let k = 0; k < 12; k++) {
      const z = z0 + (k + 0.5) / 12 * (z1 - z0);
      img += ncc(nearest(A, z).patch, nearest(B, z + d).patch); cnt++;
    }
    const score = 0.7 * (img / cnt) + 0.3 * (total / keys.length);
    if (score > best.score) { if (Math.abs(d - best.offset) > far) second = best.score; best = { score, offset: d }; } else if (score > second && Math.abs(d - best.offset) > far) second = score;
  }
  if (best.score < 0.35) return { ok: false, reason: 'no match', score: best.score };
  // In-plane: mean centroid difference over the overlap (mm, in each image's own axes).
  const ca = sampler(A, 'cx'), cay = sampler(A, 'cy'), cb = sampler(B, 'cx'), cby = sampler(B, 'cy');
  // Index mapping between the stacks. Positions are measured along A's normal for both stacks,
  // which also holds when the two acquisitions are tilted differently.
  const zOfA = new Map(A.map((p) => [p.index, p.z])), zOfB = new Map(B.map((p) => [p.index, p.z]));
  const aToB = (i) => nearest(B, zOfA.get(i) + best.offset).index, bToA = (i) => nearest(A, zOfB.get(i) - best.offset).index;
  return { ok: true, offset: best.offset, score: best.score, margin: best.score - second, axis, sign: Math.sign(align), aToB, bToA, zOfA,
    centroid: (zA) => ({ a: { x: ca(zA), y: cay(zA) }, b: { x: cb(zA + best.offset), y: cby(zA + best.offset) } }) };
}
