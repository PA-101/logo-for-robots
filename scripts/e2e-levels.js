'use strict';
// Developer tool (task 32): in headless Chrome, load one level per chapter and challenge seeds
// 1, 75 and 150, run each reference program through the UI, click a failing layout chip on a
// chapter 3 level, and report page errors. Screenshots go to the output folder.
// Usage: node scripts/e2e-levels.js [output-folder]
const path = require('node:path');
const os = require('node:os');
const { launch } = require('./cdp');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'lfr-e2e-levels');

async function main() {
  const page = await launch({ width: 1500, height: 1000 });
  const results = [];
  try {
    // Load a level (number or 'c<seed>'), put a program in the editor, run at 4x, wait for the end.
    async function runCase(name, key, program) {
      await page.js(`(() => {
        document.getElementById('reset').click();
        const sel = document.getElementById('level');
        const key = ${JSON.stringify(String(key))};
        if (key[0] === 'c') {
          sel.value = 'challenge'; sel.dispatchEvent(new Event('change'));
          const s = document.getElementById('seed'); s.value = key.slice(1); s.dispatchEvent(new Event('change'));
        } else { sel.value = key; sel.dispatchEvent(new Event('change')); }
        document.querySelector('[data-speed="4"]').click();
      })()`);
      const text = program !== undefined ? program
        : await page.js(`(() => { const k = ${JSON.stringify(String(key))}; return k[0] === 'c' ? LFR.gen.generate(+k.slice(1)).reference : LFR.levels.getLevel(+k).reference; })()`);
      await page.js(`(() => { const c = document.getElementById('code'); c.value = ${JSON.stringify(text)}; c.dispatchEvent(new Event('input')); document.getElementById('run').click(); })()`);
      await page.waitFor("/^(PASS|FAIL)/.test(document.getElementById('status').textContent) && !document.getElementById('run').disabled", 60000);
      const info = await page.js(`(() => ({
        title: document.getElementById('level-title').textContent,
        status: document.getElementById('status').textContent,
        heading: document.getElementById('result-panel').hidden ? '(hidden)' : document.getElementById('result-head').textContent,
        chips: [...document.querySelectorAll('#layout-chips .chip')].map((c) => c.textContent)
      }))()`);
      await page.shot(path.join(OUT, name + '.png'));
      results.push(Object.assign({ name }, info));
      return info;
    }

    await runCase('basics-1', 1);
    await runCase('grip-4', 4);
    await runCase('bumpers-7', 7);
    // A fixed-distance program on level 7, then replay the first failing layout chip.
    const fixed = await runCase('bumpers-7-fixed', 7, 'forward 150\nright 90\nforward 50');
    const failIndex = fixed.chips.findIndex((c) => /FAIL/.test(c));
    if (failIndex >= 0) {
      await page.js(`document.querySelectorAll('#layout-chips .chip')[${failIndex}].click()`);
      await page.waitFor("/^(PASS|FAIL)/.test(document.getElementById('status').textContent) && !document.getElementById('run').disabled", 60000);
      const replay = await page.js(`(() => ({ status: document.getElementById('status').textContent,
        shown: [...document.querySelectorAll('#layout-chips .chip')].findIndex((c) => c.classList.contains('shown')) }))()`);
      await page.shot(path.join(OUT, 'bumpers-7-replay.png'));
      results.push({ name: 'bumpers-7-replay', status: replay.status, shownChip: replay.shown, expected: failIndex });
    }
    for (const seed of [1, 75, 150]) await runCase('challenge-' + seed, 'c' + seed);
  } finally {
    page.close();
  }
  console.log(JSON.stringify(results, null, 1));
  console.log('PAGE ERRORS: ' + (page.errors.length ? page.errors.join('\n') : 'none'));
  const bad = results.filter((r) => r.name !== 'bumpers-7-fixed' && r.name !== 'bumpers-7-replay' && !/^PASS/.test(r.status));
  if (bad.length || page.errors.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
