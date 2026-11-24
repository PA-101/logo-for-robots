'use strict';
// Task 34: microcontroller export.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { toCpp, CONSTANTS } = require('../export.js');
const { parse } = require('../lang.js');
const { runToEnd, C } = require('../sim.js');
const { forAll } = require('./helpers');

const FIX = path.join(__dirname, 'fixtures', 'export');
const SAMPLES = fs.readdirSync(FIX).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''));
const TITLES = { '1-first-steps': 'Level 1: First Steps', '2-staircase-repeat': 'Level 2: Staircase', '3-ice-power': 'Level 4: Ice Hairpin', '4-bumper': 'Level 7: Dark Corridor', '5-every-command': 'Every command' };
const BRANDS = /arduino|esp32|esp8266|espressif|raspberry|\bpico\b|stm32|teensy|atmega|\bavr\b|atmel|microchip|adafruit|sparkfun|mbed|nordic|lego|vex|micro:bit|microbit/i;

test('five sample programs give the fixed expected C++ output', () => {
  assert.strictEqual(SAMPLES.length, 5);
  for (const name of SAMPLES) {
    const text = fs.readFileSync(path.join(FIX, name + '.txt'), 'utf8');
    const want = fs.readFileSync(path.join(FIX, name + '.cpp'), 'utf8').replace(/\r\n/g, '\n');
    const r = toCpp(text, { title: TITLES[name] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.code, want, name);
  }
});

test('the output says the constants are uncalibrated, next to each constant', () => {
  const code = toCpp('forward 10').code;
  assert.ok(/UNCALIBRATED/.test(code.split('\n').slice(0, 4).join('\n')), 'header warning');
  for (const k of ['MS_PER_CM', 'MS_PER_DEG', 'CRUISE_PWM', 'TURN_PWM', 'WALL_AHEAD_CM']) {
    const line = code.split('\n').find((l) => l.startsWith('const') && l.includes(' ' + k + ' '));
    assert.ok(line && /uncalibrated/.test(line), k + ': ' + line);
  }
  assert.ok(/tune/i.test(code));
});

test('timing constants are derived from the simulator', () => {
  const open = { walls: [], slick: [], goal: { x: 99, y: 99, w: 1, h: 1 }, start: { x: 0, y: 0, theta: 0 }, capacity: 50, timeLimit: 60 };
  const mv = runToEnd(open, parse('forward 100').program).state.t;
  const tn = runToEnd(open, parse('left 90').program).state.t;
  assert.ok(Math.abs(CONSTANTS.MS_PER_CM - mv * 10) < 0.01);
  assert.ok(Math.abs(CONSTANTS.MS_PER_DEG - tn * 1000 / 90) < 0.01);
  assert.strictEqual(CONSTANTS.CRUISE_PWM, Math.round(C.CRUISE_DUTY * 255));
  assert.strictEqual(CONSTANTS.WALL_AHEAD_CM, 35);
  assert.strictEqual(CONSTANTS.UNTIL_BUMP_MAX_MS, 15000);
});

test('every command type produces its own code line with a line comment', () => {
  const cases = {
    'forward 50': /driveFor\(scaled\(CRUISE_PWM\), scaled\(CRUISE_PWM\), msFor\(50\.0 \* MS_PER_CM\)\);\s+\/\/ line 1: forward 50/,
    'back 20': /driveFor\(-scaled\(CRUISE_PWM\), -scaled\(CRUISE_PWM\), msFor\(20\.0 \* MS_PER_CM\)\);\s+\/\/ line 1: back 20/,
    'left 90': /driveFor\(-scaled\(TURN_PWM\), scaled\(TURN_PWM\), msFor\(90\.0 \* MS_PER_DEG\)\);\s+\/\/ line 1: left 90/,
    'right 45': /driveFor\(scaled\(TURN_PWM\), -scaled\(TURN_PWM\), msFor\(45\.0 \* MS_PER_DEG\)\);\s+\/\/ line 1: right 45/,
    'wait 2': /setMotorPwm\(0, 0\); delayMs\(\(unsigned long\)\(2\.0 \* 1000\)\);\s+\/\/ line 1: wait 2/,
    'power 60': /power = 0\.6;\s+\/\/ line 1: power 60/,
    'until-bump': /untilBump\(\);\s+\/\/ line 1: until-bump/,
    'repeat 3 [ left 10 ]': /for \(int i0 = 0; i0 < 3; i0\+\+\) \{\s+\/\/ line 1: repeat 3/,
    'if wall-ahead [ left 10 ]': /if \(readDistanceCm\(\) < WALL_AHEAD_CM\) \{\s+\/\/ line 1: if wall-ahead/,
    'if bumped [ left 10 ]': /if \(checkBumped\(\)\) \{\s+\/\/ line 1: if bumped/
  };
  for (const [text, re] of Object.entries(cases)) assert.ok(re.test(toCpp(text).code), text);
});

test('nesting depth and loop counts are preserved', () => {
  const code = toCpp('repeat 2 [\n  repeat 4 [\n    if bumped [ left 5 ]\n  ]\n]').code;
  const body = code.slice(code.indexOf('void runProgram() {'));
  assert.ok(body.includes('\n  for (int i0 = 0; i0 < 2; i0++) {'));
  assert.ok(body.includes('\n    for (int i1 = 0; i1 < 4; i1++) {'));
  assert.ok(body.includes('\n      if (checkBumped()) {'));
  assert.ok(body.includes('\n        driveFor(-scaled(TURN_PWM), scaled(TURN_PWM), msFor(5.0 * MS_PER_DEG));'));
  const opens = (body.match(/\{/g) || []).length, closes = (body.match(/\}/g) || []).length;
  assert.strictEqual(opens, closes, 'braces balance');
});

test('an invalid program returns the parse error instead of code', () => {
  const r = toCpp('forward 10\nfowrard 5');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, '');
  assert.strictEqual(r.errors[0].line, 2);
  assert.ok(/fowrard/.test(r.errors[0].message));
});

// Valid random programs mixing every command.
function gen(rng, depth) {
  const out = [];
  for (let i = rng.int(1, depth ? 3 : 6); i > 0; i--) {
    const k = rng.int(0, depth >= 3 ? 7 : 9);
    if (k === 0) out.push('forward ' + rng.int(0, 1000));
    else if (k === 1) out.push('back ' + rng.int(0, 1000) + '.5');
    else if (k === 2) out.push('left ' + rng.int(0, 3600));
    else if (k === 3) out.push('right ' + rng.int(0, 3600));
    else if (k === 4) out.push('wait ' + rng.int(0, 60));
    else if (k === 5) out.push('power ' + rng.int(10, 100));
    else if (k === 6) out.push('until-bump');
    else if (k === 7) out.push('; note ' + rng.int(0, 9));
    else if (k === 8) out.push('repeat ' + rng.int(1, 5) + ' [\n' + gen(rng, depth + 1) + '\n]');
    else out.push('if ' + (rng.bool() ? 'bumped' : 'wall-ahead') + ' [\n' + gen(rng, depth + 1) + '\n]');
  }
  return out.join('\n');
}

test('property: toCpp never throws on random valid programs, and every command gets a line', () => {
  let checked = 0;
  forAll(500000, 400, (rng) => {
    const text = gen(rng, 0);
    const p = parse(text);
    if (!p.ok) return;
    let r;
    assert.doesNotThrow(() => { r = toCpp(text, { title: 'random' }); });
    assert.strictEqual(r.ok, true);
    let count = 0;
    (function walk(nodes) { for (const n of nodes) { count++; if (n.body) walk(n.body); } })(p.program);
    const body = r.code.slice(r.code.indexOf('void runProgram() {'));
    assert.strictEqual((body.match(/\/\/ line \d+: /g) || []).length, count, 'one commented line per command');
    assert.ok(!BRANDS.test(r.code));
    checked++;
  });
  assert.ok(checked > 300, 'checked ' + checked);
});

test('toCpp never throws on odd input', () => {
  for (const v of [null, undefined, 42, {}, [], [null, 5, { type: 'bogus' }], '', '\u0000[[', 'x'.repeat(6000)]) {
    assert.doesNotThrow(() => toCpp(v));
    assert.strictEqual(typeof toCpp(v).ok, 'boolean');
  }
  assert.doesNotThrow(() => toCpp('forward 5', { title: '*/ evil \u0007 title' }));
  assert.ok(!toCpp('forward 5', { title: 'a */ b' }).code.includes('a */ b'), 'a title cannot close the comment');
});

test('no third-party brand names in the export, the UI or the page', () => {
  for (const name of SAMPLES) assert.ok(!BRANDS.test(fs.readFileSync(path.join(FIX, name + '.cpp'), 'utf8')), name);
  for (const f of ['export.js', 'ui.js', 'index.html']) {
    assert.ok(!BRANDS.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), f);
  }
});
