#!/usr/bin/env node
'use strict';
// Logo for Robots simulator as a small MCP server (developer tool, not part of the shipped app).
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. No dependencies.
// Tools: list_levels, run_program(level_id, program), suggest_fix(level_id, program).
// Level ids: "1" to "9" for the handpicked levels, "challenge:N" for Challenge seed N (1 to 150).

const path = require('node:path');
const readline = require('node:readline');
const ROOT = path.join(__dirname, '..', '..');
const lang = require(path.join(ROOT, 'lang.js'));
const levels = require(path.join(ROOT, 'levels.js'));
const sim = require(path.join(ROOT, 'sim.js'));
const coachMod = require(path.join(ROOT, 'coach.js'));
const gen = require(path.join(ROOT, 'gen.js'));
const explainMod = require(path.join(ROOT, 'explain.js'));

const SERVER_INFO = { name: 'logo-for-robots-sim', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const MAX_EVENTS = 60;

const TOOLS = [
  {
    name: 'list_levels',
    description: 'List the Logo for Robots levels: ids, titles, chapters and layout counts, plus how to address Challenge levels.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'run_program',
    description: 'Run a Logo program on a level in the deterministic robot simulator. Returns pass/fail, the explanation, events, final time and charge for every layout.',
    inputSchema: {
      type: 'object',
      properties: {
        level_id: { type: 'string', description: '"1" to "9", or "challenge:N" with N from 1 to 150' },
        program: { type: 'string', description: 'Logo program text, for example "forward 200\\nright 90\\nforward 100"' }
      },
      required: ['level_id', 'program'],
      additionalProperties: false
    }
  },
  {
    name: 'suggest_fix',
    description: 'Ask the Auto-Fix Coach (a deterministic search over small numeric edits, each checked in the simulator) for the smallest change that makes a failing program pass.',
    inputSchema: {
      type: 'object',
      properties: {
        level_id: { type: 'string', description: '"1" to "9", or "challenge:N" with N from 1 to 150' },
        program: { type: 'string', description: 'Logo program text' }
      },
      required: ['level_id', 'program'],
      additionalProperties: false
    }
  }
];

class ToolError extends Error {}

// Returns the built layouts of a level id, or throws a ToolError with a plain message.
function layoutsFor(levelId) {
  const id = String(levelId === undefined || levelId === null ? '' : levelId).trim();
  const ch = /^challenge:(\d+)$/i.exec(id);
  if (ch) {
    const seed = Number(ch[1]);
    if (seed < gen.SEED_MIN || seed > gen.SEED_MAX) throw new ToolError('Challenge seeds go from 1 to 150, not ' + seed + '.');
    return [levels.buildLevel(gen.generate(seed))];
  }
  if (!/^\d+$/.test(id) || !levels.ALL_LEVELS.some((d) => d.id === Number(id))) {
    throw new ToolError('Unknown level_id "' + id + '". Use "1" to "9" or "challenge:N" (N from 1 to 150). Call list_levels for the list.');
  }
  return levels.getLayouts(Number(id));
}

function parseOrThrow(program) {
  if (typeof program !== 'string') throw new ToolError('program must be a string of Logo commands.');
  const p = lang.parse(program);
  if (!p.ok) throw new ToolError('The program does not parse. ' + p.errors.map((e) => (e.line ? 'Line ' + e.line + ': ' : '') + e.message).join(' '));
  return p.program;
}

const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

function listLevels() {
  const chapterName = {};
  levels.CHAPTERS.forEach((c) => { chapterName[c.id] = c.name; });
  return {
    levels: levels.ALL_LEVELS.map((d) => ({
      level_id: String(d.id),
      title: d.name,
      chapter: d.chapter || levels.getLevel(d.id).chapter,
      chapter_name: chapterName[levels.getLevel(d.id).chapter],
      objective: d.objective,
      layouts: levels.getLayouts(d.id).length
    })),
    challenge: { level_id_format: 'challenge:N', seeds: '1 to 150', layouts: 1 }
  };
}

function runProgram(args) {
  const layouts = layoutsFor(args.level_id);
  const program = parseOrThrow(args.program);
  const runs = layouts.map((level) => {
    const s = sim.runToEnd(level, program);
    const exp = explainMod.explain({ result: s.result, events: s.events, state: s.state, level });
    return {
      layout: level.layout || null,
      status: s.result.status,
      reason: s.result.reason,
      time_s: round(s.state.t, 2),
      charge_used_c: round(level.capacity - s.state.charge, 3),
      capacity_c: level.capacity,
      time_limit_s: level.timeLimit,
      explanation: exp.verdict === 'PASS' ? exp.summary : exp.causes.map((c) => c.text),
      events: s.events.slice(0, MAX_EVENTS).map((e) => {
        const out = {};
        for (const k of Object.keys(e)) out[k] = typeof e[k] === 'number' ? round(e[k], 3) : e[k];
        return out;
      })
    };
  });
  return { level_id: String(args.level_id), pass: runs.every((r) => r.status === 'pass'), runs };
}

function suggestFix(args) {
  const layouts = layoutsFor(args.level_id);
  parseOrThrow(args.program);
  const r = coachMod.coach(layouts.length > 1 ? layouts : layouts[0], args.program);
  return { level_id: String(args.level_id), found: r.found, program: r.program, edits: r.edits.map((e) => e.text), explanation: r.explanation, tried: r.tried };
}

function callTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  try {
    let value;
    if (name === 'list_levels') value = listLevels();
    else if (name === 'run_program') value = runProgram(a);
    else if (name === 'suggest_fix') value = suggestFix(a);
    else return { content: [{ type: 'text', text: 'Unknown tool "' + name + '".' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'Internal error: ' + (e && e.message);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
  }
  const isNotification = msg.id === undefined;
  let result;
  switch (msg.method) {
    case 'initialize':
      result = {
        protocolVersion: (msg.params && typeof msg.params.protocolVersion === 'string') ? msg.params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      };
      break;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = { tools: TOOLS };
      break;
    case 'tools/call':
      result = callTool(msg.params && msg.params.name, msg.params && msg.params.arguments);
      break;
    default:
      if (isNotification) return null;
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } };
  }
  return isNotification ? null : { jsonrpc: '2.0', id: msg.id, result };
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let reply;
    try {
      reply = handle(JSON.parse(line));
    } catch (e) {
      reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
    if (reply) process.stdout.write(JSON.stringify(reply) + '\n');
  });
}

if (require.main === module) main();
module.exports = { handle, callTool, TOOLS };
