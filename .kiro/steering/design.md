# Visual design

## Look
Retro phosphor-green terminal on a near-black background.

| Role | Color |
|---|---|
| Background | `#050805` |
| Panel background | `#0a110a` |
| Primary text, lines, robot | `#33ff66` |
| Dim text, grid, borders | `#1a7a33` |
| Warning (low battery, slip, near limits) | `#ffb000` |
| Failure (stall, crash, fail result) | `#ff3b30` |
| Failure text (so red text keeps 7:1 contrast; `#ff3b30` stays for graphics and borders) | `#ff8a80` |
| Line numbers | `#46b866` |
| Goal zone | `#33ff66` outline with faint fill |

## Rules
- Monospace font stack: `"Cascadia Mono", Consolas, "Courier New", monospace`.
- Body text at least 16 px. Contrast of text against its background at least 7:1.
- Do not rely on color alone. Warnings and failures also carry a text label (for example `WARN` or `FAIL`).
- No text overlapping graphics. Labels, axis names and the legend sit outside the plot area or in reserved margins. Canvas text never draws over the maze, robot or graph lines.
- Layout is desktop only, in three zones: left (editor, RUN, RESET, speed, COMMANDS, Export code), center (one header bar with the level picker and seed, then title, objective, hint, arena, status line), right (tabs: DIAGNOSIS and TELEMETRY, one visible at a time).
- Fewer things on screen. The first screen shows only the editor with RUN, the arena, one status line and one right tab. Everything else is one click away (popover, dialog, tab, collapsible).
- One status line under the arena: time, one state word, slips so far. No second readout competing with it.
- One guide line above the editor tells the user the next step for the current state. There is no other instruction text.
- No contradictory text: two things on screen must never disagree (for example "slip no" next to a slip cause, or a corridor described as straight when it turns).
- At 1366x768 the editor, RUN, arena, status line and the current tab fit without scrolling the page; the right panel may scroll inside itself.
- Optional subtle scanline effect must be off the text areas and must not reduce readability. No flicker animation.
- Telemetry colors: speed green, motor current amber, battery level dim-green dashed. Each line has a text legend.
- Ice is drawn like slick floor but with a lighter hatch, and the legend says "ice". The front bumper is an arc drawn amber while pressed.
- The level picker groups levels under chapter headings. The Challenge seed row uses text buttons (PREV, NEXT) and always shows the seed number.
- Layout results are chips with text (`A PASS`, `B FAIL`), not color alone.
- 2D only. No 3D, no sound.
