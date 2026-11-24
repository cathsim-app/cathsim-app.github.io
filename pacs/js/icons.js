// Inline SVG icon set (24 x 24, stroke based) so that the toolbar looks the same on every platform.
const P = {
  scroll: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  wl: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  pan: 'M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3',
  zoom: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21M7.5 10.5h6M10.5 7.5v6',
  length: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  angle: 'M4 20h17M4 20L15 4M10 20a7 7 0 0 0-2.2-5.2',
  ellipse: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7s-9-3.1-9-7s4-7 9-7z',
  rect: 'M3 6h18v12H3z',
  probe: 'M12 2v6M12 16v6M2 12h6M16 12h6M12 11.2a.8.8 0 1 0 0 1.6a.8.8 0 0 0 0-1.6z',
  arrow: 'M5 19L19 5M9 5h10v10',
  crosshair: 'M12 2v20M2 12h20M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  invert: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 3v18M12 7h5.5M12 12h9M12 17h5.5',
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9M20 3v5h-5',
  flipH: 'M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z',
  flipV: 'M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z',
  reset: 'M4 12a8 8 0 1 0 2.6-5.9M4 3v5h5',
  sync: 'M9 15l6-6M10.5 6.5l1.2-1.2a4 4 0 0 1 5.6 5.6l-1.2 1.2M13.5 17.5l-1.2 1.2a4 4 0 0 1-5.6-5.6l1.2-1.2',
  reflines: 'M3 5h18v14H3zM3 14l18-5',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z',
  tags: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  export: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  smooth: 'M3 18c4 0 5-12 9-12s5 12 9 12',
  help: 'M9 9a3 3 0 1 1 4.5 2.6c-.9.6-1.5 1.2-1.5 2.4M12 18v.5',
  print: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  layout: 'M3 4h18v16H3zM12 4v16M3 12h18',
};

export function icon(name, filled = false) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', P[name] || '');
  svg.append(path);
  return svg;
}
