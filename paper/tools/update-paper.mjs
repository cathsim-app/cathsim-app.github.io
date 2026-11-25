#!/usr/bin/env node
// Turns collected reader evaluations into the manuscript:
//   evaluations (server or files) -> results.json -> figures/figure2-ratings.svg/.png
//   -> manuscript.md (from manuscript.template.md) -> manuscript.docx
//
// Usage:
//   node tools/update-paper.mjs --endpoint https://vibepacs-log.<account>.workers.dev   (secret in VIBEPACS_SECRET)
//   node tools/update-paper.mjs --files export1.json [export2.json ...]
//   node tools/update-paper.mjs --fictitious            (layout check with invented data)
// Options: --include-partial  also analyse readers who have not submitted the final questionnaire
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarize } from '../../pacs/js/stats.js';

const here = path.dirname(fileURLToPath(import.meta.url)), paper = path.join(here, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// English short labels (figure and table); ids must match pacs/js/protocol.js.
const TASKS = [['worklist', 'Worklist search'], ['scroll', 'Scrolling and cine'], ['window', 'Windowing'], ['zoompan', 'Zoom, pan, rotate'],
  ['length', 'Length and angle'], ['roi', 'Attenuation (ROI)'], ['mpr', 'MPR and MIP'], ['compare', 'Prior comparison'], ['multiseries', 'Multiseries MRI'],
  ['radiograph', 'Radiograph'], ['keyimage', 'Key image, annotation'], ['report', 'Reporting'], ['dicom', 'DICOM attributes']].map(([id, label]) => ({ id, label }));
const CASES = [['HCC_015', 'Liver CT'], ['112329', 'Chest CT'], ['TCGA-B8-5165', 'Renal CT'], ['VS-MC-RC-016', 'Head MRI']].map(([id, label]) => ({ id, label }));
const OVERALL = ['imageQuality', 'speed', 'completeness', 'reliability', 'teaching', 'clinical'];

async function credential(secret, id, role) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}|${role}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let records = [], fictitious = false;
if (flag('--fictitious')) {
  records = JSON.parse(fs.readFileSync(path.join(paper, 'fictitious-evaluations.json'), 'utf8')).records; fictitious = true;
} else if (value('--endpoint')) {
  const secret = process.env.VIBEPACS_SECRET;
  if (!secret) { console.error('Set VIBEPACS_SECRET to the study secret.'); process.exit(1); }
  const r = await fetch(value('--endpoint').replace(/\/+$/, '') + '/admin/results', { headers: { 'x-user': 'admin', 'x-role': 'admin', 'x-token': await credential(secret, 'admin', 'admin') } });
  if (!r.ok) { console.error(`Result server answered ${r.status}`); process.exit(1); }
  records = (await r.json()).rows.filter((x) => x.kind === 'evaluation').map((x) => x.data);
  fs.writeFileSync(path.join(paper, 'evaluations-raw.json'), JSON.stringify(records, null, 1));
} else if (flag('--files')) {
  for (const f of args.slice(args.indexOf('--files') + 1).filter((a) => !a.startsWith('--'))) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    records.push(...(Array.isArray(d) ? d : d.rows ? d.rows.map((x) => x.data) : d.records || [d]));
  }
} else { console.error('Give --endpoint, --files or --fictitious.'); process.exit(1); }

const R = summarize(records, { tasks: TASKS, cases: CASES, overall: OVERALL, includePartial: flag('--include-partial') });
R.fictitious = fictitious;
if (!R.readers) { console.error(`No completed evaluations (${R.readersTotal} reader(s) in progress). Use --include-partial to analyse them anyway.`); process.exit(2); }
fs.writeFileSync(path.join(paper, 'results.json'), JSON.stringify(R, null, 1));

// ----- Figure 2: diverging stacked bars, centred on "equivalent" ------------------------------
const COL = ['#c2543f', '#eab3a6', '#c4c3bd', '#a3c5cc', '#47808d'], LAB = ['Much worse', 'Worse', 'Equivalent', 'Better', 'Much better'];
const N = R.readers, W = 1500, rowH = 46, top = 96, left = 330, right = 60, plotW = W - left - right, half = Math.max(2, N), unit = plotW / (2 * half), cx = left + plotW / 2;
const rows = [...R.tasks].sort((a, b) => (b.mean || 0) - (a.mean || 0));
let g = '';
for (let k = -half; k <= half; k += half > 6 ? 2 : 1) { const x = cx + k * unit; g += `<line x1="${x}" y1="${top - 8}" x2="${x}" y2="${top + rows.length * rowH}" stroke="${k === 0 ? '#52514e' : '#e4e3de'}" stroke-width="${k === 0 ? 1.5 : 1}"/><text x="${x}" y="${top + rows.length * rowH + 26}" text-anchor="middle" class="ax">${Math.abs(k)}</text>`; }
rows.forEach((t, i) => {
  const y = top + i * rowH + 7, h = rowH - 14, r = t.ratings;
  g += `<text x="${left - 16}" y="${y + h / 2 + 6}" text-anchor="end" class="lb">${t.label}</text>`;
  let x = cx - (r[0] + r[1] + r[2] / 2) * unit;
  r.forEach((n, k) => { if (!n) return; const w = n * unit; g += `<rect x="${x + 1}" y="${y}" width="${w - 2}" height="${h}" rx="3" fill="${COL[k]}"/>`; if (w > 34) g += `<text x="${x + w / 2}" y="${y + h / 2 + 6}" text-anchor="middle" class="n" fill="${k === 0 || k === 4 ? '#fff' : '#0b0b0b'}">${n}</text>`; x += w; });
});
let lx = left, legend = '';
LAB.forEach((l, k) => { legend += `<rect x="${lx}" y="28" width="22" height="22" rx="3" fill="${COL[k]}"/><text x="${lx + 30}" y="45" class="lg">${k + 1} ${l}</text>`; lx += 60 + l.length * 12.5; });
const H = top + rows.length * rowH + 80;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>text{font-family:Arial,Helvetica,sans-serif}.lb{font-size:22px;fill:#0b0b0b}.ax{font-size:19px;fill:#52514e}.n{font-size:19px;font-weight:bold}.lg{font-size:20px;fill:#0b0b0b}</style><rect width="100%" height="100%" fill="#fff"/>${legend}${g}<text x="${cx}" y="${H - 18}" text-anchor="middle" class="ax">Number of readers (rating relative to the reader's clinical PACS)</text>${fictitious ? `<text x="${W - 20}" y="${top + rows.length * rowH - 14}" text-anchor="end" style="font-size:24px;font-weight:bold;fill:#c2543f;opacity:.8">FICTITIOUS DATA</text>` : ''}</svg>`;
fs.writeFileSync(path.join(paper, 'figures', 'figure2-ratings.svg'), svg);
try {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0">${svg}</body>`);
  await p.screenshot({ path: path.join(paper, 'figures', 'figure2-ratings.png') });
  await b.close();
} catch { console.warn('PNG not rendered (no browser available); the SVG was written.'); }

// ----- manuscript --------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace(/\.0+$/, '') : 'NA');
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
const low = [...R.tasks].filter((t) => Number.isFinite(t.mean)).sort((a, b) => a.mean - b.mean).slice(0, 3).map((t) => t.label.toLowerCase().replace('mpr and mip', 'multiplanar reformation').replace('dicom', 'DICOM'));
const reg = R.registrationTotals, regCorrected = R.registration.reduce((s, r) => s + r.corrected, 0);
const T = {
  N: N, residents: R.roles.resident, certified: R.roles.board + R.roles.senior, experience: num(R.experience.median, 1),
  attempts: R.attempts, yes: R.completion.yes, yesPct: pct(R.completion.yes, R.attempts), partly: R.completion.partly, partlyPct: pct(R.completion.partly, R.attempts),
  no: R.completion.no, noPct: pct(R.completion.no, R.attempts), ratingMedian: num(R.rating.median, 1), ratingIqr: `${num(R.rating.q1, 1)}–${num(R.rating.q3, 1)}`,
  lowTasks: low.length > 1 ? `${low.slice(0, -1).join(', ')}, and ${low[low.length - 1]}` : low[0] || 'NA',
  susMean: num(R.sus.mean), susSd: num(R.sus.sd), imageAgree: R.overall.imageQuality.agree, clinicalAgree: R.overall.clinical.agree,
  regRated: reg.rated, regExact: reg.exact, regMinor: reg.minor, regBad: reg.major + reg.failed, regCorrected, load: num(R.loadSeconds.median, 1),
};
let md = fs.readFileSync(path.join(paper, 'manuscript.template.md'), 'utf8');
const meta = JSON.parse(fs.readFileSync(path.join(paper, 'paper-meta.json'), 'utf8'));
md = md.replace('{{AGENT}}', process.env.VIBEPACS_AGENT || meta.agentPlaceholder).replace('{{COST}}', meta.sessionCostUsd);
md = md.replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!(k in T)) throw new Error(`Unknown token ${k}`); return fictitious ? `[${T[k]}]` : String(T[k]); });
md = md.replace(/<!--FICTITIOUS-->([\s\S]*?)<!--\/FICTITIOUS-->\n?/g, fictitious ? '$1' : '');
fs.writeFileSync(path.join(paper, 'manuscript.md'), md);
const body = md.slice(md.indexOf('## Introduction'), md.indexOf('## References')).replace(/^## .*$/gm, '').replace(/\*\*/g, '');
console.log(`${N} reader(s) analysed (${R.partialOnly} still in progress); body text ${body.split(/\s+/).filter(Boolean).length} words${fictitious ? '; FICTITIOUS DATA' : ''}`);
try { execFileSync('pandoc', ['manuscript.md', '-o', 'manuscript.docx'], { cwd: paper }); console.log('manuscript.docx written'); } catch { console.warn('pandoc not available: manuscript.docx not rebuilt'); }
