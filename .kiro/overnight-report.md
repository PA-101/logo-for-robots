# Overnight report

Polish run on branch `overnight`, created from `main` at `47637fa` because the branch did not exist yet. Nothing was committed to or pushed to `main`.

## Item 1: one layout in the panel, graph and battery

- After a run on a bumper level, the arena, graph, battery and panel all show the same layout: the first failing layout, or the slowest layout when all pass. If that is not the layout that ran visibly, it is re-simulated instantly with telemetry and trail recording. The simulation is deterministic, so this matches a live run. The TELEMETRY and BATTERY headings get a "(layout B)" tag, and the shown chip is outlined.
- The all-layouts line now quotes the slowest layout, for example "PASS on all 3 layouts. Slowest, layout C: Reached the goal in 8.1 s with 78% battery left." The RESULT panel adds "Slowest layout: C."
- New pure helper `layoutToShow` with tests. `combineLayouts` and its existing tests are unchanged.
- Browser check on level 7: the fixed-distance program shows layout B everywhere (battery 0%, matching layout B's real run); the reference shows layout C, 8.1 s and 78%, matching the simulation. No page errors.
- Process note: two scratch files were first written to the system temp folder against the "nothing outside the repo" rule; they were deleted. Scratch work now lives in `.scratch/` inside the repo (excluded through `.git/info/exclude`, not `.gitignore`). `scripts/cdp.js` puts browser profiles in `LFR_TMP` when it is set, and deletes the profile on close.
- Tests: 315 pass. Commit `ed9ca9a`.

## Item 2: compact suggested-fix diff

- The coach diff shows only changed lines plus one line of context on each side. Other unchanged lines fold into a "N lines unchanged" row. New pure helper `diffWindow` with unit tests and a property test: no changed line is ever dropped, line order is kept, and every line is either shown or counted in a gap. `lineDiff` and its tests are unchanged.
- Browser check (`scripts/e2e-coach.js`): all three fixes still show their changed rows (1, 1 and 2), and each applied fix passes when re-run. On level 1 the comment and first line fold into "2 lines unchanged". No page errors.
- Tests: 318 pass. Commit `b2879a2`.

## Item 3: level 4 battery in a flatter region

- A 0.05 C scan from 2.6 to 4.6 C, at friction x0.9, x1.0 and x1.1, found two sudden jumps in the reference's charge use, not one: at x0.9 between 2.95 and 3.00 C (75.0% to 51.2%), and at x1.0 between 3.30 and 3.35 C (42.9% to 30.9%). The old value, 3.5 C, was only 0.15 C above the second jump.
- Changed level 4's battery from 3.5 to 4.0 C. Between 3.9 and 4.1 C, x0.9 charge use varies by at most 1.1 points within +-0.25 C, x1.0 is smooth (28.3 to 28.9%), and the nearest jump is 0.6 C away.
- At 4.0 C the reference uses 48.3% of the battery and 64.6% of the time at x0.9, 28.6% and 61.2% at x1.0, and 25.4% and 60.5% at x1.1. Full power runs flat at all three. Recorded in the design.md tuning log, and the level table is updated. This is a level value, not a physics constant.
- Tests: 318 pass.
