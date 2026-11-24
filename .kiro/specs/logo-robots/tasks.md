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

- [ ] 14. **Final check and README.** Do this last, after tasks 15 to 18. Manual walkthrough of all 3 levels by double-clicking `index.html` in a current browser (pass each with its reference program; trigger stall, battery flat, slip, timeout and see the panel; ask the coach for a fix on a failing run and apply it); check no text overlaps graphics; confirm no DOM use outside `ui.js` with a grep test; finish `README.md`. _Requirements: 7.1 to 7.3, 8.14, 8.15_

## Auto-Fix Coach (added after the first 14 tasks)

- [ ] 15. **Parser positions and coach core (`lang.js`, `coach.js`).** Add `parse(text, { positions: true })` (offsets only when asked, so existing node shapes stay the same). Write `coach.js`: `generateEdits`, `applyEdits`, `createSearch` with singles, sorted pairs, the 3000 cap and ranking, `coach`, and the before/after explanation. Add `coach.js` to `index.html` before `ui.js`. _Requirements: 8.1 to 8.13_

- [ ] 16. **Coach unit tests.** Positions match the source text; existing parse results are unchanged without the option. `generateEdits` gives the exact edits for a known program (factors, deltas, waits, skips at 0 and the language limits). `applyEdits` keeps comments and line breaks, and edits inside `repeat` are labelled. A known fixable failure on each level is fixed with the expected single edit (for example level 1 `forward 200 / right 90 / forward 50` becomes `forward 100`). Pairs are tried only when no single edit passes. Ranking order; cap of 3000; an already-passing program; a parse error; an unfixable program (missing command) returns an honest message with the closest distance. Numbers in the explanation equal the event fields (`explain.fmt`). Clearing `level.reference` does not change the result. _Requirements: 8.2 to 8.13_

- [ ] 17. **Coach property tests.** For random failing programs on random levels: (a) `coach` is deterministic (same `JSON.stringify` twice); (b) `createSearch` stepped in random chunk sizes gives the same result as `coach`; (c) when `found`, the returned program parses, passes when re-simulated with `runToEnd`, equals `applyEdits(original, edits)`, and has 1 or 2 edits; (d) `tried <= 3000`; (e) every edited value stays within the language limits; (f) `coach` never throws on random text, random levels or missing arguments. Keep case counts low enough that the suite stays under about 30 s. _Requirements: 8.4 to 8.6, 8.11, 8.13_

- [ ] 18. **Coach UI.** "SUGGEST A FIX" button in the failure panel after a FAIL; search spread over frames (about 12 ms per frame) with a progress line; result with edits, explanation and "APPLY FIX" (puts the program in the editor, highlights edited lines, does not run it); Reset cancels. A test greps `coach.js`, `ui.js`, `index.html` and `README.md` for "AI", "language model" and "machine learning" and expects none. _Requirements: 8.14, 8.15_
