'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parse, countCommands, LIMITS } = require('../lang.js');
const { forAll, randomString } = require('./helpers');

const WORDS = ['forward', 'back', 'left', 'right', 'repeat', 'if', 'wait', 'wall-ahead',
  '[', ']', '[', ']', ';', '\n', ' ', '0', '1', '5', '90', '100', '1000', '3.5', '-2', 'abc', 'FORWARD', '1e9'];

function tokenSoup(rng) {
  const n = rng.int(0, 60);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(rng.pick(WORDS));
  return parts.join(rng.bool() ? ' ' : '');
}

// Builds a valid program as text and, independently, the number of commands it expands to.
// A repeat costs 1 + n * max(1, body); an if costs 1 + body; anything else costs 1.
function genBlock(rng, depth, budget) {
  const count = rng.int(0, depth === 0 ? 5 : 3);
  const lines = [];
  let cost = 0;
  for (let i = 0; i < count; i++) {
    const kind = rng.int(0, depth >= 3 ? 4 : 6);
    if (kind <= 4) {
      const word = ['forward', 'back', 'left', 'right', 'wait'][kind];
      const max = kind < 2 ? 1000 : kind < 4 ? 3600 : 60;
      const n = rng.bool(0.3) ? rng.int(0, max) : Math.round(rng.next() * max * 10) / 10;
      lines.push(word + ' ' + n);
      cost += 1;
    } else if (kind === 5) {
      const n = rng.int(1, 4);
      const inner = genBlock(rng, depth + 1);
      lines.push('repeat ' + n + ' [ ' + inner.text + '\n]'); // newline so a trailing comment cannot swallow the ]
      cost += 1 + n * Math.max(1, inner.cost);
    } else {
      const inner = genBlock(rng, depth + 1);
      lines.push('if wall-ahead [ ' + inner.text + '\n]'); // newline so a trailing comment cannot swallow the ]
      cost += 1 + inner.cost;
    }
    if (rng.bool(0.2)) lines[lines.length - 1] += ' ; note ' + rng.int(0, 99);
  }
  return { text: lines.join(rng.bool() ? '\n' : ' ; x\n'), cost: cost };
}

function mutate(rng, text) {
  const chars = Array.from(text);
  const edits = rng.int(1, 5);
  for (let i = 0; i < edits; i++) {
    const pos = rng.int(0, Math.max(0, chars.length - 1));
    const kind = rng.int(0, 3);
    if (kind === 0 && chars.length) chars.splice(pos, 1);
    else if (kind === 1) chars.splice(pos, 0, rng.pick(['[', ']', ';', ' ', '\n', '9', 'x', '-', '.', '\u0000', '\u{1F422}']));
    else if (kind === 2 && chars.length > 1) {
      const other = rng.int(0, chars.length - 1);
      const tmp = chars[pos]; chars[pos] = chars[other]; chars[other] = tmp;
    } else if (chars.length) chars[pos] = rng.pick(['[', ']', 'Z', '5', ' ']);
  }
  return chars.join('');
}

function assertValidShape(r, label) {
  assert.ok(r && typeof r === 'object', label + ': result is an object');
  assert.strictEqual(typeof r.ok, 'boolean', label + ': ok is boolean');
  assert.ok(Array.isArray(r.errors), label + ': errors is an array');
  assert.ok(Array.isArray(r.program), label + ': program is an array');
  assert.strictEqual(r.ok, r.errors.length === 0, label + ': ok matches errors');
  assert.ok(r.errors.length <= 5, label + ': at most 5 errors');
  for (const e of r.errors) {
    assert.ok(Number.isInteger(e.line) && e.line >= 0, label + ': line is a whole number >= 0, got ' + e.line);
    assert.ok(typeof e.message === 'string' && e.message.length > 0, label + ': message is non-empty text');
  }
  if (r.ok) assert.ok(r.program.length > 0, label + ': ok programs are not empty');
  else assert.strictEqual(r.program.length, 0, label + ': failed parses return no program');
}

test('property: parse never throws on random text', () => {
  forAll(1000, 1500, (rng) => {
    const text = randomString(rng, rng.bool(0.1) ? 6000 : 300);
    assertValidShape(parse(text), 'random text');
  });
});

test('property: parse never throws on token soup', () => {
  forAll(5000, 1500, (rng) => {
    assertValidShape(parse(tokenSoup(rng)), 'token soup');
  });
});

test('property: parse never throws on mutated valid programs', () => {
  forAll(9000, 1500, (rng) => {
    const text = genBlock(rng, 0).text;
    assertValidShape(parse(mutate(rng, text)), 'mutated program');
  });
});

test('property: parse never throws on hostile shapes', () => {
  const shapes = [
    '[', ']', '['.repeat(4999), ']'.repeat(4999), 'repeat 1 ['.repeat(500), 'if wall-ahead ['.repeat(500),
    'repeat '.repeat(700), '9'.repeat(4999), ';'.repeat(4999), '\n'.repeat(4999), '\r'.repeat(4999),
    'forward '.repeat(600), '\u0000'.repeat(4999), '\u{1F422}'.repeat(2400), 'repeat 100 ['.repeat(8) + ']'.repeat(8),
    'repeat 99999999999999999999999 [ ]', 'forward 1e400', 'forward Infinity', 'forward NaN',
    '__proto__ 1', 'constructor 1', 'toString 5', 'hasOwnProperty 1', 'repeat 3 [ __proto__ ]'
  ];
  for (const s of shapes) assertValidShape(parse(s), 'hostile ' + s.slice(0, 20));
});

test('property: generated valid programs always parse, and countCommands matches the generator', () => {
  let accepted = 0;
  forAll(20000, 1500, (rng) => {
    const g = genBlock(rng, 0);
    const r = parse(g.text);
    assertValidShape(r, 'valid program');
    if (g.cost === 0) {
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.errors[0].line, 0, 'empty program is reported as "nothing to run"');
      return;
    }
    if (g.cost > LIMITS.MAX_COMMANDS) {
      assert.strictEqual(r.ok, false, 'too many expanded commands must be rejected');
      assert.ok(r.errors[0].message.includes('repeats are expanded'));
      return;
    }
    assert.strictEqual(r.ok, true, 'should parse: ' + JSON.stringify(g.text) + ' -> ' + JSON.stringify(r.errors));
    assert.strictEqual(countCommands(r.program), g.cost);
    accepted++;
  });
  assert.ok(accepted > 500, 'generator should produce many accepted programs, got ' + accepted);
});

test('property: parse is deterministic and does not change its input', () => {
  forAll(30000, 600, (rng) => {
    const text = rng.bool() ? tokenSoup(rng) : mutate(rng, genBlock(rng, 0).text);
    const copy = String(text);
    const a = JSON.stringify(parse(text));
    const b = JSON.stringify(parse(text));
    assert.strictEqual(a, b);
    assert.strictEqual(text, copy);
  });
});

test('property: every error line points inside the text', () => {
  forAll(40000, 1000, (rng) => {
    const text = rng.bool() ? tokenSoup(rng) : mutate(rng, genBlock(rng, 0).text);
    const r = parse(text);
    const lines = text.split('\n').length;
    for (const e of r.errors) assert.ok(e.line <= lines, 'error line ' + e.line + ' beyond ' + lines + ' lines');
  });
});

test('property: error messages are printable ASCII whatever the input', () => {
  forAll(50000, 1000, (rng) => {
    const r = parse(randomString(rng, 120));
    for (const e of r.errors) assert.ok(/^[\x20-\x7e]+$/.test(e.message), 'message: ' + JSON.stringify(e.message));
  });
});

test('property: parsed nodes carry valid fields', () => {
  function check(nodes) {
    for (const n of nodes) {
      assert.ok(['forward', 'back', 'left', 'right', 'wait', 'repeat', 'if'].includes(n.type));
      assert.ok(Number.isInteger(n.line) && n.line >= 1);
      if (n.type === 'repeat') {
        assert.ok(Number.isInteger(n.n) && n.n >= 1 && n.n <= LIMITS.MAX_REPEAT);
        check(n.body);
      } else if (n.type === 'if') {
        assert.strictEqual(n.cond, 'wall-ahead');
        check(n.body);
      } else {
        assert.ok(Number.isFinite(n.n) && n.n >= 0);
      }
    }
  }
  forAll(60000, 800, (rng) => {
    const r = parse(genBlock(rng, 0).text);
    if (r.ok) check(r.program);
  });
});
