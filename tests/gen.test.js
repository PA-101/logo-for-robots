'use strict';
// Unit tests for gen.js building blocks.
const test = require('node:test');
const assert = require('node:assert');
const { makeRng, difficulty, generate } = require('../gen.js');

test('makeRng is repeatable and stays in [0, 1)', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 100; i++) {
    const x = a.next();
    assert.strictEqual(x, b.next());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notStrictEqual(makeRng(1).next(), makeRng(2).next());
});

test('difficulty schedule at its boundaries', () => {
  assert.deepStrictEqual([1, 15, 16, 30, 31, 90, 91, 136, 150].map((s) => difficulty(s).turns), [1, 1, 2, 2, 3, 6, 7, 10, 10]);
  assert.strictEqual(difficulty(30).slickChance, 0);
  assert.ok(Math.abs(difficulty(31).slickChance - 1 / 120) < 1e-12);
  assert.strictEqual(difficulty(150).slickChance, 0.5);
  assert.strictEqual(difficulty(90).ice, false);
  assert.strictEqual(difficulty(91).ice, true);
  assert.strictEqual(difficulty(96).maxLen, 4);
  assert.strictEqual(difficulty(50).maxLen, 5);
});

test('a generated level has the documented shape', () => {
  const d = generate(17);
  for (const k of ['id', 'seed', 'name', 'chapter', 'hint', 'map', 'capacity', 'timeLimit', 'slickMu', 'powerMatters', 'reference', 'attempts', 'fallback']) {
    assert.ok(Object.prototype.hasOwnProperty.call(d, k), 'has ' + k);
  }
  assert.strictEqual(d.id, 1017);
  assert.strictEqual(d.name, 'Challenge 17');
  assert.strictEqual(d.chapter, 'challenge');
  assert.ok(Number.isInteger(Math.round(d.capacity * 100)) && Math.abs(d.capacity * 100 - Math.round(d.capacity * 100)) < 1e-9, 'capacity has at most 2 decimals: ' + d.capacity);
});
