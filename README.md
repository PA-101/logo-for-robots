# Logo for Robots

Write a few lines of Logo, watch a simulated robot run them, and find out why real robots do not behave like a perfect turtle.

This project revives Logo, the 1960s turtle-programming language, to teach how real robots behave: motors lose torque as they speed up, batteries sag and run flat, and wheels slip. It is an entry in the Kiroween 2026 hackathon, Resurrection category.

## How to run

Open `index.html` in a current desktop browser by double-clicking it. There is no build step, no server and no install.

To run the tests (once they exist), use Node 18 or newer:

```
node --test tests/
```

## Status

Planning only. Steering files are in `.kiro/steering/` and the specs (requirements, design, tasks) are in `.kiro/specs/logo-robots/`. No app code has been written yet.
