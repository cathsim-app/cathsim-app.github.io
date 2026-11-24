// Authentication without a server.
// Each account in config/access.json is an AES-GCM envelope whose key is derived
// from the user's password (PBKDF2-SHA-256). A login succeeds only if the envelope
// decrypts; the plaintext carries the (optional) GitHub token used to store results.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const KDF_ITERATIONS = 310000;

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Creates the encrypted account record stored in access.json. */
export async function sealAccount({ id, name, role }, password, payload, iterations = KDF_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, key, enc.encode(JSON.stringify(payload)));
  return { id, name, role, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function openAccount(account, password, iterations = KDF_ITERATIONS) {
  const key = await deriveKey(password, unb64(account.salt), iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(account.iv), additionalData: enc.encode(account.id) }, key, unb64(account.ct));
    return JSON.parse(dec.decode(pt));
  } catch { return null; }
}

export function randomPassword(words = 4) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => alphabet[b % alphabet.length]).join('');
  return Array.from({ length: words }, part).join('-');
}

let config = null;
let session = null;

export async function loadConfig() {
  if (config) return config;
  try {
    const r = await fetch('config/access.json', { cache: 'no-store' });
    config = r.ok ? await r.json() : { users: [] };
  } catch { config = { users: [] }; }
  return config;
}

export function currentUser() {
  if (session) return session;
  try { session = JSON.parse(sessionStorage.getItem('vp.session') || 'null'); } catch { session = null; }
  return session;
}

export async function login(userId, password) {
  const cfg = await loadConfig();
  const account = cfg.users.find((u) => u.id.toLowerCase() === userId.trim().toLowerCase());
  // Always run the key derivation so that unknown user names are not distinguishable by timing.
  const dummy = { id: 'x', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  const payload = await openAccount(account || dummy, password, cfg.iterations || KDF_ITERATIONS);
  if (!account || !payload) return null;
  session = { id: account.id, name: account.name, role: account.role, token: payload.token || null,
    repo: cfg.resultsRepo || null, branch: cfg.resultsBranch || 'main', loginAt: new Date().toISOString() };
  try { sessionStorage.setItem('vp.session', JSON.stringify(session)); } catch { /* ignore */ }
  return session;
}

export function logout() {
  session = null;
  try { sessionStorage.removeItem('vp.session'); } catch { /* ignore */ }
}
