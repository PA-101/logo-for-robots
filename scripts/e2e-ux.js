'use strict';
// Developer tool: browser checks for the UX flows (first run, level switching, persistence,
// apply and undo, dialog focus, seeds, jump-to, empty program, resize and freeze mid-run,
// blocked storage). Prints one line per check and exits 1 if any fails.
// Usage: node scripts/e2e-ux.js [screenshot-folder] [width] [height]
const path = require('node:path');
const os = require('node:os');
const { launch } = require('./cdp');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'lfr-e2e-ux');
const W = Number(process.argv[3]) || 1366, H = Number(process.argv[4]) || 768;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const done = "/^(PASS|FAIL)/.test(document.getElementById('status').textContent) && !document.getElementById('run').disabled";

async function key(p, k, mods) {
  const codes = { Tab: 9, Enter: 13, Escape: 27 };
  const base = { key: k, code: k, windowsVirtualKeyCode: codes[k] || 0, modifiers: mods || 0 };
  await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base, k === 'Enter' ? { text: '\r' } : {}));
  await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
}
const pick = (v) => `(() => { const s = document.getElementById('level'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`;
const type = (text) => `(() => { const c = document.getElementById('code'); c.value = ${JSON.stringify(text)}; c.dispatchEvent(new Event('input')); })()`;

async function main() {
  const p = await launch({ width: W, height: H, hash: 'skipboot' });
  const shot = (n) => p.shot(path.join(OUT, W + 'x' + H + '-' + n + '.png'));
  try {
    // First screen and first run
    const first = await p.js("({ instr: (document.querySelector('.instruction') || {}).textContent, code: document.getElementById('code').value.split('\\n')[0] })");
    check('first screen: instruction near RUN', first.instr === 'Edit the program, then press RUN (or Ctrl+Enter).', first.instr);
    await shot('first-screen');
    await p.js("document.getElementById('run').click()");
    const lock = await p.js("({ msg: document.getElementById('messages').textContent, ro: document.getElementById('code').readOnly })");
    check('running: the lock is explained', lock.ro && /locked while the robot runs/.test(lock.msg), lock.msg);
    await shot('running');
    await p.waitFor(done, 30000);
    const firstResult = await p.js("document.getElementById('status').textContent");
    check('first run of the starter passes', /^PASS/.test(firstResult), firstResult);
    check('lock message cleared after the run', (await p.js("document.getElementById('messages').textContent")) === '');

    // Level switching: no stale result, starter with the objective, then the program is remembered
    await p.js(type('forward 50'));
    await p.js("document.getElementById('run').click()");
    await p.waitFor(done, 30000);
    await p.js(pick('7'));
    const sw = await p.js(`(() => ({ status: document.getElementById('status').textContent, panel: document.getElementById('result-panel').hidden,
      chips: document.getElementById('layout-chips').hidden, code: document.getElementById('code').value,
      note: document.getElementById('layout-note').textContent, tag: document.getElementById('telemetry-layout').textContent,
      jump: [...document.querySelectorAll('#shortcuts .btn.active')].map((b) => b.textContent) }))()`);
    check('switch: result, chips and layout tag reset', sw.status === 'READY. Press RUN.' && sw.panel && sw.chips && sw.tag === '', JSON.stringify(sw).slice(0, 120));
    check('switch: editor shows the new level starter', sw.code.startsWith('; Level 7: Dark Corridor') && sw.code.includes('; Goal: '), sw.code.split('\n')[0]);
    check('layouts explained before the run', /3 layouts \(A, B, C\)/.test(sw.note), sw.note);
    check('jump-to: active button follows the level', sw.jump.join() === 'BUMPERS', sw.jump.join());
    await shot('after-switch');
    await p.js(pick('1'));
    check('switch back: level 1 program remembered', (await p.js("document.getElementById('code').value")) === 'forward 50');

    // Persistence across a reload
    await p.js(pick('4'));
    await p.js(type('power 70\nforward 450'));
    await p.open('skipboot');
    const reload = await p.js("({ title: document.getElementById('level-title').textContent, code: document.getElementById('code').value })");
    check('reload: last level and its program come back', reload.title === 'Level 4: Ice Hairpin' && reload.code === 'power 70\nforward 450', JSON.stringify(reload));

    // Ctrl+Enter
    await p.js(pick('1'));
    await p.js(type('forward 200\nright 90\nforward 100'));
    await p.js("document.getElementById('code').focus()");
    await key(p, 'Enter', 2);
    await p.sleep(150);
    check('Ctrl+Enter runs', /RUNNING/.test(await p.js("document.getElementById('status').textContent")));
    await p.waitFor(done, 30000);

    // Empty program
    await p.js(type(''));
    await p.js("document.getElementById('run').click()");
    const empty = await p.js("document.getElementById('status').textContent");
    check('empty program: status says nothing to run', empty === 'NOTHING TO RUN. Type a command, for example forward 50.', empty);

    // Apply and undo
    await p.js("document.querySelector('[data-speed=\"4\"]').click()");
    await p.js(type('forward 200\nright 90\nforward 50'));
    await p.js("document.getElementById('run').click()");
    await p.waitFor(done, 30000);
    await p.js("document.querySelector('#coach button').click()");
    await p.waitFor("!!document.querySelector('.coach-head')", 20000);
    await p.js("document.querySelector('#coach .btn.primary').click()");
    const ap = await p.js(`(() => ({ status: document.getElementById('status').textContent, panel: document.getElementById('result-panel').hidden,
      code: document.getElementById('code').value, msg: document.getElementById('messages').textContent, undo: !!document.getElementById('undo-fix') }))()`);
    check('apply: old result cleared', ap.status === 'READY. Press RUN.' && ap.panel, ap.status);
    check('apply: fix in the editor with UNDO', ap.code === 'forward 200\nright 90\nforward 100' && ap.undo && /Fix applied to line 3/.test(ap.msg), ap.msg);
    await shot('after-apply');
    await p.js("document.getElementById('undo-fix').click()");
    const un = await p.js("({ code: document.getElementById('code').value, msg: document.getElementById('messages').textContent })");
    check('undo: previous program restored', un.code === 'forward 200\nright 90\nforward 50' && un.msg === 'Previous program restored.', JSON.stringify(un));

    // Export dialog: focus trap, Esc, focus return
    await p.js("document.getElementById('export').focus()");
    await key(p, 'Enter');
    await p.sleep(250);
    let inside = true;
    for (let i = 0; i < 8; i++) { await key(p, 'Tab'); inside = inside && await p.js("!!document.activeElement.closest('dialog')"); }
    for (let i = 0; i < 4; i++) { await key(p, 'Tab', 8); inside = inside && await p.js("!!document.activeElement.closest('dialog')"); }
    check('dialog: Tab and Shift+Tab stay inside', inside);
    await key(p, 'Escape');
    await p.sleep(200);
    const esc = await p.js("({ open: document.getElementById('export-dialog').open, focus: document.activeElement.id })");
    check('dialog: Esc closes, focus back on EXPORT', !esc.open && esc.focus === 'export', JSON.stringify(esc));

    // Challenge seeds
    await p.js(pick('challenge'));
    const seeds = {};
    for (const v of ['', 'abc', '0', '151', '42']) {
      seeds[v] = await p.js(`(() => { const s = document.getElementById('seed'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change'));
        return [document.getElementById('seed').value, document.getElementById('seed-note').textContent, document.getElementById('level-title').textContent]; })()`);
    }
    check('seed: invalid input is clamped with a message', seeds[''][1] === 'Seeds go from 1 to 150, so this is seed 1.' && seeds['abc'][0] === '1' && seeds['151'][0] === '150' && seeds['151'][1].includes('seed 150'), JSON.stringify(seeds['151']));
    check('seed: valid input has no message and the title shows the seed', seeds['42'][1] === '' && seeds['42'][2].startsWith('Challenge 42 (seed 42)'), seeds['42'][2]);
    await shot('challenge');
    const ends = await p.js(`(() => { const s = document.getElementById('seed'); s.value = '1'; s.dispatchEvent(new Event('change'));
      document.getElementById('seed-prev').click(); const a = s.value; document.getElementById('seed-next').click(); return [a, s.value]; })()`);
    check('seed: PREV at 1 wraps to 150 and NEXT wraps back to 1', ends[0] === '150' && ends[1] === '1', ends.join());

    // Jump-to: each loads its level and shows as active
    const jumps = await p.js(`(() => [...document.querySelectorAll('#shortcuts .btn')].map((b) => { b.click();
      return [b.textContent, document.getElementById('level-title').textContent, b.getAttribute('aria-pressed')]; }))()`);
    check('jump-to: each button loads its level and is marked active',
      jumps.every((j) => j[2] === 'true') && jumps.map((j) => j[1].split(':')[0].split(' (')[0]).join() === 'Level 1,Level 4,Level 7,Challenge 75,Challenge 150', JSON.stringify(jumps.map((j) => j[1])));

    // Resize and freeze in the middle of a run: the run still ends with the same result
    await p.js(pick('1'));
    await p.js(type('forward 200\nright 90\nforward 100'));
    await p.js("document.querySelector('[data-speed=\"1\"]').click(); document.getElementById('run').click()");
    await p.sleep(700);
    const w0 = await p.js("document.getElementById('arena').getBoundingClientRect().width");
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    await p.waitFor(done, 30000);
    const mid = await p.js("({ status: document.getElementById('status').textContent, w: document.getElementById('arena').getBoundingClientRect().width, cw: document.getElementById('arena').width })");
    check('resize mid-run: the run ends with the normal result and the canvas follows', mid.status === 'PASS: Reached the goal in 5.9 s with 84% battery left.' && mid.w !== w0 && mid.cw > 0, JSON.stringify(mid) + ' was ' + w0);
    await p.send('Emulation.clearDeviceMetricsOverride');

    // Hidden mid-run: the run pauses (no animation frames while hidden) and the clock does not
    // jump. Headless Chrome cannot make the page visible again afterwards, so the resume itself
    // rests on requestAnimationFrame resuming and framePlan's 0.25 s cap (unit-tested).
    await p.js("document.getElementById('run').click()");
    await p.sleep(600);
    await p.send('Page.setWebLifecycleState', { state: 'frozen' });
    await p.send('Page.setWebLifecycleState', { state: 'active' });
    const h1 = await p.js("({ v: document.visibilityState, t: document.getElementById('readout').textContent.split(' s')[0] })");
    await p.sleep(1500);
    const h2 = await p.js("({ s: document.getElementById('status').textContent, t: document.getElementById('readout').textContent.split(' s')[0] })");
    check('hidden mid-run: the run pauses without errors', h1.v === 'hidden' && h1.t === h2.t && /RUNNING/.test(h2.s), JSON.stringify([h1, h2]));
    await p.open('skipboot');

    // Blocked storage never breaks the page
    await p.js("void Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } })");
    await p.js(pick('2'));
    await p.js(type('forward 10'));
    await p.js(pick('3'));
    check('blocked storage: switching levels still works', (await p.js("document.getElementById('level-title').textContent")) === 'Level 3: Slippery Corner');
    check('no page errors in any step', p.errors.length === 0, p.errors.join(' | '));
  } finally { p.close(); }
  for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok || !r.detail ? '' : '  -> ' + r.detail));
  const failed = results.filter((r) => !r.ok).length;
  console.log(results.length - failed + ' of ' + results.length + ' checks passed at ' + W + 'x' + H);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
