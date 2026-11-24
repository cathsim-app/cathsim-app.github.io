// Structured report editor with templates, draft/final workflow and print view.
import { T, h, toast, fmtDate, fmtDateTime, download } from '../util.js';
import { getReport, saveReport, countUse } from '../store.js';
import { currentUser } from '../auth.js';
import { REPORT_TEMPLATES } from '../protocol.js';
import { icon } from '../icons.js';
import { getSite, loc } from '../site.js';

export function reportText(study, r) {
  const p = study.patient;
  const site = getSite();
  return [
    ...(site.institution ? [`${site.institution} · ${loc(site.department)}`, ''] : []),
    `${T('Patient', 'Patient')}: ${p.name} (ID ${p.id})${p.sex ? ', ' + p.sex : ''}${p.age ? ', ' + p.age : ''}`,
    `${T('Untersuchung', 'Study')}: ${study.modalities.join('/')} ${study.description || ''}, ${fmtDate(study.date)}, ${T('Auftrag', 'Acc.')} ${study.accession || '–'}`,
    '', `${T('KLINISCHE ANGABEN / FRAGESTELLUNG', 'CLINICAL INFORMATION')}\n${r.indication || '–'}`,
    '', `${T('TECHNIK', 'TECHNIQUE')}\n${r.technique || '–'}`,
    '', `${T('BEFUND', 'FINDINGS')}\n${r.findings || '–'}`,
    '', `${T('BEURTEILUNG', 'IMPRESSION')}\n${r.impression || '–'}`,
    '', r.status === 'final' ? `${T('Freigegeben von', 'Finalized by')} ${r.authorName || r.author}, ${fmtDateTime(r.finalized)}` : T('ENTWURF – nicht freigegeben', 'DRAFT – not finalized'),
    ...(loc(site.reportFooter) ? ['', loc(site.reportFooter)] : []),
  ].join('\n');
}

export function reportPanel(study, priors, ctx) {
  const box = h('div.report');
  const render = () => {
    const r = getReport(study.uid) || { status: 'new', indication: '', technique: '', findings: '', impression: '' };
    const locked = r.status === 'final';
    const field = (key, label, rows) => {
      const ta = h('textarea', { rows, value: r[key] || '', disabled: locked, spellcheck: true, oninput: () => { r[key] = ta.value; dirty(); } });
      return [h('label', label), ta];
    };
    const state = h('span.badge.' + r.status, { new: T('Unbefundet', 'Unread'), draft: T('Entwurf', 'Draft'), final: T('Freigegeben', 'Final') }[r.status]);
    const saved = h('span.muted', r.updated ? `${T('gespeichert', 'saved')} ${fmtDateTime(r.updated)}` : '');
    let timer = null;
    const dirty = () => { saved.textContent = T('ungespeichert …', 'unsaved …'); clearTimeout(timer); timer = setTimeout(() => save('draft', true), 1500); };
    const save = async (status, quiet = false) => {
      clearTimeout(timer);
      if (status === 'final' && !(r.findings || '').trim() && !(r.impression || '').trim()) { toast(T('Befund ist leer.', 'Report is empty.'), 'warn'); return; }
      const rec = { ...r, status, ...(status === 'final' ? { finalized: new Date().toISOString() } : {}) };
      const remote = await saveReport(study.uid, rec);
      Object.assign(r, rec);
      if (quiet) { saved.textContent = `${T('gespeichert', 'saved')} ${fmtDateTime(new Date().toISOString())}`; state.textContent = T('Entwurf', 'Draft'); state.className = 'badge draft'; return; }
      countUse('report.' + status);
      toast(status === 'final' ? T('Befund freigegeben', 'Report finalized') + (remote ? T(' und übertragen', ' and uploaded') : '') : T('Entwurf gespeichert', 'Draft saved'), 'ok');
      render();
    };
    const templates = REPORT_TEMPLATES()[study.modalities[0]] || REPORT_TEMPLATES()[study.modalities[0] === 'CR' ? 'DX' : 'CT'];
    const tpl = h('select', { disabled: locked, onchange: (e) => {
      const t = templates[Number(e.target.value)]; e.target.value = '';
      if (!t) return;
      if ((r.findings || '').trim() && !window.confirm(T('Vorhandenen Befundtext ersetzen?', 'Replace existing findings text?'))) return;
      r.technique = t.technique; r.findings = t.findings; countUse('report.template'); save('draft', true).then(render);
    } }, h('option', { value: '' }, T('Vorlage einfügen …', 'Insert template …')), templates.map((t, i) => h('option', { value: i }, t.name)));
    const insert = h('button', { disabled: locked, onclick: async () => {
      const ms = ctx.measurements();
      if (!ms.length) { toast(T('Keine Messungen vorhanden.', 'No measurements available.'), 'warn'); return; }
      const lines = await Promise.all(ms.map(ctx.measurementText));
      r.findings = `${(r.findings || '').replace(/\s+$/, '')}\n${lines.map((l) => '– ' + l).join('\n')}`.trim();
      countUse('report.insertMeasurements'); await save('draft', true); render();
    } }, T('Messwerte übernehmen', 'Insert measurements'));

    const priorBox = [];
    for (const p of priors) {
      const pr = getReport(p.uid);
      if (pr) priorBox.push(h('details.prior', h('summary', `${T('Vorbefund', 'Prior report')} ${fmtDate(p.date)} (${pr.status === 'final' ? T('freigegeben', 'final') : T('Entwurf', 'draft')})`), h('pre', reportText(p, pr))));
    }
    box.replaceChildren(
      h('div.report-head', h('h3', T('Befund', 'Report')), state, saved),
      h('div.report-tools', tpl, insert),
      ...field('indication', T('Klinische Angaben / Fragestellung', 'Clinical information'), 2),
      ...field('technique', T('Technik', 'Technique'), 2),
      ...field('findings', T('Befund', 'Findings'), 10),
      ...field('impression', T('Beurteilung', 'Impression'), 4),
      h('div.report-actions',
        locked ? h('button', { onclick: () => { if (window.confirm(T('Freigegebenen Befund zur Korrektur wieder öffnen?', 'Reopen the finalized report for amendment?'))) save('draft').then(render); } }, T('Wieder öffnen', 'Reopen'))
          : [h('button', { onclick: () => save('draft') }, T('Entwurf speichern', 'Save draft')), h('button.primary', { onclick: () => save('final') }, T('Freigeben', 'Finalize'))],
        h('button', { title: T('Befund als Text herunterladen', 'Download report as text'), onclick: () => download(`${study.patient.id}_${study.date}_report.txt`, reportText(study, { ...r, authorName: r.authorName || currentUser()?.name }), 'text/plain') }, icon('export')),
        h('button', { title: T('Drucken', 'Print'), onclick: () => {
          const w = window.open('', '_blank');
          if (!w) return;
          w.document.title = `${study.patient.id} ${study.date}`;
          const pre = w.document.createElement('pre');
          pre.style.cssText = 'font: 13px/1.5 system-ui, sans-serif; white-space: pre-wrap; max-width: 46em; margin: 2em auto;';
          pre.textContent = reportText(study, r);
          w.document.body.append(pre); w.print();
        } }, icon('print'))),
      ...priorBox);
  };
  render();
  return box;
}
