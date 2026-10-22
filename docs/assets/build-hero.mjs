// Writes docs/assets/hero-light.svg and hero-dark.svg (same drawing, two
// palettes). Run: node docs/assets/build-hero.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
import { PALETTES, MONO, SANS, DISPLAY, esc } from './palette.mjs';

function svg(p) {
  const out = [];
  const t = (x, y, text, { size = 12, fill = p.ink, font = MONO, weight = 400, spacing = 0, anchor = 'start' } = {}) =>
    out.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}" fill="${fill}">${esc(text)}</text>`);
  const r = (x, y, w, h, attrs) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`);
  const line = (d, stroke, width = 1.5, extra = '') => out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`);

  // A check box: ok (filled with a tick), or failed (amber with a cross).
  const check = (x, y, ok = true) => {
    const c = ok ? p.flash : p.fail;
    r(x, y, 12, 12, `rx="2" fill="${p.card}" stroke="${c}" stroke-width="1.5"`);
    if (ok) line(`M${x + 3} ${y + 6.5} l2.5 2.5 l4 -5`, c, 1.6, 'stroke-linecap="round" stroke-linejoin="round"');
    else line(`M${x + 3.5} ${y + 3.5} l5 5 M${x + 8.5} ${y + 3.5} l-5 5`, c, 1.6, 'stroke-linecap="round"');
  };
  const build = (x, w, y, h = 16) => r(x, y, w, h, `rx="3" fill="${p.flash}"`);
  const verify = (x, w, y) => r(x, y, w, 16, `rx="3" fill="url(#hatch)" stroke="${p.look}" stroke-width="1"`);
  const repair = (x, w, y) => r(x + 0.75, y + 0.75, w - 1.5, 14.5, `rx="3" fill="none" stroke="${p.flash}" stroke-width="1.5" stroke-dasharray="4 3"`);

  out.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${p.lookSoft}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${p.look}" stroke-width="2.2"/></pattern>`
    + `<marker id="head-agent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${p.agent}"/></marker></defs>`);
  r(0, 0, 960, 520, `rx="16" fill="${p.paper}"`);
  r(0.5, 0.5, 959, 519, `rx="16" fill="none" stroke="${p.rule}"`);

  t(40, 48, 'ZCODE-AGENT · ONE TASK, FROM CONTRACT TO HANDBACK', { size: 11, fill: p.muted, spacing: 2.2 });
  t(920, 48, 'also in your editor: zcode-agent acp', { size: 11, fill: p.look, anchor: 'end' });
  out.push(`<text x="40" y="94" font-family="${DISPLAY}" font-size="36" font-weight="700" textLength="860" lengthAdjust="spacingAndGlyphs"><tspan fill="${p.agent}">Your agent decides.</tspan><tspan dx="10" fill="${p.flash}">GLM-5.3 builds and checks.</tspan><tspan dx="10" fill="${p.look}">Flash looks.</tspan></text>`);

  // Your agent: sparse on purpose.
  r(40, 132, 220, 300, `rx="12" fill="${p.card}" stroke="${p.agent}" stroke-width="1.5"`);
  t(58, 158, 'YOUR AGENT', { size: 11, fill: p.agent, spacing: 1.6, weight: 700 });
  ['Claude Code', 'Codex', 'any agent with a shell'].forEach((s, i) => t(58, 190 + i * 24, s, { size: 16, font: SANS }));
  line('M58 268 H242', p.rule, 1);
  t(58, 292, 'writes once', { size: 11, fill: p.muted });
  ['decisions', 'task contract', 'answers to questions'].forEach((s, i) => t(58, 316 + i * 22, s, { size: 13, font: SANS, fill: p.ink }));
  t(58, 412, 'spends tokens on these only', { size: 11, fill: p.muted });

  // Contract out.
  line('M260 204 H322', p.agent, 2, 'marker-end="url(#head-agent)"');
  t(291, 194, 'contract', { size: 11, fill: p.agent, anchor: 'middle' });

  // zcode-agent: dense on purpose.
  r(330, 132, 590, 300, `rx="12" fill="${p.card}" stroke="${p.flash}" stroke-width="1.5"`);
  t(348, 158, 'ZCODE-AGENT', { size: 11, fill: p.flash, spacing: 1.6, weight: 700 });
  t(902, 158, 'GLM-5.3 at effort high · parallel sessions', { size: 11, fill: p.muted, anchor: 'end' });

  const lanes = [
    { y: 196, label: 'session' },
    { y: 262, label: 'session · 3 subagents' },
    { y: 328, label: 'session · a check fails, it repairs' },
  ];
  for (const l of lanes) t(348, l.y - 8, l.label, { size: 12, fill: p.muted });
  // Lane 1: build, checks, verifier.
  build(348, 250, lanes[0].y);
  [612, 628, 644].forEach((x) => check(x, lanes[0].y + 2));
  verify(668, 110, lanes[0].y);
  // Lane 2: units fan out to subagents, then integrate.
  for (let i = 0; i < 3; i++) build(348, [170, 140, 185][i], lanes[1].y + i * 6, 4);
  // (connectors below join each subagent bar to the integrating build)
  const ends = [170, 140, 185];
  ends.forEach((w, i) => line(`M${348 + w + 2} ${lanes[1].y + i * 6 + 2} H548`, p.flash, 1, 'stroke-dasharray="2 3"'));
  build(548, 50, lanes[1].y);
  [612, 628, 644].forEach((x) => check(x, lanes[1].y + 2));
  verify(668, 110, lanes[1].y);
  // Lane 3: build, a failing check, repair, checks again, verifier.
  build(348, 196, lanes[2].y);
  check(556, lanes[2].y + 2, true);
  check(572, lanes[2].y + 2, false);
  repair(594, 70, lanes[2].y);
  [676, 692].forEach((x) => check(x, lanes[2].y + 2));
  verify(716, 110, lanes[2].y);

  // Each session ends in a handback; they meet on one bus and leave the
  // card through its bottom edge as the one line home.
  const BUS = 892;
  for (const [l, end] of [[lanes[0], 778], [lanes[1], 778], [lanes[2], 826]]) line(`M${end} ${l.y + 8} H${BUS}`, p.flash, 1.2);
  line(`M${BUS} ${lanes[0].y + 8} V432`, p.flash, 1.2);
  out.push(`<circle cx="${BUS}" cy="432" r="3.5" fill="${p.agent}"/>`);

  // Legend: measured left to right so nothing touches.
  const ly = 396;
  const CH = 6.7; // ui-monospace advance at 11px
  let x = 348;
  const item = (draw, label) => {
    draw(x);
    x += 30; // swatch (22) + gap (8)
    t(x, ly + 10, label, { size: 11, fill: p.muted });
    x += label.length * CH + 14;
  };
  item((x0) => build(x0, 22, ly, 12), 'build');
  item((x0) => check(x0 + 10, ly), 'checks');
  item((x0) => r(x0, ly, 22, 12, `rx="2" fill="url(#hatch)" stroke="${p.look}" stroke-width="1"`), 'fresh Flash session reads screenshots');
  item((x0) => r(x0 + 0.75, ly + 0.75, 20.5, 10.5, `rx="2" fill="none" stroke="${p.flash}" stroke-width="1.5" stroke-dasharray="4 3"`), 'repair');

  // The one thin line back: the handback.
  line(`M${BUS} 432 V476 H150 V438`, p.agent, 1.5, 'marker-end="url(#head-agent)"');
  t(166, 467, 'handback, one line:', { size: 13, fill: p.agent, weight: 700 });
  t(330, 467, '{"status":"completed","files":["…"],"checksPassed":3,"visualMet":"6/6"}', { size: 13, fill: p.ink });
  t(40, 504, 'Questions come back the same way, with options and a recommendation. Your agent answers in one line.', { size: 11, fill: p.muted });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="520" viewBox="0 0 960 520">\n<title>zcode-agent: your agent writes the decisions and a task contract; zcode-agent runs parallel GLM-5.3 sessions that build, run checks and repair, and has a fresh GLM-5.3-Flash session judge screenshots; one handback line returns.</title>\n${out.join('\n')}\n</svg>\n`;
}

for (const [name, palette] of Object.entries(PALETTES)) writeFileSync(join(here, `hero-${name}.svg`), svg(palette));
