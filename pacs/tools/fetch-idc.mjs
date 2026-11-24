#!/usr/bin/env node
// Downloads the public demo series listed in demo-manifest.json from the
// NCI Imaging Data Commons open-data bucket (no credentials required).
// Usage: node fetch-idc.mjs <output-dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2];
if (!outDir) { console.error('usage: node fetch-idc.mjs <output-dir>'); process.exit(1); }
const manifest = JSON.parse(await fs.readFile(path.join(here, 'demo-manifest.json'), 'utf8'));

async function get(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 1500 * 2 ** i));
    }
  }
}

async function listKeys(bucket, prefix) {
  const keys = [];
  let token = '';
  do {
    const url = `https://${bucket}.s3.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}` +
      (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
    const xml = (await get(url)).toString('utf8');
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    token = (xml.match(/<NextContinuationToken>([^<]+)</) || [])[1] || '';
  } while (token);
  return keys;
}

for (const s of manifest.series) {
  const m = s.s3.match(/^s3:\/\/([^/]+)\/(.+?)\/?\*?$/);
  const [bucket, prefix] = [m[1], m[2].replace(/\/$/, '') + '/'];
  const dir = path.join(outDir, s.seriesUid);
  await fs.mkdir(dir, { recursive: true });
  const keys = (await listKeys(bucket, prefix)).filter((k) => k.endsWith('.dcm'));
  let done = 0;
  const queue = [...keys];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let k; (k = queue.pop());) {
      const file = path.join(dir, path.basename(k));
      try { await fs.access(file); } catch {
        await fs.writeFile(file, await get(`https://${bucket}.s3.amazonaws.com/${k}`));
      }
      done++;
    }
  }));
  console.log(`${s.patientId} ${s.modality} #${s.seriesNumber}: ${done}/${s.instances} files`);
}
