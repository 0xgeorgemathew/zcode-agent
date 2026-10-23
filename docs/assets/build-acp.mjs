// Writes docs/assets/acp-light.svg and acp-dark.svg (same drawing, two
// palettes). Run: node docs/assets/build-acp.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, pen, measure } from './palette.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const W = 960;
const H = 540;

function svg(p) {
  const { out, t, r, line, frame } = pen(p, W, H);
  frame();

  // Title block.
  t(40, 46, 'ZCODE-AGENT ACP · A CHAT SESSION, FROM PROMPT TO REPLY', { face: 'monoBold', size: 11, fill: p.muted, spacing: 2.4 });
  const head = [['Your editor chats.', p.agent], ['GLM-5.3 does the work, and asks first.', p.flash]];
  const fullWidth = (size) => head.reduce((w, [s]) => w + measure(s, 'display', size), 0) + measure(' ', 'display', size) * (head.length - 1);
  let HEAD = 38;
  while (fullWidth(HEAD) > W - 80) HEAD -= 0.5;
  let hx = 40;
  for (const [s, c] of head) {
    t(hx, 92, s, { face: 'display', size: HEAD, fill: c });
    hx += measure(s, 'display', HEAD) + measure(' ', 'display', HEAD);
  }
  t(40, 120, 'T3 Code, Zed or any ACP client drives GLM-5.3 directly: you chat, approve its edits and commands, and watch it work.', { face: 'sans', size: 15, fill: p.muted });

  // The client: a glimpse of the chat.
  const AY = 150;
  const AH = 290;
  const AW = 252;
  r(40, AY, AW, AH, `rx="12" fill="${p.card}" stroke="${p.agent}" stroke-width="1.5"`);
  t(58, AY + 28, 'YOUR CLIENT', { face: 'monoBold', size: 11, fill: p.agent, spacing: 1.6 });
  t(58, AY + 56, 'T3 Code · Zed', { face: 'sansBold', size: 17 });
  t(58, AY + 76, 'or any ACP client', { face: 'sans', size: 13, fill: p.muted });
  // You: a prompt bubble.
  const bubble = 'add a dark-mode toggle';
  const bw = measure(bubble, 'sans', 12.5) + 24;
  r(40 + AW - 16 - bw, AY + 96, bw, 28, `rx="14" fill="${p.agentSoft}"`);
  t(40 + AW - 16 - bw / 2, AY + 114, bubble, { face: 'sans', size: 12.5, anchor: 'middle' });
  // The agent asks before it edits.
  const QY = AY + 138;
  r(56, QY, AW - 32, 84, `rx="8" fill="${p.well}" stroke="${p.rule}"`);
  t(70, QY + 22, 'Edit src/theme.ts?', { face: 'sansBold', size: 12.5 });
  t(70, QY + 40, '+12 -3', { face: 'mono', size: 11, fill: p.muted });
  const btn = (x, label, on) => {
    const w = measure(label, 'sansBold', 12) + 24;
    r(x, QY + 50, w, 24, `rx="12" fill="${on ? p.agent : p.card}" stroke="${p.agent}" stroke-width="1.3"`);
    t(x + w / 2, QY + 66, label, { face: 'sansBold', size: 12, fill: on ? p.card : p.agent, anchor: 'middle' });
    return x + w + 8;
  };
  btn(btn(70, 'Allow', true), 'Deny', false);
  t(58, AY + AH - 21, 'Sessions reopen with their history.', { face: 'sans', size: 12.5, fill: p.muted });

  // The wire: requests right, updates left.
  const ZX = 420;
  const mid = (40 + AW + ZX) / 2;
  line(`M${40 + AW} ${AY + 96} H${ZX - 8}`, p.agent, 2, 'marker-end="url(#head-agent)"');
  t(mid, AY + 86, 'prompts, answers', { face: 'mono', size: 10.5, fill: p.agent, anchor: 'middle' });
  line(`M${ZX} ${AY + 146} H${40 + AW + 8}`, p.flash, 2, 'marker-end="url(#head-flash)"');
  t(mid, AY + 136, 'text, diffs, plan', { face: 'mono', size: 10.5, fill: p.flash, anchor: 'middle' });
  t(mid, AY + 184, 'ACP v1 · stdio', { face: 'mono', size: 10.5, fill: p.muted, anchor: 'middle' });
  t(mid, AY + 201, 'zcode-agent-acp', { face: 'monoBold', size: 10.5, fill: p.agent, anchor: 'middle' });

  // The agent: pickers, then one turn.
  r(ZX, AY, W - 40 - ZX, AH, `rx="12" fill="${p.card}" stroke="${p.flash}" stroke-width="1.5"`);
  const L = ZX + 18;
  t(L, AY + 28, 'ZCODE-AGENT ACP', { face: 'monoBold', size: 11, fill: p.flash, spacing: 1.6 });
  t(W - 58, AY + 28, 'filled = default', { face: 'mono', size: 11, fill: p.muted, anchor: 'end' });

  const chip = (x, y, label, on, c) => {
    const w = Math.round(measure(label, on ? 'sansBold' : 'sans', 12.5) + 24);
    r(x, y, w, 26, `rx="13" fill="${on ? c : p.card}" stroke="${c}" stroke-width="1.5"`);
    t(x + w / 2, y + 17.5, label, { face: on ? 'sansBold' : 'sans', size: 12.5, fill: on ? p.card : p.ink, anchor: 'middle' });
    return x + w + 8;
  };
  const row = (y, name, labels, note) => {
    t(L, y + 17, name, { face: 'monoBold', size: 10.5, fill: p.muted, spacing: 1.4 });
    let x = L + 72;
    for (const [label, on] of labels) x = chip(x, y, label, on, label === 'GLM-5.3-Flash' ? p.look : p.flash);
    if (note) t(x + 4, y + 17, note, { face: 'mono', size: 10.5, fill: p.look });
  };
  row(AY + 46, 'MODE', [['Ask', true], ['Accept edits', false], ['Plan', false], ['Full access', false]]);
  row(AY + 82, 'MODEL', [['GLM-5.3', true], ['GLM-5.3-Flash', false]], 'sees images');
  row(AY + 118, 'EFFORT', [['low', false], ['high', true], ['max', false]]);

  // One turn in Ask mode: the agent works and stops to ask before it acts.
  line(`M${L} ${AY + 160} H${W - 58}`, p.rule, 1);
  t(L, AY + 184, 'ONE TURN', { face: 'monoBold', size: 10.5, fill: p.flash, spacing: 1.4 });
  t(L + measure('ONE TURN', 'monoBold', 10.5, 1.4) + 8, AY + 184, 'in Ask mode', { face: 'mono', size: 10.5, fill: p.muted });
  const TY = AY + 214;
  const R = W - 58;
  line(`M${L} ${TY + 9} H${R}`, p.rule, 1.5);
  const bar = (x, w) => r(x, TY, w, 18, `rx="4" fill="${p.flash}"`);
  const ask = (x) => {
    out.push(`<circle cx="${x}" cy="${TY + 9}" r="10" fill="${p.agentSoft}" stroke="${p.agent}" stroke-width="1.6"/>`);
    line(`M${x - 4} ${TY + 9} l2.8 2.8 l5 -6`, p.agent, 1.8, 'stroke-linecap="round" stroke-linejoin="round"');
    t(x, TY - 10, 'asks you', { face: 'monoBold', size: 10.5, fill: p.agent, anchor: 'middle' });
  };
  const steps = [['read', 92], ['edit', 70], ['run', 64], ['reply', 80]];
  const askAfter = new Set(['read', 'edit']);
  const span = R - L;
  const used = steps.reduce((w, [, sw]) => w + sw, 0);
  const g = (span - used) / (steps.length - 1);
  let x = L;
  for (const [name, sw] of steps) {
    bar(x, sw);
    t(x, TY + 36, name, { face: 'mono', size: 11, fill: p.muted });
    if (askAfter.has(name)) ask(x + sw + g / 2);
    x += sw + g;
  }
  t(L, AY + AH - 18, 'The engine starts as the session opens, so the first prompt does not wait.', { face: 'sans', size: 12.5, fill: p.muted });

  // Set up, as a chip like the hero's handback.
  const SY = 482;
  const lead = 'set up';
  const cmd = 'npm i -g zcode-agent';
  const then = 'then point the client at zcode-agent-acp';
  let sx = 40;
  const cw = 14 + measure(lead, 'monoBold', 12) + 12 + measure(cmd, 'mono', 12) + 14;
  r(sx, SY - 14, cw, 28, `rx="14" fill="${p.card}" stroke="${p.agent}" stroke-width="1.5"`);
  t(sx + 14, SY + 4.5, lead, { face: 'monoBold', size: 12, fill: p.agent });
  t(sx + 14 + measure(lead, 'monoBold', 12) + 12, SY + 4.5, cmd, { face: 'mono', size: 12 });
  sx += cw + 14;
  t(sx, SY + 4.5, then, { face: 'sans', size: 13, fill: p.ink });
  t(40, 524, 'Sessions also show in zcode-agent status, watch and cost.', { face: 'sans', size: 12.5, fill: p.muted });

  return out.svg('zcode-agent acp: an ACP client such as T3 Code or Zed sends prompts to zcode-agent, which streams text, diffs and plans back, asks before edits and commands, and offers Mode, Model and Effort pickers with GLM-5.3 at high effort by default.');
}

for (const [name, palette] of Object.entries(PALETTES)) writeFileSync(join(here, `acp-${name}.svg`), svg(palette));
