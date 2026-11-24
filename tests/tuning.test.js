'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { LEVELS, getLevel } = require('../levels.js');
const { runToEnd, C } = require('../sim.js');
const { parse } = require('../lang.js');

function play(id, text) {
  const level = getLevel(id);
  const parsed = parse(text);
  assert.ok(parsed.ok, JSON.stringify(parsed.errors));
  return { level, sim: runToEnd(level, parsed.program) };
}

const types = (sim) => sim.events.map((e) => e.type);

test('each reference program passes with at least 25 percent margin in time and charge', () => {
  for (const def of LEVELS) {
    const { level, sim } = play(def.id, def.reference);
    assert.strictEqual(sim.result.status, 'pass', 'level ' + def.id);
    const timeUsed = sim.state.t / level.timeLimit;
    const chargeUsed = (level.capacity - sim.state.charge) / level.capacity;
    assert.ok(timeUsed <= 0.75, 'level ' + def.id + ' used ' + (timeUsed * 100).toFixed(0) + '% of the time limit');
    assert.ok(chargeUsed <= 0.75, 'level ' + def.id + ' used ' + (chargeUsed * 100).toFixed(0) + '% of the battery');
  }
});

test('reference programs are not trivial: they use a meaningful part of the budget', () => {
  for (const def of LEVELS) {
    const { level, sim } = play(def.id, def.reference);
    assert.ok(sim.state.t / level.timeLimit > 0.3, 'level ' + def.id + ' time budget is not too loose');
    assert.ok((level.capacity - sim.state.charge) / level.capacity > 0.1, 'level ' + def.id + ' battery budget is not too loose');
  }
});

test('level 1 reference has no slip; the level 3 reference slips on the slick floor', () => {
  assert.ok(!types(play(1, LEVELS[0].reference).sim).includes('slip'));
  assert.ok(!types(play(2, LEVELS[1].reference).sim).includes('slip'));
  const l3 = play(3, LEVELS[2].reference).sim;
  assert.ok(types(l3).includes('slip'));
  assert.ok(l3.events.filter((e) => e.type === 'slip').every((e) => e.mu === 0.25));
});

test('driving into a wall: collision, then stall, then the battery runs flat', () => {
  for (const id of [1, 2]) {
    const { sim } = play(id, 'forward 400');
    assert.deepStrictEqual(sim.result, { status: 'fail', reason: 'battery_flat' }, 'level ' + id);
    const t = types(sim);
    assert.deepStrictEqual(t, ['collision', 'stall', 'battery_flat'], 'level ' + id);
    const stall = sim.events[1];
    assert.ok(stall.duration >= 0.5);
    // Both motors stalled: current is 2 * duty * Vt / R, and it falls as the battery sags and drains.
    assert.ok(stall.current > 0.5 && stall.current < 1.0, 'stall current ' + stall.current);
    assert.ok(Math.abs(stall.current - 2 * 0.8 * sim.state.Vt / C.MOTOR_R) < 0.02);
  }
});

test('level 3: overshooting the slick corner into a wall fails with a stall', () => {
  const { sim } = play(3, 'forward 200\nright 90\nforward 150\nleft 90\nforward 200');
  assert.strictEqual(sim.result.status, 'fail');
  assert.ok(types(sim).includes('stall'));
  assert.ok(types(sim).includes('collision'));
});

test('stopping short ends with program_ended and the distance left', () => {
  const { sim } = play(3, 'forward 200\nright 90\nforward 100\nleft 90\nforward 100');
  assert.deepStrictEqual(sim.result, { status: 'fail', reason: 'program_ended' });
  const ev = sim.events.find((e) => e.type === 'program_ended');
  assert.ok(ev.distance_to_goal > 0.8 && ev.distance_to_goal < 1.2, String(ev.distance_to_goal));
});

test('waiting too long ends with a timeout', () => {
  const { sim } = play(1, 'wait 30');
  assert.deepStrictEqual(sim.result, { status: 'fail', reason: 'timeout' });
  assert.deepStrictEqual(types(sim), ['timeout']);
});

test('spinning forever times out without any other cause', () => {
  const { sim } = play(2, 'repeat 100 [ left 90 ]');
  assert.strictEqual(sim.result.reason, 'timeout');
  assert.deepStrictEqual(types(sim), ['timeout']);
});

test('turn accuracy stays within 3 degrees for common angles', () => {
  const open = { walls: [], slick: [], goal: { x: 99, y: 99, w: 1, h: 1 }, start: { x: 0, y: 0, theta: 0 }, capacity: 10, timeLimit: 60 };
  for (const angle of [10, 20, 30, 45, 60, 90, 135, 180, 270]) {
    const sim = runToEnd(open, parse('left ' + angle).program);
    const err = Math.abs(sim.state.theta * 180 / Math.PI - angle);
    assert.ok(err < 3, 'left ' + angle + ' off by ' + err.toFixed(1) + ' degrees');
  }
});

test('move accuracy stays within 1.5 cm', () => {
  const open = { walls: [], slick: [], goal: { x: 99, y: 99, w: 1, h: 1 }, start: { x: 0, y: 0, theta: 0 }, capacity: 10, timeLimit: 60 };
  for (const cm of [5, 10, 25, 50, 100, 200, 300]) {
    const sim = runToEnd(open, parse('forward ' + cm).program);
    assert.ok(Math.abs(sim.state.x * 100 - cm) < 1.5, 'forward ' + cm + ' gave ' + (sim.state.x * 100).toFixed(2));
  }
});

test('the robot takes a fraction of a second to reach cruise speed, not zero', () => {
  const open = { walls: [], slick: [], goal: { x: 99, y: 99, w: 1, h: 1 }, start: { x: 0, y: 0, theta: 0 }, capacity: 10, timeLimit: 60 };
  const { createSim } = require('../sim.js');
  const sim = createSim(open, null, { duties: () => [C.CRUISE_DUTY, C.CRUISE_DUTY] });
  for (let i = 0; i < 600; i++) sim.step();
  const steady = sim.state.v;
  assert.ok(steady < C.V_NL && steady > 0.5 * C.V_NL, 'steady speed ' + steady);
  const sim2 = createSim(open, null, { duties: () => [C.CRUISE_DUTY, C.CRUISE_DUTY] });
  let t90 = -1;
  for (let i = 0; i < 600 && t90 < 0; i++) {
    sim2.step();
    if (sim2.state.v >= 0.9 * steady) t90 = sim2.state.t;
  }
  assert.ok(t90 > 0.25 && t90 < 0.8, 'time to 90% of cruise speed: ' + t90);
});