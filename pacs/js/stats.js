// Summary statistics of reader evaluations. Used by the admin page and by the manuscript
// tools (paper/tools), so that the numbers shown in the app and in the paper are identical.
// Pure functions without DOM access; task and case lists are passed in.
export const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const sd = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const quantile = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

export function susOf(answers) {
  let sum = 0;
  for (let i = 0; i < 10; i++) { const a = Number(answers?.[i]); if (!(a >= 1 && a <= 5)) return null; sum += i % 2 === 0 ? a - 1 : 5 - a; }
  return sum * 2.5;
}

/** Keeps the most recent record of every reader (partial uploads are superseded by later ones). */
export function latestPerReader(records) {
  const by = new Map();
  for (const e of records) {
    if (!e?.reader || !String(e.schema || '').startsWith('vibepacs-evaluation')) continue;
    const t = e.saved || e.submitted || '', prev = by.get(e.reader);
    if (!prev || (prev.saved || prev.submitted || '') < t) by.set(e.reader, e);
  }
  return [...by.values()].sort((a, b) => a.reader.localeCompare(b.reader));
}

/**
 * tasks: [{id, label}], cases: [{id, label}], overall: [id, ...].
 * By default only finally submitted evaluations are analysed.
 */
export function summarize(records, { tasks, cases, overall, includePartial = false }) {
  const all = latestPerReader(records);
  const list = includePartial ? all : all.filter((e) => e.submitted && !e.partial);
  const n = list.length;
  const sus = list.map((e) => susOf(e.sus)).filter((v) => v !== null);
  const years = list.map((e) => Number(e.profile?.years)).filter((v) => Number.isFinite(v));
  const taskRows = tasks.map((t) => {
    const a = list.map((e) => e.tasks?.[t.id] || {});
    const ratings = [1, 2, 3, 4, 5].map((k) => a.filter((x) => Number(x.rating) === k).length);
    const vals = a.map((x) => Number(x.rating)).filter((v) => v >= 1);
    return { id: t.id, label: t.label, completion: ['yes', 'partly', 'no'].map((k) => a.filter((x) => x.done === k).length), ratings, median: median(vals), mean: mean(vals) };
  });
  const allRatings = list.flatMap((e) => tasks.map((t) => Number(e.tasks?.[t.id]?.rating)).filter((v) => v >= 1));
  const attempts = taskRows.reduce((s, r) => s + r.completion[0] + r.completion[1] + r.completion[2], 0);
  const sumCompletion = (i) => taskRows.reduce((s, r) => s + r.completion[i], 0);
  const registration = cases.map((c) => {
    const reader = list.map((e) => e.registration?.[c.id]?.rating).filter(Boolean);
    const auto = list.flatMap((e) => Object.entries(e.autoRegistration || {}).filter(([k]) => k.startsWith(c.id + ':')).map(([, v]) => v));
    return { id: c.id, label: c.label, rated: reader.length,
      counts: Object.fromEntries(['exact', 'minor', 'major', 'failed'].map((k) => [k, reader.filter((r) => r === k).length])),
      autoOk: auto.filter((v) => v.auto).length, autoRuns: auto.length, corrected: auto.filter((v) => v.corrected).length,
      score: median(auto.map((v) => v.score).filter((v) => typeof v === 'number')) };
  });
  const regRatings = registration.reduce((s, r) => s + r.rated, 0);
  const regCount = (k) => registration.reduce((s, r) => s + r.counts[k], 0);
  const loads = list.flatMap((e) => (e.timings || []).filter((t) => t.name === 'series.load').map((t) => t.ms / 1000));
  return {
    generated: new Date().toISOString(), readersTotal: all.length, readers: n, partialOnly: all.length - all.filter((e) => e.submitted && !e.partial).length,
    roles: Object.fromEntries(['resident', 'board', 'senior', 'other'].map((k) => [k, list.filter((e) => e.profile?.role === k).length])),
    experience: { median: median(years), q1: quantile(years, 0.25), q3: quantile(years, 0.75) },
    sus: { n: sus.length, mean: mean(sus), sd: sd(sus), median: median(sus), q1: quantile(sus, 0.25), q3: quantile(sus, 0.75) },
    tasks: taskRows, attempts, completion: { yes: sumCompletion(0), partly: sumCompletion(1), no: sumCompletion(2) },
    rating: { n: allRatings.length, median: median(allRatings), q1: quantile(allRatings, 0.25), q3: quantile(allRatings, 0.75) },
    registration, registrationTotals: { rated: regRatings, exact: regCount('exact'), minor: regCount('minor'), major: regCount('major'), failed: regCount('failed') },
    overall: Object.fromEntries([...overall, 'global'].map((id) => { const v = list.map((e) => Number(e.overall?.[id])).filter((x) => x >= 1); return [id, { n: v.length, agree: v.filter((x) => x >= 4).length, median: median(v) }]; })),
    loadSeconds: { n: loads.length, median: median(loads) },
    freeText: { missing: list.map((e) => e.overall?.missing).filter(Boolean), bugs: list.map((e) => e.overall?.bugs).filter(Boolean), comments: list.map((e) => e.overall?.comments).filter(Boolean) },
  };
}
