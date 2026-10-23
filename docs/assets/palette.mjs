// Palettes, fonts, measuring and escaping shared by the README drawings.
// The fonts are embedded (IBM Plex subsets in fonts/, made by fonts/subset.py),
// so a drawing looks the same on every system instead of falling back to
// whatever condensed face is installed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fonts = join(dirname(fileURLToPath(import.meta.url)), 'fonts');

export const PALETTES = {
  light: { paper: '#F4F3F9', card: '#FFFFFF', well: '#F7F6FB', rule: '#DCD9EA', ink: '#1E1D29', muted: '#615D7A', agent: '#3A33A8', agentSoft: '#E9E7FA', flash: '#1C7C54', flashSoft: '#DDF0E6', look: '#0D6C8E', lookSoft: '#DAEEF6', fail: '#B0611A', failSoft: '#F8EBDD' },
  dark: { paper: '#14131C', card: '#1C1B27', well: '#171621', rule: '#34324B', ink: '#ECEAF6', muted: '#A29EBB', agent: '#ABA6F4', agentSoft: '#27254A', flash: '#5CC596', flashSoft: '#1D3A2D', look: '#63C3E6', lookSoft: '#15323E', fail: '#E6A35C', failSoft: '#3A2A1A' },
};

// Each face: [css family, weight, file, metrics key].
const FACES = {
  display: ['ZA Display', 700, 'plex-cond-bold'],
  sans: ['ZA Sans', 400, 'plex-sans'],
  sansBold: ['ZA Sans', 600, 'plex-sans-semibold'],
  mono: ['ZA Mono', 400, 'plex-mono'],
  monoBold: ['ZA Mono', 600, 'plex-mono-semibold'],
};
const FALLBACK = {
  'ZA Display': 'Avenir Next Condensed, Roboto Condensed, Arial Narrow, sans-serif',
  'ZA Sans': '-apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif',
  'ZA Mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
export const MONO = `ZA Mono, ${FALLBACK['ZA Mono']}`;
export const SANS = `ZA Sans, ${FALLBACK['ZA Sans']}`;
export const DISPLAY = `ZA Display, ${FALLBACK['ZA Display']}`;

const metrics = JSON.parse(readFileSync(join(fonts, 'metrics.json'), 'utf8'));

// The <style> that embeds every face (about 40 KB).
export function fontStyle() {
  const rules = Object.values(FACES).map(([family, weight, file]) => {
    const data = readFileSync(join(fonts, `${file}.woff2`)).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')}`;
  });
  return `<style>${rules.join('')}</style>`;
}

// Width in px of `text` set in `face` (a FACES key) at `size`, plus letter spacing.
export function measure(text, face, size, spacing = 0) {
  const m = metrics[FACES[face][2]];
  let units = 0;
  for (const ch of text) {
    const a = m.advance[ch];
    if (a === undefined) throw new Error(`no glyph for ${JSON.stringify(ch)} in ${face}`);
    units += a;
  }
  return (units / m.unitsPerEm) * size + spacing * [...text].length;
}

// Font attributes for a FACES key.
export function face(name) {
  const [family, weight] = FACES[name];
  return { font: `${family}, ${FALLBACK[family]}`, weight };
}

// Drawing primitives over one palette. `out.svg(title)` returns the document.
export function pen(p, width, height) {
  const out = [];
  const t = (x, y, text, { face: f = 'mono', size = 12, fill = p.ink, spacing = 0, anchor = 'start' } = {}) => {
    const { font, weight } = face(f);
    out.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}"${spacing ? ` letter-spacing="${spacing}"` : ''}${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} fill="${fill}">${esc(text)}</text>`);
  };
  const r = (x, y, w, h, attrs) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`);
  const line = (d, stroke, w = 1.5, extra = '') => out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" ${extra}/>`);
  const marker = (id, c, size = 7) => `<marker id="head-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`;
  const frame = () => {
    out.push(`<defs>${fontStyle()}${marker('agent', p.agent)}${marker('flash', p.flash)}${marker('fail', p.fail)}${marker('fail-sm', p.fail, 4.5)}</defs>`);
    r(0, 0, width, height, `rx="16" fill="${p.paper}"`);
    r(0.5, 0.5, width - 1, height - 1, `rx="16" fill="none" stroke="${p.rule}"`);
  };
  out.svg = (title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<title>${esc(title)}</title>\n${out.join('\n')}\n</svg>\n`;
  return { out, t, r, line, frame };
}

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
