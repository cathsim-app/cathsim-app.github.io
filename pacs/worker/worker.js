// VibePACS result store: a small Cloudflare Worker with KV (free tier).
// Readers' evaluations and finalized reports are collected centrally.
//
// Authentication is stateless: the upload credential of a user is
//   HMAC-SHA-256(STUDY_SECRET, "<id>|<role>")  (hex)
// It is placed inside the user's password-encrypted envelope (config/access.json) when the
// accounts are created, so the worker needs no account list.
//
// GET  /version                                   → {ok, version}
// POST /submit        (x-user, x-role, x-token) {kind: evaluation|report, data} → {ok, key}
// GET  /admin/results (admin)                     → {rows: [{key, kind, user, t, data}]}
// PUT  /admin/results (admin) {remove: key}       → {ok}
const VERSION = 1;
const ORIGINS = ['https://cathsim-app.github.io', 'http://localhost:8765', 'http://localhost:8000'];
const KINDS = new Set(['evaluation', 'report']);
const MAX_BYTES = 300000;

function cors(req, env) {
  const o = req.headers.get('origin') || '';
  const allowed = [...ORIGINS, ...String(env.EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)];
  return { 'access-control-allow-origin': allowed.includes(o) ? o : allowed[0], 'access-control-allow-headers': 'content-type, x-user, x-role, x-token',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-max-age': '86400', vary: 'origin' };
}
const json = (req, env, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors(req, env), 'content-type': 'application/json' } });

export async function credential(secret, id, role) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id.toLowerCase()}|${role}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function identify(req, env) {
  const id = (req.headers.get('x-user') || '').trim().toLowerCase(), role = req.headers.get('x-role') || 'reader', token = req.headers.get('x-token') || '';
  if (!env.STUDY_SECRET || !/^[a-z0-9._-]{1,40}$/.test(id) || !['reader', 'admin'].includes(role)) return null;
  return sameString(token, await credential(env.STUDY_SECRET, id, role)) ? { id, role } : null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    if (path === '/version') return json(req, env, { ok: true, version: VERSION });
    const who = await identify(req, env);
    if (!who) return json(req, env, { error: 'unauthorized' }, 401);

    if (path === '/submit' && req.method === 'POST') {
      const text = await req.text();
      if (text.length > MAX_BYTES) return json(req, env, { error: 'too large' }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json(req, env, { error: 'invalid json' }, 400); }
      if (!KINDS.has(body.kind) || typeof body.data !== 'object' || body.data === null) return json(req, env, { error: 'invalid payload' }, 400);
      const t = new Date().toISOString();
      const key = `r:${body.kind}:${who.id}:${t}`;
      await env.RESULTS.put(key, JSON.stringify({ kind: body.kind, user: who.id, t, data: body.data }));
      return json(req, env, { ok: true, key });
    }

    if (path === '/admin/results') {
      if (who.role !== 'admin') return json(req, env, { error: 'forbidden' }, 403);
      if (req.method === 'GET') {
        const rows = [];
        let cursor;
        do {
          const page = await env.RESULTS.list({ prefix: 'r:', cursor });
          for (const k of page.keys) { const v = await env.RESULTS.get(k.name); if (v) rows.push({ key: k.name, ...JSON.parse(v) }); }
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
        return json(req, env, { rows });
      }
      if (req.method === 'PUT') {
        const body = await req.json().catch(() => ({}));
        if (typeof body.remove !== 'string' || !body.remove.startsWith('r:')) return json(req, env, { error: 'invalid payload' }, 400);
        await env.RESULTS.delete(body.remove);
        return json(req, env, { ok: true });
      }
    }
    return json(req, env, { error: 'not found' }, 404);
  },
};
