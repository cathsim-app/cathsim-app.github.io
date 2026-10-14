// Minimales WASI für den Browser — genug für die Swift-Laufzeit (Uhr, Zufall, stdout).
(function (root) {
  function makeWasi() {
    let memory = null; const dec = new TextDecoder();
    const view = () => new DataView(memory.buffer), u8 = () => new Uint8Array(memory.buffer);
    let out = '';
    const wasi = {
      args_sizes_get(a, b) { view().setUint32(a, 0, true); view().setUint32(b, 0, true); return 0; }, args_get() { return 0; },
      environ_sizes_get(a, b) { view().setUint32(a, 0, true); view().setUint32(b, 0, true); return 0; }, environ_get() { return 0; },
      clock_time_get(id, prec, ptr) { const t = id === 0 ? Date.now() * 1e6 : performance.now() * 1e6; view().setBigUint64(ptr, BigInt(Math.round(t)), true); return 0; },
      clock_res_get(id, ptr) { view().setBigUint64(ptr, 1000n, true); return 0; },
      random_get(ptr, len) { crypto.getRandomValues(u8().subarray(ptr, ptr + len)); return 0; },
      fd_write(fd, iovs, n, nw) { let c = 0; const v = view(); for (let i = 0; i < n; i++) { const p = v.getUint32(iovs + i * 8, true), l = v.getUint32(iovs + i * 8 + 4, true); out += dec.decode(u8().subarray(p, p + l)); c += l; } v.setUint32(nw, c, true); const nl = out.lastIndexOf('\n'); if (nl >= 0) { console.log('[wasm]', out.slice(0, nl)); out = out.slice(nl + 1); } return 0; },
      fd_read(fd, iovs, n, nr) { view().setUint32(nr, 0, true); return 0; }, fd_close() { return 0; },
      fd_seek(fd, off, w, ptr) { view().setBigUint64(ptr, 0n, true); return 0; }, fd_tell(fd, ptr) { view().setBigUint64(ptr, 0n, true); return 0; },
      fd_fdstat_get(fd, ptr) { const v = view(); v.setUint8(ptr, fd <= 2 ? 2 : 4); v.setUint16(ptr + 2, 0, true); v.setBigUint64(ptr + 8, 0n, true); v.setBigUint64(ptr + 16, 0n, true); return 0; },
      fd_fdstat_set_flags() { return 0; }, fd_prestat_get() { return 8; }, fd_prestat_dir_name() { return 8; }, fd_filestat_get() { return 8; },
      path_open() { return 44; }, path_filestat_get() { return 44; }, path_unlink_file() { return 44; }, path_create_directory() { return 44; }, path_remove_directory() { return 44; }, path_readlink() { return 44; }, path_rename() { return 44; },
      fd_readdir() { return 8; }, fd_sync() { return 0; }, fd_datasync() { return 0; }, poll_oneoff(a, b, n, ptr) { view().setUint32(ptr, 0, true); return 0; }, sched_yield() { return 0; },
      proc_exit(code) { throw new Error('wasm exit ' + code); },
    };
    const proxy = new Proxy(wasi, { get(t, k) { return k in t ? t[k] : (() => 52); } });
    return { imports: { wasi_snapshot_preview1: proxy }, setMemory(m) { memory = m; } };
  }
  root.CathSimWasi = { makeWasi };
})(typeof self !== 'undefined' ? self : window);
