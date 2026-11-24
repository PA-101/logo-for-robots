# Visual audit screenshots

Taken with `node scripts/audit.js <folder>` (headless Chrome). It shoots 14 screen states (boot, ready, running, pass, four failure causes, a layout failure, coach suggestion, export dialog, Challenge mode with the hint open, the commands help, and a 45-line program) at 1280x720, 1366x768 and 1920x1080 at 100%, and at 125% and 150% browser zoom on 1366x768 and 1920x1080. That is 98 states. In each one the script also checks for a horizontal scrollbar, text overflowing its box, elements sticking out of their panel, overlapping blocks, tiny or stretched canvases, text contrast below 7:1, and console errors.

`before/` was taken before the Part 4 fixes. Those shots cover only the window, not the whole page. `after/` was taken after the fixes and covers the full page.

## What the audit found and what was changed

| Finding | States | Fix |
|---|---|---|
| Horizontal scrollbar: the fixed three-column layout (330 + 640 + 380 px, body min-width 1240 px) was wider than the window | 65 of 91 flagged states (every 1280 and 1366 px view, and every zoomed view) | Below 1440 px the page uses two columns: program and arena side by side, telemetry and the result panel in a full-width row underneath. The wide three-column layout is unchanged. |
| Line numbers in the editor gutter and the coach diff: 3.7:1 contrast | all 91 | New line-number colour `#46b866` (7.9:1). |
| Failure text (status line, causes, errors) in `#ff3b30`: 5.4 to 5.7:1, below the steering file's 7:1 rule | found after the audit threshold was raised from 4.5:1 to the steering file's 7:1 | Failure text uses `#ff8a80` (7.2:1 or better, including on the red-tinted panel). `#ff3b30` stays for graphics and borders. |
| "ARENALEVEL": at narrow widths the ARENA heading and the LEVEL picker ran together and the picker dropped below | seen by eye at 1280x720 at 150% (the automatic checks did not catch it) | The arena header wraps with a gap, and the label and picker stay on one line. |
| The status readout ran past the panel border when slip, BUMPER and STALLED all showed | seen by eye in task 30 | The readout wraps. |
| The COMMANDS toggle had no hover state | seen during the audit | Added a hover and focus colour. |

After the fixes the full audit reported 0 issues in all 98 states, with no console errors.

## Known limits of the audit

- Native dropdowns (the level picker list) cannot be captured in headless Chrome. The picker was checked closed, and with Challenge mode and its seed row open.
- In full-page screenshots, the modal backdrop of the export dialog only covers the window area. In a real browser it covers what you see.
- The automatic overlap check only compares sibling blocks inside a panel. The "ARENALEVEL" problem was found by looking at the screenshots.
