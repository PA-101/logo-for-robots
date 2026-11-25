# Build report

Running log of the autonomous build. One entry per task: what was done, test count, commit, and anything that looks wrong. Blockers are listed at the end.

## Part 1: result panel and labels

- Removed the "battery scaled for demo" label from the page; it is in the README's Known limitations.
- Result panel: hidden before a run and after Reset. Pass shows a "RESULT" banner with one line and no causes or coach. Every failure shows "WHY DID IT FAIL?" with just the reasons and the Suggest-a-fix button. No attempt counting.
- The red status line names the same root cause as the panel (unchanged logic). On pass the status line is green, not red.
- COMMANDS help lists all 11 command forms with one example each; a test parses every example.
- Test change (requirement change, not a weakening): `tests/ui.test.js` asserted the page contains "battery scaled for demo". It now asserts the page does not contain it and the README does.
- Bug found by a new test: my own "no 'again'" check matched "against"; fixed to whole words.
- Tests: 259 pass.
- Looks off: the pass line appears twice (status line under the arena and the RESULT banner). Kept, because the status line is the arena's own status.

## Part 2: task 26 (tuning chapters 2 and 3)

- Level 4: battery 2.5 to 3.5 C, time 40 to 44 s. At friction x0.9 the reference now uses 64% of the time and 51% of the battery. Full power runs flat at x0.9, x1.0 and x1.1.
- Level 6, first attempt as instructed: lower ice friction 0.04, 0.05 and 0.06 on the existing map. Every result was identical to 0.08 (full power passes in 17.1 s), because the robot speeds up and brakes on dry floor and needs no grip on the straight ice leg.
- Level 6, fallback as instructed: redesigned with long ice legs after icy turns (18 x 10 map, battery 1.8 C, time 46 s). Full power runs flat at all three frictions; the reference passes with 67% battery and 69% time; power 60 everywhere is about 10% slower.
- Authorized test change (level 6 only): "power 60 everywhere fails on time" became "two power values, and power 60 everywhere is at least 8% slower". Old text, new text and reason are in design.md section 10.
- Level 9: battery 3 to 3.5 C (layout C used 74.7%).
- Chapter 3 checks: references use until-bump; a fixed-distance program from layout A passes A and fails B and C on all three levels. Coach timing on chapter 3: about 2.7 s for 6 searches, so MULTI_LAYOUT stays "search".
- Tests: 265 pass.
- Looks off: level 4's charge use jumps with battery size (75% at 2.9 C, 51% at 3.0 C), so its tuning is sensitive. Chapter 3 time limits are loose (references use 19 to 52%).

## Task 27: generator gen.js

- Mulberry32 seeded generator, difficulty schedule, wall-separated corridor path in a 15 x 11 grid, map cropped to the path, reference derived from the same segments (power 60 on ice segments from seed 91), battery and time from simulating the reference with the margin loop, deterministic retries, fallback level.
- All 150 seeds build without the fallback (most on attempt 1, the worst needed 17 attempts). Generating all 150 takes about 4.6 s in Node.
- Smoke test's expected script list now includes gen.js (same strictness; required by the design's script order).
- Tests: 266 pass.

## Task 28: generator property tests

- All 150 seeds: the reference passes with at least 25% margin, no fallback, deterministic JSON, closed map within 15 x 11, the floor is one simple corridor (S and G have one floor neighbour, every other cell exactly two), the reference has exactly the planned turns, no slick floor below seed 31, no ice or power below seed 91, ice levels lower power. Odd seeds (0, -5, 151, 2.5, NaN, "17", "abc", null, Infinity) are clamped and never throw. Plus gen.test.js unit tests.
- Tests: 275 pass; the whole suite takes about 13 s (the generator file is most of it).

## Task 29: coach on generated levels

- Seeds 5, 20, ..., 140 with the last forward halved: the coach finds a fix for all 10; each fix parses, passes and has 1 or 2 edits; each search stays within 3000 candidates. The whole test takes about 5.6 s (target 15 s).
- Tests: 276 pass.

## Task 30: level picker and Challenge seed picker

- The level select has chapter optgroups plus "Challenge mode"; a seed row (number field 1 to 150, PREV, NEXT that wrap around) appears in Challenge mode; the arena header shows "Level N: Name" or "Challenge N (seed N)"; the readout shows power and BUMPER. Hash support: `#level=4`, `#level=c75`, `#level=challenge&seed=75`. Help was done in Part 1.
- Fixed: the readout line ran past the panel border when slip, BUMPER and STALLED all showed; it now wraps.
- Tests: 280 pass.

## Task 31: layout chips and bumper drawing

- On chapter 3 levels layout A runs in the arena, then B and C run instantly. Chips under the status line read "A PASS / B FAIL / C FAIL" (text plus colour), and clicking a chip replays that layout. The status line and the panel name the first failing layout ("FAIL: layout B: Stalled against a wall ..."). The coach searches all layouts. The robot has a front bumper arc that turns amber while pressed.
- Tests: 282 pass.
- Looks off: after a multi-layout failure the telemetry graph and battery gauge show the layout that ran visibly (A), while the panel explains B. Click the B chip to see B's telemetry.

## Task 32: browser check

- New `scripts/cdp.js` (shared headless-Chrome helper) and `scripts/e2e-levels.js`. Through the real UI at 4x: level 1, level 4, level 7 (all 3 layouts), challenge 1, 75 and 150 all pass with their reference programs. A fixed-distance program on level 7 gives A PASS, B FAIL, C FAIL; clicking the B chip replays layout B. No page errors or console warnings.
- The no-AI-wording test now also covers gen.js.
- Tests: 282 pass.
- Looks off: "PASS on all 3 layouts: Reached the goal in 4.8 s" quotes layout A's time, not the slowest layout's.

## Task 33: level objectives

- Every handpicked level has a title (its name), a one-sentence objective and a hint. Generated levels build all three from facts: the turn count and patch counts in the title, corridor length in metres in the objective, and either the real turn sequence or the icy-patch advice in the hint. Shown above the arena: the title line, the objective, and a collapsible HINT.
- Level 1's hint was replaced, because it repeated the objective.
- Bug found by checking the output by eye, not by a test: "a 11.5 m corridor". Fixed, and the new test checks the article.
- Tests: 286 pass.

## Task 34: microcontroller export export.js

- `toCpp(program, { title })` emits plain C++: an UNCALIBRATED header, constants derived from the simulator with "uncalibrated" on each line (MS_PER_CM 20.83, MS_PER_DEG 8.52, CRUISE_PWM 204, TURN_PWM 153, WALL_AHEAD_CM 35, UNTIL_BUMP_MAX_MS 15000), declarations of five board functions the user provides, helpers (driveFor polls the bumper, untilBump, checkBumped), and runProgram with one commented line per command. A title cannot close the C comment.
- Five fixed expected outputs are in tests/fixtures/export/. `scripts/check-export-compiles.js` compiled all five with g++ -std=c++11 -Wall -Wextra -fsyntax-only against stub board functions: all OK (a developer check, not part of node --test).
- Tests: 296 pass.
- Physically: the export uses dead reckoning by time, so on a real robot distances and angles will drift; the header says so.

## Task 35: export UI

- An "EXPORT TO MICROCONTROLLER CODE" button under the editor opens a modal dialog with the generated C++ (read-only), an uncalibrated note, COPY and CLOSE. A parse error shows "Fix the program first. Line N: ..." instead of code, with COPY disabled. Copy uses the clipboard API in a secure context, otherwise it selects the text and tries execCommand.
- Browser check: the dialog opens with 60 lines for level 1, and the bad-program case works. No page errors.
- Tests: 298 pass.
- Not verified: in headless Chrome over file:// the clipboard write was not available, so COPY fell back to "The code is selected. Press Ctrl+C to copy it." The clipboard path on GitHub Pages (https) needs a real click to confirm.

## Task 36: judge shortcuts

- A "JUMP TO" row above the editor: BASICS (level 1, the passing example), GRIP AND POWER (level 4 at full power, which slips and fails), BUMPERS (level 7 with distances from layout A: A PASS, B FAIL, C FAIL), CHALLENGE 75 and CHALLENGE 150 (the reference with the last leg halved, which the coach can fix). Each loads the level exactly as the picker does, then puts the starter in the editor.
- Tests check the mapping and that each starter behaves as described.
- Tests: 301 pass.

## Task 37: tools/sim-mcp server

- `tools/sim-mcp/server.js`: MCP over stdio (newline JSON-RPC 2.0, no dependencies) with list_levels, run_program(level_id, program) and suggest_fix(level_id, program); challenge ids are `challenge:N`. Bad ids, bad programs and bad messages return errors and never crash. README explains how to register it in Kiro. `tests/mcp.test.js` drives it through stdin and stdout (4 tests).
- BLOCKED (registration and calls through Kiro): a Kiro permission rule ("kiro-scope") refused the write to `.kiro/settings/mcp.json`. I did not bypass it. So the tools were not in my catalogue, and `load_resource("tool::logo-for-robots-sim::list_levels")` was rejected. Exact errors are in docs/mcp-proof.md, with a direct stdio transcript that is labelled as not made through Kiro.
- Tests: 305 pass.

## Task 38: second hook

- `.kiro/hooks/run-level-tests-on-save.json` runs the level and generator test files when `levels.js` or `gen.js` is saved, in the same v1 format as the first hook. It also runs `levels.tuning.test.js`, which is not in the spec's list but is a level test. A test checks both hooks parse, that the first hook is unchanged, that the matcher matches levels.js and gen.js but not sim.js, mylevels.js or tests/gen.test.js, and that every file the command names exists.
- The first full run reported the new hook file as missing (the file write had not landed yet); a rerun passed. Not a code issue.
- Tests: 308 pass.

## Part 4: visual audit and fix

- `scripts/audit.js` shoots 14 states at 7 size and zoom combinations (98 states) and checks each in the page: horizontal scroll, overflowing text, elements sticking out of panels, overlapping blocks, tiny or stretched canvases, text contrast below 7:1, console errors. `scripts/cdp.js` now takes full-page screenshots and reloads through about:blank, because a hash-only change did not re-run the page.
- Before: 91 of 98 states had issues. A horizontal scrollbar in 65 (the fixed 1422 px three-column grid), and line-number contrast 3.7:1 in all.
- Fixes: a two-column layout below 1440 px with telemetry and the result panel underneath (the wide layout and its test are unchanged); line numbers `#46b866` (7.9:1); failure text `#ff8a80` (the steering colour `#ff3b30` measured only 5.4 to 5.7:1 as text, below the steering file's own 7:1 rule; it stays for graphics, and the steering table now lists both); the arena header wraps instead of running "ARENALEVEL" together (found by eye); a hover state for the COMMANDS toggle.
- After: 0 of 98 states with issues, no console errors. Before and after shots are in docs/screenshots/ (16 files, about 4.4 MB) with a README of findings and fixes.
- Tests: 308 pass.
- Not covered: native dropdown lists cannot be captured headless; the export dialog backdrop only covers the window area in full-page shots (a capture effect).

## Part 5: docs

- README: live link (GitHub Pages checked: it serves the current build), how to run, the three chapters and Challenge mode, the commands, the result panel, the coach, the export, developer tools, and Known limitations.
- Wording decision: you asked the README to say the coach is "not a language model". The existing R8.15 test rejects the words "language model" anywhere in README.md, even in a negation, and loosening it would weaken a test. The README says "search-based planning ... No trained model is involved" instead.
- KIRO_LOG.md created (it did not exist). docs/kiro-writeup-notes.md lists only what happened, with commits and test counts. It separates bugs found by tests from problems found by screenshots and scripts, and says no separate review agent was run.
- Process slip: the first commits of task 29 (`f43d71a`) and task 35 (`d9dd231`) came from commands I thought had been interrupted, and were pushed before I had seen their test results. Their code is identical to the later states that passed (276 and 298 tests), so no failing state was pushed. The second commits (`f632b32`, `f3bf635`) only duplicated a report entry; the duplicates were removed.
- Tests: 308 pass.

## Task 14: final check (done last, after Parts 4 and 5)

- Walkthrough in headless Chrome over file://, the same as opening index.html by double-click. Through the UI: references for levels 1, 4 and 7 (all 3 layouts) and challenges 1, 75 and 150 pass. A fixed-distance level 7 program shows A PASS / B FAIL / C FAIL and replays B. Coach: three fixes applied and re-run to PASS, and one "NO FIX FOUND". The Part 4 audit covered stall, battery flat, slip, timeout and stopping short, the export dialog and Challenge mode with no overlaps or console errors. All 9 references pass every layout in the Node tests.
- New `tests/nodom.test.js`: no DOM, unseeded randomness or clock reads in any logic file (comments and strings stripped first), and every logic file has the dual export line.
- Harness bug found during this check: `scripts/cdp.js` and `e2e-coach.js` used fixed debugging ports, and on Windows `kill()` left Chrome child processes running. A later run attached to a stale browser and reported level 1's reference as failing. Fixed: Chrome picks a free port (read from DevToolsActivePort), the whole process tree is killed on close, and e2e-coach.js uses the shared helper. 4 leftover headless Chrome processes that my scripts started (temporary lfr-chrome profiles) were stopped. The rerun is clean.
- Not done: a physical double-click in a desktop browser by a person. Every browser check here was headless.
- Tests: 312 pass (suite about 16 s).

## Blocked

1. MCP registration and calls through Kiro (task 37). A Kiro permission rule ("kiro-scope") refused writes to `.kiro/settings/mcp.json`; it was not bypassed. So list_levels, run_program and suggest_fix were never called through Kiro. Exact errors and a direct stdio transcript (clearly labelled) are in docs/mcp-proof.md. To unblock: add the entry from tools/sim-mcp/README.md yourself, then call the tools in a new turn.
2. Not fully verified: COPY to the real clipboard (task 35). Headless file:// fell back to selecting the text. It needs a check with a real click on GitHub Pages.
