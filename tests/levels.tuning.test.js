'use strict';
// Task 26: tuning checks for chapters 2 and 3 (design.md 7b and the tuning log in section 10).
const test = require('node:test');
const assert = require('node:assert');
const { ALL_LEVELS, getLevel, getLayouts } = require('../levels.js');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');
const { coach, LIMITS } = require('../coach.js');

const stripPower = (t) => t.split('\n').filter((l) => !/^\s*power\b/.test(l)).join('\n');
function play(level, text) {
  const p = parse(text);
  assert.ok(p.ok, JSON.stringify(p.errors));
  const sim = runToEnd(level, p.program);
  return { sim, pass: sim.result.status === 'pass', t: sim.state.t, used: level.capacity - sim.state.charge };
}
function withFriction(id, factor) {
  const level = getLevel(id);
  level.slickMu *= factor;
  return level;
}

test('every reference passes every layout using at most 75 percent of time and battery', () => {
  for (const def of ALL_LEVELS) {
    for (const level of getLayouts(def.id)) {
      const r = play(level, def.reference);
      const label = 'level ' + def.id + (level.layout ? ' layout ' + level.layout : '');
      assert.ok(r.pass, label + ' fails: ' + r.sim.result.reason);
      assert.ok(r.t <= 0.75 * level.timeLimit, label + ' uses ' + (100 * r.t / level.timeLimit).toFixed(0) + '% of the time');
      assert.ok(r.used <= 0.75 * level.capacity, label + ' uses ' + (100 * r.used / level.capacity).toFixed(0) + '% of the battery');
    }
  }
});

test('level 4: at friction x0.9 the reference uses at most 70 percent of time and battery', () => {
  const level = withFriction(4, 0.9);
  const r = play(level, level.reference);
  assert.ok(r.pass);
  assert.ok(r.t <= 0.7 * level.timeLimit, (100 * r.t / level.timeLimit).toFixed(1) + '% of the time');
  assert.ok(r.used <= 0.7 * level.capacity, (100 * r.used / level.capacity).toFixed(1) + '% of the battery');
});

test('chapter 2: full power fails and the reference passes, at friction x0.9, x1.0 and x1.1', () => {
  for (const id of [4, 5, 6]) {
    for (const f of [0.9, 1, 1.1]) {
      const level = withFriction(id, f);
      const ref = play(level, level.reference);
      const full = play(level, stripPower(level.reference));
      const label = 'level ' + id + ' friction x' + f;
      assert.ok(ref.pass, label + ': the reference fails (' + ref.sim.result.reason + ')');
      assert.ok(ref.t <= 0.75 * level.timeLimit && ref.used <= 0.75 * level.capacity, label + ': reference margin');
      assert.ok(!full.pass, label + ': full power passes in ' + full.t.toFixed(1) + ' s');
    }
  }
});

test('level 6: the reference changes power on the way, which beats power 60 everywhere by at least 8 percent', () => {
  // Reworded in task 26 (design.md section 10): "power 60 everywhere fails on time" could not hold
  // together with "full power fails" on any measured level 6 shape.
  const level = getLevel(6);
  const powers = [...level.reference.matchAll(/power (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(new Set(powers).size >= 2, 'the reference uses two power values: ' + powers);
  const ref = play(level, level.reference);
  const low = play(level, 'power 60\n' + stripPower(level.reference));
  assert.ok(ref.pass);
  assert.ok(low.t >= 1.08 * ref.t, 'power 60 everywhere takes ' + low.t.toFixed(1) + ' s, the reference ' + ref.t.toFixed(1) + ' s');
});

test('chapter 3: references use until-bump, and a fixed-distance program from layout A fails another layout', () => {
  const fixed = {
    7: 'forward 150\nright 90\nforward 50',
    8: 'forward 200\nright 90\nforward 100\nleft 90\nforward 50',
    9: 'forward 100\nright 90\nforward 150'
  };
  for (const id of [7, 8, 9]) {
    const layouts = getLayouts(id);
    assert.ok(/until-bump/.test(layouts[0].reference));
    const results = layouts.map((l) => play(l, fixed[id]).pass);
    assert.strictEqual(results[0], true, 'level ' + id + ': the fixed program passes layout A');
    assert.ok(results.slice(1).includes(false), 'level ' + id + ': and fails another layout: ' + results);
  }
});

test('coach timing on chapter 3 stays under 15 s, so it keeps searching multi-layout levels', () => {
  const programs = {
    7: ['forward 150\nright 90\nforward 50', 'until-bump\nback 15\nright 90'],
    8: ['forward 200\nright 90\nforward 100\nleft 90\nforward 50', 'until-bump\nback 15\nright 90\nuntil-bump\nback 15\nleft 90'],
    9: ['forward 100\nright 90\nforward 150', 'right 90\nrepeat 8 [ if wall-ahead [ left 90 forward 50 right 90 ] ]']
  };
  const t0 = Date.now();
  for (const id of [7, 8, 9]) {
    for (const text of programs[id]) {
      const r = coach(getLayouts(id), text);
      assert.ok(r.tried <= LIMITS.CANDIDATE_CAP);
      if (r.found) for (const l of getLayouts(id)) assert.ok(play(l, r.program).pass, 'a returned fix passes every layout');
    }
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 15000, 'coach on chapter 3 took ' + ms + ' ms');
  assert.strictEqual(LIMITS.MULTI_LAYOUT, 'search', 'decision recorded in design.md section 10');
});
