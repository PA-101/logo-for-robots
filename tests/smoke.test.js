'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeRng } = require('./helpers');

const root = path.join(__dirname, '..');
// Script order from design.md section 1 (coach.js added with the Auto-Fix Coach spec).
const modules = ['lang', 'levels', 'sim', 'telemetry', 'explain', 'coach', 'ui'];

for (const name of modules) {
  test('module ' + name + '.js loads in Node without a DOM', () => {
    const api = require(path.join(root, name + '.js'));
    assert.strictEqual(typeof api, 'object');
  });
}

test('index.html loads every module with a plain script tag, in order', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const found = [...html.matchAll(/<script\s+src="([^"]+)"\s*>/g)].map((m) => m[1]);
  assert.deepStrictEqual(found, modules.map((m) => m + '.js'));
  assert.ok(!/type\s*=\s*["']module["']/.test(html), 'no ES modules');
});

test('seeded PRNG is repeatable', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 10; i++) assert.strictEqual(a.next(), b.next());
});
