(function (root) {
  'use strict';

  // Telemetry recorder and graph scaling. No DOM access.
  // Records speed, total motor current and battery level at 10 Hz (every 6 steps).

  var SAMPLE_EVERY = 6;
  var DEFAULT_MAX = 1200;

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }

  function createTelemetry(max) {
    var limit = max > 0 ? Math.floor(max) : DEFAULT_MAX;
    var tel = {
      max: limit,
      samples: [],
      // Adds a sample when stepIndex is a multiple of SAMPLE_EVERY (step 0 included).
      // Returns true when a sample was added.
      record: function (state, stepIndex) {
        if (!state || !(stepIndex >= 0) || stepIndex % SAMPLE_EVERY !== 0) return false;
        var s = {
          t: num(state.t),
          speed: Math.abs(num(state.v)),
          current: Math.abs(num(state.current)),
          charge: Math.max(0, Math.min(1, num(state.soc))),
          slip: !!(state.slipL || state.slipR),
          stall: num(state.stallTime) >= 0.5
        };
        tel.samples.push(s);
        if (tel.samples.length > tel.max) tel.samples.splice(0, tel.samples.length - tel.max);
        return true;
      },
      clear: function () { tel.samples.length = 0; }
    };
    return tel;
  }

  // Rounds a value up to a readable axis maximum: 1, 2 or 5 times a power of ten.
  function niceCeil(x, floor) {
    if (!(x > floor)) x = floor;
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var m = x / p;
    var nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return nice * p;
  }

  // Axis ranges that cover every sample. Minimums keep axes stable at the start of a run.
  function plotBounds(samples) {
    var tMin = 0, tMax = 0, speedMax = 0, currentMax = 0;
    var list = Array.isArray(samples) ? samples : [];
    if (list.length) tMin = num(list[0].t);
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      if (num(s.t) > tMax) tMax = num(s.t);
      if (num(s.speed) > speedMax) speedMax = num(s.speed);
      if (num(s.current) > currentMax) currentMax = num(s.current);
    }
    var span = niceCeil(tMax - tMin, 10);
    return {
      tMin: tMin,
      tMax: tMin + span,
      speedMax: niceCeil(speedMax, 1),
      currentMax: niceCeil(currentMax, 1)
    };
  }

  var api = {
    SAMPLE_EVERY: SAMPLE_EVERY,
    DEFAULT_MAX: DEFAULT_MAX,
    createTelemetry: createTelemetry,
    plotBounds: plotBounds,
    niceCeil: niceCeil
  };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.telemetry = api;
  }
})(typeof self !== 'undefined' ? self : this);
