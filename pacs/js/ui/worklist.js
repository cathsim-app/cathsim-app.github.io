// Worklist: searchable, sortable study list with report status and local DICOM import.
import { T, h, toast, modal, fmtDate, fmtTime, getLang, setLang } from '../util.js';
import { allStudies, importFiles, removeLocalStudy, priorsOf } from '../archive.js';
import { getReports, getEvaluation, audit, countUse, remoteConfigured, getPrefs, setPref } from '../store.js';
import { currentUser, logout } from '../auth.js';
import { TASKS } from '../protocol.js';
import { getSite, loc } from '../site.js';

export function worklistScreen(root, nav, rerender) {
  const user = currentUser();
  const f = { q: '', modality: '', status: '', sort: getPrefs().wlSort || 'date', dir: getPrefs().wlDir || -1 };
  const tbody = h('tbody');
  const count = h('span.muted');
  let selected = 0, rows = [];

  const statusOf = (s) => getReports()[s.uid]?.status || 'new';
  const statusLabel = { new: T('Unbefundet', 'Unread'), draft: T('Entwurf', 'Draft'), final: T('Freigegeben', 'Final') };
  const cols = [
    ['status', T('Status', 'Status'), (s) => statusOf(s)], ['name', T('Patient', 'Patient'), (s) => s.patient.name],
    ['pid', T('Patienten-ID', 'Patient ID'), (s) => s.patient.id], ['sex', T('G/Alter', 'Sex/age'), (s) => `${s.patient.sex || ''} ${s.patient.age || ''}`],
    ['date', T('Datum', 'Date'), (s) => s.date + (s.time || '')], ['mod', T('Mod.', 'Mod.'), (s) => s.modalities.join('/')],
    ['desc', T('Untersuchung', 'Study description'), (s) => s.description || ''], ['n', T('Serien/Bilder', 'Series/images'), (s) => s.series.reduce((a, r) => a + r.instances.length, 0)],
    ['acc', T('Auftragsnr.', 'Accession'), (s) => s.accession || ''], ['src', T('Quelle', 'Source'), (s) => (s.local ? T('lokal', 'local') : s.collection || '')],
  ];

  function fill() {
    const q = f.q.trim().toLowerCase();
    const get = cols.find((c) => c[0] === f.sort)[2];
    rows = allStudies().filter((s) => (!q || [s.patient.name, s.patient.id, s.description, s.accession, s.collection, s.modalities.join(' '), s.series.map((r) => r.description).join(' ')].join(' ').toLowerCase().includes(q))
      && (!f.modality || s.modalities.includes(f.modality)) && (!f.status || statusOf(s) === f.status))
      .sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * f.dir; });
    selected = Math.min(selected, Math.max(0, rows.length - 1));
    tbody.replaceChildren(...rows.map((s, i) => {
      const st = statusOf(s), nPrior = priorsOf(s).length;
      return h(`tr${i === selected ? '.sel' : ''}`, { onclick: () => { selected = i; mark(); }, ondblclick: () => open(s) },
        h('td', h(`span.badge.${st}`, statusLabel[st])), h('td', h('b', s.patient.name)), h('td', s.patient.id), h('td', `${s.patient.sex || ''} ${s.patient.age || ''}`),
        h('td', `${fmtDate(s.date)} ${fmtTime(s.time)}`), h('td', s.modalities.join('/')),
        h('td', s.description || '–', nPrior ? h('span.chip', { title: T('Voruntersuchungen vorhanden', 'Prior studies available') }, `+${nPrior}`) : null),
        h('td', `${s.series.length} / ${s.series.reduce((a, r) => a + r.instances.length, 0)}`), h('td', s.accession || '–'),
        h('td', s.local ? T('lokal', 'local') : (s.collection || '')),
        h('td.actions', h('button', { onclick: (e) => { e.stopPropagation(); open(s); } }, T('Öffnen', 'Open')),
          s.local ? h('button.icon', { title: T('Lokale Untersuchung entfernen', 'Remove local study'), onclick: async (e) => { e.stopPropagation(); await removeLocalStudy(s.uid); fill(); } }, '✕') : null));
    }));
    count.textContent = `${rows.length} ${T('Untersuchungen', 'studies')}`;
    if (!rows.length) tbody.append(h('tr', h('td.muted', { colSpan: 11 }, T('Keine Untersuchungen gefunden.', 'No studies found.'))));
  }
  const mark = () => [...tbody.children].forEach((tr, i) => tr.classList.toggle('sel', i === selected));
  const open = (s) => { countUse('worklist.open'); nav(`#/viewer/${s.uid}`); };

  const head = h('tr', cols.map(([id, label]) => h('th', { onclick: () => { if (f.sort === id) f.dir = -f.dir; else { f.sort = id; f.dir = 1; } setPref('wlSort', f.sort); setPref('wlDir', f.dir); renderHead(); fill(); } }, label, h('span.sort', ''))), h('th', ''));
  function renderHead() { [...head.children].forEach((th, i) => { const s = th.querySelector('.sort'); if (s) s.textContent = cols[i]?.[0] === f.sort ? (f.dir > 0 ? ' ▲' : ' ▼') : ''; }); }

  const modalities = [...new Set(allStudies().flatMap((s) => s.modalities))].sort();
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => doImport(e.target.files) });
  const dirInput = h('input', { type: 'file', webkitdirectory: true, hidden: true, onchange: (e) => doImport(e.target.files) });
  async function doImport(files) {
    if (!files?.length) return;
    const note = h('div.toast.info', '');
    document.body.append(note);
    const res = await importFiles(files, (i, n) => { note.textContent = `${T('Importiere', 'Importing')} ${i}/${n} …`; });
    note.remove();
    audit('import.local', res); countUse('import');
    toast(`${res.imported} ${T('Objekte importiert', 'objects imported')}${res.skipped ? `, ${res.skipped} ${T('übersprungen', 'skipped')}` : ''}. ${T('Die Dateien bleiben in diesem Browser.', 'Files stay in this browser.')}`, res.imported ? 'ok' : 'warn', 6000);
    fill();
  }

  function onKey(e) {
    if (e.target.matches('input, textarea, select') || document.querySelector('.modal-back')) return;
    if (e.key === 'ArrowDown') { selected = Math.min(rows.length - 1, selected + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selected = Math.max(0, selected - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter' && rows[selected]) open(rows[selected]);
    else if (e.key === '/') { search.focus(); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  const ev = getEvaluation();
  const nDone = TASKS().filter((t) => ev.tasks[t.id]?.done).length;
  const search = h('input.search', { type: 'search', placeholder: T('Suche: Name, ID, Untersuchung, Auftragsnummer …  ( / )', 'Search: name, ID, study, accession …  ( / )'), oninput: (e) => { f.q = e.target.value; fill(); } });

  function about() {
    const sources = [...new Map(allStudies().filter((s) => s.collection).map((s) => [s.collection, s])).values()];
    modal(T('Über ', 'About ') + getSite().product, [
      getSite().fictitious ? h('p.muted', `${getSite().institution}: ` + T('fiktive Einrichtung. Name, Farben, Fenster-Voreinstellungen und Befundfuß stammen aus config/site.json.', 'fictitious institution. Name, colours, window presets and report footer come from config/site.json.')) : null,
      h('p', T('Dieses System ist ein Forschungsprototyp. Der gesamte Quelltext (DICOM-Parser, Bilddekodierung, Viewer, Arbeitsliste, Befundung, Zugangsverwaltung) wurde von einem KI-Coding-Agenten erzeugt. Die Anwendung läuft vollständig im Browser; es gibt keinen Anwendungsserver.', 'This system is a research prototype. The entire source code (DICOM parser, image decoding, viewer, worklist, reporting, access control) was generated by an AI coding agent. The application runs entirely in the browser; there is no application server.')),
      h('p', h('b', T('Kein Medizinprodukt. Nicht für die klinische Diagnostik.', 'Not a medical device. Not for clinical use.'))),
      h('h3', T('Bilddaten', 'Image data')),
      h('p', T('Öffentliche, anonymisierte Daten aus den NCI Imaging Data Commons / The Cancer Imaging Archive:', 'Public, de-identified data from the NCI Imaging Data Commons / The Cancer Imaging Archive:')),
      h('ul', sources.map((s) => h('li', `${s.collection} – ${s.license} – `, h('a', { href: `https://doi.org/${s.doi}`, target: '_blank', rel: 'noopener' }, `doi:${s.doi}`)))),
      h('p.muted', T('Lokal importierte DICOM-Dateien verlassen Ihren Browser nicht.', 'Locally imported DICOM files never leave your browser.')),
    ]);
  }

  root.append(h('div.page.worklist',
    h('header.page-head',
      h('div.logo.small', h('span.logo-mark', '◧'), h('div', h('h1', getSite().product), getSite().institution ? h('small.inst', `${getSite().institution} · ${loc(getSite().department)}`) : null)),
      h('span.warn-chip', T('Nicht für die klinische Diagnostik', 'Not for clinical use')),
      h('div.spacer'),
      h('button.primary', { onclick: () => nav('#/evaluation') }, `${T('Bewertung', 'Evaluation')} (${nDone}/${TASKS().length})`),
      user.role === 'admin' ? h('button', { onclick: () => nav('#/admin') }, T('Verwaltung', 'Admin')) : null,
      h('button', { onclick: about }, T('Info', 'About')),
      h('button', { onclick: () => { setLang(getLang() === 'de' ? 'en' : 'de'); rerender(); } }, getLang() === 'de' ? 'EN' : 'DE'),
      h('span.user', `${user.name}`, h('small', remoteConfigured() ? T('zentrale Ergebnisablage', 'central result store') : T('lokaler Modus', 'local mode'))),
      h('button', { onclick: () => { audit('logout'); logout(); nav('#/login'); } }, T('Abmelden', 'Sign out'))),
    h('div.filters', search,
      h('select', { onchange: (e) => { f.modality = e.target.value; fill(); } }, h('option', { value: '' }, T('Alle Modalitäten', 'All modalities')), modalities.map((m) => h('option', m))),
      h('select', { onchange: (e) => { f.status = e.target.value; fill(); } }, h('option', { value: '' }, T('Alle Status', 'All statuses')), Object.entries(statusLabel).map(([k, v]) => h('option', { value: k }, v))),
      count, h('div.spacer'), fileInput, dirInput,
      h('button', { onclick: () => fileInput.click(), title: T('DICOM-Dateien in diesen Browser laden (bleiben lokal)', 'Load DICOM files into this browser (they stay local)') }, T('DICOM-Dateien importieren', 'Import DICOM files')),
      h('button', { onclick: () => dirInput.click() }, T('Ordner importieren', 'Import folder'))),
    h('div.table-scroll', h('table.wl', h('thead', head), tbody)),
    h('footer.muted.small', T('Doppelklick oder Enter öffnet die Untersuchung. Bilddaten: NCI Imaging Data Commons (CC BY) – Details unter „Info“.', 'Double-click or Enter opens the study. Image data: NCI Imaging Data Commons (CC BY) – see "About".'))));
  renderHead(); fill();
  const drop = (e) => { e.preventDefault(); doImport(e.dataTransfer.files); };
  const over = (e) => e.preventDefault();
  root.addEventListener('dragover', over); root.addEventListener('drop', drop);
  return () => { document.removeEventListener('keydown', onKey); root.removeEventListener('dragover', over); root.removeEventListener('drop', drop); };
}
