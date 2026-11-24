// Application shell: routing, session guard, error reporting.
import { T, h, toast } from './util.js';
import { currentUser, loadConfig } from './auth.js';
import { loadIndex } from './archive.js';
import { audit, flushOutbox } from './store.js';
import { loginScreen } from './ui/login.js';
import { worklistScreen } from './ui/worklist.js';
import { viewerScreen } from './ui/viewer.js';
import { evaluationScreen } from './ui/evaluation.js';
import { adminScreen } from './ui/admin.js';

const root = document.getElementById('app');
let cleanup = null;
const nav = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function route() {
  cleanup?.(); cleanup = null;
  root.replaceChildren();
  document.documentElement.lang = T('de', 'en');
  const [path, query] = (location.hash.replace(/^#\/?/, '') || 'worklist').split('?');
  const [screen, arg] = path.split('/');
  const params = new URLSearchParams(query || '');
  if (!currentUser()) { cleanup = loginScreen(root, nav, route); return; }
  if (screen === 'login') { nav('#/worklist'); return; }
  try { await loadIndex(); } catch (e) { root.append(h('div.center', T('Studienindex konnte nicht geladen werden: ', 'Study index could not be loaded: ') + e.message)); return; }
  if (screen === 'viewer' && arg) cleanup = viewerScreen(root, decodeURIComponent(arg), params, nav);
  else if (screen === 'evaluation') cleanup = evaluationScreen(root, nav);
  else if (screen === 'admin') cleanup = adminScreen(root, nav);
  else cleanup = worklistScreen(root, nav, route);
}

window.addEventListener('hashchange', route);
window.addEventListener('error', (e) => { if (e.message) toast(T('Fehler: ', 'Error: ') + e.message, 'error', 6000); });
window.addEventListener('unhandledrejection', (e) => toast(T('Fehler: ', 'Error: ') + (e.reason?.message || e.reason), 'error', 6000));
window.addEventListener('online', () => flushOutbox());

await loadConfig();
if (currentUser()) { audit('session.resume'); flushOutbox(); }
route();
