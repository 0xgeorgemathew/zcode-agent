// Writes docs/assets/hero-light.svg and hero-dark.svg (same drawing, two
// palettes). Run: node docs/assets/build-hero.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, pen, measure } from './palette.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const W = 960;
const H = 540;

function svg(p) {
  const { out, t, r, line, frame } = pen(p, W, H);

  // A check box: passed (tick) or failed (cross).
  const check = (x, y, ok = true) => {
    const c = ok ? p.flash : p.fail;
    r(x, y, 14, 14, `rx="3" fill="${ok ? p.flashSoft : p.failSoft}" stroke="${c}" stroke-width="1.5"`);
    if (ok) line(`M${x + 3.5} ${y + 7.5} l3 3 l4.5 -6`, c, 1.8, 'stroke-linecap="round" stroke-linejoin="round"');
    else line(`M${x + 4} ${y + 4} l6 6 M${x + 10} ${y + 4} l-6 6`, c, 1.8, 'stroke-linecap="round"');
  };
  const BAR = 18;
  const build = (x, w, y, h = BAR) => r(x, y, w, h, `rx="4" fill="${p.flash}"`);
  // Flash's turn: a pale bar with a screenshot icon.
  const look = (x, w, y) => {
    r(x, y, w, BAR, `rx="4" fill="${p.lookSoft}" stroke="${p.look}" stroke-width="1.5"`);
    const ix = x + 9;
    const iy = y + 4;
    r(ix, iy, 14, 10, `rx="1.5" fill="none" stroke="${p.look}" stroke-width="1.4"`);
    line(`M${ix + 2} ${iy + 8.5} l3.5 -4 l2.5 2.5 l2 -2 l2.5 3.5`, p.look, 1.3, 'stroke-linejoin="round"');
    t(ix + 21, y + 13, 'screenshots', { face: 'mono', size: 10.5, fill: p.look });
  };

  frame();

  // Title block.
  t(40, 46, 'ZCODE-AGENT · ONE TASK, FROM CONTRACT TO HANDBACK', { face: 'monoBold', size: 11, fill: p.muted, spacing: 2.4 });
  t(W - 40, 46, 'also in your editor: zcode-agent acp', { face: 'mono', size: 11, fill: p.look, anchor: 'end' });
  const head = [['Your agent decides.', p.agent], ['GLM-5.3 builds and checks.', p.flash], ['Flash looks.', p.look]];
  // The largest size, in half points, that fits the width.
  const fullWidth = (size) => head.reduce((w, [s]) => w + measure(s, 'display', size), 0) + measure(' ', 'display', size) * (head.length - 1);
  let HEAD = 38;
  while (fullWidth(HEAD) > W - 80) HEAD -= 0.5;
  const gap = measure(' ', 'display', HEAD);
  let hx = 40;
  for (const [s, c] of head) {
    t(hx, 92, s, { face: 'display', size: HEAD, fill: c });
    hx += measure(s, 'display', HEAD) + gap;
  }
  t(40, 120, 'Claude Code or Codex writes one contract. zcode-agent runs it in headless ZCode sessions and hands back one line.', { face: 'sans', size: 15, fill: p.muted });

  // Your agent: sparse on purpose.
  const AY = 150;
  const AH = 290;
  const AW = 252;
  r(40, AY, AW, AH, `rx="12" fill="${p.card}" stroke="${p.agent}" stroke-width="1.5"`);
  t(58, AY + 28, 'YOUR AGENT', { face: 'monoBold', size: 11, fill: p.agent, spacing: 1.6 });
  t(58, AY + 56, 'Claude Code · Codex', { face: 'sansBold', size: 17 });
  t(58, AY + 76, 'or any agent with a shell', { face: 'sans', size: 13, fill: p.muted });
  // The contract, as it is written.
  const DY = AY + 98;
  const rows = [['objective', 'dark-mode toggle'], ['owns', 'src/theme/**'], ['check', 'npm test'], ['visual', 'toggle persists']];
  const vx = 70 + measure('objective', 'mono', 11) + 12;
  r(56, DY, AW - 32, 122, `rx="8" fill="${p.well}" stroke="${p.rule}"`);
  t(70, DY + 22, 'task contract', { face: 'mono', size: 10.5, fill: p.muted });
  rows.forEach(([k, v], i) => {
    t(70, DY + 48 + i * 19, k, { face: 'mono', size: 11, fill: p.agent });
    t(vx, DY + 48 + i * 19, v, { face: 'mono', size: 11 });
  });
  t(58, AY + AH - 40, 'Your agent spends tokens on the', { face: 'sans', size: 12.5, fill: p.muted });
  t(58, AY + AH - 21, 'contract and the answers, nothing else.', { face: 'sans', size: 12.5, fill: p.muted });

  // Contract out.
  const ZX = 352;
  const CY = DY + 61;
  line(`M${40 + AW} ${CY} H${ZX - 8}`, p.agent, 2, 'marker-end="url(#head-agent)"');
  t((40 + AW + ZX) / 2, CY - 10, 'contract', { face: 'mono', size: 10.5, fill: p.agent, anchor: 'middle' });

  // zcode-agent: dense on purpose. Three stages, each lane one session.
  r(ZX, AY, W - 40 - ZX, AH, `rx="12" fill="${p.card}" stroke="${p.flash}" stroke-width="1.5"`);
  t(ZX + 18, AY + 28, 'ZCODE-AGENT', { face: 'monoBold', size: 11, fill: p.flash, spacing: 1.6 });
  t(W - 58, AY + 28, 'parallel sessions', { face: 'mono', size: 11, fill: p.muted, anchor: 'end' });

  const L = ZX + 18;
  const COL = { build: [L, 584], check: [602, 716], look: [736, 852] };
  const BUS = 882;
  const HY = AY + 60;
  [['BUILD', 'GLM-5.3 · effort high', COL.build, p.flash], ['CHECK', 'your commands', COL.check, p.flash], ['LOOK', 'GLM-5.3-Flash', COL.look, p.look]].forEach(([name, who, [x0], c]) => {
    t(x0, HY, name, { face: 'monoBold', size: 10.5, fill: c, spacing: 1.4 });
    t(x0, HY + 15, who, { face: 'mono', size: 10.5, fill: p.muted });
  });
  line(`M${L} ${HY + 26} H${COL.look[1]}`, p.rule, 1);

  const lanes = [AY + 124, AY + 182, AY + 240];
  const label = (y, s) => t(L, y - 9, s, { face: 'mono', size: 11.5, fill: p.muted });
  const checks = (x, y, n) => { for (let i = 0; i < n; i++) check(x + i * 20, y + 2); };
  // A thin thread carries each session from stage to stage.
  for (const y of lanes) line(`M${COL.build[1]} ${y + BAR / 2} H${COL.look[0]}`, p.rule, 1.5);

  // Lane 1: build, checks, Flash.
  label(lanes[0], 'session');
  build(COL.build[0], COL.build[1] - COL.build[0], lanes[0]);
  checks(COL.check[0], lanes[0], 3);
  look(COL.look[0], COL.look[1] - COL.look[0], lanes[0]);

  // Lane 2: three subagents work side by side, then the session integrates.
  label(lanes[1], 'session · 3 subagents');
  const MERGE = 520;
  [[478, 0], [452, 7], [496, 14]].forEach(([end, dy]) => {
    const y = lanes[1] + dy;
    build(COL.build[0], end - COL.build[0], y, 4);
    const cy = lanes[1] + BAR / 2;
    line(`M${end - 1} ${y + 2} C${end + 14} ${y + 2} ${MERGE - 14} ${cy} ${MERGE} ${cy}`, p.flash, 1.4);
  });
  build(MERGE, COL.build[1] - MERGE, lanes[1]);
  checks(COL.check[0], lanes[1], 3);
  look(COL.look[0], COL.look[1] - COL.look[0], lanes[1]);

  // Lane 3: a check fails, the session repairs, the checks run again.
  label(lanes[2], 'session · a check fails, it repairs');
  build(COL.build[0], COL.build[1] - COL.build[0], lanes[2]);
  const y3 = lanes[2];
  check(COL.check[0], y3 + 2, true);
  check(COL.check[0] + 20, y3 + 2, false);
  const FIX = COL.check[0] + 44;
  build(FIX, 22, y3 + 3, 12);
  line(`M${COL.check[0] + 27} ${y3 + 1} C${COL.check[0] + 27} ${y3 - 11} ${FIX + 11} ${y3 - 11} ${FIX + 11} ${y3 + 1}`, p.fail, 1.4, 'marker-end="url(#head-fail-sm)"');
  checks(FIX + 28, y3, 2);
  look(COL.look[0], COL.look[1] - COL.look[0], y3);

  // Every session ends in a handback; they meet on one bus that leaves the
  // card through its bottom edge as the one line home.
  for (const y of lanes) line(`M${COL.look[1]} ${y + BAR / 2} H${BUS}`, p.flash, 1.3);
  line(`M${BUS} ${lanes[0] + BAR / 2} V${AY + AH}`, p.flash, 1.3);
  out.push(`<circle cx="${BUS}" cy="${AY + AH}" r="3.5" fill="${p.agent}"/>`);

  // The handback, a chip riding the line back to your agent.
  const RY = 482;
  line(`M${BUS} ${AY + AH} V${RY} H150 V${AY + AH + 6}`, p.agent, 1.6, 'marker-end="url(#head-agent)"');
  const lead = 'handback';
  const json = '{"status":"completed","files":["…"],"checksPassed":3,"visualMet":"6/6"}';
  const cw = 14 + measure(lead, 'monoBold', 12) + 12 + measure(json, 'mono', 12) + 14;
  const cx = Math.round((150 + BUS - cw) / 2);
  r(cx, RY - 14, cw, 28, `rx="14" fill="${p.card}" stroke="${p.agent}" stroke-width="1.5"`);
  t(cx + 14, RY + 4.5, lead, { face: 'monoBold', size: 12, fill: p.agent });
  t(cx + 14 + measure(lead, 'monoBold', 12) + 12, RY + 4.5, json, { face: 'mono', size: 12 });
  t(40, 524, 'Questions come back the same way, with options and a recommendation. Your agent answers in one line.', { face: 'sans', size: 12.5, fill: p.muted });

  return out.svg('zcode-agent: your agent writes the decisions and a task contract; zcode-agent runs parallel GLM-5.3 sessions that build, run your checks and repair failures, and has a fresh GLM-5.3-Flash session judge screenshots; one handback line returns.');
}

for (const [name, palette] of Object.entries(PALETTES)) writeFileSync(join(here, `hero-${name}.svg`), svg(palette));
