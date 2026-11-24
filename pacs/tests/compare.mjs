// Cross-validates parser and pixel decoders against reference checksums
// (produced with an independent DICOM toolkit). Usage: node compare.mjs expected.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseDicomAsync } from '../js/dicom/parser.js';
import { decodeFrame } from '../js/dicom/pixel.js';

const expected = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ok = 0; const fails = [];
for (const e of expected) {
  try {
    const buf = fs.readFileSync(e.file);
    const ds = await parseDicomAsync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const fr = await decodeFrame(ds, 0);
    if (ds.string('00080018') !== e.sop || ds.string('00100020') !== e.patientId) throw new Error('header mismatch');
    if (fr.rows !== e.rows || fr.cols !== e.cols) throw new Error('dimension mismatch');
    const sha = crypto.createHash('sha1').update(Buffer.from(fr.pixels.buffer, fr.pixels.byteOffset, fr.pixels.byteLength)).digest('hex');
    if (sha !== e.sha) throw new Error('pixel mismatch');
    ok++;
  } catch (err) { fails.push(`${e.ts} ${e.pi} ${e.file.split('/').pop()}: ${err.message}`); }
}
console.log(`${ok}/${expected.length} objects identical`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
