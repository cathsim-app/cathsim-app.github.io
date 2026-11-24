// Archive access: study index, object retrieval (static store or local import),
// decoding and an in-memory frame cache.
import { parseDicomAsync, gunzip } from './dicom/parser.js';
import { decodeFrame, imageInfo } from './dicom/pixel.js';
import { cross, dot } from './util.js';
import { recordTiming } from './store.js';

let index = null;
const localStudies = new Map();          // studies imported from disk in this browser
const localFiles = new Map();            // sop -> File/Blob

export async function loadIndex() {
  if (index) return index;
  const r = await fetch('data/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Study index not available');
  index = await r.json();
  await restoreLocal();
  return index;
}

export function allStudies() {
  return [...(index?.studies || []), ...localStudies.values()];
}
export const findStudy = (uid) => allStudies().find((s) => s.uid === uid);
export function priorsOf(study) {
  return allStudies().filter((s) => s.patient.id === study.patient.id && s.uid !== study.uid)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// --- object retrieval ------------------------------------------------------------
const dsCache = new Map();               // sop -> Promise<DataSet>
const frameCache = new Map();            // sop#frame -> Promise<Frame>
let cacheBytes = 0;
const CACHE_LIMIT = 900e6;
const pinned = new Set();                // series uids currently displayed

export function pinSeries(uids) { pinned.clear(); uids.forEach((u) => pinned.add(u)); }

function evict() {
  if (cacheBytes < CACHE_LIMIT) return;
  for (const [key, entry] of frameCache) {
    if (cacheBytes < CACHE_LIMIT * 0.7) break;
    if (pinned.has(entry.seriesUid)) continue;
    frameCache.delete(key); dsCache.delete(entry.sop);
    cacheBytes -= entry.bytes || 0;
  }
}

async function fetchObject(study, series, inst) {
  if (inst.local) {
    const blob = localFiles.get(inst.sop);
    if (!blob) throw new Error('Local object no longer available');
    return new Uint8Array(await blob.arrayBuffer());
  }
  const url = `data/studies/${study.key}/${series.key}/${inst.f}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      // Some hosts transparently decode gzip; detect by magic number.
      return buf[0] === 0x1f && buf[1] === 0x8b ? gunzip(buf) : buf;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
}

export function getDataSet(study, series, inst) {
  let p = dsCache.get(inst.sop);
  if (!p) {
    p = fetchObject(study, series, inst).then((bytes) => parseDicomAsync(bytes));
    p.catch(() => dsCache.delete(inst.sop));
    dsCache.set(inst.sop, p);
  }
  return p;
}

function spacingOf(ds) {
  let sp = ds.numbers('00280030'), calibrated = true, source = 'PixelSpacing';
  if (sp.length !== 2) { sp = ds.numbers('00181164'); source = 'ImagerPixelSpacing'; }
  if (sp.length !== 2 || !(sp[0] > 0) || !(sp[1] > 0)) { sp = [1, 1]; calibrated = false; source = 'none'; }
  return { rowSpacing: sp[0], colSpacing: sp[1], calibrated, spacingSource: source };
}

/** Returns a display-ready frame (pixels + geometry + display defaults). */
export function getFrame(study, series, inst, frameNo = 0) {
  const key = inst.sop + '#' + frameNo;
  let entry = frameCache.get(key);
  if (!entry) {
    entry = { sop: inst.sop, seriesUid: series.uid, bytes: 0 };
    entry.promise = (async () => {
      const ds = await getDataSet(study, series, inst);
      const px = await decodeFrame(ds, frameNo);
      const iop = ds.numbers('00200037'), ipp = ds.numbers('00200032');
      const frame = {
        ...px, ...spacingOf(ds), ds, sop: inst.sop,
        iop: iop.length === 6 ? iop : null, ipp: ipp.length === 3 ? ipp : null,
        wc: ds.number('00281050'), ww: ds.number('00281051'),
        modality: ds.string('00080060'), units: ds.string('00281054') || (ds.string('00080060') === 'CT' ? 'HU' : ''),
        instanceNumber: ds.number('00200013'), sliceThickness: ds.number('00180050'),
        invertDefault: px.photometric === 'MONOCHROME1',
      };
      if (!frame.color && (frame.wc === null || frame.ww === null || !(frame.ww > 0))) {
        frame.wc = ((px.min + px.max) / 2) * px.slope + px.intercept;
        frame.ww = Math.max(1, (px.max - px.min) * px.slope);
        frame.autoWindow = true;
      }
      entry.bytes = px.pixels.byteLength + ds.bytes.byteLength;
      cacheBytes += entry.bytes;
      evict();
      return frame;
    })();
    entry.promise.catch(() => frameCache.delete(key));
    frameCache.set(key, entry);
  }
  return entry.promise;
}

/** Display set for a series: one entry per frame (multi-frame objects are expanded). */
export function stackOf(study, series) {
  if (series._stack) return series._stack;
  const refs = [];
  for (const inst of series.instances) for (let f = 0; f < (inst.frames || 1); f++) refs.push({ inst, f });
  const stack = {
    kind: 'stack', uid: series.uid, study, series, length: refs.length, refs,
    label: `${series.number ?? ''} ${series.description || series.modality}`.trim(),
    getFrame: (i) => getFrame(study, series, refs[i].inst, refs[i].f),
    sopAt: (i) => refs[i].inst.sop + (refs[i].f ? '#' + refs[i].f : ''),
    loaded: 0,
    /** Loads every frame (limited concurrency); resolves with the frame array. */
    loadAll(onProgress) {
      if (!stack._all) {
        const t0 = performance.now();
        const out = new Array(refs.length);
        let next = 0;
        const worker = async () => {
          for (let i; (i = next++) < refs.length;) {
            out[i] = await stack.getFrame(i);
            stack.loaded++;
            stack._listeners.forEach((fn) => fn(stack.loaded, refs.length));
          }
        };
        stack._all = Promise.all(Array.from({ length: 6 }, worker)).then(() => {
          recordTiming('series.load', performance.now() - t0, { images: refs.length, modality: series.modality });
          return out;
        });
        stack._all.catch(() => { stack._all = null; });
      }
      if (onProgress) stack._listeners.add(onProgress);
      return stack._all;
    },
    _listeners: new Set(),
  };
  series._stack = stack;
  return stack;
}

/** Slice normal and position along it. */
export function planeOf(frame) {
  if (!frame.iop || !frame.ipp) return null;
  const row = frame.iop.slice(0, 3), col = frame.iop.slice(3, 6), normal = cross(row, col);
  return { row, col, normal, pos: dot(frame.ipp, normal) };
}

// --- local import (files stay in the browser) ------------------------------------------
const DB = 'vibepacs-local';
function idb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('files'); rq.result.createObjectStore('meta'); };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
const tx = (db, store, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(store, mode); const rq = fn(t.objectStore(store));
  t.oncomplete = () => res(rq?.result); t.onerror = () => rej(t.error);
});

async function restoreLocal() {
  try {
    const db = await idb();
    const studies = (await tx(db, 'meta', 'readonly', (s) => s.get('studies'))) || [];
    const keys = await tx(db, 'files', 'readonly', (s) => s.getAllKeys());
    const blobs = await tx(db, 'files', 'readonly', (s) => s.getAll());
    keys.forEach((k, i) => localFiles.set(k, blobs[i]));
    studies.forEach((s) => localStudies.set(s.uid, s));
  } catch { /* IndexedDB unavailable: local import works for this session only */ }
}

async function persistLocal(newFiles) {
  try {
    const db = await idb();
    await tx(db, 'files', 'readwrite', (s) => { newFiles.forEach(([sop, blob]) => s.put(blob, sop)); });
    const plain = [...localStudies.values()].map((st) => ({ ...st, series: st.series.map(({ _stack, ...r }) => r) }));
    await tx(db, 'meta', 'readwrite', (s) => s.put(plain, 'studies'));
  } catch { /* keep in memory */ }
}

/** Imports DICOM files chosen by the user. Returns { imported, skipped }. */
export async function importFiles(files, onProgress) {
  let imported = 0, skipped = 0;
  const added = [];
  for (const [i, file] of [...files].entries()) {
    onProgress?.(i + 1, files.length);
    try {
      let bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
      const ds = await parseDicomAsync(bytes, { stopBefore: '7FE00010' });
      const studyUid = ds.string('0020000D'), seriesUid = ds.string('0020000E'), sop = ds.string('00080018');
      const info = imageInfo(ds);
      if (!studyUid || !seriesUid || !sop || !info.rows) { skipped++; continue; }
      if (findStudy(studyUid) && !localStudies.has(studyUid)) { skipped++; continue; }
      let study = localStudies.get(studyUid);
      if (!study) {
        study = { uid: studyUid, local: true, key: 'local',
          patient: { id: ds.string('00100020'), name: ds.personName('00100010') || ds.string('00100020'), sex: ds.string('00100040'), age: ds.string('00101010'), birthDate: ds.string('00100030') },
          date: ds.string('00080020'), time: ds.string('00080030').split('.')[0], description: ds.string('00081030'),
          accession: ds.string('00080050'), modalities: [], series: [] };
        localStudies.set(studyUid, study);
      }
      let series = study.series.find((s) => s.uid === seriesUid);
      if (!series) {
        series = { uid: seriesUid, key: 'local', number: ds.number('00200011') ?? 0, description: ds.string('0008103E'),
          modality: ds.string('00080060'), bodyPart: ds.string('00180015'), rows: info.rows, cols: info.cols,
          frameOfReference: ds.string('00200052'), instances: [] };
        study.series.push(series);
        study.series.sort((a, b) => a.number - b.number);
        if (!study.modalities.includes(series.modality)) study.modalities.push(series.modality);
      }
      if (series.instances.some((x) => x.sop === sop)) { skipped++; continue; }
      const iop = ds.numbers('00200037'), ipp = ds.numbers('00200032');
      const pos = iop.length === 6 && ipp.length === 3 ? dot(ipp, cross(iop.slice(0, 3), iop.slice(3, 6))) : null;
      series.instances.push({ sop, local: true, n: ds.number('00200013') ?? 0, pos, ...(info.frames > 1 ? { frames: info.frames } : {}) });
      delete series._stack;
      localFiles.set(sop, file);
      added.push([sop, file]);
      imported++;
    } catch { skipped++; }
  }
  for (const st of localStudies.values()) {
    for (const s of st.series) {
      const positional = s.instances.every((x) => x.pos !== null && x.pos !== undefined)
        && new Set(s.instances.map((x) => x.pos.toFixed(3))).size === s.instances.length;
      s.instances.sort(positional ? (a, b) => b.pos - a.pos : (a, b) => a.n - b.n);
    }
  }
  await persistLocal(added);
  return { imported, skipped };
}

export async function removeLocalStudy(uid) {
  const st = localStudies.get(uid);
  if (!st) return;
  const sops = st.series.flatMap((s) => s.instances.map((i) => i.sop));
  sops.forEach((s) => localFiles.delete(s));
  localStudies.delete(uid);
  try {
    const db = await idb();
    await tx(db, 'files', 'readwrite', (s) => { sops.forEach((k) => s.delete(k)); });
    await tx(db, 'meta', 'readwrite', (s) => s.put([...localStudies.values()].map((x) => ({ ...x, series: x.series.map(({ _stack, ...r }) => r) })), 'studies'));
  } catch { /* ignore */ }
}
