'use strict';
// Task 28: generator properties over all 150 seeds.
const test = require('node:test');
const assert = require('node:assert');
const { generate, difficulty, clampSeed, SEED_MIN, SEED_MAX, GRID_W, GRID_H } = require('../gen.js');
const { buildLevel } = require('../levels.js');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');

const SEEDS = [];
for (let s = SEED_MIN; s <= SEED_MAX; s++) SEEDS.push(s);
const t0 = Date.now();
const LEVELS = SEEDS.map((s) => generate(s));
const GEN_MS = Date.now() - t0;

test('all 150 seeds generate in under 10 s and none uses the fallback level', () => {
  assert.strictEqual(LEVELS.length, 150);
  assert.ok(GEN_MS < 10000, 'took ' + GEN_MS + ' ms');
  const fallback = LEVELS.filter((d) => d.fallback).map((d) => d.seed);
  assert.deepStrictEqual(fallback, []);
});

test('property: every generated reference passes with at least 25 percent margin in time and charge', () => {
  for (const def of LEVELS) {
    const level = buildLevel(def);
    const p = parse(def.reference);
    assert.ok(p.ok, 'seed ' + def.seed + ': ' + JSON.stringify(p.errors));
    const sim = runToEnd(level, p.program);
    assert.strictEqual(sim.result.status, 'pass', 'seed ' + def.seed + ' fails: ' + sim.result.reason);
    assert.ok(sim.state.t <= 0.75 * def.timeLimit, 'seed ' + def.seed + ' time ' + sim.state.t + ' of ' + def.timeLimit);
    assert.ok(def.capacity - sim.state.charge <= 0.75 * def.capacity, 'seed ' + def.seed + ' charge');
  }
});

test('property: generate is deterministic (same JSON twice)', () => {
  for (const s of SEEDS) assert.strictEqual(JSON.stringify(generate(s)), JSON.stringify(LEVELS[s - 1]), 'seed ' + s);
});

test('property: each map is closed, fits 15 x 11, and is one wall-separated corridor from S to G', () => {
  for (const def of LEVELS) {
    const m = def.map, label = 'seed ' + def.seed;
    assert.ok(m.length <= GRID_H && m.every((r) => r.length === m[0].length && r.length <= GRID_W), label + ': size');
    assert.ok(/^#+$/.test(m[0]) && /^#+$/.test(m[m.length - 1]) && m.every((r) => r[0] === '#' && r[r.length - 1] === '#'), label + ': closed');
    assert.ok(m.every((r) => /^[#.oSG]+$/.test(r)), label + ': characters');
    const floor = [];
    m.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '#') floor.push([x, y, ch]); }));
    const isFloor = (x, y) => y >= 0 && y < m.length && x >= 0 && x < m[y].length && m[y][x] !== '#';
    let ends = 0;
    for (const [x, y, ch] of floor) {
      const deg = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isFloor(x + dx, y + dy)).length;
      if (ch === 'S' || ch === 'G') { assert.strictEqual(deg, 1, label + ': ' + ch + ' is a corridor end'); ends++; }
      else assert.strictEqual(deg, 2, label + ': cell ' + x + ',' + y + ' touches ' + deg + ' floor cells');
    }
    assert.strictEqual(ends, 2, label + ': one S and one G');
  }
});

test('property: difficulty rises with the seed', () => {
  let prevTurns = 0;
  for (const def of LEVELS) {
    const d = difficulty(def.seed);
    const turnLines = (def.reference.match(/^(left|right) 90$/gm) || []).length;
    assert.strictEqual(turnLines, d.turns, 'seed ' + def.seed + ': the reference has the planned turns');
    assert.strictEqual(def.facts.turns, d.turns);
    assert.ok(d.turns >= prevTurns, 'turns never decrease');
    prevTurns = d.turns;
    const slick = def.map.join('').includes('o');
    if (def.seed < 31) assert.ok(!slick, 'seed ' + def.seed + ' has slick floor');
    if (def.seed < 91) {
      assert.strictEqual(def.powerMatters, false);
      assert.ok(!/power/.test(def.reference), 'seed ' + def.seed + ' uses power before the ice seeds');
      if (slick) assert.strictEqual(def.slickMu, 0.25);
    } else if (slick) {
      assert.strictEqual(def.slickMu, 0.08, 'seed ' + def.seed + ' ice');
      assert.ok(/power 60/.test(def.reference), 'seed ' + def.seed + ' lowers power on ice');
    }
  }
  assert.strictEqual(difficulty(1).turns, 1);
  assert.strictEqual(difficulty(150).turns, 10);
  assert.ok(LEVELS.slice(90).some((d) => d.slickMu === 0.08 && d.map.join('').includes('o')), 'some ice levels exist');
});

test('odd seeds never throw and are clamped', () => {
  const cases = [[0, 1], [-5, 1], [151, 150], [2.5, 3], [2.4, 2], [NaN, 1], ['17', 17], ['abc', 1], [undefined, 1], [null, 1], [Infinity, 1]];
  for (const [input, expected] of cases) {
    assert.strictEqual(clampSeed(input), expected, String(input));
    let def;
    assert.doesNotThrow(() => { def = generate(input); }, String(input));
    assert.strictEqual(def.seed, expected);
  }
});
