'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { explain, fmt } = require('../explain.js');
const { runToEnd } = require('../sim.js');
const { getLevel, LEVELS } = require('../levels.js');
const { parse } = require('../lang.js');
const { forAll, randomString } = require('./helpers');

const fail = (reason) => ({ status: 'fail', reason });

function play(id, text) {
  const level = getLevel(id);
  const sim = runToEnd(level, parse(text).program);
  return explain({ result: sim.result, events: sim.events, state: sim.state, level });
}

test('stall: says it stalled against a wall with the duration in s and the current in A', () => {
  const ev = { type: 'stall', t: 4.2, duration: 2.875, current: 0.7412, duty: 0.8 };
  const r = explain({ result: fail('battery_flat'), events: [ev], state: {} });
  assert.strictEqual(r.verdict, 'FAIL');
  assert.strictEqual(r.causes.length, 1);
  const text = r.causes[0].text;
  assert.ok(text.includes('stalled against a wall'), text);
  assert.ok(text.includes('2.9 s'), text);
  assert.ok(text.includes('0.74 A'), text);
  assert.strictEqual(r.title, 'Stalled against a wall');
});

test('battery flat: says the battery ran flat with the time and the charge used', () => {
  const ev = { type: 'battery_flat', t: 7.05, charge_used: 3 };
  const r = explain({ result: fail('battery_flat'), events: [ev], state: {} });
  const text = r.causes[0].text;
  assert.ok(text.includes('battery ran flat'), text);
  assert.ok(text.includes('7.1 s'), text);
  assert.ok(text.includes('3.00 C'), text);
});

test('slip: gives the count, the peak required force and the friction limit in N', () => {
  const events = [
    { type: 'slip', t: 6.3, wheel: 'L', required: 4.1, limit: 2.4525, mu: 0.25, peak: 4.12 },
    { type: 'slip', t: 6.3, wheel: 'R', required: 4.1, limit: 2.4525, mu: 0.25, peak: 4.5 },
    { type: 'slip', t: 7.5, wheel: 'L', required: 3.2, limit: 2.4525, mu: 0.25, peak: 3.3 }
  ];
  const r = explain({ result: fail('program_ended'), events, state: {} });
  assert.strictEqual(r.causes.length, 1, 'all slip events become one cause');
  const text = r.causes[0].text;
  assert.ok(text.includes('slipped 3 times'), text);
  assert.ok(text.includes('4.50 N'), text);
  assert.ok(text.includes('2.45 N'), text);
  assert.ok(text.includes('friction 0.25'), text);
  assert.strictEqual(r.causes[0].t, 6.3);
});

test('a single slip says "once"', () => {
  const r = explain({ result: fail('timeout'), events: [{ type: 'slip', t: 1, peak: 3, limit: 2.45, mu: 0.25 }], state: {} });
  assert.ok(r.causes[0].text.includes('slipped once'));
});

test('timeout: gives the time limit and the distance to the goal', () => {
  const ev = { type: 'timeout', t: 12, limit: 12, distance_to_goal: 2.2360679 };
  const r = explain({ result: fail('timeout'), events: [ev], state: {} });
  const text = r.causes[0].text;
  assert.ok(text.includes('Time ran out'), text);
  assert.ok(text.includes('12 s limit'), text);
  assert.ok(text.includes('2.24 m'), text);
});

test('program ended with no cause events: finished short of the goal, with the distance', () => {
  const ev = { type: 'program_ended', t: 2, distance_to_goal: 0.6211 };
  const r = explain({ result: fail('program_ended'), events: [ev], state: {} });
  assert.strictEqual(r.causes.length, 1);
  assert.strictEqual(r.causes[0].text, 'The program finished 0.62 m short of the goal.');
  assert.strictEqual(r.causes[0].root, true);
});

test('several causes: earliest first, and only the first is marked as root', () => {
  const events = [
    { type: 'battery_flat', t: 7.1, charge_used: 3 },
    { type: 'collision', t: 3.7, speed: 0.6 },
    { type: 'stall', t: 4.2, duration: 2.9, current: 0.8 },
    { type: 'slip', t: 1.0, peak: 3, limit: 2.45, mu: 0.25 }
  ];
  const r = explain({ result: fail('battery_flat'), events, state: {} });
  assert.deepStrictEqual(r.causes.map((c) => c.type), ['slip', 'stall', 'battery_flat']);
  assert.deepStrictEqual(r.causes.map((c) => c.root), [true, false, false]);
  assert.strictEqual(r.title, 'Wheels slipped');
  assert.ok(r.summary.includes('Likely root cause'));
  assert.ok(r.summary.includes('1.0 s'));
});

test('pass: shows PASS with the time and the battery left', () => {
  const r = explain({ result: { status: 'pass', reason: 'goal' }, events: [{ type: 'goal', t: 5.87 }], state: { t: 5.87, soc: 0.8412 } });
  assert.strictEqual(r.verdict, 'PASS');
  assert.deepStrictEqual(r.causes, []);
  assert.strictEqual(r.summary, 'Reached the goal in 5.9 s with 84% battery left.');
});

test('numbers in the text are exactly the event fields, formatted', () => {
  const sim = runToEnd(getLevel(1), parse('forward 400').program);
  const r = explain({ result: sim.result, events: sim.events, state: sim.state });
  const stall = sim.events.find((e) => e.type === 'stall');
  const flat = sim.events.find((e) => e.type === 'battery_flat');
  const stallCause = r.causes.find((c) => c.type === 'stall');
  const flatCause = r.causes.find((c) => c.type === 'battery_flat');
  assert.ok(stallCause.text.includes(fmt(stall.duration, 1) + ' s'), stallCause.text);
  assert.ok(stallCause.text.includes(fmt(stall.current, 2) + ' A'), stallCause.text);
  assert.ok(flatCause.text.includes(fmt(flat.t, 1) + ' s'), flatCause.text);
  assert.ok(flatCause.text.includes(fmt(flat.charge_used, 2) + ' C'), flatCause.text);
});

test('real runs: driving into a wall blames the stall first', () => {
  const r = play(1, 'forward 400');
  assert.strictEqual(r.verdict, 'FAIL');
  assert.deepStrictEqual(r.causes.map((c) => c.type), ['stall', 'battery_flat']);
  assert.strictEqual(r.causes[0].root, true);
});

test('real runs: waiting times out, stopping short is explained, and references pass', () => {
  assert.deepStrictEqual(play(1, 'wait 30').causes.map((c) => c.type), ['timeout']);
  assert.deepStrictEqual(play(1, 'forward 50').causes.map((c) => c.type), ['program_ended']);
  for (const def of LEVELS) assert.strictEqual(play(def.id, def.reference).verdict, 'PASS', 'level ' + def.id);
});

test('a run still in progress is not explained as a failure', () => {
  const r = explain({ result: { status: 'running', reason: null }, events: [], state: {} });
  assert.strictEqual(r.verdict, 'RUNNING');
  assert.deepStrictEqual(r.causes, []);
});

test('property: explain never throws on random event logs and always returns a valid shape', () => {
  const types = ['stall', 'battery_flat', 'slip', 'timeout', 'program_ended', 'goal', 'collision', 'bogus', '', null, 5];
  const values = [0, 1.5, -3, NaN, Infinity, null, undefined, 'x', {}, [], 1e300];
  forAll(90000, 1000, (rng) => {
    const events = [];
    const n = rng.int(0, 20);
    for (let i = 0; i < n; i++) {
      if (rng.bool(0.1)) { events.push(rng.pick([null, 3, 'text', [], undefined])); continue; }
      const e = { type: rng.pick(types) };
      for (const k of ['t', 'duration', 'current', 'charge_used', 'peak', 'limit', 'mu', 'distance_to_goal']) {
        if (rng.bool(0.7)) e[k] = rng.bool(0.6) ? rng.next() * 20 : rng.pick(values);
      }
      events.push(e);
    }
    const snapshot = rng.bool(0.05) ? rng.pick([null, undefined, 7, 'x']) : {
      result: rng.pick([{ status: 'fail', reason: 'timeout' }, { status: 'pass' }, { status: 'running' }, null, {}]),
      events: rng.bool(0.95) ? events : randomString(rng, 20),
      state: rng.pick([{}, null, { t: rng.next() * 30, soc: rng.next() }, { t: NaN, soc: 'x' }])
    };
    const r = explain(snapshot);
    assert.ok(['PASS', 'FAIL', 'RUNNING'].includes(r.verdict));
    assert.strictEqual(typeof r.title, 'string');
    assert.strictEqual(typeof r.summary, 'string');
    assert.ok(Array.isArray(r.causes));
    assert.ok(r.causes.filter((c) => c.root).length <= 1);
    for (let i = 1; i < r.causes.length; i++) assert.ok(r.causes[i].t >= r.causes[i - 1].t, 'earliest first');
    for (const c of r.causes) {
      assert.strictEqual(typeof c.text, 'string');
      assert.ok(!/NaN|Infinity|undefined/.test(c.text), 'no broken numbers: ' + c.text);
    }
  });
});

test('fmt rounds half up on the decimal value, not the binary one', () => {
  assert.strictEqual(fmt(7.05, 1), '7.1');
  assert.strictEqual(fmt(2.875, 2), '2.88');
  assert.strictEqual(fmt(1.005, 2), '1.01');
  assert.strictEqual(fmt(-1.005, 2), '-1.01');
  assert.strictEqual(fmt(-0.01, 1), '0.0');
  assert.strictEqual(fmt(NaN, 2), '0.00');
  assert.strictEqual(fmt(12, 0), '12');
});
