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
| Goal zone | `#33ff66` outline with faint fill |

## Rules
- Monospace font stack: `"Cascadia Mono", Consolas, "Courier New", monospace`.
- Body text at least 16 px. Contrast of text against its background at least 7:1.
- Do not rely on color alone. Warnings and failures also carry a text label (for example `WARN` or `FAIL`).
- No text overlapping graphics. Labels, axis names and the legend sit outside the plot area or in reserved margins. Canvas text never draws over the maze, robot or graph lines.
- Layout is desktop only: editor and controls on the left, arena in the middle, telemetry and the "Why did it fail?" panel on the right or below.
- Optional subtle scanline effect must be off the text areas and must not reduce readability. No flicker animation.
- Telemetry colors: speed green, motor current amber, battery level dim-green dashed. Each line has a text legend.
