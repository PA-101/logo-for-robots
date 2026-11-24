# Product: Logo for Robots

Logo for Robots revives Logo, the 1960s turtle-programming language, to teach how real robots behave. It is a Kiroween 2026 entry in the Resurrection category.

## Audience

Students learning robot programming. They know little or nothing about motors, batteries or friction. They should leave understanding that a robot is not a perfect turtle.

## Core idea

The student writes a few lines of Logo (`forward 50`, `left 90`, `repeat 4 [ ... ]`). A simulated two-wheeled robot runs the program under real physics: motors lose torque as they speed up, stalled motors draw maximum current, batteries sag and run flat, and wheels slip. When the program fails, a "Why did it fail?" panel explains the cause using numbers recorded during the run.

Later chapters add two real-robot ideas: lowering drive power so the wheels keep their grip on ice (`power 60`), and using a bumper instead of measured distances when the robot cannot know how far a wall is (`until-bump`, `if bumped`).

## Scope

In scope:
- Code editor and a tiny Logo-style language with friendly, line-numbered errors, including `power`, `until-bump` and `if bumped`.
- Differential-drive robot with motor, battery, slip, wall collisions, a distance sensor and a front bumper.
- 9 handpicked levels in 3 chapters (Basics; Grip and Power; Bumpers) with a goal zone and a pass/fail result. Bumper levels have 3 layouts, and a program must pass all of them.
- Challenge Mode: 150 generated levels from a seed, each solvable by construction.
- Live telemetry graph (speed, motor current, battery level).
- "Why did it fail?" panel.
- Auto-Fix Coach: a deterministic search that tries small numeric edits and simulates each one. It is never described as AI.
- Run, Reset and a speed control.

Out of scope: sound, 3D graphics, accounts, saving, mobile layout, AI models, multiplayer. Do not add them.

Compatibility: new features must not change how any existing program behaves.

## Principles

- Failures are the lesson. Explanations quote real numbers (for example "stalled for 1.2 s at 0.74 A").
- Error messages are written for beginners, never stack traces.
- The app must never crash on any input.
