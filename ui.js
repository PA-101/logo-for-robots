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
    arenaHeight: arenaHeight,
    lineDiff: lineDiff,
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
  function loadLevel(id) {
    app.levelId = id;
    app.level = L.levels.getLevel(id);
    el.hint.textContent = app.level.hint || '';
    app.arena = null;
    sizeArena();
    reset();
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
    lockEditor(false);
    setStatus('', 'READY. Press RUN.');
    renderWhy(null);
    updateReadout();
    draw();
  }

  function run() {
    if (app.running || coachBusy()) return false;
    var parsed = L.lang.parse(el.code.value);
    if (!parsed.ok) {
      showErrors(parsed.errors);
      setStatus('fail', 'PROGRAM ERROR. Fix the line shown on the left.');
      return false;
    }
    var count = L.lang.countCommands(parsed.program);
    showMessage(count + (count === 1 ? ' command' : ' commands') + ' ready.');
    reset();
    app.lastRunText = el.code.value;        // the coach fixes the program that actually ran
    app.sim = L.sim.createSim(app.level, parsed.program);
    app.tel.record(app.sim.state, 0);
    app.running = true;
    app.lastTime = 0;
    lockEditor(true);
    setStatus('', 'RUNNING...');
    return true;
  }

  // Advances the simulation by one fixed step and records what the UI needs.
  function stepOnce() {
    var sim = app.sim;
    sim.step();
    app.stepIndex++;
    app.tel.record(sim.state, app.stepIndex);
    var st = sim.state;
    if (app.stepIndex % 3 === 0) {
      app.trail.push({ x: st.x, y: st.y });
      if (app.trail.length > 900) app.trail.shift();
    }
    var slips = [st.slipL, st.slipR];
    for (var i = 0; i < 2; i++) {
      if (!slips[i]) continue;
      app.slipSeen[i] = st.t;
      var side = i === 0 ? 1 : -1;
      app.skids.push({
        x: st.x - Math.sin(st.theta) * side * C.TRACK / 2,
        y: st.y + Math.cos(st.theta) * side * C.TRACK / 2,
        theta: st.theta, t: st.t
      });
      if (app.skids.length > 600) app.skids.shift();
    }
    if (sim.result.status !== 'running') finishRun();
  }

  function finishRun() {
    app.running = false;
    app.ended = true;
    lockEditor(false);
    var sim = app.sim;
    // One explanation feeds both the status line and the panel.
    var exp = L.explain.explain({ result: sim.result, events: sim.events, state: sim.state, level: app.level });
    var line = statusLine(exp, L.explain.fmt);
    setStatus(line.kind, line.text);
    renderWhy(sim, exp);
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
      '   slip ' + slip + (st.stallTime >= C.STALL_TIME ? '   STALLED' : '');
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

  // ---- "Why did it fail?" panel ----------------------------------------
  function renderWhy(sim, exp) {
    var box = el.why;
    box.textContent = '';
    box.classList.remove('flash', 'flash-pass');
    if (!sim) {
      var idle = document.createElement('p');
      idle.className = 'idle';
      idle.textContent = 'Run a program. If it fails, the reason appears here, with numbers from the run.';
      box.appendChild(idle);
      return;
    }
    var r = exp || L.explain.explain({ result: sim.result, events: sim.events, state: sim.state, level: app.level });
    var head = document.createElement('p');
    head.className = 'verdict ' + (r.verdict === 'PASS' ? 'pass' : 'fail');
    head.textContent = r.verdict + (r.verdict === 'FAIL' ? ': ' + r.title : '');
    box.appendChild(head);
    if (r.verdict === 'PASS' || r.causes.length > 1 || !r.causes.length) {
      var sum = document.createElement('p');
      sum.className = 'summary';
      sum.textContent = r.summary;
      box.appendChild(sum);
    }
    if (r.causes.length) {
      var ol = document.createElement('ol');
      r.causes.forEach(function (c) {
        var li = document.createElement('li');
        var tag = document.createElement('span');
        tag.className = c.root ? 'root' : 'tag';
        tag.textContent = (c.root ? 'LIKELY ROOT CAUSE' : 'ALSO') + ' at ' + L.explain.fmt(c.t, 1) + ' s';
        li.appendChild(tag);
        li.appendChild(document.createTextNode(c.text));
        ol.appendChild(li);
      });
      box.appendChild(ol);
    }
    if (r.verdict === 'FAIL' && app.lastRunText) addCoachButton(box);
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
    app.coach = { search: L.coach.createSearch(app.level, app.lastRunText), text: app.lastRunText };
    lockEditor(true);
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
    lineDiff(original, fixed).forEach(function (row) {
      var num = document.createElement('div');
      num.className = 'num' + (row.changed ? ' changed' : '');
      num.textContent = String(row.line);
      grid.appendChild(num);
      grid.appendChild(cell('code old' + (row.changed ? ' changed' : ''), row.old, row.changed ? '-' : ''));
      grid.appendChild(cell('code new' + (row.changed ? ' changed' : ''), row.new, row.changed ? '+' : ''));
    });
    return grid;
  }

  function applyFix(r, button) {
    el.code.value = r.program;
    app.errorLines = [];
    app.fixLines = r.edits.map(function (e) { return e.line; });
    updateGutter();
    var lines = app.fixLines.filter(function (l, i, a) { return a.indexOf(l) === i; });
    var div = document.createElement('div');
    div.className = 'ok';
    div.textContent = 'Fix applied to line' + (lines.length > 1 ? 's ' : ' ') + lines.join(' and ') + '. Press RUN to try it.';
    el.messages.textContent = '';
    el.messages.appendChild(div);
    button.disabled = true;
    button.textContent = 'APPLIED';
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
    el.batteryFill = $('battery-fill');
    el.batteryPct = $('battery-pct');

    var opts = hashOptions();
    L.levels.LEVELS.forEach(function (def) {
      var o = document.createElement('option');
      o.value = String(def.id);
      o.textContent = def.id + '. ' + def.name;
      el.level.appendChild(o);
    });

    el.code.value = typeof opts.code === 'string' ? opts.code : EXAMPLE_PROGRAM;
    el.code.addEventListener('input', function () { app.errorLines = []; app.fixLines = []; updateGutter(); });
    el.code.addEventListener('scroll', function () { el.gutter.scrollTop = el.code.scrollTop; });
    el.code.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    });
    updateGutter();

    el.run.addEventListener('click', run);
    el.reset.addEventListener('click', function () { reset(); showMessage(''); });
    el.level.addEventListener('change', function () { loadLevel(+el.level.value); });

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

    var startLevel = +opts.level || 1;
    el.level.value = String(L.levels.getLevel(startLevel).id);
    app.graph = setupCanvas(el.graph, el.graph.parentNode.clientWidth || 380, 320);
    loadLevel(+el.level.value);

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
