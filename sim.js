(function (root) {
  'use strict';

  // Deterministic robot simulation at a fixed 60 Hz timestep. No DOM access.
  // Constants, battery, motor model, wheel slip, body integration, wall collisions,
  // distance sensor, program interpreter, goal / timeout results.

  var C = {
    DT: 1 / 60,
    MASS: 2.0,            // kg
    BODY_R: 0.10,         // m
    TRACK: 0.16,          // m, distance between wheels
    WHEEL_R: 0.03,        // m
    I_YAW: 0.01,          // kg m^2
    J_WHEEL: 0.0005,      // kg m^2
    MOTOR_R: 12,          // ohm
    KE: 0.277,            // V s/rad
    KT: 0.277,            // N m/A
    DRAG_V: 0.5,          // N s/m
    DRAG_W: 0.002,        // N m s/rad
    G: 9.81,              // m/s^2
    MU: 0.6,
    V_FULL: 7.4,          // V
    V_EMPTY: 6.0,         // V
    R_INT: 0.8,           // ohm
    DEFAULT_CAPACITY: 10, // C, used when a level gives none
    SLIP_REGRIP_SPEED: 0.02,  // m/s
    SLIP_MERGE_TIME: 0.25,    // s, slip bursts closer than this are one event
    SENSOR_RANGE: 1.0,        // m
    WALL_AHEAD_DIST: 0.35,    // m, wall-ahead is true below this sensor distance
    CRUISE_DUTY: 0.8,
    TURN_DUTY: 0.6,
    BRAKE_TAU: 0.13,          // s
    TURN_BRAKE_TAU: 0.10,     // s
    STALL_SPEED: 0.02,        // m/s
    STALL_TIME: 0.5,          // s
    SAMPLE_EVERY: 6           // steps per telemetry sample (10 Hz)
  };
  C.N_WHEEL = C.MASS * C.G / 2;                 // normal force per wheel
  C.V_NL = C.WHEEL_R * C.V_FULL / C.KE;         // no-load speed on a full battery

  var MAX_EVENTS = 500;

  function sign(x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function noLoadSpeed() { return C.V_NL; }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // Distance along a ray to a rectangle (slab method), or Infinity.
  function rayRect(ox, oy, dx, dy, r) {
    var tmin = 0, tmax = Infinity, t1, t2, tmp;
    if (Math.abs(dx) < 1e-12) {
      if (ox < r.x || ox > r.x + r.w) return Infinity;
    } else {
      t1 = (r.x - ox) / dx; t2 = (r.x + r.w - ox) / dx;
      if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
    if (Math.abs(dy) < 1e-12) {
      if (oy < r.y || oy > r.y + r.h) return Infinity;
    } else {
      t1 = (r.y - oy) / dy; t2 = (r.y + r.h - oy) / dy;
      if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
    return tmin;
  }

  // If the circle (x, y, radius) overlaps rectangle r, returns the push-out normal and depth.
  function overlap(x, y, radius, r) {
    var px = clamp(x, r.x, r.x + r.w), py = clamp(y, r.y, r.y + r.h);
    var dx = x - px, dy = y - py;
    var d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) return null;
    if (d2 > 1e-18) {
      var d = Math.sqrt(d2);
      return { nx: dx / d, ny: dy / d, pen: radius - d };
    }
    // Centre is inside the rectangle: leave through the nearest edge.
    var dl = x - r.x, dr = r.x + r.w - x, db = y - r.y, dt = r.y + r.h - y;
    var m = Math.min(dl, dr, db, dt);
    if (m === dl) return { nx: -1, ny: 0, pen: radius + dl };
    if (m === dr) return { nx: 1, ny: 0, pen: radius + dr };
    if (m === db) return { nx: 0, ny: -1, pen: radius + db };
    return { nx: 0, ny: 1, pen: radius + dt };
  }
  function createSim(level, program, opts) {
    opts = opts || {};
    level = level || {};
    var capacity = level.capacity > 0 ? level.capacity : C.DEFAULT_CAPACITY;
    var baseMu = level.mu > 0 ? level.mu : C.MU;
    var slickMu = level.slickMu > 0 ? level.slickMu : baseMu;
    var slick = level.slick || [];
    var walls = level.walls || [];
    var goal = level.goal || null;
    var timeLimit = level.timeLimit > 0 ? level.timeLimit : Infinity;
    var start = level.start || { x: 0, y: 0, theta: 0 };

    var state = {
      t: 0, steps: 0,
      x: start.x, y: start.y, theta: start.theta || 0,
      v: 0, w: 0, wL: 0, wR: 0,
      uL: 0, uR: 0,
      charge: capacity, soc: 1,
      Voc: C.V_FULL, Vt: C.V_FULL,
      current: 0, draw: 0,
      slipL: false, slipR: false,
      contact: false, sensor: C.SENSOR_RANGE,
      stallTime: 0, programDone: false
    };

    var events = [];
    var result = { status: 'running', reason: null };
    var slipEv = [null, null];       // latest slip event per wheel
    var slipEnd = [-1e9, -1e9];      // time the wheel last stopped slipping
    var slipOn = [false, false];
    var stallEv = null;

    function addEvent(ev, force) {
      if (!force && events.length >= MAX_EVENTS) return ev;
      events.push(ev);
      return ev;
    }

    function muAt(x, y) {
      for (var i = 0; i < slick.length; i++) if (inRect(x, y, slick[i])) return slickMu;
      return baseMu;
    }

    function finish(status, reason) {
      result.status = status;
      result.reason = reason;
    }

    // ---- sensor -------------------------------------------------------
    function sensorDistance() {
      var dx = Math.cos(state.theta), dy = Math.sin(state.theta);
      var best = C.SENSOR_RANGE;
      for (var i = 0; i < walls.length; i++) {
        var d = rayRect(state.x, state.y, dx, dy, walls[i]);
        if (d < best) best = d;
      }
      return best;
    }

    function wallAhead() { return sensorDistance() < C.WALL_AHEAD_DIST; }

    // ---- program interpreter -----------------------------------------
    var stack = [];
    var active = null;
    if (Array.isArray(program)) stack.push({ nodes: program, i: 0, remaining: 1 });

    // Takes the next executable node off the stack and makes it the active command.
    function fetch() {
      var guard = 0;
      while (stack.length && guard++ < 100000) {
        var top = stack[stack.length - 1];
        if (top.i >= top.nodes.length) {
          top.remaining--;
          if (top.remaining > 0) top.i = 0; else stack.pop();
          continue;
        }
        var node = top.nodes[top.i++];
        if (!node || typeof node !== 'object') continue;
        var n = +node.n;
        if (!(n >= 0)) n = 0;
        switch (node.type) {
          case 'repeat':
            if (Array.isArray(node.body) && stack.length < 64) {
              stack.push({ nodes: node.body, i: 0, remaining: Math.floor(n) });
            }
            continue;
          case 'if':
            if (Array.isArray(node.body) && stack.length < 64 && wallAhead()) {
              stack.push({ nodes: node.body, i: 0, remaining: 1 });
            }
            continue;
          case 'forward':
          case 'back':
            return { kind: 'move', d: node.type === 'forward' ? 1 : -1, target: n / 100, done: 0, braking: false };
          case 'left':
          case 'right':
            return { kind: 'turn', d: node.type === 'left' ? 1 : -1, target: n * Math.PI / 180, done: 0, braking: false };
          case 'wait':
            return { kind: 'wait', left: n };
          default:
            continue;
        }
      }
      return null;
    }

    // Runs the active command for one step. Returns duties, or null when the command finished.
    function runActive(cmd) {
      var settled = Math.abs(state.w) < 0.05 && Math.abs(state.v) < 0.02;
      var rem;
      if (cmd.kind === 'move') {
        cmd.done += cmd.d * state.v * C.DT;
        rem = cmd.target - cmd.done;
        if (!cmd.braking && rem <= C.BRAKE_TAU * Math.abs(state.v) + 0.005) cmd.braking = true;
        if (cmd.braking) return settled ? null : [0, 0];
        return [cmd.d * C.CRUISE_DUTY, cmd.d * C.CRUISE_DUTY];
      }
      if (cmd.kind === 'turn') {
        cmd.done += cmd.d * state.w * C.DT;
        rem = cmd.target - cmd.done;
        if (!cmd.braking && rem <= C.TURN_BRAKE_TAU * Math.abs(state.w) + 0.01) cmd.braking = true;
        if (cmd.braking) return settled ? null : [0, 0];
        return [-cmd.d * C.TURN_DUTY, cmd.d * C.TURN_DUTY];
      }
      cmd.left -= C.DT;
      return cmd.left <= 0 ? null : [0, 0];
    }

    // Chooses the duties for this step.
    function controller() {
      if (typeof opts.duties === 'function') {
        var d = opts.duties(sim) || [0, 0];
        return [clamp(+d[0] || 0, -1, 1), clamp(+d[1] || 0, -1, 1)];
      }
      var guard = 0;
      while (guard++ < 1000) {
        if (!active) {
          active = fetch();
          if (!active) { state.programDone = true; return [0, 0]; }
        }
        var out = runActive(active);
        if (out) return out;
        active = null;
      }
      return [0, 0];
    }
    function step() {
      if (result.status !== 'running') return;
      state.steps++;
      state.t = state.steps * C.DT;
      var DT = C.DT;

      // 1. controller
      var duty = controller();
      state.uL = duty[0];
      state.uR = duty[1];

      // 2. battery voltage (sag from the previous step's draw)
      state.soc = Math.max(0, Math.min(1, state.charge / capacity));
      state.Voc = C.V_EMPTY + (C.V_FULL - C.V_EMPTY) * state.soc;
      state.Vt = Math.max(0, state.Voc - C.R_INT * state.draw);

      // 3. motors
      var u = [state.uL, state.uR];
      var vGround = [state.v - state.w * C.TRACK / 2, state.v + state.w * C.TRACK / 2];
      var wheel = [state.wL, state.wR];
      var F = [0, 0], tau = [0, 0], I = [0, 0];
      var draw = 0, current = 0;
      var i;
      for (i = 0; i < 2; i++) {
        if (!slipOn[i]) wheel[i] = vGround[i] / C.WHEEL_R;
        var V = u[i] * state.Vt;
        I[i] = (V - C.KE * wheel[i]) / C.MOTOR_R;
        tau[i] = C.KT * I[i];
        F[i] = tau[i] / C.WHEEL_R;
        current += Math.abs(I[i]);
        if (u[i] !== 0) draw += Math.max(0, I[i] * sign(V));
      }

      // 4. ground contact and slip
      var mu = muAt(state.x, state.y);
      var Flim = mu * C.N_WHEEL;
      var Fg = [0, 0];
      for (i = 0; i < 2; i++) {
        var wasSlipping = slipOn[i];
        var rel = wheel[i] * C.WHEEL_R - vGround[i];
        if (!wasSlipping && Math.abs(F[i]) <= Flim) {
          Fg[i] = F[i];
          continue;
        }
        if (!wasSlipping) {
          slipOn[i] = true;
          if (slipEv[i] && state.t - slipEnd[i] < C.SLIP_MERGE_TIME) {
            slipEv[i].peak = Math.max(slipEv[i].peak, Math.abs(F[i]));
            slipEv[i].limit = Flim;
          } else {
            slipEv[i] = addEvent({
              type: 'slip', t: state.t, wheel: i === 0 ? 'L' : 'R',
              required: Math.abs(F[i]), limit: Flim, mu: mu, peak: Math.abs(F[i])
            });
          }
        }
        var s = sign(rel) || sign(F[i]);
        Fg[i] = Flim * s;
        var wNew = wheel[i] + DT * (tau[i] - C.WHEEL_R * Fg[i]) / C.J_WHEEL;
        var relNew = wNew * C.WHEEL_R - vGround[i];
        if (wasSlipping && Math.abs(F[i]) <= Flim &&
            (rel * relNew <= 0 || Math.abs(relNew) < C.SLIP_REGRIP_SPEED)) {
          slipOn[i] = false;
          slipEnd[i] = state.t;
          wheel[i] = vGround[i] / C.WHEEL_R;
          Fg[i] = F[i];
        } else {
          wheel[i] = wNew;
          if (slipEv[i]) slipEv[i].peak = Math.max(slipEv[i].peak, Math.abs(F[i]));
        }
      }
      state.wL = wheel[0];
      state.wR = wheel[1];
      state.slipL = slipOn[0];
      state.slipR = slipOn[1];

      // 5. body (semi-implicit Euler)
      state.v += DT * (Fg[0] + Fg[1] - C.DRAG_V * state.v) / C.MASS;
      state.w += DT * ((Fg[1] - Fg[0]) * C.TRACK / 2 - C.DRAG_W * state.w) / C.I_YAW;
      state.theta += DT * state.w;
      state.x += DT * state.v * Math.cos(state.theta);
      state.y += DT * state.v * Math.sin(state.theta);

      // 6. walls
      var wasContact = state.contact;
      var touching = false, impact = 0;
      for (var pass = 0; pass < 3; pass++) {
        var moved = false;
        for (var k = 0; k < walls.length; k++) {
          var o = overlap(state.x, state.y, C.BODY_R, walls[k]);
          if (!o) continue;
          moved = true;
          touching = true;
          state.x += o.nx * o.pen;
          state.y += o.ny * o.pen;
          var cs = Math.cos(state.theta), sn = Math.sin(state.theta);
          var vx = state.v * cs, vy = state.v * sn;
          var vn = vx * o.nx + vy * o.ny;
          if (vn < 0) {
            impact = Math.max(impact, -vn);
            vx -= vn * o.nx;
            vy -= vn * o.ny;
            state.v = vx * cs + vy * sn;
          }
        }
        if (!moved) break;
      }
      state.contact = touching;
      if (touching && !wasContact && impact > 0.05) {
        addEvent({ type: 'collision', t: state.t, speed: impact });
      }

      // 7. stall detection
      state.current = current;
      if (touching && Math.max(Math.abs(state.uL), Math.abs(state.uR)) > 0.2 && Math.abs(state.v) < C.STALL_SPEED) {
        state.stallTime += DT;
        if (stallEv) {
          stallEv.duration = state.stallTime;
          stallEv.current = current;
          stallEv.duty = Math.max(Math.abs(state.uL), Math.abs(state.uR));
        } else if (state.stallTime >= C.STALL_TIME - 1e-9) {
          stallEv = addEvent({
            type: 'stall', t: state.t, duration: state.stallTime, current: current,
            duty: Math.max(Math.abs(state.uL), Math.abs(state.uR))
          });
        }
      } else {
        state.stallTime = 0;
        stallEv = null;
      }

      // 8. battery
      state.draw = draw;
      state.charge = Math.max(0, state.charge - draw * DT);
      state.soc = state.charge / capacity;
      if (state.charge <= 0) {
        state.uL = 0;
        state.uR = 0;
        addEvent({ type: 'battery_flat', t: state.t, charge_used: capacity }, true);
        finish('fail', 'battery_flat');
      }

      state.sensor = sensorDistance();
      if (result.status !== 'running') return;

      // 9. goal, timeout, end of program
      if (goal && inRect(state.x, state.y, goal)) {
        addEvent({ type: 'goal', t: state.t }, true);
        finish('pass', 'goal');
        return;
      }
      var gx = goal ? goal.x + goal.w / 2 : state.x, gy = goal ? goal.y + goal.h / 2 : state.y;
      var distToGoal = Math.sqrt((state.x - gx) * (state.x - gx) + (state.y - gy) * (state.y - gy));
      if (state.t >= timeLimit - 1e-9) {
        addEvent({ type: 'timeout', t: state.t, limit: timeLimit, distance_to_goal: distToGoal }, true);
        finish('fail', 'timeout');
        return;
      }
      if (state.programDone && Math.abs(state.v) < C.STALL_SPEED && Math.abs(state.w) < 0.05) {
        addEvent({ type: 'program_ended', t: state.t, distance_to_goal: distToGoal }, true);
        finish('fail', 'program_ended');
      }
    }

    var sim = {
      state: state,
      events: events,
      result: result,
      level: level,
      capacity: capacity,
      step: step,
      sensorDistance: sensorDistance,
      wallAhead: wallAhead
    };
    state.sensor = sensorDistance();
    return sim;
  }

  // Runs a program on a level until the run ends (or maxSteps). Returns the finished sim.
  function runToEnd(level, program, maxSteps) {
    var sim = createSim(level, program);
    var limit = maxSteps > 0 ? maxSteps : Math.ceil(((level && level.timeLimit) || 60) / C.DT) + 120;
    for (var i = 0; i < limit && sim.result.status === 'running'; i++) sim.step();
    return sim;
  }
  var api = { C: C, createSim: createSim, runToEnd: runToEnd, noLoadSpeed: noLoadSpeed };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.sim = api;
  }
})(typeof self !== 'undefined' ? self : this);
