// Pixel data decoding: native (uncompressed) 8/16/32-bit, RLE Lossless,
// JPEG Lossless (Process 14) and, in browsers, baseline JPEG via the platform decoder.
import { DicomError } from './parser.js';
import { decodeJpegLossless } from './jpegll.js';

const TS_RLE = '1.2.840.10008.1.2.5';
const TS_JPEG_BASELINE = new Set(['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51']);
const TS_JPEG_LOSSLESS = new Set(['1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70']);
const TS_NATIVE = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.1.99', '1.2.840.10008.1.2.2']);

export function imageInfo(ds) {
  const n = (t, d) => { const v = ds.number(t); return v === null ? d : v; };
  return {
    rows: n('00280010', 0), cols: n('00280011', 0),
    samples: n('00280002', 1), planar: n('00280006', 0),
    bitsAllocated: n('00280100', 16), bitsStored: n('00280101', n('00280100', 16)),
    signed: n('00280103', 0) === 1,
    photometric: ds.string('00280004') || 'MONOCHROME2',
    frames: Math.max(1, n('00280008', 1)),
    slope: n('00281053', 1) || 1, intercept: n('00281052', 0),
  };
}

function typedArray(info, length) {
  if (info.bitsAllocated <= 8) return info.signed ? new Int8Array(length) : new Uint8Array(length);
  if (info.bitsAllocated <= 16) return info.signed ? new Int16Array(length) : new Uint16Array(length);
  return info.signed ? new Int32Array(length) : new Uint32Array(length);
}

function decodeNative(ds, info, frame) {
  const e = ds.el['7FE00010'];
  const bps = Math.ceil(info.bitsAllocated / 8);
  const count = info.rows * info.cols * info.samples;
  const start = e.off + frame * count * bps;
  if (start + count * bps > e.off + e.len) throw new DicomError('Pixel data shorter than expected');
  const out = typedArray(info, count);
  if (bps === 1) { out.set(new out.constructor(ds.bytes.buffer, ds.bytes.byteOffset + start, count)); return out; }
  const copy = ds.bytes.slice(start, start + count * bps);      // aligned copy
  if (!e.le) {
    for (let i = 0; i < copy.length; i += bps) {
      for (let a = 0, b = bps - 1; a < b; a++, b--) { const t = copy[i + a]; copy[i + a] = copy[i + b]; copy[i + b] = t; }
    }
  }
  return new out.constructor(copy.buffer, 0, count);
}

function frameFragment(ds, frame, frames) {
  const e = ds.el['7FE00010'];
  if (!e.fragments?.length) throw new DicomError('No encapsulated pixel data');
  if (frames === 1) {
    if (e.fragments.length === 1) { const f = e.fragments[0]; return ds.bytes.subarray(f.off, f.off + f.len); }
    const total = e.fragments.reduce((s, f) => s + f.len, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const f of e.fragments) { out.set(ds.bytes.subarray(f.off, f.off + f.len), o); o += f.len; }
    return out;
  }
  if (e.fragments.length !== frames) throw new DicomError('Multi-frame images with fragmented frames are not supported');
  const f = e.fragments[frame];
  return ds.bytes.subarray(f.off, f.off + f.len);
}

function decodeRle(ds, info, frame) {
  const data = frameFragment(ds, frame, info.frames);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nseg = view.getUint32(0, true);
  const bps = Math.ceil(info.bitsAllocated / 8);
  const npx = info.rows * info.cols;
  if (nseg !== bps * info.samples) throw new DicomError('Unexpected RLE segment count');
  const bytes = new Uint8Array(npx * bps * info.samples);
  for (let s = 0; s < nseg; s++) {
    let p = view.getUint32(4 + 4 * s, true);
    const end = s + 1 < nseg ? view.getUint32(8 + 4 * s, true) : data.length;
    const sample = Math.floor(s / bps), byteIdx = bps - 1 - (s % bps);     // most significant byte first
    const stride = bps * info.samples;
    let o = sample * bps + byteIdx, written = 0;
    while (p < end && written < npx) {
      const c = view.getInt8(p++);
      if (c >= 0) {
        for (let i = 0; i <= c && written < npx; i++, written++, o += stride) bytes[o] = data[p + i];
        p += c + 1;
      } else if (c !== -128) {
        const v = data[p++];
        for (let i = 0; i < 1 - c && written < npx; i++, written++, o += stride) bytes[o] = v;
      }
    }
  }
  const out = typedArray(info, npx * info.samples);
  return new out.constructor(bytes.buffer, 0, npx * info.samples);       // interleaved, little endian
}

async function decodeJpegBaseline(ds, info, frame) {
  if (typeof createImageBitmap !== 'function') throw new DicomError('JPEG decoding requires a browser');
  const data = frameFragment(ds, frame, info.frames);
  const bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  const rgba = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const n = bmp.width * bmp.height;
  const out = new Uint8Array(n * info.samples);
  if (info.samples === 1) for (let i = 0; i < n; i++) out[i] = rgba[i * 4];
  else for (let i = 0; i < n; i++) { out[i * 3] = rgba[i * 4]; out[i * 3 + 1] = rgba[i * 4 + 1]; out[i * 3 + 2] = rgba[i * 4 + 2]; }
  return out;
}

/**
 * Decodes one frame. Returns { pixels, rows, cols, samples, color, slope, intercept,
 * photometric, min, max } where pixels are stored values (monochrome) or
 * interleaved RGB bytes (color).
 */
export async function decodeFrame(ds, frame = 0) {
  const info = imageInfo(ds);
  if (!ds.el['7FE00010']) throw new DicomError('Object contains no pixel data');
  if (!info.rows || !info.cols) throw new DicomError('Missing image dimensions');
  const ts = ds.transferSyntax;
  let pixels, planar = info.planar, photometric = info.photometric;
  if (ds.el['7FE00010'].fragments) {
    if (ts === TS_RLE) { pixels = decodeRle(ds, info, frame); planar = 0; }
    else if (TS_JPEG_LOSSLESS.has(ts)) { pixels = decodeJpegLossless(frameFragment(ds, frame, info.frames), info); planar = 0; }
    else if (TS_JPEG_BASELINE.has(ts)) { pixels = await decodeJpegBaseline(ds, info, frame); planar = 0; if (info.samples === 3) photometric = 'RGB'; }
    else throw new DicomError(`Unsupported transfer syntax ${ts}`);
  } else {
    if (!TS_NATIVE.has(ts)) throw new DicomError(`Unsupported transfer syntax ${ts}`);
    pixels = decodeNative(ds, info, frame);
  }
  const npx = info.rows * info.cols;
  const out = { rows: info.rows, cols: info.cols, samples: info.samples, color: info.samples === 3,
    slope: info.slope, intercept: info.intercept, photometric, min: 0, max: 255 };

  if (info.samples === 3) {
    let rgb = pixels;
    if (planar === 1) {
      rgb = new Uint8Array(npx * 3);
      for (let i = 0; i < npx; i++) { rgb[i * 3] = pixels[i]; rgb[i * 3 + 1] = pixels[npx + i]; rgb[i * 3 + 2] = pixels[2 * npx + i]; }
    }
    if (photometric.startsWith('YBR_FULL')) {
      if (rgb === pixels) rgb = new Uint8Array(pixels);
      for (let i = 0; i < npx * 3; i += 3) {
        const y = rgb[i], cb = rgb[i + 1] - 128, cr = rgb[i + 2] - 128;
        rgb[i] = Math.max(0, Math.min(255, y + 1.402 * cr));
        rgb[i + 1] = Math.max(0, Math.min(255, y - 0.344136 * cb - 0.714136 * cr));
        rgb[i + 2] = Math.max(0, Math.min(255, y + 1.772 * cb));
      }
    }
    out.pixels = rgb;
    return out;
  }

  if (photometric === 'PALETTE COLOR') {
    const desc = ds.numbers('00281101');
    const size = desc[0] || 65536, first = desc[1] || 0, bits = desc[2] || 16;
    const lut = ['00281201', '00281202', '00281203'].map((t) => {
      const raw = ds.raw(t);
      if (!raw) throw new DicomError('Palette lookup table missing');
      if (raw.length >= size * 2) { const c = raw.slice(0, size * 2); return new Uint16Array(c.buffer, 0, size); }
      return raw;
    });
    const shift = lut[0] instanceof Uint16Array ? bits - 8 : 0;
    const rgb = new Uint8Array(npx * 3);
    for (let i = 0; i < npx; i++) {
      const k = Math.max(0, Math.min(size - 1, pixels[i] - first));
      rgb[i * 3] = lut[0][k] >> shift; rgb[i * 3 + 1] = lut[1][k] >> shift; rgb[i * 3 + 2] = lut[2][k] >> shift;
    }
    out.pixels = rgb; out.color = true; out.samples = 3; out.photometric = 'RGB';
    return out;
  }

  // Monochrome: mask unused high bits (legacy overlays) and compute the value range.
  if (info.bitsStored < info.bitsAllocated && info.bitsAllocated <= 16) {
    const mask = (1 << info.bitsStored) - 1, sign = 1 << (info.bitsStored - 1);
    if (info.signed) for (let i = 0; i < npx; i++) { const v = pixels[i] & mask; pixels[i] = v & sign ? v - (mask + 1) : v; }
    else for (let i = 0; i < npx; i++) pixels[i] &= mask;
  }
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < npx; i++) { const v = pixels[i]; if (v < min) min = v; if (v > max) max = v; }
  out.pixels = pixels; out.min = min; out.max = max;
  return out;
}
