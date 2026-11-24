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

  var api = {
    EXAMPLE_PROGRAM: EXAMPLE_PROGRAM,
    SPEEDS: SPEEDS,
    framePlan: framePlan,
    fitTransform: fitTransform
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
    trail: [], skids: [], slipSeen: [-1e9, -1e9], ended: false, errorLines: []
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
    var bad = {};
    app.errorLines.forEach(function (l) { bad[l] = true; });
    var html = '';
    for (var i = 1; i <= n; i++) {
      html += (bad[i] ? '<span class="err">' + i + '</span>' : String(i)) + (i < n ? '\n' : '');
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
    var aspect = app.level.height / app.level.width;
    var w = el.arena.parentNode.clientWidth || 600;
    app.arena = setupCanvas(el.arena, w, Math.round(Math.max(260, Math.min(440, w * aspect + 40))));
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
    lockEditor(false);
    setStatus('', 'READY. Press RUN.');
    renderWhy(null);
    updateReadout();
    draw();
  }

  function run() {
    if (app.running) return;
    var parsed = L.lang.parse(el.code.value);
    if (!parsed.ok) {
      showErrors(parsed.errors);
      setStatus('fail', 'PROGRAM ERROR. Fix the line shown on the left.');
      return false;
    }
    showMessage(L.lang.countCommands(parsed.program) + ' commands ready.');
    reset();
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
    var r = app.sim.result;
    if (r.status === 'pass') setStatus('pass', 'PASS: goal reached in ' + L.explain.fmt(app.sim.state.t, 1) + ' s.');
    else setStatus('fail', 'FAIL: ' + failLabel(r.reason) + '. See "Why did it fail?"');
    renderWhy(app.sim);
  }

  function failLabel(reason) {
    return {
      battery_flat: 'battery ran flat', timeout: 'out of time', program_ended: 'program ended before the goal'
    }[reason] || 'run failed';
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
    app.lastTime = now;
    updateReadout();
    draw();
    root.requestAnimationFrame(frame);
  }

  function draw() {
    drawArena();
    drawGraph();
    updateBattery();
  }

  // ---- arena drawing ----------------------------------------------------
  function drawArena() {
    var A = app.arena, ctx = A.ctx, lvl = app.level, st = app.sim.state;
    var T = fitTransform(lvl.width, lvl.height, A.w, A.h, 14);
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
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.moveTo(k.x - Math.cos(k.theta) * 0.015, k.y - Math.sin(k.theta) * 0.015);
      ctx.lineTo(k.x + Math.cos(k.theta) * 0.015, k.y + Math.sin(k.theta) * 0.015);
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

  // ---- task 13: graph, battery gauge, failure panel ---------------------
  function drawGraph() {}
  function updateBattery() {}
  function renderWhy() {}

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
    el.code.addEventListener('input', function () { app.errorLines = []; updateGutter(); });
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
    app.graph = setupCanvas(el.graph, el.graph.parentNode.clientWidth || 380, 300);
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
