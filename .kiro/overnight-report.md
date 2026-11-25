# Overnight report

Polish run on branch `overnight`, created from `main` at `47637fa` because the branch did not exist yet. Nothing was committed to or pushed to `main`.

## Item 1: one layout in the panel, graph and battery

- After a run on a bumper level, the arena, graph, battery and panel all show the same layout: the first failing layout, or the slowest layout when all pass. If that is not the layout that ran visibly, it is re-simulated instantly with telemetry and trail recording. The simulation is deterministic, so this matches a live run. The TELEMETRY and BATTERY headings get a "(layout B)" tag, and the shown chip is outlined.
- The all-layouts line now quotes the slowest layout, for example "PASS on all 3 layouts. Slowest, layout C: Reached the goal in 8.1 s with 78% battery left." The RESULT panel adds "Slowest layout: C."
- New pure helper `layoutToShow` with tests. `combineLayouts` and its existing tests are unchanged.
- Browser check on level 7: the fixed-distance program shows layout B everywhere (battery 0%, matching layout B's real run); the reference shows layout C, 8.1 s and 78%, matching the simulation. No page errors.
- Process note: two scratch files were first written to the system temp folder against the "nothing outside the repo" rule; they were deleted. Scratch work now lives in `.scratch/` inside the repo (excluded through `.git/info/exclude`, not `.gitignore`). `scripts/cdp.js` puts browser profiles in `LFR_TMP` when it is set, and deletes the profile on close.
- Tests: 315 pass.
