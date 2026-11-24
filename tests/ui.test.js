'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { framePlan, fitTransform, EXAMPLE_PROGRAM, SPEEDS } = require('../ui.js');
const { parse } = require('../lang.js');
const { runToEnd, C } = require('../sim.js');
const { getLevel } = require('../levels.js');
const { forAll } = require('./helpers');

const DT = C.DT;
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function stepsOver(seconds, speed, frameTimes) {
  let acc = 0, total = 0, elapsed = 0, i = 0;
  while (elapsed < seconds - 1e-12) {
    const f = Math.min(frameTimes[i++ % frameTimes.length], seconds - elapsed);
    elapsed += f;
    const p = framePlan(acc, f, speed, DT);
    acc = p.acc;
    total += p.steps;
  }
  return total;
}

test('speed control runs 0.5, 1, 2 or 4 steps per 1/60 s without changing the timestep', () => {
  assert.deepStrictEqual(SPEEDS, [0.5, 1, 2, 4]);
  for (const speed of SPEEDS) {
    assert.strictEqual(stepsOver(10, speed, [1 / 60]), 600 * speed, 'speed ' + speed + ' at 60 fps');
    const uneven = stepsOver(10, speed, [1 / 144, 1 / 30, 0.02, 1 / 60]);
    assert.ok(Math.abs(uneven - 600 * speed) <= 1, 'speed ' + speed + ' with uneven frames: ' + uneven);
  }
});

test('frame plan: long frames are capped at 0.25 s, bad input runs nothing', () => {
  assert.strictEqual(framePlan(0, 5, 1, DT).steps, 15);
  assert.strictEqual(framePlan(0, -1, 1, DT).steps, 0);
  assert.strictEqual(framePlan(0, NaN, 1, DT).steps, 0);
  assert.strictEqual(framePlan(NaN, 1 / 60, 1, DT).steps, 1);
  assert.strictEqual(framePlan(0, 1 / 60, 3, DT).steps, 1, 'unknown speed falls back to 1x');
});

test('property: the accumulator never goes negative or holds a whole step', () => {
  forAll(100000, 500, (rng) => {
    let acc = 0;
    for (let i = 0; i < 50; i++) {
      const p = framePlan(acc, rng.next() * 0.3, rng.pick(SPEEDS), DT);
      assert.ok(p.acc >= 0 && p.acc < DT + 1e-9, 'acc ' + p.acc);
      assert.ok(Number.isInteger(p.steps) && p.steps >= 0 && p.steps <= 240);
      acc = p.acc;
    }
  });
});

test('fitTransform keeps the whole level inside the canvas and centres it', () => {
  for (const id of [1, 2, 3]) {
    const l = getLevel(id);
    const t = fitTransform(l.width, l.height, 614, 440, 14);
    assert.ok(t.ox >= 14 - 1e-9 && t.oy >= 14 - 1e-9);
    assert.ok(t.ox + l.width * t.s <= 614 - 14 + 1e-9);
    assert.ok(t.oy + l.height * t.s <= 440 - 14 + 1e-9);
    assert.ok(Math.abs(t.ox * 2 + l.width * t.s - 614) < 1e-9, 'centred horizontally');
  }
});

test('the example program loaded at start parses and passes level 1', () => {
  const p = parse(EXAMPLE_PROGRAM);
  assert.strictEqual(p.ok, true);
  const sim = runToEnd(getLevel(1), p.program);
  assert.deepStrictEqual(sim.result, { status: 'pass', reason: 'goal' });
});

test('page has every element the UI needs', () => {
  for (const id of ['boot', 'boot-text', 'code', 'gutter', 'run', 'reset', 'messages', 'level', 'level-hint',
    'arena', 'graph', 'status', 'readout', 'battery-fill', 'battery-pct', 'why']) {
    assert.ok(new RegExp('id="' + id + '"').test(html), 'missing #' + id);
  }
  for (const s of SPEEDS) assert.ok(html.includes('data-speed="' + s + '"'), 'speed button ' + s);
  assert.ok(html.includes('battery scaled for demo'));
  assert.ok(html.includes('LOGO FOR ROBOTS'));
});

test('no external files: no images, audio, fonts or remote URLs', () => {
  const both = html + css;
  assert.ok(!/<img|<audio|<video|url\(|@import|https?:\/\//i.test(both), 'found an external reference');
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const l of links) assert.ok(fs.existsSync(path.join(__dirname, '..', l)), 'local file exists: ' + l);
});

test('theme colours from the steering file are used', () => {
  for (const c of ['#050805', '#33ff66', '#ffb000', '#ff3b30']) assert.ok(css.includes(c), c);
  assert.ok(/text-shadow/.test(css), 'glow');
  assert.ok(/repeating-linear-gradient\(to bottom/.test(css), 'scanlines');
  assert.ok(/\.screen::after[\s\S]*pointer-events: none/.test(css), 'scanlines only over canvases and never block clicks');
});
