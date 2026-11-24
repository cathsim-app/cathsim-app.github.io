// Administration: create the encrypted access file, collect and summarise evaluations,
// inspect the audit trail.
import { T, h, toast, download, fmtDateTime, fmtNum } from '../util.js';
import { sealAccount, randomPassword, loadConfig, KDF_ITERATIONS, currentUser } from '../auth.js';
import { fetchAllRemote, remoteConfigured, getAudit, getEvaluation } from '../store.js';
import { TASKS, OVERALL, susScore } from '../protocol.js';

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const iqr = (a) => { if (!a.length) return [NaN, NaN]; const s = [...a].sort((x, y) => x - y); const q = (p) => { const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); }; return [q(0.25), q(0.75)]; };

export function adminScreen(root, nav) {
  if (currentUser()?.role !== 'admin') { root.append(h('div.center', T('Kein Zugriff.', 'Access denied.'))); return () => {}; }
  const page = h('div.page');
  let evaluations = [];

  // ----- access file ---------------------------------------------------------------
  const repo = h('input', { type: 'text', placeholder: 'owner/results-repository' });
  const branch = h('input', { type: 'text', value: 'main' });
  const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
  const userRows = h('tbody');
  const addUser = (id = '', name = '', role = 'reader') => {
    const tr = h('tr', h('td', h('input', { value: id, placeholder: 'reader01' })), h('td', h('input', { value: name, placeholder: T('Anzeigename', 'Display name') })),
      h('td', h('select', h('option', { value: 'reader', selected: role === 'reader' }, 'reader'), h('option', { value: 'admin', selected: role === 'admin' }, 'admin'))),
      h('td', h('input', { value: randomPassword(), size: 22 })), h('td', h('button.icon', { onclick: () => tr.remove() }, '✕')));
    userRows.append(tr);
  };
  loadConfig().then((c) => {
    repo.value = c.resultsRepo || ''; branch.value = c.resultsBranch || 'main';
    (c.users?.length ? c.users : [{ id: 'admin', name: 'Admin', role: 'admin' }]).forEach((u) => addUser(u.id, u.name, u.role));
  });
  const pwOut = h('pre.pw-out');
  async function makeAccess() {
    const users = [...userRows.children].map((tr) => { const i = tr.querySelectorAll('input, select'); return { id: i[0].value.trim(), name: i[1].value.trim() || i[0].value.trim(), role: i[2].value, password: i[3].value }; }).filter((u) => u.id);
    if (!users.length || users.some((u) => u.password.length < 10)) { toast(T('Mindestens ein Zugang; Passwörter ≥ 10 Zeichen.', 'At least one account; passwords ≥ 10 characters.'), 'warn'); return; }
    if (new Set(users.map((u) => u.id.toLowerCase())).size !== users.length) { toast(T('Kennungen müssen eindeutig sein.', 'User IDs must be unique.'), 'warn'); return; }
    if (token.value && !/^[\w.-]+\/[\w.-]+$/.test(repo.value.trim())) { toast(T('Repository als owner/name angeben.', 'Give the repository as owner/name.'), 'warn'); return; }
    const sealed = [];
    for (const u of users) sealed.push(await sealAccount(u, u.password, { token: token.value.trim() || null }));
    const cfg = { version: 1, iterations: KDF_ITERATIONS, resultsRepo: token.value ? repo.value.trim() : null, resultsBranch: branch.value.trim() || 'main', users: sealed };
    download('access.json', JSON.stringify(cfg, null, 1));
    pwOut.textContent = users.map((u) => `${u.id}\t${u.password}\t(${u.role})`).join('\n');
    toast(T('access.json erzeugt – nach pacs/config/access.json committen. Passwörter jetzt sichern!', 'access.json created – commit it to pacs/config/access.json. Save the passwords now!'), 'ok', 8000);
  }

  // ----- results -------------------------------------------------------------------
  const results = h('div');
  const addFiles = h('input', { type: 'file', multiple: true, accept: '.json', hidden: true, onchange: async (e) => {
    for (const file of e.target.files) { try { const d = JSON.parse(await file.text()); if (d.schema?.startsWith('vibepacs-evaluation')) evaluations.push(d); } catch { /* ignore */ } }
    renderResults();
  } });
  async function loadRemote() {
    try {
      const all = await fetchAllRemote();
      evaluations = all.map((x) => x.data).filter((d) => d.schema?.startsWith('vibepacs-evaluation'));
      toast(`${evaluations.length} ${T('Bewertungen geladen', 'evaluations loaded')}`, 'ok');
    } catch (e) { toast(T('Abruf fehlgeschlagen: ', 'Fetch failed: ') + e.message, 'error'); }
    renderResults();
  }
  function latestPerReader() {
    const by = new Map();
    for (const e of evaluations) { const prev = by.get(e.reader); if (!prev || prev.submitted < e.submitted) by.set(e.reader, e); }
    return [...by.values()].sort((a, b) => a.reader.localeCompare(b.reader));
  }
  function csv(list) {
    const tasks = TASKS(), ov = OVERALL();
    const header = ['reader', 'submitted', 'role', 'years', 'clinical_pacs', 'input', 'sus', ...Array.from({ length: 10 }, (_, i) => `sus${i + 1}`),
      ...tasks.flatMap((t) => [`${t.id}_done`, `${t.id}_rating`, `${t.id}_comment`]), ...ov.map(([id]) => id), 'global', 'missing', 'bugs', 'comments',
      'series_load_median_ms', 'screen', 'user_agent'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = list.map((e) => [e.reader, e.submitted, e.profile?.role, e.profile?.years, e.profile?.pacs, e.profile?.input, susScore(e.sus),
      ...Array.from({ length: 10 }, (_, i) => e.sus?.[i]), ...tasks.flatMap((t) => [e.tasks?.[t.id]?.done, e.tasks?.[t.id]?.rating, e.tasks?.[t.id]?.comment]),
      ...ov.map(([id]) => e.overall?.[id]), e.overall?.global, e.overall?.missing, e.overall?.bugs, e.overall?.comments,
      median((e.timings || []).filter((t) => t.name === 'series.load').map((t) => t.ms)), e.client?.screen, e.client?.ua].map(esc).join(','));
    return [header.join(','), ...lines].join('\n');
  }
  function renderResults() {
    const list = latestPerReader();
    const sus = list.map((e) => susScore(e.sus)).filter((v) => v !== null);
    const glob = list.map((e) => e.overall?.global).filter(Boolean);
    const loads = list.flatMap((e) => (e.timings || []).filter((t) => t.name === 'series.load').map((t) => t.ms / 1000));
    const [q1, q3] = iqr(sus);
    results.replaceChildren(
      h('div.stats',
        h('div.stat', h('b', list.length), h('span', T('Reader', 'Readers'))),
        h('div.stat', h('b', fmtNum(mean(sus), 1)), h('span', `SUS ${T('Mittelwert', 'mean')} (SD ${fmtNum(sd(sus), 1)})`)),
        h('div.stat', h('b', fmtNum(median(sus), 1)), h('span', `SUS Median (IQR ${fmtNum(q1, 1)}–${fmtNum(q3, 1)})`)),
        h('div.stat', h('b', fmtNum(median(glob), 1)), h('span', T('Gesamt vs. klinisches PACS (Median, 1–5)', 'Overall vs clinical PACS (median, 1–5)'))),
        h('div.stat', h('b', fmtNum(median(loads), 1) + ' s'), h('span', T('Serien-Ladezeit (Median)', 'Series load time (median)')))),
      h('h3', T('Aufgaben', 'Tasks')),
      h('table.wl', h('thead', h('tr', [T('Aufgabe', 'Task'), T('gelöst', 'completed'), T('mit Schwierigkeiten', 'with difficulty'), T('nicht lösbar', 'failed'), T('Bewertung Median (1–5)', 'Rating median (1–5)')].map((c) => h('th', c)))),
        h('tbody', TASKS().map((t) => { const a = list.map((e) => e.tasks?.[t.id] || {}); const n = (v) => a.filter((x) => x.done === v).length;
          return h('tr', h('td', t.title), h('td', n('yes')), h('td', n('partly')), h('td', n('no')), h('td', fmtNum(median(a.map((x) => x.rating).filter(Boolean)), 1))); }))),
      h('h3', T('Reader', 'Readers')),
      h('table.wl', h('thead', h('tr', ['ID', T('Position', 'Role'), T('Jahre', 'Years'), 'PACS', 'SUS', T('Gesamt', 'Overall'), T('Abgeschickt', 'Submitted')].map((c) => h('th', c)))),
        h('tbody', list.map((e) => h('tr', h('td', e.reader), h('td', e.profile?.role || ''), h('td', e.profile?.years ?? ''), h('td', e.profile?.pacs || ''), h('td', fmtNum(susScore(e.sus) ?? NaN, 1)), h('td', e.overall?.global || ''), h('td', fmtDateTime(e.submitted)))))),
      h('div.row', h('button', { disabled: !list.length, onclick: () => download('vibepacs-results.csv', csv(list), 'text/csv') }, 'CSV'),
        h('button', { disabled: !list.length, onclick: () => download('vibepacs-results.json', JSON.stringify(list, null, 1)) }, 'JSON')));
  }

  const auditLog = getAudit().slice(-200).reverse();
  page.append(
    h('header.page-head', h('button.back', { onclick: () => nav('#/worklist') }, '‹ ' + T('Arbeitsliste', 'Worklist')), h('h1', T('Verwaltung', 'Administration'))),
    h('section', h('h2', T('Ergebnisse der Reader-Studie', 'Reader study results')),
      h('div.row', h('button.primary', { disabled: !remoteConfigured(), onclick: loadRemote }, T('Aus Ergebnis-Repository laden', 'Load from results repository')),
        addFiles, h('button', { onclick: () => addFiles.click() }, T('Bewertungsdateien hinzufügen (.json)', 'Add evaluation files (.json)')),
        h('button', { onclick: () => { const e = getEvaluation(); if (e.submitted) { evaluations.push(e); renderResults(); } else toast(T('Keine eigene Bewertung abgeschickt.', 'No own evaluation submitted.'), 'warn'); } }, T('Eigene Bewertung hinzufügen', 'Add own evaluation'))),
      results),
    h('section', h('h2', T('Zugänge und Ergebnis-Repository', 'Accounts and results repository')),
      h('p.muted', T('Erzeugt die Datei config/access.json. Jeder Zugang ist ein mit dem Passwort verschlüsselter Umschlag (PBKDF2 + AES-GCM); das optionale GitHub-Token liegt nur verschlüsselt im Repository. Verwenden Sie ein „fine-grained“ Token, das ausschließlich Schreibrechte (Contents) auf ein privates Ergebnis-Repository hat.', 'Creates config/access.json. Each account is an envelope encrypted with its password (PBKDF2 + AES-GCM); the optional GitHub token is stored only in encrypted form. Use a fine-grained token restricted to Contents write access on one private results repository.')),
      h('div.form-grid', h('label', T('Ergebnis-Repository', 'Results repository')), repo, h('label', 'Branch'), branch, h('label', 'GitHub-Token'), token),
      h('table.wl.users', h('thead', h('tr', [T('Kennung', 'User ID'), 'Name', T('Rolle', 'Role'), T('Passwort', 'Password'), ''].map((c) => h('th', c)))), userRows),
      h('div.row', h('button', { onclick: () => addUser(`reader${String(userRows.children.length).padStart(2, '0')}`, `Reader ${userRows.children.length}`) }, T('+ Zugang', '+ Account')),
        h('button.primary', { onclick: makeAccess }, T('access.json erzeugen', 'Create access.json'))),
      pwOut),
    h('section', h('h2', T('Protokoll (dieser Browser)', 'Audit trail (this browser)')),
      h('div.table-scroll.short', h('table.wl', h('tbody', auditLog.map((a) => h('tr', h('td', fmtDateTime(a.t)), h('td', a.action), h('td.muted', JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 't' && k !== 'action'))))))))))
  );
  renderResults();
  root.append(page);
  return () => {};
}
