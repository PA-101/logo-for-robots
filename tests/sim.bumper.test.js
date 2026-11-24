'use strict';
// Task 22: simulation tests for drive power and the bumper.
const test = require('node:test');
const assert = require('node:assert');
const { createSim, runToEnd, C } = require('../sim.js');
const { getLevel, LEVELS } = require('../levels.js');
const { parse } = require('../lang.js');
const { forAll } = require('./helpers');

const FAR = { x: 100, y: 100, w: 1, h: 1 };
const open = (extra) => Object.assign({ walls: [], slick: [], goal: FAR, start: { x: 0, y: 0, theta: 0 }, capacity: 50, timeLimit: 120 }, extra || {});
const wallAt = (x) => ({ x, y: -2, w: 1, h: 4 });
const run = (level, text) => {
  const p = parse(text);
  assert.ok(p.ok, JSON.stringify(p.errors));
  return runToEnd(level, p.program);
};
const count = (sim, type) => sim.events.filter((e) => e.type === type).length;

// ---- power ---------------------------------------------------------------------

test('required: on a slick floor the robot slips at power 100 but not at power 50', () => {
  const slick = open({ mu: 0.25 });
  const full = run(slick, 'forward 100');
  const half = run(slick, 'power 50\nforward 100');
  assert.ok(count(full, 'slip') > 0, 'power 100 should slip');
  const peak = Math.max(...full.events.filter((e) => e.type === 'slip').map((e) => e.peak));
  assert.ok(peak > 0.25 * C.N_WHEEL, 'peak ' + peak + ' N is above the 2.45 N grip limit');
  assert.strictEqual(count(half, 'slip'), 0, 'power 50 should not slip');
  assert.ok(Math.abs(half.state.x - 1) < 0.015, 'power 50 still drives 100 cm: ' + half.state.x);
});

test('power scales every drive duty and leaves braking at zero', () => {
  const sim = createSim(open(), parse('power 40\nforward 100\nleft 90').program);
  const duties = new Set();
  while (sim.result.status === 'running') {
    sim.step();
    if (sim.state.uL !== 0) duties.add(Math.abs(sim.state.uL).toFixed(6));
  }
  assert.deepStrictEqual([...duties].sort(), [(C.TURN_SLOW_DUTY * 0.4).toFixed(6), (C.TURN_DUTY * 0.4).toFixed(6), (C.CRUISE_DUTY * 0.4).toFixed(6)].sort());
});

test('moves and turns stay accurate at every power', () => {
  for (const p of [10, 30, 50, 70, 100]) {
    const mv = run(open(), 'power ' + p + '\nforward 100');
    assert.ok(Math.abs(mv.state.x - 1) < 0.015, 'power ' + p + ' forward 100 ends at ' + mv.state.x);
    const tn = run(open(), 'power ' + p + '\nleft 90');
    assert.ok(Math.abs(tn.state.theta * 180 / Math.PI - 90) < 3, 'power ' + p + ' left 90 ends at ' + tn.state.theta * 180 / Math.PI);
  }
});

test('lower power is slower', () => {
  const t = [100, 50, 20].map((p) => run(open(), 'power ' + p + '\nforward 100').state.t);
  assert.ok(t[0] < t[1] && t[1] < t[2], JSON.stringify(t));
});

test('a stall is detected at power 20, where the duty is below the old 0.2 threshold', () => {
  const sim = run(open({ walls: [wallAt(0.6)], timeLimit: 15 }), 'power 20\nforward 200');
  assert.ok(C.CRUISE_DUTY * 0.2 < 0.2, 'the duty at power 20 is below the old fixed threshold');
  const stall = sim.events.find((e) => e.type === 'stall');
  assert.ok(stall, 'stall event at power 20');
  assert.ok(Math.abs(stall.duty - C.CRUISE_DUTY * 0.2) < 1e-12);
});

test('power takes no simulation time', () => {
  const a = run(open(), 'forward 50');
  const b = run(open(), 'power 100\npower 100\nforward 50\npower 100');
  assert.strictEqual(b.state.t, a.state.t);
});

test('power 100 runs exactly like a program with no power command', () => {
  const programs = LEVELS.map((d) => [d.id, d.reference]).concat([[1, 'forward 400'], [3, 'forward 200\nright 90\nforward 150\nleft 90\nforward 200']]);
  for (const [id, text] of programs) {
    const a = run(getLevel(id), text), b = run(getLevel(id), 'power 100\n' + text);
    assert.strictEqual(JSON.stringify(b.events), JSON.stringify(a.events), text);
    assert.strictEqual(JSON.stringify(b.state), JSON.stringify(a.state), text);
  }
});

// ---- bumper ----------------------------------------------------------------------

test('until-bump stops with the centre 0.10 m from the wall ahead, without a stall', () => {
  for (const p of [100, 50, 20]) {
    const sim = run(open({ walls: [wallAt(1.2)] }), 'power ' + p + '\nuntil-bump');
    assert.ok(Math.abs(sim.state.x - (1.2 - C.BODY_R)) <= 0.01, 'power ' + p + ': x = ' + sim.state.x);
    assert.strictEqual(count(sim, 'stall'), 0);
    assert.strictEqual(count(sim, 'bump_timeout'), 0);
    assert.strictEqual(sim.result.reason, 'program_ended');
  }
});

test('until-bump ends at once when the bumper is already pressed', () => {
  const level = open({ walls: [wallAt(0.6)] });
  const first = run(level, 'until-bump');
  const t0 = first.state.t;
  // Drive to the wall, then a second until-bump should take almost no time.
  const twice = run(level, 'until-bump\nforward 0\nuntil-bump');
  assert.ok(twice.state.t - t0 < 0.1, 'second until-bump took ' + (twice.state.t - t0) + ' s');
});

test('until-bump in open space times out after 15 s, records bump_timeout and moves on', () => {
  const sim = run(open({ timeLimit: 40 }), 'until-bump\nleft 90');
  const ev = sim.events.find((e) => e.type === 'bump_timeout');
  assert.ok(ev, 'bump_timeout event');
  assert.strictEqual(ev.line, 1);
  assert.ok(Math.abs(ev.elapsed - C.UNTIL_BUMP_TIMEOUT) <= C.DT + 1e-9, String(ev.elapsed));
  assert.ok(Math.abs(sim.state.theta * 180 / Math.PI - 90) < 3, 'the next command ran');
});

test('until-bump always ends within 17 s, even on a floor that barely brakes', () => {
  // Friction 0.01 makes braking slow, so the 2 s settle cap is what ends the command.
  const sim = createSim(open({ mu: 0.01, timeLimit: 60 }), parse('until-bump\nback 10').program);
  let ended = null;
  while (sim.result.status === 'running' && ended === null) {
    sim.step();
    const a = sim.active();
    if (a && a.kind === 'move') ended = sim.state.t;
  }
  assert.ok(ended !== null, 'the next command started');
  assert.ok(ended <= C.UNTIL_BUMP_TIMEOUT + C.UNTIL_BUMP_SETTLE_MAX + 2 * C.DT, 'until-bump lasted ' + ended + ' s');
  assert.ok(ended > C.UNTIL_BUMP_TIMEOUT + 1, 'it did brake for a while first: ' + ended);
});

test('a wall along the side does not press the bumper', () => {
  // Wall just above the path and a wall ahead at x = 1.5. The robot heads 10 degrees into the
  // side wall, so it keeps rubbing it; that contact is 80 degrees off its heading, outside the
  // bumper's 60 degree cone.
  const level = open({ walls: [{ x: -1, y: C.BODY_R + 0.02, w: 5, h: 1 }, wallAt(1.5)], start: { x: 0, y: 0, theta: 10 * Math.PI / 180 } });
  const sim = createSim(level, parse('until-bump').program);
  let sideOnly = 0;
  for (let i = 0; i < 400 && sim.result.status === 'running'; i++) {
    sim.step();
    if (sim.state.contact && sim.state.x < 1.2) {
      sideOnly++;
      assert.strictEqual(sim.state.bumper, false, 'bumper pressed by the side wall at x = ' + sim.state.x);
    }
  }
  assert.ok(sideOnly > 10, 'the robot did rub the side wall');
  assert.ok(Math.abs(sim.state.x - (1.5 - C.BODY_R)) < 0.02, 'it stopped at the wall ahead: ' + sim.state.x);
});

test('if bumped is true once after a contact, then false', () => {
  const sim = run(open({ walls: [wallAt(1.0)] }), 'until-bump\nif bumped [ back 50 ]\nif bumped [ left 90 ]');
  assert.ok(Math.abs(sim.state.x - (1.0 - C.BODY_R - 0.5)) < 0.02, 'backed off once: ' + sim.state.x);
  assert.ok(Math.abs(sim.state.theta) < 0.01, 'second check was false');
  const none = run(open(), 'forward 20\nif bumped [ left 90 ]');
  assert.ok(Math.abs(none.state.theta) < 1e-9, 'no contact, no turn');
});

test('forward, back, left and right ignore the bumper', () => {
  const sim = run(open({ walls: [wallAt(1.0)], timeLimit: 8 }), 'forward 200');
  assert.ok(count(sim, 'stall') === 1, 'forward still pushes and stalls');
});

// ---- properties ----------------------------------------------------------------

function genCommands(rng, depth) {
  const out = [];
  const n = rng.int(1, depth === 0 ? 6 : 3);
  for (let i = 0; i < n; i++) {
    const k = rng.int(0, depth >= 2 ? 6 : 8);
    if (k === 0) out.push('power ' + rng.pick([10, 20, 40, 60, 80, 100]));
    else if (k === 1) out.push('until-bump');
    else if (k === 2) out.push(rng.pick(['forward ', 'back ']) + rng.pick([10, 50, 100, 200, 400]));
    else if (k === 3) out.push(rng.pick(['left ', 'right ']) + rng.pick([15, 45, 90, 180]));
    else if (k === 4) out.push('wait ' + rng.pick([0, 0.5, 1]));
    else if (k === 5) out.push('if bumped [ ' + rng.pick(['back 20', 'left 90', 'power 50']) + ' ]');
    else if (k === 6) out.push('if wall-ahead [ ' + rng.pick(['right 90', 'until-bump']) + ' ]');
    else if (k === 7) out.push('repeat ' + rng.int(1, 3) + ' [\n' + genCommands(rng, depth + 1).join('\n') + '\n]');
    else out.push('if bumped [\n' + genCommands(rng, depth + 1).join('\n') + '\n]');
  }
  return out;
}
function randomProgram(rng) {
  for (;;) {
    const text = genCommands(rng, 0).join('\n');
    const p = parse(text);
    if (p.ok) return { text, program: p.program };
  }
}
function randomLevel(rng) {
  const level = getLevel(rng.int(1, 3));
  if (rng.bool(0.25)) level.capacity = rng.pick([0.05, 0.3]);
  if (rng.bool(0.3)) level.mu = rng.pick([0.1, 0.25]);
  return level;
}
const KEYS = ['t', 'x', 'y', 'theta', 'v', 'w', 'wL', 'wR', 'uL', 'uR', 'charge', 'soc', 'Voc', 'Vt', 'current', 'draw', 'sensor', 'stallTime', 'power'];

test('property: invariants hold for random programs with power and bumper commands', () => {
  let bumps = 0, timeouts = 0;
  forAll(440000, 120, (rng) => {
    const level = randomLevel(rng);
    const { text, program } = randomProgram(rng);
    const sim = createSim(level, program);
    let prevCharge = sim.state.charge, bumpStart = null, bumpOwn = 0;
    const limit = Math.ceil(level.timeLimit / C.DT) + 120;
    for (let i = 0; i < limit && sim.result.status === 'running'; i++) {
      sim.step();
      const st = sim.state, at = JSON.stringify(text) + ' step ' + i + ': ';
      assert.ok(st.charge <= prevCharge + 1e-9 && st.charge >= 0, at + 'charge');
      prevCharge = st.charge;
      assert.ok(Math.abs(st.v) <= C.V_NL + 1e-9, at + 'speed ' + st.v);
      assert.ok(st.power >= 0.1 && st.power <= 1, at + 'power ' + st.power);
      for (const k of KEYS) assert.ok(Number.isFinite(st[k]), at + k + ' = ' + st[k]);
      for (const w of level.walls) {
        const inside = st.x > w.x + 1e-9 && st.x < w.x + w.w - 1e-9 && st.y > w.y + 1e-9 && st.y < w.y + w.h - 1e-9;
        assert.ok(!inside, at + 'centre inside a wall');
      }
      // Hard limit: every until-bump ends within 17 s. Back-to-back until-bump commands are told
      // apart by their own clock (elapsed + brakeTime), which restarts at each new command.
      const a = sim.active();
      if (a && a.kind === 'bump') {
        const own = a.elapsed + a.brakeTime;
        if (bumpStart === null || own < bumpOwn) { bumpStart = st.t - own; bumps++; }
        bumpOwn = own;
        assert.ok(st.t - bumpStart <= C.UNTIL_BUMP_TIMEOUT + C.UNTIL_BUMP_SETTLE_MAX + 2 * C.DT, at + 'until-bump running for ' + (st.t - bumpStart) + ' s');
      } else bumpStart = null;
    }
    assert.notStrictEqual(sim.result.status, 'running', 'run ended');
    timeouts += count(sim, 'bump_timeout');
  });
  assert.ok(bumps > 50, 'until-bump ran in ' + bumps + ' places');
});

test('property: runs with power and bumper commands are deterministic', () => {
  forAll(450000, 60, (rng) => {
    const id = rng.int(1, 3);
    const { text } = randomProgram(rng);
    const a = runToEnd(getLevel(id), parse(text).program), b = runToEnd(getLevel(id), parse(text).program);
    assert.strictEqual(JSON.stringify(a.state), JSON.stringify(b.state));
    assert.strictEqual(JSON.stringify(a.events), JSON.stringify(b.events));
  });
});
