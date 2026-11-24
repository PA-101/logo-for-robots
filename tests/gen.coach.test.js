'use strict';
// Task 29: the coach on a sample of generated levels with a broken reference.
const test = require('node:test');
const assert = require('node:assert');
const { generate } = require('../gen.js');
const { buildLevel } = require('../levels.js');
const { coach, LIMITS } = require('../coach.js');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');

const SEEDS = [5, 20, 35, 50, 65, 80, 95, 110, 125, 140];

// Halve the last forward distance (rounded to whole centimetres, at least 1).
function breakReference(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^forward (\d+)$/.exec(lines[i]);
    if (m) { lines[i] = 'forward ' + Math.max(1, Math.round(Number(m[1]) / 2)); break; }
  }
  return lines.join('\n');
}

test('the coach fixes a halved last leg on 10 generated levels, within the cap, in under 15 s', () => {
  const t0 = Date.now();
  const report = [];
  for (const seed of SEEDS) {
    const def = generate(seed);
    const level = buildLevel(def);
    const broken = breakReference(def.reference);
    assert.notStrictEqual(broken, def.reference);
    assert.notStrictEqual(runToEnd(level, parse(broken).program).result.status, 'pass', 'seed ' + seed + ': the broken program fails');
    const r = coach(level, broken);
    assert.ok(r.tried <= LIMITS.CANDIDATE_CAP, 'seed ' + seed + ' tried ' + r.tried);
    assert.strictEqual(r.found, true, 'seed ' + seed + ': ' + r.explanation);
    assert.ok(r.edits.length >= 1 && r.edits.length <= 2);
    const p = parse(r.program);
    assert.ok(p.ok, 'seed ' + seed + ': the fix parses');
    assert.strictEqual(runToEnd(level, p.program).result.status, 'pass', 'seed ' + seed + ': the fix passes');
    report.push(seed + ':' + r.tried);
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 15000, 'coach on 10 generated levels took ' + ms + ' ms (' + report.join(' ') + ')');
});
