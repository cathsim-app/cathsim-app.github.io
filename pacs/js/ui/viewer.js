// Reading workstation: series browser, viewport grid, toolbar, MPR, comparison,
// synchronisation, report and evaluation side panel.
import { T, h, toast, modal, download, fmtDate, fmtNum, dot, clamp } from '../util.js';
import { findStudy, priorsOf, stackOf, planeOf, pinSeries } from '../archive.js';
import { Viewport, allAnnotations, measure, worldToImage } from '../viewer/viewport.js';
import { buildVolume, mprSet } from '../viewer/volume.js';
import { registerStacks } from '../viewer/register.js';
import { thumbnail } from '../viewer/render.js';
import { DICT, TRANSFER_SYNTAX } from '../dicom/dict.js';
import { audit, countUse, toggleKeyImage, getKeyImages, getPrefs, setPref, recordTiming, noteRegistration } from '../store.js';
import { icon } from '../icons.js';
import { getSite, loc } from '../site.js';
import { reportPanel } from './report.js';
import { taskPanel, caseDebrief } from './evaluation.js';

const CT_PRESETS = () => (getSite().ctPresets?.length ? getSite().ctPresets.slice(0, 9).map((p) => [loc(p), Number(p.center), Number(p.width)]) : [
  [T('Weichteil', 'Soft tissue'), 40, 400], [T('Lunge', 'Lung'), -600, 1500], [T('Knochen', 'Bone'), 500, 2000],
  [T('Leber', 'Liver'), 70, 160], [T('Hirn', 'Brain'), 40, 80], [T('Mediastinum', 'Mediastinum'), 50, 350],
]);

const TOOLS = () => [
  ['scroll', 'scroll', T('Blättern (S)', 'Scroll (S)')], ['wl', 'wl', T('Fensterung (W)', 'Window/level (W)')],
  ['pan', 'pan', T('Verschieben (P)', 'Pan (P)')], ['zoom', 'zoom', T('Zoom (Z)', 'Zoom (Z)')],
  ['length', 'length', T('Länge (L)', 'Length (L)')], ['angle', 'angle', T('Winkel (A)', 'Angle (A)')],
  ['ellipse', 'ellipse', T('Ellipsen-ROI (E)', 'Elliptical ROI (E)')], ['rect', 'rect', T('Rechteck-ROI (R)', 'Rectangular ROI (R)')],
  ['probe', 'probe', T('Punktwert (H)', 'Point value (H)')], ['arrow', 'arrow', T('Pfeil/Text (T)', 'Arrow/text (T)')],
  ['crosshair', 'crosshair', T('3D-Fadenkreuz (C)', '3D crosshair (C)')],
];
const KEYS = { s: 'scroll', w: 'wl', p: 'pan', z: 'zoom', l: 'length', a: 'angle', e: 'ellipse', r: 'rect', h: 'probe', t: 'arrow', c: 'crosshair' };

export function viewerScreen(root, studyUid, params, nav) {
  const study = findStudy(studyUid);
  if (!study) { root.append(h('div.center', T('Untersuchung nicht gefunden.', 'Study not found.'))); return () => {}; }
  audit('study.open', { studyUid });
  const priors = priorsOf(study);
  const state = { tool: 'scroll', layout: [1, 1], active: 0, sync: false, refLines: true, cursor: null, mpr: null,
    cine: null, fps: 12, maximized: null, smoothing: getPrefs().smoothing !== false };
  let viewports = [];
  const grid = h('div.vp-grid');
  const seriesPanel = h('div.series-panel');
  const toolbar = h('div.toolbar');
  const side = h('aside.side');
  const status = h('span.status');

  const hooks = {
    tool: () => state.tool,
    smoothing: () => state.smoothing,
    cursor3d: () => state.cursor,
    referenceFrame: (vp) => (state.refLines && viewports[state.active] !== vp ? viewports[state.active]?.frame : null),
    onActivate: (vp) => setActive(viewports.indexOf(vp)),
    onScroll: (vp) => { if (vp === viewports[state.active]) onActiveScroll(vp); },
    onCursor3d: (P) => setCursor(P),
    onMaximize: (vp) => toggleMaximize(vp),
    onDrop: (vp, data) => { const [su, ru] = data.split('|'); const st = findStudy(su), se = st?.series.find((x) => x.uid === ru); if (se) loadSeries(viewports.indexOf(vp), st, se); },
    onAnnotations: () => sidePanels.refresh?.(),
    onLoaded: () => { clearTimeout(hooks._t); hooks._t = setTimeout(renderToolbar, 30); },
  };

  // ----- layout -----------------------------------------------------------------------
  function setLayout(rows, cols, keep = true) {
    const old = viewports.map((v) => ({ set: v.set, index: v.index, view: v.view }));
    viewports.forEach((v) => v.destroy());
    viewports = [];
    state.layout = [rows, cols]; state.maximized = null;
    grid.style.gridTemplate = `repeat(${rows}, 1fr) / repeat(${cols}, 1fr)`;
    for (let i = 0; i < rows * cols; i++) {
      const vp = new Viewport(hooks);
      viewports.push(vp); grid.append(vp.el);
      if (keep && old[i]?.set) vp.load(old[i].set, old[i].index).then(() => { Object.assign(vp.view, old[i].view); vp.draw(); });
    }
    state.active = clamp(state.active, 0, viewports.length - 1);
    markActive(); updatePins();
  }

  function toggleMaximize(vp) {
    if (viewports.length < 2) return;
    state.maximized = state.maximized === vp ? null : vp;
    viewports.forEach((v) => { v.el.style.display = state.maximized && v !== state.maximized ? 'none' : ''; });
    grid.style.gridTemplate = state.maximized ? '1fr / 1fr' : `repeat(${state.layout[0]}, 1fr) / repeat(${state.layout[1]}, 1fr)`;
  }

  function setActive(i) {
    if (i < 0 || i === state.active) return;
    state.active = i; markActive();
    viewports.forEach((v) => v.draw());
    renderToolbar();
  }
  function markActive() { viewports.forEach((v, i) => v.el.classList.toggle('active', i === state.active)); highlightSeries(); }
  function updatePins() { pinSeries(viewports.filter((v) => v.set).map((v) => v.set.series.uid)); }

  // ----- series ----------------------------------------------------------------------
  async function loadSeries(i, st, se, index = null) {
    const vp = viewports[i];
    if (!vp) return;
    if (state.mpr) exitMpr(false);
    if (state.registration && ![viewports[i]?.set?.uid].every((u) => u !== state.registration.a && u !== state.registration.b)) state.registration = null;
    const stack = stackOf(st, se);
    countUse('series.open');
    await vp.load(stack, index);
    updatePins(); highlightSeries(); renderToolbar();
    vp.setProgress(stack.loaded, stack.length);
    // Prefetch the complete series in the background; needed for sync, reference lines and MPR.
    stack.loadAll((done, total) => { if (vp.set === stack) vp.setProgress(done, total); })
      .then((frames) => {
        if (!stack.positions) {
          const planes = frames.map(planeOf);
          if (planes.every(Boolean)) { stack.positions = planes.map((p) => p.pos); stack.normal = planes[0].normal; }
        }
        if (vp.set === stack) vp.setProgress(0, 0);
      })
      .catch((e) => toast(T('Fehler beim Laden: ', 'Loading failed: ') + e.message, 'error'));
  }

  function highlightSeries() {
    const shown = new Set(viewports.filter((v) => v.set).map((v) => v.set.series.uid));
    const act = viewports[state.active]?.set?.series.uid;
    seriesPanel.querySelectorAll('.series').forEach((el) => {
      el.classList.toggle('shown', shown.has(el.dataset.uid));
      el.classList.toggle('current', el.dataset.uid === act);
    });
  }

  function renderSeriesPanel() {
    seriesPanel.replaceChildren();
    const block = (st, title) => {
      const box = h('div.series-group', h('div.series-group-title', title, h('small', `${fmtDate(st.date)} · ${st.description || st.modalities.join('/')}`)));
      for (const se of st.series) {
        const thumb = h('div.thumb');
        const el = h('div.series', { draggable: true, dataset: { uid: se.uid }, title: T('Klicken oder in ein Fenster ziehen', 'Click or drag into a viewport'),
          onclick: () => loadSeries(state.active, st, se),
          ondragstart: (e) => e.dataTransfer.setData('text/plain', `${st.uid}|${se.uid}`) },
          thumb, h('div.series-info', h('b', `${se.number ?? ''} ${se.description || se.modality}`.trim()),
            h('span', `${se.modality} · ${se.instances.length} ${T('Bilder', 'images')}`)));
        box.append(el);
        const stack = stackOf(st, se);
        stack.getFrame(Math.floor((stack.length - 1) / 2)).then((f) => thumb.append(thumbnail(f))).catch(() => { thumb.textContent = '!'; });
      }
      return box;
    };
    seriesPanel.append(block(study, T('Aktuelle Untersuchung', 'Current study')));
    priors.forEach((p) => seriesPanel.append(block(p, p.date < study.date ? T('Voruntersuchung', 'Prior study') : T('Weitere Untersuchung', 'Other study'))));
  }

  // ----- synchronisation -------------------------------------------------------------
  const posOf = (vp) => (vp.frame ? planeOf(vp.frame)?.pos ?? null : null);
  function anchorSync() {
    viewports.forEach((v) => { v._anchor = posOf(v); });
  }
  function scrollToPos(vp, pos) {
    const s = vp.set;
    if (s.kind === 'mpr') return;
    if (!s.positions) return;
    let best = 0, bd = Infinity;
    s.positions.forEach((p, i) => { const d = Math.abs(p - pos); if (d < bd) { bd = d; best = i; } });
    if (best !== vp.index) vp.show(best, true);
  }
  function onActiveScroll(vp) {
    if (state.mpr) {
      // Moving through an MPR plane moves the shared cursor along the plane normal.
      const f = vp.frame, P = state.cursor;
      if (f && P) { const q = worldToImage(f, P); const n = planeOf(f).normal; setCursor([P[0] - n[0] * q.dist, P[1] - n[1] * q.dist, P[2] - n[2] * q.dist], vp); }
      return;
    }
    if (state.sync) {
      const pa = planeOf(vp.frame || {});
      for (const o of viewports) {
        if (o === vp || !o.set || !o.frame) continue;
        const po = planeOf(o.frame);
        if (!pa || !po) {                      // no geometry: synchronise by image index
          if (vp._anchorIndex !== undefined && o._anchorIndex !== undefined) o.show(o._anchorIndex + (vp.index - vp._anchorIndex), true);
          continue;
        }
        const align = dot(pa.normal, po.normal);
        if (Math.abs(align) < 0.8) continue;
        const sameFor = vp.set.series.frameOfReference && vp.set.series.frameOfReference === o.set.series.frameOfReference;
        const reg = state.registration;
        if (sameFor) scrollToPos(o, dot(vp.frame.ipp, po.normal));
        else if (reg && reg.a === vp.set.uid && reg.b === o.set.uid) { const k = reg.aToB(vp.index); if (k !== o.index) o.show(k, true); }
        else if (reg && reg.b === vp.set.uid && reg.a === o.set.uid) { const k = reg.bToA(vp.index); if (k !== o.index) o.show(k, true); }
        else if (vp._anchor !== null && o._anchor !== null && vp._anchor !== undefined) scrollToPos(o, o._anchor + (pa.pos - vp._anchor) * Math.sign(align));
      }
    }
    if (state.refLines) viewports.forEach((o) => { if (o !== vp) o.draw(); });
  }
  function setSync(on, manual = true) {
    state.sync = on;
    if (on && manual && state.registration) {
      // The reader realigned the images by hand: the manual anchor replaces the automatic result.
      noteRegistration(state.registration.pair, { corrected: true });
      state.registration = null; countUse('registration.manual');
    }
    if (on) { anchorSync(); viewports.forEach((v) => { v._anchorIndex = v.index; }); countUse('sync'); }
    renderToolbar();
  }

  function setCursor(P, source = null) {
    state.cursor = P;
    for (const vp of viewports) {
      if (!vp.set || vp === source) { vp.draw(); continue; }
      if (vp.set.kind === 'mpr') vp.show(vp.set.indexOfWorld(P), true);
      else if (vp.set.positions && vp.frame) { const pl = planeOf(vp.frame); if (pl) scrollToPos(vp, dot(P, pl.normal)); vp.draw(); }
      else vp.draw();
    }
  }

  // ----- MPR -------------------------------------------------------------------------
  async function enterMpr() {
    const vp = viewports[state.active];
    if (!vp?.set || vp.set.kind !== 'stack') return;
    const stack = vp.set;
    status.textContent = T('Volumen wird aufgebaut …', 'Building volume …');
    let vol;
    try {
      vol = stack.volume || (stack.volume = await buildVolume(stack, (d, t) => { status.textContent = `${T('Lade Schichten', 'Loading slices')} ${d}/${t}`; }));
    } catch (e) { status.textContent = ''; toast(e.message, 'error'); return; }
    status.textContent = '';
    if (!vol.uniform) toast(T('Hinweis: ungleichmäßiger Schichtabstand – Reformation geometrisch nur näherungsweise.', 'Note: non-uniform slice spacing – reformation is geometrically approximate.'), 'warn', 6000);
    countUse('mpr');
    const wl = { wc: vp.view.wc, ww: vp.view.ww };
    state.mpr = { prev: { layout: state.layout, sets: viewports.map((v) => ({ set: v.set, index: v.index })), tool: state.tool }, sets: [0, 1, 2].map((p) => mprSet(vol, p)), vol };
    setLayout(1, 3, false);
    const centre = [vol.nx / 2 * vol.dx, vol.ny / 2 * vol.dy, vol.nz / 2 * vol.dz];
    state.cursor = [0, 1, 2].map((k) => vol.origin[k] + vol.row[k] * centre[0] + vol.col[k] * centre[1] + vol.normal[k] * centre[2]);
    // Start on the slice that was displayed before.
    if (vp.frame?.ipp) { const d = dot(vp.frame.ipp, vol.normal) - dot(state.cursor, vol.normal); state.cursor = state.cursor.map((c, k) => c + vol.normal[k] * d); }
    await Promise.all(state.mpr.sets.map((s, i) => viewports[i].load(s, s.indexOfWorld(state.cursor)).then(() => viewports[i].setWindow(wl.wc, wl.ww))));
    state.tool = 'crosshair';
    renderToolbar();
  }
  function exitMpr(restore = true) {
    const m = state.mpr;
    if (!m) return;
    state.mpr = null; state.cursor = null; state.tool = m.prev.tool;
    setLayout(m.prev.layout[0], m.prev.layout[1], false);
    if (restore) m.prev.sets.forEach((s, i) => { if (s.set && viewports[i]) viewports[i].load(s.set, s.index); });
    renderToolbar();
  }
  function setSlab(mm, mode) {
    if (!state.mpr) return;
    for (const vp of viewports) {
      if (vp.set?.kind !== 'mpr') continue;
      vp.set.slab = Math.max(1, Math.round(mm / vp.set.step) | 1);
      if (mm <= 0) vp.set.slab = 1;
      vp.set.slabMode = mode;
      vp.show(vp.index, true);
    }
    state.mpr.slab = mm; state.mpr.mode = mode;
    if (mm > 0) countUse('slab.' + mode);
  }

  // ----- comparison ---------------------------------------------------------------------
  async function compare() {
    const prior = priors.find((p) => p.date <= study.date) || priors[0];
    if (!prior) return;
    if (state.mpr) exitMpr(false);
    const cur = viewports[state.active]?.set?.study === study ? viewports[state.active].set.series : study.series[study.series.length - 1];
    const match = prior.series.find((s) => s.description === cur.description) || prior.series.find((s) => s.modality === cur.modality) || prior.series[0];
    const keepIndex = viewports[state.active]?.set?.series === cur ? viewports[state.active].index : null;
    setLayout(1, 2, false);
    state.sync = false; state.registration = null;
    await loadSeries(0, study, cur, keepIndex);
    await loadSeries(1, prior, match);
    setActive(0); markActive();
    countUse('compare'); audit('study.compare', { studyUid, prior: prior.uid });
    const [a, b] = viewports;
    status.textContent = T('Registriere Voruntersuchung …', 'Registering prior study …');
    let reg = { ok: false };
    try {
      const [fa, fb] = await Promise.all([a.set.loadAll(), b.set.loadAll()]);
      if (a.set.series !== cur || b.set.series !== match) { status.textContent = ''; return; }
      const t0 = performance.now();
      reg = registerStacks(fa, fb);
      recordTiming('registration', performance.now() - t0, { ok: reg.ok, score: reg.score ?? null });
    } catch { /* fall through to manual alignment */ }
    status.textContent = '';
    const pair = `${study.patient.id}:${study.date}/${prior.date}`;
    noteRegistration(pair, { auto: reg.ok, offset: reg.ok ? Math.round(reg.offset) : null, score: reg.ok ? Number(reg.score.toFixed(3)) : null, corrected: false });
    if (reg.ok) {
      state.registration = { ...reg, a: a.set.uid, b: b.set.uid, pair };
      state.sync = true;
      const zA = reg.zOfA.get(a.index);
      await b.show(reg.aToB(a.index), true);
      // Same magnification and in-plane position in both viewports.
      setTimeout(() => {
        if (!a.frame || !b.frame || state.registration?.pair !== pair) return;
        b.view.zoom = a.fitScale() * a.view.zoom / b.fitScale();
        const c = reg.centroid(zA);
        if (c.a.x !== null && c.b.x !== null) {
          a._m = a.matrix(); b._m = b.matrix();
          const pa = a.toCanvas(c.a), pb = b.toCanvas(c.b);
          b.view.panX += (pa.x - a.canvas.width / 2) - (pb.x - b.canvas.width / 2);
          b.view.panY += (pa.y - a.canvas.height / 2) - (pb.y - b.canvas.height / 2);
        }
        b.draw();
      }, 250);
      toast(T('Voruntersuchung vom ', 'Prior study of ') + fmtDate(prior.date) + T(` automatisch registriert (Versatz ${Math.round(reg.offset)} mm, Übereinstimmung ${reg.score.toFixed(2)}). Synchrones Blättern aktiv. Korrektur: Sync aus, Schichten angleichen, Sync an.`, ` registered automatically (offset ${Math.round(reg.offset)} mm, agreement ${reg.score.toFixed(2)}). Synchronised scrolling is on. To correct: sync off, match slices, sync on.`), 'ok', 8000);
    } else {
      b.show(Math.round(a.index / Math.max(1, a.set.length - 1) * (b.set.length - 1)), true);
      setSync(true, false);
      toast(T('Automatische Registrierung nicht möglich – bitte Schichten manuell angleichen (Sync aus, einstellen, Sync an).', 'Automatic registration failed – please match slices manually (sync off, adjust, sync on).'), 'warn', 8000);
    }
    renderToolbar();
  }

  // ----- cine ------------------------------------------------------------------------
  function toggleCine() {
    if (state.cine) { clearInterval(state.cine); state.cine = null; }
    else {
      countUse('cine');
      state.cine = setInterval(() => { const vp = viewports[state.active]; if (vp?.set) vp.show((vp.index + 1) % vp.set.length); }, 1000 / state.fps);
    }
    renderToolbar();
  }

  // ----- dialogs ---------------------------------------------------------------------
  function showTags() {
    const vp = viewports[state.active];
    if (!vp?.frame) return;
    countUse('tags');
    const ds = vp.frame.ds;
    const filter = h('input', { type: 'search', placeholder: T('Attribut suchen …', 'Search attribute …'), oninput: () => fill() });
    const body = h('tbody');
    const rows = [];
    const walk = (d, depth) => {
      for (const tag of Object.keys(d.el).sort()) {
        const e = d.el[tag];
        rows.push([`${'› '.repeat(depth)}(${tag.slice(0, 4)},${tag.slice(4)})`, e.vr, DICT[tag]?.[1] || (parseInt(tag.slice(0, 4), 16) % 2 ? 'Private' : ''), tag === '00020010' ? `${d.display(tag)} (${TRANSFER_SYNTAX[d.string(tag)] || '?'})` : d.display(tag)]);
        if (e.items) e.items.forEach((it) => walk(it, depth + 1));
      }
    };
    walk(ds, 0);
    const fill = () => {
      const q = filter.value.toLowerCase();
      body.replaceChildren(...rows.filter((r) => !q || r.join(' ').toLowerCase().includes(q)).map((r) => h('tr', r.map((c) => h('td', c)))));
    };
    fill();
    modal(T('DICOM-Attribute', 'DICOM attributes'), [filter, h('div.table-scroll', h('table.tags', h('thead', h('tr', ['Tag', 'VR', T('Name', 'Name'), T('Wert', 'Value')].map((c) => h('th', c)))), body))], { wide: true });
    setTimeout(() => filter.focus(), 50);
  }

  function showHelp() {
    const rows = [
      [T('Mausrad', 'Mouse wheel'), T('Blättern', 'Scroll')], [T('Strg + Mausrad', 'Ctrl + wheel'), 'Zoom'],
      [T('Rechte Maustaste ziehen', 'Right-drag'), 'Zoom'], [T('Mittlere Maustaste / Umschalt + ziehen', 'Middle button / Shift + drag'), T('Verschieben', 'Pan')],
      [T('Strg + ziehen', 'Ctrl + drag'), T('Fensterung', 'Window/level')], [T('Doppelklick', 'Double-click'), T('Fenster maximieren', 'Maximise viewport')],
      ['↑ ↓ / Bild↑ Bild↓ / Pos1 Ende', T('Blättern (1 / 10 / Anfang, Ende)', 'Scroll (1 / 10 / first, last)')],
      ['S W P Z', T('Blättern, Fenstern, Verschieben, Zoom', 'Scroll, window, pan, zoom')],
      ['L A E R H T', T('Länge, Winkel, Ellipse, Rechteck, Punktwert, Pfeil', 'Length, angle, ellipse, rectangle, point value, arrow')],
      ['C / M', T('3D-Fadenkreuz / MPR', '3D crosshair / MPR')], ['1 – 6', T('CT-Fenster-Voreinstellungen', 'CT window presets')],
      ['I / 0', T('Invertieren / Ansicht zurücksetzen', 'Invert / reset view')], ['K', T('Schlüsselbild', 'Key image')],
      [T('Leertaste', 'Space'), 'Cine'], [T('Entf', 'Del'), T('Markierte Messung löschen', 'Delete selected measurement')],
    ];
    modal(T('Bedienung', 'Controls'), h('table.help', rows.map((r) => h('tr', h('td', h('kbd', r[0])), h('td', r[1])))));
  }

  async function exportImage() {
    const vp = viewports[state.active];
    if (!vp?.frame) return;
    countUse('export');
    download(`${study.patient.id}_${vp.set.series.number}_${vp.index + 1}.png`, await vp.exportPng(), 'image/png');
    audit('image.export', { studyUid, sop: vp.frame.sop });
  }

  function keyImage() {
    const vp = viewports[state.active];
    if (!vp?.frame || vp.set.kind !== 'stack') return;
    const on = toggleKeyImage(vp.set.study.uid, vp.set.series.uid, vp.set.sopAt(vp.index), vp.index);
    countUse('keyimage');
    toast(on ? T('Als Schlüsselbild markiert', 'Flagged as key image') : T('Schlüsselbild entfernt', 'Key image removed'));
    sidePanels.refresh?.(); renderToolbar();
  }

  // ----- toolbar ---------------------------------------------------------------------
  function btn(label, title, onclick, active = false, disabled = false) {
    return h(`button.tb${active ? '.on' : ''}`, { title, 'aria-label': title, onclick, disabled }, label);
  }
  function renderToolbar() {
    const vp = viewports[state.active], f = vp?.frame, v = vp?.view || {};
    const isCt = f?.modality === 'CT';
    const isKey = f && vp.set.kind === 'stack' && (getKeyImages()[vp.set.study.uid] || []).some((k) => k.sop === vp.set.sopAt(vp.index));
    const preset = h('select.tb', { title: T('Fenster-Voreinstellung', 'Window preset'), onchange: (e) => {
      const val = e.target.value; if (!vp?.frame) return;
      if (val === 'default') vp.setWindow(vp.frame.wc, vp.frame.ww);
      else if (val === 'auto') { const fr = vp.frame; let mn = Infinity, mx = -Infinity; for (const p of fr.pixels) { if (p < mn) mn = p; if (p > mx) mx = p; } vp.setWindow((mn + mx) / 2 * fr.slope + fr.intercept, (mx - mn) * fr.slope || 1); }
      else { const [, c, w] = CT_PRESETS()[Number(val)]; vp.setWindow(c, w); }
      countUse('preset'); e.target.value = '';
    } }, h('option', { value: '' }, T('Fenster …', 'Window …')), h('option', { value: 'default' }, T('Standard (DICOM)', 'Default (DICOM)')), h('option', { value: 'auto' }, T('Auto (Min/Max)', 'Auto (min/max)')),
      isCt ? CT_PRESETS().map(([n, c, w], i) => h('option', { value: i }, `${i + 1}  ${n}  (${c}/${w})`)) : null);
    const layout = h('select.tb', { title: 'Layout', onchange: (e) => { const [r, c] = e.target.value.split('x').map(Number); if (state.mpr) exitMpr(); setLayout(r, c); countUse('layout'); } },
      ['1x1', '1x2', '1x3', '2x1', '2x2', '2x3'].map((l) => h('option', { value: l, selected: l === state.layout.join('x') }, `Layout ${l.replace('x', '×')}`)));
    const slab = state.mpr ? h('select.tb', { title: T('Schichtdicke / Projektion', 'Slab thickness / projection'), onchange: (e) => { const [mm, mode] = e.target.value.split('|'); setSlab(Number(mm), mode); } },
      [['0|mip', T('Dünnschicht', 'Thin')], ['5|mip', 'MIP 5 mm'], ['10|mip', 'MIP 10 mm'], ['20|mip', 'MIP 20 mm'], ['10|minip', 'MinIP 10 mm'], ['5|avg', T('Mittel 5 mm', 'Average 5 mm')], ['10|avg', T('Mittel 10 mm', 'Average 10 mm')]]
        .map(([val, n]) => h('option', { value: val, selected: val === `${state.mpr.slab || 0}|${state.mpr.mode || 'mip'}` }, n))) : null;
    toolbar.replaceChildren(
      h('div.tb-group', TOOLS().map(([id, ic, title]) => btn(icon(ic), title, () => { state.tool = id; renderToolbar(); }, state.tool === id))),
      h('div.tb-group', preset, btn(icon('invert'), T('Invertieren (I)', 'Invert (I)'), () => { v.invert = !v.invert; vp.draw(); renderToolbar(); countUse('invert'); }, v.invert, !f),
        btn(icon('rotate'), T('90° drehen', 'Rotate 90°'), () => { v.rot = (v.rot + 90) % 360; vp.draw(); countUse('rotate'); }, false, !f),
        btn(icon('flipH'), T('Horizontal spiegeln', 'Flip horizontally'), () => { v.flipH = !v.flipH; vp.draw(); countUse('flip'); }, v.flipH, !f),
        btn(icon('flipV'), T('Vertikal spiegeln', 'Flip vertically'), () => { v.flipV = !v.flipV; vp.draw(); countUse('flip'); }, v.flipV, !f),
        btn(icon('reset'), T('Ansicht zurücksetzen (0)', 'Reset view (0)'), () => { vp.reset(); renderToolbar(); }, false, !f)),
      h('div.tb-group', layout,
        btn('MPR', T('Multiplanare Rekonstruktion (M)', 'Multiplanar reformation (M)'), () => (state.mpr ? exitMpr() : enterMpr()), !!state.mpr, !f || (!state.mpr && vp.set.length < 5)), slab,
        btn(T('Vergleich', 'Compare'), T('Mit Voruntersuchung vergleichen', 'Compare with prior study'), compare, false, !priors.length),
        btn(icon('sync'), state.registration ? T('Synchron blättern (automatisch registriert)', 'Synchronised scrolling (registered automatically)') : T('Synchron blättern', 'Synchronised scrolling'), () => setSync(!state.sync), state.sync, viewports.length < 2 || !!state.mpr),
        state.registration ? h('span.reg', { title: T('Automatische Registrierung der Voruntersuchung', 'Automatic registration of the prior study') }, `REG ${state.registration.score.toFixed(2)}`) : null,
        btn(icon('reflines'), T('Referenzlinien', 'Reference lines'), () => { state.refLines = !state.refLines; viewports.forEach((x) => x.draw()); renderToolbar(); countUse('reflines'); }, state.refLines),
        btn(icon(state.cine ? 'pause' : 'play', true), T('Cine (Leertaste)', 'Cine (space)'), toggleCine, !!state.cine, !f || vp.set.length < 2)),
      h('div.tb-group', btn(icon('star', isKey), T('Schlüsselbild (K)', 'Key image (K)'), keyImage, isKey, !f || vp.set.kind !== 'stack'),
        btn(icon('tags'), T('DICOM-Attribute', 'DICOM attributes'), showTags, false, !f),
        btn(icon('export'), T('Bild exportieren (PNG)', 'Export image (PNG)'), exportImage, false, !f),
        btn(icon('smooth'), T('Bildglättung (Interpolation)', 'Image smoothing (interpolation)'), () => { state.smoothing = !state.smoothing; setPref('smoothing', state.smoothing); viewports.forEach((x) => x.draw()); renderToolbar(); }, state.smoothing),
        btn(icon('help'), T('Bedienung / Tastenkürzel', 'Controls / shortcuts'), showHelp)),
      status);
  }

  // ----- keyboard --------------------------------------------------------------------
  function onKey(e) {
    if (e.target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-back')) return;
    const vp = viewports[state.active];
    const k = e.key.toLowerCase();
    let used = true;
    if (KEYS[k]) { state.tool = KEYS[k]; renderToolbar(); }
    else if (k === 'arrowdown' || k === 'arrowright') vp?.scrollBy(1);
    else if (k === 'arrowup' || k === 'arrowleft') vp?.scrollBy(-1);
    else if (k === 'pagedown') vp?.scrollBy(10);
    else if (k === 'pageup') vp?.scrollBy(-10);
    else if (k === 'home') vp?.show(0);
    else if (k === 'end') vp?.set && vp.show(vp.set.length - 1);
    else if (k === ' ') toggleCine();
    else if (k === 'i' && vp?.frame) { vp.view.invert = !vp.view.invert; vp.draw(); renderToolbar(); }
    else if (k === '0' && vp?.frame) { vp.reset(); renderToolbar(); }
    else if (k === 'm') (state.mpr ? exitMpr() : enterMpr());
    else if (k === 'k') keyImage();
    else if ((k === 'delete' || k === 'backspace') && vp) vp.deleteSelected();
    else if (k === 'escape' && vp) { vp.pending = null; vp.selected = null; vp.draw(); }
    else if (/^[1-9]$/.test(k) && vp?.frame?.modality === 'CT' && CT_PRESETS()[Number(k) - 1]) { const [, c, w] = CT_PRESETS()[Number(k) - 1]; vp.setWindow(c, w); countUse('preset'); }
    else used = false;
    if (used) e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  // ----- side panel ---------------------------------------------------------------------
  const sidePanels = {};
  function jumpTo(seriesUid, index) {
    const st = [study, ...priors].find((s) => s.series.some((x) => x.uid === seriesUid));
    const se = st?.series.find((x) => x.uid === seriesUid);
    if (!se) return;
    if (state.mpr) exitMpr(false);
    const vp = viewports[state.active];
    if (vp.set?.kind === 'stack' && vp.set.series.uid === seriesUid) vp.show(index); else loadSeries(state.active, st, se, index);
  }
  /** All measurements of the study as text lines (for the list and the report). */
  function measurements() {
    const out = [];
    for (const se of study.series) {
      const stack = stackOf(study, se), by = allAnnotations(stack);
      stack.refs.forEach((_, i) => {
        for (const a of by[stack.sopAt(i)] || []) {
          out.push({ seriesUid: se.uid, index: i, a, label: `${T('Serie', 'Series')} ${se.number}, ${T('Bild', 'image')} ${i + 1}`, stack });
        }
      });
    }
    return out;
  }
  async function measurementText(m) {
    const f = await m.stack.getFrame(m.index);
    const r = measure(m.a, f);
    const names = { length: T('Länge', 'Length'), angle: T('Winkel', 'Angle'), ellipse: 'ROI', rect: 'ROI', probe: T('Punktwert', 'Point value'), arrow: T('Markierung', 'Marker') };
    return `${names[m.a.type]}: ${String(r.text).replace(/\n/g, ', ')} (${m.label})`;
  }

  function renderSide() {
    const tabs = [['report', T('Befund', 'Report')], ['meas', T('Messungen', 'Measurements')], ['tasks', T('Testaufgaben', 'Test tasks')]];
    let current = getPrefs().sideTab || 'report';
    const body = h('div.side-body');
    const head = h('div.side-tabs');
    const draw = () => {
      head.replaceChildren(...tabs.map(([id, name]) => h(`button${current === id ? '.on' : ''}`, { onclick: () => { current = id; setPref('sideTab', id); draw(); } }, name)));
      body.replaceChildren();
      if (current === 'report') body.append(reportPanel(study, priors, { measurements, measurementText }));
      else if (current === 'tasks') body.append(taskPanel(nav));
      else {
        const ms = measurements(), keys = getKeyImages()[study.uid] || [];
        body.append(h('h3', T('Messungen und Annotationen', 'Measurements and annotations')));
        if (!ms.length) body.append(h('p.muted', T('Noch keine Messungen. Werkzeug wählen und im Bild ziehen.', 'No measurements yet. Pick a tool and drag in the image.')));
        for (const m of ms) {
          const line = h('span', '…');
          measurementText(m).then((t) => { line.textContent = t; });
          body.append(h('div.meas', { onclick: () => jumpTo(m.seriesUid, m.index) }, line,
            h('button.icon', { title: T('Löschen', 'Delete'), onclick: (e) => { e.stopPropagation(); const by = allAnnotations(m.stack), list = by[m.stack.sopAt(m.index)]; list.splice(list.indexOf(m.a), 1); viewports.forEach((v) => { if (v.set === m.stack) v._changed(); }); if (!viewports.some((v) => v.set === m.stack)) draw(); } }, '✕')));
        }
        body.append(h('h3', T('Schlüsselbilder', 'Key images')));
        if (!keys.length) body.append(h('p.muted', T('Keine Schlüsselbilder markiert (Taste K).', 'No key images flagged (key K).')));
        for (const k of keys) {
          const se = study.series.find((s) => s.uid === k.seriesUid);
          body.append(h('div.meas', { onclick: () => jumpTo(k.seriesUid, k.index) }, `★ ${T('Serie', 'Series')} ${se?.number ?? ''} ${se?.description || ''}, ${T('Bild', 'image')} ${k.index + 1}`));
        }
      }
    };
    sidePanels.refresh = () => { if (current === 'meas') draw(); };
    side.replaceChildren(head, body);
    draw();
  }

  // ----- assemble --------------------------------------------------------------------
  const p = study.patient;
  root.append(h('div.viewer',
    h('header.viewer-head',
      h('button.back', { onclick: () => caseDebrief(study, priors.some((p) => p.date <= study.date), () => nav('#/worklist')), title: T('Fall schließen und zur Arbeitsliste', 'Close case and return to worklist') }, '‹ ' + T('Arbeitsliste', 'Worklist')),
      h('div.patient', h('b', p.name), h('span', `ID ${p.id}`), h('span', [p.sex, p.age].filter(Boolean).join(' · ')),
        h('span', `${fmtDate(study.date)} · ${study.modalities.join('/')} · ${study.description || ''}`), h('span.muted', `${T('Auftrag', 'Acc.')} ${study.accession || '–'}`)),
      h('span.warn-chip', T('Nicht für die klinische Diagnostik', 'Not for clinical use'))),
    toolbar,
    h('div.viewer-main', seriesPanel, grid, side)));

  // Hanging protocol: two series side by side when available, otherwise a single viewport.
  const usable = study.series.filter((s) => s.instances.length > 1 || study.series.length === 1);
  const initial = usable.length ? usable : study.series;
  const cols = params.get('compare') ? 1 : Math.min(initial.length, 3);
  setLayout(1, Math.max(1, cols), false);
  renderSeriesPanel(); renderSide();
  (async () => {
    for (let i = 0; i < viewports.length; i++) await loadSeries(i, study, initial[i]);
    setActive(0); markActive(); renderToolbar();
    if (params.get('compare')) compare();
  })();
  renderToolbar();

  return () => {
    document.removeEventListener('keydown', onKey);
    if (state.cine) clearInterval(state.cine);
    viewports.forEach((v) => v.destroy());
    audit('study.close', { studyUid });
  };
}
