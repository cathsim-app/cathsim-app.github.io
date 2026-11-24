import { T, h, getLang, setLang } from '../util.js';
import { login, loadConfig } from '../auth.js';

export function loginScreen(root, nav, rerender) {
  const err = h('div.error');
  const user = h('input', { type: 'text', autocomplete: 'username', placeholder: T('Benutzerkennung', 'User ID'), required: true, autocapitalize: 'none' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Passwort', 'Password'), required: true });
  const submit = h('button.primary.big', { type: 'submit' }, T('Anmelden', 'Sign in'));
  const form = h('form.login-card', { onsubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true; err.textContent = '';
    const s = await login(user.value, pass.value);
    submit.disabled = false;
    if (!s) { err.textContent = T('Kennung oder Passwort falsch.', 'Wrong user ID or password.'); pass.value = ''; pass.focus(); return; }
    nav('#/worklist');
  } },
    h('div.logo', h('span.logo-mark', '◧'), h('div', h('h1', 'VibePACS'), h('p', T('Vollständig KI-generiertes, browserbasiertes PACS – Machbarkeitsstudie', 'Entirely AI-generated, browser-based PACS – feasibility study')))),
    user, pass, err, submit,
    h('p.muted.small', T('Forschungsprototyp mit öffentlich verfügbaren, anonymisierten Bilddaten. Kein Medizinprodukt – nicht für die klinische Diagnostik. Bitte keine Patientendaten hochladen.', 'Research prototype with publicly available, de-identified image data. Not a medical device – not for clinical use. Do not upload patient data.')),
    h('button.link', { type: 'button', onclick: () => { setLang(getLang() === 'de' ? 'en' : 'de'); rerender(); } }, getLang() === 'de' ? 'English' : 'Deutsch'));
  root.append(h('div.login', form));
  loadConfig().then((c) => { if (!c.users?.length) err.textContent = T('Keine Zugangsdatei (config/access.json) gefunden.', 'No access file (config/access.json) found.'); });
  setTimeout(() => user.focus(), 30);
  return () => {};
}
