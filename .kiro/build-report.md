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

## Task 29: coach on generated levels

- Seeds 5, 20, ..., 140 with the last forward halved: the coach finds a fix for all 10; each fix parses, passes and has 1 or 2 edits; each search stays within 3000 candidates. The whole test takes about 5.6 s (target 15 s).
- Tests: 276 pass (suite about 15 s).
