'use strict';
// Compatibility: every program recorded before the power/bumper change must behave exactly
// as it did (design.md section 12). The fixture is never regenerated.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');
const { getLevel } = require('../levels.js');
const { coach } = require('../coach.js');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-runs.json'), 'utf8'));

function makeLevel(spec) {
  const level = getLevel(spec.id);
  if (spec.capacity !== undefined) level.capacity = spec.capacity;
  if (spec.mu !== undefined) level.mu = spec.mu;
  return level;
}

// Only the keys that existed when the fixture was recorded are compared; new keys are ignored.
function recordedKeys(state, keys) {
  const out = {};
  for (const k of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(state, k), 'state key "' + k + '" is missing');
    out[k] = state[k];
  }
  return out;
}

test('the golden fixture covers references, careless programs, random programs and the coach', () => {
  assert.ok(golden.runs.length >= 160, String(golden.runs.length));
  assert.strictEqual(golden.coach.length, 20);
  const types = new Set(golden.runs.flatMap((r) => r.events.map((e) => e.type)));
  for (const t of ['goal', 'collision', 'stall', 'slip', 'battery_flat', 'timeout', 'program_ended']) {
    assert.ok(types.has(t), 'fixture has no ' + t + ' event');
  }
});

test('every recorded program runs exactly as before (state, events and result)', () => {
  for (const [i, run] of golden.runs.entries()) {
    const label = 'run ' + i + ' level ' + JSON.stringify(run.level) + ' ' + JSON.stringify(run.text);
    const p = parse(run.text);
    assert.strictEqual(p.ok, true, label + ' no longer parses');
    const sim = runToEnd(makeLevel(run.level), p.program);
    assert.deepStrictEqual(sim.result, run.result, label + ': result');
    assert.strictEqual(JSON.stringify(sim.events), JSON.stringify(run.events), label + ': events');
    assert.strictEqual(JSON.stringify(recordedKeys(sim.state, Object.keys(run.state))), JSON.stringify(run.state), label + ': state');
  }
});

test('the coach gives byte-identical results on the recorded chapter 1 programs', () => {
  for (const [i, c] of golden.coach.entries()) {
    const r = coach(makeLevel(c.level), c.text);
    assert.strictEqual(JSON.stringify(r), JSON.stringify(c.result), 'coach case ' + i + ' ' + JSON.stringify(c.text));
  }
});
