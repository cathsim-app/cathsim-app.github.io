// Small shared helpers: i18n, DOM construction, formatting, vector math.
let lang = 'de';
try { lang = localStorage.getItem('vp.lang') || ((navigator.language || 'de').startsWith('de') ? 'de' : 'en'); } catch { /* storage unavailable */ }

export const getLang = () => lang;
export function setLang(l) { lang = l; try { localStorage.setItem('vp.lang', l); } catch { /* ignore */ } }
/** Inline translation: T('Befund', 'Report'). */
export const T = (de, en) => (lang === 'de' ? de : en);

/** Hyperscript: h('div.cls#id', {onclick, title}, child, ...). */
export function h(spec, attrs, ...children) {
  const [tagAndId, ...classes] = spec.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : String(c));
  };
  children.forEach(add);
  return el;
}

export function fmtDate(d) {
  if (!d || d.length < 8) return d || '';
  return lang === 'de' ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}
export const fmtTime = (t) => (t && t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : '');
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
}
export const fmtNum = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');

export function toast(msg, kind = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div#toasts'); document.body.append(box); }
  const el = h(`div.toast.${kind}`, msg);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const back = h('div.modal-back', { onpointerdown: (e) => { if (e.target === back) close(); } },
    h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-label': title },
      h('div.modal-head', h('h2', title), h('button.icon', { onclick: close, title: T('Schließen', 'Close') }, '✕')),
      h('div.modal-body', body)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return close;
}

// --- vectors -------------------------------------------------------------
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** Patient-orientation letters (LPS) for a direction vector, e.g. "A", "LP", "HF". */
export function orientationLabel(v) {
  const axes = [[Math.abs(v[0]), v[0] > 0 ? 'L' : 'R'], [Math.abs(v[1]), v[1] > 0 ? 'P' : 'A'], [Math.abs(v[2]), v[2] > 0 ? 'H' : 'F']];
  return axes.filter((a) => a[0] > 0.3).sort((a, b) => b[0] - a[0]).map((a) => a[1]).join('');
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
