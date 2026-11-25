// Checks the automatic prior-study alignment on the demo pairs: after registration the matched
// slices must show similar anatomy (profile correlation) and a plausible offset.
// Usage: node register.test.mjs   (reads ../data)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDicomAsync } from '../js/dicom/parser.js';
import { decodeFrame } from '../js/dicom/pixel.js';
import { registerStacks } from '../js/viewer/register.js';

const data = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const index = JSON.parse(fs.readFileSync(path.join(data, 'index.json'), 'utf8'));
async function load(study, series) {
  const out = [];
  for (const inst of series.instances) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(data, 'studies', study.key, series.key, inst.f)));
    const ds = await parseDicomAsync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    const px = await decodeFrame(ds, 0);
    const sp = ds.numbers('00280030');
    out.push({ ...px, rowSpacing: sp[0], colSpacing: sp[1], iop: ds.numbers('00200037'), ipp: ds.numbers('00200032'), modality: ds.string('00080060') });
  }
  return out;
}
const byPatient = {};
for (const s of index.studies) (byPatient[s.patient.id] ||= []).push(s);
let failed = 0;
for (const [pid, studies] of Object.entries(byPatient)) {
  if (studies.length < 2) continue;
  const [cur, prior] = studies.sort((a, b) => b.date.localeCompare(a.date));
  const sa = cur.series[cur.series.length - 1];
  const sb = prior.series.find((s) => s.description === sa.description) || prior.series[prior.series.length - 1];
  const t0 = Date.now();
  const r = registerStacks(await load(cur, sa), await load(prior, sb));
  console.log(pid, `${cur.date} vs ${prior.date}`, r.ok ? `offset ${r.offset.toFixed(0)} mm, score ${r.score.toFixed(2)}, margin ${r.margin.toFixed(2)}` : `FAILED (${r.reason}, ${r.score?.toFixed(2)})`, `${Date.now() - t0} ms`);
  if (!r.ok) failed++;
}
process.exit(failed ? 1 : 0);
