'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { coach, createSearch, generateEdits, applyEdits, LIMITS } = require('../coach.js');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');
const { getLevel } = require('../levels.js');
const { explain, fmt } = require('../explain.js');

function passes(id, text) {
  const p = parse(text);
  return p.ok && runToEnd(getLevel(id), p.program).result.status === 'pass';
}
function rerun(id, text) { return runToEnd(getLevel(id), parse(text).program); }

// ---- parser positions --------------------------------------------------------

test('parse with positions gives offsets that point at the keyword and the number', () => {
  const text = '; start\n  FORWARD   50 ; go\nrepeat 2 [\n  left 12.5\n]\nif wall-ahead [ right 90 ]';
  const r = parse(text, { positions: true });
  assert.strictEqual(r.ok, true);
  const seen = [];
  (function walk(nodes) {
    for (const n of nodes) {
      seen.push(n.type);
      assert.strictEqual(text.slice(n.start, n.start + n.type.length).toLowerCase(), n.type === 'if' ? 'if' : n.type);
      if (n.type !== 'if') assert.strictEqual(Number(text.slice(n.numStart, n.numEnd)), n.n);
      if (n.body) walk(n.body);
    }
  })(r.program);
  assert.deepStrictEqual(seen, ['forward', 'repeat', 'left', 'if', 'right']);
});

test('parse without the option keeps the original node shape', () => {
  assert.deepStrictEqual(parse('forward 5').program, [{ type: 'forward', n: 5, line: 1 }]);
  assert.deepStrictEqual(parse('forward 5', {}).program, [{ type: 'forward', n: 5, line: 1 }]);
  assert.deepStrictEqual(parse('forward 5', { positions: 'yes' }).program, [{ type: 'forward', n: 5, line: 1 }]);
});

// ---- generateEdits -------------------------------------------------------------

test('generateEdits gives the exact scale, turn and wait edits in order', () => {
  const edits = generateEdits('forward 50\nleft 90');
  assert.deepStrictEqual(edits.filter((e) => e.kind === 'scale').map((e) => e.insert),
    ['25', '38', '45', '55', '63', '75', '100']);
  assert.deepStrictEqual(edits.filter((e) => e.kind === 'turn').map((e) => e.insert),
    ['85', '95', '80', '100', '75', '105', '70', '110', '60', '120', '45', '135']);
  assert.deepStrictEqual(edits.filter((e) => e.kind === 'wait').map((e) => e.insert), ['wait 0.5 ', 'wait 1 ']);
  assert.strictEqual(edits.length, 21);
  assert.deepStrictEqual(edits.map((e) => e.index), edits.map((_, i) => i));
  const byInsert = (s) => edits.find((e) => e.insert === s);
  assert.strictEqual(byInsert('100').size, 1);
  assert.strictEqual(byInsert('45').kind, 'scale');
  assert.ok(Math.abs(edits.find((e) => e.kind === 'turn' && e.insert === '80').size - 10 / 90) < 1e-12);
  assert.strictEqual(byInsert('wait 0.5 ').size, 0.25);
  assert.strictEqual(byInsert('100').text, 'Line 1: forward 50 -> forward 100');
  assert.strictEqual(edits.find((e) => e.insert === '135').text, 'Line 2: left 90 -> left 135');
});

test('generateEdits skips zero distances, duplicates and values outside the language limits', () => {
  assert.deepStrictEqual(generateEdits('forward 0'), []);
  assert.deepStrictEqual(generateEdits('back 1').map((e) => e.insert), ['2']);       // 0.5 and 0.75 round to 1
  const big = generateEdits('forward 1000').map((e) => Number(e.insert));
  assert.deepStrictEqual(big, [500, 750, 900]);
  const small = generateEdits('left 3').filter((e) => e.kind === 'turn').map((e) => Number(e.insert));
  assert.deepStrictEqual(small, [8, 13, 18, 23, 33, 48]);
  const top = generateEdits('right 3600').filter((e) => e.kind === 'turn').map((e) => Number(e.insert));
  assert.ok(top.every((n) => n < 3600) && top.length === 6);
  assert.deepStrictEqual(generateEdits('wait 3'), []);
  assert.deepStrictEqual(generateEdits('forward'), [], 'a program that does not parse has no edits');
  assert.deepStrictEqual(generateEdits(null), []);
});

test('turn edits on decimal angles stay plain numbers the parser accepts', () => {
  for (const e of generateEdits('left 12.35\nright 0.1')) {
    const text = applyEdits('left 12.35\nright 0.1', [e]);
    assert.strictEqual(parse(text).ok, true, text);
  }
});

test('edits inside a repeat say they change every pass', () => {
  const inLoop = generateEdits('repeat 3 [ forward 10 ]');
  assert.ok(inLoop.every((e) => e.text.endsWith('(inside a repeat, so it changes every pass)')));
  const once = generateEdits('repeat 1 [ forward 10 ]');
  assert.ok(once.every((e) => !e.text.includes('repeat')));
});

// ---- applyEdits ----------------------------------------------------------------

test('applyEdits changes only the target number and keeps comments, spacing and lines', () => {
  const text = '; route\n  forward   50   ; first leg\nleft 90 ; turn\n';
  const edits = generateEdits(text);
  const scale = edits.find((e) => e.insert === '100');
  assert.strictEqual(applyEdits(text, [scale]), '; route\n  forward   100   ; first leg\nleft 90 ; turn\n');
  const wait = edits.find((e) => e.insert === 'wait 1 ');
  assert.strictEqual(applyEdits(text, [wait]), '; route\n  forward   50   ; first leg\nwait 1 left 90 ; turn\n');
  const both = applyEdits(text, [wait, scale]);
  assert.strictEqual(both, '; route\n  forward   100   ; first leg\nwait 1 left 90 ; turn\n');
  assert.strictEqual(both.split('\n').length, text.split('\n').length);
  assert.strictEqual(applyEdits(text, []), text);
  assert.strictEqual(applyEdits(text, [null, { insert: 5 }, { insert: 'x', start: 999, end: 1000 }]), text);
});

// ---- search: known fixes ---------------------------------------------------------

test('level 1: a short last leg is fixed by scaling it (forward 50 -> forward 100)', () => {
  const text = '; my try\nforward 200\nright 90\nforward 50';
  const r = coach(getLevel(1), text);
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.edits.map((e) => e.text), ['Line 4: forward 50 -> forward 100']);
  assert.strictEqual(r.program, '; my try\nforward 200\nright 90\nforward 100');
  assert.ok(passes(1, r.program));
  assert.strictEqual(r.tried, generateEdits(text).length, 'only single edits were tried');
});

test('level 2: a turn that is 10 degrees short is fixed inside the repeat', () => {
  const text = 'repeat 2 [ forward 100 right 80 forward 100 left 90 ]\nforward 100';
  const r = coach(getLevel(2), text);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.edits.length, 1);
  assert.strictEqual(r.edits[0].kind, 'turn');
  assert.ok(r.edits[0].text.includes('inside a repeat'));
  assert.ok(passes(2, r.program));
});

test('level 3: stopping short after the slippery corner is fixed (forward 100 -> forward 200)', () => {
  const r = coach(getLevel(3), 'forward 200\nright 90\nforward 100\nleft 90\nforward 100');
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.edits.map((e) => e.text), ['Line 5: forward 100 -> forward 200']);
  assert.ok(passes(3, r.program));
});

test('two edits are used only when no single edit passes', () => {
  const text = 'forward 150\nright 60\nforward 100\nleft 90\nforward 200';
  for (const e of generateEdits(text)) assert.ok(!passes(3, applyEdits(text, [e])), 'single edit passes: ' + e.text);
  const r = coach(getLevel(3), text);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.edits.length, 2);
  assert.ok(r.tried > generateEdits(text).length);
  assert.ok(passes(3, r.program));
  assert.strictEqual(r.program, applyEdits(text, r.edits));
});

test('the chosen fix is the smallest passing edit, then the fastest, then the cheapest', () => {
  const text = 'repeat 2 [ forward 100 right 80 forward 100 left 90 ]\nforward 100';
  const passing = generateEdits(text).map((e) => {
    const t = applyEdits(text, [e]);
    const sim = rerun(2, t);
    return { e, t, ok: sim.result.status === 'pass', time: sim.state.t, used: sim.capacity - sim.state.charge };
  }).filter((c) => c.ok);
  assert.ok(passing.length >= 2, 'need several passing edits to test the ranking');
  passing.sort((a, b) => a.e.size - b.e.size || a.time - b.time || a.used - b.used || a.e.index - b.e.index);
  const r = coach(getLevel(2), text);
  assert.strictEqual(r.program, passing[0].t);
});

test('level 1: walking into the wall is fixed and the explanation quotes the stall numbers', () => {
  const text = 'forward 250\nright 90\nforward 100';
  const before = rerun(1, text);
  const stall = before.events.filter((e) => e.type === 'stall').sort((a, b) => b.duration - a.duration)[0];
  assert.ok(stall, 'the original run stalls');
  const r = coach(getLevel(1), text);
  assert.strictEqual(r.found, true);
  const after = rerun(1, r.program);
  const used = after.capacity - after.state.charge;
  const lines = r.explanation.split('\n');
  const beforeExp = explain({ result: before.result, events: before.events, state: before.state });
  assert.strictEqual(lines[0], 'Before: ' + beforeExp.causes[0].text +
    ' The run ended at ' + fmt(before.state.t, 1) + ' s after using ' + fmt(before.capacity - before.state.charge, 2) + ' C.');
  assert.strictEqual(lines[1], 'Change: ' + r.edits.map((e) => e.text).join('; ') + '.');
  assert.strictEqual(lines[2], 'After: the robot reaches the goal in ' + fmt(after.state.t, 1) + ' s using ' + fmt(used, 2) +
    ' C of 3.00 C (' + fmt(used / 3 * 100, 0) + '% of the battery).');
  assert.ok(lines.includes('Stall: ' + fmt(stall.duration, 1) + ' s at ' + fmt(stall.current, 2) + ' A before, none after.'), r.explanation);
  assert.ok(/^Tried \d+ changes; \d+ passed\. This is the smallest change that works\.$/.test(lines[lines.length - 1]));
});

// ---- search: honest failures ---------------------------------------------------

test('a program that needs another command is not fixed, and the message says so with the closest distance', () => {
  const r = coach(getLevel(1), 'forward 400');
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.program, 'forward 400');
  assert.deepStrictEqual(r.edits, []);
  assert.strictEqual(r.tried, 7);
  assert.ok(r.explanation.startsWith('Tried 7 small changes to distances, turn angles and waits, and none reached the goal.'));
  assert.ok(/The closest ended \d+\.\d\d m from the goal \(Line 1: forward 400 -> forward \d+\)\./.test(r.explanation), r.explanation);
  assert.ok(r.explanation.endsWith('The program probably needs a different command, not a different number.'));
});

test('a program with nothing to change says so', () => {
  const r = coach(getLevel(1), 'wait 30');
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.tried, 0);
  assert.ok(r.explanation.includes('no distances or turn angles to change'));
});

test('a program that already passes is left alone', () => {
  const r = coach(getLevel(1), 'forward 200\nright 90\nforward 100');
  assert.deepStrictEqual(r, {
    found: false, program: 'forward 200\nright 90\nforward 100', edits: [],
    explanation: 'This program already passes level 1 in 5.9 s. Nothing to fix.', tried: 0
  });
});

test('a parse error points to the line instead of searching', () => {
  const r = coach(getLevel(1), 'forward 10\nfowrard 3');
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.tried, 0);
  assert.strictEqual(r.explanation,
    'Fix the error on line 2 first: I don\'t know the word "fowrard". Did you mean "forward"? The coach only changes programs that run.');
  assert.ok(coach(getLevel(1), '').explanation.startsWith('Fix the program first: Nothing to run.'));
});

test('the search stops at 3000 candidates and says it hit the limit', () => {
  // Eight turns and no movement: nothing can pass, and singles plus pairs exceed the cap.
  const text = 'left 10\nright 10\nleft 20\nright 20\nleft 30\nright 30\nleft 40\nright 40';
  const r = coach(getLevel(1), text);
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.tried, LIMITS.CANDIDATE_CAP);
  assert.ok(r.explanation.includes('The search stopped at its limit of 3000 changes.'), r.explanation);
});

test('the level reference program is never used', () => {
  const text = 'forward 200\nright 90\nforward 50';
  const normal = coach(getLevel(1), text);
  const level = getLevel(1);
  level.reference = 'forward 999 ; poisoned';
  assert.strictEqual(JSON.stringify(coach(level, text)), JSON.stringify(normal));
  delete level.reference;
  assert.strictEqual(JSON.stringify(coach(level, text)), JSON.stringify(normal));
});

test('createSearch reports progress and gives the same result as coach', () => {
  const text = 'forward 150\nright 60\nforward 100\nleft 90\nforward 200';
  const s = createSearch(getLevel(3), text);
  assert.strictEqual(s.done, false);
  assert.strictEqual(s.result(), null, 'no result before the search is done');
  let steps = 0;
  while (!s.step(37)) {
    steps++;
    assert.ok(s.progress.tried <= LIMITS.CANDIDATE_CAP && s.progress.cap === 3000);
  }
  assert.ok(steps > 3);
  assert.strictEqual(JSON.stringify(s.result()), JSON.stringify(coach(getLevel(3), text)));
});

test('coach never throws on odd arguments', () => {
  for (const [level, text] of [[undefined, undefined], [null, 'forward 5'], [{}, 'forward 5'], [getLevel(1), 42], [getLevel(1), {}], ['x', []]]) {
    const r = coach(level, text);
    assert.strictEqual(typeof r.found, 'boolean');
    assert.strictEqual(typeof r.explanation, 'string');
    assert.ok(Array.isArray(r.edits));
  }
});
