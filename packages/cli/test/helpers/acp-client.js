'use strict';
// Test client for `zcode-agent acp` (not a test): spawns the agent and speaks
// ACP v1 to it over stdio. Records every session/update notification and
// answers session/request_permission with `onPermission`.
const assert = require('node:assert/strict');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js');

// Agents still running when a test ends (a failed assertion skipped close())
// are killed, so one failure never hangs the whole file.
const live = new Set();
function killAgents() {
  for (const child of live) child.kill('SIGKILL');
  live.clear();
}

// Hermetic and browserless: no desktop MCP servers to connect.
function startAgent(args = [], { env = {}, onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }) } = {}) {
  const child = spawn(process.execPath, [BIN, 'acp', '--hermetic', '--no-browser', ...args], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  live.add(child);
  child.on('exit', () => live.delete(child));
  let nextId = 1;
  const pending = new Map();
  const updates = [];
  const permissions = [];
  const rawLines = [];
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    rawLines.push(line);
    const msg = JSON.parse(line);
    assert.equal(msg.jsonrpc, '2.0');
    if (msg.method === 'session/update') updates.push(msg.params);
    else if (msg.method === 'session/request_permission') {
      permissions.push(msg.params);
      Promise.resolve(onPermission(msg.params)).then((result) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n'));
    } else if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });
  const call = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const ok = async (method, params) => {
    const res = await call(method, params);
    assert.equal(res.error, undefined, `${method} failed: ${JSON.stringify(res.error)}\n${stderr}`);
    return res.result;
  };
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const close = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.on('exit', (code) => resolve(code));
    child.stdin.end();
  });
  return { child, call, ok, notify, updates, permissions, rawLines, close, stderr: () => stderr };
}


module.exports = { startAgent, killAgents };
