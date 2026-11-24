'use strict';
// Task 9: simulation property tests. Each property runs many random programs (or random
// motor duties) on the real levels and checks an invariant after every single step.
const test = require('node:test');
const assert = require('node:assert');
const { createSim, runToEnd, C } = require('../sim.js');
const { getLevel, LEVELS } = require('../levels.js');
const { parse } = require('../lang.js');
const { forAll } = require('./helpers');

const EPS = 1e-9;

// ---- random valid programs -------------------------------------------------
// Short distances and common angles so robots actually reach walls, corners and slick floor.
function genCommands(rng, depth) {
  const out = [];
  const n = rng.int(1, depth === 0 ? 7 : 3);
  for (let i = 0; i < n; i++) {
    const k = rng.int(0, depth >= 2 ? 5 : 7);
    if (k <= 1) out.push((k === 0 ? 'forward ' : 'back ') + rng.pick([5, 25, 50, 100, 150, 200, 300, 400, rng.int(0, 600)]));
    else if (k <= 3) out.push((k === 2 ? 'left ' : 'right ') + rng.pick([15, 45, 90, 90, 180, 360, rng.int(0, 720)]));
    else if (k === 4) out.push('wait ' + rng.pick([0, 0.5, 1, 2]));
    else if (k === 5) out.push('forward ' + rng.int(1, 60));
    else if (k === 6) out.push('repeat ' + rng.int(1, 4) + ' [\n' + genCommands(rng, depth + 1).join('\n') + '\n]');
    else out.push('if wall-ahead [\n' + genCommands(rng, depth + 1).join('\n') + '\n]');
  }
  return out;
}

function randomProgram(rng) {
  for (;;) {
    const text = genCommands(rng, 0).join('\n');
    const r = parse(text);
    if (r.ok) return { text, program: r.program };
  }
}

function randomLevel(rng) {
  const level = getLevel(rng.pick(LEVELS).id);
  // Sometimes shrink the battery so battery_flat paths are exercised too.
  if (rng.bool(0.25)) level.capacity = rng.pick([0.05, 0.2, 0.5]);
  // Sometimes make the whole floor slippery so programs exercise wheel slip, not just level 3's patch.
  if (rng.bool(0.25)) level.mu = rng.pick([0.2, 0.3, 0.4]);
  return level;
}

// ---- invariant checks ----------------------------------------------------------
const NUMERIC_KEYS = ['t', 'x', 'y', 'theta', 'v', 'w', 'wL', 'wR', 'uL', 'uR', 'charge', 'soc',
  'Voc', 'Vt', 'current', 'draw', 'sensor', 'stallTime'];

function insideRect(x, y, r) {
  return x > r.x + EPS && x < r.x + r.w - EPS && y > r.y + EPS && y < r.y + r.h - EPS;
}

// Largest distance the robot body overlaps any wall (0 when it is clear of every wall).
function maxPenetration(st, walls) {
  let worst = 0;
  for (const r of walls) {
    const px = Math.max(r.x, Math.min(st.x, r.x + r.w));
    const py = Math.max(r.y, Math.min(st.y, r.y + r.h));
    const d = Math.hypot(st.x - px, st.y - py);
    worst = Math.max(worst, C.BODY_R - d);
  }
  return worst;
}

// Steps the sim to the end, calling check(prev, state) after every step.
function stepAll(sim, check, maxSteps) {
  let prev = JSON.parse(JSON.stringify(sim.state));
  for (let i = 0; i < maxSteps && sim.result.status === 'running'; i++) {
    sim.step();
    check(prev, sim.state, i);
    prev = JSON.parse(JSON.stringify(sim.state));
  }
}

const maxStepsFor = (level) => Math.ceil(level.timeLimit / C.DT) + 120;

function checkAll(level, label) {
  return (prev, st, i) => {
    const at = label + ' step ' + i + ': ';
    assert.ok(st.charge <= prev.charge + EPS, at + 'charge rose from ' + prev.charge + ' to ' + st.charge);
    assert.ok(st.charge >= 0 && st.charge <= level.capacity + EPS, at + 'charge out of range ' + st.charge);
    assert.ok(Math.abs(st.v) <= C.V_NL + EPS, at + 'speed ' + st.v + ' exceeds no-load ' + C.V_NL);
    assert.ok(Math.abs(st.wL) * C.WHEEL_R <= C.V_NL + EPS, at + 'left wheel surface speed ' + st.wL * C.WHEEL_R);
    assert.ok(Math.abs(st.wR) * C.WHEEL_R <= C.V_NL + EPS, at + 'right wheel surface speed ' + st.wR * C.WHEEL_R);
    for (const w of level.walls) assert.ok(!insideRect(st.x, st.y, w), at + 'centre inside wall at ' + st.x + ',' + st.y);
    assert.ok(maxPenetration(st, level.walls) < 1e-3, at + 'body overlaps a wall by ' + maxPenetration(st, level.walls) + ' m');
    for (const k of NUMERIC_KEYS) assert.ok(Number.isFinite(st[k]), at + k + ' is ' + st[k]);
  };
}

// ---- properties -------------------------------------------------------------

test('property (a): battery charge never increases and stays between 0 and capacity', () => {
  forAll(110000, 120, (rng) => {
    const level = randomLevel(rng);
    const { program } = randomProgram(rng);
    const sim = createSim(level, program);
    stepAll(sim, (prev, st, i) => {
      assert.ok(st.charge <= prev.charge + EPS, 'step ' + i + ': charge rose ' + prev.charge + ' -> ' + st.charge);
      assert.ok(st.charge >= 0 && st.charge <= level.capacity + EPS, 'step ' + i + ': charge ' + st.charge);
    }, maxStepsFor(level));
  });
});

test('property (b): the simulation is deterministic', () => {
  forAll(120000, 80, (rng) => {
    const id = rng.pick(LEVELS).id;
    const { program, text } = randomProgram(rng);
    const a = runToEnd(getLevel(id), program);
    const b = runToEnd(getLevel(id), parse(text).program);
    assert.strictEqual(JSON.stringify(a.state), JSON.stringify(b.state), 'state differs for ' + JSON.stringify(text));
    assert.strictEqual(JSON.stringify(a.events), JSON.stringify(b.events), 'events differ for ' + JSON.stringify(text));
    assert.deepStrictEqual(a.result, b.result);
  });
});

test('property (c): speed and wheel surface speeds never exceed the no-load speed', () => {
  forAll(130000, 120, (rng) => {
    const level = randomLevel(rng);
    const sim = createSim(level, randomProgram(rng).program);
    stepAll(sim, (prev, st, i) => {
      assert.ok(Math.abs(st.v) <= C.V_NL + EPS, 'step ' + i + ': |v| ' + Math.abs(st.v));
      assert.ok(Math.abs(st.wL) * C.WHEEL_R <= C.V_NL + EPS, 'step ' + i + ': left wheel ' + Math.abs(st.wL) * C.WHEEL_R);
      assert.ok(Math.abs(st.wR) * C.WHEEL_R <= C.V_NL + EPS, 'step ' + i + ': right wheel ' + Math.abs(st.wR) * C.WHEEL_R);
    }, maxStepsFor(level));
  });
});

test('property (d): the robot centre is never inside a wall, and the body never sinks into one', () => {
  forAll(140000, 120, (rng) => {
    const level = randomLevel(rng);
    const sim = createSim(level, randomProgram(rng).program);
    stepAll(sim, (prev, st, i) => {
      for (const w of level.walls) assert.ok(!insideRect(st.x, st.y, w), 'step ' + i + ': centre inside a wall');
      assert.ok(maxPenetration(st, level.walls) < 1e-3, 'step ' + i + ': overlap ' + maxPenetration(st, level.walls));
    }, maxStepsFor(level));
  });
});

test('property (e): no NaN or Infinity in any state value or event field', () => {
  forAll(150000, 120, (rng) => {
    const level = randomLevel(rng);
    const sim = createSim(level, randomProgram(rng).program);
    stepAll(sim, (prev, st, i) => {
      for (const k of NUMERIC_KEYS) assert.ok(Number.isFinite(st[k]), 'step ' + i + ': ' + k + ' = ' + st[k]);
    }, maxStepsFor(level));
    for (const e of sim.events) {
      for (const [k, v] of Object.entries(e)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), e.type + '.' + k + ' = ' + v);
      }
    }
  });
});

test('property (f): runToEnd always finishes within the step limit with a final result', () => {
  forAll(160000, 150, (rng) => {
    const level = randomLevel(rng);
    const sim = runToEnd(level, randomProgram(rng).program);
    assert.notStrictEqual(sim.result.status, 'running', 'run did not end');
    assert.ok(['goal', 'timeout', 'battery_flat', 'program_ended'].includes(sim.result.reason));
    assert.ok(sim.state.steps <= maxStepsFor(level), 'took ' + sim.state.steps + ' steps');
    assert.ok(sim.state.t <= level.timeLimit + C.DT + EPS, 'ran past the time limit: ' + sim.state.t);
    const last = sim.events[sim.events.length - 1];
    assert.strictEqual(last.type, sim.result.reason, 'the last event names the reason the run ended');
  });
});

test('property (g): forced random duties respect every invariant above', () => {
  forAll(170000, 120, (rng) => {
    const level = randomLevel(rng);
    // Random duty pairs held for random spans: full-power spins, reversals, wall pushes.
    let hold = 0, duty = [0, 0];
    const sim = createSim(level, null, {
      duties: () => {
        if (hold-- <= 0) {
          hold = rng.int(1, 90);
          duty = rng.bool(0.15) ? [rng.pick([-1, 1]), rng.pick([-1, 1])] : [rng.next() * 2 - 1, rng.next() * 2 - 1];
        }
        return duty;
      }
    });
    stepAll(sim, checkAll(level, 'duties'), 900);
  });
});

test('property (g, part 2): random programs respect every invariant at once', () => {
  forAll(180000, 60, (rng) => {
    const level = randomLevel(rng);
    const { program, text } = randomProgram(rng);
    stepAll(createSim(level, program), checkAll(level, JSON.stringify(text)), maxStepsFor(level));
  });
});

test('the random generator reaches slip, collision, stall, flat battery and program end', () => {
  // Guards the properties above: if the generator stopped producing these situations,
  // the invariants would pass without testing anything.
  const seen = {};
  forAll(110000, 120, (rng) => {
    const level = randomLevel(rng);
    const sim = runToEnd(level, randomProgram(rng).program);
    for (const e of sim.events) seen[e.type] = (seen[e.type] || 0) + 1;
  });
  for (const type of ['slip', 'collision', 'stall', 'battery_flat', 'program_ended']) {
    assert.ok(seen[type] >= 5, type + ' seen only ' + (seen[type] || 0) + ' times: ' + JSON.stringify(seen));
  }
});
