# Requirements: Logo for Robots

Scope is exactly the list below. Sound, accounts, saving, mobile layout, AI models and multiplayer are out of scope.

Glossary: "program" is the text in the editor. "Step" is one 1/60 s simulation tick. "Event" is a record the simulation appends to its event log.

## R1. Code editor and language

1.1 When the page loads, the system shall show a text editor containing a short example program.
1.2 When the program contains `forward N`, the system shall drive the robot forward N centimeters.
1.3 When the program contains `back N`, the system shall drive the robot backward N centimeters.
1.4 When the program contains `left N`, the system shall turn the robot counter-clockwise N degrees.
1.5 When the program contains `right N`, the system shall turn the robot clockwise N degrees.
1.6 When the program contains `repeat N [ ... ]`, the system shall execute the enclosed commands N times. The block may span several lines and may be nested.
1.7 When the program contains `if wall-ahead [ ... ]` and the distance sensor reports a wall ahead at the moment the command is reached, the system shall execute the enclosed commands. Otherwise the system shall skip them.
1.8 When the program contains `wait N`, the system shall hold the motors off for N seconds.
1.9 When a line contains `;` the system shall ignore the `;` and all text after it on that line. Keywords are case-insensitive. Blank lines are ignored.
1.10 If the program contains an unknown word, a missing or invalid number, a missing `[` or `]`, an unexpected `]`, a number above its limit, or nesting deeper than 8, then the system shall report an error with the line number and a plain-language message, shall not run the program, and shall keep the editor content unchanged.
1.11 When the parser receives any string, including empty, very long, binary or random text, the system shall return a result and shall not throw.
1.12 When the program is empty or only comments, the system shall report "Nothing to run" instead of starting.

## R2. Robot simulation

2.1 While the simulation runs, the system shall advance it with a fixed timestep of 1/60 s, independent of display frame rate.
2.2 When the same level and program are simulated twice, the system shall produce identical state and event logs.
2.3 The system shall model a two-wheeled differential-drive robot with one motor per wheel.
2.4 While a motor spins, the system shall make motor torque fall linearly as wheel speed rises, reaching zero torque at the no-load speed.
2.5 While a motor is commanded and its wheel speed is zero, the system shall draw the maximum (stall) current for that command and battery voltage.
2.6 While the robot runs, the system shall drain the battery by the current drawn, and battery charge shall never increase.
2.7 While the battery drains, the system shall lower terminal voltage under load (voltage sag), and no-load speed shall fall with it.
2.8 When the battery charge reaches zero, the system shall cut motor power, record a `battery_flat` event, and end the run as failed.
2.9 When the traction force a wheel requires exceeds the friction limit of the surface under it, the system shall limit the force to that limit, let the wheel spin, and record a `slip` event.
2.10 When the robot touches a wall, the system shall stop its motion into the wall, keep it outside the wall, and record a `collision` event.
2.11 While the robot is commanded to move, is in contact with a wall, and its speed stays below 0.02 m/s for 0.5 s, the system shall record a `stall` event containing the duration and the current drawn.
2.12 The system shall provide a distance sensor ray from the robot center along its heading and report the distance to the nearest wall (up to 1.0 m).
2.13 The robot speed shall never exceed the no-load speed, defined as wheel radius times full-battery open-circuit voltage divided by the motor constant (0.80 m/s with the constants in design.md).

## R3. Levels

3.1 The system shall provide exactly 3 levels of rising difficulty: Level 1 a short corridor, Level 2 a maze that needs a loop or `if wall-ahead`, Level 3 a longer maze with a slippery patch and a smaller battery.
3.2 Each level shall define walls, a start pose, a goal zone, a time limit and a battery capacity.
3.3 When the robot center enters the goal zone, the system shall record a `goal` event, stop the run and show PASS.
3.4 When the program ends and the robot is not in the goal zone, the system shall show FAIL.
3.5 When the time limit elapses, the system shall record a `timeout` event, stop the run and show FAIL.
3.6 When the user selects a level, the system shall reset the simulation to that level's start state.
3.7 Each level shall be solvable: a reference program that passes shall exist and be checked by an automated test.

## R4. Telemetry graph

4.1 While the program runs, the system shall record speed, total motor current and battery level every 6 steps (10 Hz).
4.2 While the program runs, the system shall draw those three series on a canvas, updating each frame.
4.3 The graph shall label its axes and legend outside the plotted lines.
4.4 When Reset is pressed, the system shall clear the graph.
4.5 The graph shall keep at most 1200 samples and drop the oldest first.

## R5. "Why did it fail?" panel

5.1 When a run ends in FAIL, the system shall show a panel explaining the cause, built only from the event log and final state.
5.2 If the log has a `stall` event, the panel shall state that the robot stalled against a wall, with the stall duration in seconds and the current in amperes.
5.3 If the log has a `battery_flat` event, the panel shall state that the battery ran flat, with the time and the total charge used.
5.4 If the log has `slip` events, the panel shall state that the wheels slipped, with the count, the peak required force and the friction limit in newtons.
5.5 If the log has a `timeout` event, the panel shall state that time ran out, with the time limit and the distance to the goal.
5.6 If several causes exist, the panel shall list the earliest first and mark it as the likely root cause.
5.7 If the program ends without any of those events, the panel shall say the program finished short of the goal and give the distance to the goal.
5.8 When a run passes, the panel shall show PASS with time and battery remaining.

## R6. Controls

6.1 When Run is pressed and the program parses, the system shall reset the level and start the simulation.
6.2 When Reset is pressed, the system shall stop the run and restore the level start state, graph and panel.
6.3 When the speed control is set to 0.5x, 1x, 2x or 4x, the system shall run that many simulation steps per 1/60 s of display time without changing the timestep.
6.4 While a run is active, the Run button shall be disabled and the editor read-only.

## R7. Platform

7.1 The system shall run by opening `index.html` directly from disk in a current desktop browser, with no server, build step or network access.
7.2 The system shall use no external audio or image files.
7.3 The simulation, parser and explain modules shall not access the DOM.
