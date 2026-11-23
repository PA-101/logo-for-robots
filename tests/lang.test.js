'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parse, countCommands, LIMITS } = require('../lang.js');

function ok(text) {
  const r = parse(text);
  assert.strictEqual(r.ok, true, 'expected ok for ' + JSON.stringify(text) + ' got ' + JSON.stringify(r.errors));
  assert.deepStrictEqual(r.errors, []);
  return r.program;
}

function bad(text, line, messagePart) {
  const r = parse(text);
  assert.strictEqual(r.ok, false, 'expected error for ' + JSON.stringify(text));
  assert.deepStrictEqual(r.program, []);
  assert.strictEqual(r.errors.length >= 1, true);
  assert.strictEqual(r.errors[0].line, line, 'line for ' + JSON.stringify(text) + ': ' + r.errors[0].message);
  if (messagePart) {
    assert.ok(r.errors[0].message.includes(messagePart),
      'message "' + r.errors[0].message + '" should include "' + messagePart + '"');
  }
  return r.errors[0];
}

test('each simple command parses with its number and line', () => {
  for (const word of ['forward', 'back', 'left', 'right', 'wait']) {
    const p = ok(word + ' 12.5');
    assert.deepStrictEqual(p, [{ type: word, n: 12.5, line: 1 }]);
  }
});

test('commands on several lines get the right line numbers', () => {
  const p = ok('forward 10\n\n  left 90\nback 5');
  assert.deepStrictEqual(p.map((c) => [c.type, c.line]), [['forward', 1], ['left', 3], ['back', 4]]);
});

test('several commands on one line', () => {
  const p = ok('forward 10 left 90 forward 10');
  assert.strictEqual(p.length, 3);
  assert.ok(p.every((c) => c.line === 1));
});

test('repeat with a body', () => {
  const p = ok('repeat 4 [ forward 50 right 90 ]');
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].type, 'repeat');
  assert.strictEqual(p[0].n, 4);
  assert.deepStrictEqual(p[0].body.map((c) => c.type), ['forward', 'right']);
});

test('repeat block can span several lines and brackets can touch words', () => {
  const p = ok('repeat 2 [\n  forward 10\n  left 90\n]\nback 1');
  assert.strictEqual(p[0].body.length, 2);
  assert.strictEqual(p[1].type, 'back');
  const q = ok('repeat 2[forward 10]');
  assert.strictEqual(q[0].body.length, 1);
});

test('nested repeat', () => {
  const p = ok('repeat 3 [ repeat 2 [ forward 1 ] left 90 ]');
  assert.strictEqual(p[0].body[0].type, 'repeat');
  assert.strictEqual(p[0].body[0].n, 2);
  assert.strictEqual(p[0].body[1].type, 'left');
});

test('if wall-ahead with a body, case-insensitive', () => {
  const p = ok('IF Wall-Ahead [ LEFT 90 ]');
  assert.deepStrictEqual(p[0].type, 'if');
  assert.strictEqual(p[0].cond, 'wall-ahead');
  assert.strictEqual(p[0].body[0].type, 'left');
});

test('empty block is allowed', () => {
  const p = ok('repeat 3 [ ]');
  assert.deepStrictEqual(p[0].body, []);
});

test('comments are ignored, including after commands and inside blocks', () => {
  const p = ok('; start\nforward 10 ; go\nrepeat 2 [ ; loop\n  left 90 ; turn\n]');
  assert.deepStrictEqual(p.map((c) => c.type), ['forward', 'repeat']);
  assert.strictEqual(p[1].body.length, 1);
});

test('a comment hides brackets and keywords', () => {
  const p = ok('forward 10 ; ] [ repeat bad');
  assert.strictEqual(p.length, 1);
});

test('keywords are case-insensitive', () => {
  assert.strictEqual(ok('FoRwArD 5')[0].type, 'forward');
});

test('Windows line endings and tabs work', () => {
  const p = ok('forward 1\r\n\tleft 2\r\n');
  assert.deepStrictEqual(p.map((c) => c.line), [1, 2]);
});

test('empty and comment-only input say there is nothing to run', () => {
  for (const text of ['', '   \n\t', '; just a comment', ';a\n;b\n']) {
    bad(text, 0, 'Nothing to run');
  }
});

test('null, undefined and non-strings never throw', () => {
  for (const v of [null, undefined, 42, {}, [], true]) {
    const r = parse(v);
    assert.strictEqual(typeof r.ok, 'boolean');
  }
});

test('unknown word: message names the word and the line', () => {
  const e = bad('forward 10\njump 5', 2, '"jump"');
  assert.ok(e.message.includes("don't know"));
});

test('unknown word near a keyword gets a suggestion', () => {
  bad('fowrard 10', 1, 'Did you mean "forward"?');
  bad('lft 90', 1, 'Did you mean "left"?');
  bad('repeet 2 [ forward 1 ]', 1, 'Did you mean "repeat"?');
});

test('unknown word far from every keyword gets no suggestion', () => {
  const e = bad('banana 10', 1, '"banana"');
  assert.ok(!e.message.includes('Did you mean'));
});

test('a number where a command should be', () => {
  bad('forward 10\n50', 2, 'found the number 50');
});

test('missing number', () => {
  bad('forward', 1, '"forward" needs a number');
  bad('left\nright 5', 1, '"left" needs a number');
  bad('forward [ left 1 ]', 1, '"forward" needs a number');
  bad('forward left 90', 1, 'I found "left"');
});

test('invalid numbers', () => {
  bad('forward abc', 1, 'I found "abc"');
  bad('forward 1e3', 1, 'needs a number');
  bad('forward 1.', 1, 'needs a number');
  bad('forward .5', 1, 'needs a number');
  bad('forward -5', 1, 'negative');
});

test('missing [ after repeat and after if', () => {
  bad('repeat 3 forward 1', 1, 'needs a "[" after the number');
  bad('repeat 3', 1, 'needs a "[" after the number');
  bad('if wall-ahead left 90', 1, 'needs a "[" after the condition');
});

test('if needs wall-ahead', () => {
  bad('if [ left 1 ]', 1, 'wall-ahead');
  bad('if sunny [ left 1 ]', 1, 'wall-ahead');
  bad('if', 1, 'wall-ahead');
});

test('unclosed [ reports the line of the opening bracket', () => {
  bad('forward 1\nrepeat 2 [\n  left 90\n', 2, 'never closed');
  bad('repeat 2 [ repeat 2 [ left 1 ]', 1, 'never closed');
});

test('unexpected ] reports its own line', () => {
  bad('forward 1\n]', 2, 'no matching "["');
  bad('repeat 2 [ left 1 ] ]', 1, 'no matching "["');
});

test('stray [ with no command', () => {
  bad('forward 1\n[ left 1 ]', 2, 'no command before it');
});

test('error is on the line of the bad command inside a block', () => {
  bad('repeat 2 [\n forward 1\n bogus 3\n]', 3, '"bogus"');
});

test('limits: moves', () => {
  ok('forward ' + LIMITS.MAX_MOVE);
  ok('back ' + LIMITS.MAX_MOVE);
  ok('forward 0');
  bad('forward ' + (LIMITS.MAX_MOVE + 1), 1, 'too big');
  bad('back 1000.5', 1, 'The most is 1000');
  const e = bad('forward 5000', 1, '5000 is too big for "forward". The most is 1000.');
  assert.ok(e.message);
});

test('limits: turns', () => {
  ok('left ' + LIMITS.MAX_TURN);
  ok('right 0');
  bad('left ' + (LIMITS.MAX_TURN + 1), 1, 'too big');
  bad('right 99999', 1, 'The most is 3600');
});

test('limits: wait', () => {
  ok('wait ' + LIMITS.MAX_WAIT);
  ok('wait 0');
  bad('wait 61', 1, 'The most is 60');
});

test('limits: repeat count', () => {
  ok('repeat 1 [ left 1 ]');
  ok('repeat 100 [ left 1 ]');
  bad('repeat 101 [ left 1 ]', 1, 'The most is 100');
  bad('repeat 0 [ left 1 ]', 1, 'whole number from 1 to 100');
  bad('repeat 2.5 [ left 1 ]', 1, 'whole number');
});

test('huge digit strings are rejected, not crashed on', () => {
  bad('forward ' + '9'.repeat(300), 1, 'too big');
});

test('limits: nesting depth', () => {
  const nest = (d) => 'repeat 1 ['.repeat(d) + ' left 1 ' + ']'.repeat(d);
  ok(nest(LIMITS.MAX_DEPTH));
  bad(nest(LIMITS.MAX_DEPTH + 1), 1, 'nested too deeply');
  bad('if wall-ahead ['.repeat(9) + ' left 1 ' + ']'.repeat(9), 1, 'nested too deeply');
});

test('limits: text length', () => {
  ok('forward 1\n'.repeat(400));
  bad('x'.repeat(LIMITS.MAX_TEXT + 1), 1, 'too long');
  bad(' '.repeat(LIMITS.MAX_TEXT + 1), 1, 'too long');
});

test('limits: expanded command count', () => {
  ok('repeat 100 [ forward 1 repeat 9 [ left 1 ] ]'); // costs 1 + 100 * (1 + (1 + 9)) = 1101, under the 2000 limit
});

test('limits: too many commands after expanding repeats', () => {
  bad('repeat 100 [ repeat 100 [ forward 1 ] ]', 1, 'once the repeats are expanded');
  bad('left 1\nrepeat 100 [ repeat 100 [ ] ]', 2, 'once the repeats are expanded');
  const deep = 'repeat 100 ['.repeat(8) + ' left 1 ' + ']'.repeat(8);
  bad(deep, 1, 'once the repeats are expanded');
});

test('countCommands counts expanded nodes', () => {
  assert.strictEqual(countCommands(ok('forward 1 left 1')), 2);
  assert.strictEqual(countCommands(ok('repeat 3 [ forward 1 left 1 ]')), 1 + 3 * 2);
  assert.strictEqual(countCommands(ok('if wall-ahead [ left 1 ]')), 2);
  assert.strictEqual(countCommands(ok('repeat 2 [ repeat 3 [ forward 1 ] ]')), 1 + 2 * (1 + 3 * 1));
  assert.strictEqual(countCommands(ok('repeat 5 [ ]')), 1 + 5 * 1, 'empty loop passes still cost 1 each');
  assert.strictEqual(countCommands([]), 0);
  assert.strictEqual(countCommands(null), 0);
});

test('countCommands saturates instead of overflowing', () => {
  let node = { type: 'forward', n: 1, line: 1 };
  for (let i = 0; i < 50; i++) node = { type: 'repeat', n: 100, body: [node], line: 1 };
  const total = countCommands([node]);
  assert.ok(Number.isFinite(total));
  assert.ok(total <= 1e9);
});

test('control characters and odd unicode in messages are made printable', () => {
  const e = bad('\u0001\u0002word', 1);
  assert.ok(/^[\x20-\x7e]*$/.test(e.message), 'message is printable ASCII: ' + e.message);
  const long = bad('x'.repeat(100), 1);
  assert.ok(long.message.length < 120);
});

test('the example program from the product spec parses', () => {
  const p = ok('repeat 2 [ forward 100 right 90 forward 100 left 90 ]\nforward 100');
  assert.strictEqual(p.length, 2);
});
