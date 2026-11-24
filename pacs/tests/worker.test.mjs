// Exercises the result-store worker against an in-memory KV.
import assert from 'node:assert/strict';
import worker, { credential } from '../worker/worker.js';

const store = new Map();
const env = { STUDY_SECRET: 'test-secret', EXTRA_ORIGINS: '', RESULTS: {
  put: async (k, v) => { store.set(k, v); }, get: async (k) => store.get(k) ?? null, delete: async (k) => { store.delete(k); },
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
} };
const call = async (path, { method = 'GET', id, role = 'reader', token, body } = {}) => {
  const headers = { origin: 'https://cathsim-app.github.io', 'content-type': 'application/json' };
  if (id) Object.assign(headers, { 'x-user': id, 'x-role': role, 'x-token': token ?? await credential(env.STUDY_SECRET, id, role) });
  const r = await worker.fetch(new Request('https://w.example' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, json: await r.json().catch(() => null), cors: r.headers.get('access-control-allow-origin') };
};

assert.equal((await call('/version')).json.ok, true);
assert.equal((await call('/submit', { method: 'POST', body: { kind: 'evaluation', data: {} } })).status, 401);
assert.equal((await call('/submit', { method: 'POST', id: 'reader01', token: 'wrong', body: { kind: 'evaluation', data: {} } })).status, 401);
// A reader credential must not work with the admin role.
assert.equal((await call('/admin/results', { id: 'reader01', role: 'admin', token: await credential(env.STUDY_SECRET, 'reader01', 'reader') })).status, 401);
const ok = await call('/submit', { method: 'POST', id: 'Reader01', body: { kind: 'evaluation', data: { susScore: 80 } } });
assert.equal(ok.status, 200); assert.equal(ok.cors, 'https://cathsim-app.github.io');
assert.equal((await call('/submit', { method: 'POST', id: 'reader01', body: { kind: 'other', data: {} } })).status, 400);
assert.equal((await call('/admin/results', { id: 'reader01' })).status, 403);
const rows = (await call('/admin/results', { id: 'admin', role: 'admin' })).json.rows;
assert.equal(rows.length, 1); assert.equal(rows[0].user, 'reader01'); assert.equal(rows[0].data.susScore, 80);
assert.equal((await call('/admin/results', { method: 'PUT', id: 'admin', role: 'admin', body: { remove: rows[0].key } })).status, 200);
assert.equal(store.size, 0);
console.log('worker: all checks passed');
