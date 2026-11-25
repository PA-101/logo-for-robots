'use strict';
// Task 14: no DOM use outside ui.js (steering tech.md), checked by reading the source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LOGIC = ['lang.js', 'levels.js', 'sim.js', 'telemetry.js', 'explain.js', 'coach.js', 'gen.js', 'export.js'];
const DOM = /\b(document|window|navigator|localStorage|requestAnimationFrame|getContext|HTMLElement|addEventListener|querySelector)\b/;
const RANDOM = /\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b|\bnew Date\b/;

// Remove comments and string literals so words in prose do not count.
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
}

test('logic files never touch the DOM', () => {
  for (const f of LOGIC) {
    const src = code(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    const m = src.match(DOM);
    assert.ok(!m, f + ' uses ' + (m && m[0]));
  }
});

test('logic files use no unseeded randomness or clock reads', () => {
  for (const f of LOGIC) {
    const src = code(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    const m = src.match(RANDOM);
    assert.ok(!m, f + ' uses ' + (m && m[0]));
  }
});

test('the checker itself would catch DOM use', () => {
  assert.ok(DOM.test(code('var c = document.getElementById("x");')));
  assert.ok(!DOM.test(code('// the document says\nvar s = "window";')));
});

test('every logic file has the dual export line', () => {
  for (const f of LOGIC) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(src.includes("if (typeof module !== 'undefined') module.exports"), f);
  }
});
