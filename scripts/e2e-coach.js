'use strict';
// Developer tool: end-to-end check of the coach UI in headless Chrome.
// Clicks Run, "SUGGEST A FIX" and "APPLY FIX" like a user, saves screenshots, and
// reports page errors. Talks only to the local Chrome it starts (DevTools protocol).
// Usage: node scripts/e2e-coach.js <output-folder>
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'lfr-e2e');
const PORT = 9333;
const CHROME = [
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe')
].find((p) => fs.existsSync(p));
const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/') + '#skipboot';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lfr-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1500,1100', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, PAGE], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        target = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
      } catch (e) { /* Chrome not up yet */ }
    }
    if (!target) throw new Error('Chrome did not start');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception.description);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(JSON.stringify(msg.params.args));
    });
    const send = (method, params) => new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    });
    const js = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception.description);
      return r.result.result.value;
    };
    const waitFor = async (expr, ms) => {
      for (let t = 0; t < ms; t += 100) { if (await js(expr)) return true; await sleep(100); }
      throw new Error('timed out waiting for ' + expr);
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await waitFor("document.body.getAttribute('data-ready') === '1'", 5000);

    async function scenario(name, level, code, expectFound) {
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
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
