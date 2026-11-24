'use strict';
// Records today's behavior into tests/fixtures/golden-runs.json (design.md section 12).
// Run ONCE, before the power/bumper change. Never re-run after it: tests/compat.test.js
// compares new code against this file, and regenerating it would hide a behavior change.
// Usage: node scripts/record-golden.js
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { parse } = require(path.join(root, 'lang.js'));
const { runToEnd } = require(path.join(root, 'sim.js'));
const { getLevel, LEVELS } = require(path.join(root, 'levels.js'));
const { coach } = require(path.join(root, 'coach.js'));
const { makeRng } = require(path.join(root, 'tests', 'helpers.js'));

const OUT = path.join(root, 'tests', 'fixtures', 'golden-runs.json');
if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  console.error('golden-runs.json already exists. It must not be regenerated (see design.md section 12).');
  process.exit(1);
}

// Same generator as tests/sim.property.test.js (copied so the fixture does not depend on test files).
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

// A level variant: base id plus optional capacity and floor friction, so slip and flat
// battery paths are recorded too.
function makeLevel(spec) {
  const level = getLevel(spec.id);
  if (spec.capacity !== undefined) level.capacity = spec.capacity;
  if (spec.mu !== undefined) level.mu = spec.mu;
  return level;
}

function record(spec, text) {
  const sim = runToEnd(makeLevel(spec), parse(text).program);
  return { level: spec, text, result: sim.result, events: sim.events, state: sim.state };
}

const runs = [];
for (const def of LEVELS) runs.push(record({ id: def.id }, def.reference));
const careless = [
  [1, 'forward 400'], [2, 'forward 400'], [1, 'wait 30'], [1, 'forward 50'], [2, 'repeat 100 [ left 90 ]'],
  [3, 'forward 200\nright 90\nforward 150\nleft 90\nforward 200'],
  [3, 'forward 200\nright 90\nforward 100\nleft 90\nforward 100'],
  [1, 'forward 250\nright 90\nforward 100'], [2, 'repeat 100 [ if wall-ahead [ right 90 ] forward 25 ]']
];
for (const [id, text] of careless) runs.push(record({ id }, text));

const rng = makeRng(300000);
while (runs.length < 12 + 150) {
  const text = genCommands(rng, 0).join('\n');
  if (!parse(text).ok) continue;
  const spec = { id: rng.int(1, 3) };
  if (rng.bool(0.3)) spec.capacity = rng.pick([0.05, 0.2, 0.5]);
  if (rng.bool(0.25)) spec.mu = rng.pick([0.2, 0.3, 0.4]);
  runs.push(record(spec, text));
}

// Coach results for failing near-miss programs on levels 1 to 3.
const coachRuns = [];
const crng = makeRng(310000);
let guard = 0;
while (coachRuns.length < 20 && guard++ < 2000) {
  const def = crng.pick(LEVELS);
  const text = def.reference.replace(/\d+/g, (n) => {
    if (!crng.bool(0.35)) return n;
    const v = Number(n);
    return String(Math.max(1, crng.bool() ? Math.round(v * crng.pick([0.5, 0.7, 0.8, 1.2, 1.4])) : v + crng.pick([-25, -12, -7, 7, 12, 25])));
  });
  const p = parse(text);
  if (!p.ok || runToEnd(getLevel(def.id), p.program).result.status === 'pass') continue;
  coachRuns.push({ level: { id: def.id }, text, result: coach(getLevel(def.id), text) });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  note: 'Recorded before the power/bumper change (design.md section 12). Do not regenerate.',
  runs, coach: coachRuns
}));
console.log('recorded', runs.length, 'runs and', coachRuns.length, 'coach results to', path.relative(root, OUT),
  '(' + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
