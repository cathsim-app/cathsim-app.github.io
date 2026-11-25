// Reader evaluation: task checklist (also shown inside the viewer), reader profile,
// System Usability Scale and overall judgement. Submissions are stored locally,
// uploaded to the results repository if configured, and can be exported as a file.
import { T, h, toast, download, modal } from '../util.js';
import { getEvaluation, saveEvaluation, submitEvaluation, remoteConfigured, pushProgress, getRegistrations } from '../store.js';
import { currentUser } from '../auth.js';
import { TASKS, COMPLETION, COMPARISON_SCALE, SUS, AGREE_SCALE, OVERALL, PROFILE, susScore, REGISTRATION_CASES, REGISTRATION_SCALE } from '../protocol.js';

function scale(name, labels, value, onChange) {
  return h('div.scale', labels.map((l, i) => h('label', { title: l },
    h('input', { type: 'radio', name, value: i + 1, checked: Number(value) === i + 1, onchange: () => onChange(i + 1) }), h('span', i + 1))),
  h('small', `1 = ${labels[0]} … 5 = ${labels[4]}`));
}

function taskCard(t, ev, compact) {
  const cur = ev.tasks[t.id] || (ev.tasks[t.id] = {});
  const set = (k, v) => { cur[k] = v; cur.t = new Date().toISOString(); saveEvaluation(ev); card.classList.toggle('done', !!cur.done && !!cur.rating); };
  const card = h(`div.task${cur.done && cur.rating ? '.done' : ''}`,
    h('div.task-title', h('b', t.title)), h('p', t.text),
    h('div.task-row', COMPLETION().map(([val, label]) => h('label.pill', h('input', { type: 'radio', name: `done-${t.id}-${compact ? 'c' : 'f'}`, checked: cur.done === val, onchange: () => set('done', val) }), label))),
    h('div.task-label', T('Im Vergleich zu meinem klinischen PACS:', 'Compared with my clinical PACS:')),
    scale(`rate-${t.id}-${compact ? 'c' : 'f'}`, COMPARISON_SCALE(), cur.rating, (v) => set('rating', v)),
    h('input.task-comment', { type: 'text', placeholder: T('Kommentar (optional)', 'Comment (optional)'), value: cur.comment || '', oninput: (e) => set('comment', e.target.value) }));
  return card;
}

function registrationCard(c, ev, suffix) {
  const cur = ev.registration[c.id] || (ev.registration[c.id] = {});
  const set = (k, v) => { cur[k] = v; cur.t = new Date().toISOString(); saveEvaluation(ev); card.classList.toggle('done', !!cur.rating); };
  const card = h(`div.task${cur.rating ? '.done' : ''}`,
    h('div.task-title', h('b', T('Registrierung der Voruntersuchung – ', 'Registration of the prior study – ') + c.label)),
    h('p', T('Nach Klick auf „Vergleich“: Zeigen beide Fenster beim synchronen Blättern die gleiche anatomische Höhe?', 'After clicking "Compare": do both viewports show the same anatomical level while scrolling synchronously?')),
    h('div.task-row', REGISTRATION_SCALE().map(([val, label]) => h('label.pill', h('input', { type: 'radio', name: `reg-${c.id}-${suffix}`, checked: cur.rating === val, onchange: () => set('rating', val) }), label))),
    h('input.task-comment', { type: 'text', placeholder: T('Kommentar (optional)', 'Comment (optional)'), value: cur.comment || '', oninput: (x) => set('comment', x.target.value) }));
  return card;
}

const taskDone = (ev, t) => !!(ev.tasks[t.id]?.done && (ev.tasks[t.id]?.rating || ev.tasks[t.id]?.done === 'no'));

/**
 * Shown automatically when a study is closed: the tasks that belong to this case and, for
 * patients with a prior study, the registration rating. Calls `done` afterwards.
 */
export function caseDebrief(study, hasPrior, done) {
  const ev = getEvaluation();
  const pid = study.patient.id;
  const tasks = TASKS().filter((t) => t.cases?.includes(pid) && !taskDone(ev, t));
  const reg = hasPrior ? REGISTRATION_CASES().filter((c) => c.id === pid && !ev.registration[c.id]?.rating) : [];
  if (!tasks.length && !reg.length) { done(); return; }
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    close();
    pushProgress().catch(() => {});
    const open = TASKS().filter((t) => !taskDone(ev, t)).length;
    if (!open && !ev.submitted) toast(T('Alle Aufgaben bewertet – bitte noch den Abschlussfragebogen unter „Bewertung“ ausfüllen.', 'All tasks rated – please complete the final questionnaire under "Evaluation".'), 'ok', 7000);
    done();
  };
  const close = modal(T('Bewertung zu diesem Fall', 'Evaluation of this case') + ` – ${pid}`, [
    h('p.muted', T('Bitte bewerten Sie kurz, was Sie in diesem Fall bearbeitet haben. Nicht Bearbeitetes können Sie offen lassen; es wird beim nächsten Schließen erneut angeboten.', 'Please rate what you worked on in this case. Leave untouched tasks open; they are offered again the next time you close the case.')),
    ...reg.map((c) => registrationCard(c, ev, 'd')), ...tasks.map((t) => taskCard(t, ev, true)),
    h('div.row', h('button.primary', { onclick: finish }, T('Speichern und weiter', 'Save and continue')))], { wide: true, onClose: finish });
}

/** Compact checklist for the viewer side panel. */
export function taskPanel(nav) {
  const ev = getEvaluation();
  const tasks = TASKS();
  const done = () => tasks.filter((t) => ev.tasks[t.id]?.done && ev.tasks[t.id]?.rating).length;
  const counter = h('span.muted', '');
  const box = h('div.tasks', { onchange: () => { counter.textContent = `${done()}/${tasks.length}`; } },
    h('div.report-head', h('h3', T('Testaufgaben', 'Test tasks')), counter),
    h('p.muted', T('Bitte bearbeiten Sie die Aufgaben und bewerten Sie jede direkt. Der Abschlussfragebogen folgt unter „Bewertung“.', 'Please work through the tasks and rate each one directly. The final questionnaire follows under "Evaluation".')),
    tasks.map((t) => taskCard(t, ev, true)),
    REGISTRATION_CASES().map((c) => registrationCard(c, ev, 'c')),
    h('button.primary', { onclick: () => nav('#/evaluation') }, T('Weiter zum Abschlussfragebogen', 'Continue to final questionnaire')));
  counter.textContent = `${done()}/${tasks.length}`;
  return box;
}

export function evaluationScreen(root, nav) {
  const ev = getEvaluation();
  const user = currentUser();
  const page = h('div.page');
  const render = () => {
    const missing = () => {
      const m = [];
      if (PROFILE().some((p) => p.id !== 'pacs' && (ev.profile[p.id] === undefined || ev.profile[p.id] === ''))) m.push(T('Angaben zur Person', 'reader profile'));
      const open = TASKS().filter((t) => !taskDone(ev, t)).length;
      if (open) m.push(`${open} ${T('Aufgaben', 'tasks')}`);
      if (REGISTRATION_CASES().some((c) => !ev.registration[c.id]?.rating)) m.push(T('Registrierung', 'registration'));
      if (susScore(ev.sus) === null) m.push('SUS');
      if (OVERALL().some(([id]) => !ev.overall[id]) || !ev.overall.global) m.push(T('Gesamturteil', 'overall judgement'));
      return m;
    };
    page.replaceChildren(...[
      h('header.page-head', h('button.back', { onclick: () => nav('#/worklist') }, '‹ ' + T('Arbeitsliste', 'Worklist')), h('h1', T('Bewertung', 'Evaluation')),
        h('span.muted', `${user.name} (${user.id})`)),
      ev.submitted ? h('div.notice.ok', T('Ihre Bewertung wurde am ', 'Your evaluation was submitted on ') + new Date(ev.submitted).toLocaleString() + T(' abgeschickt. Sie können sie ändern und erneut abschicken.', '. You may change it and submit again.')) : null,
      h('section', h('h2', '1 · ' + T('Angaben zur Person', 'Reader profile')),
        h('div.form-grid', PROFILE().map((p) => [h('label', p.label),
          p.options ? h('select', { onchange: (e) => { ev.profile[p.id] = e.target.value; saveEvaluation(ev); } }, h('option', { value: '' }, '–'), p.options.map(([val, l]) => h('option', { value: val, selected: ev.profile[p.id] === val }, l)))
            : h('input', { type: p.type, min: 0, max: 60, value: ev.profile[p.id] ?? '', oninput: (e) => { ev.profile[p.id] = p.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; saveEvaluation(ev); } })]))),
      h('section', h('h2', '2 · ' + T('Aufgaben', 'Tasks')),
        h('p.muted', T('Die Aufgaben werden automatisch beim Schließen jedes Falls abgefragt und zwischengespeichert; hier sehen Sie den Stand und können ergänzen.', 'Tasks are asked automatically when each case is closed and saved as you go; this page shows the current state and lets you complete it.')),
        h('div.task-grid', TASKS().map((t) => taskCard(t, ev, false))),
        h('h3', T('Automatische Registrierung der Voruntersuchungen', 'Automatic registration of prior studies')),
        h('div.task-grid', REGISTRATION_CASES().map((c) => registrationCard(c, ev, 'f')))),
      h('section', h('h2', '3 · System Usability Scale'),
        SUS().map((q, i) => h('div.q', h('div', `${i + 1}. ${q}`), scale(`sus-${i}`, AGREE_SCALE(), ev.sus[i], (v) => { ev.sus[i] = v; saveEvaluation(ev); })))),
      h('section', h('h2', '4 · ' + T('Gesamturteil', 'Overall judgement')),
        OVERALL().map(([id, q]) => h('div.q', h('div', q), scale(`ov-${id}`, AGREE_SCALE(), ev.overall[id], (v) => { ev.overall[id] = v; saveEvaluation(ev); }))),
        h('div.q', h('div', T('Gesamteindruck im Vergleich zu meinem klinischen PACS', 'Overall impression compared with my clinical PACS')), scale('ov-global', COMPARISON_SCALE(), ev.overall.global, (v) => { ev.overall.global = v; saveEvaluation(ev); })),
        h('label', T('Welche Funktionen haben Sie vermisst?', 'Which functions did you miss?')), h('textarea', { rows: 3, value: ev.overall.missing || '', oninput: (e) => { ev.overall.missing = e.target.value; saveEvaluation(ev); } }),
        h('label', T('Aufgetretene Fehler / Probleme', 'Errors / problems encountered')), h('textarea', { rows: 3, value: ev.overall.bugs || '', oninput: (e) => { ev.overall.bugs = e.target.value; saveEvaluation(ev); } }),
        h('label', T('Weitere Anmerkungen', 'Further comments')), h('textarea', { rows: 3, value: ev.overall.comments || '', oninput: (e) => { ev.overall.comments = e.target.value; saveEvaluation(ev); } })),
      h('section.submit',
        h('p.muted', remoteConfigured() ? T('Beim Abschicken wird die Bewertung pseudonymisiert (nur Kennung) an den Ergebnis-Server der Studie übertragen.', 'On submission the evaluation is transferred under your reader code to the study result server.')
          : T('Für diese Installation ist kein Ergebnis-Server eingerichtet. Die Bewertung wird im Browser gespeichert und als Datei heruntergeladen – bitte senden Sie diese Datei an die Studienleitung.', 'No result server is configured for this installation. The evaluation is saved in the browser and downloaded as a file – please send this file to the study team.')),
        h('button.primary.big', { onclick: async () => {
          const m = missing();
          if (m.length && !window.confirm(T('Es fehlen noch: ', 'Still missing: ') + m.join(', ') + T('. Trotzdem abschicken?', '. Submit anyway?'))) return;
          ev.susScore = susScore(ev.sus);
          const { record, remote } = await submitEvaluation(ev);
          Object.assign(ev, record);
          if (!remote) download(`vibepacs-evaluation-${user.id}.json`, JSON.stringify(record, null, 1));
          toast(remote ? T('Vielen Dank – Bewertung übertragen.', 'Thank you – evaluation uploaded.') : T('Vielen Dank – Bewertung gespeichert und heruntergeladen.', 'Thank you – evaluation saved and downloaded.'), 'ok', 6000);
          render();
        } }, T('Bewertung abschicken', 'Submit evaluation')))].filter(Boolean));
  };
  render();
  root.append(page);
  return () => {};
}
