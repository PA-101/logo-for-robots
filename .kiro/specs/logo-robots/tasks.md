# Tasks: Logo for Robots

Build in this order. Each task is small, ends with a passing `node --test tests/` (where it has tests), and is committed on its own. Requirement numbers refer to `requirements.md`.

- [x] 1. **Scaffold and test harness.** Create `index.html` (empty panels, script tags in order), `style.css` (theme variables only), empty module files with the export pattern, `tests/helpers.js` (seeded PRNG, random-string generator) and a smoke test that requires every module. Check that `index.html` opens by double-click. _Requirements: 7.1, 7.2, 7.3_

- [x] 2. **Parser (`lang.js`).** Tokenizer with line numbers, recursive-descent parser, limits, friendly error messages, "did you mean" suggestion, command count with saturation. _Requirements: 1.2 to 1.12_

- [x] 3. **Parser unit tests.** Every command; nested repeat; multi-line blocks; comments; case-insensitivity; each error message and its line number; every limit at the boundary and one past it; empty and comment-only input. _Requirements: 1.2 to 1.12_

- [x] 4. **Parser property tests.** (a) `parse` never throws on random strings, random token soups, and mutated valid programs (characters deleted, inserted, swapped); (b) result shape is always valid (`ok` matches `errors.length === 0`; every error has a line number of at least 0 and a message); (c) generated valid programs always parse and `countCommands` matches an independent count; (d) parse is deterministic. _Requirements: 1.10, 1.11_

- [x] 5. **Physics core (`sim.js`, part 1).** Constants, battery (`Voc`, sag, charge), motor model, ground contact with slip, body integration, with duties set directly (no program yet). `createSim` accepts a test-only duty override. _Requirements: 2.1, 2.3 to 2.9, 2.13_

- [x] 6. **World and interpreter (`sim.js`, part 2) and `levels.js`.** Wall collisions, sensor ray, stall detection, event log, interpreter (move, turn, wait, repeat, if), goal, timeout, result. `levels.js` with `buildLevel`, the 3 levels and reference programs. _Requirements: 1.2 to 1.8, 2.10 to 2.12, 3.1 to 3.5_

- [x] 7. **Physics and level unit tests.** Stall current equals `Vt / MOTOR_R`; torque is zero at no-load speed and falls linearly; voltage sag under load; battery flat ends the run; slip starts above `F_lim` and not below; slick floor slips where normal floor does not; wall stops the robot; stall event after 0.5 s; sensor distances in a known map; `wall-ahead` branch taken and skipped; each reference program passes its level; a program that drives into a wall fails with a `stall` event; an empty-battery case ends with `battery_flat`; `timeout` event. _Requirements: 2.4 to 2.12, 3.1 to 3.7_

- [x] 8. **Tune constants and levels.** Using the unit tests and a small Node script, adjust battery capacity, time limits and slick friction so reference programs pass with at least 25 percent margin in time and charge, the level 3 turn produces `slip` events, and careless programs fail with the expected cause. Update `design.md` with final values. _Requirements: 3.1, 3.7_

- [x] 9. **Simulation property tests.** (a) battery charge never increases and stays between 0 and capacity; (b) the simulation is deterministic: two runs of the same random program on the same level give equal state and event logs (compare with `JSON.stringify`); (c) speed never exceeds the no-load speed `V_NL` and wheel surface speeds stay under it; (d) the robot center is never inside a wall; (e) no NaN or Infinity in any state value; (f) `runToEnd` always terminates within the step limit; (g) forced random duties (test hook) respect all of the above. Programs come from a random valid-program generator. _Requirements: 2.2, 2.6, 2.10, 2.13_

- [x] 10. **Telemetry (`telemetry.js`) with tests.** Recorder at 10 Hz, ring limit of 1200 samples (drop oldest), `clear`, `plotBounds`. Tests: sample count after N steps, limit holds under property test with random run lengths, bounds always cover the data. _Requirements: 4.1, 4.4, 4.5_

- [x] 11. **Explain (`explain.js`) with tests.** One test per cause (stall, battery flat, slip, timeout, program ended short), multiple causes ordered earliest first with the root flag, PASS text, and numbers in the text match the event fields exactly. Property test: `explain` never throws on random event logs. _Requirements: 5.1 to 5.8_

- [x] 12. **UI shell (`ui.js`, `index.html`, `style.css`).** Editor with example program, level selector, Run, Reset, speed control (0.5x, 1x, 2x, 4x), parse errors shown with line numbers, fixed-timestep accumulator loop, arena canvas drawing (walls, slick cells, goal, robot, sensor ray, trail). Editor locked while running. _Requirements: 1.1, 1.10, 1.12, 2.1, 3.6, 6.1 to 6.4_

- [x] 13. **Telemetry graph and "Why did it fail?" panel.** Graph canvas with reserved margins for axes and legend (speed green, current amber, battery dashed), cleared on Reset; panel with PASS/FAIL result and the explain text; amber and red styling with text labels. _Requirements: 4.2, 4.3, 4.4, 5.1 to 5.8_

- [ ] 14. **Final check and README.** Do this last, after tasks 15 to 38. Also walk through one level per chapter and three challenge seeds (1, 75, 150). Manual walkthrough of all 3 levels by double-clicking `index.html` in a current browser (pass each with its reference program; trigger stall, battery flat, slip, timeout and see the panel; ask the coach for a fix on a failing run and apply it); check no text overlaps graphics; confirm no DOM use outside `ui.js` with a grep test; finish `README.md`. _Requirements: 7.1 to 7.3, 8.14, 8.15_

## Auto-Fix Coach (added after the first 14 tasks)

- [x] 15. **Parser positions and coach core (`lang.js`, `coach.js`).** Add `parse(text, { positions: true })` (offsets only when asked, so existing node shapes stay the same). Write `coach.js`: `generateEdits`, `applyEdits`, `createSearch` with singles, sorted pairs, the 3000 cap and ranking, `coach`, and the before/after explanation. Add `coach.js` to `index.html` before `ui.js`. _Requirements: 8.1 to 8.13_

- [x] 16. **Coach unit tests.** Positions match the source text; existing parse results are unchanged without the option. `generateEdits` gives the exact edits for a known program (factors, deltas, waits, skips at 0 and the language limits). `applyEdits` keeps comments and line breaks, and edits inside `repeat` are labelled. A known fixable failure on each level is fixed with the expected single edit (for example level 1 `forward 200 / right 90 / forward 50` becomes `forward 100`). Pairs are tried only when no single edit passes. Ranking order; cap of 3000; an already-passing program; a parse error; an unfixable program (missing command) returns an honest message with the closest distance. Numbers in the explanation equal the event fields (`explain.fmt`). Clearing `level.reference` does not change the result. _Requirements: 8.2 to 8.13_

- [x] 17. **Coach property tests.** For random failing programs on random levels: (a) `coach` is deterministic (same `JSON.stringify` twice); (b) `createSearch` stepped in random chunk sizes gives the same result as `coach`; (c) when `found`, the returned program parses, passes when re-simulated with `runToEnd`, equals `applyEdits(original, edits)`, and has 1 or 2 edits; (d) `tried <= 3000`; (e) every edited value stays within the language limits; (f) `coach` never throws on random text, random levels or missing arguments. Keep case counts low enough that the suite stays under about 30 s. _Requirements: 8.4 to 8.6, 8.11, 8.13_

- [x] 18. **Coach UI.** "SUGGEST A FIX" button in the failure panel after a FAIL; search spread over frames (about 12 ms per frame) with a progress line; result with edits, explanation and "APPLY FIX" (puts the program in the editor, highlights edited lines, does not run it); Reset cancels. A test greps `coach.js`, `ui.js`, `index.html` and `README.md` for "AI", "language model" and "machine learning" and expects none. _Requirements: 8.14, 8.15_


## Power, bumper, chapters and Challenge Mode (14 tasks, in this order)

Rule for every task below: all existing tests stay green, and `tests/compat.test.js` (task 19) must pass after each task.

### Language and physics

- [x] 19. **Golden runs, then the parser.** First, with today's code, write `scripts/record-golden.js` and commit `tests/fixtures/golden-runs.json` plus `tests/compat.test.js` (design section 12). Then add `power N`, `until-bump` and `if bumped` to `lang.js`: limits, messages, keyword suggestions, `countCommands`, positions. _Requirements: 9.1, 9.5, 10.2, 10.6, 1.10_

- [x] 20. **Parser tests for the new commands.** Unit: each new command parses with its line; `power` at 10, 100, 9.9 and 100.5; a missing number; `until-bump 5` gives its own message; `if bumped` with and without a block; nesting; positions for the new nodes; the old suggestions are unchanged. Property: the existing parser properties re-run with a generator that also emits the new commands (never throws, valid shape, `countCommands` matches, deterministic). _Requirements: 9.5, 1.10, 1.11_

- [x] 21. **Simulation: power and bumper.** In `sim.js`: `power` state and scaled duties, the stall threshold `STALL_DUTY * power`, the bumper, the bumped flag, `if bumped`, the bump drive with `UNTIL_BUMP_TIMEOUT` and the `bump_timeout` event. New state keys `power`, `bumper`, `bumped`. _Requirements: 9.1 to 9.4, 10.1 to 10.7, 2.11_

- [x] 22. **Simulation tests for power and bumper.** Unit:
  - The required slip test: floor friction 0.25, `forward 100` at power 100 records slip events, and `power 50` then `forward 100` records none.
  - Move error within 1.5 cm and turn error within 3 degrees at power 10, 30, 50, 70 and 100.
  - A stall is detected at power 20 (it was not with the old threshold).
  - `until-bump` stops with the centre 0.10 m (plus or minus 1 cm) from a wall ahead, ends at once when already touching, records no `stall`, and after 15 s in open space records `bump_timeout` and moves on.
  - A side wall does not press the bumper.
  - `if bumped` is true once after a contact, then false.
  - `power 100` gives runs identical to having no `power` command.

  Property: the task 9 invariants (charge, speed, walls, NaN, termination, determinism) on random programs that include the new commands; every `until-bump` ends within 17 s of starting (hard limit). _Requirements: 9.2 to 9.6, 10.1 to 10.7, 10.3a, 2.2_

- [x] 23. **Explain and coach for power, bumper and layouts.** The `bump_timeout` cause; the slip hint on `powerMatters` levels; the coach's `power-change` and gated `power-insert` edits; `createSearch` accepting several layouts. Unit tests: exact power edits for a known program; no power inserts without `powerMatters`; a known fix on an ice test level that inserts `power 60` or `power 80`; a layout search that rejects a fix passing only layout A; the coach golden results are byte-identical. _Requirements: 9.7, 8.2, 8.16, 10.8_

### Handpicked levels

- [x] 24. **Chapters and layouts in `levels.js`.** `ALL_LEVELS`, `CHAPTERS`, `getLevel(id, layout)`, `buildLevel(def, layout)`, the multi-cell goal rectangle, `powerMatters`, and the 6 new level definitions with the starting values from design section 7b. `LEVELS` stays the 3 chapter 1 levels. _Requirements: 11.1, 11.2, 11.5, 11.6_

- [x] 25. **Level structure tests.** Every map in every layout is rectangular and closed, with one `S` and a fully filled `G` rectangle; all 3 layouts of a level have the same size and start; chapter grouping and ids; levels 1 to 3 build byte-identical to before; unknown ids still give level 1. _Requirements: 11.1, 11.5, 11.6, 3.2_

- [x] 26. **Tune chapters 2 and 3, and the level tests.** Tune friction, battery and time like task 8, and record every change (old value, new value, reason) in design section 10. Tests:
  - Every reference passes every layout using at most 75 percent of time and battery.
  - Chapter 2: removing all `power` commands makes the reference fail.
  - Chapter 2: the reference still passes at slick friction times 0.9 and 1.1.
  - Level 6: the reference uses two power values, and power 60 everywhere is at least 8 percent slower than the reference. (Reworded in task 26 with the user's authorization; old text "Level 6: power 60 everywhere fails on time." See design.md section 10.)
  - Chapter 3: the reference uses `until-bump`, and a fixed-distance program measured on layout A fails at least one other layout.

  Also time the coach test on the chapter 3 levels. If it takes more than 15 s, set `LIMITS.MULTI_LAYOUT = 'off'` (R8.17), test the "No suggestion for multi-layout levels." result, and record the time and the decision in design section 10.

  If a level cannot meet these, stop and report it rather than loosening a test. _Requirements: 11.2 to 11.5, 8.17_

### Challenge Mode

- [x] 27. **Generator `gen.js`.** `makeRng`, `difficulty`, path building with wall separation, map, reference from the same path, ice power commands, the budget from simulation with the margin loop, deterministic retries and the fallback (design section 13). Add `gen.js` to `index.html` before `ui.js`. _Requirements: 12.1 to 12.5, 12.8_

- [x] 28. **Generator property tests.** For all 150 seeds:
  - The reference passes with at least 25 percent margin in time and charge.
  - `fallback` is false.
  - `generate` is deterministic (same JSON twice).
  - The map is closed, at most 15 by 11 cells, with corridors separated by walls.
  - Turns never decrease as the seed rises; no slick floor below seed 31; no ice below seed 91.
  - Odd seeds (0, -5, 151, 2.5, NaN, a string) never throw and are clamped.

  Also check that generating all 150 seeds takes under 10 s. _Requirements: 12.2 to 12.6, 12.8_

- [x] 29. **Coach on generated levels.** For seeds 5, 20, 35, 50, 65, 80, 95, 110, 125 and 140, break the reference by halving its last `forward`. The coach must return a fix that parses, passes and uses at most 2 edits, and the search must stay within 3000 candidates. Record the run time; the target is under 15 s for the whole test. _Requirements: 12.7, 8.4_

### UI

- [x] 30. **Level picker and challenge seed picker.** Chapter optgroups; "Challenge mode" with the seed row (number field 1 to 150, PREV, NEXT); the header shows `Challenge N (seed N)`; the hint line; command help for the new commands; the readout shows power and the bumper. Pure helpers (option list from `CHAPTERS`, seed clamping, header text) get unit tests in `tests/ui.test.js`. _Requirements: 13.1, 13.2, 13.4, 9.8_

- [x] 31. **Layout chips and bumper drawing.** Run layout A visibly, then B and C instantly; chips with PASS or FAIL text; replay on click; the status line and the panel name the first failing layout; the coach button uses all layouts; the bumper arc turns amber while pressed. A pure helper that combines per-layout results gets unit tests. _Requirements: 11.5, 13.3, 8.16_

- [x] 32. **Browser check.** Extend `scripts/e2e-coach.js` (or add `scripts/e2e-levels.js`) to load one level per chapter and challenge seeds 1, 75 and 150. It runs each reference, clicks a failing layout chip, and checks there are no page errors. Take screenshots and check that no text overlaps graphics. The "no AI wording" test also covers `gen.js`. _Requirements: 13.1 to 13.5, 7.1_

## Objectives, export, shortcuts and tooling (after task 32, before task 14)

- [ ] 33. **Level objectives.** Every level, handpicked and generated, gets `title`, `objective` (one sentence) and `hint`, shown above the arena. Handpicked levels write theirs in `levels.js`. `gen.js` builds them from facts about the generated level, for example: "Challenge 97: 7 turns, 2 icy patches" / "Reach the goal at the end of the corridor." / "Lower power on the 2 icy patches." Tests: every level in `ALL_LEVELS` and all 150 seeds has a non-empty title, a single-sentence objective (one final period, under 120 characters) and a hint; generated text matches the level's real turn count and patch counts; the same seed gives the same text. _New requirement R14.1, R14.2_

- [ ] 34. **Microcontroller export `export.js` (no DOM).** `toCpp(program, options)` turns a parsed program into plain C++ with two PWM motor outputs, delay-based timing, a distance sensor read for `if wall-ahead`, a bumper read for `until-bump` and `if bumped`, and `for` loops for `repeat`. The timing constants (ms per cm and ms per degree at power 100, scaled by 1 / power) are derived from the simulator: one simulated `forward 100` and one `left 90` at module load. A header comment and the comment beside each constant say the constants are uncalibrated and must be tuned on a real robot. The board functions (`setMotorPwm`, `readDistanceCm`, `bumperPressed`, `delayMs`, `millisNow`) are declared for the user to provide. The output contains no third-party brand names. Tests:
  - Fixed expected outputs for 5 sample programs (stored in `tests/fixtures/export/`).
  - Never throws on random valid programs, including the new commands.
  - Every command type produces its own code line, with a `// line N` comment.
  - Nesting depth and loop counts are preserved.
  - A brand-name check finds none.

  _R14.3 to R14.5_

- [ ] 35. **Export UI.** An "EXPORT TO MICROCONTROLLER CODE" button under the editor opens a panel with the generated text (read-only, monospace) and a COPY button. Copy uses the clipboard API when available and otherwise selects the text. A parse error shows the error instead of code. No third-party brand names appear anywhere in the UI. Tests: pure helpers for the panel text; the no-brand-name check covers `ui.js`, `index.html` and `export.js`. _R14.5, R14.6_

- [ ] 36. **Judge shortcuts.** A row of quick-jump buttons above the editor: BASICS (level 1), GRIP AND POWER (level 4), BUMPERS (level 7), CHALLENGE 75, CHALLENGE 150. Each loads that level and its starter text, like choosing it in the picker. Test: a pure helper maps each button to the same level the picker would load. _R14.7_

- [ ] 37. **`tools/sim-mcp/` server (not shipped).** A small Node MCP server over stdio, with no dependencies (JSON-RPC written by hand). It provides three tools:
  - `list_levels`: ids, titles, chapters and layout counts.
  - `run_program(level_id, program)`: result, events, final time and charge per layout.
  - `suggest_fix(level_id, program)`: the coach result.

  Challenge levels use ids `challenge:N`. `tools/sim-mcp/README.md` explains how to register it in Kiro's `.kiro/settings/mcp.json` (example entry, not added automatically). Nothing in `index.html` loads it. Tests: drive the server through stdin and stdout for `initialize`, `tools/list` and each tool call, including bad level ids and bad programs (an error result, never a crash). _R14.8_

- [ ] 38. **Second Kiro hook.** Add `.kiro/hooks/run-level-tests-on-save.json`. It runs `node --test tests/levels.test.js tests/levels.chapters.test.js tests/gen.test.js tests/gen.property.test.js` when `levels.js` or `gen.js` is saved, using the same format as the existing hook and the matcher `(^|[\\/])(levels|gen)\.js$`. Test: both hook files parse as JSON with the required fields, and the new matcher matches `levels.js` and `gen.js` but not `sim.js`. _R14.9_