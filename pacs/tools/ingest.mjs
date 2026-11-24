#!/usr/bin/env node
// Archive ingestion: reads DICOM files from a directory tree, indexes them with the
// same parser the browser uses and writes the static study store
// (data/index.json + gzip-compressed, otherwise unmodified DICOM objects).
// Usage: node ingest.mjs <input-dir> [<pacs-data-dir>]
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseDicomAsync } from '../js/dicom/parser.js';
import { imageInfo } from '../js/dicom/pixel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const inDir = process.argv[2];
const dataDir = process.argv[3] || path.join(here, '..', 'data');
if (!inDir) { console.error('usage: node ingest.mjs <input-dir> [<data-dir>]'); process.exit(1); }

let manifest = { series: [] };
try { manifest = JSON.parse(await fs.readFile(path.join(here, 'demo-manifest.json'), 'utf8')); } catch { /* optional */ }
const provenance = Object.fromEntries(manifest.series.map((s) => [s.seriesUid, s]));

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

const studies = new Map();
let nFiles = 0, skipped = 0;
for await (const file of walk(inDir)) {
  const buf = await fs.readFile(file);
  let ds;
  try { ds = await parseDicomAsync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { stopBefore: '7FE00010' }); }
  catch { skipped++; continue; }
  const studyUid = ds.string('0020000D'), seriesUid = ds.string('0020000E'), sop = ds.string('00080018');
  if (!studyUid || !seriesUid || !sop || !ds.number('00280010')) { skipped++; continue; }
  nFiles++;
  if (!studies.has(studyUid)) {
    studies.set(studyUid, {
      uid: studyUid,
      patient: { id: ds.string('00100020'), name: ds.personName('00100010') || ds.string('00100020'),
        sex: ds.string('00100040'), age: ds.string('00101010'), birthDate: ds.string('00100030') },
      date: ds.string('00080020'), time: ds.string('00080030').split('.')[0],
      description: ds.string('00081030'), accession: ds.string('00080050'),
      referrer: ds.personName('00080090'), series: new Map(),
    });
  }
  const study = studies.get(studyUid);
  if (!study.series.has(seriesUid)) {
    const info = imageInfo(ds);
    const prov = provenance[seriesUid];
    if (prov) Object.assign(study, { collection: prov.collection, license: prov.license, doi: prov.doi });
    study.series.set(seriesUid, {
      uid: seriesUid, number: ds.number('00200011') ?? 0, description: ds.string('0008103E'),
      modality: ds.string('00080060'), bodyPart: ds.string('00180015'),
      rows: info.rows, cols: info.cols, frameOfReference: ds.string('00200052'), instances: [],
    });
  }
  const iop = ds.numbers('00200037'), ipp = ds.numbers('00200032');
  let pos = null;
  if (iop.length === 6 && ipp.length === 3) {
    const n = [iop[1] * iop[5] - iop[2] * iop[4], iop[2] * iop[3] - iop[0] * iop[5], iop[0] * iop[4] - iop[1] * iop[3]];
    pos = ipp[0] * n[0] + ipp[1] * n[1] + ipp[2] * n[2];
  }
  study.series.get(seriesUid).instances.push({ file, sop, n: ds.number('00200013') ?? 0, pos,
    frames: Math.max(1, ds.number('00280008') ?? 1) });
}

const list = [...studies.values()].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
await fs.rm(path.join(dataDir, 'studies'), { recursive: true, force: true });
let bytesIn = 0, bytesOut = 0;
const index = { format: 1, generated: new Date().toISOString().slice(0, 10), source: manifest.source || '', studies: [] };
for (const [si, study] of list.entries()) {
  const sKey = 's' + String(si + 1).padStart(2, '0');
  const seriesList = [...study.series.values()].sort((a, b) => a.number - b.number);
  const outStudy = { ...study, key: sKey, modalities: [...new Set(seriesList.map((s) => s.modality))], series: [] };
  if (!outStudy.accession) outStudy.accession = 'ACC' + String(1000 + si);
  for (const [ri, series] of seriesList.entries()) {
    const rKey = 'r' + String(ri + 1).padStart(2, '0');
    const positional = series.instances.every((i) => i.pos !== null) && new Set(series.instances.map((i) => i.pos.toFixed(3))).size === series.instances.length;
    series.instances.sort(positional ? (a, b) => b.pos - a.pos : (a, b) => a.n - b.n);
    const dir = path.join(dataDir, 'studies', sKey, rKey);
    await fs.mkdir(dir, { recursive: true });
    const instances = [];
    for (const [ii, inst] of series.instances.entries()) {
      const raw = await fs.readFile(inst.file);
      const gz = zlib.gzipSync(raw, { level: 9 });
      const name = String(ii + 1).padStart(4, '0') + '.dcm.gz';
      await fs.writeFile(path.join(dir, name), gz);
      bytesIn += raw.length; bytesOut += gz.length;
      instances.push({ f: name, sop: inst.sop, n: inst.n, ...(inst.frames > 1 ? { frames: inst.frames } : {}) });
    }
    outStudy.series.push({ ...series, key: rKey, instances });
  }
  index.studies.push(outStudy);
}
await fs.writeFile(path.join(dataDir, 'index.json'), JSON.stringify(index));
console.log(`${list.length} studies, ${nFiles} objects indexed (${skipped} skipped); ` +
  `${(bytesIn / 1e6).toFixed(1)} MB -> ${(bytesOut / 1e6).toFixed(1)} MB`);
for (const s of index.studies) console.log(` ${s.key} ${s.patient.id} ${s.date} ${s.modalities} "${s.description}" ${s.series.map((r) => r.instances.length).join('+')} images`);
