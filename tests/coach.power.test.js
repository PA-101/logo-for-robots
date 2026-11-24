'use strict';
// Task 23: explain and coach for power, bumper and layouts.
const test = require('node:test');
const assert = require('node:assert');
const { coach, createSearch, generateEdits, applyEdits, LIMITS } = require('../coach.js');
const { explain } = require('../explain.js');
const { buildLevel, getLevel } = require('../levels.js');
const { parse } = require('../lang.js');
const { runToEnd } = require('../sim.js');

const passes = (level, text) => runToEnd(level, parse(text).program).result.status === 'pass';

// An icy runway with a battery too small for full-power wheel spin (measured: power 100 runs
// flat at 0.62 C; power 80 passes using 0.56 C). No distance, angle or wait change saves charge.
function icyRunway(powerMatters) {
  const level = buildLevel({ id: 92, name: 'Icy runway (test)', capacity: 0.62, timeLimit: 26, slickMu: 0.08,
    map: ['##########', '#Sooooooo#', '########o#', '########o#', '########G#', '##########'] });
  level.powerMatters = powerMatters;
  return level;
}

// Two layouts of a dark corridor (design section 7b, level 7 layouts A and B).
function corridorLayouts() {
  const rows = (r1, r2) => ['##########', r1, r2, '##########'];
  return [
    Object.assign(buildLevel({ id: 97, name: 'corridor A', capacity: 3, timeLimit: 20, map: rows('#S...#####', '####G#####') }), { layout: 'A' }),
    Object.assign(buildLevel({ id: 97, name: 'corridor B', capacity: 3, timeLimit: 20, map: rows('#S.....###', '######G###') }), { layout: 'B' })
  ];
}

// ---- edits ---------------------------------------------------------------------

test('an existing power command gets the exact power-change edits', () => {
  const edits = generateEdits('power 70\nforward 50').filter((e) => e.kind === 'power');
  assert.deepStrictEqual(edits.map((e) => e.insert), ['30', '40', '50', '60', '80', '90', '100']);
  assert.deepStrictEqual(edits.map((e) => Math.round(e.size * 100)), [40, 30, 20, 10, 10, 20, 30]);
  assert.strictEqual(edits[0].text, 'Line 1: power 70 -> power 30');
  assert.strictEqual(applyEdits('power 70\nforward 50', [edits[2]]), 'power 50\nforward 50');
});

test('power inserts appear only when asked, before moves, turns and until-bump', () => {
  const text = 'forward 50\nleft 90\nuntil-bump';
  assert.ok(!generateEdits(text).some((e) => e.kind === 'power-insert'), 'none by default');
  const ins = generateEdits(text, { powerInsert: true }).filter((e) => e.kind === 'power-insert');
  assert.deepStrictEqual(ins.map((e) => [e.line, e.insert]), [[1, 'power 60 '], [1, 'power 80 '], [2, 'power 60 '], [2, 'power 80 '], [3, 'power 60 '], [3, 'power 80 ']]);
  assert.deepStrictEqual(ins.map((e) => e.size), [0.4, 0.2, 0.4, 0.2, 0.4, 0.2]);
  assert.strictEqual(applyEdits(text, [ins[5]]), 'forward 50\nleft 90\npower 80 until-bump');
  assert.ok(ins[3].text.includes('power stays 80 from line 2 on'));
});

test('without power commands or the option, the edit list is exactly the original one', () => {
  assert.strictEqual(generateEdits('forward 50\nleft 90').length, 21);
  assert.deepStrictEqual(generateEdits('forward 50\nleft 90', { powerInsert: false }), generateEdits('forward 50\nleft 90'));
  assert.deepStrictEqual(generateEdits('until-bump'), [], 'until-bump has no numbers to change');
});

// ---- power on ice -------------------------------------------------------------

test('on a "power matters" ice level the coach fixes a flat battery by inserting power', () => {
  const level = icyRunway(true);
  const text = 'forward 350\nright 90\nforward 150';
  assert.strictEqual(runToEnd(level, parse(text).program).result.reason, 'battery_flat');
  const r = coach(level, text);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.edits.length, 1);
  assert.strictEqual(r.edits[0].kind, 'power-insert');
  assert.ok(['power 60 ', 'power 80 '].includes(r.edits[0].insert), r.edits[0].insert);
  assert.ok(passes(level, r.program));
  assert.ok(r.explanation.includes('Lower power asks the floor for less force.'), 'slip hint on a power-matters level');
});

test('the same ice level without "power matters" gets no power inserts and no fix', () => {
  const r = coach(icyRunway(false), 'forward 350\nright 90\nforward 150');
  assert.strictEqual(r.found, false);
  assert.ok(r.tried > 0);
  assert.ok(!r.explanation.includes('power 60') && !r.explanation.includes('power 80'));
});

test('a program that already uses power can have its value changed by the coach', () => {
  const level = icyRunway(false);           // no inserts: only the existing power value can change
  const r = coach(level, 'power 100\nforward 350\nright 90\nforward 150');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.edits[0].kind, 'power');
  assert.ok(passes(level, r.program));
});

test('chapter 1 levels never get power inserts', () => {
  for (const id of [1, 2, 3]) assert.notStrictEqual(getLevel(id).powerMatters, true);
  const r = coach(getLevel(3), 'forward 200\nright 90\nforward 100\nleft 90\nforward 100');
  assert.ok(r.edits.every((e) => e.kind !== 'power-insert'));
  assert.strictEqual(r.tried, generateEdits('forward 200\nright 90\nforward 100\nleft 90\nforward 100').length);
});

// ---- layouts ---------------------------------------------------------------------

test('a layout search rejects a fix that passes only layout A', () => {
  const [A, B] = corridorLayouts();
  const text = 'forward 100\nright 90\nforward 50';
  const onlyA = coach(A, text);
  assert.strictEqual(onlyA.found, true, 'a fixed distance fixes layout A alone');
  assert.ok(passes(A, onlyA.program) && !passes(B, onlyA.program), 'that fix fails layout B');
  const both = coach([A, B], text);
  assert.strictEqual(both.found, false, 'no fixed distance passes both layouts');
  assert.ok(both.tried > 0);
});

test('a layout search finds a fix that passes every layout and names the layout it quotes', () => {
  const layouts = corridorLayouts();
  const text = 'until-bump\nback 15\nright 90\nforward 25';
  const r = coach(layouts, text);
  assert.strictEqual(r.found, true);
  for (const l of layouts) assert.ok(passes(l, r.program), 'passes layout ' + l.layout);
  assert.ok(r.explanation.startsWith('Before (layout A): '), r.explanation.split('\n')[0]);
  assert.ok(r.explanation.includes('After: the robot reaches the goal on all 2 layouts;'));
});

test('a single level in an array behaves exactly like a single level', () => {
  const text = 'forward 200\nright 90\nforward 50';
  assert.strictEqual(JSON.stringify(coach([getLevel(1)], text)), JSON.stringify(coach(getLevel(1), text)));
});

test('with MULTI_LAYOUT off, multi-layout levels get the fixed message and no search', () => {
  const saved = LIMITS.MULTI_LAYOUT;
  try {
    LIMITS.MULTI_LAYOUT = 'off';
    const r = coach(corridorLayouts(), 'until-bump\nback 15\nright 90\nforward 25');
    assert.deepStrictEqual(r, { found: false, program: 'until-bump\nback 15\nright 90\nforward 25', edits: [],
      explanation: 'No suggestion for multi-layout levels.', tried: 0 });
    assert.strictEqual(coach(getLevel(1), 'forward 200\nright 90\nforward 50').found, true, 'single levels unaffected');
  } finally {
    LIMITS.MULTI_LAYOUT = saved;
  }
});

test('the layout search is deterministic in one call or in steps', () => {
  const text = 'until-bump\nback 15\nright 90\nforward 25';
  const s = createSearch(corridorLayouts(), text);
  while (!s.step(3)) { /* step */ }
  assert.strictEqual(JSON.stringify(s.result()), JSON.stringify(coach(corridorLayouts(), text)));
});

// ---- explain ---------------------------------------------------------------------

test('explain names a bump timeout with its line and time', () => {
  const level = { walls: [], slick: [], goal: { x: 99, y: 99, w: 1, h: 1 }, start: { x: 0, y: 0, theta: 0 }, capacity: 50, timeLimit: 20 };
  const sim = runToEnd(level, parse('left 90\nuntil-bump').program);
  const r = explain({ result: sim.result, events: sim.events, state: sim.state, level });
  assert.strictEqual(r.verdict, 'FAIL');
  const c = r.causes.find((x) => x.type === 'bump_timeout');
  assert.ok(c, JSON.stringify(r.causes));
  assert.strictEqual(c.text, 'until-bump on line 2 drove for 15.0 s without touching a wall, so the program went on to the next command.');
  assert.strictEqual(r.title, 'Bumper never touched');
});

test('the slip hint appears only on "power matters" levels; other texts are unchanged', () => {
  const events = [{ type: 'slip', t: 1, peak: 4.5, limit: 0.78, mu: 0.08 }];
  const base = explain({ result: { status: 'fail' }, events, state: {} }).causes[0].text;
  const plain = explain({ result: { status: 'fail' }, events, state: {}, level: { powerMatters: false } }).causes[0].text;
  const hint = explain({ result: { status: 'fail' }, events, state: {}, level: { powerMatters: true } }).causes[0].text;
  assert.strictEqual(plain, base);
  assert.strictEqual(hint, base + ' Lower power asks the floor for less force.');
  assert.ok(!base.includes('Lower power'));
});

// ---- power first (R8.18) ---------------------------------------------------------

// The ice hairpin from design section 7b with its starting values, defined here so that
// later tuning of level 4 cannot change this test.
function iceHairpin(powerMatters) {
  const level = buildLevel({ id: 94, name: 'Ice hairpin (test)', capacity: 2.5, timeLimit: 40, slickMu: 0.08,
    map: ['############', '#Sooooooooo#', '##########o#', '#Gooooooooo#', '############'] });
  level.powerMatters = powerMatters;
  return level;
}
const HAIRPIN = 'forward 450\nright 90\nforward 100\nright 90\nforward 450';

test('power first: slip as root cause on a "power matters" level picks a power fix over a smaller angle fix', () => {
  const level = iceHairpin(true);
  const before = runToEnd(level, parse(HAIRPIN).program);
  const exp = explain({ result: before.result, events: before.events, state: before.state, level });
  assert.strictEqual(exp.causes[0].type, 'slip', 'the root cause is wheel slip');
  // An angle edit alone would also pass, and it is a smaller edit than any power insert.
  const angle = generateEdits(HAIRPIN).find((e) => e.kind === 'turn' && e.line === 4 && e.insert === '80');
  assert.ok(passes(level, applyEdits(HAIRPIN, [angle])), 'right 80 on line 4 passes too');
  assert.ok(angle.size < 0.2, 'and is smaller than power 80 (size 0.2)');

  const r = coach(level, HAIRPIN);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.edits.length, 1);
  assert.strictEqual(r.edits[0].kind, 'power-insert', JSON.stringify(r.edits));
  assert.ok(passes(level, r.program));
  const lines = r.explanation.split('\n');
  assert.strictEqual(lines[lines.length - 2], 'Power first: wheel slip was the root cause on a level where power matters, ' +
    'so power changes were tried before angles and distances.');
  // Only power edits were simulated: 5 moves and turns x 2 power values.
  assert.strictEqual(r.tried, generateEdits(HAIRPIN, { powerInsert: true }).filter((e) => e.kind === 'power-insert').length);
});

test('power first does not apply without "power matters": the angle fix is still chosen', () => {
  const r = coach(iceHairpin(false), HAIRPIN);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.edits[0].kind, 'turn');
  assert.ok(!r.explanation.includes('Power first'));
});

test('power first does not apply when the root cause is not slip', () => {
  // Normal floor marked "power matters": the program stops short, so the root cause is program_ended.
  const level = getLevel(1);
  level.powerMatters = true;
  const text = 'forward 200\nright 90\nforward 50';
  const sim = runToEnd(level, parse(text).program);
  assert.strictEqual(explain({ result: sim.result, events: sim.events, state: sim.state, level }).causes[0].type, 'program_ended');
  const r = coach(level, text);
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.edits.map((e) => e.text), ['Line 3: forward 50 -> forward 100']);
  assert.ok(!r.explanation.includes('Power first'));
  // normal order: every single edit (power inserts included) is simulated before ranking
  assert.strictEqual(r.tried, generateEdits(text, { powerInsert: true }).length);
});
test('power first with a power edit that cannot pass falls back to the normal search', () => {
  // Battery so small that no power helps on its own; the normal search then runs too.
  const level = iceHairpin(true);
  level.capacity = 0.3;
  const r = coach(level, HAIRPIN);
  const powerOnly = generateEdits(HAIRPIN, { powerInsert: true }).filter((e) => e.kind === 'power-insert').length;
  assert.ok(r.tried > powerOnly, 'the search went on after the power phase (' + r.tried + ' tried)');
});
