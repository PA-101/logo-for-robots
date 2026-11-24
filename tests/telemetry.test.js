'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTelemetry, plotBounds, niceCeil, SAMPLE_EVERY, DEFAULT_MAX } = require('../telemetry.js');
const { createSim, C } = require('../sim.js');
const { getLevel } = require('../levels.js');
const { parse } = require('../lang.js');
const { forAll } = require('./helpers');

function recordRun(tel, sim, steps) {
  tel.record(sim.state, 0);
  for (let i = 1; i <= steps && sim.result.status === 'running'; i++) {
    sim.step();
    tel.record(sim.state, i);
  }
}

test('samples at 10 Hz: every 6 steps, step 0 included', () => {
  assert.strictEqual(SAMPLE_EVERY, 6);
  assert.strictEqual(C.SAMPLE_EVERY, SAMPLE_EVERY);
  const tel = createTelemetry();
  const state = { t: 0, v: 0, current: 0, soc: 1 };
  let added = 0;
  for (let i = 0; i < 60; i++) if (tel.record(state, i)) added++;
  assert.strictEqual(added, 10);
  assert.strictEqual(tel.samples.length, 10);
});

test('sample count after N steps of a real run is floor(N / 6) + 1', () => {
  for (const n of [0, 1, 5, 6, 7, 59, 60, 61, 300]) {
    const tel = createTelemetry();
    const sim = createSim(getLevel(1), parse('wait 10').program); // runs 600 steps, longer than any n
    recordRun(tel, sim, n);
    assert.strictEqual(tel.samples.length, Math.floor(n / 6) + 1, 'after ' + n + ' steps');
  }
});

test('a sample holds speed, total motor current and battery level from the state', () => {
  const tel = createTelemetry();
  tel.record({ t: 1.5, v: -0.4, current: 0.7, soc: 0.25, slipL: true, stallTime: 0.6 }, 0);
  assert.deepStrictEqual(tel.samples[0], { t: 1.5, speed: 0.4, current: 0.7, charge: 0.25, slip: true, stall: true });
  tel.record({ t: 2, v: 0.1, current: 0.1, soc: 0.2, stallTime: 0.1 }, 6);
  assert.strictEqual(tel.samples[1].slip, false);
  assert.strictEqual(tel.samples[1].stall, false);
});

test('battery level sample follows the simulated state of charge', () => {
  const tel = createTelemetry();
  const sim = createSim(getLevel(1), parse('forward 400').program);
  recordRun(tel, sim, 2000);
  const first = tel.samples[0], last = tel.samples[tel.samples.length - 1];
  assert.strictEqual(first.charge, 1);
  assert.ok(last.charge < 0.1, 'battery nearly flat at the end: ' + last.charge);
  assert.ok(tel.samples.some((s) => s.stall), 'stall shows up in the samples');
});

test('keeps at most 1200 samples and drops the oldest first', () => {
  assert.strictEqual(DEFAULT_MAX, 1200);
  const tel = createTelemetry();
  for (let i = 0; i < 1500; i++) tel.record({ t: i, v: 0, current: 0, soc: 1 }, i * 6);
  assert.strictEqual(tel.samples.length, 1200);
  assert.strictEqual(tel.samples[0].t, 300);
  assert.strictEqual(tel.samples[1199].t, 1499);
});

test('clear empties the samples', () => {
  const tel = createTelemetry();
  tel.record({ t: 0, v: 1, current: 1, soc: 1 }, 0);
  tel.clear();
  assert.strictEqual(tel.samples.length, 0);
});

test('bad input is ignored or cleaned, never thrown on', () => {
  const tel = createTelemetry();
  assert.strictEqual(tel.record(null, 0), false);
  assert.strictEqual(tel.record({}, -6), false);
  assert.strictEqual(tel.record({}, NaN), false);
  assert.strictEqual(tel.record({ t: NaN, v: Infinity, current: 'x', soc: 7 }, 0), true);
  assert.deepStrictEqual(tel.samples[0], { t: 0, speed: 0, current: 0, charge: 1, slip: false, stall: false });
});

test('niceCeil rounds up to 1, 2 or 5 times a power of ten', () => {
  assert.strictEqual(niceCeil(0.3, 1), 1);
  assert.strictEqual(niceCeil(1.3, 1), 2);
  assert.strictEqual(niceCeil(3, 1), 5);
  assert.strictEqual(niceCeil(7, 1), 10);
  assert.strictEqual(niceCeil(12, 10), 20);
  assert.strictEqual(niceCeil(0.04, 0.01), 0.05);
});

test('plotBounds gives stable minimum axes for an empty or quiet run', () => {
  assert.deepStrictEqual(plotBounds([]), { tMin: 0, tMax: 10, speedMax: 1, currentMax: 1 });
  assert.deepStrictEqual(plotBounds(null), { tMin: 0, tMax: 10, speedMax: 1, currentMax: 1 });
});

test('property: the 1200-sample limit holds for random run lengths and limits', () => {
  forAll(70000, 200, (rng) => {
    const max = rng.bool(0.5) ? DEFAULT_MAX : rng.int(1, 300);
    const tel = createTelemetry(max === DEFAULT_MAX ? undefined : max);
    const n = rng.int(0, 3 * max * SAMPLE_EVERY);
    for (let i = 0; i < n; i++) tel.record({ t: i / 60, v: 0.1, current: 0.2, soc: 0.5 }, i);
    const expected = Math.min(max, n === 0 ? 0 : Math.floor((n - 1) / SAMPLE_EVERY) + 1);
    assert.strictEqual(tel.samples.length, expected);
    for (let k = 1; k < tel.samples.length; k++) assert.ok(tel.samples[k].t > tel.samples[k - 1].t, 'oldest first');
  });
});

test('property: plot bounds always cover the data', () => {
  forAll(80000, 400, (rng) => {
    const samples = [];
    let t = rng.next() * 100;
    const n = rng.int(0, 200);
    for (let i = 0; i < n; i++) {
      t += rng.next();
      samples.push({ t, speed: rng.next() * rng.pick([0.1, 1, 10]), current: rng.next() * rng.pick([0.1, 1, 20]), charge: rng.next() });
    }
    const b = plotBounds(samples);
    for (const s of samples) {
      assert.ok(s.t >= b.tMin && s.t <= b.tMax, 't inside bounds');
      assert.ok(s.speed <= b.speedMax, 'speed ' + s.speed + ' <= ' + b.speedMax);
      assert.ok(s.current <= b.currentMax, 'current ' + s.current + ' <= ' + b.currentMax);
    }
    assert.ok(b.tMax > b.tMin && b.speedMax > 0 && b.currentMax > 0);
  });
});
