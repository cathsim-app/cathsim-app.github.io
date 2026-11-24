// Persistence for user-generated data (reports, annotations, key images, ratings,
// audit trail). Everything is kept in the browser (localStorage, per user) and, if a
// result server is configured, evaluations and finalized reports are also stored centrally.
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

// --- central result store (Cloudflare Worker, see worker/) --------------------------------
export function remoteConfigured() { const u = currentUser(); return !!(u?.token && u?.endpoint); }

async function api(path, opts = {}) {
  const u = currentUser();
  const r = await fetch(u.endpoint.replace(/\/+$/, '') + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-user': u.id, 'x-role': u.role, 'x-token': u.token, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Server ${r.status}`);
  return r.json();
}

/** Stores one record centrally. Returns true on success. */
export async function pushRemote(kind, data) {
  if (!remoteConfigured()) return false;
  await api('/submit', { method: 'POST', body: JSON.stringify({ kind, data }) });
  return true;
}

/** Reads every stored record (admin evaluation). */
export async function fetchAllRemote() {
  return (await api('/admin/results')).rows;
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
