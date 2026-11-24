# Kiro write-up notes

Facts for a write-up about how Kiro was used on Logo for Robots. Only things that happened are listed. Commit hashes refer to `main`, and test counts are from `node --test tests/` at that commit.

## Specs (requirements, design, tasks)

- `.kiro/specs/logo-robots/` was written before any code (`143dab5`). Requirements are in "When X, the system shall Y" form. The design has the physics equations, constants and module interfaces. Tasks are a numbered build order.
- Every later feature went through the spec first: the coach (`be800e6`); power, bumper, chapters and Challenge Mode (`7519a60`); the 17 s until-bump limit and tasks 33 to 38 (`53f7136`); the power-first coach rule R8.18 (`c0da5f7`).
- The design's tuning log (section 10) records every constant change with old value, new value and reason (`994b2e8`, `acead14`). That includes the one test wording the user authorized changing (level 6, `acead14`).
- 38 tasks were planned. Task 14 (final check) was moved to the end.

## Steering

- `product.md`, `tech.md` and `design.md` in `.kiro/steering/` (`143dab5`), updated with the feature specs (`7519a60`, `53f7136`) and the visual audit (`e47db6b`).
- They decided concrete things: no build step and plain script tags (the app works from `file://` and on GitHub Pages); no DOM access in logic files; fixed 60 Hz deterministic simulation; colours and the 7:1 contrast rule.
- The Part 4 audit found the steering's own failure red (`#ff3b30`) at 5.4 to 5.7:1 as text, below its own 7:1 rule. A text tint (`#ff8a80`) was added to the steering table (`e47db6b`).

## Hooks

- `.kiro/hooks/run-tests-on-save.json` (`e6a4034`) runs `node --test tests/` when a `.js` file is saved.
- `.kiro/hooks/run-level-tests-on-save.json` (`6ea15b1`) runs the level and generator tests when `levels.js` or `gen.js` is saved. A test checks both files and the matcher.
- Honest note: during this build the agent ran the tests with explicit commands after each task. I did not see a hook's output show up in the agent session, so I cannot say the hooks fired during the build.

## Property-based testing

- No library: a seeded mulberry32 generator in `tests/helpers.js`, with the seed printed on failure.
- Property tests: parser (`a8b01ec`, 9 properties over thousands of random inputs), simulation (`b4d0a1b`), coach (`3a3e0fc`), power and bumper (`2171aec`, including the 17 s until-bump limit), generator over all 150 seeds (`c077734`), export (`b2ba311`), UI helpers.
- To check that the properties can fail, deliberately broken versions of the code were run against them: 4 changes to `sim.js` for task 9 (3 caught), 3 to `coach.js` for task 16 (all caught), and 4 to `sim.js` for task 22 (all caught).

### Bugs the tests found

| Bug | Found by | Commit |
|---|---|---|
| Nested empty `repeat` loops were accepted and could hang the simulation | parser unit test | `67aaf50` |
| A slipping wheel could lag the ground, so friction braked a robot that was driving forward | physics unit test | `dcce1fb` |
| Turns missed by up to 4 degrees | physics unit test | `dcce1fb` |
| 7.05 printed as "7.0" (binary rounding) | explain unit test | `f3702b7` |
| Nothing new: the simulation property tests passed first time | property tests | `b4d0a1b` |

Several failing tests were mistakes in the tests themselves, not the app. These were fixed and recorded in the build report: a generator comment that swallowed a `]` (task 4), a telemetry setup that ended too early (task 10), a side-wall setup and a back-to-back until-bump measurement (task 22), a power-first test that branched on its own result (rewritten), and an "again" check that matched "against" (Part 1).

### Problems found by the agent's own checks, not by unit tests

No separate review agent was run. These came from the agent's screenshots, exploration scripts and audit script:

| Problem | How it was found | Commit |
|---|---|---|
| PASS panel flashed red; battery line lost its dashes | headless-Chrome screenshots | `8daf299` |
| Readout text ran past the panel border | screenshot | `5b9ddc4` |
| Level 6: full power passed, and ice friction had no effect at all on the old map | exploration scripts before writing the task 26 tests | `acead14` |
| "a 11.5 m corridor" | reading the generator output | `573191d` |
| Horizontal scrollbar at 1280/1366 px and at 125%/150% zoom; 3.7:1 line-number contrast; 5.4:1 failure-text contrast; "ARENALEVEL" header | `scripts/audit.js` (98 states) plus looking at screenshots | `e47db6b` |
| A wrong claim in an earlier summary (that level 4 passed at full power; it ran its battery flat) | re-measuring for task 26 | corrected in the conversation |

## MCP

- `tools/sim-mcp/server.js` (`ccfe953`): an MCP server over stdio with `list_levels`, `run_program` and `suggest_fix`, tested over stdin and stdout (`tests/mcp.test.js`).
- Registering it in the workspace `.kiro/settings/mcp.json` was blocked by a Kiro permission rule, so its tools were never called through Kiro. The exact errors are in `docs/mcp-proof.md`, together with a direct stdio transcript that is labelled as not made through Kiro.
- The Kiro docs agent (introspect) was used once, to check the MCP configuration format and reload behaviour.

## The IDE

- The whole build ran in Kiro IDE agent sessions: plans, code, tests, git commits and pushes, headless-Chrome checks (`scripts/cdp.js`, `e2e-levels.js`, `audit.js`), and a g++ compile check of the exported C++.
- The final suite is 308 tests and takes about 15 s.
