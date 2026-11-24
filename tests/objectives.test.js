'use strict';
// Task 33: every level has a title, a one-sentence objective and a hint.
const test = require('node:test');
const assert = require('node:assert');
const { ALL_LEVELS, getLevel, buildLevel } = require('../levels.js');
const { generate } = require('../gen.js');
const { objectiveView } = require('../ui.js');

function checkText(label, d) {
  assert.ok(typeof d.title === 'string' && d.title.length > 0, label + ': title');
  assert.ok(typeof d.hint === 'string' && d.hint.length > 0, label + ': hint');
  const o = d.objective;
  assert.ok(typeof o === 'string' && o.length > 0 && o.length < 120, label + ': objective length ' + (o || '').length);
  assert.ok(/^[A-Z]/.test(o) && o.endsWith('.'), label + ': objective is a sentence: ' + o);
  // One sentence: the only full stop is the last character (decimal points like 11.5 are fine).
  assert.strictEqual(o.replace(/\d\.\d/g, '').split('.').length - 1, 1, label + ': one sentence: ' + o);
}

test('every handpicked level has a title, a one-sentence objective and a hint', () => {
  for (const def of ALL_LEVELS) {
    checkText('level ' + def.id, def);
    const built = getLevel(def.id);
    assert.strictEqual(built.title, def.name);
    assert.strictEqual(built.objective, def.objective);
  }
});

const GEN = [];
for (let s = 1; s <= 150; s++) GEN.push(generate(s));

test('every generated level has the same, and its text matches the level', () => {
  for (const d of GEN) {
    const label = 'seed ' + d.seed;
    checkText(label, d);
    const turnLines = (d.reference.match(/^(left|right) 90$/gm) || []).map((l) => l.split(' ')[0]);
    assert.ok(d.title.startsWith('Challenge ' + d.seed + ': ' + turnLines.length + (turnLines.length === 1 ? ' turn' : ' turns')), label + ': ' + d.title);
    const slick = d.map.join('').includes('o');
    if (d.facts.icePatches) {
      assert.ok(slick && d.seed >= 91, label + ': icy patches only on ice levels');
      assert.ok(d.title.includes(d.facts.icePatches + (d.facts.icePatches === 1 ? ' icy patch' : ' icy patches')), d.title);
      assert.ok(d.hint.startsWith('Lower power before the'), d.hint);
    } else {
      assert.strictEqual(d.hint.split('.')[0], 'Count the turns: ' + turnLines.join(', '), label + ': the hint lists the real turns');
    }
    if (d.facts.slickPatches) assert.ok(slick && d.seed < 91 && d.title.includes('slick patch'), label);
    if (!slick) assert.ok(!/patch/.test(d.title), label + ': no patches mentioned without slick floor');
    const metres = d.reference.match(/^forward (\d+)$/gm).reduce((a, l) => a + Number(l.split(' ')[1]) / 100, 0);
    assert.ok(d.objective.includes(metres.toFixed(1) + ' m corridor'), label + ': ' + d.objective + ' vs ' + metres);
    assert.ok(!/\ba 8|\ba 11\.|\ba 18\./.test(d.objective), label + ': article: ' + d.objective);
  }
});

test('the same seed gives the same text', () => {
  for (const s of [1, 50, 97, 150]) {
    const a = generate(s), b = GEN[s - 1];
    assert.deepStrictEqual([a.title, a.objective, a.hint], [b.title, b.objective, b.hint]);
  }
});

test('objectiveView: header plus facts for challenges, the name for handpicked levels', () => {
  const v = objectiveView(getLevel(6));
  assert.deepStrictEqual(v, { title: 'Level 6: Black Ice', objective: ALL_LEVELS[5].objective, hint: ALL_LEVELS[5].hint });
  const d = GEN[96];
  const built = Object.assign(buildLevel(d), { seed: d.seed, chapter: 'challenge' });
  const cv = objectiveView(built);
  assert.strictEqual(cv.title, 'Challenge 97 (seed 97): ' + d.title.replace(/^Challenge 97: /, ''));
  assert.strictEqual(cv.objective, d.objective);
  assert.strictEqual(cv.hint, d.hint);
  assert.deepStrictEqual(objectiveView(null), { title: '', objective: '', hint: '' });
});
