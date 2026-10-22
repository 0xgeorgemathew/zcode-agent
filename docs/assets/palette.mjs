// Palettes, fonts and escaping shared by the README drawings.
export const PALETTES = {
  light: { paper: '#F3F2F8', card: '#FFFFFF', rule: '#D9D6E8', ink: '#1E1D29', muted: '#5C5875', agent: '#2E2A7A', flash: '#1C7C54', flashSoft: '#DDF0E6', fail: '#A8601A' },
  dark: { paper: '#15141D', card: '#1D1C28', rule: '#33314A', ink: '#ECEAF6', muted: '#A19DBA', agent: '#A9A4F2', flash: '#5CC596', flashSoft: '#1E3A2E', fail: '#E3A15A' },
};
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const SANS = '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif';
export const DISPLAY = 'Avenir Next Condensed, Roboto Condensed, Arial Narrow, Helvetica Neue, sans-serif';
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

