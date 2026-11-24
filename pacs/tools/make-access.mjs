#!/usr/bin/env node
// Creates config/access.json with encrypted accounts.
// Usage: node make-access.mjs [--endpoint https://vibepacs-log.<account>.workers.dev --secret <STUDY_SECRET>] id:Name:role[:password] ...
// Passwords are generated when omitted and printed once; they are never stored.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealAccount, randomPassword, uploadCredential, KDF_ITERATIONS } from '../js/auth.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const endpoint = opt('--endpoint'), secret = opt('--secret');
const out = opt('--out') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'access.json');
if (!args.length) { console.error('usage: node make-access.mjs [--endpoint URL --secret STUDY_SECRET] id:Name:role[:password] ...'); process.exit(1); }
const users = [];
for (const a of args) {
  const [id, name, role = 'reader', password = randomPassword()] = a.split(':');
  users.push(await sealAccount({ id, name: name || id, role }, password, { token: secret ? await uploadCredential(secret, id, role) : null }));
  console.log(`${id}\t${password}\t(${role})`);
}
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({ version: 1, iterations: KDF_ITERATIONS, endpoint: secret ? endpoint : null, users }, null, 1));
console.error(`written ${out}`);
