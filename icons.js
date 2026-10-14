// Eigener, minimalistischer Icon-Satz als SVG-Sprite – unabhängig von Browser- und
// System-Emojis. Verwendung: ic('phone') liefert <svg class="ic"><use …></svg>.
(function () {
  const P = {
    // Geräte & Verbindung
    chat: '<path d="M4 5.5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.4"/><path d="M10.5 18h3"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><path d="M5.5 5.5h2v2h-2zM16.5 5.5h2v2h-2zM5.5 16.5h2v2h-2zM14 14h3v3M21 14v3h-3M14 21h3M21 21h-1"/>',
    camera: '<path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20v10.5H4z"/><circle cx="12" cy="13.5" r="3.2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
    unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/><path d="M4 4l16 16"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M6 12.5a9 9 0 0 1 12 0"/><path d="M9.5 16a4 4 0 0 1 5 0"/><circle cx="12" cy="19.2" r=".9" fill="currentColor"/>',
    // Personen
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4"/><path d="M17.5 13.8A6.5 6.5 0 0 1 21.5 20"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    logout: '<path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5"/><path d="M15.5 16.5l4.5-4.5-4.5-4.5"/><path d="M20 12H9.5"/>',
    // Fachgebiete
    brain: '<path d="M12 4.2a3.6 3.6 0 0 0-5.2 2.9 3.2 3.2 0 0 0-1.6 5.6 3.2 3.2 0 0 0 1.4 4.1A3.6 3.6 0 0 0 12 19.6"/><path d="M12 4.2a3.6 3.6 0 0 1 5.2 2.9 3.2 3.2 0 0 1 1.6 5.6 3.2 3.2 0 0 1-1.4 4.1A3.6 3.6 0 0 1 12 19.6"/><path d="M12 4.2v15.4"/><path d="M8.5 9.5c1 .4 2 .2 2.5-.6M15.5 9.5c-1 .4-2 .2-2.5-.6M8 14.5c1.2-.2 2.3.2 3 1M16 14.5c-1.2-.2-2.3.2-3 1"/>',
    body: '<circle cx="12" cy="4.6" r="2.3"/><path d="M8 9.5h8l1.2 5.5h-2.2l-.6 6.5H9.6L9 15H6.8z"/>',
    // Startmenü
    list: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    tray: '<path d="M3.5 11.5h17V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M7 11.5V8.5h10v3"/><path d="M3.5 14.5h17"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    chevL: '<path d="M14.5 6l-6 6 6 6"/>',
    chevR: '<path d="M9.5 6l6 6-6 6"/>',
    arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    rotL: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v4.2h4.2"/>',
    rotR: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.8v4.2h-4.2"/>',
    refresh: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v4.2h4.2"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    circle: '<circle cx="12" cy="12" r="7"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
    flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4 2.5 4H6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16.5l8-8"/>',
    warn: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".9" fill="currentColor"/>',
    stop: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    flame: '<path d="M12 3.5c1 3 4.5 4.5 4.5 9a4.5 4.5 0 0 1-9 0c0-2 1-3.2 1.5-4 .3 1.2 1 2 2 2.2C11.5 8.5 11 6 12 3.5z"/>',
    // Fallsymbole
    aneurysm: '<path d="M12 21v-7"/><circle cx="12" cy="9.5" r="4.5"/>',
    thrombus: '<path d="M8.6 3.5h6.8l4.8 4.8v6.8l-4.8 4.8H8.6l-4.8-4.8V8.3z"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
    stent: '<rect x="7.5" y="3.5" width="9" height="17" rx="4.5"/><path d="M7.5 9.5l9 5M7.5 14.5l9-5"/>',
    drop: '<path d="M12 3.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.4-4.4"/>',
    // Technik
    radiation: '<circle cx="12" cy="12" r="2"/><path d="M12 3.5a8.5 8.5 0 0 1 7.4 4.3l-5 2.9A2.7 2.7 0 0 0 12 9.3z"/><path d="M4.6 7.8A8.5 8.5 0 0 1 12 3.5v5.8a2.7 2.7 0 0 0-2.4 1.4z"/><path d="M12 20.5a8.5 8.5 0 0 1-7.4-4.3l5-2.9a2.7 2.7 0 0 0 4.8 0l5 2.9A8.5 8.5 0 0 1 12 20.5z"/>',
    table: '<path d="M3 9h18M5 9v10M19 9v10M3 19h4M17 19h4"/>',
    fine: '<path d="M4 12h16"/><circle cx="12" cy="12" r="3"/>',
  };
  let sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">';
  for (const k of Object.keys(P)) sprite += `<symbol id="ic-${k}" viewBox="0 0 24 24">${P[k]}</symbol>`;
  sprite += '</svg>';
  function inject() { if (document.getElementById('ic-sprite')) return; const d = document.createElement('div'); d.id = 'ic-sprite'; d.innerHTML = sprite; document.body.insertBefore(d, document.body.firstChild); }
  if (document.body) inject(); else document.addEventListener('DOMContentLoaded', inject);
  // Das Logo: ein Katheter, der in ein Aneurysma zielt – ein Zeichen, das man ohne Text liest.
  window.logoSVG = `<svg viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="lg-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fe9cc"/><stop offset="1" stop-color="#1f8fe0"/></linearGradient><radialGradient id="lg-r" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#2fe9cc" stop-opacity="0.9"/><stop offset="1" stop-color="#2fe9cc" stop-opacity="0"/></radialGradient></defs><rect x="4" y="4" width="88" height="88" rx="24" fill="#08151a"/><rect x="4" y="4" width="88" height="88" rx="24" fill="none" stroke="url(#lg-g)" stroke-width="4"/><circle cx="66" cy="40" r="16" fill="url(#lg-r)"/><circle cx="66" cy="40" r="11" fill="none" stroke="url(#lg-g)" stroke-width="2.5" opacity="0.9"/><path d="M 22 76 C 22 50 32 32 52 28 C 60 26 66 30 66 38" fill="none" stroke="#f6fbfa" stroke-width="6" stroke-linecap="round"/><circle cx="66" cy="40" r="4.5" fill="#2fe9cc"/></svg>`;
  function placeLogos() { document.querySelectorAll('.brand .mark').forEach(m => { if (!m.firstChild) m.innerHTML = window.logoSVG; }); }
  if (document.body) placeLogos(); else document.addEventListener('DOMContentLoaded', placeLogos);
  window.ic = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
  window.icNames = Object.keys(P);
})();
