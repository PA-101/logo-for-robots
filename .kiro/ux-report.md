# UX report

Branch `overnight`. I ran a first-time-judge walkthrough with a headless browser script at 1366x768 and 1920x1080, recorded the facts, and took screenshots. Before and after shots are in `docs/screenshots/ux/`. Each finding below lists what happened, a severity and the planned fix. The fix results are added under each finding afterwards.

Severity: **High** means a judge gets lost or loses work. **Medium** means confusing, or it breaks a stated requirement. **Low** means polish.

## Findings (written before fixing)

| ID | Severity | What happened | Planned fix |
|---|---|---|---|
| UX-01 | High | First screen: the only text near RUN is the button itself. Nothing says "edit the program, then press RUN" or mentions Ctrl+Enter. (The starter program does pass on the first click: "PASS: Reached the goal in 5.9 s".) | Add a one-line instruction under RUN / RESET: "Edit the program, then press RUN (or Ctrl+Enter)." |
| UX-02 | High | Switching level keeps the previous level's program. After a run of `forward 50` on level 1, switching to level 7 left `forward 50` in the editor. | Each level gets a starter: comment lines with its title and objective. A program typed on a level is remembered for that level (UX-13). |
| UX-03 | High | After APPLY FIX the old FAIL status, panel and arena stay on screen, so it looks like the fix failed. There is no way back to the previous program. | Apply clears the old result (like Reset) and shows "Fix applied to line N. Press RUN to try it." with an UNDO button that restores the previous program. |
| UX-04 | Medium | While running, the editor is read-only, but the message under it still says "3 commands ready." Nothing explains the lock. | While running, the message says "The editor is locked while the robot runs. Press RESET to stop and edit." |
| UX-05 | Medium | Jump-to buttons have no active state. After clicking GRIP AND POWER nothing shows which chapter you are in. | Mark the button for the current level's chapter (or challenge seed) with an active style and `aria-pressed`. |
| UX-06 | Medium | Export dialog: Tab moves from COPY to CLOSE to the code box, and then out of the dialog to the page. Esc closes it and focus returns to the opener (that part works). | Keep Tab and Shift+Tab inside the dialog while it is open. |
| UX-07 | Medium | An empty editor then RUN shows "Nothing to run ..." with the status "PROGRAM ERROR. Fix the line shown on the left." There is no line to fix. | For "nothing to run", the status says "NOTHING TO RUN. Type a command, for example forward 50." |
| UX-08 | Medium | Challenge seed: empty, "abc", 0 and -3 silently become seed 1, 151 becomes 150, and 2.5 becomes 3. No feedback is shown. PREV at 1 wraps to 150 and NEXT at 150 wraps to 1, with nothing saying so. | When the typed seed was not a whole number from 1 to 150, show "Seeds go from 1 to 150, so this is seed N." Keep the wrap-around, and say it in the PREV and NEXT button titles. |
| UX-09 | Medium | "Layout A/B/C" is never explained before a run. On level 7 the objective box does not say a program must pass three layouts. | On multi-layout levels the objective box adds "This level has 3 layouts (A, B, C) with different lengths. Your program must pass all of them." |
| UX-10 | Medium | Persistence: nothing is stored (localStorage is empty after editing and switching levels). A reload loses the work. | Remember the program per level and the last level in localStorage, always inside try/catch, so blocked storage never breaks the page. |
| UX-11 | Low | The editor textarea has `outline: none`. Its focus shows only as a border colour change, which is weak next to the clear rings on buttons. | Add a visible focus ring on the editor box (`:focus-within` outline). |
| UX-12 | Low | Units: the panel speaks of "C" (coulombs) while the battery gauge shows % and V. "C" is never explained. | Add a units line to the COMMANDS help: "Units: cm, degrees, seconds; battery charge in C (coulombs)." |
| UX-13 | Low | Edge states not yet checked by the walkthrough: resizing the window mid-run, and the tab hidden mid-run. | Check with a browser script. Fix only if something breaks. |

### Checked and fine (no fix planned)

- Ctrl+Enter in the editor runs the program.
- Tab order follows the page: jump-to, editor, run controls, speed, export, help, level picker, hint.
- Buttons, summaries and the select show focus rings.
- Reset works while running.
- The active speed button is filled.
- A parse error shows next to the editor and marks the gutter line in red.
- The 2000-command limit message is clear.
- Suggest a fix appears only after a failure.
- Copy gives "Copied to the clipboard." (or the select-and-Ctrl+C fallback).
- Results have `aria-live`.
- Pass and fail always carry the words PASS and FAIL, not colour alone.
- Inputs have labels.
- Text contrast is already at least 7:1 (Part 4 audit).
- The result panel has no scroll area of its own, so "scroll resets to top" does not apply.
- No console errors in any step.

## Fixes

All 13 findings were fixed in one commit, in severity order. Each is checked by unit tests for the pure helpers in `tests/ui.test.js` and by `scripts/e2e-ux.js` for the flows. That script ran 25 checks at both 1366x768 and 1920x1080, and all 25 passed at both sizes. `scripts/e2e-levels.js`, `scripts/e2e-coach.js` and `scripts/audit.js --quick` (0 issues in 28 states) still pass. Screenshots are in `docs/screenshots/ux/before/` and `docs/screenshots/ux/after/`.

| ID | Fix | Checked by |
|---|---|---|
| UX-01 | "Edit the program, then press RUN (or Ctrl+Enter)." under RUN / RESET | page test, e2e "instruction near RUN" |
| UX-02 | Level switch saves the old program, then loads the remembered program or a starter (title and goal as comments). Comment-only starters never run a hidden solution. Level 1 keeps the passing example. | `starterProgram` tests, e2e "switch" checks |
| UX-03 | APPLY FIX resets the old result, puts the fix in the editor and shows "Fix applied to line N. Press RUN to try it." with UNDO, which restores the previous program | e2e "apply" and "undo" |
| UX-04 | While running: "N commands running. The editor is locked while the robot runs; press RESET to stop and edit." While the coach searches, a matching message. Both clear when it ends. | e2e "lock is explained", "lock message cleared" |
| UX-05 | The jump-to button for the current chapter or seed is filled and has `aria-pressed="true"` | `jumpActiveIndex` tests, e2e "jump-to" |
| UX-06 | Tab and Shift+Tab wrap inside the export dialog. Esc closes it and focus returns to EXPORT. | e2e "dialog" checks |
| UX-07 | An empty or comment-only program gives "NOTHING TO RUN. Type a command, for example forward 50." | `parseErrorStatus` tests, e2e "empty program" |
| UX-08 | Invalid seeds show "Seeds go from 1 to 150, so this is seed N." The PREV and NEXT titles say they wrap around. | `seedInput` tests, e2e "seed" checks |
| UX-09 | Multi-layout levels say "This level has 3 layouts (A, B, C) with different lengths. Your program must pass all of them." before the run | `layoutNote` tests, e2e "layouts explained" |
| UX-10 | Programs per level and the last level are saved in localStorage through `createStore`. Every access is in try/catch. | `createStore` tests (missing, throwing and full storage), e2e "reload" and "blocked storage" |
| UX-11 | The editor box shows a 2 px focus ring | screenshots |
| UX-12 | The COMMANDS help has a units line (cm, degrees, seconds, C = coulombs) and a keys line (Ctrl+Enter, Esc) | page test |
| UX-13 | Resizing mid-run: the run finishes with the normal result and the canvas follows the new width (no fix needed). Hiding the page mid-run: the run pauses with no errors and the clock does not jump (no fix needed). | e2e "resize mid-run", "hidden mid-run" |

### Not fully verified

- UX-13, resuming a hidden tab: in headless Chrome the page stays `hidden` after it is frozen and resumed, so the script could not check that a run continues once the tab is visible again. This rests on `requestAnimationFrame` resuming and on the 0.25 s per-frame cap in `framePlan`, which a unit test covers.

### Still looks off

- In the 330 px editor column, long starter comment lines run past the visible width. The editor scrolls sideways, and the same title and objective are shown in full above the arena.
- A starter is comment-only, so pressing RUN on a fresh level 2 to 9 says "NOTHING TO RUN". That is honest, but a judge has to type something or use a JUMP TO button, which loads a runnable starter.

## Part B: hardware alignment

- **B1, MicroPython target:** `toMicroPython` and `exportTo(target, ...)` in `export.js`, plus a LANGUAGE selector (C++ or MicroPython) in the export dialog.
  - The MicroPython code makes the same assumptions as the C++ export, which has not changed. It drives two motors through a motor-driver board, with one PWM pin and one direction pin per motor.
  - The pin numbers (`LEFT_PWM_PIN` and the others) are marked constants, and the timing comes from the same simulator-derived constants.
  - `if wall-ahead` calls a placeholder `read_distance_cm()` function.
  - The header says the code is uncalibrated, uses dead reckoning with no encoders, and must be tuned on a real robot.
  - Tests in `tests/export.micropython.test.js`, 9 in total:
    - fixed expected outputs for the 5 samples, in `tests/fixtures/export-py/`;
    - a property test showing it never throws on 400 random valid programs, with one commented line per command;
    - no throws on odd input, and no brand names;
    - with Python 3 installed (it is on this machine, so these ran): `py_compile` of all 5 samples, and each sample run end to end under CPython with stand-in `machine` and `time` modules. Both passed.
- **B2, hardware notes:** a collapsible "HARDWARE NOTES" section in the export dialog. It covers what the code assumes, what to calibrate (cm per second at power 100, turn degrees per second, battery sag, the distance sensor), and what real robots add (gearbox friction and dead band, encoder noise, sensor noise, motor heating, battery resistance).
- No brand or vendor names in the UI or the exported code; the existing brand test covers `index.html`, `ui.js` and `export.js`.
- With the notes open the dialog is taller than the window at 1366x768, so it scrolls.

## Part C: docs

- README: export targets (C++ and MicroPython, the language selector, hardware notes), APPLY FIX with UNDO, a keyboard table, per-level memory, and the honest limits of both exports (not run on a real robot).
- docs/kiro-writeup-notes.md: both overnight runs, what each found, and which findings came from tests versus scripts or screenshots (no app bugs were found by tests in either run). Hook-triggered count: 0 observed in any session.

## Blocked

- Nothing blocked. One check is only partly verified: resuming a hidden tab (UX-13), because headless Chrome keeps the page hidden after freeze and resume.
