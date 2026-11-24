# Design: Logo for Robots

Constants below are the values after tuning in task 8. See section 10 for every change from the original starting values.

## 1. File layout

```
index.html      page structure, loads scripts in the order below
style.css       phosphor-green terminal theme (see steering/design.md)
lang.js         tokenizer + parser          (no DOM)
levels.js       level definitions + builder (no DOM)
sim.js          physics + interpreter       (no DOM)
telemetry.js    sample recorder + graph scaling (no DOM)
explain.js      failure explanation         (no DOM)
coach.js        Auto-Fix Coach search       (no DOM)
ui.js           editor, controls, canvas drawing, main loop (only DOM user)
tests/          helpers.js, *.test.js (node --test tests/)
```

Script order in `index.html`: `lang.js`, `levels.js`, `sim.js`, `telemetry.js`, `explain.js`, `coach.js`, `ui.js`. Each logic file ends with `if (typeof module !== 'undefined') module.exports = {...}` and otherwise attaches to `window.LFR.<name>` (see steering/tech.md). Under Node, files load each other with `require`.

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
| `TURN_SLOW_ZONE` | | 0.8 rad | turns drop to `TURN_SLOW_DUTY` when this close to the target |
| `TURN_SLOW_DUTY` | | 0.3 | duty per wheel in the slow zone |
| `SLIP_REGRIP_SPEED` | | 0.02 m/s | a slipping wheel grips again below this spin speed |
| `SLIP_MERGE_TIME` | | 0.25 s | slip bursts closer than this are one event |
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
   - If `|F_i| > F_lim`: it starts slipping. Set `slip_i = true`, and record a `slip` event with `required = |F_i|`, `limit = F_lim`. Slip bursts of one wheel that start less than 0.25 s after the previous one ended are merged into the same event (its `peak` rises).
   - While slipping: `s = sign(F_i)`; `F_ground_i = F_lim * s`; `w_i_new = w_i + DT * (tau_i - WHEEL_R * F_ground_i) / J_WHEEL`. The wheel may spin ahead of the ground but not fall behind it in the drive direction: if `s * (w_i_new * WHEEL_R - v_i) < 0` then `w_i_new = v_i / WHEEL_R`.
   - Slipping ends (wheel grips again) when `|F_i| <= F_lim` and `s * (w_i_new * WHEEL_R - v_i) < 0.02`. Then `w_i = v_i / WHEEL_R` and `F_ground_i = F_i`.
   - Wheel inertia is ignored while gripping and used only while slipping.
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
- **Turn**: `turned += d * w * DT`, `rem = target - turned`. While `rem > TURN_BRAKE_TAU * |w| + 0.01`: `uL = -d * td`, `uR = d * td`, where `td = TURN_SLOW_DUTY` if `rem < TURN_SLOW_ZONE` and `TURN_DUTY` otherwise. Otherwise brake (`u = 0`). Moves and turns latch into braking: once braking starts it continues until the command ends. Ends when braking and `|w| < 0.05` and `|v| < 0.02`.
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
| 1 | First Steps | `#######` / `#S....#` / `#####.#` / `#####G#` / `#######` | 3 C | 12 s | | `forward 200` `right 90` `forward 100` |
| 2 | Staircase | `#########` / `#S..#####` / `###.#####` / `###...###` / `#####.###` / `#####..G#` / `#########` | 2.5 C | 25 s | | `repeat 2 [ forward 100 right 90 forward 100 left 90 ]` `forward 100` |
| 3 | Slippery Corner | `###########` / `#S....#####` / `#####o#####` / `#####o...G#` / `###########` | 1.5 C | 22 s | 0.25 | `forward 200` `right 90` `forward 100` `left 90` `forward 200` |

Level 3 turns on slick floor, so required wheel force exceeds the friction limit (5.89 N normal, 2.45 N slick) and the wheels slip. Battery and time limits were tuned in task 8 (section 10). Each reference program passes using at most 75 percent of the time and battery, and a program that drives into a wall fails with `collision`, `stall` and `battery_flat` events.

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
- `parse(text, options) -> { ok, program, errors }`. With `options.positions === true`, every command node also gets `start` (character offset of its keyword) and, for nodes with a number, `numStart` and `numEnd` (offsets of the number token, end exclusive). Without the option the node shape is unchanged. The coach uses these offsets to edit the source text in place. `program` is an array of nodes: `{type:'forward'|'back'|'left'|'right'|'wait', n, line}`, `{type:'repeat', n, body, line}`, `{type:'if', cond:'wall-ahead', body, line}`. `errors` is an array of `{line, message}` (at most 5). Never throws.
- `LIMITS`, `countCommands(program)`.

### sim.js
- `createSim(level, program) -> sim`.
- `sim.step()` advances one step of `DT`. Does nothing after the run ends.
- `sim.state`: `{t, x, y, theta, v, w, wL, wR, uL, uR, charge, soc, Vt, Voc, current, draw, slipL, slipR, contact, sensor, programDone}`.
- `sim.events`: array of `{type, t, ...}`:
  - `collision {speed}`
  - `stall {duration, current, duty}` (created when the stall reaches 0.5 s; `duration` and `current` keep updating while it lasts, so the current falls as the battery sags)
  - `slip {wheel:'L'|'R', required, limit, mu, peak}`
  - `battery_flat {charge_used}`
  - `timeout {limit, distance_to_goal}` (`distance_to_goal` is the straight-line distance in meters from the robot center to the goal-zone center; the same for `program_ended`)
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

### coach.js
See section 11. Exports `coach`, `createSearch`, `generateEdits`, `applyEdits`, `LIMITS` (`CANDIDATE_CAP`, `SCALE_FACTORS`, `TURN_DELTAS`, `WAITS`, `MAX_EDITS`).

### ui.js
- Wires DOM to the modules. Holds `{level, sim, tel, speed}`. `requestAnimationFrame` loop with an accumulator: `steps = floor(acc / DT)` where `acc += frameSeconds * speed` (cap 0.25 s per frame so a hidden tab does not spiral). Drawing never changes simulation state.
- Draws: arena (walls, slick cells, goal, robot, sensor ray) on one canvas; telemetry graph on another canvas using margins reserved for axes and legend; panel text as DOM text, not canvas.

## 9. Test plan summary
- Unit tests: parser accept/reject cases and messages; motor equations at known points (stall current `Vt / MOTOR_R`, zero torque at no-load); battery sag; slip threshold; collision; sensor; each level's reference program passes; explain text for each cause.
- Property tests (seeded PRNG, 200 to 1000 cases each): parser never throws on random text; battery charge never increases; simulation is deterministic; speed never exceeds `V_NL`; robot never ends inside a wall; no NaN in state; telemetry never exceeds 1200 samples.

## 10. Tuning log (task 8)

Changes from the original starting values, with the reason. Everything not listed here is unchanged.

| Item | Old | New | Reason |
|---|---|---|---|
| Level 1 battery capacity | 20 C | 3 C | The reference run used 0.48 C, so 20 C could never matter. Now 16 percent used, and a wall push runs it flat in about 3 s. |
| Level 2 battery capacity | 10 C | 2.5 C | Reference uses 1.15 C (46 percent). |
| Level 3 battery capacity | 6 C | 1.5 C | Reference uses 0.78 C (52 percent). Keeps capacity falling with level number. |
| Level 1 time limit | 20 s | 12 s | Reference finishes in 5.9 s (49 percent). |
| Level 2 time limit | 40 s | 25 s | Reference finishes in 12.9 s (52 percent). |
| Level 3 time limit | 45 s | 22 s | Reference finishes in 10.8 s (49 percent). |
| `TURN_SLOW_ZONE` | (did not exist) | 0.8 rad | Without it, a turn could miss by up to 4 degrees because the robot moves up to 5 degrees per step at full turn speed. Slowing near the target cuts the error to about 1.5 degrees. |
| `TURN_SLOW_DUTY` | (did not exist) | 0.3 | Same reason. Chosen from a sweep of zone 0.8 or 1.0, duty 0.25 or 0.3, and `TURN_BRAKE_TAU` 0.08 to 0.11. |
| Slip model (section 4, step 4) | the wheel's direction of friction followed the sign of (wheel speed - ground speed) | friction follows the sign of the motor force, and the wheel cannot fall behind the ground | Bug found by a unit test: while slipping, the heavy wheel spun up more slowly than the body accelerated, so the wheel lagged the ground and friction flipped to a braking force. At mu 0.4 the robot's speed dropped from 0.065 m/s back to 0 on the second step. |
| `distance_to_goal` | undefined | distance to goal-zone center | Needed a definite meaning for explain.js. |

`TURN_BRAKE_TAU` (0.10 s), `BRAKE_TAU` (0.13 s), and every motor, battery and friction constant were checked and kept.

Known physical limits of the model:
- Cruising draws about 0.03 A in total, while both motors stalled against a wall draw about 0.84 A, so the battery drains about 25 times faster against a wall than while cruising. Cruise current is low because there is little drag and no rolling resistance.
- `J_WHEEL` (0.0005 kg m^2) is about 20 times the inertia of a real 3 cm wheel. It is kept because a realistic value gives a wheel time constant (about 0.004 s) shorter than the 1/60 s step, which makes the explicit integration unstable. As a result, a slipping wheel spins up slowly and only runs a few cm/s ahead of the ground. Slip mainly shows up as acceleration limited by friction, not as a visibly spinning wheel.
- Ignoring wheel inertia while gripping means the slip threshold is a little lower than a real robot's.

## 11. Auto-Fix Coach (`coach.js`)

The coach is a deterministic search over small numeric edits. It runs the real simulation on each candidate and keeps the best one that passes. It has no learned model, no randomness and no network access. It never reads `level.reference`.

### Constants (`LIMITS`)

| Name | Value | Meaning |
|---|---|---|
| `CANDIDATE_CAP` | 3000 | most candidates simulated per request |
| `MAX_EDITS` | 2 | most edits in one candidate |
| `SCALE_FACTORS` | 0.5, 0.75, 0.9, 1.1, 1.25, 1.5, 2 | for `forward` and `back` |
| `TURN_DELTAS` | -5, 5, -10, 10, -15, 15, -20, 20, -30, 30, -45, 45 degrees | for `left` and `right` |
| `WAITS` | 0.5, 1 s | inserted before `left` and `right` |

### Edits

An edit is `{ line, kind, start, end, insert, before, after, size, text }`. It replaces the characters `start..end` of the program text with `insert` (for a wait, `start === end`, so nothing is removed).

`generateEdits(text)` parses with `{ positions: true }` and walks the command nodes in source order (including nodes inside `repeat` and `if` bodies). For each node it emits, in this order:

- `forward` / `back` with `n > 0`: for each factor `f`, `n' = round(n * f)` clamped to 1..1000. Skip when `n' === n` or `n'` was already emitted for this node. `size = |n' - n| / n`.
- `left` / `right`: for each delta `d`, `n' = n + d`. Skip when `n' < 0`, `n' > 3600` or `n' === n`. `size = |d| / 90`.
- `left` / `right`: for each wait `w`, insert `wait w ` immediately before the keyword, on the same line, so line numbers do not change. `size = w / 2`.

Example sizes: scaling 50 to 100 is 1.0, a 10 degree change is 0.11, `wait 0.5` is 0.25.

`applyEdits(text, edits)` applies edits in descending `start` order and returns the new text. Edits in one candidate always target different nodes, so they never overlap. An edit inside a `repeat` body changes every pass of the loop, and its `text` says so.

### Search

1. Parse. On a parse error return `found: false` with the first error.
2. Run the original program with `runToEnd`. If it passes, return `found: false` ("already passes"). This run is the "before" run and does not count toward the cap.
3. **Singles:** simulate every single edit in generation order, stopping at the cap.
4. **Pairs** (only if no single edit passed and the cap is not reached): build all pairs of single edits on different nodes. Sort them by `(size1 + size2, index1, index2)`. Simulate them in that order until the cap is reached. Once a pair passes, finish only the pairs with the same combined size, then stop.
5. **Rank** the passing candidates by `(number of edits, total size, finish time t, charge used, generation index)` and take the first. Every key is a number from the simulation or the generation order, so the result is fully deterministic.

`createSearch(level, text)` returns `{ step(maxCandidates), done, progress: { tried, cap }, result() }`. The UI calls `step` once per frame with as many candidates as fit in about 12 ms of work. `coach(level, text)` is `createSearch` run to completion. Both must give byte-identical results (same `JSON.stringify`).

Measured cost: 0.6 to 1.3 ms per candidate in Node (346 to 1320 steps), so a full 3000-candidate search takes 2 to 4 s. That is why the UI spreads it over frames.

### Result

`coach(level, text) -> { found, program, edits, explanation, tried }`

- `program`: the edited text when `found`, otherwise the original text.
- `edits`: the chosen edits, each with `text` such as `Line 3: forward 50 -> forward 100`.
- `tried`: how many candidates were simulated (at most 3000).
- `explanation`: plain sentences, every number taken from the two runs' events and states and formatted with `explain.fmt`:
  - Before: the root cause sentence from `explain()` of the original run, plus its end time and charge used.
  - Change: the edit texts.
  - After: finish time, charge used and percent of capacity.
  - Comparison: one line per event type that occurred in either run (stall duration and current, slip count and peak force, collision count), for example `Stall: 3.5 s at 0.72 A before, none after.`
  - Search: how many candidates were tried and how many passed.

When nothing passes: `Tried 3000 small changes to distances, turn angles and waits, and none reached the goal. The closest ended 0.42 m from the goal (Line 5: forward 100 -> forward 150). The program probably needs a different command, not a different number.` When the cap is reached, the message says the search stopped at the limit.

`coach` never throws. Bad input returns `found: false` with an explanation.

### UI

After a FAIL, the "Why did it fail?" panel shows a "SUGGEST A FIX" button. Pressing it locks the editor, runs the search a little each frame, and shows `Trying changes... 400 / 3000`. The result replaces the button: the edits, the explanation, and an "APPLY FIX" button that puts the edited program in the editor (edited lines highlighted in the gutter) without running it. Reset cancels the search. The button label and help text describe what the coach does ("tries small changes to your numbers and simulates each one") and never use the words AI, language model or machine learning.