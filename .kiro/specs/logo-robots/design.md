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
gen.js          Challenge Mode level generator (no DOM)
export.js       program to microcontroller C++ (no DOM, task 34)
ui.js           editor, controls, canvas drawing, main loop (only DOM user)
tests/          helpers.js, *.test.js (node --test tests/)
tests/fixtures/ golden-runs.json (recorded before the power/bumper change, see section 12)
tools/sim-mcp/  developer MCP server, not shipped (task 37)
```

Script order in `index.html`: `lang.js`, `levels.js`, `sim.js`, `telemetry.js`, `explain.js`, `coach.js`, `gen.js`, `export.js`, `ui.js`. Each logic file ends with `if (typeof module !== 'undefined') module.exports = {...}` and otherwise attaches to `window.LFR.<name>` (see steering/tech.md). Under Node, files load each other with `require`.

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
| `STALL_DUTY` | | 0.2 | a wheel counts as "commanded" above `STALL_DUTY * power` |
| `BUMPER_COS` | | 0.5 | bumper pressed when a contact normal `n` has `n . heading < -BUMPER_COS` (within 60 degrees of straight ahead) |
| `UNTIL_BUMP_TIMEOUT` | | 15 s | longest `until-bump` drive before `bump_timeout` |
| `UNTIL_BUMP_SETTLE_MAX` | | 2 s | longest braking phase of `until-bump`; with the drive timeout this is a hard 17 s limit per command |

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
6b. **Bumper and bumped flag** (new, after the wall loop): `bumper = true` if any wall contact this step has `n . (cos theta, sin theta) < -BUMPER_COS`. If contact begins this step (`touching && !wasContact`, any speed), set `bumpedFlag = true`. Neither changes motion; `collision` events keep their 0.05 m/s threshold.
7. **Stall timer**: if `contact` and `max(|uL|, |uR|) > STALL_DUTY * power` and `|v| < STALL_SPEED`, add `DT` to `stallTime`; otherwise reset it to 0. When `stallTime` first reaches `STALL_TIME`, record a `stall` event; the event's `duration` and `current` (latest `I_motor`) update while the stall continues.
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
- `power N` (new): set `power = N / 100` at once and take the next node in the same step (no time passes). `power` starts at 1.
- `if bumped` (new): read `bumpedFlag`, clear it, push the body if it was set.
- `until-bump` (new): start a bump drive with `elapsed = 0`.

Every drive duty below is multiplied by `power` (`CRUISE_DUTY * power`, `TURN_DUTY * power`, `TURN_SLOW_DUTY * power`). With `power = 1` the numbers are exactly the original ones, so programs without `power` run bit-for-bit as before.

Active command behavior (each step):
- **Move**: `travelled += d * v * DT`, `rem = target - travelled`. While `rem > BRAKE_TAU * |v| + 0.005`: `uL = uR = d * CRUISE_DUTY * power`. Otherwise `uL = uR = 0` (brake). The move ends when `rem <= BRAKE_TAU * |v| + 0.005`, `|v| < 0.02` and `|w| < 0.05`. If the robot is blocked and stalled, it keeps pushing until the timeout or battery ends the run.
- **Turn**: `turned += d * w * DT`, `rem = target - turned`. While `rem > TURN_BRAKE_TAU * |w| + 0.01`: `uL = -d * td`, `uR = d * td`, where `td = TURN_SLOW_DUTY * power` if `rem < TURN_SLOW_ZONE` and `TURN_DUTY * power` otherwise. Otherwise brake (`u = 0`). Moves and turns latch into braking: once braking starts it continues until the command ends. Ends when braking and `|w| < 0.05` and `|v| < 0.02`.
- **Wait**: `u = 0` until `N` seconds pass.
- **Bump drive** (new): `elapsed += DT`. While not braking: if `bumper` (from the previous step's contact) then start braking; else if `elapsed >= UNTIL_BUMP_TIMEOUT` record `bump_timeout {t, line}` and start braking; else `uL = uR = CRUISE_DUTY * power`. Braking: `u = 0` until `|v| < 0.02` and `|w| < 0.05`, or until `UNTIL_BUMP_SETTLE_MAX` (2 s) of braking has passed, then the command ends. So every `until-bump` ends within `UNTIL_BUMP_TIMEOUT + UNTIL_BUMP_SETTLE_MAX` = 17 s (R10.3a), whatever the floor or walls do. Cutting the motors on contact means `until-bump` never produces a `stall`.

Spec-time measurement with emulated power (duties scaled by hand in a throwaway script): move error stays within 1.5 cm and turn error within 1.5 degrees at every power from 10 to 100; time grows roughly as 1 / power (`forward 300`: 5.3 s at 100, 48.5 s at 10). With the old fixed 0.2 stall threshold no stall was detected at power 20 or below, which is why the threshold scales with power.

When the stack empties, `programDone = true`. The run ends as FAIL (`program_ended`) once `programDone` and `|v| < 0.02` and no goal was reached. `forward 0` and `wait 0` end in one step.

## 6. Language (`lang.js`)

Grammar (case-insensitive, whitespace and newlines are separators, `;` starts a comment to end of line):

```
program  := { command }
command  := ("forward"|"back"|"left"|"right"|"wait"|"power") NUMBER
          | "until-bump"
          | "repeat" NUMBER block
          | "if" ("wall-ahead" | "bumped") block
block    := "[" { command } "]"
NUMBER   := digits [ "." digits ]
```

Limits (`LIMITS`): move distance 0 to 1000 cm; turn 0 to 3600 degrees; repeat count 1 to 100; wait 0 to 60 s; power 10 to 100 (`MIN_POWER`, `MAX_POWER`; decimals allowed); `power` and `until-bump` each count as 1 command; nesting depth at most 8; program text at most 5000 characters; at most 2000 commands after expanding all repeats (counted with saturation, so the check itself cannot overflow or hang).

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
- New: `Line 2: "power" needs a number from 10 to 100, like power 50.` (missing number), `Line 2: 150 is too big for "power". The most is 100.`, `Line 2: "power" must be at least 10, but I found 5.`
- New: `Line 4: "until-bump" does not take a number. It drives until the bumper touches a wall.` (when a number follows it)
- Changed wording for `if` without a condition: `"if" needs a condition: wall-ahead or bumped, like: if wall-ahead [ left 90 ]`. It still contains "wall-ahead", which the existing test checks.
- `power` and `until-bump` join the "did you mean" keyword list. Existing suggestions are unchanged (checked: `lft`, `fowrard`, `repeet` keep their suggestions; `banana` still gets none).
- With `{ positions: true }`, `power` nodes get `start`, `numStart`, `numEnd`, and `until-bump` / `if bumped` nodes get `start`.

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

### 7b. Chapters, layouts and new levels (R11)

Compatibility: `LEVELS` stays exactly the 3 chapter 1 definitions, because existing tests check `LEVELS` has ids 1, 2, 3. New exports:
- `ALL_LEVELS`: the 9 definitions, ids 1 to 9.
- `CHAPTERS`: `[{ id: 1, name: 'Basics', levels: [1, 2, 3] }, { id: 2, name: 'Grip and Power', levels: [4, 5, 6] }, { id: 3, name: 'Bumpers', levels: [7, 8, 9] }]`.
- `getLevel(id, layout)`: looks up `ALL_LEVELS` (unknown ids still give level 1); `layout` is 0, 1 or 2 and defaults to 0.
- `buildLevel(def, layout)`: uses `def.layouts[layout].map` when `def.layouts` exists, otherwise `def.map`. The built level gains `chapter`, `layout` (`'A'`, `'B'`, `'C'` or `null`), `layoutCount` and `powerMatters`. A level with no `layouts` builds exactly as before.
- Goal: the goal rectangle is the bounding box of all `G` cells. A test checks every cell in that box is `G`. Levels with one `G` cell get the same rectangle as before.
- `powerMatters: true` (chapter 2 and icy challenge levels) turns on the coach's power-insert edits and adds the hint "Lower power asks the floor for less force." to the slip explanation. Other levels are untouched.

Starting values below are not tuned yet. Task 26 tunes them like task 8 and records final values and changes in section 10.

**Chapter 2: Grip and Power.** `o` cells here are ice (`slickMu` around 0.08). Spec-time experiment (duties scaled by hand, capacity 50 C so only the physics shows): on a long icy hairpin with friction 0.08, power 100 hit a wall and needed 85.8 s and 13.2 C; power 80 took 27.4 s and 2.44 C; power 70 took 26.4 s and 1.13 C; power 60 took 29.8 s and 0.96 C; power 50 took 35.0 s. Short icy maps (one or two corners) passed at every power, so all three levels use long ice legs after a turn, where full power slides into the walls. The time limit also punishes very low power, so each level has a power window.

| id | Name | Map (rows top to bottom) | Ice mu | Battery | Time | Reference |
|---|---|---|---|---|---|---|
| 4 | Ice Hairpin | `############` / `#Sooooooooo#` / `##########o#` / `#Gooooooooo#` / `############` | 0.08 | 2.5 C | 40 s | `power 70` `forward 450` `right 90` `forward 100` `right 90` `forward 450` |
| 5 | Frozen Switchback | `#############` / `#Soooooooooo#` / `###########o#` / `#ooooooooooo#` / `#o###########` / `#ooooooooooG#` / `#############` | 0.08 | 4 C | 75 s | `power 70` `forward 500` `right 90` `forward 100` `right 90` `forward 500` `left 90` `forward 100` `left 90` `forward 500` |
| 6 | Black Ice | `##############` / `#S.....#######` / then 6 rows of `######o#######` / `######......G#` / `##############` | 0.08 | 3 C | 30 s | `forward 250` `right 90` `power 60` `forward 350` `power 100` `left 90` `forward 300` |

Level 6 mixes normal floor and ice. It is meant to need power changes in the middle of the program: full power everywhere crashes on the ice, and low power everywhere runs out of time. Task 26 checks both.

**Chapter 3: Bumpers.** Each level has layouts A, B and C with the same size, start and heading (east). A run passes only if all three pass.

| id | Name | Layout differences | Battery | Time | Reference |
|---|---|---|---|---|---|
| 7 | Dark Corridor | corridor of 3, 5 or 7 cells, goal in the cell below its end | 3 C | 20 s | `until-bump` `back 15` `right 90` `forward 50` |
| 8 | Long Hall | east leg 4, 6 or 3 cells, then south leg 2, 3 or 4 cells, goal east of the bottom | 3 C | 35 s | `until-bump` `back 15` `right 90` `until-bump` `back 15` `left 90` `forward 50` |
| 9 | Find the Door | corridor of 8 cells; the door in its south wall is at column 3, 5 or 8; a room below with a goal row along its floor | 3 C | 45 s | `right 90` `repeat 8 [ if wall-ahead [ left 90 forward 50 right 90 ] ]` `until-bump` |

`back 15` works because the bumper stops the robot with its centre `BODY_R` (0.10 m) from the wall, and the last cell's centre is 0.25 m from the wall.

Level 7 maps (width 10, height 4; rows 0 and 3 are all `#`):
- A: `#S...#####` / `####G#####`
- B: `#S.....###` / `######G###`
- C: `#S.......#` / `########G#`

Level 8 maps (width 10, height 7; unlisted rows are all `#`):
- A: row 1 `#S....####`, row 2 `#####.####`, row 3 `#####.G###`
- B: row 1 `#S......##`, rows 2 and 3 `#######.##`, row 4 `#######.G#`
- C: row 1 `#S...#####`, rows 2 to 4 `####.#####`, row 5 `####.G####`

Level 9 maps (width 10, height 6): row 0 `##########`, row 1 `#S.......#`, row 2 the door row (A `###.######`, B `#####.####`, C `########.#`), row 3 `#........#`, row 4 `#GGGGGGGG#`, row 5 `##########`.

Why a fixed program fails: the layout A program `forward 150` `right 90` `forward 50` (level 7) turns 2 cells too early on layout B and drives into the wall below the corridor. Task 26 adds that as a test for each chapter 3 level.

## 8. Module interfaces

### lang.js
- `parse(text, options) -> { ok, program, errors }`. With `options.positions === true`, every command node also gets `start` (character offset of its keyword) and, for nodes with a number, `numStart` and `numEnd` (offsets of the number token, end exclusive). Without the option the node shape is unchanged. The coach uses these offsets to edit the source text in place. `program` is an array of nodes: `{type:'forward'|'back'|'left'|'right'|'wait', n, line}`, `{type:'repeat', n, body, line}`, `{type:'if', cond:'wall-ahead'|'bumped', body, line}`, and new `{type:'power', n, line}` and `{type:'until-bump', line}`. `errors` is an array of `{line, message}` (at most 5). Never throws.
- `LIMITS`, `countCommands(program)`.

### sim.js
- `createSim(level, program) -> sim`.
- `sim.step()` advances one step of `DT`. Does nothing after the run ends.
- `sim.state`: `{t, x, y, theta, v, w, wL, wR, uL, uR, charge, soc, Vt, Voc, current, draw, slipL, slipR, contact, sensor, programDone}`, plus new `power` (0.1 to 1), `bumper` (boolean) and `bumped` (the latched flag). The golden-run comparison (section 12) ignores these three new keys and compares every original key exactly.
- `sim.events`: array of `{type, t, ...}`:
  - `collision {speed}`
  - `stall {duration, current, duty}` (created when the stall reaches 0.5 s; `duration` and `current` keep updating while it lasts, so the current falls as the battery sags)
  - `slip {wheel:'L'|'R', required, limit, mu, peak}`
  - `battery_flat {charge_used}`
  - `timeout {limit, distance_to_goal}` (`distance_to_goal` is the straight-line distance in meters from the robot center to the goal-zone center; the same for `program_ended`)
  - `goal {}`
  - `program_ended {distance_to_goal}`
  - new: `bump_timeout {line, elapsed}` (an `until-bump` drove `UNTIL_BUMP_TIMEOUT` without the bumper being pressed; the program continues)
- `sim.result`: `{status:'running'|'pass'|'fail', reason:null|'goal'|'timeout'|'battery_flat'|'program_ended'}`.
- `sim.sensorDistance()`, `sim.wallAhead()`.
- `runToEnd(level, program, maxSteps) -> sim` for tests and the reference-solution check.
- `C` (constants), `noLoadSpeed()`.

### levels.js
`LEVELS`, `buildLevel`, `getLevel` as in section 7, plus `ALL_LEVELS`, `CHAPTERS` and the `layout` argument from section 7b.

### gen.js
See section 13. Exports `generate(seed)`, `SEED_MIN` (1), `SEED_MAX` (150), `difficulty(seed)`, `makeRng(seed)`.

### telemetry.js
- `createTelemetry(max = 1200) -> tel`.
- `tel.record(state, stepIndex)` appends a sample every `SAMPLE_EVERY` steps (step 0 included): `{t, speed: |v|, current: I_motor, charge: soc}`.
- `tel.samples` (array, oldest first), `tel.clear()`.
- `plotBounds(samples) -> {tMax, speedMax, currentMax}` rounds ranges up to a readable step so axes stay stable.

### explain.js
- `explain(snapshot) -> { verdict:'PASS'|'FAIL', title, causes:[{type, t, text, root}], summary }`, where `snapshot = {result, events, state, level}`. Text is built from event fields only. Rule order: earliest event first; the earliest cause is marked `root: true`. Example text: `The robot stalled against a wall for 1.2 s, drawing 0.74 A. A stalled motor draws its maximum current and wastes battery.`
- If there are no cause events and the result is fail: `The program finished 0.62 m short of the goal.`
- New cause `bump_timeout` (title "Bumper never touched"): `until-bump on line 3 drove for 15.0 s without touching a wall, so the program went on to the next command.`
- New: when `snapshot.level.powerMatters` is true, the slip text gets one more sentence: `Lower power asks the floor for less force.` Every other existing text stays byte-identical.

### coach.js
See section 11. Exports `coach`, `createSearch`, `generateEdits`, `applyEdits`, `LIMITS` (`CANDIDATE_CAP`, `SCALE_FACTORS`, `TURN_DELTAS`, `WAITS`, `MAX_EDITS`).

### ui.js
- Wires DOM to the modules. Holds `{level, sim, tel, speed}`. `requestAnimationFrame` loop with an accumulator: `steps = floor(acc / DT)` where `acc += frameSeconds * speed` (cap 0.25 s per frame so a hidden tab does not spiral). Drawing never changes simulation state.
- Draws: arena (walls, slick cells, goal, robot, sensor ray) on one canvas; telemetry graph on another canvas using margins reserved for axes and legend; panel text as DOM text, not canvas.

## 9. Test plan summary
- Unit tests: parser accept/reject cases and messages; motor equations at known points (stall current `Vt / MOTOR_R`, zero torque at no-load); battery sag; slip threshold; collision; sensor; each level's reference program passes; explain text for each cause.
- Property tests (seeded PRNG, 200 to 1000 cases each): parser never throws on random text; battery charge never increases; simulation is deterministic; speed never exceeds `V_NL`; robot never ends inside a wall; no NaN in state; telemetry never exceeds 1200 samples.
- Added with R9 to R13: golden-run compatibility (section 12); power and bumper unit and property tests; level structure and tuning tests for all 9 levels and their layouts; generator property tests over all 150 seeds; coach on 10 generated levels. Target: the whole suite stays under about 30 s.

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
- At the original slick friction (0.25), slip barely changes outcomes, because braking from cruise needs about the same distance with or without slip (0.079 m planned, 0.076 m friction-limited). That is why chapter 2 uses ice (about 0.08) and long legs after turns. Task 26 adds its tuning rows here.

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

### Power edits and layouts (added with R9 to R11)

Power edits, with sizes on the same scale as the other edits:
- `power-change` (always available): for each existing `power N` node, set it to each value in `POWER_VALUES` = 30, 40, 50, 60, 70, 80, 90, 100, skipping `N`. `size = |N' - N| / 100`.
- `power-insert` (only when `level.powerMatters` is true): insert `power P ` before any `forward`, `back`, `left`, `right` or `until-bump`, on the same line, for `P` in `POWER_INSERTS` = 60, 80. `size = (100 - P) / 100` (0.4 or 0.2). The edit text says it applies "from line N on", because power stays set.

`until-bump` and `if bumped` have no numbers, so they get no edits of their own.

`generateEdits(text, options)`: `options.powerInsert` turns on power inserts; `createSearch` passes `powerInsert: level.powerMatters === true`. Called without options, `generateEdits(text)` returns exactly today's list for programs without `power` (the existing test that expects 21 edits for `forward 50 / left 90` stays as it is).

Layouts: `createSearch(levelOrLevels, text)` also accepts an array of built levels (the 3 layouts of a chapter 3 level). A candidate passes only if it passes every layout. For ranking it uses the largest finish time and the largest charge used across layouts. "Closest" for an honest failure uses each candidate's worst layout distance. The explanation quotes the first failing layout of the original run and prefixes its lines with the layout, for example `Before (layout B): ...`. A single level behaves exactly as today. A search over 3 layouts costs about 3 times as much per candidate; the 3000-candidate cap is unchanged.

Multi-layout fallback (R8.17): `LIMITS.MULTI_LAYOUT` is `'search'` by default. If task 26 finds that the coach test on chapter 3 takes more than 15 s, it is set to `'off'`. Then `createSearch` with more than one layout returns at once with `{ found: false, program: text, edits: [], explanation: 'No suggestion for multi-layout levels.', tried: 0 }`, and the UI shows that text in place of the search. Task 26 records the measured time and the setting in section 10.

Compatibility: chapter 1 levels have `powerMatters` false and one layout, so the coach produces byte-identical results there. Task 23 checks this against the recorded coach outputs in the golden fixture (section 12).

## 12. Compatibility check (golden runs)

The first step of task 19, before `lang.js` or `sim.js` change, is to write `scripts/record-golden.js` and record `tests/fixtures/golden-runs.json` with today's code:
- every chapter 1 reference program and the careless programs from `tests/tuning.test.js`, on their levels;
- 150 random valid programs from the generator in `tests/sim.property.test.js` (fixed seed 300000) on levels 1 to 3;
- the `coach()` result for 20 failing programs on levels 1 to 3.

For each run it stores the level id, the program text, the result, the event log and the final state (original keys only). `tests/compat.test.js` re-runs everything with the new code and requires `JSON.stringify` equality. The fixture is committed and never regenerated after the change. If a later task needs it regenerated, that is a behavior change and must be raised with the user.

## 13. Challenge Mode generator (`gen.js`)

`generate(seed)` returns a level definition in the same shape as `ALL_LEVELS` entries: `{ id: 1000 + seed, seed, name: 'Challenge ' + seed, chapter: 'challenge', hint, map, capacity, timeLimit, slickMu, powerMatters, reference, attempts, fallback }`. It never throws. A seed that is not a whole number from 1 to 150 is rounded and clamped, and `NaN` becomes 1.

Randomness: `makeRng(seed)` is mulberry32, written inside `gen.js` (the copy in `tests/helpers.js` is for tests only). No `Math.random`, no clock.

`difficulty(seed)`:
- `turns = min(10, 1 + floor((seed - 1) / 15))`: seeds 1 to 15 have 1 turn; seeds 136 to 150 have 10.
- segment length 2 to 5 cells (2 to 4 when `turns >= 7`, so long paths still fit).
- slick chance per segment after the first: 0 below seed 31, then `min(0.5, (seed - 30) / 120)`.
- floor type of slick segments: friction 0.25 for seeds 31 to 90, ice (0.08) from seed 91.

Path: the grid is at most 15 by 11 cells including the border wall. The start is a floor cell heading east. Each segment picks a length and, after the first, a left or right turn. A segment is accepted only if every new cell is inside the border and is not next to (4-neighbour) any earlier path cell except the cell it continues from, so corridors are always separated by a wall. Up to 50 tries per segment, then the attempt restarts. The last cell of the path is `G`. Every other cell is `#`.

Reference program, derived from the same path: for each segment, `forward (length * 50)`, then `right 90` or `left 90` before the next segment. On ice levels, `power 60` comes before the first command of an ice segment and `power 100` before the first command of the next normal segment; `powerMatters` is true.

Budget, by simulation:
1. Run the reference with capacity 1000 C and time limit 1000 s, which gives time `T` and charge `U`.
2. `capacity = max(0.5, ceil(U / 0.65 / 0.05) * 0.05)` and `timeLimit = max(10, ceil(T / 0.65))`.
3. Re-run with those values. Accept if it passes with `t <= 0.75 * timeLimit` and `used <= 0.75 * capacity`. Otherwise multiply both by 1.1 and repeat, at most 8 times. (A smaller battery sags sooner and slows the robot, so step 3 is needed.)
4. If it still fails, start a new attempt with sub-seed `seed * 100 + attempt`, at most 20 attempts. As a last resort return a fixed 4-cell straight corridor with `fallback: true`. A test requires `fallback === false` for all 150 seeds.

`hint` text, for example `Seed 97: 7 turns, 2 icy patches. Lower power on ice.`

## 14. UI additions (R13)

- **Level picker:** one `<select>` with `<optgroup>` labels "Chapter 1: Basics", "Chapter 2: Grip and Power", "Chapter 3: Bumpers" and "Challenge". The "Challenge" group has one entry, "Challenge mode". Choosing it shows a seed row: `SEED [17] PREV NEXT` with a number field limited to 1 to 150. PREV and NEXT are text buttons. Changing the seed builds `gen.generate(seed)` and loads it. The arena header shows `Challenge 17 (seed 17)` and the hint line shows the generator's hint.
- **Layouts:** on chapter 3 levels the visible run uses layout A. When it ends, layouts B and C run at once with `runToEnd`; today a level run takes 0.6 to 1.3 ms in Node, so this is instant. A row of chips under the status line shows `LAYOUTS  A PASS  B FAIL  C PASS`, using text labels as well as colour. Clicking a chip replays that layout visibly. The run passes only if all chips pass. The status line and the panel name the first failing layout, for example `FAIL: layout B: Stalled against a wall (root cause, at 4.2 s).`
- **Readout:** add `power 60%` and, while pressed, `BUMPER`.
- **Robot drawing:** a front bumper arc in front of the shell, drawn amber while pressed.
- **Help:** add `power 60  ; percent, 10 to 100`, `until-bump`, and `if bumped [ ... ]`.
- **Arena sizing:** `arenaHeight` and `fitTransform` already handle any map size. Challenge maps are at most 15 by 11 cells.
- **Out of scope:** 3D, sound, accounts, saving of progress.

## 15. Objectives, export, shortcuts and tooling (tasks 33 to 38)

**Objectives.** Level definitions gain `title`, `objective` and `hint`, shown in one block above the arena (title on its own line, then the objective, then the hint in muted text). Generated levels use templates filled from facts: `turns`, `slickPatches`, `icePatches` and path length in metres. Example: title `Challenge 97: 7 turns, 2 icy patches`; objective `Reach the goal at the end of a 9.5 m corridor.`; hint `Lower power before the 2 icy patches.`, or `Count the turns: right, left, left, right, ...` when there is no ice.

**Export (`export.js`, no DOM).** `toCpp(programOrText, { title })` returns `{ ok, code, errors }`. Structure of the output:
- a header comment: generated by Logo for Robots, uncalibrated, tune on a real robot;
- `const` timing values with a "derived from the simulator, uncalibrated" comment on each: `MS_PER_CM`, `MS_PER_DEG`, `CRUISE_PWM` (0 to 255 from `CRUISE_DUTY`), `TURN_PWM`, `WALL_AHEAD_CM` (35), `UNTIL_BUMP_MAX_MS` (15000);
- declarations of the board functions the user provides: `setMotorPwm(int left, int right)` (signed -255 to 255), `int readDistanceCm()`, `bool bumperPressed()`, `void delayMs(unsigned long)`, `unsigned long millisNow()`;
- one `runProgram()` function with one statement block per command and a `// line N` comment.

Mapping: `forward N` gives `setMotorPwm(p, p); delayMs(N * MS_PER_CM / power); setMotorPwm(0, 0);`. Turns work the same way with opposite signs. `repeat N [...]` becomes `for (int iK = 0; iK < N; iK++) { ... }`. `if wall-ahead` becomes `if (readDistanceCm() < WALL_AHEAD_CM) { ... }`. `if bumped` uses a `bumped` flag that is set whenever `bumperPressed()` is polled true and cleared on read. `until-bump` becomes a loop that drives until `bumperPressed()` or `UNTIL_BUMP_MAX_MS`. `power N` sets a `power` variable. `wait N` becomes `delayMs(N * 1000)`. The timing values come from simulating `forward 100` and `left 90` at power 100 once, including acceleration and braking. No third-party brand names appear in the output or the UI.

**Judge shortcuts.** One button row above the editor; each button calls the same load function as the picker.

**`tools/sim-mcp/`.** `server.js` reads newline-delimited JSON-RPC 2.0 on stdin and writes responses on stdout. It handles `initialize`, `tools/list` and `tools/call` for the three tools, and returns errors as tool results. It requires the app's logic files from `../../`. It is not loaded by `index.html` and has no dependencies. The README shows an `mcp.json` entry (`command: "node"`, `args: ["tools/sim-mcp/server.js"]`).

**Second hook.** `.kiro/hooks/run-level-tests-on-save.json`, in the same `v1` format as `run-tests-on-save.json`.