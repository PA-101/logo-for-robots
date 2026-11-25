'use strict';
// Developer tool: end-to-end check of the coach UI in headless Chrome.
// Clicks Run, "SUGGEST A FIX" and "APPLY FIX" like a user, saves screenshots, and
// reports page errors. Talks only to the local Chrome it starts (DevTools protocol).
// Usage: node scripts/e2e-coach.js <output-folder>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./cdp');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'lfr-e2e');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await launch({ width: 1500, height: 1100 });
  const { js, waitFor } = page;
  const errors = page.errors;
  const shot = (name) => page.shot(path.join(OUT, name));
  try {    async function scenario(name, level, code, expectFound) {
      await js(`(() => {
        document.getElementById('reset').click();
        const sel = document.getElementById('level'); sel.value = '${level}'; sel.dispatchEvent(new Event('change'));
        document.querySelector('[data-speed="4"]').click();
        const c = document.getElementById('code'); c.value = ${JSON.stringify(code)}; c.dispatchEvent(new Event('input'));
        document.getElementById('run').click();
      })()`);
      await waitFor("/FAIL/.test(document.getElementById('status').textContent)", 20000);
      const status = await js("document.getElementById('status').textContent");
      await js("document.querySelector('#coach button').click()");
      const sawProgress = await js("!!document.querySelector('.coach-progress') || !!document.querySelector('.coach-head')");
      const runLocked = await js("document.getElementById('run').disabled");
      await waitFor("!!document.querySelector('.coach-head')", 30000);
      await shot(name + '.png');
      const view = await js(`(() => ({
        head: document.querySelector('.coach-head').textContent,
        lines: [...document.querySelectorAll('.coach-line')].map((p) => p.textContent),
        removed: [...document.querySelectorAll('.diff del')].map((d) => d.textContent),
        added: [...document.querySelectorAll('.diff ins')].map((d) => d.textContent),
        changedRows: document.querySelectorAll('.diff .num.changed').length,
        apply: !!document.querySelector('#coach .btn.primary'),
        runEnabled: !document.getElementById('run').disabled
      }))()`);
      let applied = null;
      if (view.apply) {
        await js("document.querySelector('#coach .btn.primary').click()");
        applied = await js(`(() => ({
          code: document.getElementById('code').value,
          fixGutter: [...document.querySelectorAll('#gutter .fix')].map((s) => s.textContent),
          message: document.getElementById('messages').textContent,
          status: document.getElementById('status').textContent
        }))()`);
        await shot(name + '-applied.png');
        // Run the applied fix: it should pass.
        await js("document.getElementById('run').click()");
        await waitFor("/PASS|FAIL/.test(document.getElementById('status').textContent) && !document.getElementById('run').disabled", 20000);
        applied.rerun = await js("document.getElementById('status').textContent");
      }
      console.log(JSON.stringify({ name, status, sawProgress, runLocked, view, applied, expectFound }, null, 1));
    }

    await scenario('l1-short', 1, '; my try\nforward 200\nright 90\nforward 50', true);
    await scenario('l2-turn', 2, 'repeat 2 [ forward 100 right 80 forward 100 left 90 ]\nforward 100', true);
    await scenario('l3-two-edits', 3, 'forward 150\nright 60\nforward 100\nleft 90\nforward 200', true);
    await scenario('l1-unfixable', 1, 'forward 400', false);
    console.log('PAGE ERRORS: ' + (errors.length ? errors.join('\n') : 'none'));
  } finally {
    page.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
