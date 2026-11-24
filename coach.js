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
    WAITS: [0.5, 1]
  };
  var TIE = 1e-9;             // sizes closer than this count as equal
  var ATTEMPT_LIMIT = 4;      // at most 4 * cap edited texts are built, counting ones that do not parse

  // ---- edits ---------------------------------------------------------------

  // All single edits for a program text, in generation order (design.md section 11).
  function generateEdits(text) {
    if (typeof text !== 'string') return [];
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
        var isMove = node.type === 'forward' || node.type === 'back';
        var isTurn = node.type === 'left' || node.type === 'right';
        if (!isMove && !isTurn) continue;
        var id = nodeIndex++;
        var numText = text.slice(node.numStart, node.numEnd);
        var before = node.type + ' ' + numText;
        var where = inLoop ? ' (inside a repeat, so it changes every pass)' : '';
        var k, n2;
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

  function createSearch(level, text) {
    var src = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text));
    var cap = LIMITS.CANDIDATE_CAP;
    var state = {
      phase: 'done', tried: 0, attempts: 0, passedCount: 0, best: null, closest: null,
      singles: [], singleAt: 0, pairs: null, pairSize: null, order: 0, before: null, final: null
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
      var run = summarise(level, simMod.runToEnd(level, parsed.program));
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
        var lines = [beforeLine(level, state.before)];
        lines.push('Change: ' + best.edits.map(function (e) { return e.text; }).join('; ') + '.');
        lines.push(afterLine(best.run));
        lines = lines.concat(comparisonLines(state.before, best.run));
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
        state.before = summarise(level, simMod.runToEnd(level, parsed.program));
        if (state.before.passed) {
          state.final = failResult(src, 'This program already passes' + (level && level.id ? ' level ' + level.id : '') +
            ' in ' + fmt(state.before.t, 1) + ' s. Nothing to fix.', 0);
        } else {
          state.singles = generateEdits(src);
          state.phase = 'singles';
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
            if (evaluate([e], e.size)) budget--;
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
