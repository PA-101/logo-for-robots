(function (root) {
  'use strict';

  // Challenge Mode generator (design.md section 13). From a seed 1 to 150 it builds a corridor
  // path, a map, and a reference program derived from the same path, so the level is solvable by
  // construction. Battery and time limits come from simulating that reference. No DOM access,
  // no Math.random, no clock: the same seed always gives the same level.

  var lang, levels, simMod;
  if (typeof module !== 'undefined') {
    lang = require('./lang.js');
    levels = require('./levels.js');
    simMod = require('./sim.js');
  } else {
    lang = root.LFR.lang;
    levels = root.LFR.levels;
    simMod = root.LFR.sim;
  }

  var SEED_MIN = 1, SEED_MAX = 150;
  var GRID_W = 15, GRID_H = 11;       // including the border wall
  var SLICK_MU = 0.25, ICE_MU = 0.08, ICE_POWER = 60;
  var MAX_ATTEMPTS = 20, SEGMENT_TRIES = 50, MARGIN_STEPS = 8;

  // mulberry32
  function makeRng(seed) {
    var a = seed >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return { next: next, int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); } };
  }

  function clampSeed(seed) {
    var s = Math.round(Number(seed));
    if (!isFinite(s)) s = SEED_MIN;
    return Math.max(SEED_MIN, Math.min(SEED_MAX, s));
  }

  function difficulty(seed) {
    var s = clampSeed(seed);
    var turns = Math.min(10, 1 + Math.floor((s - 1) / 15));
    return {
      seed: s,
      turns: turns,
      minLen: 2,
      maxLen: turns >= 7 ? 4 : 5,
      slickChance: s < 31 ? 0 : Math.min(0.5, (s - 30) / 120),
      ice: s >= 91
    };
  }

  // Headings: 0 east, 1 south, 2 west, 3 north (grid rows grow downwards).
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  // Tries to build a path with exactly d.turns turns. Returns { cells, segments } or null.
  function buildPath(rng, d) {
    var start = { x: rng.int(1, 4), y: rng.int(1, GRID_H - 2) };
    var cells = [start];
    var used = {};
    used[start.x + ',' + start.y] = 0;
    var heading = 0, segments = [];
    for (var s = 0; s <= d.turns; s++) {
      var placed = false;
      for (var tries = 0; tries < SEGMENT_TRIES && !placed; tries++) {
        var turn = s === 0 ? 0 : (rng.next() < 0.5 ? 1 : -1);    // +1 right, -1 left
        var h = (heading + turn + 4) % 4;
        var len = rng.int(d.minLen, d.maxLen);
        var last = cells[cells.length - 1], fresh = [], ok = true;
        for (var i = 1; i <= len && ok; i++) {
          var c = { x: last.x + DX[h] * i, y: last.y + DY[h] * i };
          if (c.x < 1 || c.y < 1 || c.x > GRID_W - 2 || c.y > GRID_H - 2 || used[c.x + ',' + c.y] !== undefined) { ok = false; break; }
          // No new cell may touch an earlier path cell, except the one it continues from.
          var prev = i === 1 ? last : fresh[fresh.length - 1];
          for (var k = 0; k < 4 && ok; k++) {
            var key = (c.x + DX[k]) + ',' + (c.y + DY[k]);
            if (used[key] !== undefined && !(c.x + DX[k] === prev.x && c.y + DY[k] === prev.y)) ok = false;
          }
          fresh.push(c);
        }
        if (!ok) continue;
        for (var j = 0; j < fresh.length; j++) { used[fresh[j].x + ',' + fresh[j].y] = cells.length; cells.push(fresh[j]); }
        segments.push({ turn: turn, len: len, slick: s > 0 && rng.next() < d.slickChance, from: cells.length - len, to: cells.length - 1 });
        heading = h;
        placed = true;
      }
      if (!placed) return null;
    }
    return { cells: cells, segments: segments };
  }

  // Map rows cropped to the path with a one-cell wall border.
  function toMap(path) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < path.cells.length; i++) {
      minX = Math.min(minX, path.cells[i].x); maxX = Math.max(maxX, path.cells[i].x);
      minY = Math.min(minY, path.cells[i].y); maxY = Math.max(maxY, path.cells[i].y);
    }
    var w = maxX - minX + 3, h = maxY - minY + 3;
    var g = [];
    for (var y = 0; y < h; y++) { var row = []; for (var x = 0; x < w; x++) row.push('#'); g.push(row); }
    var put = function (c, ch) { g[c.y - minY + 1][c.x - minX + 1] = ch; };
    for (i = 0; i < path.cells.length; i++) put(path.cells[i], '.');
    path.segments.forEach(function (seg) { if (seg.slick) for (var k = seg.from; k <= seg.to; k++) put(path.cells[k], 'o'); });
    put(path.cells[0], 'S');
    put(path.cells[path.cells.length - 1], 'G');
    return g.map(function (r) { return r.join(''); });
  }

  // The reference program, from the same segments. On ice levels: power 60 before the first
  // command of an ice segment, power 100 before the first command of the next normal one.
  function toReference(path, ice) {
    var lines = [], low = false;
    path.segments.forEach(function (seg, i) {
      var wantLow = ice && seg.slick;
      if (wantLow !== low) { lines.push(wantLow ? 'power ' + ICE_POWER : 'power 100'); low = wantLow; }
      if (i > 0) lines.push((seg.turn > 0 ? 'right' : 'left') + ' 90');
      lines.push('forward ' + seg.len * 50);
    });
    return lines.join('\n');
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  function simulate(def) {
    var level = levels.buildLevel(def);
    var sim = simMod.runToEnd(level, lang.parse(def.reference).program);
    return { pass: sim.result.status === 'pass', t: sim.state.t, used: level.capacity - sim.state.charge };
  }

  // Battery and time from simulating the reference, with a margin loop (design section 13).
  function budget(def) {
    var free = simulate(Object.assign({}, def, { capacity: 1000, timeLimit: 1000 }));
    if (!free.pass) return null;
    var cap = round2(Math.max(0.5, Math.ceil(free.used / 0.65 / 0.05) * 0.05));
    var time = Math.max(10, Math.ceil(free.t / 0.65));
    for (var k = 0; k <= MARGIN_STEPS; k++) {
      var r = simulate(Object.assign({}, def, { capacity: cap, timeLimit: time }));
      if (r.pass && r.t <= 0.75 * time && r.used <= 0.75 * cap) return { capacity: cap, timeLimit: time };
      cap = round2(Math.round(cap * 1.1 / 0.05) * 0.05 + 0.05);
      time = Math.ceil(time * 1.1);
    }
    return null;
  }

  function facts(path, d) {
    var slick = 0;
    path.segments.forEach(function (s) { if (s.slick) slick++; });
    var metres = 0;
    path.segments.forEach(function (s) { metres += s.len * 0.5; });
    var turnList = path.segments.slice(1).map(function (s) { return s.turn > 0 ? 'right' : 'left'; });
    return { turns: d.turns, slickPatches: d.ice ? 0 : slick, icePatches: d.ice ? slick : 0, metres: metres, turnList: turnList };
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 'es'); }

  // Title, objective and hint, built only from facts about the generated level.
  function describe(seed, f) {
    var parts = [f.turns + (f.turns === 1 ? ' turn' : ' turns')];
    if (f.slickPatches) parts.push(plural(f.slickPatches, 'slick patch'));
    if (f.icePatches) parts.push(plural(f.icePatches, 'icy patch'));
    var hint;
    if (f.icePatches) hint = 'Lower power before the ' + (f.icePatches === 1 ? 'icy patch' : plural(f.icePatches, 'icy patch')) + ' and raise it after.';
    else {
      hint = 'Count the turns: ' + f.turnList.join(', ') + '.';
      if (f.slickPatches) hint += ' Expect some wheel slip on the ' + (f.slickPatches === 1 ? 'slick patch' : plural(f.slickPatches, 'slick patch')) + '.';
    }
    return {
      title: 'Challenge ' + seed + ': ' + parts.join(', '),
      // 'an 8.0 m', 'an 11.5 m', 'an 18.0 m'; 'a' otherwise
      objective: 'Reach the goal at the end of ' + (/^(8|11|18)(\.|$)/.test(f.metres.toFixed(1)) ? 'an ' : 'a ') + f.metres.toFixed(1) + ' m corridor.',
      hint: hint
    };
  }

  function fallbackLevel(seed) {
    var def = {
      id: 1000 + seed, seed: seed, name: 'Challenge ' + seed, chapter: 'challenge',
      map: ['######', '#S..G#', '######'], slickMu: SLICK_MU, powerMatters: false,
      reference: 'forward 150', capacity: 1, timeLimit: 10, attempts: MAX_ATTEMPTS, fallback: true,
      facts: { turns: 0, slickPatches: 0, icePatches: 0, metres: 1.5, turnList: [] }
    };
    def.title = 'Challenge ' + seed + ': a straight corridor';
    def.objective = 'Reach the goal at the end of a 1.5 m corridor.';
    def.hint = 'Drive straight ahead.';
    var b = budget(def);
    if (b) { def.capacity = b.capacity; def.timeLimit = b.timeLimit; }
    return def;
  }

  function generate(seedArg) {
    var seed = clampSeed(seedArg);
    try {
      var d = difficulty(seed);
      for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        var rng = makeRng(attempt === 0 ? seed : seed * 100 + attempt);
        var path = buildPath(rng, d);
        if (!path) continue;
        var f = facts(path, d);
        var def = {
          id: 1000 + seed, seed: seed, name: 'Challenge ' + seed, chapter: 'challenge',
          map: toMap(path), slickMu: d.ice ? ICE_MU : SLICK_MU, powerMatters: d.ice,
          reference: toReference(path, d.ice), attempts: attempt + 1, fallback: false, facts: f
        };
        var text = describe(seed, f);
        def.title = text.title;
        def.objective = text.objective;
        def.hint = text.hint;
        var b = budget(def);
        if (!b) continue;
        def.capacity = b.capacity;
        def.timeLimit = b.timeLimit;
        if (!simulate(def).pass) continue;       // rounding the battery must not break the level
        return def;
      }
    } catch (e) { /* fall through to the fallback level */ }
    return fallbackLevel(seed);
  }

  var api = {
    SEED_MIN: SEED_MIN,
    SEED_MAX: SEED_MAX,
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    generate: generate,
    difficulty: difficulty,
    makeRng: makeRng,
    clampSeed: clampSeed
  };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.gen = api;
  }
})(typeof self !== 'undefined' ? self : this);
