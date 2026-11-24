// DICOM Part 10 parser. Works in browsers and in Node (no dependencies).
// Supports Implicit/Explicit VR Little Endian, Explicit VR Big Endian, Deflated
// Explicit VR Little Endian, nested sequences (defined and undefined length)
// and encapsulated pixel data.
import { DICT } from './dict.js';

const LONG_VR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT', 'SV', 'UV']);
const TEXT_VR = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT']);
const UNDEF = 0xFFFFFFFF;
const DEFLATED = '1.2.840.10008.1.2.1.99';
const BIG_ENDIAN = '1.2.840.10008.1.2.2';
const IMPLICIT = '1.2.840.10008.1.2';

export class DicomError extends Error {}

export class DataSet {
  constructor(bytes, view) {
    this.bytes = bytes;
    this.view = view;
    this.el = {};            // 'GGGGEEEE' -> { vr, off, len, le, items?, fragments? }
    this.charset = 'latin1';
    this.transferSyntax = IMPLICIT;
  }

  has(tag) { return tag in this.el; }

  raw(tag) {
    const e = this.el[tag];
    if (!e || e.items || e.len <= 0) return null;
    return this.bytes.subarray(e.off, e.off + e.len);
  }

  text(tag) {
    const raw = this.raw(tag);
    if (!raw) return '';
    let s;
    try { s = new TextDecoder(this.charset).decode(raw); } catch { s = new TextDecoder('latin1').decode(raw); }
    return s.replace(/[\0 ]+$/, '');
  }

  strings(tag) {
    const e = this.el[tag];
    if (!e) return [];
    const s = this.text(tag);
    if (s === '') return [];
    return (e.vr === 'LT' || e.vr === 'ST' || e.vr === 'UT') ? [s] : s.split('\\').map((x) => x.trim());
  }

  string(tag, i = 0) { return this.strings(tag)[i] ?? ''; }

  numbers(tag) {
    const e = this.el[tag];
    if (!e || e.items || e.len <= 0) return [];
    const v = this.view, le = e.le, out = [];
    const each = (size, fn) => { for (let o = e.off; o + size <= e.off + e.len; o += size) out.push(fn(o)); };
    switch (e.vr) {
      case 'US': each(2, (o) => v.getUint16(o, le)); break;
      case 'SS': each(2, (o) => v.getInt16(o, le)); break;
      case 'UL': each(4, (o) => v.getUint32(o, le)); break;
      case 'SL': each(4, (o) => v.getInt32(o, le)); break;
      case 'FL': each(4, (o) => v.getFloat32(o, le)); break;
      case 'FD': each(8, (o) => v.getFloat64(o, le)); break;
      case 'AT': each(4, (o) => v.getUint16(o, le) * 65536 + v.getUint16(o + 2, le)); break;
      case 'OB': case 'OW': case 'UN':
        // Unknown VR (implicit, private tag): try text first, then a short binary guess.
        if (/^[\d\s+\-.eE\\]+$/.test(this.text(tag))) return this.text(tag).split('\\').map(Number).filter((n) => !Number.isNaN(n));
        if (e.len === 2) out.push(v.getUint16(e.off, le));
        else if (e.len === 4) out.push(v.getUint32(e.off, le));
        break;
      default:
        return this.strings(tag).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
    }
    return out;
  }

  number(tag, i = 0) { const n = this.numbers(tag)[i]; return n === undefined ? null : n; }

  items(tag) { return this.el[tag]?.items || []; }

  /** Person name formatted "Family, Given". */
  personName(tag) {
    const s = this.string(tag).split('=')[0];
    const [fam, giv, mid] = s.split('^');
    return [fam, [giv, mid].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }

  /** Human-readable value for the tag browser. */
  display(tag, max = 120) {
    const e = this.el[tag];
    if (!e) return '';
    if (e.items) return `Sequence (${e.items.length} item${e.items.length === 1 ? '' : 's'})`;
    if (e.fragments) return `Encapsulated pixel data (${e.fragments.length} fragment${e.fragments.length === 1 ? '' : 's'})`;
    if (TEXT_VR.has(e.vr)) return this.text(tag).slice(0, max);
    if (['US', 'SS', 'UL', 'SL', 'FL', 'FD'].includes(e.vr)) return this.numbers(tag).slice(0, 16).join('\\');
    if (e.vr === 'AT') return this.numbers(tag).map((n) => n.toString(16).padStart(8, '0').toUpperCase()).join('\\');
    if (e.vr === 'UN' && e.len <= 64) {
      const t = this.text(tag);
      if (/^[\x20-\x7e]*$/.test(t)) return t;
    }
    return `Binary data (${e.len} bytes)`;
  }
}

function tagAt(view, off, le) {
  const g = view.getUint16(off, le), e = view.getUint16(off + 2, le);
  return (g.toString(16).padStart(4, '0') + e.toString(16).padStart(4, '0')).toUpperCase();
}

function isVr(bytes, off) {
  const a = bytes[off], b = bytes[off + 1];
  return a >= 65 && a <= 90 && b >= 65 && b <= 90;
}

/**
 * Reads data elements into `ds` from `off` up to `end`.
 * Returns the offset after the last byte consumed.
 */
function readElements(ds, off, end, ctx, depth = 0) {
  const { bytes, view } = ds;
  const le = ctx.le;
  if (depth > 32) throw new DicomError('Sequence nesting too deep');
  while (off + 8 <= end) {
    const tag = tagAt(view, off, le);
    if (tag === 'FFFEE00D' || tag === 'FFFEE0DD') return off + 8;       // item / sequence delimiter
    if (ctx.metaOnly && tag.slice(0, 4) !== '0002') return off;
    if (ctx.stopBefore && tag >= ctx.stopBefore) return off;
    let vr, len, hdr;
    if (ctx.explicit && isVr(bytes, off + 4)) {
      vr = String.fromCharCode(bytes[off + 4], bytes[off + 5]);
      if (LONG_VR.has(vr)) { len = view.getUint32(off + 8, le); hdr = 12; }
      else { len = view.getUint16(off + 6, le); hdr = 8; }
    } else {
      len = view.getUint32(off + 4, le); hdr = 8;
      vr = DICT[tag]?.[0] || (tag.slice(4) === '0000' ? 'UL' : 'UN');
    }
    off += hdr;
    const e = { vr, off, len, le };
    if (tag === '7FE00010' && len === UNDEF) {
      // Encapsulated pixel data: basic offset table followed by fragments.
      e.fragments = [];
      let first = true;
      while (off + 8 <= end) {
        const t = tagAt(view, off, le), l = view.getUint32(off + 4, le);
        off += 8;
        if (t !== 'FFFEE000') break;
        if (first) { e.offsetTable = { off, len: l }; first = false; } else e.fragments.push({ off, len: l });
        off += l;
      }
      e.len = 0;
    } else if (vr === 'SQ' || len === UNDEF) {
      // Sequences nested in an element of unknown VR are always Implicit VR Little Endian.
      const sub = (vr === 'UN' && ctx.explicit) ? { explicit: false, le: true } : { explicit: ctx.explicit, le: ctx.le };
      const seqEnd = len === UNDEF ? end : Math.min(end, off + len);
      e.vr = 'SQ';
      e.items = [];
      while (off + 8 <= seqEnd) {
        const t = tagAt(view, off, sub.le), l = view.getUint32(off + 4, sub.le);
        off += 8;
        if (t === 'FFFEE0DD') break;
        if (t !== 'FFFEE000') throw new DicomError(`Unexpected tag ${t} in sequence ${tag}`);
        const item = new DataSet(bytes, view);
        item.charset = ds.charset;
        if (l === UNDEF) off = readElements(item, off, seqEnd, sub, depth + 1);
        else { readElements(item, off, Math.min(seqEnd, off + l), sub, depth + 1); off += l; }
        e.items.push(item);
      }
      if (len !== UNDEF) off = seqEnd;
      e.len = 0;
    } else {
      if (off + len > end) {
        if (tag === '7FE00010') e.len = end - off; else throw new DicomError(`Element ${tag} exceeds file size`);
      }
      off += e.len;
    }
    ds.el[tag] = e;
    if (tag === '00080005') ds.charset = charsetOf(ds);
  }
  return off;
}

function charsetOf(ds) {
  const cs = new TextDecoder('latin1').decode(ds.raw('00080005') || new Uint8Array()).trim().split('\\').pop().trim();
  const map = {
    'ISO_IR 192': 'utf-8', 'ISO_IR 100': 'latin1', 'ISO_IR 101': 'iso-8859-2', 'ISO_IR 109': 'iso-8859-3',
    'ISO_IR 110': 'iso-8859-4', 'ISO_IR 144': 'iso-8859-5', 'ISO_IR 127': 'iso-8859-6', 'ISO_IR 126': 'iso-8859-7',
    'ISO_IR 138': 'iso-8859-8', 'ISO_IR 148': 'iso-8859-9', 'ISO_IR 13': 'shift-jis', 'GB18030': 'gb18030', 'GBK': 'gbk',
  };
  return map[cs] || 'latin1';
}

function readMeta(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ds = new DataSet(bytes, view);
  let off = 0;
  const hasPreamble = bytes.length >= 132 && bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77;
  if (hasPreamble) {
    off = readElements(ds, 132, bytes.length, { explicit: true, le: true, metaOnly: true });
    ds.transferSyntax = ds.string('00020010') || IMPLICIT;
  } else {
    if (bytes.length < 8) throw new DicomError('Not a DICOM file');
    // Raw data set without Part 10 header: guess the encoding from the first element.
    const g = view.getUint16(0, true);
    if (g > 0x0008 || g === 0) throw new DicomError('Not a DICOM file');
    ds.transferSyntax = isVr(bytes, 4) ? '1.2.840.10008.1.2.1' : IMPLICIT;
  }
  return { ds, off };
}

function readBody(ds, off, opts) {
  const ts = ds.transferSyntax;
  readElements(ds, off, ds.bytes.length, { explicit: ts !== IMPLICIT, le: ts !== BIG_ENDIAN, stopBefore: opts.stopBefore });
  return ds;
}

/** Synchronous parse. Throws for the deflated transfer syntax (use parseDicomAsync). */
export function parseDicom(buffer, opts = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { ds, off } = readMeta(bytes);
  if (ds.transferSyntax === DEFLATED) throw new DicomError('Deflated transfer syntax requires parseDicomAsync');
  return readBody(ds, off, opts);
}

export async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parse including the deflated transfer syntax. */
export async function parseDicomAsync(buffer, opts = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { ds, off } = readMeta(bytes);
  if (ds.transferSyntax !== DEFLATED) return readBody(ds, off, opts);
  const body = await inflateRaw(bytes.subarray(off));
  const all = new Uint8Array(off + body.length);
  all.set(bytes.subarray(0, off));
  all.set(body, off);
  const re = readMeta(all);
  return readBody(re.ds, re.off, opts);
}
