// Grayscale/colour rendering of a decoded frame into a canvas (VOI window applied).
const lutCache = new WeakMap();

export function renderFrame(frame, wc, ww, invert, canvas) {
  if (canvas.width !== frame.cols || canvas.height !== frame.rows) { canvas.width = frame.cols; canvas.height = frame.rows; }
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(frame.cols, frame.rows);
  const out = new Uint32Array(img.data.buffer);
  const px = frame.pixels, n = frame.cols * frame.rows;
  if (frame.color) {
    for (let i = 0, j = 0; i < n; i++, j += 3) out[i] = 0xFF000000 | (px[j + 2] << 16) | (px[j + 1] << 8) | px[j];
  } else {
    const inv = invert !== !!frame.invertDefault;
    const lo = wc - ww / 2, k = 255 / Math.max(ww, 1e-6);
    const map = (v) => {
      let g = (v * frame.slope + frame.intercept - lo) * k;
      g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      if (inv) g = 255 - g;
      return 0xFF000000 | (g << 16) | (g << 8) | g;
    };
    const integer = !(px instanceof Float32Array) && !(px instanceof Float64Array) && px.BYTES_PER_ELEMENT <= 2;
    if (integer) {
      // Table lookup over the full stored-value range of the pixel type.
      const signed = px instanceof Int16Array || px instanceof Int8Array;
      const size = px.BYTES_PER_ELEMENT === 1 ? 256 : 65536, off = signed ? size / 2 : 0;
      let c = lutCache.get(canvas);
      const key = `${wc}|${ww}|${inv}|${frame.slope}|${frame.intercept}|${size}|${signed}`;
      if (!c || c.key !== key) {
        const table = new Uint32Array(size);
        for (let i = 0; i < size; i++) table[i] = map(i - off);
        c = { key, table };
        lutCache.set(canvas, c);
      }
      const t = c.table;
      for (let i = 0; i < n; i++) out[i] = t[px[i] + off];
    } else {
      for (let i = 0; i < n; i++) out[i] = map(px[i]);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Small preview canvas for the series panel. */
export function thumbnail(frame, size = 96) {
  const full = renderFrame(frame, frame.wc ?? 128, frame.ww ?? 256, false, document.createElement('canvas'));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  const w = frame.cols * frame.colSpacing, hgt = frame.rows * frame.rowSpacing, s = size / Math.max(w, hgt);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, (size - w * s) / 2, (size - hgt * s) / 2, w * s, hgt * s);
  return cv;
}
