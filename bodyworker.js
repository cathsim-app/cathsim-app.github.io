// Rechnet das CT-Körperbild im Hintergrund, mit einer eigenen Engine-Instanz: die
// Hauptseite bleibt flüssig, auch wenn der C-Bogen dreht.
importScripts('wasi.js');
let ex = null, ready = null;
async function init(m) {
  const wasi = CathSimWasi.makeWasi();
  // Bevorzugt das von der Hauptseite übergebene, fertig übersetzte Modul samt CT-Bytes;
  // sonst (ältere Browser) selbst laden.
  let instance;
  if (m.module) instance = await WebAssembly.instantiate(m.module, wasi.imports);
  else ({ instance } = await WebAssembly.instantiate(await (await fetch(m.wasm)).arrayBuffer(), wasi.imports));
  wasi.setMemory(instance.exports.memory); instance.exports._initialize(); ex = instance.exports;
  const ct = m.ct instanceof Uint8Array ? m.ct : new Uint8Array(await (await fetch(m.ct)).arrayBuffer());
  const p = ex.cs_alloc(ct.length); new Uint8Array(ex.memory.buffer).set(ct, p);
  if (!ex.cs_set_volume(p, ct.length)) throw new Error('CT im Worker nicht lesbar');
}
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') { ready = init(m); try { await ready; postMessage({ type: 'ready' }); } catch (err) { postMessage({ type: 'failed', error: String(err) }); } return; }
  await ready;
  // Kommt während des Rechnens ein neuerer Auftrag, verfällt der ältere ungerechnet.
  pending = m; if (busy) return; busy = true;
  try { while (pending) { const job = pending; pending = null; renderJob(job); } } finally { busy = false; }
};
let pending = null, busy = false;
function renderJob(m) {
  const { id, size, coverage, lao, cranial, fov, pan, iso } = m;
  const ptr = ex.cs_body_at(size, coverage, lao, cranial, fov, pan[0], pan[1], iso[0], iso[1], iso[2]);
  if (!ptr) { postMessage({ type: 'body', id, ok: false }); return; }
  const gray = new Uint8Array(ex.memory.buffer, ptr, size * size);
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) { const src = (size - 1 - y) * size; for (let x = 0; x < size; x++) { const g = gray[src + x]; const o = (y * size + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = 255; } }
  postMessage({ type: 'body', id, ok: true, size, rgba }, [rgba.buffer]);
}
