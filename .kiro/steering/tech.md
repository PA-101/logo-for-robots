# Technical rules

## Platform
- Static browser app: plain HTML, CSS and JavaScript.
- No build step, no bundler, no transpiler, no backend, no network calls.
- No external audio or image files. Draw everything on canvas or with CSS.
- Must work by double-clicking `index.html` (the `file://` protocol). Use plain `<script src="...">` tags in a fixed order. Do not use ES modules (`type="module"`, `import`, `export`), `fetch` of local files, or anything that needs a server.
- No runtime dependencies. Tests use only Node's built-in `node:test` and `node:assert`.

## Module pattern
Each logic file is a plain script that attaches to a single global namespace and also exports for Node:

```js
(function (root) {
  'use strict';
  // ...
  var api = { /* public functions */ };
  if (typeof module !== 'undefined') module.exports = api;
  else root.LFR = Object.assign(root.LFR || {}, { lang: api }); // per-file key
})(typeof self !== 'undefined' ? self : this);
```

The required export line is `if (typeof module !== 'undefined') module.exports = {...}`. Files that need another module use `require` under Node and the `LFR` global in the browser.

## Simulation rules
- Fixed-timestep, deterministic simulation at 60 Hz (`DT = 1/60` s). Rendering speed never changes `DT`. A speed control changes how many steps run per frame.
- The same level and program always give identical results. No `Math.random`, no `Date.now`, no wall-clock reads inside simulation code. If randomness is ever needed, use a seeded PRNG.
- Simulation code (`lang.js`, `sim.js`, `levels.js`, `telemetry.js`, `explain.js`, `coach.js`, `gen.js`) has no DOM access: no `document`, `window`, `canvas`, or `requestAnimationFrame`. Only `ui.js` touches the DOM.
- Script order in `index.html`: `lang.js`, `levels.js`, `sim.js`, `telemetry.js`, `explain.js`, `coach.js`, `gen.js`, `ui.js`.
- `gen.js` uses its own seeded PRNG (mulberry32). The same seed always gives the same level.
- Compatibility: `tests/fixtures/golden-runs.json` records today's behavior. It must keep passing, and it is never regenerated without the user agreeing to a behavior change.
- Parsers and simulation functions never throw on any input. They return error objects.

## Testing
- Unit tests and property-based tests live in `tests/` and run with `node --test tests/`.
- Property tests use a small seeded PRNG written in `tests/helpers.js`, with a fixed seed printed on failure.
