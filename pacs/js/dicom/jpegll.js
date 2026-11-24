// JPEG Lossless (ITU-T T.81 Annex H, DICOM Process 14) decoder for 2..16-bit
// monochrome and 8-bit interleaved color images.
import { DicomError } from './parser.js';

export function decodeJpegLossless(data, info) {
  let p = 0;
  const u16 = () => { const v = (data[p] << 8) | data[p + 1]; p += 2; return v; };
  if (u16() !== 0xFFD8) throw new DicomError('Not a JPEG stream');
  const tables = [];
  let precision = 0, rows = 0, cols = 0, comps = [], restart = 0, out = null;

  while (p < data.length) {
    if (data[p] !== 0xFF) { p++; continue; }
    const marker = data[p + 1]; p += 2;
    if (marker === 0xD8 || marker === 0xFF || marker === 0x00) continue;
    if (marker === 0xD9) break;
    const len = u16(), segEnd = p + len - 2;
    if (marker === 0xC3) {
      precision = data[p]; rows = (data[p + 1] << 8) | data[p + 2]; cols = (data[p + 3] << 8) | data[p + 4];
      const n = data[p + 5];
      comps = [];
      for (let i = 0; i < n; i++) comps.push({ id: data[p + 6 + i * 3], table: 0 });
    } else if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      throw new DicomError('JPEG stream is not lossless (Process 14)');
    } else if (marker === 0xC4) {
      let q = p;
      while (q < segEnd) {
        const id = data[q] & 15; q++;
        const counts = data.subarray(q, q + 16); q += 16;
        let total = 0; for (let i = 0; i < 16; i++) total += counts[i];
        tables[id] = buildHuffman(counts, data.subarray(q, q + total));
        q += total;
      }
    } else if (marker === 0xDD) {
      restart = (data[p] << 8) | data[p + 1];
    } else if (marker === 0xDA) {
      const n = data[p];
      for (let i = 0; i < n; i++) {
        const c = comps.find((x) => x.id === data[p + 1 + i * 2]) || comps[i];
        c.table = data[p + 2 + i * 2] >> 4;
      }
      const predictor = data[p + 1 + n * 2], pt = data[p + 3 + n * 2] & 15;
      p = segEnd;
      out = decodeScan(n, predictor, pt);
      break;
    }
    p = segEnd;
  }
  if (!out) throw new DicomError('JPEG stream contains no scan');
  return out;

  function buildHuffman(counts, symbols) {
    // Canonical code tables: per length the first code, last code and symbol offset.
    const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
    let code = 0, k = 0;
    for (let l = 1; l <= 16; l++) {
      valptr[l] = k; mincode[l] = code;
      code += counts[l - 1]; k += counts[l - 1];
      maxcode[l] = counts[l - 1] ? code - 1 : -1;
      code <<= 1;
    }
    return { maxcode, valptr, mincode, symbols: Uint8Array.from(symbols) };
  }

  function decodeScan(ncomp, predictor, pt) {
    const n = rows * cols;
    if (rows !== info.rows || cols !== info.cols) throw new DicomError('JPEG dimensions differ from DICOM header');
    const Arr = precision <= 8 && info.bitsAllocated <= 8 ? (info.signed ? Int8Array : Uint8Array) : (info.signed ? Int16Array : Uint16Array);
    const res = new Uint16Array(n * ncomp);
    let bitBuf = 0, bitCnt = 0;
    const fill = () => {
      while (bitCnt <= 24) {
        let b = 0;
        if (p < data.length) {
          b = data[p];
          if (b === 0xFF) {
            const nx = data[p + 1];
            if (nx === 0x00) p += 2; else b = 0;         // marker: feed zeros, do not advance
          } else p++;
        }
        bitBuf |= b << (24 - bitCnt); bitCnt += 8;
      }
    };
    const bits = (k) => {
      if (k === 0) return 0;
      if (bitCnt < k) fill();
      const v = bitBuf >>> (32 - k);
      bitBuf <<= k; bitCnt -= k;
      return v;
    };
    const decodeDiff = (t) => {
      let code = 0, l = 0;
      do {
        code = (code << 1) | bits(1); l++;
      } while (l <= 16 && (t.maxcode[l] < 0 || code > t.maxcode[l]));
      if (l > 16) throw new DicomError('Corrupt JPEG Huffman code');
      const s = t.symbols[t.valptr[l] + code - t.mincode[l]];
      if (s === 0) return 0;
      if (s === 16) return 32768;
      const v = bits(s);
      return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v;
    };
    const initial = 1 << (precision - pt - 1);
    const interval = restart || n;
    let sinceRestart = 0, firstRowAfterRestart = true;
    for (let i = 0; i < n; i++) {
      const x = i % cols, y = (i / cols) | 0;
      if (i > 0 && sinceRestart === interval) {
        // Restart marker: byte-align and reset prediction.
        bitBuf = 0; bitCnt = 0;
        while (p < data.length - 1 && !(data[p] === 0xFF && data[p + 1] >= 0xD0 && data[p + 1] <= 0xD7)) p++;
        p += 2; sinceRestart = 0; firstRowAfterRestart = true;
      }
      if (sinceRestart > 0 && x === 0) firstRowAfterRestart = false;
      for (let c = 0; c < ncomp; c++) {
        const o = i * ncomp + c;
        let pred;
        if (sinceRestart === 0) pred = initial;
        else if (firstRowAfterRestart || y === 0) pred = x === 0 ? initial : res[o - ncomp];
        else if (x === 0) pred = res[o - cols * ncomp];
        else {
          const a = res[o - ncomp], b = res[o - cols * ncomp], cc = res[o - cols * ncomp - ncomp];
          switch (predictor) {
            case 1: pred = a; break;
            case 2: pred = b; break;
            case 3: pred = cc; break;
            case 4: pred = a + b - cc; break;
            case 5: pred = a + ((b - cc) >> 1); break;
            case 6: pred = b + ((a - cc) >> 1); break;
            case 7: pred = (a + b) >> 1; break;
            default: pred = 0;
          }
        }
        res[o] = (pred + decodeDiff(tables[comps[c].table])) & 0xFFFF;
      }
      sinceRestart++;
    }
    const out2 = new Arr(n * ncomp);
    if (pt) for (let i = 0; i < res.length; i++) out2[i] = res[i] << pt; else out2.set(res);
    return out2;
  }
}
