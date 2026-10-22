// Writes docs/assets/acp-light.svg and acp-dark.svg (same drawing, two
// palettes). Run: node docs/assets/build-acp.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, MONO, SANS, DISPLAY, esc } from './palette.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function svg(p) {
  const out = [];
  const t = (x, y, text, { size = 12, fill = p.ink, font = MONO, weight = 400, spacing = 0, anchor = 'start' } = {}) =>
    out.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}" fill="${fill}">${esc(text)}</text>`);
  const r = (x, y, w, h, attrs) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`);
  const line = (d, stroke, width = 1.5, extra = '') => out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`);

  out.push(`<defs>`
    + `<marker id="head-agent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${p.agent}"/></marker>`
    + `<marker id="head-flash" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${p.flash}"/></marker>`
    + `</defs>`);
  r(0, 0, 960, 520, `rx="16" fill="${p.paper}"`);
  r(0.5, 0.5, 959, 519, `rx="16" fill="none" stroke="${p.rule}"`);

  t(40, 48, 'ZCODE-AGENT ACP · A CHAT SESSION, FROM PROMPT TO REPLY', { size: 11, fill: p.muted, spacing: 2.2 });
  out.push(`<text x="40" y="94" font-family="${DISPLAY}" font-size="36" font-weight="700" textLength="808" lengthAdjust="spacingAndGlyphs"><tspan fill="${p.agent}">Your editor chats.</tspan><tspan dx="10" fill="${p.flash}">GLM-5.3 does the work, and asks first.</tspan></text>`);

  // The client: sparse on purpose.
  r(40, 132, 230, 300, `rx="12" fill="${p.card}" stroke="${p.agent}" stroke-width="1.5"`);
  t(58, 158, 'YOUR CLIENT', { size: 11, fill: p.agent, spacing: 1.6, weight: 700 });
  ['T3 Code', 'Zed', 'any ACP client'].forEach((s, i) => t(58, 190 + i * 24, s, { size: 16, font: SANS }));
  line('M58 268 H252', p.rule, 1);
  t(58, 292, 'you choose', { size: 11, fill: p.muted });
  ['mode, model and effort', 'approve or deny each action', 'cancel at any time'].forEach((s, i) => t(58, 316 + i * 22, s, { size: 13, font: SANS }));
  t(58, 412, 'sessions reopen with history', { size: 11, fill: p.muted });

  // The wire: requests right, updates left.
  line('M270 190 H416', p.agent, 2, 'marker-end="url(#head-agent)"');
  t(343, 180, 'prompt, answers', { size: 11, fill: p.agent, anchor: 'middle' });
  line('M416 232 H270', p.flash, 2, 'marker-end="url(#head-flash)"');
  t(343, 222, 'text, diffs, plan', { size: 11, fill: p.flash, anchor: 'middle' });
  t(343, 262, 'ACP v1 over stdio', { size: 11, fill: p.muted, anchor: 'middle' });
  t(343, 280, 'zcode-agent-acp', { size: 11, fill: p.agent, weight: 700, anchor: 'middle' });

  // The agent: dense on purpose.
  r(424, 132, 496, 300, `rx="12" fill="${p.card}" stroke="${p.flash}" stroke-width="1.5"`);
  t(442, 158, 'ZCODE-AGENT ACP', { size: 11, fill: p.flash, spacing: 1.6, weight: 700 });
  t(902, 158, 'defaults: GLM-5.3 · high · Ask', { size: 11, fill: p.muted, anchor: 'end' });

  // Pickers: the filled chip is the default.
  const chip = (x, y, label, on, c = p.flash) => {
    const w = Math.round(label.length * 7.4 + 24);
    r(x, y, w, 26, `rx="13" fill="${on ? c : p.card}" stroke="${c}" stroke-width="1.5"`);
    t(x + w / 2, y + 17.5, label, { size: 13, font: SANS, weight: on ? 700 : 400, fill: on ? p.card : p.ink, anchor: 'middle' });
    return x + w + 8;
  };
  const row = (y, name, labels, note) => {
    t(442, y + 17, name, { size: 11, fill: p.muted, spacing: 1.2 });
    let x = 508;
    labels.forEach(([label, on]) => { x = chip(x, y, label, on, label === 'GLM-5.3-Flash' ? p.look : p.flash); });
    if (note) t(x + 6, y + 17, note, { size: 11, fill: p.look });
  };
  row(184, 'MODE', [['Ask', true], ['Accept edits', false], ['Plan', false], ['Full access', false]]);
  row(222, 'MODEL', [['GLM-5.3', true], ['GLM-5.3-Flash', false]], 'Flash sees images');
  row(260, 'EFFORT', [['low', false], ['high', true], ['max', false]]);

  // One tool-call lane: the agent works, and stops to ask before it acts.
  line('M442 306 H902', p.rule, 1);
  t(442, 332, 'in Ask mode', { size: 12, fill: p.muted });
  const bar = (x, w) => r(x, 346, w, 16, `rx="3" fill="${p.flash}"`);
  const ask = (x) => {
    out.push(`<circle cx="${x}" cy="354" r="9" fill="${p.card}" stroke="${p.agent}" stroke-width="1.8"/>`);
    line(`M${x - 3.5} ${354} l2.5 2.5 l4.5 -5.5`, p.agent, 1.7, 'stroke-linecap="round" stroke-linejoin="round"');
  };
  bar(442, 96); line('M538 354 H560', p.flash, 1.2); ask(569); line('M578 354 H600', p.flash, 1.2);
  bar(600, 70); line('M670 354 H692', p.flash, 1.2); ask(701); line('M710 354 H732', p.flash, 1.2);
  bar(732, 60); line('M792 354 H814', p.flash, 1.2); bar(814, 88);
  [['read', 442], ['edit', 600], ['run', 732], ['reply', 814]].forEach(([label, x]) => t(x, 386, label, { size: 11, fill: p.muted }));
  [569, 701].forEach((x) => t(x, 336, 'asks you', { size: 11, fill: p.agent, weight: 700, anchor: 'middle' }));
  t(442, 416, 'It edits files, runs commands and reports cost each turn.', { size: 11, fill: p.muted });

  // Install line.
  t(40, 467, 'set up:', { size: 13, fill: p.agent, weight: 700 });
  t(120, 467, 'npm i -g zcode-agent', { size: 13 });
  t(330, 467, 'then point the client at the command zcode-agent-acp', { size: 13 });
  t(40, 504, 'Sessions also appear in zcode-agent status, watch and cost.', { size: 11, fill: p.muted });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="520" viewBox="0 0 960 520">\n<title>zcode-agent acp: an ACP client such as T3 Code or Zed sends prompts to zcode-agent, which streams text, diffs and plans back, asks before edits and commands, and offers Mode, Model and Effort pickers with GLM-5.3 at high effort by default.</title>\n${out.join('\n')}\n</svg>\n`;
}

for (const [name, palette] of Object.entries(PALETTES)) writeFileSync(join(here, `acp-${name}.svg`), svg(palette));
