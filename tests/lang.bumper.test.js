'use strict';
// Task 20: parser tests for power N, until-bump and if bumped.
const test = require('node:test');
const assert = require('node:assert');
const { parse, countCommands, LIMITS } = require('../lang.js');
const { forAll } = require('./helpers');

function ok(text) {
  const r = parse(text);
  assert.strictEqual(r.ok, true, JSON.stringify(text) + ' -> ' + JSON.stringify(r.errors));
  return r.program;
}
function bad(text, line, part) {
  const r = parse(text);
  assert.strictEqual(r.ok, false, 'expected an error for ' + JSON.stringify(text));
  assert.strictEqual(r.errors[0].line, line, r.errors[0].message);
  if (part) assert.ok(r.errors[0].message.includes(part), '"' + r.errors[0].message + '" should include "' + part + '"');
  return r.errors[0];
}

// ---- unit ----------------------------------------------------------------------

test('power N parses with its value and line, case-insensitive', () => {
  assert.deepStrictEqual(ok('forward 10\nPOWER 60'), [{ type: 'forward', n: 10, line: 1 }, { type: 'power', n: 60, line: 2 }]);
  assert.deepStrictEqual(ok('power 72.5'), [{ type: 'power', n: 72.5, line: 1 }]);
});

test('power limits: 10 and 100 are allowed, 9.9 and 100.5 are not', () => {
  assert.strictEqual(LIMITS.MIN_POWER, 10);
  assert.strictEqual(LIMITS.MAX_POWER, 100);
  ok('power 10');
  ok('power 100');
  bad('power 9.9', 1, '"power" must be at least 10, but I found 9.9.');
  bad('power 0', 1, 'must be at least 10');
  bad('forward 5\npower 100.5', 2, '100.5 is too big for "power". The most is 100.');
  bad('power 150', 1, 'The most is 100');
  bad('power -5', 1, '"power" must be at least 10, but I found -5.');
});

test('power without a valid number', () => {
  bad('power', 1, '"power" needs a number from 10 to 100, like power 50.');
  bad('power [ left 1 ]', 1, 'needs a number from 10 to 100');
  bad('power fast', 1, 'I found "fast" instead.');
  bad('power 1e2', 1, 'needs a number');
});

test('until-bump parses alone, before other commands, and inside blocks', () => {
  assert.deepStrictEqual(ok('until-bump'), [{ type: 'until-bump', line: 1 }]);
  assert.deepStrictEqual(ok('UNTIL-BUMP left 90').map((n) => n.type), ['until-bump', 'left']);
  const p = ok('repeat 3 [\n  until-bump\n  right 90\n]');
  assert.deepStrictEqual(p[0].body, [{ type: 'until-bump', line: 2 }, { type: 'right', n: 90, line: 3 }]);
});

test('until-bump with a number gets its own message', () => {
  bad('until-bump 50', 1, '"until-bump" does not take a number. It drives until the bumper touches a wall.');
  bad('forward 1\nuntil-bump -3', 2, 'does not take a number');
});

test('if bumped with a block, and the errors around it', () => {
  assert.deepStrictEqual(ok('if bumped [ back 10 ]'), [{ type: 'if', cond: 'bumped', body: [{ type: 'back', n: 10, line: 1 }], line: 1 }]);
  assert.deepStrictEqual(ok('IF BUMPED [ ]')[0].cond, 'bumped');
  bad('if bumped back 10', 1, '"if bumped" needs a "[" after the condition.');
  bad('if bumped [ back 10', 1, 'never closed');
  bad('if crashed [ ]', 1, '"if" needs a condition: wall-ahead or bumped');
  // the original condition still works and still names itself in messages
  assert.strictEqual(ok('if wall-ahead [ left 90 ]')[0].cond, 'wall-ahead');
  bad('if wall-ahead left 90', 1, '"if wall-ahead" needs a "[" after the condition.');
});

test('new commands nest and count toward the depth and command limits', () => {
  const nest = (d) => 'if bumped ['.repeat(d) + ' power 50 ' + ']'.repeat(d);
  ok(nest(LIMITS.MAX_DEPTH));
  bad(nest(LIMITS.MAX_DEPTH + 1), 1, 'nested too deeply');
  assert.strictEqual(countCommands(ok('power 50\nuntil-bump\nif bumped [ left 90 ]')), 1 + 1 + 2);
  assert.strictEqual(countCommands(ok('repeat 3 [ power 40 until-bump ]')), 1 + 3 * 2);
  bad('repeat 100 [ repeat 20 [ until-bump power 50 ] ]', 1, 'once the repeats are expanded');
});

test('positions point at the new keywords and numbers', () => {
  const text = '; go\n  power  60 ; slow\nuntil-bump\nif bumped [ back 5 ]';
  const p = parse(text, { positions: true }).program;
  assert.strictEqual(text.slice(p[0].start, p[0].start + 5), 'power');
  assert.strictEqual(text.slice(p[0].numStart, p[0].numEnd), '60');
  assert.strictEqual(text.slice(p[1].start, p[1].start + 10), 'until-bump');
  assert.strictEqual(p[1].numStart, undefined);
  assert.strictEqual(text.slice(p[2].start, p[2].start + 2), 'if');
  // without the option the shape is the plain one
  assert.deepStrictEqual(parse('power 60').program, [{ type: 'power', n: 60, line: 1 }]);
});

test('"did you mean" knows the new words and keeps the old suggestions', () => {
  bad('powr 50', 1, 'Did you mean "power"?');
  bad('until-bmp', 1, 'Did you mean "until-bump"?');
  bad('lft 90', 1, 'Did you mean "left"?');
  bad('fowrard 10', 1, 'Did you mean "forward"?');
  bad('repeet 2 [ forward 1 ]', 1, 'Did you mean "repeat"?');
  assert.ok(!bad('banana 10', 1).message.includes('Did you mean'));
});

// ---- property ------------------------------------------------------------------

// Valid programs that mix old and new commands; returns the text and the expected count.
function gen(rng, depth) {
  const lines = [];
  let cost = 0;
  const n = rng.int(0, depth === 0 ? 6 : 3);
  for (let i = 0; i < n; i++) {
    const k = rng.int(0, depth >= 3 ? 5 : 8);
    if (k === 0) { lines.push('power ' + rng.pick([10, 25, 50, 77.5, 100])); cost += 1; }
    else if (k === 1) { lines.push('until-bump'); cost += 1; }
    else if (k <= 3) { lines.push(rng.pick(['forward', 'back']) + ' ' + rng.int(0, 1000)); cost += 1; }
    else if (k <= 5) { lines.push(rng.pick(['left', 'right']) + ' ' + rng.int(0, 3600)); cost += 1; }
    else if (k === 6) {
      const inner = gen(rng, depth + 1);
      const r = rng.int(1, 4);
      lines.push('repeat ' + r + ' [ ' + inner.text + '\n]');
      cost += 1 + r * Math.max(1, inner.cost);
    } else {
      const inner = gen(rng, depth + 1);
      lines.push('if ' + rng.pick(['bumped', 'wall-ahead']) + ' [ ' + inner.text + '\n]');
      cost += 1 + inner.cost;
    }
    if (rng.bool(0.2)) lines[lines.length - 1] += ' ; note';
  }
  return { text: lines.join('\n'), cost };
}

function mutate(rng, text) {
  const chars = Array.from(text);
  for (let e = rng.int(1, 5); e > 0; e--) {
    const p = rng.int(0, Math.max(0, chars.length - 1));
    const k = rng.int(0, 2);
    if (k === 0 && chars.length) chars.splice(p, 1);
    else if (k === 1) chars.splice(p, 0, rng.pick(['[', ']', '-', ' ', '\n', '9', 'until-bump', 'power', 'bumped']));
    else if (chars.length) chars[p] = rng.pick(['[', ']', '5', ' ', 'x']);
  }
  return chars.join('');
}

function validShape(r) {
  assert.strictEqual(typeof r.ok, 'boolean');
  assert.strictEqual(r.ok, r.errors.length === 0);
  for (const e of r.errors) assert.ok(Number.isInteger(e.line) && e.line >= 0 && e.message.length > 0);
}

test('property: valid programs with the new commands parse and count correctly', () => {
  let accepted = 0;
  forAll(400000, 1200, (rng) => {
    const g = gen(rng, 0);
    const r = parse(g.text);
    validShape(r);
    if (g.cost === 0) { assert.strictEqual(r.errors[0].line, 0); return; }
    if (g.cost > LIMITS.MAX_COMMANDS) { assert.strictEqual(r.ok, false); return; }
    assert.strictEqual(r.ok, true, JSON.stringify(g.text) + ' -> ' + JSON.stringify(r.errors));
    assert.strictEqual(countCommands(r.program), g.cost);
    accepted++;
  });
  assert.ok(accepted > 600, 'accepted ' + accepted);
});

test('property: mutated programs with the new commands never throw and keep a valid shape', () => {
  forAll(410000, 1500, (rng) => validShape(parse(mutate(rng, gen(rng, 0).text))));
});

test('property: parsing programs with the new commands is deterministic', () => {
  forAll(420000, 500, (rng) => {
    const text = rng.bool() ? gen(rng, 0).text : mutate(rng, gen(rng, 0).text);
    assert.strictEqual(JSON.stringify(parse(text)), JSON.stringify(parse(text)));
    assert.strictEqual(JSON.stringify(parse(text, { positions: true })), JSON.stringify(parse(text, { positions: true })));
  });
});

test('property: parsed new nodes carry valid fields', () => {
  forAll(430000, 600, (rng) => {
    const r = parse(gen(rng, 0).text);
    if (!r.ok) return;
    (function walk(nodes) {
      for (const n of nodes) {
        if (n.type === 'power') assert.ok(n.n >= 10 && n.n <= 100);
        if (n.type === 'until-bump') assert.deepStrictEqual(Object.keys(n).sort(), ['line', 'type']);
        if (n.type === 'if') assert.ok(['wall-ahead', 'bumped'].includes(n.cond));
        if (n.body) walk(n.body);
      }
    })(r.program);
  });
});
