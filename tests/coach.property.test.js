'use strict';
// Task 17: coach property tests. Random failing programs on real levels, plus random text
// and odd levels for the never-throws property.
const test = require('node:test');
const assert = require('node:assert');
const { coach, createSearch, applyEdits, LIMITS } = require('../coach.js');
const { parse, LIMITS: LANG } = require('../lang.js');
const { runToEnd } = require('../sim.js');
const { getLevel, LEVELS } = require('../levels.js');
const { makeRng, forAll, randomString } = require('./helpers');

// A level's reference program with one or two numbers nudged: usually close to passing.
function nearMiss(rng) {
  const def = rng.pick(LEVELS);
  const text = def.reference.replace(/\d+/g, (n) => {
    if (!rng.bool(0.35)) return n;
    const v = Number(n);
    const out = rng.bool() ? Math.round(v * rng.pick([0.5, 0.7, 0.8, 1.2, 1.4])) : Math.max(0, v + rng.pick([-25, -12, -7, 7, 12, 25]));
    return String(Math.max(1, out));
  });
  return { id: def.id, text };
}

// Short random programs: often unfixable, which exercises the honest-failure path.
function tiny(rng) {
  const n = rng.int(1, 3);
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(rng.pick(['forward', 'back', 'left', 'right', 'wait']) + ' ' + rng.pick([0, 10, 50, 90, 150, 200, 300]));
  }
  return { id: rng.int(1, 3), text: parts.join(rng.bool() ? '\n' : ' ') };
}

function failing(id, text) {
  const p = parse(text);
  return p.ok && runToEnd(getLevel(id), p.program).result.status !== 'pass';
}

// One shared set of failing cases and their results, computed once.
const CASES = [];
{
  const rng = makeRng(200000);
  let guard = 0;
  while (CASES.length < 40 && guard++ < 1000) {
    const c = CASES.length < 28 ? nearMiss(rng) : tiny(rng);
    if (!failing(c.id, c.text)) continue;
    c.result = coach(getLevel(c.id), c.text);
    CASES.push(c);
  }
}

test('the shared cases include both fixes and honest failures', () => {
  assert.strictEqual(CASES.length, 40);
  const found = CASES.filter((c) => c.result.found).length;
  assert.ok(found >= 10, 'fixes found: ' + found);
  assert.ok(CASES.length - found >= 5, 'not fixable: ' + (CASES.length - found));
  assert.ok(CASES.some((c) => c.result.edits.length === 2), 'at least one two-edit fix');
});

test('property: any returned program parses, passes in the simulator and is exactly the listed edits', () => {
  for (const c of CASES) {
    const r = c.result;
    const label = 'level ' + c.id + ' ' + JSON.stringify(c.text);
    if (!r.found) {
      assert.strictEqual(r.program, c.text, label);
      assert.deepStrictEqual(r.edits, [], label);
      continue;
    }
    const p = parse(r.program);
    assert.strictEqual(p.ok, true, label + ' -> ' + JSON.stringify(r.program));
    assert.strictEqual(runToEnd(getLevel(c.id), p.program).result.status, 'pass', label);
    assert.ok(r.edits.length >= 1 && r.edits.length <= LIMITS.MAX_EDITS, label);
    assert.strictEqual(applyEdits(c.text, r.edits), r.program, label);
    assert.strictEqual(r.program.split('\n').length, c.text.split('\n').length, 'line count unchanged');
  }
});

test('property: edited values stay within the language limits and are plain numbers', () => {
  for (const c of CASES) {
    for (const e of c.result.edits) {
      if (e.kind === 'wait') { assert.ok(/^wait (0\.5|1) $/.test(e.insert)); continue; }
      assert.ok(/^\d+(\.\d+)?$/.test(e.insert), e.insert);
      const v = Number(e.insert);
      if (e.kind === 'scale') assert.ok(v >= 1 && v <= LANG.MAX_MOVE, e.text);
      else assert.ok(v >= 0 && v <= LANG.MAX_TURN, e.text);
    }
  }
});

test('property: the search always ends within the candidate cap', () => {
  for (const c of CASES) assert.ok(c.result.tried >= 0 && c.result.tried <= LIMITS.CANDIDATE_CAP, String(c.result.tried));
  // Stepping one candidate at a time also ends, and never runs more than the cap.
  forAll(210000, 6, (rng) => {
    const c = rng.pick(CASES);
    const s = createSearch(getLevel(c.id), c.text);
    let calls = 0;
    while (!s.step(1)) {
      calls++;
      assert.ok(s.progress.tried <= LIMITS.CANDIDATE_CAP);
      assert.ok(calls <= 4 * LIMITS.CANDIDATE_CAP + 10, 'search did not end');
    }
    assert.ok(s.result().tried <= LIMITS.CANDIDATE_CAP);
  });
});

test('property: the result is deterministic (same output twice)', () => {
  for (const c of CASES.slice(0, 20)) {
    assert.strictEqual(JSON.stringify(coach(getLevel(c.id), c.text)), JSON.stringify(c.result), JSON.stringify(c.text));
  }
});

test('property: stepping the search in random chunk sizes gives the same result as one call', () => {
  forAll(220000, 15, (rng) => {
    const c = rng.pick(CASES);
    const s = createSearch(getLevel(c.id), c.text);
    while (!s.step(rng.pick([1, 2, 7, 50, 333]))) { /* keep stepping */ }
    assert.strictEqual(JSON.stringify(s.result()), JSON.stringify(c.result), JSON.stringify(c.text));
  });
});

test('property: coach never throws on random text', () => {
  forAll(230000, 300, (rng) => {
    const r = coach(getLevel(rng.int(1, 3)), randomString(rng, 120));
    assert.strictEqual(typeof r.found, 'boolean');
    assert.strictEqual(typeof r.explanation, 'string');
    assert.ok(r.explanation.length > 0);
    assert.ok(Array.isArray(r.edits));
    if (r.found) assert.ok(parse(r.program).ok);
  });
});

test('property: coach never throws on odd levels or missing arguments', () => {
  const oddLevels = () => [undefined, null, {}, { goal: null }, { capacity: -1, timeLimit: 2 }, { walls: 'x', timeLimit: 3 },
    Object.assign(getLevel(1), { timeLimit: 2 }), Object.assign(getLevel(2), { capacity: 0.01 }), 7, 'level'];
  forAll(240000, 60, (rng) => {
    const level = rng.pick(oddLevels());
    // One short command keeps each search small even when the level has no goal.
    const text = rng.pick([undefined, null, 5, '', rng.pick(['forward', 'left', 'back', 'right']) + ' ' + rng.int(0, 300)]);
    const r = coach(level, text);
    assert.strictEqual(typeof r.found, 'boolean');
    assert.strictEqual(typeof r.explanation, 'string');
    assert.ok(r.tried <= LIMITS.CANDIDATE_CAP);
  });
});
