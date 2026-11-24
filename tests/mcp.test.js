'use strict';
// Task 37: drive tools/sim-mcp/server.js through stdin and stdout like an MCP client.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'tools', 'sim-mcp', 'server.js');

// Sends each request as one line and collects one response per request id.
function session(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    const want = requests.filter((r) => r.id !== undefined).length;
    const replies = [];
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout; got ' + JSON.stringify(replies))); }, 20000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) replies.push(JSON.parse(line));
        if (replies.length >= want) { clearTimeout(timer); child.stdin.end(); }
      }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(replies); });
    child.on('error', reject);
    for (const r of requests) child.stdin.write((typeof r === 'string' ? r : JSON.stringify(r)) + '\n');
  });
}
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const body = (reply) => JSON.parse(reply.result.content[0].text);

test('initialize, initialized notification and tools/list', async () => {
  const [init, list] = await session([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' }
  ]);
  assert.strictEqual(init.id, 1);
  assert.strictEqual(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  assert.strictEqual(init.result.serverInfo.name, 'logo-for-robots-sim');
  assert.deepStrictEqual(list.result.tools.map((t) => t.name), ['list_levels', 'run_program', 'suggest_fix']);
  for (const t of list.result.tools) assert.strictEqual(t.inputSchema.type, 'object');
});

test('list_levels, run_program and suggest_fix return real simulator results', async () => {
  const replies = await session([
    call(1, 'list_levels', {}),
    call(2, 'run_program', { level_id: '1', program: 'forward 200\nright 90\nforward 100' }),
    call(3, 'run_program', { level_id: '7', program: 'forward 150\nright 90\nforward 50' }),
    call(4, 'suggest_fix', { level_id: '1', program: 'forward 200\nright 90\nforward 50' }),
    call(5, 'run_program', { level_id: 'challenge:75', program: 'forward 50' })
  ]);
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
  const lv = body(byId[1]);
  assert.strictEqual(lv.levels.length, 9);
  assert.deepStrictEqual(lv.levels.map((l) => l.layouts), [1, 1, 1, 1, 1, 1, 3, 3, 3]);
  const pass = body(byId[2]);
  assert.strictEqual(pass.pass, true);
  assert.strictEqual(pass.runs[0].status, 'pass');
  const layouts = body(byId[3]);
  assert.deepStrictEqual(layouts.runs.map((r) => [r.layout, r.status]), [['A', 'pass'], ['B', 'fail'], ['C', 'fail']]);
  assert.strictEqual(layouts.pass, false);
  const fix = body(byId[4]);
  assert.strictEqual(fix.found, true);
  assert.deepStrictEqual(fix.edits, ['Line 3: forward 50 -> forward 100']);
  assert.strictEqual(body(byId[5]).runs[0].status, 'fail');
  for (const r of replies) assert.strictEqual(r.result.isError, false, JSON.stringify(r));
});

test('bad level ids, bad programs and bad messages give errors, never a crash', async () => {
  const replies = await session([
    call(1, 'run_program', { level_id: '42', program: 'forward 10' }),
    call(2, 'run_program', { level_id: 'challenge:999', program: 'forward 10' }),
    call(3, 'suggest_fix', { level_id: '1', program: 'fowrard 10' }),
    call(4, 'run_program', { level_id: '1' }),
    call(5, 'no_such_tool', {}),
    { jsonrpc: '2.0', id: 6, method: 'bogus/method' },
    'this is not json',
    { jsonrpc: '2.0', id: 7, method: 'ping' }
  ]);
  const byId = Object.fromEntries(replies.filter((r) => r.id !== null).map((r) => [r.id, r]));
  assert.ok(byId[1].result.isError && /Unknown level_id "42"/.test(byId[1].result.content[0].text));
  assert.ok(byId[2].result.isError && /1 to 150/.test(byId[2].result.content[0].text));
  assert.ok(byId[3].result.isError && /Line 1:.*fowrard/.test(byId[3].result.content[0].text));
  assert.ok(byId[4].result.isError && /program must be a string/.test(byId[4].result.content[0].text));
  assert.ok(byId[5].result.isError);
  assert.strictEqual(byId[6].error.code, -32601);
  assert.deepStrictEqual(byId[7].result, {});
  assert.ok(replies.some((r) => r.id === null && r.error && r.error.code === -32700), 'parse error reply for the non-JSON line');
});

test('the shipped page never loads the MCP server', () => {
  const html = require('node:fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/tools\/|sim-mcp|server\.js/.test(html));
});
