// Site customisation (config/site.json): product and institution name, accent colour,
// window presets, report footer. Lets a department adapt the system without code changes.
import { getLang } from './util.js';

const DEFAULTS = { product: 'VibePACS', institution: '', department: '', accent: null, accentText: null, ctPresets: null, reportFooter: '' };
let site = { ...DEFAULTS };

export async function loadSite() {
  try {
    const r = await fetch('config/site.json', { cache: 'no-cache' });
    if (r.ok) site = { ...DEFAULTS, ...(await r.json()) };
  } catch { /* defaults */ }
  const root = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(site.accent || '')) root.setProperty('--accent', site.accent);
  if (/^#[0-9a-f]{6}$/i.test(site.accentText || '')) root.setProperty('--accent-text', site.accentText);
  document.title = [site.product, site.institution].filter(Boolean).join(' · ');
  return site;
}

/** Localised value: plain strings are returned as is, {de, en} objects by language. */
export const loc = (v) => (v && typeof v === 'object' ? v[getLang()] ?? v.en ?? v.de ?? '' : v || '');
export const getSite = () => site;
