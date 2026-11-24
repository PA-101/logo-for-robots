(function (root) {
  'use strict';

  // Auto-Fix Coach: a deterministic search over small numeric edits to a program.
  // Each candidate is simulated with runToEnd; the smallest passing edit wins.
  // No DOM access, no randomness, no clock reads. Never reads level.reference.
  // See design.md section 11.

  var lang, simMod, explainMod;
  if (typeof module !== 'undefined') {
    lang = require('./lang.js');
    simMod = require('./sim.js');
    explainMod = require('./explain.js');
  } else {
    lang = root.LFR.lang;
    simMod = root.LFR.sim;
    explainMod = root.LFR.explain;
  }
  var fmt = explainMod.fmt;

  var LIMITS = {
    CANDIDATE_CAP: 3000,
    MAX_EDITS: 2,
    SCALE_FACTORS: [0.5, 0.75, 0.9, 1.1, 1.25, 1.5, 2],
    TURN_DELTAS: [-5, 5, -10, 10, -15, 15, -20, 20, -30, 30, -45, 45],
    WAITS: [0.5, 1],
    POWER_VALUES: [30, 40, 50, 60, 70, 80, 90, 100],   // for an existing power command
    POWER_INSERTS: [60, 80],                           // inserted before a command, on "power matters" levels
    MULTI_LAYOUT: 'search'                             // 'off' turns the coach off for multi-layout levels (R8.17)
  };
  var TIE = 1e-9;             // sizes closer than this count as equal
  var POWER_FIRST_LINE = 'Power first: wheel slip was the root cause on a level where power matters, ' +
    'so power changes were tried before angles and distances.';
  function isPowerEdit(e) { return e.kind === 'power' || e.kind === 'power-insert'; }
  var ATTEMPT_LIMIT = 4;      // at most 4 * cap edited texts are built, counting ones that do not parse

  // ---- edits ---------------------------------------------------------------

  // All single edits for a program text, in generation order (design.md section 11).
  // options.powerInsert adds "insert power P" edits; without it, programs that have no power
  // command get exactly the original edit list.
  function generateEdits(text, options) {
    if (typeof text !== 'string') return [];
    var powerInsert = !!(options && options.powerInsert === true);
    var parsed = lang.parse(text, { positions: true });
    if (!parsed.ok) return [];
    var edits = [];
    var nodeIndex = 0;

    function add(e) {
      e.index = edits.length;
      edits.push(e);
    }

    function walk(nodes, inLoop) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.type === 'repeat') { walk(node.body, inLoop || node.n > 1); continue; }
        if (node.type === 'if') { walk(node.body, inLoop); continue; }
        var where = inLoop ? ' (inside a repeat, so it changes every pass)' : '';
        var k, n2;
        if (node.type === 'power') {
          var pid = nodeIndex++;
          var pBefore = 'power ' + text.slice(node.numStart, node.numEnd);
          for (k = 0; k < LIMITS.POWER_VALUES.length; k++) {
            n2 = LIMITS.POWER_VALUES[k];
            if (n2 === node.n) continue;
            add(numberEdit(node, pid, pBefore, n2, Math.abs(n2 - node.n) / 100, 'power', where));
          }
          continue;
        }
        if (node.type === 'until-bump') {
          var bid = nodeIndex++;
          if (powerInsert) addPowerInserts(node, bid, 'until-bump', where);
          continue;
        }
        var isMove = node.type === 'forward' || node.type === 'back';
        var isTurn = node.type === 'left' || node.type === 'right';
        if (!isMove && !isTurn) continue;
        var id = nodeIndex++;
        var numText = text.slice(node.numStart, node.numEnd);
        var before = node.type + ' ' + numText;
        if (isMove && node.n > 0) {
          var seen = {};
          for (k = 0; k < LIMITS.SCALE_FACTORS.length; k++) {
            n2 = Math.min(lang.LIMITS.MAX_MOVE, Math.max(1, Math.round(node.n * LIMITS.SCALE_FACTORS[k])));
            if (n2 === node.n || seen[n2]) continue;
            seen[n2] = true;
            add(numberEdit(node, id, before, n2, Math.abs(n2 - node.n) / node.n, 'scale', where));
          }
        }
        if (isTurn) {
          for (k = 0; k < LIMITS.TURN_DELTAS.length; k++) {
            // Round to 2 decimals so the new number is always plain digits for the parser.
            n2 = Math.round((node.n + LIMITS.TURN_DELTAS[k]) * 100) / 100;
            if (n2 < 0 || n2 > lang.LIMITS.MAX_TURN || n2 === node.n) continue;
            add(numberEdit(node, id, before, n2, Math.abs(LIMITS.TURN_DELTAS[k]) / 90, 'turn', where));
          }
          for (k = 0; k < LIMITS.WAITS.length; k++) {
            var w = LIMITS.WAITS[k];
            add({
              node: id, line: node.line, kind: 'wait', start: node.start, end: node.start,
              insert: 'wait ' + w + ' ', before: before, after: 'wait ' + w + ' ' + before, size: w / 2,
              text: 'Line ' + node.line + ': ' + before + ' -> wait ' + w + ' then ' + before + where
            });
          }
        }
        if (powerInsert) addPowerInserts(node, id, before, where);
      }
    }

    // "insert power P" before a command; power stays set, so the text says "from line N on".
    function addPowerInserts(node, id, before, where) {
      for (var k = 0; k < LIMITS.POWER_INSERTS.length; k++) {
        var p = LIMITS.POWER_INSERTS[k];
        add({
          node: id, line: node.line, kind: 'power-insert', start: node.start, end: node.start,
          insert: 'power ' + p + ' ', before: before, after: 'power ' + p + ' ' + before, size: (100 - p) / 100,
          text: 'Line ' + node.line + ': power ' + p + ' before ' + before + ' (power stays ' + p + ' from line ' + node.line + ' on)' + where
        });
      }
    }

    function numberEdit(node, id, before, n2, size, kind, where) {
      var after = node.type + ' ' + n2;
      return {
        node: id, line: node.line, kind: kind, start: node.numStart, end: node.numEnd,
        insert: String(n2), before: before, after: after, size: size,
        text: 'Line ' + node.line + ': ' + before + ' -> ' + after + where
      };
    }

    walk(parsed.program, false);
    return edits;
  }

  // Applies edits to the text. Edits target different commands, so they never overlap;
  // applying from the end keeps the earlier offsets valid.
  function applyEdits(text, edits) {
    var out = typeof text === 'string' ? text : '';
    var list = (Array.isArray(edits) ? edits : []).filter(function (e) {
      return e && typeof e.insert === 'string' && e.start >= 0 && e.end >= e.start && e.end <= out.length;
    }).slice().sort(function (a, b) { return b.start - a.start; });
    for (var i = 0; i < list.length; i++) {
      out = out.slice(0, list[i].start) + list[i].insert + out.slice(list[i].end);
    }
    return out;
  }

  // ---- pair order ------------------------------------------------------------
  // Yields pairs of single edits on different commands in the order
  // (size1 + size2, lower index, higher index), without building every pair.
  function createPairQueue(edits) {
    var sorted = edits.slice().sort(function (a, b) { return a.size - b.size || a.index - b.index; });
    var heap = [];

    function key(a, b) {
      var x = sorted[a], y = sorted[b];
      return [x.size + y.size, Math.min(x.index, y.index), Math.max(x.index, y.index)];
    }
    function less(p, q) {
      if (Math.abs(p.k[0] - q.k[0]) > TIE) return p.k[0] < q.k[0];
      if (p.k[1] !== q.k[1]) return p.k[1] < q.k[1];
      return p.k[2] < q.k[2];
    }
    function push(item) {
      heap.push(item);
      var i = heap.length - 1;
      while (i > 0) {
        var parent = (i - 1) >> 1;
        if (!less(heap[i], heap[parent])) break;
        var t = heap[i]; heap[i] = heap[parent]; heap[parent] = t;
        i = parent;
      }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var i = 0;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          var t = heap[i]; heap[i] = heap[m]; heap[m] = t;
          i = m;
        }
      }
      return top;
    }
    for (var a = 0; a + 1 < sorted.length; a++) push({ a: a, b: a + 1, k: key(a, a + 1) });

    return {
      next: function () {
        while (heap.length) {
          var it = pop();
          if (it.b + 1 < sorted.length) push({ a: it.a, b: it.b + 1, k: key(it.a, it.b + 1) });
          var x = sorted[it.a], y = sorted[it.b];
          if (x.node === y.node) continue;
          var pair = x.index < y.index ? [x, y] : [y, x];
          return { edits: pair, size: x.size + y.size };
        }
        return null;
      }
    };
  }

  // ---- runs and text ---------------------------------------------------------

  function distanceToGoal(level, state) {
    var g = level && level.goal;
    if (!g) return Infinity;
    return Math.hypot(state.x - (g.x + g.w / 2), state.y - (g.y + g.h / 2));
  }

  function summarise(level, sim) {
    var cap = sim.capacity;
    return {
      sim: sim,
      passed: sim.result.status === 'pass',
      t: sim.state.t,
      used: cap - sim.state.charge,
      capacity: cap,
      distance: distanceToGoal(level, sim.state)
    };
  }

  function eventStats(events) {
    var s = { stall: null, slips: 0, peak: 0, limit: 0, hits: 0 };
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === 'stall' && (!s.stall || e.duration > s.stall.duration)) s.stall = e;
      else if (e.type === 'slip') {
        s.slips++;
        if (e.peak > s.peak) { s.peak = e.peak; s.limit = e.limit; }
      } else if (e.type === 'collision') s.hits++;
    }
    return s;
  }

  function times(n) { return n === 1 ? 'once' : n + ' times'; }

  function comparisonLines(before, after) {
    var a = eventStats(before.sim.events), b = eventStats(after.sim.events);
    var lines = [];
    if (a.stall || b.stall) {
      var st = function (s) { return s.stall ? fmt(s.stall.duration, 1) + ' s at ' + fmt(s.stall.current, 2) + ' A' : 'none'; };
      lines.push('Stall: ' + st(a) + ' before, ' + st(b) + ' after.');
    }
    if (a.slips || b.slips) {
      var sl = function (s) {
        return s.slips ? times(s.slips) + ' (peak ' + fmt(s.peak, 2) + ' N, limit ' + fmt(s.limit, 2) + ' N)' : 'none';
      };
      lines.push('Wheel slip: ' + sl(a) + ' before, ' + sl(b) + ' after.');
    }
    if (a.hits || b.hits) {
      var hit = function (n) { return n ? times(n) : 'none'; };
      lines.push('Wall hits: ' + hit(a.hits) + ' before, ' + hit(b.hits) + ' after.');
    }
    return lines;
  }

  function beforeLine(level, before) {
    var sim = before.sim;
    var exp = explainMod.explain({ result: sim.result, events: sim.events, state: sim.state, level: level });
    var root = exp.causes[0];
    var line = 'Before: ' + (root ? root.text : exp.summary);
    // The battery sentence already gives the end time and the charge used.
    if (!root || root.type !== 'battery_flat') {
      line += ' The run ended at ' + fmt(before.t, 1) + ' s after using ' + fmt(before.used, 2) + ' C.';
    }
    return line;
  }

  function afterLine(after) {
    var pct = after.capacity > 0 ? after.used / after.capacity * 100 : 0;
    return 'After: the robot reaches the goal in ' + fmt(after.t, 1) + ' s using ' + fmt(after.used, 2) +
      ' C of ' + fmt(after.capacity, 2) + ' C (' + fmt(pct, 0) + '% of the battery).';
  }

  function failResult(text, message, tried) {
    return { found: false, program: typeof text === 'string' ? text : '', edits: [], explanation: message, tried: tried || 0 };
  }

  // ---- search ---------------------------------------------------------------

  function layoutName(level, i) {
    return level && typeof level.layout === 'string' && level.layout ? level.layout : String.fromCharCode(65 + i);
  }

  // levelArg is one built level, or an array of built levels (the layouts of one level).
  // A candidate passes only if it passes every layout (R8.16).
  function createSearch(levelArg, text) {
    var levels = Array.isArray(levelArg) && levelArg.length ? levelArg : [levelArg];
    var multi = levels.length > 1;
    var level = levels[0];
    var powerInsert = levels.some(function (l) { return !!(l && l.powerMatters === true); });
    var src = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text));
    var cap = LIMITS.CANDIDATE_CAP;

    // Runs a program on every layout. With one layout this is exactly the original summary.
    function summariseAll(program) {
      var runs = levels.map(function (l) { return summarise(l, simMod.runToEnd(l, program)); });
      if (!multi) { runs[0].runs = runs; runs[0].focus = 0; return runs[0]; }
      var focus = 0;
      for (var i = 0; i < runs.length; i++) if (!runs[i].passed) { focus = i; break; }
      var worst = runs.reduce(function (a, r) { return r.used > a.used ? r : a; }, runs[0]);
      return {
        runs: runs, focus: focus, sim: runs[focus].sim,
        passed: runs.every(function (r) { return r.passed; }),
        t: Math.max.apply(null, runs.map(function (r) { return r.t; })),
        used: worst.used, capacity: worst.capacity,
        distance: Math.max.apply(null, runs.map(function (r) { return r.distance; }))
      };
    }

    // Type of the first cause in the explanation of the first failing layout.
    function rootCause(summary) {
      var f = summary.focus, sim = summary.runs[f].sim;
      var exp = explainMod.explain({ result: sim.result, events: sim.events, state: sim.state, level: levels[f] });
      return exp.causes.length ? exp.causes[0].type : null;
    }

    function multiBeforeLine(before) {
      var r = before.runs[before.focus];
      return beforeLine(levels[before.focus], r).replace(/^Before: /, 'Before (layout ' + layoutName(levels[before.focus], before.focus) + '): ');
    }

    function multiAfterLine(after) {
      var pct = after.capacity > 0 ? after.used / after.capacity * 100 : 0;
      return 'After: the robot reaches the goal on all ' + levels.length + ' layouts; the slowest takes ' + fmt(after.t, 1) +
        ' s and the most charge used is ' + fmt(after.used, 2) + ' C of ' + fmt(after.capacity, 2) + ' C (' + fmt(pct, 0) + '% of the battery).';
    }
    var state = {
      phase: 'done', tried: 0, attempts: 0, passedCount: 0, best: null, closest: null,
      singles: [], singleAt: 0, pairs: null, pairSize: null, order: 0, before: null, final: null,
      powerFirst: false, powerEdits: [], powerAt: 0
    };

    function rankLess(a, b) {
      if (a.edits.length !== b.edits.length) return a.edits.length < b.edits.length;
      if (Math.abs(a.size - b.size) > TIE) return a.size < b.size;
      if (a.run.t !== b.run.t) return a.run.t < b.run.t;
      if (a.run.used !== b.run.used) return a.run.used < b.run.used;
      return a.order < b.order;
    }

    // Simulates one candidate. Returns false when the edited text does not parse
    // (for example a wait pushes a big loop over the command limit); that is not counted.
    function evaluate(edits, size) {
      state.attempts++;
      var edited = applyEdits(src, edits);
      var parsed = lang.parse(edited);
      if (!parsed.ok) return false;
      var run = summariseAll(parsed.program);
      state.tried++;
      var cand = { edits: edits, size: size, text: edited, run: run, order: state.order++ };
      if (run.passed) {
        state.passedCount++;
        if (!state.best || rankLess(cand, state.best)) state.best = cand;
      } else if (!state.closest || run.distance < state.closest.run.distance - TIE) {
        state.closest = cand;
      }
      return true;
    }

    function finish() {
      state.phase = 'done';
      state.final = buildResult();
    }

    function buildResult() {
      var best = state.best;
      if (best) {
        var lines = [multi ? multiBeforeLine(state.before) : beforeLine(level, state.before)];
        lines.push('Change: ' + best.edits.map(function (e) { return e.text; }).join('; ') + '.');
        lines.push(multi ? multiAfterLine(best.run) : afterLine(best.run));
        // Compare the same layout before and after (the first one that failed before).
        var f = state.before.focus;
        lines = lines.concat(comparisonLines(state.before.runs[f], best.run.runs[f]));
        if (state.powerFirst) lines.push(POWER_FIRST_LINE);
        lines.push('Tried ' + state.tried + ' changes; ' + state.passedCount + ' passed. This is the smallest change that works.');
        return {
          found: true,
          program: best.text,
          edits: best.edits.map(publicEdit),
          explanation: lines.join('\n'),
          tried: state.tried
        };
      }
      if (!state.singles.length) {
        return failResult(src, 'This program has no distances or turn angles to change, so the coach cannot suggest a fix. ' +
          'Add commands that move the robot toward the goal.', state.tried);
      }
      var msg = 'Tried ' + state.tried + ' small changes to distances, turn angles and waits, and none reached the goal.';
      if (state.tried >= cap) msg += ' The search stopped at its limit of ' + cap + ' changes.';
      if (state.closest && isFinite(state.closest.run.distance)) {
        msg += ' The closest ended ' + fmt(state.closest.run.distance, 2) + ' m from the goal (' +
          state.closest.edits.map(function (e) { return e.text; }).join('; ') + ').';
      }
      msg += ' The program probably needs a different command, not a different number.';
      return failResult(src, msg, state.tried);
    }

    function publicEdit(e) {
      return { line: e.line, kind: e.kind, start: e.start, end: e.end, insert: e.insert, before: e.before, after: e.after, size: e.size, text: e.text };
    }

    // ---- set up ----
    try {
      var parsed = lang.parse(src);
      if (!parsed.ok) {
        var err = parsed.errors[0];
        state.final = failResult(src, (err.line > 0 ? 'Fix the error on line ' + err.line + ' first: ' : 'Fix the program first: ') +
          err.message + ' The coach only changes programs that run.', 0);
      } else {
        if (multi && LIMITS.MULTI_LAYOUT === 'off') {
          state.final = failResult(src, 'No suggestion for multi-layout levels.', 0);
        } else {
          state.before = summariseAll(parsed.program);
          if (state.before.passed) {
            state.final = failResult(src, 'This program already passes' + (level && level.id ? ' level ' + level.id : '') +
              (multi ? ' on all ' + levels.length + ' layouts' : '') +
              ' in ' + fmt(state.before.t, 1) + ' s. Nothing to fix.', 0);
          } else {
            state.singles = generateEdits(src, { powerInsert: powerInsert });
            state.phase = 'singles';
            // R8.18: slip as the root cause on a "power matters" level tries power edits first.
            if (powerInsert && rootCause(state.before) === 'slip') {
              state.powerEdits = state.singles.filter(isPowerEdit);
              if (state.powerEdits.length) { state.powerFirst = true; state.powerAt = 0; state.phase = 'power'; }
            }
          }
        }
      }
    } catch (e) {
      state.final = failResult(src, 'The coach could not search this program.', 0);
      state.phase = 'done';
    }
    if (state.phase === 'singles' && !state.singles.length) finish();

    // Evaluates up to maxCandidates more candidates. Returns true when the search is done.
    function step(maxCandidates) {
      if (state.phase === 'done') return true;
      var budget = maxCandidates > 0 ? Math.floor(maxCandidates) : 1;
      try {
        while (budget > 0 && state.phase !== 'done') {
          if (state.tried >= cap || state.attempts >= ATTEMPT_LIMIT * cap) { finish(); break; }
          if (state.phase === 'singles') {
            if (state.singleAt >= state.singles.length) {
              if (state.best || LIMITS.MAX_EDITS < 2) { finish(); break; }
              state.phase = 'pairs';
              state.pairs = createPairQueue(state.singles);
              continue;
            }
            var e = state.singles[state.singleAt++];
            if (state.powerFirst && isPowerEdit(e)) continue;     // already tried in the power phase
            if (evaluate([e], e.size)) budget--;
          } else if (state.phase === 'power') {
            // R8.18: power edits first; if one passes, the best of them wins.
            if (state.powerAt >= state.powerEdits.length) {
              if (state.best) { finish(); break; }
              state.phase = 'singles';
              continue;
            }
            var pe = state.powerEdits[state.powerAt++];
            if (evaluate([pe], pe.size)) budget--;
          } else {
            var pair = state.pairs.next();
            if (!pair) { finish(); break; }
            // Once a pair passes, only finish pairs of the same combined size.
            if (state.pairSize !== null && pair.size > state.pairSize + TIE) { finish(); break; }
            if (evaluate(pair.edits, pair.size)) {
              budget--;
              if (state.best && state.pairSize === null) state.pairSize = pair.size;
            }
          }
        }
      } catch (err) {
        state.final = failResult(src, 'The coach could not search this program.', state.tried);
        state.phase = 'done';
      }
      return state.phase === 'done';
    }

    return {
      step: step,
      get done() { return state.phase === 'done'; },
      get progress() { return { tried: state.tried, cap: cap, phase: state.phase }; },
      result: function () { return state.phase === 'done' ? state.final : null; }
    };
  }

  // Runs the whole search at once. Same result as stepping createSearch in any chunk sizes.
  function coach(level, text) {
    try {
      var search = createSearch(level, text);
      while (!search.step(500)) { /* each step runs up to 500 candidates; the search always ends */ }
      return search.result() || failResult(text, 'The coach could not search this program.', search.progress.tried);
    } catch (e) {
      return failResult(text, 'The coach could not search this program.', 0);
    }
  }

  var api = {
    LIMITS: LIMITS,
    coach: coach,
    createSearch: createSearch,
    generateEdits: generateEdits,
    applyEdits: applyEdits
  };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.coach = api;
  }
})(typeof self !== 'undefined' ? self : this);
