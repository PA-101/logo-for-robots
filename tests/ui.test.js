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
    'arena', 'graph', 'status', 'readout', 'battery-fill', 'battery-pct', 'why', 'result-panel', 'result-head']) {
    assert.ok(new RegExp('id="' + id + '"').test(html), 'missing #' + id);
  }
  for (const s of SPEEDS) assert.ok(html.includes('data-speed="' + s + '"'), 'speed button ' + s);
  // Part 1a (user request): the demo-battery note moved from the UI to the README's Known limitations.
  assert.ok(!/battery scaled for demo/i.test(html), 'the label is gone from the page');
  assert.ok(/battery capacity is scaled for demo/i.test(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')), 'and documented in the README');
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

// ---- status line and arena size (UI fixes) ---------------------------------
const { statusLine, arenaHeight, ARENA_PAD, ARENA_MIN_H } = require('../ui.js');
const { explain, fmt } = require('../explain.js');

function explainRun(id, text) {
  const level = getLevel(id);
  const sim = runToEnd(level, parse(text).program);
  return explain({ result: sim.result, events: sim.events, state: sim.state, level });
}

test('status line names the same root cause as the "Why did it fail?" panel', () => {
  const cases = [
    [1, 'forward 400'],                                                   // stall first, then battery flat
    [1, 'wait 30'],                                                       // timeout
    [1, 'forward 50'],                                                    // stopped short
    [3, 'forward 200\nright 90\nforward 100\nleft 90\nforward 100'],      // slip, then stopped short
    [3, 'forward 200\nright 90\nforward 150\nleft 90\nforward 200']       // slip, stall, battery flat
  ];
  for (const [id, text] of cases) {
    const exp = explainRun(id, text);
    const line = statusLine(exp, fmt);
    assert.strictEqual(line.kind, 'fail');
    assert.ok(line.text.startsWith('FAIL: ' + exp.title + ' '), JSON.stringify(text) + ' -> ' + line.text);
    assert.ok(line.text.includes('root cause, at ' + fmt(exp.causes[0].t, 1) + ' s'), line.text);
    assert.strictEqual(exp.causes[0].root, true);
  }
});

test('regression: driving into a wall reports the stall, not the battery, in the status line', () => {
  const line = statusLine(explainRun(1, 'forward 400'), fmt);
  assert.ok(line.text.includes('Stalled against a wall'), line.text);
  assert.ok(!/battery/i.test(line.text), line.text);
});

test('status line for a pass and for a run still going', () => {
  const pass = statusLine(explainRun(1, EXAMPLE_PROGRAM), fmt);
  assert.strictEqual(pass.kind, 'pass');
  assert.ok(/^PASS: Reached the goal in \d+\.\d s with \d+% battery left\.$/.test(pass.text), pass.text);
  assert.deepStrictEqual(statusLine({ verdict: 'RUNNING', causes: [] }), { kind: '', text: 'RUNNING...' });
  assert.strictEqual(statusLine({ verdict: 'FAIL', title: 'Run failed', causes: [] }).kind, 'fail');
  assert.doesNotThrow(() => statusLine(null));
});

test('arena height fits each level at full column width, without empty bands, within the room available', () => {
  for (const id of [1, 2, 3]) {
    const l = getLevel(id);
    for (const w of [590, 640, 700, 900]) {
      const h = arenaHeight(w, l.width, l.height, 2000);
      const t = fitTransform(l.width, l.height, w, h, ARENA_PAD);
      // the drawing is limited by width, so it uses the whole column
      assert.ok(Math.abs(t.s - (w - 2 * ARENA_PAD) / l.width) < 1e-9 || h === ARENA_MIN_H, 'level ' + id + ' width ' + w);
      // and the canvas is no more than 1 px taller than the drawing needs
      assert.ok(h <= Math.max(ARENA_MIN_H, l.height * t.s + 2 * ARENA_PAD + 1), 'level ' + id + ' has empty bands');
    }
  }
});

test('arena height never exceeds the room available, but keeps a usable minimum', () => {
  forAll(190000, 300, (rng) => {
    const l = getLevel(rng.int(1, 3));
    const w = rng.int(400, 1200), avail = rng.int(-100, 1200);
    const h = arenaHeight(w, l.width, l.height, avail);
    assert.ok(Number.isInteger(h));
    assert.ok(h >= ARENA_MIN_H);
    if (avail >= ARENA_MIN_H) assert.ok(h <= avail, h + ' > ' + avail);
  });
  assert.strictEqual(arenaHeight(700, 3.5, 2.5, NaN), Math.ceil(2.5 * (700 - 28) / 3.5 + 28));
});

test('the arena column takes the spare width', () => {
  assert.ok(/grid-template-columns: 330px minmax\(640px, 1fr\) 380px/.test(css));
});

// ---- Auto-Fix Coach UI (task 18) -------------------------------------------------
const { lineDiff, COACH_FRAME_MS } = require('../ui.js');
const { coach } = require('../coach.js');

test('lineDiff marks only the changed lines and highlights whole words', () => {
  const rows = lineDiff('; my try\nforward 200\nright 90\nforward 50', '; my try\nforward 200\nright 90\nforward 100');
  assert.deepStrictEqual(rows.map((r) => r.changed), [false, false, false, true]);
  assert.deepStrictEqual(rows[3].old, ['forward ', '50', '']);
  assert.deepStrictEqual(rows[3].new, ['forward ', '100', '']);
  assert.deepStrictEqual(rows[0], { line: 1, changed: false, old: ['; my try', '', ''], new: ['; my try', '', ''] });
});

test('lineDiff shows an inserted wait as an addition before the turn, keeping the comment', () => {
  const [row] = lineDiff('left 90 ; turn', 'wait 0.5 left 90 ; turn');
  assert.deepStrictEqual(row.old, ['', '', 'left 90 ; turn']);
  assert.deepStrictEqual(row.new, ['', 'wait 0.5 ', 'left 90 ; turn']);
});

test('lineDiff on a change inside a long repeat line keeps the rest of the line unhighlighted', () => {
  const [row] = lineDiff('repeat 2 [ forward 100 right 80 forward 100 left 90 ]', 'repeat 2 [ forward 100 right 85 forward 100 left 90 ]');
  assert.deepStrictEqual(row.old, ['repeat 2 [ forward 100 right ', '80', ' forward 100 left 90 ]']);
  assert.deepStrictEqual(row.new, ['repeat 2 [ forward 100 right ', '85', ' forward 100 left 90 ]']);
});

test('property: lineDiff parts always rebuild both texts exactly', () => {
  forAll(250000, 300, (rng) => {
    const words = ['forward', 'left', '90', '100', ';', 'x', '[', ']', ' ', '  ', 'wait 1'];
    const make = () => Array.from({ length: rng.int(0, 5) }, () =>
      Array.from({ length: rng.int(0, 6) }, () => rng.pick(words)).join(rng.pick([' ', '']))).join('\n');
    const a = make(), b = rng.bool(0.3) ? a : make();
    const rows = lineDiff(a, b);
    const rebuild = (side) => rows.map((r) => r[side].join('')).join('\n');
    const lines = (t) => t.split('\n');
    assert.deepStrictEqual(rebuild('old').split('\n').slice(0, lines(a).length), lines(a));
    assert.deepStrictEqual(rebuild('new').split('\n').slice(0, lines(b).length), lines(b));
    for (const r of rows) assert.strictEqual(r.changed, r.old.join('') !== r.new.join(''));
  });
});

test('lineDiff of each coach fix changes exactly the edited lines', () => {
  const cases = [[1, '; my try\nforward 200\nright 90\nforward 50'], [3, 'forward 150\nright 60\nforward 100\nleft 90\nforward 200']];
  for (const [id, text] of cases) {
    const r = coach(getLevel(id), text);
    assert.strictEqual(r.found, true);
    const changed = lineDiff(text, r.program).filter((row) => row.changed).map((row) => row.line);
    assert.deepStrictEqual(changed, [...new Set(r.edits.map((e) => e.line))].sort((x, y) => x - y));
  }
});

test('the coach runs in short slices per frame so the page stays responsive', () => {
  assert.ok(COACH_FRAME_MS > 0 && COACH_FRAME_MS <= 16);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8');
  assert.ok(/createSearch\(/.test(ui) && !/\.coach\.coach\(/.test(ui), 'the UI steps createSearch instead of one blocking coach() call');
  for (const label of ['SUGGEST A FIX', 'APPLY FIX', 'Trying changes... ']) assert.ok(ui.includes(label), label);
});

test('no app text calls the coach AI, a language model or machine learning', () => {
  for (const file of ['coach.js', 'ui.js', 'index.html', 'README.md', 'style.css', 'gen.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!/\bA\.?I\.?\b|language model|machine learning|\bLLM\b/i.test(text), file + ' mentions AI');
  }
});

// ---- result panel and help (Part 1) ------------------------------------------------
const { resultView } = require('../ui.js');

test('result panel: hidden before a run, RESULT banner with one line on pass, no coach', () => {
  assert.strictEqual(resultView(null).visible, false);
  assert.strictEqual(resultView({ verdict: 'RUNNING', causes: [] }).visible, false);
  const pass = resultView(explainRun(1, EXAMPLE_PROGRAM), fmt);
  assert.strictEqual(pass.visible, true);
  assert.strictEqual(pass.heading, 'RESULT');
  assert.ok(/^PASS: reached the goal in \d+\.\d s with \d+% battery left\.$/.test(pass.line), pass.line);
  assert.deepStrictEqual(pass.causes, []);
  assert.strictEqual(pass.showCoach, false);
});

test('result panel: every failure uses the same heading, just the reasons, and the coach', () => {
  const cases = [[1, 'forward 400'], [1, 'wait 30'], [1, 'forward 50'], [3, 'forward 200\nright 90\nforward 100\nleft 90\nforward 100']];
  for (const [id, text] of cases) {
    const exp = explainRun(id, text);
    const v = resultView(exp, fmt);
    assert.strictEqual(v.heading, 'WHY DID IT FAIL?');
    assert.strictEqual(v.showCoach, true);
    assert.strictEqual(v.causes.length, exp.causes.length);
    assert.strictEqual(v.causes[0].tag, 'LIKELY ROOT CAUSE at ' + fmt(exp.causes[0].t, 1) + ' s');
    // the status line names the same root cause
    assert.ok(statusLine(exp, fmt).text.includes(exp.title));
    const words = JSON.stringify(v) + statusLine(exp, fmt).text;
    assert.ok(!/\bagain\b|still fail|\battempts?\b/i.test(words), words);
  }
  // the same failure twice gives the same panel (no attempt counting)
  assert.deepStrictEqual(resultView(explainRun(1, 'forward 400'), fmt), resultView(explainRun(1, 'forward 400'), fmt));
});

test('the commands help lists every command with an example', () => {
  const help = html.slice(html.indexOf('<details class="help">'), html.indexOf('</details>'));
  for (const ex of ['forward 50', 'back 20', 'left 90', 'right 45', 'wait 1', 'power 60', 'until-bump',
    'repeat 4 [ forward 50 right 90 ]', 'if wall-ahead [ left 90 ]', 'if bumped [ back 10 ]', '; my note']) {
    assert.ok(help.includes('<dt>' + ex + '</dt>'), 'help lists ' + ex);
  }
  // every example in the help parses (comments alone are "nothing to run")
  for (const m of help.matchAll(/<dt>([^<]+)<\/dt>/g)) {
    const r = parse(m[1]);
    assert.ok(r.ok || m[1].startsWith(';'), m[1] + ': ' + JSON.stringify(r.errors));
  }
});

// ---- level picker (task 30) ----------------------------------------------------
const { levelOptions, parseLevelKey, headerText, CHALLENGE_VALUE } = require('../ui.js');
const levelsMod = require('../levels.js');
const genMod = require('../gen.js');

test('level picker groups the 9 levels by chapter and ends with Challenge mode', () => {
  const groups = levelOptions(levelsMod.CHAPTERS, levelsMod.ALL_LEVELS);
  assert.deepStrictEqual(groups.map((g) => g.label), ['Chapter 1: Basics', 'Chapter 2: Grip and Power', 'Chapter 3: Bumpers', 'Challenge']);
  assert.deepStrictEqual(groups.slice(0, 3).map((g) => g.options.map((o) => o.value)), [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]);
  assert.strictEqual(groups[0].options[0].label, '1. First Steps');
  assert.deepStrictEqual(groups[3].options.map((o) => o.value), [CHALLENGE_VALUE]);
});

test('picker values and hash values map to levels and clamped seeds', () => {
  assert.deepStrictEqual(parseLevelKey('4'), { kind: 'level', id: 4 });
  assert.deepStrictEqual(parseLevelKey('x'), { kind: 'level', id: 1 });
  assert.deepStrictEqual(parseLevelKey(CHALLENGE_VALUE, 75), { kind: 'challenge', seed: 75 });
  assert.deepStrictEqual(parseLevelKey(CHALLENGE_VALUE, '999'), { kind: 'challenge', seed: 150 });
  assert.deepStrictEqual(parseLevelKey(CHALLENGE_VALUE, 'abc'), { kind: 'challenge', seed: 1 });
  assert.deepStrictEqual(parseLevelKey('c150'), { kind: 'challenge', seed: 150 });
  assert.deepStrictEqual(parseLevelKey('C0'), { kind: 'challenge', seed: 1 });
});

test('the header names the level, or the challenge and its seed', () => {
  assert.strictEqual(headerText(levelsMod.getLevel(6)), 'Level 6: Black Ice');
  const def = genMod.generate(17);
  const built = Object.assign(levelsMod.buildLevel(def), { seed: def.seed, chapter: 'challenge' });
  assert.strictEqual(headerText(built), 'Challenge 17 (seed 17)');
  assert.strictEqual(headerText(null), '');
});

test('the page has the seed row with a 1 to 150 number field and PREV / NEXT buttons', () => {
  assert.ok(/<input id="seed" type="number" min="1" max="150"/.test(html));
  assert.ok(html.includes('id="seed-prev"') && html.includes('id="seed-next"'));
  assert.ok(html.includes('id="level-title"'));
});

// ---- layout chips (task 31) ------------------------------------------------------
const { combineLayouts } = require('../ui.js');

test('combineLayouts: passes only when every layout passes, and points at the first failure', () => {
  const P = { status: 'pass' }, F = { status: 'fail' };
  assert.deepStrictEqual(combineLayouts(['A', 'B', 'C'], [P, P, P], 0),
    { multi: true, pass: true, focus: 0, chips: [
      { index: 0, name: 'A', pass: true, text: 'A PASS', shown: true },
      { index: 1, name: 'B', pass: true, text: 'B PASS', shown: false },
      { index: 2, name: 'C', pass: true, text: 'C PASS', shown: false }] });
  const mixed = combineLayouts(['A', 'B', 'C'], [P, F, F], 0);
  assert.strictEqual(mixed.pass, false);
  assert.strictEqual(mixed.focus, 1);
  assert.deepStrictEqual(mixed.chips.map((c) => c.text), ['A PASS', 'B FAIL', 'C FAIL']);
  assert.strictEqual(combineLayouts(['A', 'B'], [P, P], 1).focus, 1, 'all pass: focus is the shown layout');
  const single = combineLayouts([null], [F], 0);
  assert.strictEqual(single.multi, false);
  assert.strictEqual(single.chips[0].name, 'A');
  assert.strictEqual(combineLayouts([], [], 0).pass, false);
});

test('combineLayouts on real chapter 3 runs: the fixed-distance program passes A and fails B', () => {
  const layouts = levelsMod.getLayouts(7);
  const results = layouts.map((l) => runToEnd(l, parse('forward 150\nright 90\nforward 50').program).result);
  const c = combineLayouts(layouts.map((l) => l.layout), results, 0);
  assert.deepStrictEqual(c.chips.map((x) => x.text), ['A PASS', 'B FAIL', 'C FAIL']);
  assert.strictEqual(c.focus, 1);
  const ref = layouts.map((l) => runToEnd(l, parse(l.reference).program).result);
  assert.strictEqual(combineLayouts(layouts.map((l) => l.layout), ref, 0).pass, true);
});

// ---- export dialog (task 35) ---------------------------------------------------
const { exportView } = require('../ui.js');

test('exportView returns the code for a valid program and the error line for a bad one', () => {
  const ok = exportView('forward 50\nleft 90', 'Level 1: First Steps');
  assert.strictEqual(ok.ok, true);
  assert.ok(ok.code.includes('runProgram') && ok.code.includes('"Level 1: First Steps"'));
  assert.ok(/^Ready to copy: \d+ lines\.$/.test(ok.status), ok.status);
  const bad = exportView('forward 50\njump 3', 'x');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, '');
  assert.ok(bad.status.startsWith('Fix the program first. Line 2: '), bad.status);
});

test('the page has the export button and a dialog with read-only code, COPY and CLOSE', () => {
  assert.ok(html.includes('>EXPORT TO MICROCONTROLLER CODE</button>'));
  assert.ok(/<dialog id="export-dialog"/.test(html));
  assert.ok(/<textarea id="export-code"[^>]*readonly/.test(html));
  assert.ok(html.includes('id="export-copy"') && html.includes('id="export-close"'));
  assert.ok(/uncalibrated/i.test(html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'))));
});

// ---- judge shortcuts (task 36) ---------------------------------------------------
const { shortcutList } = require('../ui.js');
const coachMod = require('../coach.js');

test('shortcuts: five buttons that load the same level the picker would', () => {
  const list = shortcutList(levelsMod, genMod);
  assert.deepStrictEqual(list.map((s) => s.label), ['BASICS', 'GRIP AND POWER', 'BUMPERS', 'CHALLENGE 75', 'CHALLENGE 150']);
  assert.deepStrictEqual(list.map((s) => parseLevelKey(s.key)), [
    { kind: 'level', id: 1 }, { kind: 'level', id: 4 }, { kind: 'level', id: 7 },
    { kind: 'challenge', seed: 75 }, { kind: 'challenge', seed: 150 }]);
  // the picker uses the same keys: level values are the ids, challenge goes through the seed
  assert.deepStrictEqual(parseLevelKey(CHALLENGE_VALUE, 75), parseLevelKey('c75'));
  for (const s of list) assert.strictEqual(parse(s.starter).ok, true, s.label + ' starter parses');
});

test('shortcut starters show each lesson: basics passes, the others fail in the intended way', () => {
  const [basics, grip, bumpers, c75, c150] = shortcutList(levelsMod, genMod);
  assert.strictEqual(runToEnd(levelsMod.getLevel(1), parse(basics.starter).program).result.status, 'pass');
  const g = runToEnd(levelsMod.getLevel(4), parse(grip.starter).program);
  assert.strictEqual(g.result.status, 'fail');
  assert.ok(g.events.some((e) => e.type === 'slip'), 'the full-power run slips');
  const results = levelsMod.getLayouts(7).map((l) => runToEnd(l, parse(bumpers.starter).program).result.status);
  assert.deepStrictEqual(results, ['pass', 'fail', 'fail']);
  for (const [s, seed] of [[c75, 75], [c150, 150]]) {
    const level = levelsMod.buildLevel(genMod.generate(seed));
    assert.strictEqual(runToEnd(level, parse(s.starter).program).result.status, 'fail', s.label);
    const r = coachMod.coach(level, s.starter);
    assert.strictEqual(r.found, true, s.label + ': the coach can fix the starter');
  }
});

test('the page has the shortcut row above the editor', () => {
  assert.ok(html.indexOf('id="shortcuts"') > 0 && html.indexOf('id="shortcuts"') < html.indexOf('id="code"'));
});

// ---- one layout everywhere (overnight item 1) ------------------------------------
const { layoutToShow } = require('../ui.js');

test('layoutToShow: the first failing layout, or the slowest when all pass', () => {
  const run = (status, t) => ({ result: { status }, state: { t } });
  assert.strictEqual(layoutToShow(['A', 'B', 'C'], [run('pass', 4), run('fail', 9), run('fail', 3)], 0), 1);
  assert.strictEqual(layoutToShow(['A', 'B', 'C'], [run('pass', 4.8), run('pass', 6.5), run('pass', 8.1)], 0), 2, 'slowest');
  assert.strictEqual(layoutToShow(['A', 'B'], [run('pass', 5), run('pass', 5)], 1), 1, 'a tie keeps the shown layout');
  assert.strictEqual(layoutToShow(['A'], [run('fail', 1)], 0), 0);
  assert.strictEqual(layoutToShow([], [], 0), 0);
});

test('on real chapter 3 runs the shown layout is the one the panel explains', () => {
  const layouts = levelsMod.getLayouts(7);
  const names = layouts.map((l) => l.layout);
  const fixed = layouts.map((l) => runToEnd(l, parse('forward 150\nright 90\nforward 50').program));
  const show = layoutToShow(names, fixed, 0);
  assert.strictEqual(show, 1);
  assert.strictEqual(combineLayouts(names, fixed.map((s) => s.result), show).focus, show, 'panel focus = shown layout');
  const ref = layouts.map((l) => runToEnd(l, parse(l.reference).program));
  const slow = layoutToShow(names, ref, 0);
  assert.strictEqual(ref[slow].state.t, Math.max(...ref.map((s) => s.state.t)));
  assert.strictEqual(names[slow], 'C', 'the longest corridor is the slowest');
  assert.strictEqual(combineLayouts(names, ref.map((s) => s.result), slow).focus, slow);
});

test('the TELEMETRY and BATTERY headings have a layout tag', () => {
  assert.ok(html.includes('<h2>TELEMETRY<span id="telemetry-layout" class="layout-tag"></span></h2>'));
  assert.ok(html.includes('BATTERY<span id="battery-layout" class="layout-tag"></span>'));
});
