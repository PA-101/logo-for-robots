(function (root) {
  'use strict';

  // Microcontroller export (design.md section 15): turns a parsed program into plain C++ for a
  // two-wheeled robot with two PWM motor outputs and time-based moves. The timing constants come
  // from the simulator and are UNCALIBRATED. No DOM access. toCpp never throws.

  var lang, simMod;
  if (typeof module !== 'undefined') {
    lang = require('./lang.js');
    simMod = require('./sim.js');
  } else {
    lang = root.LFR.lang;
    simMod = root.LFR.sim;
  }
  var C = simMod.C;

  // Derive timing from one simulated "forward 100" and one "left 90" at power 100, on an open
  // floor, including acceleration and braking.
  function derive() {
    var open = { walls: [], slick: [], goal: { x: 99, y: 99, w: 1, h: 1 }, start: { x: 0, y: 0, theta: 0 }, capacity: 50, timeLimit: 60 };
    var mv = simMod.runToEnd(open, lang.parse('forward 100').program);
    var tn = simMod.runToEnd(open, lang.parse('left 90').program);
    return {
      MS_PER_CM: Math.round(mv.state.t * 1000 / 100 * 100) / 100,
      MS_PER_DEG: Math.round(tn.state.t * 1000 / 90 * 100) / 100,
      CRUISE_PWM: Math.round(C.CRUISE_DUTY * 255),
      TURN_PWM: Math.round(C.TURN_DUTY * 255),
      WALL_AHEAD_CM: Math.round(C.WALL_AHEAD_DIST * 100),
      UNTIL_BUMP_MAX_MS: Math.round(C.UNTIL_BUMP_TIMEOUT * 1000)
    };
  }
  var K = derive();

  function num(n) {
    var s = String(Math.round(Number(n) * 1000) / 1000);
    return s.indexOf('.') < 0 ? s + '.0' : s;
  }

  function header(title) {
    var safe = String(title || 'program').replace(/[^\x20-\x7e]/g, '?').replace(/\*\//g, '* /');
    return [
      '// Logo for Robots: exported program "' + safe + '"',
      '//',
      '// UNCALIBRATED. The timing constants below come from the Logo for Robots simulator, not',
      '// from your robot. Measure and tune every constant on the real robot before you rely on it.',
      '// Moves are timed: there are no wheel encoders, so distances and angles will drift.',
      '//',
      '// Provide these five functions for your board:',
      'void setMotorPwm(int left, int right);   // signed PWM per wheel, -255 to 255',
      'int readDistanceCm();                    // front distance sensor, in cm',
      'bool bumperPressed();                    // front bumper switch, true while pressed',
      'void delayMs(unsigned long ms);          // wait',
      'unsigned long millisNow();               // milliseconds since start',
      '',
      '// Uncalibrated constants, derived from the simulator. Tune them on a real robot.',
      'const float MS_PER_CM = ' + num(K.MS_PER_CM) + ';            // uncalibrated: ms per cm at power 100',
      'const float MS_PER_DEG = ' + num(K.MS_PER_DEG) + ';           // uncalibrated: ms per degree at power 100',
      'const int CRUISE_PWM = ' + K.CRUISE_PWM + ';                // uncalibrated: drive PWM at power 100',
      'const int TURN_PWM = ' + K.TURN_PWM + ';                  // uncalibrated: turn PWM at power 100',
      'const int WALL_AHEAD_CM = ' + K.WALL_AHEAD_CM + ';              // uncalibrated: "wall-ahead" distance',
      'const unsigned long UNTIL_BUMP_MAX_MS = ' + K.UNTIL_BUMP_MAX_MS + ';  // until-bump gives up after this',
      '',
      'float power = 1.0;     // set by "power N" (0.1 to 1.0)',
      'bool bumped = false;   // set when the bumper is pressed, cleared by "if bumped"',
      '',
      'int scaled(int pwm) { return (int)(pwm * power); }',
      'unsigned long msFor(float msAtFullPower) { return (unsigned long)(msAtFullPower / power); }',
      '',
      '// Drive both wheels for a time, watching the bumper.',
      'void driveFor(int left, int right, unsigned long ms) {',
      '  unsigned long start = millisNow();',
      '  setMotorPwm(left, right);',
      '  while (millisNow() - start < ms) {',
      '    if (bumperPressed()) bumped = true;',
      '    delayMs(5);',
      '  }',
      '  setMotorPwm(0, 0);',
      '}',
      '',
      '// Drive forward until the bumper is pressed, or give up after UNTIL_BUMP_MAX_MS.',
      'void untilBump() {',
      '  unsigned long start = millisNow();',
      '  setMotorPwm(scaled(CRUISE_PWM), scaled(CRUISE_PWM));',
      '  while (!bumperPressed() && millisNow() - start < UNTIL_BUMP_MAX_MS) delayMs(5);',
      '  if (bumperPressed()) bumped = true;',
      '  setMotorPwm(0, 0);',
      '}',
      '',
      'bool checkBumped() {',
      '  bool b = bumped || bumperPressed();',
      '  bumped = false;',
      '  return b;',
      '}',
      ''
    ];
  }

  // One block of statements per command, with a "// line N" comment.
  function emit(nodes, depth, out) {
    var pad = new Array(depth + 2).join('  ');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var tag = '  // line ' + n.line + ': ' + describe(n);
      switch (n.type) {
        case 'forward':
          out.push(pad + 'driveFor(scaled(CRUISE_PWM), scaled(CRUISE_PWM), msFor(' + num(n.n) + ' * MS_PER_CM));' + tag);
          break;
        case 'back':
          out.push(pad + 'driveFor(-scaled(CRUISE_PWM), -scaled(CRUISE_PWM), msFor(' + num(n.n) + ' * MS_PER_CM));' + tag);
          break;
        case 'left':
          out.push(pad + 'driveFor(-scaled(TURN_PWM), scaled(TURN_PWM), msFor(' + num(n.n) + ' * MS_PER_DEG));' + tag);
          break;
        case 'right':
          out.push(pad + 'driveFor(scaled(TURN_PWM), -scaled(TURN_PWM), msFor(' + num(n.n) + ' * MS_PER_DEG));' + tag);
          break;
        case 'wait':
          out.push(pad + 'setMotorPwm(0, 0); delayMs((unsigned long)(' + num(n.n) + ' * 1000));' + tag);
          break;
        case 'power':
          out.push(pad + 'power = ' + num(n.n / 100) + ';' + tag);
          break;
        case 'until-bump':
          out.push(pad + 'untilBump();' + tag);
          break;
        case 'repeat':
          out.push(pad + 'for (int i' + depth + ' = 0; i' + depth + ' < ' + Math.round(n.n) + '; i' + depth + '++) {' + tag);
          emit(n.body || [], depth + 1, out);
          out.push(pad + '}');
          break;
        case 'if':
          out.push(pad + (n.cond === 'bumped' ? 'if (checkBumped()) {' : 'if (readDistanceCm() < WALL_AHEAD_CM) {') + tag);
          emit(n.body || [], depth + 1, out);
          out.push(pad + '}');
          break;
        default:
          break;
      }
    }
  }

  function describe(n) {
    if (n.type === 'repeat') return 'repeat ' + n.n;
    if (n.type === 'if') return 'if ' + n.cond;
    if (n.type === 'until-bump') return 'until-bump';
    return n.type + ' ' + n.n;
  }

  // programOrText: program text, or a parsed program array. Returns { ok, code, errors }.
  function toCpp(programOrText, options) {
    try {
      var program = programOrText;
      if (!Array.isArray(program)) {
        var parsed = lang.parse(programOrText);
        if (!parsed.ok) return { ok: false, code: '', errors: parsed.errors };
        program = parsed.program;
      }
      var out = header(options && options.title);
      out.push('void runProgram() {');
      emit(program, 0, out);
      out.push('  setMotorPwm(0, 0);');
      out.push('}');
      return { ok: true, code: out.join('\n') + '\n', errors: [] };
    } catch (e) {
      return { ok: false, code: '', errors: [{ line: 0, message: 'The program could not be exported.' }] };
    }
  }

  // ---- MicroPython target ------------------------------------------------
  // Same assumptions as the C++ target: two motors through a motor-driver board (one PWM pin
  // for speed and one direction pin per motor), timed moves from simulator-derived constants,
  // and a placeholder distance-sensor function. Uses only the standard MicroPython modules
  // `machine` and `time`.

  function pyHeader(title) {
    var safe = String(title || 'program').replace(/[^\x20-\x7e]/g, '?').replace(/"/g, "'");
    var d = function (x) { return (Math.round(x * 100) / 100).toFixed(2); };
    return [
      '# Logo for Robots: exported program "' + safe + '"',
      '#',
      '# UNCALIBRATED. The timing constants below come from the Logo for Robots simulator, not',
      '# from your robot. This is dead reckoning: moves are timed, there are no wheel encoders,',
      '# so distances and angles will drift. Measure and tune every constant on the real robot.',
      '#',
      '# Wiring assumed: two motors through a motor-driver board. Each motor has one PWM pin',
      '# (speed) and one direction pin. A front bumper switch pulls its pin to 0 when pressed.',
      '',
      'import time',
      'from machine import Pin, PWM',
      '',
      '# Pin numbers: change these to match your wiring.',
      'LEFT_PWM_PIN = 0',
      'LEFT_DIR_PIN = 1',
      'RIGHT_PWM_PIN = 2',
      'RIGHT_DIR_PIN = 3',
      'BUMPER_PIN = 4',
      '',
      '# Uncalibrated constants, derived from the simulator. Tune them on a real robot.',
      'MS_PER_CM = ' + d(K.MS_PER_CM) + '          # uncalibrated: ms per cm at power 100',
      'MS_PER_DEG = ' + d(K.MS_PER_DEG) + '          # uncalibrated: ms per degree at power 100',
      'CRUISE_DUTY = ' + d(K.CRUISE_PWM / 255) + '         # uncalibrated: drive duty at power 100 (0 to 1)',
      'TURN_DUTY = ' + d(K.TURN_PWM / 255) + '           # uncalibrated: turn duty at power 100 (0 to 1)',
      'WALL_AHEAD_CM = ' + K.WALL_AHEAD_CM + '         # uncalibrated: "wall-ahead" distance',
      'UNTIL_BUMP_MAX_MS = ' + K.UNTIL_BUMP_MAX_MS + '  # until-bump gives up after this',
      'PWM_FREQ = 1000          # PWM frequency in Hz; check your motor-driver board',
      '',
      'power = 1.0     # set by "power N" (0.1 to 1.0)',
      'bumped = False  # set when the bumper is pressed, cleared by "if bumped"',
      '',
      '_left_pwm = PWM(Pin(LEFT_PWM_PIN))',
      '_right_pwm = PWM(Pin(RIGHT_PWM_PIN))',
      '_left_pwm.freq(PWM_FREQ)',
      '_right_pwm.freq(PWM_FREQ)',
      '_left_dir = Pin(LEFT_DIR_PIN, Pin.OUT)',
      '_right_dir = Pin(RIGHT_DIR_PIN, Pin.OUT)',
      '_bumper = Pin(BUMPER_PIN, Pin.IN, Pin.PULL_UP)',
      '',
      '',
      'def set_motors(left, right):',
      '    """Signed duty per wheel, -1.0 to 1.0."""',
      '    _left_dir.value(1 if left >= 0 else 0)',
      '    _right_dir.value(1 if right >= 0 else 0)',
      '    _left_pwm.duty_u16(int(min(1.0, abs(left)) * 65535))',
      '    _right_pwm.duty_u16(int(min(1.0, abs(right)) * 65535))',
      '',
      '',
      'def bumper_pressed():',
      '    return _bumper.value() == 0',
      '',
      '',
      'def read_distance_cm():',
      '    """Placeholder: replace with code for your front distance sensor (in cm)."""',
      '    return 999',
      '',
      '',
      'def drive_for(left, right, ms):',
      '    """Drive both wheels for a time, watching the bumper."""',
      '    global bumped',
      '    start = time.ticks_ms()',
      '    set_motors(left, right)',
      '    while time.ticks_diff(time.ticks_ms(), start) < ms:',
      '        if bumper_pressed():',
      '            bumped = True',
      '        time.sleep_ms(5)',
      '    set_motors(0, 0)',
      '',
      '',
      'def until_bump():',
      '    """Drive forward until the bumper is pressed, or give up after UNTIL_BUMP_MAX_MS."""',
      '    global bumped',
      '    start = time.ticks_ms()',
      '    set_motors(CRUISE_DUTY * power, CRUISE_DUTY * power)',
      '    while not bumper_pressed() and time.ticks_diff(time.ticks_ms(), start) < UNTIL_BUMP_MAX_MS:',
      '        time.sleep_ms(5)',
      '    if bumper_pressed():',
      '        bumped = True',
      '    set_motors(0, 0)',
      '',
      '',
      'def check_bumped():',
      '    global bumped',
      '    b = bumped or bumper_pressed()',
      '    bumped = False',
      '    return b',
      '',
      ''
    ];
  }

  function emitPy(nodes, depth, out) {
    var pad = new Array(depth + 2).join('    ');
    var start = out.length;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var tag = '  # line ' + n.line + ': ' + describe(n);
      var dist = '(' + num(n.n) + ' * MS_PER_CM / power)', ang = '(' + num(n.n) + ' * MS_PER_DEG / power)';
      switch (n.type) {
        case 'forward': out.push(pad + 'drive_for(CRUISE_DUTY * power, CRUISE_DUTY * power, ' + dist + ')' + tag); break;
        case 'back': out.push(pad + 'drive_for(-CRUISE_DUTY * power, -CRUISE_DUTY * power, ' + dist + ')' + tag); break;
        case 'left': out.push(pad + 'drive_for(-TURN_DUTY * power, TURN_DUTY * power, ' + ang + ')' + tag); break;
        case 'right': out.push(pad + 'drive_for(TURN_DUTY * power, -TURN_DUTY * power, ' + ang + ')' + tag); break;
        case 'wait': out.push(pad + 'set_motors(0, 0)' + tag); out.push(pad + 'time.sleep_ms(int(' + num(n.n) + ' * 1000))'); break;
        case 'power': out.push(pad + 'power = ' + num(n.n / 100) + tag); break;
        case 'until-bump': out.push(pad + 'until_bump()' + tag); break;
        case 'repeat':
          out.push(pad + 'for _i' + depth + ' in range(' + Math.round(n.n) + '):' + tag);
          emitPy(n.body || [], depth + 1, out);
          break;
        case 'if':
          out.push(pad + (n.cond === 'bumped' ? 'if check_bumped():' : 'if read_distance_cm() < WALL_AHEAD_CM:') + tag);
          emitPy(n.body || [], depth + 1, out);
          break;
        default: break;
      }
    }
    if (out.length === start) out.push(pad + 'pass');   // Python needs a statement in every block
  }

  function toMicroPython(programOrText, options) {
    try {
      var program = programOrText;
      if (!Array.isArray(program)) {
        var parsed = lang.parse(programOrText);
        if (!parsed.ok) return { ok: false, code: '', errors: parsed.errors };
        program = parsed.program;
      }
      var out = pyHeader(options && options.title);
      out.push('def run_program():');
      out.push('    global power');
      emitPy(program, 0, out);
      out.push('    set_motors(0, 0)');
      out.push('');
      out.push('');
      out.push('run_program()');
      return { ok: true, code: out.join('\n') + '\n', errors: [] };
    } catch (e) {
      return { ok: false, code: '', errors: [{ line: 0, message: 'The program could not be exported.' }] };
    }
  }

  var TARGETS = {
    cpp: { label: 'C++', fn: toCpp },
    micropython: { label: 'MicroPython', fn: toMicroPython }
  };

  // Export to a named target ('cpp' or 'micropython'); unknown targets fall back to C++.
  function exportTo(target, programOrText, options) {
    var t = TARGETS[target] ? target : 'cpp';
    return TARGETS[t].fn(programOrText, options);
  }

  var api = { toCpp: toCpp, toMicroPython: toMicroPython, exportTo: exportTo, TARGETS: TARGETS, CONSTANTS: K };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.exporter = api;
  }
})(typeof self !== 'undefined' ? self : this);
