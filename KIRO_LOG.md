# Kiro build log

How Logo for Robots was built with Kiro (Kiro IDE, agent sessions), in order. Each line is a commit on `main`, with the test count after it. Details are in `.kiro/build-report.md` and `docs/kiro-writeup-notes.md`.

## 1. Plan first (specs and steering, no code)

| Commit | What | Tests |
|---|---|---|
| `143dab5` | Steering (product, tech, design) and the spec: requirements, design with physics equations and constants, 14 tasks | 0 |

## 2. Language and physics (tasks 1 to 9)

| Commit | What | Tests |
|---|---|---|
| `7979df9` | Task 1: page, module stubs, seeded-PRNG test harness | 8 |
| `e97e54a` | Task 2: parser | 8 |
| `67aaf50` | Task 3: parser unit tests. A test found that nested empty `repeat` loops were accepted (they would have hung the simulation); fixed | 47 |
| `a8b01ec` | Task 4: parser property tests (thousands of random inputs) | 56 |
| `e6a4034` | Hook: run tests on save | 56 |
| `12b61b1`, `6442967` | Tasks 5 and 6: physics core, walls, sensor, stall, interpreter, 3 levels | 56 |
| `dcce1fb` | Task 7: physics unit tests. Tests found a slip-model bug (a slipping wheel could lag the ground and brake the robot) and turn overshoot; both fixed | 102 |
| `994b2e8` | Task 8: tuning of battery and time limits, logged in design.md | 114 |
| `b4d0a1b` | Task 9: simulation property tests (charge never rises, determinism, speed limit, walls, finite state, termination). No real bug found; deliberately broken versions of the code confirmed the properties catch faults | 156 |

## 3. Telemetry, explanations, UI (tasks 10 to 13)

| Commit | What | Tests |
|---|---|---|
| `4d1c25d` | Task 10: telemetry recorder | 125 |
| `f3702b7` | Task 11: explanations. A test found that 7.05 printed as "7.0" (binary rounding); fixed | 139 |
| `5b4b5a1`, `8daf299` | Tasks 12 and 13: UI, turtle robot, graph, failure panel, checked with headless-Chrome screenshots | 147 |
| `73335f0` | Status line uses the same root cause as the panel; larger arena | 162 |

## 4. Auto-Fix Coach (spec first, then tasks 15 to 18)

| Commit | What | Tests |
|---|---|---|
| `be800e6` | Spec: coach requirements, design, tasks | 162 |
| `4cbc180`, `6c9a98d`, `3a3e0fc` | Tasks 15 to 17: coach search, unit tests, property tests | 192 |
| `5e876b4` | Task 18: Suggest-a-fix UI with diff and Apply | 199 |

## 5. Power, bumper, chapters, Challenge Mode (spec first, tasks 19 to 38)

| Commit | What | Tests |
|---|---|---|
| `7519a60`, `53f7136` | Spec: power, bumper, 9 levels, generator, then a hard 17 s until-bump limit and tasks 33 to 38 | 199 |
| `d258f74` | Golden runs recorded from the old code before any change (compatibility fixture) | 202 |
| `8f31c35` to `c134dd6` | Tasks 19 to 25: parser, physics, coach and levels for power and bumper | 252 |
| `c0da5f7` | Coach tries power edits first when slip is the root cause (spec change R8.18) | 256 |
| `d703759` | Part 1: result panel, command help | 259 |
| `acead14` | Task 26: level tuning; level 6 redesigned after exploration showed full power passed on the old map | 265 |
| `7ec4f23`, `c077734`, `f43d71a` | Tasks 27 to 29: generator, all 150 seeds checked, coach on generated levels | 276 |
| `5b9ddc4` to `8f47cd6` | Tasks 30 to 32: level picker, layout chips, browser check | 282 |
| `573191d` to `745c271` | Tasks 33 to 36: objectives, C++ export (compiled with g++), export dialog, shortcuts | 301 |
| `ccfe953`, `6ea15b1` | Tasks 37 and 38: MCP server (Kiro registration blocked by a permission rule; see docs/mcp-proof.md) and a second hook | 308 |
| `e47db6b` | Part 4: visual audit of 98 states; responsive layout and contrast fixes | 308 |

The duplicate commits `f632b32` and `f3bf635` only repeated a build-report entry; they came from shell commands I thought had been interrupted.
