# Design: Logo for Robots

All constants below are starting values. Task 8 may tune them, and any change must be made here first.

## 1. File layout

```
index.html      page structure, loads scripts in the order below
style.css       phosphor-green terminal theme (see steering/design.md)
lang.js         tokenizer + parser          (no DOM)
levels.js       level definitions + builder (no DOM)
sim.js          physics + interpreter       (no DOM)
telemetry.js    sample recorder + graph scaling (no DOM)
explain.js      failure explanation         (no DOM)
ui.js           editor, controls, canvas drawing, main loop (only DOM user)
tests/          helpers.js, *.test.js (node --test tests/)
```

Script order in `index.html`: `lang.js`, `levels.js`, `sim.js`, `telemetry.js`, `explain.js`, `ui.js`. Each logic file ends with `if (typeof module !== 'undefined') module.exports = {...}` and otherwise attaches to `window.LFR.<name>` (see steering/tech.md). Under Node, files load each other with `require`.

## 2. Units and coordinates
- SI units in the simulation: meters, seconds, kilograms, newtons, amperes, volts, coulombs, radians.
- The language uses centimeters and degrees. Conversion happens once, in `sim.js`.
- World is y-up. Heading `theta` is 0 along +x, positive counter-clockwise. `left` is positive, `right` negative.
- The UI flips y when drawing.
- `DT = 1/60` s.

## 3. Constants (`sim.js` exports them as `C`)

| Name | Symbol | Value | Meaning |
|---|---|---|---|
| `MASS` | m | 2.0 kg | robot mass |
| `BODY_R` | r_b | 0.10 m | body radius (collision circle) |
| `TRACK` | b | 0.16 m | distance between wheels |
| `WHEEL_R` | r | 0.03 m | wheel radius |
| `I_YAW` | I | 0.01 kg m^2 | yaw inertia (0.5 m r_b^2) |
| `J_WHEEL` | Jw | 0.0005 kg m^2 | wheel inertia (used while slipping) |
| `MOTOR_R` | R | 12 ohm | winding resistance |
| `KE` | ke | 0.277 V s/rad | back-EMF constant |
| `KT` | kt | 0.277 N m/A | torque constant (equal to ke in SI) |
| `DRAG_V` | c_v | 0.5 N s/m | linear drag |
| `DRAG_W` | c_w | 0.002 N m s/rad | yaw drag |
| `G` | g | 9.81 m/s^2 | gravity |
| `MU` | mu | 0.6 | default friction coefficient |
| `V_FULL` | | 7.4 V | open-circuit voltage at full charge |
| `V_EMPTY` | | 6.0 V | open-circuit voltage at zero charge |
| `R_INT` | Rint | 0.8 ohm | battery internal resistance |
| `SENSOR_RANGE` | | 1.0 m | distance sensor range |
| `WALL_AHEAD_DIST` | | 0.35 m | `wall-ahead` is true when sensor distance is below this |
| `CRUISE_DUTY` | | 0.8 | duty for forward/back |
| `TURN_DUTY` | | 0.6 | duty per wheel for left/right |
| `BRAKE_TAU` | | 0.13 s | linear braking time constant (used to start braking early) |
| `TURN_BRAKE_TAU` | | 0.10 s | yaw braking time constant |
| `STALL_SPEED` | | 0.02 m/s | below this, a pushing robot counts as stalled |
| `STALL_TIME` | | 0.5 s | time below `STALL_SPEED` before a `stall` event |
| `SAMPLE_EVERY` | | 6 steps | telemetry rate (10 Hz) |

Derived (documented for tests): no-load speed `V_NL = WHEEL_R * V_FULL / KE = 0.80 m/s`. Normal force per wheel `N = MASS * G / 2 = 9.81 N`. Friction limit per wheel `F_max = mu * N` (5.89 N on normal floor).

## 4. Physics equations (one step, in this order)

State: `x, y, theta, v` (forward speed), `w` (yaw rate), `wL, wR` (wheel angular speed), `slipL, slipR` (booleans), `charge` (C), `t`.

1. **Controller** sets duties `uL, uR` in [-1, 1] (section 5).
2. **Battery voltage**: `soc = charge / capacity`; `Voc = V_EMPTY + (V_FULL - V_EMPTY) * soc`; `Vt = max(0, Voc - R_INT * I_draw_prev)`, where `I_draw_prev` is the battery draw from the previous step (0 on the first step).
3. **Motor** per wheel `i`: 
   - `V_i = u_i * Vt`
   - `I_i = (V_i - KE * w_i) / MOTOR_R` (signed winding current)
   - `tau_i = KT * I_i`
   - `F_i = tau_i / WHEEL_R` (force the motor asks of the ground)
   
   Torque falls linearly with wheel speed and is zero at `w_i = V_i / KE` (no-load). At `w_i = 0` the current is `V_i / MOTOR_R`, the stall current.
   - Motor current shown on the graph: `I_motor = |I_L| + |I_R|`.
   - Battery draw counts only motoring current: `draw_i = max(0, I_i * sign(V_i))`, with `draw_i = 0` when `u_i = 0`. Braking current is dissipated and never charges the battery. `I_draw = draw_L + draw_R`.
4. **Ground contact and slip** per wheel, with ground speeds `vL = v - w*TRACK/2`, `vR = v + w*TRACK/2`, and `F_lim = mu_cell * N` where `mu_cell` is the friction of the floor cell under the robot center (`MU`, or the level's slick value):
   - If wheel is not slipping and `|F_i| <= F_lim`: it grips. `F_ground_i = F_i` and `w_i = v_i / WHEEL_R`.
   - If `|F_i| > F_lim`: it starts slipping. Set `slip_i = true`, and record a `slip` event with `required = |F_i|`, `limit = F_lim`.
   - While slipping: `s = sign(w_i * WHEEL_R - v_i)` (use `sign(F_i)` if that is 0); `F_ground_i = F_lim * s`; `w_i += DT * (tau_i - WHEEL_R * F_ground_i) / J_WHEEL`.
   - Slipping ends (wheel grips again) when `|w_i * WHEEL_R - v_i| < 0.02` and `|F_i| <= F_lim`. Then `w_i = v_i / WHEEL_R`.
5. **Body** (semi-implicit Euler):
   - `v += DT * (F_ground_L + F_ground_R - DRAG_V * v) / MASS`
   - `w += DT * ((F_ground_R - F_ground_L) * TRACK / 2 - DRAG_W * w) / I_YAW`
   - `theta += DT * w`
   - `x += DT * v * cos(theta)`, `y += DT * v * sin(theta)`
6. **Walls**: for each wall rectangle, find the closest point `p` to the center. If `|center - p| < BODY_R`, move the center out along the normal `n` so the distance equals `BODY_R`. Remove the part of the world velocity pointing into the wall (`vn = vel . n`, if `vn < 0`, `vel -= vn * n`), then `v = vel . heading`. Record a `collision` event when contact begins with impact speed above 0.05 m/s. `contact = true` while touching.
7. **Stall timer**: if `contact` and `max(|uL|, |uR|) > 0.2` and `|v| < STALL_SPEED`, add `DT` to `stallTime`; otherwise reset it to 0. When `stallTime` first reaches `STALL_TIME`, record a `stall` event; the event's `duration` and `current` (latest `I_motor`) update while the stall continues.
8. **Battery**: `charge = max(0, charge - I_draw * DT)`. If `charge == 0`, set `uL = uR = 0`, record `battery_flat` once, end the run.
9. **Goal and time**: if the center is inside the goal rectangle, record `goal` and end with PASS. If `t >= timeLimit`, record `timeout` and end with FAIL. `t += DT`.

Invariants (used as property tests): `charge` never increases; `0 <= charge <= capacity`; `|v| <= V_NL`; wheel speeds `|w_i| * WHEEL_R <= V_NL`; the robot center is never inside a wall; no NaN or Infinity in the state.

## 5. Program execution (in `sim.js`)

The interpreter holds a stack of frames `{nodes, index, remaining}` and one active command. When there is no active command, it takes the next node:
- `repeat`: push a frame for the body with `remaining = n`.
- `if wall-ahead`: read the sensor now; push the body if `distance < WALL_AHEAD_DIST`.
- `forward/back N`: start a move with `target = N / 100` m, direction `d = +1 / -1`, and `travelled = 0`.
- `left/right N`: start a turn with `target = N * pi / 180`, direction `d = +1 / -1`, and `turned = 0`.
- `wait N`: start a wait of `N` seconds.

Active command behavior (each step):
- **Move**: `travelled += d * v * DT`, `rem = target - travelled`. While `rem > BRAKE_TAU * |v| + 0.005`: `uL = uR = d * CRUISE_DUTY`. Otherwise `uL = uR = 0` (brake). The move ends when `rem <= BRAKE_TAU * |v| + 0.005`, `|v| < 0.02` and `|w| < 0.05`. If the robot is blocked and stalled, it keeps pushing until the timeout or battery ends the run.
- **Turn**: `turned += d * w * DT`, `rem = target - turned`. While `rem > TURN_BRAKE_TAU * |w| + 0.01`: `uL = -d * TURN_DUTY`, `uR = d * TURN_DUTY`. Otherwise brake (`u = 0`). Ends when braking and `|w| < 0.05` and `|v| < 0.02`.
- **Wait**: `u = 0` until `N` seconds pass.

When the stack empties, `programDone = true`. The run ends as FAIL (`program_ended`) once `programDone` and `|v| < 0.02` and no goal was reached. `forward 0` and `wait 0` end in one step.

## 6. Language (`lang.js`)

Grammar (case-insensitive, whitespace and newlines are separators, `;` starts a comment to end of line):

```
program  := { command }
command  := ("forward"|"back"|"left"|"right"|"wait") NUMBER
          | "repeat" NUMBER block
          | "if" "wall-ahead" block
block    := "[" { command } "]"
NUMBER   := digits [ "." digits ]
```

Limits (`LIMITS`): move distance 0 to 1000 cm; turn 0 to 3600 degrees; repeat count 1 to 100; wait 0 to 60 s; nesting depth at most 8; program text at most 5000 characters; at most 2000 commands after expanding all repeats (counted with saturation, so the check itself cannot overflow or hang).

The tokenizer records the line of each token. The parser is a hand-written recursive descent with an explicit depth counter. It runs inside a `try/catch` as a last resort that returns an internal-error result, but it is written so the catch should never trigger.

Error messages (plain language, with the line number): 
- `Line 3: I don't know the word "fowrard". Did you mean "forward"?` (suggest when edit distance is 2 or less)
- `Line 2: "forward" needs a number, like forward 50.`
- `Line 4: This "[" is never closed. Add a "]".`
- `Line 6: Found a "]" with no matching "[".`
- `Line 5: "repeat" needs a "[" after the number.`
- `Line 1: 5000 is too big for "forward". The most is 1000.`
- `Line 7: Blocks are nested too deeply (limit 8).`
- `Nothing to run. Type a command like forward 50.` (reported with `line: 0`)

## 7. Levels (`levels.js`)

A level is defined by an ASCII map. Cell size is 0.5 m. Characters: `#` wall, `.` floor, `S` start (heading 0 unless `startHeading` is set), `G` goal cell, `o` slick floor.

| id | Name | Map (rows top to bottom) | Battery | Time limit | Slick mu | Reference program |
|---|---|---|---|---|---|---|
| 1 | First Steps | `#######` / `#S....#` / `#####.#` / `#####G#` / `#######` | 20 C | 20 s | | `forward 200` `right 90` `forward 100` |
| 2 | Staircase | `#########` / `#S..#####` / `###.#####` / `###...###` / `#####.###` / `#####..G#` / `#########` | 10 C | 40 s | | `repeat 2 [ forward 100 right 90 forward 100 left 90 ]` `forward 100` |
| 3 | Slippery Corner | `###########` / `#S....#####` / `#####o#####` / `#####o...G#` / `###########` | 6 C | 45 s | 0.25 | `forward 200` `right 90` `forward 100` `left 90` `forward 200` |

Level 3 turns on slick floor, so required wheel force exceeds the friction limit (5.89 N normal, 2.45 N slick) and the wheels slip. Battery and time limits are starting values. Task 8 tunes them so each reference program passes with margin and a careless program (for example one that drives into a wall) fails with the matching event.

`buildLevel(def)` returns:
```
{ id, name, cell, width, height,            // meters
  walls: [{x, y, w, h}],                     // one rectangle per '#' cell (y-up)
  slick: [{x, y, w, h}],                     // 'o' cells
  goal:  {x, y, w, h},
  start: {x, y, theta},                      // cell center
  capacity, timeLimit, mu, slickMu, reference }
```
`levels.js` exports `LEVELS` (array of 3 definitions), `getLevel(id)` (returns the built level, or level 1 for an unknown id), and `buildLevel`.

## 8. Module interfaces

### lang.js
- `parse(text) -> { ok, program, errors }`. `program` is an array of nodes: `{type:'forward'|'back'|'left'|'right'|'wait', n, line}`, `{type:'repeat', n, body, line}`, `{type:'if', cond:'wall-ahead', body, line}`. `errors` is an array of `{line, message}` (at most 5). Never throws.
- `LIMITS`, `countCommands(program)`.

### sim.js
- `createSim(level, program) -> sim`.
- `sim.step()` advances one step of `DT`. Does nothing after the run ends.
- `sim.state`: `{t, x, y, theta, v, w, wL, wR, uL, uR, charge, soc, Vt, Voc, current, draw, slipL, slipR, contact, sensor, programDone}`.
- `sim.events`: array of `{type, t, ...}`:
  - `collision {speed}`
  - `stall {duration, current, duty}`
  - `slip {wheel:'L'|'R', required, limit, mu, peak}`
  - `battery_flat {charge_used}`
  - `timeout {limit, distance_to_goal}`
  - `goal {}`
  - `program_ended {distance_to_goal}`
- `sim.result`: `{status:'running'|'pass'|'fail', reason:null|'goal'|'timeout'|'battery_flat'|'program_ended'}`.
- `sim.sensorDistance()`, `sim.wallAhead()`.
- `runToEnd(level, program, maxSteps) -> sim` for tests and the reference-solution check.
- `C` (constants), `noLoadSpeed()`.

### levels.js
`LEVELS`, `buildLevel`, `getLevel` as in section 7.

### telemetry.js
- `createTelemetry(max = 1200) -> tel`.
- `tel.record(state, stepIndex)` appends a sample every `SAMPLE_EVERY` steps (step 0 included): `{t, speed: |v|, current: I_motor, charge: soc}`.
- `tel.samples` (array, oldest first), `tel.clear()`.
- `plotBounds(samples) -> {tMax, speedMax, currentMax}` rounds ranges up to a readable step so axes stay stable.

### explain.js
- `explain(snapshot) -> { verdict:'PASS'|'FAIL', title, causes:[{type, t, text, root}], summary }`, where `snapshot = {result, events, state, level}`. Text is built from event fields only. Rule order: earliest event first; the earliest cause is marked `root: true`. Example text: `The robot stalled against a wall for 1.2 s, drawing 0.74 A. A stalled motor draws its maximum current and wastes battery.`
- If there are no cause events and the result is fail: `The program finished 0.62 m short of the goal.`

### ui.js
- Wires DOM to the modules. Holds `{level, sim, tel, speed}`. `requestAnimationFrame` loop with an accumulator: `steps = floor(acc / DT)` where `acc += frameSeconds * speed` (cap 0.25 s per frame so a hidden tab does not spiral). Drawing never changes simulation state.
- Draws: arena (walls, slick cells, goal, robot, sensor ray) on one canvas; telemetry graph on another canvas using margins reserved for axes and legend; panel text as DOM text, not canvas.

## 9. Test plan summary
- Unit tests: parser accept/reject cases and messages; motor equations at known points (stall current `Vt / MOTOR_R`, zero torque at no-load); battery sag; slip threshold; collision; sensor; each level's reference program passes; explain text for each cause.
- Property tests (seeded PRNG, 200 to 1000 cases each): parser never throws on random text; battery charge never increases; simulation is deterministic; speed never exceeds `V_NL`; robot never ends inside a wall; no NaN in state; telemetry never exceeds 1200 samples.
