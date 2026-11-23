'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { LEVELS, buildLevel, getLevel, CELL } = require('../levels.js');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');

test('there are exactly 3 levels with ids 1, 2, 3', () => {
  assert.deepStrictEqual(LEVELS.map((l) => l.id), [1, 2, 3]);
});

test('every level map is rectangular with exactly one S and one G', () => {
  for (const def of LEVELS) {
    const width = def.map[0].length;
    for (const row of def.map) assert.strictEqual(row.length, width, 'level ' + def.id + ' rows have equal length');
    const text = def.map.join('');
    assert.strictEqual((text.match(/S/g) || []).length, 1, 'one start in level ' + def.id);
    assert.strictEqual((text.match(/G/g) || []).length, 1, 'one goal in level ' + def.id);
    assert.ok(/^#+$/.test(def.map[0]) && /^#+$/.test(def.map[def.map.length - 1]), 'top and bottom rows are walls');
    for (const row of def.map) assert.ok(row[0] === '#' && row[row.length - 1] === '#', 'side walls');
  }
});

test('every level defines goal, time limit and battery capacity', () => {
  for (const def of LEVELS) {
    const l = buildLevel(def);
    assert.ok(l.goal && l.goal.w > 0 && l.goal.h > 0);
    assert.ok(l.timeLimit > 0);
    assert.ok(l.capacity > 0);
    assert.ok(l.start && Number.isFinite(l.start.x) && Number.isFinite(l.start.y));
    assert.ok(l.walls.length > 0);
  }
});

test('level geometry is y-up with 0.5 m cells', () => {
  const l = getLevel(1);
  assert.strictEqual(CELL, 0.5);
  assert.strictEqual(l.width, 3.5);
  assert.strictEqual(l.height, 2.5);
  // 'S' is in the second row from the top, second column
  assert.deepStrictEqual({ x: l.start.x, y: l.start.y, theta: l.start.theta }, { x: 0.75, y: 1.75, theta: 0 });
  // 'G' is in the fourth row from the top, sixth column
  assert.deepStrictEqual(l.goal, { x: 2.5, y: 0.5, w: 0.5, h: 0.5 });
  const wallCount = LEVELS[0].map.join('').split('#').length - 1;
  assert.strictEqual(l.walls.length, wallCount);
});

test('level 3 has slick cells and the others have none', () => {
  assert.strictEqual(getLevel(1).slick.length, 0);
  assert.strictEqual(getLevel(2).slick.length, 0);
  assert.strictEqual(getLevel(3).slick.length, 2);
  assert.strictEqual(getLevel(3).slickMu, 0.25);
});

test('difficulty rises: more walls to navigate and less battery', () => {
  const [a, b, c] = [getLevel(1), getLevel(2), getLevel(3)];
  assert.ok(a.capacity > b.capacity && b.capacity > c.capacity);
  assert.ok(a.timeLimit < b.timeLimit);
});

test('getLevel returns level 1 for an unknown id and a fresh object each time', () => {
  assert.strictEqual(getLevel(99).id, 1);
  assert.strictEqual(getLevel(undefined).id, 1);
  assert.notStrictEqual(getLevel(1), getLevel(1));
});

test('each reference program parses', () => {
  for (const def of LEVELS) {
    const r = parse(def.reference);
    assert.strictEqual(r.ok, true, 'level ' + def.id + ' reference: ' + JSON.stringify(r.errors));
  }
});

test('each reference program passes its level', () => {
  for (const def of LEVELS) {
    const level = getLevel(def.id);
    const sim = runToEnd(level, parse(def.reference).program);
    assert.deepStrictEqual(sim.result, { status: 'pass', reason: 'goal' }, 'level ' + def.id);
    assert.ok(sim.events.some((e) => e.type === 'goal'));
    assert.ok(sim.state.t < level.timeLimit);
  }
});

test('level 2 reference uses a repeat loop, level 3 slips on the slick floor', () => {
  assert.ok(/repeat/.test(LEVELS[1].reference));
  const sim = runToEnd(getLevel(3), parse(LEVELS[2].reference).program);
  const slips = sim.events.filter((e) => e.type === 'slip');
  assert.ok(slips.length >= 1, 'expected at least one slip event');
  for (const s of slips) {
    assert.ok(s.required > s.limit);
    assert.ok(Math.abs(s.limit - 0.25 * 2.0 * 9.81 / 2) < 1e-9);
  }
});
