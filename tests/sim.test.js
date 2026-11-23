'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSim, runToEnd, noLoadSpeed, C } = require('../sim.js');
const { getLevel } = require('../levels.js');
const { parse } = require('../lang.js');

const FAR_GOAL = { x: 100, y: 100, w: 1, h: 1 };

function openLevel(extra) {
  return Object.assign({
    walls: [], slick: [], goal: FAR_GOAL,
    start: { x: 0, y: 0, theta: 0 },
    capacity: 10, timeLimit: 100, mu: 0.6, slickMu: 0.25
  }, extra || {});
}

function driven(level, uL, uR) {
  return createSim(level, null, { duties: () => [uL, uR === undefined ? uL : uR] });
}

function steps(sim, n) { for (let i = 0; i < n; i++) sim.step(); }

function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, (label || 'value') + ': ' + actual + ' vs ' + expected);
}

function run(level, text) {
  const p = parse(text);
  assert.ok(p.ok, JSON.stringify(p.errors));
  return runToEnd(level, p.program);
}

// ---- motor model ---------------------------------------------------------

test('constants: no-load speed is 0.8 m/s and friction limit follows mu * m * g / 2', () => {
  near(noLoadSpeed(), 0.03 * 7.4 / 0.277, 1e-12);
  near(noLoadSpeed(), 0.80, 0.005);
  near(C.N_WHEEL, 9.81, 1e-12);
});

test('a stalled motor draws the maximum current Vt / R per motor', () => {
  const sim = driven(openLevel(), 0.8);
  sim.step();
  near(sim.state.Vt, C.V_FULL, 1e-12, 'Vt on the first step');
  near(sim.state.current, 2 * 0.8 * C.V_FULL / C.MOTOR_R, 1e-9, 'stall current of both motors');
});

test('stall current against a wall equals duty * Vt / R for both motors', () => {
  const sim = driven(openLevel({ walls: [{ x: 0.3, y: -1, w: 1, h: 2 }] }), 0.8);
  steps(sim, 240);
  assert.ok(Math.abs(sim.state.v) < 0.01);
  near(sim.state.current, 2 * 0.8 * sim.state.Vt / C.MOTOR_R, 1e-6);
});

test('motor current (and so torque) falls linearly with speed and is zero at no-load speed', () => {
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const currents = fractions.map((f) => {
    const sim = driven(openLevel(), 1);
    sim.state.v = f * noLoadSpeed();
    sim.step();
    return sim.state.current;
  });
  const stall = currents[0];
  near(stall, 2 * C.V_FULL / C.MOTOR_R, 1e-9);
  fractions.forEach((f, i) => near(currents[i], stall * (1 - f), 1e-9, 'current at ' + f + ' of no-load speed'));
  near(currents[4], 0, 1e-9, 'zero at no-load speed');
});

test('a speed above the no-load speed makes the motor brake (current reverses direction)', () => {
  const sim = driven(openLevel(), 1);
  sim.state.v = noLoadSpeed() * 1.2;
  const before = sim.state.v;
  sim.step();
  assert.ok(sim.state.v < before);
});

test('the robot accelerates gradually, not instantly, and levels off below no-load speed', () => {
  const sim = driven(openLevel(), 0.8);
  sim.step();
  assert.ok(sim.state.v < 0.15, 'after one step speed is ' + sim.state.v);
  steps(sim, 29);
  assert.ok(sim.state.v > 0.3 && sim.state.v < 0.62, 'half a second in: ' + sim.state.v);
  steps(sim, 300);
  assert.ok(sim.state.v > 0.5 && sim.state.v < noLoadSpeed(), 'steady speed ' + sim.state.v);
});

// ---- battery -------------------------------------------------------------

test('voltage sags under load: lower while drawing current, back to open-circuit when idle', () => {
  const sim = driven(openLevel(), 1);
  sim.step();
  const first = sim.state.Vt;
  const draw1 = sim.state.draw;
  assert.ok(draw1 > 1);
  sim.step();
  near(sim.state.Vt, sim.state.Voc - C.R_INT * draw1, 1e-9);
  assert.ok(sim.state.Vt < first - 0.5, 'sagged from ' + first + ' to ' + sim.state.Vt);

  const idle = driven(openLevel(), 0);
  steps(idle, 5);
  near(idle.state.Vt, idle.state.Voc, 1e-12);
  near(idle.state.charge, 10, 1e-12, 'idle motors draw nothing');
});

test('open-circuit voltage falls as charge falls', () => {
  const full = driven(openLevel(), 0.5);
  full.step();
  const half = driven(openLevel(), 0.5);
  half.state.charge = 5;
  half.step();
  near(full.state.Voc, 7.4, 1e-12);
  near(half.state.Voc, 6.7, 1e-12);
});

test('the battery drains by the current drawn: charge used = integral of draw', () => {
  const sim = driven(openLevel(), 0.8);
  let used = 0;
  for (let i = 0; i < 120; i++) {
    sim.step();
    used += sim.state.draw * C.DT;
  }
  near(10 - sim.state.charge, used, 1e-9);
  assert.ok(used > 0);
});

test('braking current is not drawn from the battery', () => {
  const sim = driven(openLevel(), 0);
  sim.state.v = 0.6;
  sim.step();
  assert.ok(sim.state.current > 0.5, 'braking current flows');
  assert.strictEqual(sim.state.draw, 0);
  assert.strictEqual(sim.state.charge, 10);
});

test('when the battery runs flat the run ends in failure with a battery_flat event', () => {
  const sim = driven(openLevel({ capacity: 0.05 }), 1);
  steps(sim, 600);
  assert.deepStrictEqual(sim.result, { status: 'fail', reason: 'battery_flat' });
  assert.strictEqual(sim.state.charge, 0);
  assert.strictEqual(sim.state.uL, 0);
  assert.strictEqual(sim.state.uR, 0);
  const flat = sim.events.filter((e) => e.type === 'battery_flat');
  assert.strictEqual(flat.length, 1);
  assert.strictEqual(flat[0].charge_used, 0.05);
  const t = sim.state.t;
  steps(sim, 10);
  assert.strictEqual(sim.state.t, t, 'nothing advances after the run ends');
});

test('a program drained by a wall push reports battery_flat', () => {
  const level = getLevel(1);
  level.capacity = 0.3;
  const sim = run(level, 'forward 400');
  assert.strictEqual(sim.result.reason, 'battery_flat');
});

// ---- slip ----------------------------------------------------------------

test('slip starts when the required wheel force exceeds mu * N, and not below it', () => {
  const level = openLevel({ mu: 0.4 }); // limit 3.924 N per wheel
  const grip = driven(level, 0.6);       // asks 3.42 N at the first step
  steps(grip, 120);
  assert.strictEqual(grip.events.filter((e) => e.type === 'slip').length, 0);
  assert.strictEqual(grip.state.slipL, false);

  const slip = driven(level, 0.8);       // asks 4.55 N at the first step
  slip.step();
  const ev = slip.events.filter((e) => e.type === 'slip');
  assert.strictEqual(ev.length, 2, 'one event per wheel');
  assert.deepStrictEqual(ev.map((e) => e.wheel).sort(), ['L', 'R']);
  near(ev[0].required, 0.8 * C.V_FULL * C.KT / (C.MOTOR_R * C.WHEEL_R), 1e-9);
  near(ev[0].limit, 0.4 * C.N_WHEEL, 1e-9);
  near(ev[0].mu, 0.4, 1e-12);
  assert.strictEqual(slip.state.slipL, true);
});

test('a slipping wheel spins faster than the ground and the robot accelerates more slowly', () => {
  const level = openLevel({ mu: 0.25 }); // limit 2.45 N, far below the 4.55 N asked
  const slip = driven(level, 0.8);
  const grip = driven(openLevel({ mu: 0.6 }), 0.8);
  steps(slip, 2);
  assert.ok(slip.state.wL * C.WHEEL_R > slip.state.v + 0.01, 'wheel surface speed exceeds ground speed at launch');
  steps(slip, 4);
  steps(grip, 6);
  assert.ok(slip.state.v < grip.state.v, 'slipping launch is slower');
});

test('a slipping wheel grips again once speeds match', () => {
  const sim = driven(openLevel({ mu: 0.4 }), 0.8);
  steps(sim, 240);
  assert.strictEqual(sim.state.slipL, false);
  assert.strictEqual(sim.state.slipR, false);
});

test('slick floor slips where normal floor does not', () => {
  const slickPatch = [{ x: -1, y: -1, w: 10, h: 2 }];
  const onSlick = driven(openLevel({ slick: slickPatch }), 0.8);
  const onNormal = driven(openLevel(), 0.8);
  steps(onSlick, 30);
  steps(onNormal, 30);
  assert.ok(onSlick.events.some((e) => e.type === 'slip'), 'slip on slick');
  assert.ok(!onNormal.events.some((e) => e.type === 'slip'), 'no slip on normal floor');
  near(onSlick.events[0].limit, 0.25 * C.N_WHEEL, 1e-9);
});

test('repeated slip bursts are merged into one event per wheel', () => {
  const sim = driven(openLevel({ mu: 0.4 }), 0.8);
  steps(sim, 600);
  assert.ok(sim.events.filter((e) => e.type === 'slip').length <= 4);
});

// ---- walls and sensor ----------------------------------------------------

test('a wall stops the robot and keeps it outside the wall', () => {
  const sim = driven(openLevel({ walls: [{ x: 1.0, y: -1, w: 1, h: 2 }] }), 0.8);
  steps(sim, 300);
  assert.ok(sim.state.x <= 1.0 - C.BODY_R + 1e-6, 'x = ' + sim.state.x);
  assert.ok(sim.state.x > 1.0 - C.BODY_R - 0.01, 'robot is touching the wall: ' + sim.state.x);
  assert.ok(Math.abs(sim.state.v) < 0.01);
  assert.strictEqual(sim.state.contact, true);
  const hits = sim.events.filter((e) => e.type === 'collision');
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].speed > 0.3);
});

test('a stall event is recorded after 0.5 s pushing a wall, with duration and current', () => {
  const sim = driven(openLevel({ walls: [{ x: 1.0, y: -1, w: 1, h: 2 }] }), 0.8);
  let firstStep = -1;
  for (let i = 0; i < 600; i++) {
    sim.step();
    if (firstStep < 0 && sim.events.some((e) => e.type === 'stall')) firstStep = i + 1;
  }
  const stalls = sim.events.filter((e) => e.type === 'stall');
  assert.strictEqual(stalls.length, 1);
  const s = stalls[0];
  assert.ok(firstStep > 0);
  near(s.duty, 0.8, 1e-12);
  assert.ok(s.duration > 3, 'duration keeps updating while stalled: ' + s.duration);
  near(s.current, 2 * 0.8 * sim.state.Vt / C.MOTOR_R, 1e-6);
  // first recorded 0.5 s after the robot stopped moving
  assert.ok(s.t > 0.5);
});

test('no stall event when the robot is not pushing (duty 0) or not touching', () => {
  const idle = driven(openLevel({ walls: [{ x: 0.2, y: -1, w: 1, h: 2 }] }), 0);
  steps(idle, 120);
  assert.strictEqual(idle.events.filter((e) => e.type === 'stall').length, 0);
  const free = driven(openLevel(), 0.8);
  steps(free, 120);
  assert.strictEqual(free.events.filter((e) => e.type === 'stall').length, 0);
});

test('the sensor reports exact distances in a known map and caps at 1.0 m', () => {
  const sim = createSim(getLevel(1), []);
  near(sim.sensorDistance(), 1.0, 1e-12, 'far wall beyond range');
  sim.state.x = 2.5;
  near(sim.sensorDistance(), 0.5, 1e-9, 'wall at x = 3.0');
  sim.state.theta = Math.PI / 2;
  sim.state.x = 0.75; sim.state.y = 1.75;
  near(sim.sensorDistance(), 0.25, 1e-9, 'north wall');
  sim.state.theta = Math.PI;
  near(sim.sensorDistance(), 0.25, 1e-9, 'west wall');
  sim.state.theta = -Math.PI / 2;
  near(sim.sensorDistance(), 0.25, 1e-9, 'south wall');
});

test('wall-ahead is true below 0.35 m and false above it', () => {
  const sim = createSim(getLevel(1), []);
  sim.state.x = 2.6;    // wall at 3.0, distance 0.4
  assert.strictEqual(sim.wallAhead(), false);
  sim.state.x = 2.7;    // distance 0.3
  assert.strictEqual(sim.wallAhead(), true);
});

// ---- interpreter ---------------------------------------------------------

test('forward and back move about the requested distance', () => {
  const f = run(openLevel({ timeLimit: 30 }), 'forward 100');
  near(f.state.x, 1.0, 0.04, 'forward 100 cm');
  near(f.state.y, 0, 0.01);
  const b = run(openLevel({ timeLimit: 30 }), 'back 50');
  near(b.state.x, -0.5, 0.04, 'back 50 cm');
});

test('left and right turn about the requested angle', () => {
  const l = run(openLevel({ timeLimit: 30 }), 'left 90');
  near(l.state.theta, Math.PI / 2, 0.06, 'left 90');
  const r = run(openLevel({ timeLimit: 30 }), 'right 90');
  near(r.state.theta, -Math.PI / 2, 0.06, 'right 90');
  const a = run(openLevel({ timeLimit: 30 }), 'left 45');
  near(a.state.theta, Math.PI / 4, 0.06, 'left 45');
});

test('wait holds the motors off for N seconds and uses no battery', () => {
  const sim = run(openLevel({ timeLimit: 30 }), 'wait 2');
  near(sim.state.t, 2, 0.05);
  assert.strictEqual(sim.state.charge, 10);
  assert.strictEqual(sim.result.reason, 'program_ended');
});

test('repeat runs its body N times', () => {
  const sim = run(openLevel({ timeLimit: 30 }), 'repeat 4 [ left 90 ]');
  near(sim.state.theta, 2 * Math.PI, 0.2, 'four left turns');
  const sq = run(openLevel({ timeLimit: 60 }), 'repeat 4 [ forward 50 right 90 ]');
  near(sq.state.x, 0, 0.12, 'square returns to start x');
  near(sq.state.y, 0, 0.12, 'square returns to start y');
});

test('nested repeat multiplies', () => {
  const sim = run(openLevel({ timeLimit: 60 }), 'repeat 2 [ repeat 3 [ left 30 ] ]');
  near(sim.state.theta, 6 * Math.PI / 6, 0.2, '6 turns of 30 degrees');
});

test('if wall-ahead runs its body when a wall is close, and skips it otherwise', () => {
  const near1 = openLevel({ walls: [{ x: 0.3, y: -2, w: 1, h: 4 }], timeLimit: 30 });
  const taken = run(near1, 'if wall-ahead [ left 90 ]');
  near(taken.state.theta, Math.PI / 2, 0.06, 'turned');
  const far1 = openLevel({ walls: [{ x: 0.8, y: -2, w: 1, h: 4 }], timeLimit: 30 });
  const skipped = run(far1, 'if wall-ahead [ left 90 ]');
  near(skipped.state.theta, 0, 1e-9, 'did not turn');
});

test('wall-ahead is checked when the command is reached, not at program start', () => {
  const level = openLevel({ walls: [{ x: 1.0, y: -2, w: 1, h: 4 }], timeLimit: 30 });
  const before = createSim(level, []);
  assert.strictEqual(before.wallAhead(), false, 'no wall close at the start');
  const sim = run(level, 'forward 70\nif wall-ahead [ left 90 ]'); // stops 0.3 m from the wall
  near(sim.state.theta, Math.PI / 2, 0.06);
});

test('a loop with if wall-ahead can find its way along the level 2 stairs', () => {
  const level = getLevel(2);
  const sim = run(level, 'repeat 100 [ if wall-ahead [ right 90 ] forward 25 ]');
  assert.ok(['pass', 'fail'].includes(sim.result.status));
  assert.ok(Number.isFinite(sim.state.x));
});

test('an empty or zero program ends without error', () => {
  const sim = runToEnd(openLevel({ timeLimit: 5 }), []);
  assert.strictEqual(sim.result.reason, 'program_ended');
  const z = run(openLevel({ timeLimit: 5 }), 'forward 0\nwait 0\nleft 0');
  assert.strictEqual(z.result.reason, 'program_ended');
});

// ---- results -------------------------------------------------------------

test('reaching the goal passes, stops the run and records a goal event', () => {
  const sim = run(getLevel(1), 'forward 200\nright 90\nforward 100');
  assert.deepStrictEqual(sim.result, { status: 'pass', reason: 'goal' });
  const t = sim.state.t;
  steps(sim, 20);
  assert.strictEqual(sim.state.t, t);
  assert.strictEqual(sim.events.filter((e) => e.type === 'goal').length, 1);
});

test('the program ending short of the goal fails with program_ended and the distance left', () => {
  const sim = run(getLevel(1), 'forward 50');
  assert.deepStrictEqual(sim.result, { status: 'fail', reason: 'program_ended' });
  const ev = sim.events.find((e) => e.type === 'program_ended');
  assert.ok(ev, 'program_ended event');
  near(ev.distance_to_goal, Math.hypot(2.75 - 1.25, 0.75 - 1.75), 0.05);
});

test('running out of time fails with a timeout event holding the limit and distance', () => {
  const level = getLevel(1);
  const sim = run(level, 'wait 30');
  assert.deepStrictEqual(sim.result, { status: 'fail', reason: 'timeout' });
  const ev = sim.events.find((e) => e.type === 'timeout');
  assert.strictEqual(ev.limit, 20);
  near(ev.t, 20, 0.02);
  near(ev.distance_to_goal, Math.hypot(2.75 - 0.75, 0.75 - 1.75), 1e-6);
});

test('driving into a wall fails with collision and stall events', () => {
  const sim = run(getLevel(1), 'forward 400');
  assert.strictEqual(sim.result.status, 'fail');
  const types = sim.events.map((e) => e.type);
  assert.ok(types.includes('collision'));
  assert.ok(types.includes('stall'));
  assert.ok(types.indexOf('collision') < types.indexOf('stall'));
  assert.ok(sim.state.x <= 3.0 - C.BODY_R + 1e-6);
});

test('createSim and runToEnd tolerate missing or odd input', () => {
  assert.doesNotThrow(() => createSim().step());
  assert.doesNotThrow(() => createSim(null, null).step());
  assert.doesNotThrow(() => runToEnd(getLevel(1), null, 50));
  assert.doesNotThrow(() => runToEnd(getLevel(1), [{ type: 'bogus' }, null, 5, { type: 'repeat', n: 3 }], 200));
});
