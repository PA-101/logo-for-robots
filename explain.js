(function (root) {
  'use strict';

  // Builds the "Why did it fail?" explanation from the event log and final state only.
  // No DOM access. explain() never throws.

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }

  // Formats a number with a fixed number of decimals. Used for every number in the text,
  // so tests can check the text against the event fields with the same function.
  // Rounds half up on the decimal value (7.05 -> "7.1"); plain toFixed gives "7.0"
  // because 7.05 is stored as 7.0499... in binary.
  function fmt(x, digits) {
    var v = num(x);
    if (Math.abs(v) >= 1e15) return v.toFixed(digits);
    var r = Number(Math.round(Number(Math.abs(v) + 'e' + digits)) + 'e-' + digits);
    if (!isFinite(r)) r = Math.abs(v);
    return (v < 0 && r !== 0 ? '-' : '') + r.toFixed(digits);
  }

  var TITLES = {
    stall: 'Stalled against a wall',
    battery_flat: 'Battery ran flat',
    slip: 'Wheels slipped',
    timeout: 'Ran out of time',
    program_ended: 'Stopped short of the goal',
    bump_timeout: 'Bumper never touched'
  };

  function bumpTimeoutText(e) {
    return 'until-bump on line ' + fmt(e.line, 0) + ' drove for ' + fmt(e.elapsed, 1) +
      ' s without touching a wall, so the program went on to the next command.';
  }

  function stallText(e) {
    return 'The robot stalled against a wall for ' + fmt(e.duration, 1) + ' s, drawing ' + fmt(e.current, 2) +
      ' A. A stalled motor draws its maximum current and wastes battery.';
  }

  function batteryText(e) {
    return 'The battery ran flat at ' + fmt(e.t, 1) + ' s after using all ' + fmt(e.charge_used, 2) +
      ' C of charge. With no power the motors stop.';
  }

  function slipText(list, powerHint) {
    var peak = list[0];
    for (var i = 1; i < list.length; i++) if (num(list[i].peak) > num(peak.peak)) peak = list[i];
    var times = list.length === 1 ? 'once' : list.length + ' times';
    return 'The wheels slipped ' + times + '. They asked the floor for up to ' + fmt(peak.peak, 2) +
      ' N, but the grip limit was ' + fmt(peak.limit, 2) + ' N (friction ' + fmt(peak.mu, 2) +
      '). A spinning wheel does not push the robot where the program expects.' +
      (powerHint ? ' Lower power asks the floor for less force.' : '');
  }

  function timeoutText(e) {
    return 'Time ran out at the ' + fmt(e.limit, 0) + ' s limit, ' + fmt(e.distance_to_goal, 2) +
      ' m from the goal.';
  }

  function endedText(e) {
    return 'The program finished ' + fmt(e.distance_to_goal, 2) + ' m short of the goal.';
  }

  function emptyResult(verdict) {
    return { verdict: verdict, title: verdict === 'PASS' ? 'Goal reached' : 'Run failed', causes: [], summary: '' };
  }

  function explain(snapshot) {
    try {
      var snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
      var result = snap.result && typeof snap.result === 'object' ? snap.result : {};
      var events = Array.isArray(snap.events) ? snap.events.filter(function (e) {
        return e && typeof e === 'object' && typeof e.type === 'string';
      }) : [];
      var state = snap.state && typeof snap.state === 'object' ? snap.state : {};

      if (result.status === 'pass') {
        var out = emptyResult('PASS');
        out.summary = 'Reached the goal in ' + fmt(state.t, 1) + ' s with ' +
          fmt(Math.max(0, Math.min(1, num(state.soc))) * 100, 0) + '% battery left.';
        return out;
      }
      if (result.status !== 'fail') return emptyResult('RUNNING');

      var causes = [];
      var slips = [];
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.type === 'stall') causes.push({ type: 'stall', t: num(e.t), text: stallText(e) });
        else if (e.type === 'battery_flat') causes.push({ type: 'battery_flat', t: num(e.t), text: batteryText(e) });
        else if (e.type === 'timeout') causes.push({ type: 'timeout', t: num(e.t), text: timeoutText(e) });
        else if (e.type === 'bump_timeout') causes.push({ type: 'bump_timeout', t: num(e.t), text: bumpTimeoutText(e) });
        else if (e.type === 'slip') slips.push(e);
      }
      if (slips.length) {
        var firstSlip = slips[0];
        for (var k = 1; k < slips.length; k++) if (num(slips[k].t) < num(firstSlip.t)) firstSlip = slips[k];
        var level = snap.level && typeof snap.level === 'object' ? snap.level : {};
        causes.push({ type: 'slip', t: num(firstSlip.t), text: slipText(slips, level.powerMatters === true) });
      }
      if (!causes.length) {
        var ended = null;
        for (var j = 0; j < events.length; j++) if (events[j].type === 'program_ended') ended = events[j];
        if (ended) causes.push({ type: 'program_ended', t: num(ended.t), text: endedText(ended) });
      }

      // Earliest first; ties keep the order above (stable sort).
      causes = causes.map(function (c, idx) { return { c: c, idx: idx }; })
        .sort(function (a, b) { return a.c.t - b.c.t || a.idx - b.idx; })
        .map(function (x) { return x.c; });
      causes.forEach(function (c, idx) { c.root = idx === 0; });

      var res = emptyResult('FAIL');
      if (causes.length) {
        res.title = TITLES[causes[0].type];
        res.summary = causes.length > 1 ? 'Likely root cause: ' + TITLES[causes[0].type].toLowerCase() +
          ' at ' + fmt(causes[0].t, 1) + ' s.' : causes[0].text;
      } else {
        res.summary = 'The run failed, but no event explains why.';
      }
      res.causes = causes;
      return res;
    } catch (err) {
      return { verdict: 'FAIL', title: 'Run failed', causes: [], summary: 'The run failed, but no event explains why.' };
    }
  }

  var api = { explain: explain, fmt: fmt, TITLES: TITLES };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.explain = api;
  }
})(typeof self !== 'undefined' ? self : this);
