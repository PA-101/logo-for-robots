# Logo for Robots

Write a few lines of Logo, watch a simulated robot run them, and find out why real robots do not behave like a perfect turtle.

This project revives Logo, the 1960s turtle-programming language, to teach how real robots behave: motors lose torque as they speed up, stalled motors draw maximum current, batteries sag and run flat, wheels slip on ice, and a robot that cannot see a wall has to feel for it. It is an entry in the Kiroween 2026 hackathon, Resurrection category.

**Live:** https://pa-101.github.io/logo-for-robots/

## How to run

- Open the live link above, or
- Double-click `index.html` in a current desktop browser. There is no build step, no server, no install and no network access.

To run the tests, use Node 18 or newer:

```
node --test tests/
```

## What is in it

**Three chapters of handpicked levels**

| Chapter | Levels | What it teaches |
|---|---|---|
| 1. Basics | First Steps, Staircase, Slippery Corner | distances, turns, `repeat`, a first slippery patch and a small battery |
| 2. Grip and Power | Ice Hairpin, Frozen Switchback, Black Ice | at full power the wheels spin on ice and the battery runs flat; lower `power` keeps grip |
| 3. Bumpers | Dark Corridor, Long Hall, Find the Door | each level has 3 layouts, and a program must pass all of them; measured distances fail, `until-bump` and `if bumped` work |

**Challenge mode:** levels 1 to 150 built from a seed. The generator lays out a corridor and derives the reference program from the same path, so every seed is solvable by construction. A test checks all 150. Later seeds have more turns, then slick patches (from seed 31), then ice where lower power is needed (from seed 91). The battery and time limits come from simulating the reference program with a safety margin.

Every level shows a title, a one-sentence objective and a hint you can open. The JUMP TO buttons load Basics, Grip and Power, Bumpers, Challenge 75 and Challenge 150 with a starter program that shows each lesson.

## Commands

| Command | Example | Meaning |
|---|---|---|
| `forward N` | `forward 50` | drive forward N cm |
| `back N` | `back 20` | drive backward N cm |
| `left N` | `left 90` | turn left N degrees |
| `right N` | `right 45` | turn right N degrees |
| `wait N` | `wait 1` | stop the motors for N seconds |
| `power N` | `power 60` | drive at N percent power (10 to 100) from here on |
| `until-bump` | `until-bump` | drive forward until the front bumper touches a wall (gives up after 15 s) |
| `repeat N [ ... ]` | `repeat 4 [ forward 50 right 90 ]` | run the block N times |
| `if wall-ahead [ ... ]` | `if wall-ahead [ left 90 ]` | run the block if the distance sensor sees a wall closer than 35 cm |
| `if bumped [ ... ]` | `if bumped [ back 10 ]` | run the block if the robot touched a wall since the last check |
| `; text` | `; my note` | a comment |

## After a run

- **Telemetry:** a live graph of speed, motor current and battery level.
- **Result:** on a pass, a one-line RESULT banner. On a failure, "WHY DID IT FAIL?" lists the causes found in the run's event log, earliest first, with real numbers. For example: "The robot stalled against a wall for 3.5 s, drawing 0.72 A." On bumper levels, chips show A PASS, B FAIL, C FAIL, and clicking one replays that layout.
- **Auto-Fix Coach:** SUGGEST A FIX tries small changes to the numbers in your program (distances, turn angles, waits, power) and simulates each one. It shows the smallest change that passes as a side-by-side diff, with a before and after explanation in numbers. APPLY FIX puts it in the editor. If nothing passes, it says so and names the closest attempt. When wheel slip caused the failure on an icy level, it tries power changes first.
- **Apply and undo:** APPLY FIX clears the old result, puts the fix in the editor, and offers UNDO to bring back your previous program.
- **Export:** EXPORT TO MICROCONTROLLER CODE turns the program into code for a two-wheeled robot whose two motors run through a motor-driver board. Pick the language in the dialog, then press COPY:
  - **C++:** you provide five small board functions (motor PWM, distance sensor, bumper, delay, clock).
  - **MicroPython:** uses the standard `machine` and `time` modules. You set the pin numbers at the top and fill in a placeholder distance-sensor function.

  Both use the same timing constants, derived from the simulator. The dialog's HARDWARE NOTES explain what to calibrate (cm per second at power 100, turn degrees per second, battery sag) and what real robots add that the simulator does not.

## Keyboard

| Key | What it does |
|---|---|
| Ctrl+Enter (Cmd+Enter on a Mac) in the editor | run the program |
| Tab and Shift+Tab | move between controls; inside the export window, focus stays in the window |
| Esc | close the export window (focus returns to the EXPORT button) |
| Enter or Space on a focused button | press it |

The editor remembers your program for each level, and the page reopens on the last level you used. Both are stored in your browser's local storage. If storage is blocked, the page still works but forgets on reload.

## Developer tools (not part of the app)

- `tools/sim-mcp/`: the simulator as an MCP server with `list_levels`, `run_program` and `suggest_fix`. See its README for how to register it in Kiro. `docs/mcp-proof.md` records what has and has not been verified.
- `scripts/`: headless-browser checks (`e2e-levels.js`, `e2e-coach.js`, `e2e-ux.js`, `audit.js`), a compile check for exported code (`check-export-compiles.js`, needs g++), and `record-golden.js`. That last one recorded the compatibility fixture once, before the power and bumper change.
- `.kiro/`: steering, specs (requirements, design, tasks), two hooks that run tests on save, and `build-report.md`.

## Known limitations

- The battery capacity is scaled for demo: levels use a few coulombs so a flat battery happens within seconds.
- The wheel inertia in the model is about 20 times a real wheel's. A realistic value makes the 60 Hz simulation unstable, so wheel slip mostly shows as acceleration limited by friction, not as a visibly spinning wheel.
- The cruise current is lower than a real robot's, because the model has little drag and no rolling resistance. A stalled robot draws about 25 times the cruising current.
- The coach is search-based planning: a deterministic search over small numeric edits, each checked in the simulator. No trained model is involved. It only changes numbers and inserts `wait` or `power`; it cannot add missing commands.
- The exported C++ and MicroPython are uncalibrated. Their timing comes from the simulator, and moves are timed with no wheel encoders (dead reckoning), so a real robot will drift until the constants are tuned on it. Neither export has been run on a real robot: the C++ samples are compiled with g++, and the MicroPython samples are compiled and run under CPython with stand-in hardware modules.
- 2D only, no sound, no accounts, no saving.
