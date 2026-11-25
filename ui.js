(function (root) {
  'use strict';

  // The only file that touches the DOM. Pure helpers at the top are exported for Node tests;
  // init() runs only in a browser.

  var EXAMPLE_PROGRAM = [
    '; Level 1: First Steps',
    '; Drive down the corridor, turn right,',
    '; and roll into the goal.',
    'forward 200',
    'right 90',
    'forward 100',
    ''
  ].join('\n');

  var SPEEDS = [0.5, 1, 2, 4];
  var MAX_FRAME = 0.25;          // s, longest frame we simulate (hidden tabs, breakpoints)
  var MAX_STEPS_PER_FRAME = 240;

  // Fixed-timestep accumulator. Returns how many simulation steps to run this frame
  // and the time left over. The timestep never changes; speed only scales real time.
  function framePlan(acc, frameSeconds, speed, dt) {
    var f = typeof frameSeconds === 'number' && isFinite(frameSeconds) ? frameSeconds : 0;
    f = Math.max(0, Math.min(MAX_FRAME, f));
    var sp = SPEEDS.indexOf(speed) >= 0 ? speed : 1;
    var a = (typeof acc === 'number' && isFinite(acc) && acc > 0 ? acc : 0) + f * sp;
    var steps = Math.floor(a / dt + 1e-9);
    if (steps > MAX_STEPS_PER_FRAME) { steps = MAX_STEPS_PER_FRAME; a = 0; }
    else a = Math.max(0, a - steps * dt);
    return { steps: steps, acc: a };
  }

  // Scale and offset that fit a level (meters) into a canvas (CSS pixels) with padding.
  function fitTransform(worldW, worldH, canvasW, canvasH, pad) {
    var p = pad || 0;
    var s = Math.min((canvasW - 2 * p) / worldW, (canvasH - 2 * p) / worldH);
    return { s: s, ox: (canvasW - worldW * s) / 2, oy: (canvasH - worldH * s) / 2 };
  }

  // The status line under the arena. Built from the same explain() result as the
  // "Why did it fail?" panel, so both always name the same root cause.
  function statusLine(exp, fmt) {
    var f = typeof fmt === 'function' ? fmt : function (x, d) { return Number(x || 0).toFixed(d); };
    if (!exp || exp.verdict === 'RUNNING') return { kind: '', text: 'RUNNING...' };
    if (exp.verdict === 'PASS') return { kind: 'pass', text: 'PASS: ' + exp.summary };
    var root = exp.causes && exp.causes[0];
    if (!root) return { kind: 'fail', text: 'FAIL: run failed. See "Why did it fail?"' };
    return {
      kind: 'fail',
      text: 'FAIL: ' + exp.title + ' (root cause, at ' + f(root.t, 1) + ' s). See "Why did it fail?"'
    };
  }

  // Line-by-line diff for the coach view. The coach never adds or removes lines, so lines
  // pair up by number; each changed line is split into an unchanged start, the changed
  // middle, and an unchanged end, so only the edited part is highlighted.
  function lineDiff(oldText, newText) {
    var a = String(oldText === undefined || oldText === null ? '' : oldText).split('\n');
    var b = String(newText === undefined || newText === null ? '' : newText).split('\n');
    var rows = [];
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = i < a.length ? a[i] : '', y = i < b.length ? b[i] : '';
      if (x === y) { rows.push({ line: i + 1, changed: false, old: [x, '', ''], new: [y, '', ''] }); continue; }
      var p = 0;
      while (p < x.length && p < y.length && x[p] === y[p]) p++;
      var s = 0;
      while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
      // Widen the changed part to whole words, so "50 -> 100" is not shown as "5 -> 10" plus "0".
      var word = function (ch) { return ch !== undefined && !/\s/.test(ch); };
      while (p > 0 && word(x[p - 1]) && (word(x[p]) || word(y[p]))) p--;
      while (s > 0 && word(x[x.length - s]) && (word(x[x.length - s - 1]) || word(y[y.length - s - 1]))) s--;
      rows.push({
        line: i + 1, changed: true,
        old: [x.slice(0, p), x.slice(p, x.length - s), x.slice(x.length - s)],
        new: [y.slice(0, p), y.slice(p, y.length - s), y.slice(y.length - s)]
      });
    }
    return rows;
  }

  // What the result panel shows for an explain() result (or null before a run / after Reset).
  // Pass: a "RESULT" banner with one line, no causes, no coach. Fail: "WHY DID IT FAIL?" with
  // just the reasons. The wording never depends on earlier runs.
  function resultView(exp, fmt) {
    var f = typeof fmt === 'function' ? fmt : function (x, d) { return Number(x || 0).toFixed(d); };
    if (!exp || (exp.verdict !== 'PASS' && exp.verdict !== 'FAIL')) {
      return { visible: false, heading: '', kind: '', line: '', causes: [], showCoach: false };
    }
    if (exp.verdict === 'PASS') {
      var s = String(exp.summary || 'Reached the goal.');
      return { visible: true, heading: 'RESULT', kind: 'pass', line: 'PASS: ' + s.charAt(0).toLowerCase() + s.slice(1), causes: [], showCoach: false };
    }
    var causes = (exp.causes || []).map(function (c) {
      return { root: !!c.root, text: c.text, tag: (c.root ? 'LIKELY ROOT CAUSE' : 'ALSO') + ' at ' + f(c.t, 1) + ' s' };
    });
    return { visible: true, heading: 'WHY DID IT FAIL?', kind: 'fail', line: causes.length ? '' : String(exp.summary || ''), causes: causes, showCoach: true };
  }

  // Combines per-layout results: the run passes only if every layout passes. "focus" is the
  // first failing layout (the one the panel explains), or the visible one when all pass.
  function combineLayouts(names, results, visible) {
    var list = Array.isArray(results) ? results : [];
    var v = typeof visible === 'number' && visible >= 0 && visible < list.length ? visible : 0;
    var chips = list.map(function (r, i) {
      var name = (names && names[i]) || String.fromCharCode(65 + i);
      var pass = !!(r && r.status === 'pass');
      return { index: i, name: name, pass: pass, text: name + ' ' + (pass ? 'PASS' : 'FAIL'), shown: i === v };
    });
    var firstFail = -1;
    for (var i = 0; i < chips.length; i++) if (!chips[i].pass) { firstFail = i; break; }
    return { multi: chips.length > 1, pass: chips.length > 0 && firstFail < 0, focus: firstFail < 0 ? v : firstFail, chips: chips };
  }

  // Judge shortcuts: each loads a level (like the picker) and a starter program that shows that
  // chapter's lesson when it runs.
  function shortcutList(levelsApi, genApi) {
    var lv = levelsApi || (typeof module !== 'undefined' ? require('./levels.js') : root.LFR.levels);
    var gn = genApi || (typeof module !== 'undefined' ? require('./gen.js') : root.LFR.gen);
    var noPower = function (t) { return t.split('\n').filter(function (l) { return !/^\s*power\b/.test(l); }).join('\n'); };
    var halveLast = function (t) {
      var lines = t.split('\n');
      for (var i = lines.length - 1; i >= 0; i--) {
        var m = /^forward (\d+)$/.exec(lines[i]);
        if (m) { lines[i] = 'forward ' + Math.max(1, Math.round(Number(m[1]) / 2)); break; }
      }
      return lines.join('\n');
    };
    var challenge = function (seed) {
      return {
        label: 'CHALLENGE ' + seed, key: 'c' + seed, match: { seed: seed },
        starter: '; Challenge ' + seed + ': one leg of this route is too short.\n; Run it, then press SUGGEST A FIX.\n' + halveLast(gn.generate(seed).reference) + '\n'
      };
    };
    return [
      { label: 'BASICS', key: '1', match: { chapter: 1 }, starter: EXAMPLE_PROGRAM },
      { label: 'GRIP AND POWER', key: '4', match: { chapter: 2 }, starter: '; Level 4 at full power: watch the wheels slip on the ice.\n; Then press SUGGEST A FIX.\n' + noPower(lv.getLevel(4).reference) + '\n' },
      { label: 'BUMPERS', key: '7', match: { chapter: 3 }, starter: '; Level 7 with distances measured on layout A.\n; Check the layout chips after the run.\nforward 150\nright 90\nforward 50\n' },
      challenge(75),
      challenge(150)
    ];
  }

  // What the export dialog shows for the editor text: the code, or the first parse error.
  // target: 'cpp' (default) or 'micropython'.
  function exportView(text, title, exporter, target) {
    var ex = exporter || (typeof module !== 'undefined' ? require('./export.js') : root.LFR.exporter);
    var r = ex.exportTo ? ex.exportTo(target || 'cpp', text, { title: title }) : ex.toCpp(text, { title: title });
    if (r.ok) return { ok: true, code: r.code, status: 'Ready to copy: ' + r.code.split('\n').length + ' lines.' };
    var e = r.errors[0] || { line: 0, message: 'The program could not be exported.' };
    return { ok: false, code: '', status: 'Fix the program first. ' + (e.line > 0 ? 'Line ' + e.line + ': ' : '') + e.message };
  }

  // Which layout the arena, graph, battery and panel should all show after a run: the first
  // failing layout, or the slowest one when every layout passes. runs: [{ result, state }].
  function layoutToShow(names, runs, visible) {
    var list = Array.isArray(runs) ? runs : [];
    if (!list.length) return 0;
    for (var i = 0; i < list.length; i++) if (!(list[i] && list[i].result && list[i].result.status === 'pass')) return i;
    var slowest = typeof visible === 'number' && list[visible] ? visible : 0;
    for (var j = 0; j < list.length; j++) {
      if (list[j].state.t > list[slowest].state.t) slowest = j;
    }
    return slowest;
  }

  // ---- level picker helpers (pure) -------------------------------------
  var CHALLENGE_VALUE = 'challenge';

  // Option groups for the level <select>: one per chapter, then "Challenge".
  function levelOptions(chapters, defs) {
    var byId = {};
    (defs || []).forEach(function (d) { byId[d.id] = d; });
    var groups = (chapters || []).map(function (ch) {
      return {
        label: 'Chapter ' + ch.id + ': ' + ch.name,
        options: ch.levels.filter(function (id) { return byId[id]; }).map(function (id) {
          return { value: String(id), label: id + '. ' + byId[id].name };
        })
      };
    });
    groups.push({ label: 'Challenge', options: [{ value: CHALLENGE_VALUE, label: 'Challenge mode (seeds 1 to 150)' }] });
    return groups;
  }

  // What a picker value or a #level= hash value means.
  function parseLevelKey(value, seed) {
    if (value === CHALLENGE_VALUE || /^c\d+$/i.test(String(value))) {
      var s = value === CHALLENGE_VALUE ? seed : String(value).slice(1);
      var n = Math.round(Number(s));
      if (!isFinite(n)) n = 1;
      return { kind: 'challenge', seed: Math.max(1, Math.min(150, n)) };
    }
    var id = Math.round(Number(value));
    return { kind: 'level', id: isFinite(id) && id >= 1 ? id : 1 };
  }

  // Title line, objective and hint shown above the arena. The title line is the header, plus the
  // generated facts for challenge levels (for example 'Challenge 97 (seed 97): 7 turns, 1 icy patch').
  function objectiveView(level) {
    if (!level) return { title: '', objective: '', hint: '' };
    var title = headerText(level);
    if (level.chapter === 'challenge' && typeof level.title === 'string') {
      var facts = level.title.replace(/^Challenge \d+:\s*/, '');
      if (facts) title += ': ' + facts;
    }
    return { title: title, objective: level.objective || '', hint: level.hint || '' };
  }

  function headerText(level) {
    if (!level) return '';
    if (level.chapter === 'challenge') return 'Challenge ' + level.seed + ' (seed ' + level.seed + ')';
    return 'Level ' + level.id + ': ' + level.name;
  }

  // The rows the coach diff shows: changed lines plus `context` unchanged lines on each side.
  // Runs of other unchanged lines become one { gap: true, count } row.
  function diffWindow(rows, context) {
    var list = Array.isArray(rows) ? rows : [];
    var c = typeof context === 'number' && context >= 0 ? Math.floor(context) : 1;
    var keep = list.map(function () { return false; });
    list.forEach(function (r, i) {
      if (!r.changed) return;
      for (var k = Math.max(0, i - c); k <= Math.min(list.length - 1, i + c); k++) keep[k] = true;
    });
    var out = [], gap = 0;
    list.forEach(function (r, i) {
      if (keep[i]) {
        if (gap) { out.push({ gap: true, count: gap }); gap = 0; }
        out.push(r);
      } else gap++;
    });
    if (gap) out.push({ gap: true, count: gap });
    return out;
  }

  // ---- UX helpers (pure) -------------------------------------------------

  // Storage key for a built level: '1' to '9', or 'c75' for a challenge seed.
  function levelKeyString(level) {
    if (!level) return '1';
    return level.chapter === 'challenge' ? 'c' + level.seed : String(level.id);
  }

  // Starter text for a level: the passing example on level 1, otherwise the title and objective
  // as comments (comments alone are "nothing to run", so this never runs a hidden solution).
  function starterProgram(level) {
    if (!level || (level.chapter !== 'challenge' && level.id === 1)) return EXAMPLE_PROGRAM;
    var v = objectiveView(level);
    return '; ' + v.title + '\n; Goal: ' + v.objective + '\n; Type your commands below, then press RUN.\n';
  }

  // A small wrapper around localStorage. Every access is inside try/catch: storage can be
  // missing, blocked (privacy settings, file:// in some browsers) or full, and the page must
  // keep working. getStorage is a function because even reading window.localStorage can throw.
  var STORE_PREFIX = 'lfr.';
  function createStore(getStorage) {
    function s() { try { return getStorage(); } catch (e) { return null; } }
    function get(k) { try { var st = s(); return st ? st.getItem(STORE_PREFIX + k) : null; } catch (e) { return null; } }
    function set(k, v) { try { var st = s(); if (st) st.setItem(STORE_PREFIX + k, v); return !!st; } catch (e) { return false; } }
    return {
      getProgram: function (key) { return get('program.' + key); },
      setProgram: function (key, text) { return set('program.' + key, String(text)); },
      getLastLevel: function () { return get('lastLevel'); },
      setLastLevel: function (key) { return set('lastLevel', String(key)); }
    };
  }

  // What the seed field means, and a message when the typed value had to be changed.
  function seedInput(raw) {
    var text = String(raw === undefined || raw === null ? '' : raw).trim();
    var n = Number(text);
    var valid = text !== '' && /^\d+$/.test(text) && n >= 1 && n <= 150;
    var seed = Math.round(n);
    if (!isFinite(seed) || text === '') seed = 1;
    seed = Math.max(1, Math.min(150, seed));
    return { seed: seed, message: valid ? '' : 'Seeds go from 1 to 150, so this is seed ' + seed + '.' };
  }

  // Status line for a program that does not parse.
  function parseErrorStatus(errors) {
    var e = errors && errors[0];
    if (e && e.line === 0 && /^Nothing to run/.test(e.message)) {
      return { kind: 'fail', text: 'NOTHING TO RUN. Type a command, for example forward 50.' };
    }
    return { kind: 'fail', text: 'PROGRAM ERROR. Fix the line shown on the left.' };
  }

  // Which jump-to button matches the current level: same chapter, or the same challenge seed.
  function jumpActiveIndex(list, level) {
    if (!level || !Array.isArray(list)) return -1;
    for (var i = 0; i < list.length; i++) {
      var m = list[i].match || {};
      if (level.chapter === 'challenge' ? m.seed === level.seed : m.chapter === level.chapter) return i;
    }
    return -1;
  }

  // One line that explains layouts, for levels that have several.
  function layoutNote(level) {
    var n = level && level.layoutCount > 1 ? level.layoutCount : 0;
    if (!n) return '';
    var names = [];
    for (var i = 0; i < n; i++) names.push(String.fromCharCode(65 + i));
    return 'This level has ' + n + ' layouts (' + names.join(', ') + ') with different lengths. Your program must pass all of them.';
  }

  var ARENA_PAD = 14;        // CSS px between the canvas edge and the level drawing
  var ARENA_MIN_H = 300;

  // Canvas height for the arena: tall enough to draw the level at the full column width,
  // but no taller (that would only add empty bands) and no taller than the space available.
  function arenaHeight(canvasW, levelW, levelH, availH) {
    var s = (canvasW - 2 * ARENA_PAD) / levelW;
    var needed = Math.ceil(levelH * s + 2 * ARENA_PAD);
    var room = typeof availH === 'number' && isFinite(availH) ? availH : needed;
    return Math.max(ARENA_MIN_H, Math.min(needed, Math.floor(room)));
  }

  var api = {
    EXAMPLE_PROGRAM: EXAMPLE_PROGRAM,
    SPEEDS: SPEEDS,
    ARENA_PAD: ARENA_PAD,
    ARENA_MIN_H: ARENA_MIN_H,
    framePlan: framePlan,
    fitTransform: fitTransform,
    statusLine: statusLine,
    resultView: resultView,
    levelOptions: levelOptions,
    combineLayouts: combineLayouts,
    layoutToShow: layoutToShow,
    parseLevelKey: parseLevelKey,
    headerText: headerText,
    objectiveView: objectiveView,
    exportView: exportView,
    shortcutList: shortcutList,
    levelKeyString: levelKeyString,
    starterProgram: starterProgram,
    createStore: createStore,
    seedInput: seedInput,
    parseErrorStatus: parseErrorStatus,
    jumpActiveIndex: jumpActiveIndex,
    layoutNote: layoutNote,
    CHALLENGE_VALUE: CHALLENGE_VALUE,
    arenaHeight: arenaHeight,
    lineDiff: lineDiff,
    diffWindow: diffWindow,
    COACH_FRAME_MS: 12
  };

  if (typeof module !== 'undefined') {
    module.exports = api;
    return;
  }
  root.LFR = root.LFR || {};
  root.LFR.ui = api;
  if (typeof document === 'undefined') return;

  // ===================================================================
  // Browser only below this line.
  // ===================================================================

  var L = root.LFR;
  var C = L.sim.C;
  var COLORS = {
    bg: '#030603', grid: '#0c2412', wallFill: '#0f3d1c', wallEdge: '#33ff66',
    fg: '#33ff66', dim: '#1a7a33', warn: '#ffb000', fail: '#ff3b30',
    slick: '#0d2e3a', slickLine: '#1d5f75', goal: 'rgba(51,255,102,0.16)'
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var app = {
    level: null, levelId: 1, sim: null, tel: null, speed: 1,
    running: false, acc: 0, stepIndex: 0, lastTime: 0,
    trail: [], skids: [], slipSeen: [-1e9, -1e9], ended: false, errorLines: [],
    lastRunText: '', coach: null, fixLines: []
  };

  // ---- options from the URL hash (for demos and screenshots) -----------
  function hashOptions() {
    var out = {};
    var h = (root.location && root.location.hash || '').replace(/^#/, '');
    h.split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      var k = i < 0 ? part : part.slice(0, i);
      var v = i < 0 ? '' : part.slice(i + 1);
      try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    return out;
  }

  // ---- canvas helpers ---------------------------------------------------
  function setupCanvas(canvas, cssW, cssH) {
    var dpr = Math.max(1, Math.min(3, root.devicePixelRatio || 1));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    return { ctx: canvas.getContext('2d'), w: cssW, h: cssH, dpr: dpr };
  }

  // ---- editor -----------------------------------------------------------
  function updateGutter() {
    var n = el.code.value.split('\n').length;
    var bad = {}, fixed = {};
    app.errorLines.forEach(function (l) { bad[l] = true; });
    app.fixLines.forEach(function (l) { fixed[l] = true; });
    var html = '';
    for (var i = 1; i <= n; i++) {
      var cls = bad[i] ? 'err' : fixed[i] ? 'fix' : '';
      html += (cls ? '<span class="' + cls + '">' + i + '</span>' : String(i)) + (i < n ? '\n' : '');
    }
    el.gutter.innerHTML = html;
    el.gutter.scrollTop = el.code.scrollTop;
  }

  function selectLine(line) {
    var lines = el.code.value.split('\n');
    if (line < 1 || line > lines.length) return;
    var start = 0;
    for (var i = 0; i < line - 1; i++) start += lines[i].length + 1;
    el.code.focus();
    el.code.setSelectionRange(start, start + lines[line - 1].length);
  }

  function showErrors(errors) {
    el.messages.textContent = '';
    app.errorLines = [];
    errors.forEach(function (e) {
      var div = document.createElement('div');
      div.className = 'error';
      div.textContent = (e.line > 0 ? 'Line ' + e.line + ': ' : '') + e.message;
      if (e.line > 0) {
        app.errorLines.push(e.line);
        div.title = 'Go to line ' + e.line;
        div.addEventListener('click', function () { selectLine(e.line); });
      }
      el.messages.appendChild(div);
    });
    updateGutter();
  }

  function showMessage(text) {
    el.messages.innerHTML = '';
    app.errorLines = [];
    if (text) {
      var div = document.createElement('div');
      div.className = 'ok';
      div.textContent = text;
      el.messages.appendChild(div);
    }
    updateGutter();
  }

  function lockEditor(locked) {
    el.code.readOnly = locked;
    el.run.disabled = locked;
    el.level.disabled = locked;
  }

  // ---- simulation control ----------------------------------------------
  // key: { kind: 'level', id } or { kind: 'challenge', seed }
  // options.text: put this text in the editor instead of the remembered program or the starter.
  function loadLevel(key, options) {
    if (typeof key !== 'object' || !key) key = parseLevelKey(key);
    if (app.levelKey && !app.running) app.store.setProgram(app.levelKey, el.code.value);
    if (key.kind === 'challenge') {
      var def = L.gen.generate(key.seed);
      // Built levels do not carry the seed; keep it for the header.
      app.level = Object.assign(L.levels.buildLevel(def), { seed: def.seed, chapter: 'challenge', facts: def.facts });
      app.layouts = [app.level];
      app.seed = def.seed;
      el.seed.value = String(def.seed);
      el.level.value = CHALLENGE_VALUE;
    } else {
      app.level = L.levels.getLevel(key.id);
      app.layouts = L.levels.getLayouts(app.level.id);
      el.level.value = String(app.level.id);
    }
    app.levelId = app.level.id;
    app.visibleLayout = 0;
    el.seedRow.hidden = key.kind !== 'challenge';
    var view = objectiveView(app.level);
    el.levelTitle.textContent = view.title;
    el.levelObjective.textContent = view.objective;
    el.hintBox.open = false;
    el.hint.textContent = app.level.hint || '';
    el.layoutNote.textContent = layoutNote(app.level);
    el.layoutNote.hidden = !el.layoutNote.textContent;
    el.seedNote.textContent = '';
    app.levelKey = levelKeyString(app.level);
    app.store.setLastLevel(app.levelKey);
    var text = options && typeof options.text === 'string' ? options.text : app.store.getProgram(app.levelKey);
    el.code.value = typeof text === 'string' ? text : starterProgram(app.level);
    app.errorLines = [];
    app.fixLines = [];
    app.undoText = null;
    updateGutter();
    showMessage('');
    markJump();
    app.arena = null;
    sizeArena();
    reset();
  }

  // Highlights the jump-to button for the current chapter or challenge seed.
  function markJump() {
    var i = jumpActiveIndex(app.shortcuts || [], app.level);
    Array.prototype.forEach.call(document.querySelectorAll('#shortcuts .btn'), function (b, k) {
      b.classList.toggle('active', k === i);
      b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
  }

  function reset() {
    app.running = false;
    app.ended = false;
    app.acc = 0;
    app.stepIndex = 0;
    app.sim = L.sim.createSim(app.level, []);
    app.tel = L.telemetry.createTelemetry();
    app.trail = [];
    app.skids = [];
    app.slipSeen = [-1e9, -1e9];
    app.coach = null;                       // Reset cancels a coach search in progress
    if (el.chips) renderChips(null);
    setLayoutLabels('');
    lockEditor(false);
    setStatus('', 'READY. Press RUN.');
    renderWhy(null);
    updateReadout();
    draw();
  }

  // Runs the editor program. On levels with layouts, layoutIndex picks the layout shown in the
  // arena (A by default); the other layouts are simulated instantly when the run ends.
  function run(layoutIndex) {
    if (app.running || coachBusy()) return false;
    var li = typeof layoutIndex === 'number' && app.layouts && app.layouts[layoutIndex] ? layoutIndex : 0;
    app.visibleLayout = li;
    if (app.layouts && app.layouts[li]) app.level = app.layouts[li];
    var parsed = L.lang.parse(el.code.value);
    if (!parsed.ok) {
      showErrors(parsed.errors);
      var pe = parseErrorStatus(parsed.errors);
      setStatus(pe.kind, pe.text);
      return false;
    }
    var count = L.lang.countCommands(parsed.program);
    reset();
    showMessage(count + (count === 1 ? ' command' : ' commands') + ' running. The editor is locked while the robot runs; press RESET to stop and edit.');
    app.lastRunText = el.code.value;        // the coach fixes the program that actually ran
    app.lastProgram = parsed.program;
    if (app.layouts && app.layouts.length > 1) setLayoutLabels(app.level.layout);
    app.sim = L.sim.createSim(app.level, parsed.program);
    app.tel.record(app.sim.state, 0);
    app.running = true;
    app.lastTime = 0;
    lockEditor(true);
    setStatus('', 'RUNNING...');
    return true;
  }

  // Advances the simulation by one fixed step and records what the UI needs.
  // Advances a sim by one step and records what the arena and graph draw into rec
  // ({ sim, tel, stepIndex, trail, skids, slipSeen }). Used for the live run and for replays.
  function recordStep(rec) {
    var sim = rec.sim;
    sim.step();
    rec.stepIndex++;
    rec.tel.record(sim.state, rec.stepIndex);
    var st = sim.state;
    if (rec.stepIndex % 3 === 0) {
      rec.trail.push({ x: st.x, y: st.y });
      if (rec.trail.length > 900) rec.trail.shift();
    }
    var slips = [st.slipL, st.slipR];
    for (var i = 0; i < 2; i++) {
      if (!slips[i]) continue;
      rec.slipSeen[i] = st.t;
      var side = i === 0 ? 1 : -1;
      rec.skids.push({
        x: st.x - Math.sin(st.theta) * side * C.TRACK / 2,
        y: st.y + Math.cos(st.theta) * side * C.TRACK / 2,
        theta: st.theta, t: st.t
      });
      if (rec.skids.length > 600) rec.skids.shift();
    }
  }

  function stepOnce() {
    recordStep(app);
    if (app.sim.result.status !== 'running') finishRun();
  }

  // Simulates a layout to the end while recording telemetry and the trail, so it can be shown
  // in the arena and graph. The simulation is deterministic, so this equals a live run.
  function simulateRecorded(level, program) {
    var rec = {
      sim: L.sim.createSim(level, program), tel: L.telemetry.createTelemetry(),
      stepIndex: 0, trail: [], skids: [], slipSeen: [-1e9, -1e9]
    };
    rec.tel.record(rec.sim.state, 0);
    var limit = Math.ceil(((level && level.timeLimit) || 60) / C.DT) + 240;
    for (var i = 0; i < limit && rec.sim.result.status === 'running'; i++) recordStep(rec);
    return rec;
  }

  function finishRun() {
    app.running = false;
    app.ended = true;
    lockEditor(false);
    showMessage('');
    var layouts = app.layouts && app.layouts.length ? app.layouts : [app.level];
    // The visible layout ran in the arena; the others run instantly (about 1 ms each).
    var sims = layouts.map(function (l, i) {
      return i === app.visibleLayout ? app.sim : L.sim.runToEnd(l, app.lastProgram);
    });
    var names = layouts.map(function (l) { return l.layout; });
    var results = sims.map(function (s) { return s.result; });
    // The layout the panel talks about: the first failing one, or the slowest when all pass.
    var show = layoutToShow(names, sims, app.visibleLayout);
    if (show !== app.visibleLayout) {
      // Show that layout in the arena, graph and battery too, so all of them agree.
      var rec = simulateRecorded(layouts[show], app.lastProgram);
      app.sim = rec.sim; app.tel = rec.tel; app.stepIndex = rec.stepIndex;
      app.trail = rec.trail; app.skids = rec.skids; app.slipSeen = rec.slipSeen;
      app.level = layouts[show];
      app.visibleLayout = show;
      sims[show] = rec.sim;
    }
    var combined = combineLayouts(names, results, show);
    var sim = sims[combined.focus], level = layouts[combined.focus];
    var layoutName = combined.chips[combined.focus].name;
    // One explanation feeds both the status line and the panel.
    var exp = L.explain.explain({ result: sim.result, events: sim.events, state: sim.state, level: level });
    var line = statusLine(exp, L.explain.fmt);
    if (combined.multi && !combined.pass) line.text = line.text.replace(/^FAIL: /, 'FAIL: layout ' + layoutName + ': ');
    if (combined.multi && combined.pass) line.text = line.text.replace(/^PASS: /, 'PASS on all ' + combined.chips.length + ' layouts. Slowest, layout ' + layoutName + ': ');
    setStatus(line.kind, line.text);
    renderChips(combined);
    setLayoutLabels(combined.multi ? layoutName : '');
    app.combined = combined;
    renderWhy(sim, exp, combined.multi ? (combined.pass ? 'Slowest layout: ' + layoutName + '.' : 'Layout ' + layoutName + ':') : '');
  }

  // "TELEMETRY (layout B)" and "BATTERY (layout B)" on multi-layout levels, empty otherwise.
  function setLayoutLabels(name) {
    var text = name ? ' (layout ' + name + ')' : '';
    if (el.telemetryLayout) el.telemetryLayout.textContent = text;
    if (el.batteryLayout) el.batteryLayout.textContent = text;
  }

  function renderChips(combined) {
    var box = el.chips;
    box.textContent = '';
    box.hidden = !combined || !combined.multi;
    if (box.hidden) return;
    var lab = document.createElement('span');
    lab.className = 'label';
    lab.textContent = 'LAYOUTS';
    box.appendChild(lab);
    combined.chips.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small chip ' + (c.pass ? 'pass' : 'fail') + (c.shown ? ' shown' : '');
      b.textContent = c.text;
      b.title = 'Replay layout ' + c.name + ' in the arena';
      b.addEventListener('click', function () { run(c.index); });
      box.appendChild(b);
    });
  }

  function setStatus(kind, text) {
    el.status.textContent = '';
    var span = document.createElement('span');
    if (kind) span.className = kind;
    span.textContent = text;
    el.status.appendChild(span);
  }

  function updateReadout() {
    var st = app.sim.state;
    var f = L.explain.fmt;
    var slip = st.slipL && st.slipR ? 'BOTH WHEELS' : st.slipL ? 'LEFT WHEEL' : st.slipR ? 'RIGHT WHEEL' : 'no';
    el.readout.textContent =
      't ' + f(st.t, 1) + ' s   speed ' + f(Math.abs(st.v), 2) + ' m/s   current ' + f(st.current, 2) +
      ' A   battery ' + f(st.Vt, 2) + ' V\n' +
      'sensor ' + f(st.sensor, 2) + ' m   wall-ahead ' + (st.sensor < C.WALL_AHEAD_DIST ? 'YES' : 'no') +
      '   slip ' + slip + '   power ' + f((st.power || 1) * 100, 0) + '%' +
      (st.bumper ? '   BUMPER' : '') + (st.stallTime >= C.STALL_TIME ? '   STALLED' : '');
  }

  // ---- main loop --------------------------------------------------------
  function frame(now) {
    if (app.running) {
      var seconds = app.lastTime ? (now - app.lastTime) / 1000 : 0;
      var plan = framePlan(app.acc, seconds, app.speed, C.DT);
      app.acc = plan.acc;
      for (var i = 0; i < plan.steps && app.running; i++) stepOnce();
    }
    if (coachBusy()) stepCoach();
    app.lastTime = now;
    updateReadout();
    draw();
    root.requestAnimationFrame(frame);
  }

  function draw() {
    fitCanvases();
    drawArena();
    drawGraph();
    updateBattery();
  }

  // ---- arena drawing ----------------------------------------------------
  function drawArena() {
    var A = app.arena, ctx = A.ctx, lvl = app.level, st = app.sim.state;
    var T = fitTransform(lvl.width, lvl.height, A.w, A.h, ARENA_PAD);
    var px = 1 / T.s;                       // one CSS pixel in meters
    ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, A.w, A.h);
    // world transform: meters, y-up
    ctx.setTransform(T.s * A.dpr, 0, 0, -T.s * A.dpr, T.ox * A.dpr, (T.oy + lvl.height * T.s) * A.dpr);

    // floor grid every 0.25 m
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = px;
    ctx.beginPath();
    for (var gx = 0; gx <= lvl.width + 1e-9; gx += 0.25) { ctx.moveTo(gx, 0); ctx.lineTo(gx, lvl.height); }
    for (var gy = 0; gy <= lvl.height + 1e-9; gy += 0.25) { ctx.moveTo(0, gy); ctx.lineTo(lvl.width, gy); }
    ctx.stroke();

    // slick floor: hatched
    lvl.slick.forEach(function (r) {
      ctx.fillStyle = COLORS.slick;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.strokeStyle = COLORS.slickLine;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      for (var d = -r.h; d < r.w; d += 0.06) { ctx.moveTo(r.x + d, r.y); ctx.lineTo(r.x + d + r.h, r.y + r.h); }
      ctx.stroke();
      ctx.restore();
    });

    // goal: filled cell with a target
    var g = lvl.goal;
    var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
    ctx.fillStyle = COLORS.goal;
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = COLORS.fg;
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(g.x + 2 * px, g.y + 2 * px, g.w - 4 * px, g.h - 4 * px);
    ctx.globalAlpha = 0.35 + 0.4 * pulse;
    ctx.beginPath();
    ctx.arc(g.x + g.w / 2, g.y + g.h / 2, g.w * 0.28, 0, Math.PI * 2);
    ctx.moveTo(g.x + g.w / 2 + g.w * 0.12, g.y + g.h / 2);
    ctx.arc(g.x + g.w / 2, g.y + g.h / 2, g.w * 0.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawWalls(ctx, lvl, px);

    // skid marks fade over 4 s of simulated time
    app.skids.forEach(function (k) {
      var age = st.t - k.t;
      if (age > 4) return;
      ctx.globalAlpha = 0.75 * (1 - age / 4);
      ctx.strokeStyle = COLORS.warn;
      ctx.lineWidth = 5 * px;
      ctx.beginPath();
      ctx.moveTo(k.x - Math.cos(k.theta) * 0.03, k.y - Math.sin(k.theta) * 0.03);
      ctx.lineTo(k.x + Math.cos(k.theta) * 0.03, k.y + Math.sin(k.theta) * 0.03);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // fading trail: older points are dimmer
    var tr = app.trail;
    ctx.strokeStyle = COLORS.fg;
    ctx.lineWidth = 2 * px;
    ctx.lineCap = 'round';
    for (var i = 1; i < tr.length; i++) {
      ctx.globalAlpha = 0.06 + 0.6 * (i / tr.length);
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    if (tr.length) {
      ctx.globalAlpha = 0.66;
      ctx.beginPath();
      ctx.moveTo(tr[tr.length - 1].x, tr[tr.length - 1].y);
      ctx.lineTo(st.x, st.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    drawRay(ctx, st, px);
    drawRobot(ctx, st, px);
  }

  function drawWalls(ctx, lvl, px) {
    var cell = lvl.cell, solid = {};
    var key = function (cx, cy) { return cx + ',' + cy; };
    lvl.walls.forEach(function (r) { solid[key(Math.round(r.x / cell), Math.round(r.y / cell))] = true; });
    ctx.fillStyle = COLORS.wallFill;
    lvl.walls.forEach(function (r) { ctx.fillRect(r.x, r.y, r.w, r.h); });
    // outline only the edges that face open floor
    ctx.strokeStyle = COLORS.wallEdge;
    ctx.lineWidth = 2 * px;
    ctx.shadowColor = COLORS.fg;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    lvl.walls.forEach(function (r) {
      var cx = Math.round(r.x / cell), cy = Math.round(r.y / cell);
      var inside = function (x, y) { return x >= 0 && y >= 0 && x * cell < lvl.width - 1e-9 && y * cell < lvl.height - 1e-9; };
      if (inside(cx - 1, cy) && !solid[key(cx - 1, cy)]) { ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); }
      if (inside(cx + 1, cy) && !solid[key(cx + 1, cy)]) { ctx.moveTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); }
      if (inside(cx, cy - 1) && !solid[key(cx, cy - 1)]) { ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y); }
      if (inside(cx, cy + 1) && !solid[key(cx, cy + 1)]) { ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); }
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawRay(ctx, st, px) {
    var dx = Math.cos(st.theta), dy = Math.sin(st.theta);
    var close = st.sensor < C.WALL_AHEAD_DIST;
    var start = 0.09;
    ctx.strokeStyle = close ? COLORS.warn : COLORS.fg;
    ctx.globalAlpha = close ? 0.95 : 0.55;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(st.x + dx * start, st.y + dy * start);
    ctx.lineTo(st.x + dx * Math.max(start, st.sensor), st.y + dy * Math.max(start, st.sensor));
    ctx.stroke();
    ctx.setLineDash([]);
    if (st.sensor < C.SENSOR_RANGE) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(st.x + dx * st.sensor, st.y + dy * st.sensor, 3.5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // A small turtle-style robot: shell, head, and two visible wheels.
  function drawRobot(ctx, st, px) {
    var stalled = st.stallTime >= C.STALL_TIME;
    var blink = Math.floor(Date.now() / 150) % 2 === 0;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.theta);

    // wheels (left is +y in the robot frame)
    var wheelLen = 2 * C.WHEEL_R + 0.012, wheelW = 0.026;
    [1, -1].forEach(function (side, i) {
      var slipping = (i === 0 ? st.slipL : st.slipR) || st.t - app.slipSeen[i] < 0.3;
      var cy = side * (C.TRACK / 2 + 0.004);
      ctx.fillStyle = slipping ? COLORS.warn : '#0b1f10';
      ctx.strokeStyle = slipping ? COLORS.warn : COLORS.fg;
      ctx.shadowColor = slipping ? COLORS.warn : COLORS.fg;
      ctx.shadowBlur = slipping ? 14 : 4;
      ctx.lineWidth = 1.5 * px;
      ctx.fillRect(-wheelLen / 2, cy - wheelW / 2, wheelLen, wheelW);
      ctx.strokeRect(-wheelLen / 2, cy - wheelW / 2, wheelLen, wheelW);
      // tread lines
      ctx.shadowBlur = 0;
      ctx.strokeStyle = slipping ? '#5a3a00' : COLORS.dim;
      ctx.beginPath();
      for (var k = -2; k <= 2; k++) {
        ctx.moveTo(k * wheelLen / 6, cy - wheelW / 2);
        ctx.lineTo(k * wheelLen / 6, cy + wheelW / 2);
      }
      ctx.stroke();
    });

    // front bumper: an arc ahead of the head, amber while pressed
    ctx.shadowBlur = st.bumper ? 12 : 0;
    ctx.shadowColor = COLORS.warn;
    ctx.strokeStyle = st.bumper ? COLORS.warn : COLORS.dim;
    ctx.lineWidth = (st.bumper ? 3 : 2) * px;
    ctx.beginPath();
    ctx.arc(0, 0, C.BODY_R - 1.5 * px, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // head
    ctx.shadowColor = COLORS.fg;
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#0f3d1c';
    ctx.strokeStyle = COLORS.fg;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(0.082, 0, 0.026, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // eyes
    ctx.fillStyle = COLORS.fg;
    ctx.beginPath();
    ctx.arc(0.092, 0.011, 2 * px, 0, Math.PI * 2);
    ctx.arc(0.092, -0.011, 2 * px, 0, Math.PI * 2);
    ctx.fill();

    // shell
    ctx.fillStyle = '#0f3d1c';
    ctx.strokeStyle = stalled && blink ? COLORS.fail : COLORS.fg;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.074, 0.062, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // shell pattern: a hexagon and spokes
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2 * px;
    ctx.beginPath();
    for (var h = 0; h <= 6; h++) {
      var a = h * Math.PI / 3;
      var hx = Math.cos(a) * 0.03, hy = Math.sin(a) * 0.026;
      if (h === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    for (var s = 0; s < 6; s++) {
      var b = s * Math.PI / 3;
      ctx.moveTo(Math.cos(b) * 0.03, Math.sin(b) * 0.026);
      ctx.lineTo(Math.cos(b) * 0.066, Math.sin(b) * 0.055);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- telemetry graph --------------------------------------------------
  // Three stacked strips (speed, current, battery). Labels live in the left and bottom
  // margins, so no text is drawn over the plotted lines.
  var GRAPH = { left: 92, right: 10, top: 8, bottom: 26, gap: 12, font: '14px ' + 'Consolas, "Cascadia Mono", "Courier New", monospace' };

  function niceStep(span) {
    var raw = span / 5;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  function drawGraph() {
    var G = app.graph, ctx = G.ctx;
    var samples = app.tel.samples;
    var b = L.telemetry.plotBounds(samples);
    // Use the level time limit as the time axis so the graph shows the whole time budget.
    var tMin = 0, tMax = Math.max(app.level.timeLimit || 0, b.tMax);
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, G.w, G.h);
    ctx.font = GRAPH.font;
    ctx.textBaseline = 'middle';

    var x0 = GRAPH.left, x1 = G.w - GRAPH.right;
    var stripH = (G.h - GRAPH.top - GRAPH.bottom - 2 * GRAPH.gap) / 3;
    var X = function (t) { return x0 + (t - tMin) / (tMax - tMin) * (x1 - x0); };
    var stalledNow = app.sim.state.stallTime >= C.STALL_TIME && app.running;
    var blink = Math.floor(Date.now() / 160) % 2 === 0;

    var strips = [
      { name: 'SPEED', unit: 'm/s', key: 'speed', max: b.speedMax, color: COLORS.fg, digits: 1 },
      { name: 'CURRENT', unit: 'A', key: 'current', max: b.currentMax, color: COLORS.warn, digits: 1,
        alarm: stalledNow && blink },
      { name: 'BATTERY', unit: '%', key: 'charge', max: 1, color: COLORS.fg, dashed: true, digits: 0, scale: 100 }
    ];

    strips.forEach(function (s, idx) {
      var top = GRAPH.top + idx * (stripH + GRAPH.gap), bottom = top + stripH;
      var Y = function (v) { return bottom - Math.max(0, Math.min(1, v / s.max)) * stripH; };

      // frame and a faint middle line
      ctx.strokeStyle = s.alarm ? COLORS.fail : COLORS.dim;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, stripH - 1);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, Math.round((top + bottom) / 2) + 0.5);
      ctx.lineTo(x1 - 1, Math.round((top + bottom) / 2) + 0.5);
      ctx.stroke();

      // labels in the left margin: name, unit, and the axis range
      ctx.textAlign = 'left';
      ctx.fillStyle = s.alarm ? COLORS.fail : s.color;
      ctx.fillText(s.name, 4, top + 9);
      ctx.fillStyle = '#7fd99a';
      ctx.fillText(s.unit, 4, top + 27);
      ctx.textAlign = 'right';
      ctx.fillText(L.explain.fmt(s.max * (s.scale || 1), s.digits), x0 - 6, top + 9);
      ctx.fillText('0', x0 - 6, bottom - 8);

      // the series, clipped to the strip
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 1, top + 1, x1 - x0 - 2, stripH - 2);
      ctx.clip();
      if (s.key === 'speed') {
        // amber ticks along the bottom where a wheel slipped
        ctx.fillStyle = COLORS.warn;
        samples.forEach(function (p) { if (p.slip) ctx.fillRect(X(p.t) - 1, bottom - 7, 3, 6); });
      }
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(s.dashed ? [6, 4] : []);
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 4;
      // Draw runs of same-coloured samples as one path, so dashes stay continuous.
      // The motor-current line turns red while the robot is stalled, and flashes while it lasts.
      var colorOf = function (p) { return s.key === 'current' && (p.stall || s.alarm) ? COLORS.fail : s.color; };
      var i = 1;
      while (i < samples.length) {
        var col = colorOf(samples[i]);
        ctx.strokeStyle = col;
        ctx.shadowColor = col;
        ctx.beginPath();
        ctx.moveTo(X(samples[i - 1].t), Y(samples[i - 1][s.key]));
        while (i < samples.length && colorOf(samples[i]) === col) {
          ctx.lineTo(X(samples[i].t), Y(samples[i][s.key]));
          i++;
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.setLineDash([]);
    });

    // time axis in the bottom margin
    var axisY = G.h - GRAPH.bottom + 6;
    var step = niceStep(tMax - tMin);
    ctx.fillStyle = '#7fd99a';
    ctx.strokeStyle = COLORS.dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var t = 0; t <= tMax + 1e-9; t += step) {
      var x = Math.round(X(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, axisY - 6);
      ctx.lineTo(x, axisY - 2);
      ctx.stroke();
      if (x < x1 - 20) ctx.fillText(String(Math.round(t)), x, axisY);
    }
    ctx.textAlign = 'right';
    ctx.fillText('s', x1, axisY);
    ctx.textAlign = 'left';
    ctx.fillText('time', 4, axisY);
  }

  // ---- battery gauge ----------------------------------------------------
  function updateBattery() {
    var st = app.sim.state;
    var pct = Math.max(0, Math.min(1, st.soc)) * 100;
    var kind = pct < 10 ? 'fail' : pct < 30 ? 'warn' : '';
    el.batteryFill.style.width = pct.toFixed(1) + '%';
    el.batteryFill.className = 'battery-fill' + (kind ? ' ' + kind : '');
    el.batteryPct.className = 'battery-pct' + (kind ? ' ' + kind : '');
    el.batteryPct.textContent = (kind === 'fail' ? 'LOW ' : kind === 'warn' ? 'WARN ' : '') +
      L.explain.fmt(pct, 0) + '%  ' + L.explain.fmt(st.Vt, 2) + ' V';
  }

  // ---- result panel ("RESULT" on pass, "WHY DID IT FAIL?" on failure) ------
  function renderWhy(sim, exp, layoutNote) {
    var box = el.why;
    box.textContent = '';
    box.classList.remove('flash', 'flash-pass');
    var r = sim ? (exp || L.explain.explain({ result: sim.result, events: sim.events, state: sim.state, level: app.level })) : null;
    var view = resultView(r, L.explain.fmt);
    el.resultPanel.hidden = !view.visible;
    if (!view.visible) return;
    el.resultHead.textContent = view.heading;
    el.resultPanel.className = 'result-panel ' + view.kind;
    if (view.kind === 'pass') {
      var line = document.createElement('p');
      line.className = 'verdict pass';
      line.textContent = view.line;
      box.appendChild(line);
      if (layoutNote) {
        var passNote = document.createElement('p');
        passNote.className = 'layout-note pass';
        passNote.textContent = layoutNote;
        box.appendChild(passNote);
      }
    } else if (view.causes.length) {
      if (layoutNote) {
        var note = document.createElement('p');
        note.className = 'layout-note';
        note.textContent = layoutNote;
        box.appendChild(note);
      }
      var ol = document.createElement('ol');
      view.causes.forEach(function (c) {
        var li = document.createElement('li');
        var tag = document.createElement('span');
        tag.className = c.root ? 'root' : 'tag';
        tag.textContent = c.tag;
        li.appendChild(tag);
        li.appendChild(document.createTextNode(c.text));
        ol.appendChild(li);
      });
      box.appendChild(ol);
    } else {
      var only = document.createElement('p');
      only.textContent = view.line;
      box.appendChild(only);
    }
    if (view.showCoach && app.lastRunText) addCoachButton(box);
    void box.offsetWidth; // restart the highlight animation
    box.classList.add(r.verdict === 'PASS' ? 'flash-pass' : 'flash');
  }

  // ---- Auto-Fix Coach -----------------------------------------------------
  // The coach tries small changes to the numbers in the program and simulates each one.
  function coachBusy() { return !!(app.coach && !app.coach.search.done); }

  function addCoachButton(box) {
    var wrap = document.createElement('div');
    wrap.className = 'coach';
    wrap.id = 'coach';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'SUGGEST A FIX';
    btn.addEventListener('click', startCoach);
    var note = document.createElement('p');
    note.className = 'coach-note';
    note.textContent = 'The coach tries small changes to your distances, turns and waits, and simulates each one.';
    wrap.appendChild(btn);
    wrap.appendChild(note);
    box.appendChild(wrap);
  }

  function startCoach() {
    if (app.running || coachBusy() || !app.lastRunText) return;
    // Multi-layout levels: a fix must pass every layout (R8.16).
    var target = app.layouts && app.layouts.length > 1 ? app.layouts : app.level;
    app.coach = { search: L.coach.createSearch(target, app.lastRunText), text: app.lastRunText };
    lockEditor(true);
    showMessage('The editor is locked while the coach tries changes; press RESET to stop.');
    renderCoachProgress();
    if (app.coach.search.done) finishCoach();   // parse errors and "nothing to change" end at once
  }

  // Runs as many candidates as fit in about 12 ms, so the page stays responsive.
  function stepCoach() {
    var search = app.coach.search;
    var t0 = root.performance.now();
    do { search.step(1); } while (!search.done && root.performance.now() - t0 < api.COACH_FRAME_MS);
    if (search.done) finishCoach();
    else renderCoachProgress();
  }

  function coachBox() { return $('coach'); }

  function renderCoachProgress() {
    var box = coachBox();
    if (!box) return;
    var p = app.coach.search.progress;
    box.textContent = '';
    var line = document.createElement('p');
    line.className = 'coach-progress';
    line.textContent = 'Trying changes... ' + p.tried + ' / ' + p.cap;
    box.appendChild(line);
  }

  function finishCoach() {
    lockEditor(false);
    showMessage('');
    var result = app.coach.search.result();
    app.coach.result = result;
    renderCoachResult(result, app.coach.text);
  }

  function renderCoachResult(r, original) {
    var box = coachBox();
    if (!box || !r) return;
    box.textContent = '';
    var head = document.createElement('p');
    head.className = 'coach-head ' + (r.found ? 'found' : 'none');
    head.textContent = r.found ? 'SUGGESTED FIX' : 'NO FIX FOUND';
    box.appendChild(head);

    if (r.found) box.appendChild(diffView(original, r.program));

    // Explanation lines, with the "Before:", "Change:", ... label set apart.
    r.explanation.split('\n').forEach(function (text) {
      var p = document.createElement('p');
      p.className = 'coach-line';
      var m = /^([A-Z][A-Za-z ]{1,12}):\s/.exec(text);
      if (m) {
        var lab = document.createElement('span');
        lab.className = 'coach-label';
        lab.textContent = m[1] + ': ';
        p.appendChild(lab);
        p.appendChild(document.createTextNode(text.slice(m[0].length)));
      } else {
        p.textContent = text;
      }
      box.appendChild(p);
    });

    if (r.found) {
      var apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'btn primary';
      apply.textContent = 'APPLY FIX';
      apply.addEventListener('click', function () { applyFix(r, apply); });
      box.appendChild(apply);
    }
  }

  // Original and suggested program side by side. Rows stay aligned when long lines wrap;
  // changed lines carry "-" and "+" markers as well as colour.
  function diffView(original, fixed) {
    var grid = document.createElement('div');
    grid.className = 'diff';
    grid.setAttribute('role', 'table');
    grid.setAttribute('aria-label', 'Your program and the suggested fix');
    function cell(cls, parts, marker) {
      var d = document.createElement('div');
      d.className = cls;
      d.setAttribute('role', 'cell');
      if (marker) {
        var mk = document.createElement('span');
        mk.className = 'mark';
        mk.textContent = marker + ' ';
        d.appendChild(mk);
      }
      d.appendChild(document.createTextNode(parts[0]));
      if (parts[1]) {
        var hi = document.createElement(marker === '-' ? 'del' : 'ins');
        hi.textContent = parts[1];
        d.appendChild(hi);
      }
      d.appendChild(document.createTextNode(parts[2]));
      return d;
    }
    [['', 'YOUR PROGRAM', 'SUGGESTED']].forEach(function (h) {
      h.forEach(function (t, i) {
        var d = document.createElement('div');
        d.className = 'diff-head' + (i === 0 ? ' num' : '');
        d.setAttribute('role', 'columnheader');
        d.textContent = t;
        grid.appendChild(d);
      });
    });
    // Only the changed lines and one line of context; the rest folds into "N lines unchanged".
    diffWindow(lineDiff(original, fixed), 1).forEach(function (row) {
      if (row.gap) {
        var g = document.createElement('div');
        g.className = 'diff-gap';
        g.setAttribute('role', 'cell');
        g.textContent = row.count + (row.count === 1 ? ' line' : ' lines') + ' unchanged';
        grid.appendChild(g);
        return;
      }
      var num = document.createElement('div');
      num.className = 'num' + (row.changed ? ' changed' : '');
      num.textContent = String(row.line);
      grid.appendChild(num);
      grid.appendChild(cell('code old' + (row.changed ? ' changed' : ''), row.old, row.changed ? '-' : ''));
      grid.appendChild(cell('code new' + (row.changed ? ' changed' : ''), row.new, row.changed ? '+' : ''));
    });
    return grid;
  }

  // Puts the fix in the editor, clears the old result (it belonged to the old program), and
  // offers UNDO to bring the previous program back.
  function applyFix(r) {
    app.undoText = el.code.value;
    reset();
    el.code.value = r.program;
    app.store.setProgram(app.levelKey, r.program);
    app.errorLines = [];
    app.fixLines = r.edits.map(function (e) { return e.line; });
    updateGutter();
    var lines = app.fixLines.filter(function (l, i, a) { return a.indexOf(l) === i; });
    el.messages.textContent = '';
    var div = document.createElement('div');
    div.className = 'ok';
    div.textContent = 'Fix applied to line' + (lines.length > 1 ? 's ' : ' ') + lines.join(' and ') + '. Press RUN to try it.';
    var undo = document.createElement('button');
    undo.type = 'button';
    undo.id = 'undo-fix';
    undo.className = 'btn small undo-btn';
    undo.textContent = 'UNDO';
    undo.title = 'Put the previous program back';
    undo.addEventListener('click', function () {
      if (app.running || app.undoText === null) return;
      el.code.value = app.undoText;
      app.store.setProgram(app.levelKey, app.undoText);
      app.undoText = null;
      app.fixLines = [];
      showMessage('Previous program restored.');
      el.code.focus();
    });
    div.appendChild(document.createTextNode(' '));
    div.appendChild(undo);
    el.messages.appendChild(div);
    el.code.focus();
  }

  // Keeps canvas pixel sizes matched to their containers (layout can change after load).
  function fitCanvases() {
    var gw = el.graph.parentNode.clientWidth;
    if (gw && Math.abs(gw - app.graph.w) > 0.5) app.graph = setupCanvas(el.graph, gw, app.graph.h);
    sizeArena();
  }

  // Sizes the arena canvas to the column width and the free space down to the bottom of
  // the window, keeping room for the legend, status and readout below it.
  function sizeArena() {
    var screen = el.arena.parentNode, panel = $('arena-panel');
    var w = screen.clientWidth || 600;
    var screenRect = screen.getBoundingClientRect();
    var below = panel.getBoundingClientRect().bottom - screenRect.bottom;  // legend, status, readout
    var top = screenRect.top + (root.scrollY || 0);
    var avail = (root.innerHeight || 900) - top - below - 24;
    var h = arenaHeight(w, app.level.width, app.level.height, avail);
    if (!app.arena || Math.abs(w - app.arena.w) > 0.5 || Math.abs(h - app.arena.h) > 0.5) {
      app.arena = setupCanvas(el.arena, w, h);
    }
  }

  // ---- boot animation ---------------------------------------------------
  function boot(skip) {
    var overlay = $('boot'), text = $('boot-text');
    var title = 'LOGO FOR ROBOTS';
    var done = false, timer = null, i = 0;
    function finish() {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      text.textContent = title;
      overlay.classList.add('done');
      setTimeout(function () { overlay.style.display = 'none'; }, 300);
    }
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (skip || reduced) { finish(); return; }
    overlay.addEventListener('click', finish);
    root.addEventListener('keydown', finish, { once: true });
    // 15 characters at 75 ms = 1.1 s, then a 0.45 s hold: 1.6 s in total.
    (function type() {
      text.textContent = title.slice(0, i);
      if (i++ < title.length) timer = setTimeout(type, 75);
      else timer = setTimeout(finish, 450);
    })();
  }

  // ---- wiring -------------------------------------------------------------
  function init() {
    ['code', 'gutter', 'run', 'reset', 'messages', 'level', 'arena', 'graph', 'status', 'readout', 'why']
      .forEach(function (id) { el[id] = $(id); });
    el.hint = $('level-hint');
    el.resultPanel = $('result-panel');
    el.resultHead = $('result-head');
    el.batteryFill = $('battery-fill');
    el.batteryPct = $('battery-pct');

    app.store = createStore(function () { return root.localStorage; });
    el.seed = $('seed');
    el.seedNote = $('seed-note');
    el.layoutNote = $('layout-note');
    el.seedRow = $('seed-row');
    el.levelTitle = $('level-title');
    el.chips = $('layout-chips');
    el.telemetryLayout = $('telemetry-layout');
    el.batteryLayout = $('battery-layout');
    el.levelObjective = $('level-objective');
    el.hintBox = $('hint-box');

    var opts = hashOptions();
    levelOptions(L.levels.CHAPTERS, L.levels.ALL_LEVELS).forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g.label;
      g.options.forEach(function (op) {
        var o = document.createElement('option');
        o.value = op.value;
        o.textContent = op.label;
        og.appendChild(o);
      });
      el.level.appendChild(og);
    });
    app.seed = 1;
    function loadSeed(s) { loadLevel({ kind: 'challenge', seed: L.gen.clampSeed(s) }); }
    el.seed.addEventListener('change', function () {
      var si = seedInput(el.seed.value);
      loadSeed(si.seed);
      el.seedNote.textContent = si.message;
    });
    $('seed-prev').addEventListener('click', function () { loadSeed(app.seed <= 1 ? 150 : app.seed - 1); });
    $('seed-next').addEventListener('click', function () { loadSeed(app.seed >= 150 ? 1 : app.seed + 1); });
    app.loadSeed = loadSeed;

    el.code.value = typeof opts.code === 'string' ? opts.code : EXAMPLE_PROGRAM;
    el.code.addEventListener('input', function () {
      app.errorLines = []; app.fixLines = []; updateGutter();
      if (app.levelKey) app.store.setProgram(app.levelKey, el.code.value);   // remember per level
    });
    el.code.addEventListener('scroll', function () { el.gutter.scrollTop = el.code.scrollTop; });
    el.code.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    });
    updateGutter();

    el.run.addEventListener('click', function () { run(); });

    // Judge shortcuts: load the level the same way the picker does, plus a starter program.
    var sc = $('shortcuts');
    app.shortcuts = shortcutList(L.levels, L.gen);
    app.shortcuts.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = s.label;
      b.addEventListener('click', function () {
        if (app.running || coachBusy()) return;
        loadLevel(parseLevelKey(s.key), { text: s.starter });
        if (app.levelKey) app.store.setProgram(app.levelKey, s.starter);
      });
      sc.appendChild(b);
    });

    // Export dialog: plain C++ for the program in the editor, with a Copy button.
    var dlg = $('export-dialog'), exCode = $('export-code'), exStatus = $('export-status'), exCopy = $('export-copy');
    var exTarget = $('export-target');
    function fillExport() {
      var v = exportView(el.code.value, headerText(app.level), null, exTarget.value);
      exCode.value = v.code;
      exCode.hidden = !v.ok;
      exCopy.disabled = !v.ok;
      exStatus.textContent = v.status;
      exStatus.className = 'export-status' + (v.ok ? '' : ' error');
      return v;
    }
    exTarget.addEventListener('change', fillExport);
    $('export').addEventListener('click', function () {
      var v = fillExport();
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      (v.ok ? exCopy : $('export-close')).focus();
    });
    // Keep Tab and Shift+Tab inside the open dialog. Esc closes it (native), and focus goes
    // back to the export button.
    dlg.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(dlg.querySelectorAll('button, textarea, select, summary, [tabindex]'), function (n) {
        return !n.disabled && !n.hidden && n.getClientRects().length > 0 && n.tabIndex >= 0;
      });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (items.indexOf(document.activeElement) < 0) { e.preventDefault(); first.focus(); }
    });
    dlg.addEventListener('close', function () { $('export').focus(); });
    $('export-close').addEventListener('click', function () {
      if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    });
    exCopy.addEventListener('click', function () {
      function selected() {
        exCode.focus();
        exCode.select();
        var ok = false;
        try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { ok = false; }
        exStatus.textContent = ok ? 'Copied to the clipboard.' : 'The code is selected. Press Ctrl+C to copy it.';
      }
      if (root.navigator && root.navigator.clipboard && root.isSecureContext) {
        root.navigator.clipboard.writeText(exCode.value).then(function () {
          exStatus.textContent = 'Copied to the clipboard.';
        }, selected);
      } else {
        selected();
      }
    });
    el.reset.addEventListener('click', function () { reset(); showMessage(''); });
    el.level.addEventListener('change', function () { loadLevel(parseLevelKey(el.level.value, app.seed)); });

    var speedButtons = document.querySelectorAll('[data-speed]');
    function setSpeed(v) {
      app.speed = SPEEDS.indexOf(v) >= 0 ? v : 1;
      Array.prototype.forEach.call(speedButtons, function (b) {
        var on = +b.getAttribute('data-speed') === app.speed;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    Array.prototype.forEach.call(speedButtons, function (b) {
      b.addEventListener('click', function () { setSpeed(+b.getAttribute('data-speed')); });
    });
    setSpeed(opts.speed ? +opts.speed : 1);

    app.graph = setupCanvas(el.graph, el.graph.parentNode.clientWidth || 380, 320);
    // Start level: #level=4, #level=challenge&seed=75 or #level=c75; otherwise the last level
    // used (remembered in localStorage); otherwise level 1. #code= overrides the editor text.
    var startLevel = opts.level || app.store.getLastLevel() || '1';
    loadLevel(parseLevelKey(startLevel, opts.seed), typeof opts.code === 'string' ? { text: opts.code } : undefined);

    boot('autorun' in opts || 'skipboot' in opts);
    if ('autorun' in opts && run()) {
      // Optional fast-forward for screenshots: #autorun&t=SECONDS
      var until = +opts.t || 0;
      while (app.running && app.sim.state.t < until) stepOnce();
    }
    root.requestAnimationFrame(frame);
    document.body.setAttribute('data-ready', '1');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof self !== 'undefined' ? self : this);
