'use strict';
// Task 25: structure tests for chapters, layouts and the 9 handpicked levels.
const test = require('node:test');
const assert = require('node:assert');
const { LEVELS, ALL_LEVELS, CHAPTERS, CELL, buildLevel, getLevel, getLayouts } = require('../levels.js');

const mapsOf = (def) => (def.layouts ? def.layouts.map((l) => ({ name: l.name, map: l.map })) : [{ name: null, map: def.map }]);

// The builder as it was before task 24, copied here so the comparison is independent of the new code.
function originalBuild(def) {
  const rows = def.map, nRows = rows.length;
  let nCols = 0;
  for (const r of rows) nCols = Math.max(nCols, r.length);
  const walls = [], slick = [];
  let goal = null;
  const start = { x: CELL / 2, y: CELL / 2, theta: def.startHeading || 0 };
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const rect = { x: c * CELL, y: (nRows - 1 - r) * CELL, w: CELL, h: CELL };
    if (ch === '#') walls.push(rect);
    else if (ch === 'o') slick.push(rect);
    else if (ch === 'G') goal = rect;
    else if (ch === 'S') { start.x = rect.x + CELL / 2; start.y = rect.y + CELL / 2; }
  }));
  return { id: def.id, name: def.name, hint: def.hint, cell: CELL, width: nCols * CELL, height: nRows * CELL, walls, slick,
    goal: goal || { x: 0, y: 0, w: CELL, h: CELL }, start, capacity: def.capacity, timeLimit: def.timeLimit,
    mu: def.mu || 0.6, slickMu: def.slickMu || 0.25, reference: def.reference };
}

// Floor cells reachable from S by 4-neighbour moves.
function reachable(map) {
  const rows = map.length;
  let s = null;
  map.forEach((row, r) => { const c = row.indexOf('S'); if (c >= 0) s = [r, c]; });
  const seen = new Set([s.join(',')]), queue = [s];
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc, k = nr + ',' + nc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= map[nr].length || map[nr][nc] === '#' || seen.has(k)) continue;
      seen.add(k);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

test('there are 9 levels in 3 chapters, ids 1 to 9 in order', () => {
  assert.deepStrictEqual(ALL_LEVELS.map((d) => d.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepStrictEqual(CHAPTERS.map((c) => [c.id, c.name, c.levels]), [
    [1, 'Basics', [1, 2, 3]], [2, 'Grip and Power', [4, 5, 6]], [3, 'Bumpers', [7, 8, 9]]]);
  assert.deepStrictEqual(LEVELS.map((d) => d.id), [1, 2, 3], 'LEVELS is still chapter 1 only');
  for (const ch of CHAPTERS) for (const id of ch.levels) assert.strictEqual(getLevel(id).chapter, ch.id);
});

test('every map of every layout is rectangular, closed, with one S and a filled G rectangle', () => {
  for (const def of ALL_LEVELS) {
    for (const { name, map } of mapsOf(def)) {
      const label = 'level ' + def.id + (name ? ' layout ' + name : '');
      const width = map[0].length;
      assert.ok(map.every((row) => row.length === width), label + ': rows of equal length');
      assert.ok(/^#+$/.test(map[0]) && /^#+$/.test(map[map.length - 1]), label + ': top and bottom walls');
      assert.ok(map.every((row) => row[0] === '#' && row[width - 1] === '#'), label + ': side walls');
      assert.ok(map.every((row) => /^[#.SGo]+$/.test(row)), label + ': only known characters');
      assert.strictEqual(map.join('').split('S').length - 1, 1, label + ': one S');
      const g = [];
      map.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'G') g.push([r, c]); }));
      assert.ok(g.length >= 1, label + ': has a goal');
      const r0 = Math.min(...g.map((p) => p[0])), r1 = Math.max(...g.map((p) => p[0]));
      const c0 = Math.min(...g.map((p) => p[1])), c1 = Math.max(...g.map((p) => p[1]));
      assert.strictEqual(g.length, (r1 - r0 + 1) * (c1 - c0 + 1), label + ': G cells fill their rectangle');
      const built = buildLevel(def, mapsOf(def).findIndex((m) => m.map === map));
      assert.deepStrictEqual(built.goal, { x: c0 * CELL, y: (map.length - 1 - r1) * CELL, w: (c1 - c0 + 1) * CELL, h: (r1 - r0 + 1) * CELL }, label + ': goal rectangle');
      const reach = reachable(map);
      assert.ok(g.every(([r, c]) => reach.has(r + ',' + c)), label + ': the goal is reachable from S');
    }
  }
});

test('all layouts of a level share size, start and heading', () => {
  for (const def of ALL_LEVELS.filter((d) => d.layouts)) {
    const built = getLayouts(def.id);
    assert.strictEqual(built.length, 3, 'level ' + def.id + ' has 3 layouts');
    assert.deepStrictEqual(built.map((l) => l.layout), ['A', 'B', 'C']);
    for (const l of built) {
      assert.strictEqual(l.width, built[0].width);
      assert.strictEqual(l.height, built[0].height);
      assert.deepStrictEqual(l.start, built[0].start);
      assert.strictEqual(l.layoutCount, 3);
    }
  }
});

test('chapter 1 levels build byte-identical to before, plus the new fields', () => {
  for (const def of LEVELS) {
    const now = getLevel(def.id), old = originalBuild(def);
    for (const k of Object.keys(old)) assert.strictEqual(JSON.stringify(now[k]), JSON.stringify(old[k]), 'level ' + def.id + ' field ' + k);
    assert.deepStrictEqual([now.chapter, now.layout, now.layoutCount, now.powerMatters], [1, null, 1, false]);
  }
});

test('chapter 2 levels are icy and marked "power matters"; chapter 3 levels are not', () => {
  for (const id of [4, 5, 6]) {
    const l = getLevel(id);
    assert.strictEqual(l.powerMatters, true);
    assert.ok(l.slick.length > 0 && l.slickMu < 0.25, 'level ' + id + ' has ice');
    assert.ok(/power \d+/.test(l.reference), 'level ' + id + ' reference sets power');
    assert.strictEqual(l.layoutCount, 1);
  }
  for (const id of [7, 8, 9]) {
    const l = getLevel(id);
    assert.strictEqual(l.powerMatters, false);
    assert.ok(/until-bump/.test(l.reference), 'level ' + id + ' reference uses until-bump');
  }
});

test('getLevel and getLayouts handle unknown ids and odd layout numbers', () => {
  assert.strictEqual(getLevel(99).id, 1);
  assert.strictEqual(getLevel(undefined).id, 1);
  assert.strictEqual(getLevel(7, 2).layout, 'C');
  assert.strictEqual(getLevel(7, 9).layout, 'C', 'clamped high');
  assert.strictEqual(getLevel(7, -3).layout, 'A', 'clamped low');
  assert.strictEqual(getLevel(7, 'x').layout, 'A');
  assert.strictEqual(getLevel(2, 2).layout, null, 'layouts are ignored on a level without them');
  assert.strictEqual(getLayouts(1).length, 1);
  assert.strictEqual(getLayouts(42)[0].id, 1);
  assert.notStrictEqual(getLevel(4), getLevel(4), 'fresh object each time');
});

test('every level has a reference program, battery and time limit', () => {
  for (const def of ALL_LEVELS) {
    assert.ok(def.capacity > 0 && def.timeLimit > 0, 'level ' + def.id);
    assert.ok(typeof def.reference === 'string' && def.reference.length > 0);
    assert.ok(typeof def.name === 'string' && typeof def.hint === 'string');
  }
});
