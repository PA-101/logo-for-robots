'use strict';
// Part B1: MicroPython export target.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { toMicroPython, exportTo, TARGETS, CONSTANTS } = require('../export.js');
const { parse } = require('../lang.js');
const { forAll } = require('./helpers');

const IN = path.join(__dirname, 'fixtures', 'export');
const OUT = path.join(__dirname, 'fixtures', 'export-py');
const SAMPLES = fs.readdirSync(IN).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''));
const TITLES = { '1-first-steps': 'Level 1: First Steps', '2-staircase-repeat': 'Level 2: Staircase', '3-ice-power': 'Level 4: Ice Hairpin', '4-bumper': 'Level 7: Dark Corridor', '5-every-command': 'Every command' };
const BRANDS = /arduino|esp32|esp8266|espressif|raspberry|\bpico\b|rp2040|stm32|teensy|atmega|\bavr\b|atmel|microchip|adafruit|sparkfun|mbed|nordic|lego|vex|micro:bit|microbit|pyboard|circuitpython/i;

// Find a Python 3 to check the samples with (optional: the checks below need it).
function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}
const PY = findPython();

test('five sample programs give the fixed expected MicroPython output', () => {
  assert.strictEqual(SAMPLES.length, 5);
  for (const name of SAMPLES) {
    const r = toMicroPython(fs.readFileSync(path.join(IN, name + '.txt'), 'utf8'), { title: TITLES[name] });
    assert.strictEqual(r.ok, true, name);
    assert.strictEqual(r.code, fs.readFileSync(path.join(OUT, name + '.py'), 'utf8').replace(/\r\n/g, '\n'), name);
  }
});

test('the header says uncalibrated and dead reckoning; pins and constants are clearly marked', () => {
  const code = toMicroPython('forward 10').code;
  const head = code.split('\n').slice(0, 8).join('\n');
  assert.ok(/UNCALIBRATED/.test(head) && /dead reckoning/.test(head) && /no wheel encoders/.test(head) && /tune/i.test(head), head);
  assert.ok(/motor-driver board/.test(head));
  for (const pin of ['LEFT_PWM_PIN', 'LEFT_DIR_PIN', 'RIGHT_PWM_PIN', 'RIGHT_DIR_PIN', 'BUMPER_PIN']) assert.ok(new RegExp('^' + pin + ' = \\d+$', 'm').test(code), pin);
  assert.ok(/# Pin numbers: change these to match your wiring\./.test(code));
  for (const k of ['MS_PER_CM', 'MS_PER_DEG', 'CRUISE_DUTY', 'TURN_DUTY', 'WALL_AHEAD_CM']) {
    const line = code.split('\n').find((l) => l.startsWith(k + ' = '));
    assert.ok(line && /uncalibrated/.test(line), k + ': ' + line);
  }
  assert.ok(code.includes('MS_PER_CM = ' + CONSTANTS.MS_PER_CM.toFixed(2)), 'same simulator-derived timing as the C++ target');
  assert.ok(/def read_distance_cm\(\):\n    """Placeholder: replace with code for your front distance sensor/.test(code));
});

test('every command type produces its own line with a line comment', () => {
  const cases = {
    'forward 50': /drive_for\(CRUISE_DUTY \* power, CRUISE_DUTY \* power, \(50\.0 \* MS_PER_CM \/ power\)\)  # line 1: forward 50/,
    'back 20': /drive_for\(-CRUISE_DUTY \* power, -CRUISE_DUTY \* power, \(20\.0 \* MS_PER_CM \/ power\)\)  # line 1: back 20/,
    'left 90': /drive_for\(-TURN_DUTY \* power, TURN_DUTY \* power, \(90\.0 \* MS_PER_DEG \/ power\)\)  # line 1: left 90/,
    'right 45': /drive_for\(TURN_DUTY \* power, -TURN_DUTY \* power, \(45\.0 \* MS_PER_DEG \/ power\)\)  # line 1: right 45/,
    'wait 2': /set_motors\(0, 0\)  # line 1: wait 2\n    time\.sleep_ms\(int\(2\.0 \* 1000\)\)/,
    'power 60': /power = 0\.6  # line 1: power 60/,
    'until-bump': /until_bump\(\)  # line 1: until-bump/,
    'repeat 3 [ left 10 ]': /for _i0 in range\(3\):  # line 1: repeat 3\n        drive_for/,
    'if wall-ahead [ left 10 ]': /if read_distance_cm\(\) < WALL_AHEAD_CM:  # line 1: if wall-ahead/,
    'if bumped [ left 10 ]': /if check_bumped\(\):  # line 1: if bumped/
  };
  for (const [text, re] of Object.entries(cases)) assert.ok(re.test(toMicroPython(text).code), text);
  assert.ok(/for _i0 in range\(2\):  # line 1: repeat 2\n        pass/.test(toMicroPython('repeat 2 [ ]').code), 'empty blocks get "pass"');
});

test('exportTo picks the target, falls back to C++, and an invalid program reports its error', () => {
  assert.deepStrictEqual(Object.keys(TARGETS), ['cpp', 'micropython']);
  assert.ok(exportTo('micropython', 'forward 1').code.startsWith('# Logo for Robots'));
  assert.ok(exportTo('cpp', 'forward 1').code.startsWith('// Logo for Robots'));
  assert.ok(exportTo('bogus', 'forward 1').code.startsWith('// Logo for Robots'));
  const bad = toMicroPython('forward 1\njump 2');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.errors[0].line, 2);
  assert.ok(!toMicroPython('forward 1', { title: 'a "quoted" title' }).code.split('\n')[0].includes('"quoted"'), 'a title cannot end the comment string');
});

function gen(rng, depth) {
  const out = [];
  for (let i = rng.int(0, depth ? 3 : 6); i > 0; i--) {
    const k = rng.int(0, depth >= 3 ? 6 : 8);
    if (k === 0) out.push('forward ' + rng.int(0, 1000));
    else if (k === 1) out.push('back ' + rng.int(0, 999) + '.5');
    else if (k === 2) out.push('left ' + rng.int(0, 3600));
    else if (k === 3) out.push('right ' + rng.int(0, 3600));
    else if (k === 4) out.push('wait ' + rng.int(0, 3));
    else if (k === 5) out.push('power ' + rng.int(10, 100));
    else if (k === 6) out.push('until-bump');
    else if (k === 7) out.push('repeat ' + rng.int(1, 3) + ' [\n' + gen(rng, depth + 1) + '\n]');
    else out.push('if ' + (rng.bool() ? 'bumped' : 'wall-ahead') + ' [\n' + gen(rng, depth + 1) + '\n]');
  }
  return out.join('\n') || 'forward 1';
}

test('property: toMicroPython never throws on random valid programs, and every command gets a line', () => {
  let n = 0;
  forAll(520000, 400, (rng) => {
    const text = gen(rng, 0);
    const p = parse(text);
    if (!p.ok) return;
    let r;
    assert.doesNotThrow(() => { r = toMicroPython(text, { title: 'random' }); });
    assert.strictEqual(r.ok, true);
    let count = 0;
    (function walk(nodes) { for (const x of nodes) { count++; if (x.body) walk(x.body); } })(p.program);
    const body = r.code.slice(r.code.indexOf('def run_program():'));
    assert.strictEqual((body.match(/  # line \d+: /g) || []).length, count);
    assert.ok(!BRANDS.test(r.code));
    n++;
  });
  assert.ok(n > 300);
});

test('toMicroPython never throws on odd input', () => {
  for (const v of [null, undefined, 42, {}, [], [null, 5, { type: 'bogus' }], '', '[[', 'x'.repeat(6000)]) {
    assert.doesNotThrow(() => toMicroPython(v));
    assert.strictEqual(typeof toMicroPython(v).ok, 'boolean');
  }
});

test('no third-party brand names in the MicroPython samples', () => {
  for (const name of SAMPLES) assert.ok(!BRANDS.test(fs.readFileSync(path.join(OUT, name + '.py'), 'utf8')), name);
});

// The two checks below need a Python 3 on this machine (it is not part of the app).
test('with Python installed: every sample compiles (py_compile)', { skip: PY ? false : 'no Python 3 found' }, () => {
  for (const name of SAMPLES) {
    const r = spawnSync(PY, ['-c', 'import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)',
      path.join(OUT, name + '.py'), path.join(os.tmpdir(), 'lfr-' + name + '.pyc')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, name + ': ' + r.stderr);
  }
});

// Runs each sample under CPython with stand-ins for the MicroPython-only parts (machine.Pin,
// machine.PWM, time.ticks_ms, time.sleep_ms). The stand-in clock advances instantly, so a
// 15 s until-bump takes no real time. This checks the program runs end to end, not just parses.
const HARNESS = [
  'import sys, time, types',
  'clock = [0]',
  'calls = []',
  'time.ticks_ms = lambda: clock[0]',
  'time.ticks_diff = lambda a, b: a - b',
  'def _sleep(ms): clock[0] += int(ms)',
  'time.sleep_ms = _sleep',
  'm = types.ModuleType("machine")',
  'class Pin:',
  '    OUT = 1; IN = 0; PULL_UP = 2',
  '    def __init__(self, n, *a): self.n = n; self.v = 1',
  '    def value(self, v=None):',
  '        if v is None: return self.v',
  '        self.v = v',
  'class PWM:',
  '    def __init__(self, pin): self.pin = pin',
  '    def freq(self, f): pass',
  '    def duty_u16(self, d):',
  '        assert 0 <= d <= 65535, d',
  '        calls.append(d)',
  'm.Pin = Pin; m.PWM = PWM',
  'sys.modules["machine"] = m',
  'src = open(sys.argv[1]).read()',
  'exec(compile(src, sys.argv[1], "exec"), {"__name__": "__main__"})',
  'assert calls and calls[-1] == 0, "motors end stopped"',
  'print(len(calls))'
].join('\n');

test('with Python installed: every sample runs to the end with stand-in hardware', { skip: PY ? false : 'no Python 3 found' }, () => {
  for (const name of SAMPLES) {
    const r = spawnSync(PY, ['-c', HARNESS, path.join(OUT, name + '.py')], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r.status, 0, name + ': ' + r.stderr);
    assert.ok(Number(r.stdout.trim()) > 0, name + ' set the motors');
  }
});
