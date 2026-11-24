// Persistence for user-generated data (reports, annotations, key images, ratings,
// audit trail). Everything is kept in the browser (localStorage, per user) and, if a
// results repository is configured, additionally written to GitHub as JSON files.
import { currentUser } from './auth.js';

const mem = {};
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return mem[key] ?? fallback; }
}
function write(key, value) {
  mem[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or private mode */ }
}
const ns = (name) => `vp.${currentUser()?.id || 'anon'}.${name}`;

// --- GitHub results repository ---------------------------------------------
const b64utf8 = (s) => { const u = new TextEncoder().encode(s); let o = ''; for (const b of u) o += String.fromCharCode(b); return btoa(o); };

export function remoteConfigured() { const u = currentUser(); return !!(u?.token && u?.repo); }

async function gh(path, opts = {}) {
  const u = currentUser();
  const r = await fetch(`https://api.github.com/repos/${u.repo}/${path}`, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${u.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.status === 204 ? null : r.json();
}

/** Writes a new JSON file to the results repository. Returns true on success. */
export async function pushRemote(kind, data) {
  if (!remoteConfigured()) return false;
  const u = currentUser();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `results/${u.id}/${kind}-${stamp}.json`;
  await gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify({
    message: `${kind} from ${u.id}`, branch: u.branch, content: b64utf8(JSON.stringify(data, null, 1)) }) });
  return true;
}

/** Reads every result file (admin evaluation). */
export async function fetchAllRemote() {
  const u = currentUser();
  const tree = await gh(`git/trees/${encodeURIComponent(u.branch)}?recursive=1`);
  const files = tree.tree.filter((t) => t.type === 'blob' && /^results\/.+\.json$/.test(t.path));
  const out = [];
  for (const f of files) {
    const blob = await gh(`git/blobs/${f.sha}`);
    const bin = atob(blob.content.replace(/\n/g, ''));
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    try { out.push({ path: f.path, data: JSON.parse(text) }); } catch { /* skip malformed */ }
  }
  return out;
}

// Outbox: uploads that failed (offline, rate limit) are retried on the next occasion.
export async function flushOutbox() {
  if (!remoteConfigured()) return;
  const box = read(ns('outbox'), []);
  const rest = [];
  for (const item of box) {
    try { await pushRemote(item.kind, item.data); } catch { rest.push(item); }
  }
  write(ns('outbox'), rest);
}
async function pushOrQueue(kind, data) {
  if (!remoteConfigured()) return false;
  try { await pushRemote(kind, data); return true; } catch {
    write(ns('outbox'), [...read(ns('outbox'), []), { kind, data }]);
    return false;
  }
}

// --- audit trail ---------------------------------------------------------------
export function audit(action, detail = {}) {
  const log = read(ns('audit'), []);
  log.push({ t: new Date().toISOString(), action, ...detail });
  if (log.length > 2000) log.splice(0, log.length - 2000);
  write(ns('audit'), log);
}
export const getAudit = () => read(ns('audit'), []);

// --- usage telemetry (objective study data) ----------------------------------------
export function countUse(feature) {
  const u = read(ns('usage'), {});
  u[feature] = (u[feature] || 0) + 1;
  write(ns('usage'), u);
}
export const getUsage = () => read(ns('usage'), {});
export function recordTiming(name, ms, extra = {}) {
  const t = read(ns('timings'), []);
  t.push({ name, ms: Math.round(ms), ...extra });
  if (t.length > 500) t.shift();
  write(ns('timings'), t);
}
export const getTimings = () => read(ns('timings'), []);

// --- reports -------------------------------------------------------------------
export const getReports = () => read(ns('reports'), {});
export const getReport = (studyUid) => getReports()[studyUid] || null;
export async function saveReport(studyUid, report) {
  const all = getReports();
  all[studyUid] = { ...report, studyUid, author: currentUser()?.id, authorName: currentUser()?.name, updated: new Date().toISOString() };
  write(ns('reports'), all);
  audit(report.status === 'final' ? 'report.finalize' : 'report.save', { studyUid });
  if (report.status === 'final') return pushOrQueue('report', all[studyUid]);
  return false;
}

// --- annotations & key images -------------------------------------------------------
export const getAnnotations = (seriesUid) => read(ns('ann.' + seriesUid), {});
export function saveAnnotations(seriesUid, bySop) {
  const clean = Object.fromEntries(Object.entries(bySop).filter(([, list]) => list.length));
  write(ns('ann.' + seriesUid), clean);
}
export const getKeyImages = () => read(ns('keys'), {});
export function toggleKeyImage(studyUid, seriesUid, sop, index) {
  const all = getKeyImages();
  const list = all[studyUid] || [];
  const i = list.findIndex((k) => k.sop === sop);
  if (i >= 0) list.splice(i, 1); else list.push({ seriesUid, sop, index });
  all[studyUid] = list;
  write(ns('keys'), all);
  audit('keyimage.toggle', { studyUid, sop });
  return i < 0;
}

// --- evaluation ---------------------------------------------------------------------
export const getEvaluation = () => read(ns('evaluation'), { profile: {}, tasks: {}, sus: {}, overall: {}, submitted: null });
export const saveEvaluation = (e) => write(ns('evaluation'), e);
export async function submitEvaluation(e) {
  const u = currentUser();
  const record = { ...e, schema: 'vibepacs-evaluation/1', reader: u.id, submitted: new Date().toISOString(),
    usage: getUsage(), timings: getTimings(), client: { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, lang: navigator.language } };
  saveEvaluation(record);
  audit('evaluation.submit');
  const remote = await pushOrQueue('evaluation', record);
  return { record, remote };
}

// --- user preferences ---------------------------------------------------------------
export const getPrefs = () => read(ns('prefs'), {});
export const setPref = (k, v) => write(ns('prefs'), { ...getPrefs(), [k]: v });
