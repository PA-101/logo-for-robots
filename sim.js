(function (root) {
  'use strict';

  // Deterministic robot simulation at a fixed 60 Hz timestep. No DOM access.
  // Part 1 (task 5): constants, battery, motor model, wheel slip, body integration.

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
    SLIP_MERGE_TIME: 0.25     // s, slip bursts closer than this are one event
  };
  C.N_WHEEL = C.MASS * C.G / 2;                 // normal force per wheel
  C.V_NL = C.WHEEL_R * C.V_FULL / C.KE;         // no-load speed on a full battery

  var MAX_EVENTS = 500;

  function sign(x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function noLoadSpeed() { return C.V_NL; }

  function createSim(level, program, opts) {
    opts = opts || {};
    level = level || {};
    var capacity = level.capacity > 0 ? level.capacity : C.DEFAULT_CAPACITY;
    var baseMu = level.mu > 0 ? level.mu : C.MU;
    var slickMu = level.slickMu > 0 ? level.slickMu : baseMu;
    var slick = level.slick || [];
    var start = level.start || { x: 0, y: 0, theta: 0 };

    var state = {
      t: 0, steps: 0,
      x: start.x, y: start.y, theta: start.theta || 0,
      v: 0, w: 0, wL: 0, wR: 0,
      uL: 0, uR: 0,
      charge: capacity, soc: 1,
      Voc: C.V_FULL, Vt: C.V_FULL,
      current: 0, draw: 0,
      slipL: false, slipR: false
    };

    var events = [];
    var result = { status: 'running', reason: null };
    var slipEv = [null, null];       // latest slip event per wheel
    var slipEnd = [-1e9, -1e9];      // time the wheel last stopped slipping
    var slipOn = [false, false];

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

    // Chooses the duties for this step. Task 5 only has the test hook.
    function controller() {
      if (typeof opts.duties === 'function') {
        var d = opts.duties(sim) || [0, 0];
        return [Math.max(-1, Math.min(1, +d[0] || 0)), Math.max(-1, Math.min(1, +d[1] || 0))];
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

      state.current = current;

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
    }

    var sim = {
      state: state,
      events: events,
      result: result,
      level: level,
      capacity: capacity,
      step: step
    };
    return sim;
  }

  var api = { C: C, createSim: createSim, noLoadSpeed: noLoadSpeed };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.sim = api;
  }
})(typeof self !== 'undefined' ? self : this);
