'use strict';
// Developer helper: start a local headless Chrome (or Edge), open index.html, and drive it with
// the DevTools protocol. Talks only to the browser it starts on 127.0.0.1. Not part of the app.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = [
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe')
].find((p) => fs.existsSync(p));
const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextPort = 9333;

// opts: { width, height, scale (zoom factor, 1 = 100%), hash }
async function launch(opts) {
  const o = Object.assign({ width: 1500, height: 1000, scale: 1, hash: 'skipboot' }, opts || {});
  if (!CHROME) throw new Error('No Chrome or Edge found');
  // Port 0 lets Chrome pick a free port and write it to DevToolsActivePort in the profile, so a
  // browser left over from an earlier run can never be attached to by mistake.
  // Browser profiles go to LFR_TMP when it is set (for example a folder inside the repo),
  // otherwise to the system temp folder. close() deletes the profile again.
  const tmpBase = process.env.LFR_TMP || os.tmpdir();
  fs.mkdirSync(tmpBase, { recursive: true });
  const profile = fs.mkdtempSync(path.join(tmpBase, 'lfr-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars=false',
    '--window-size=' + o.width + ',' + o.height, '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  // Kill the whole process tree (on Windows, killing the main process leaves its children running).
  const killAll = () => {
    try {
      if (process.platform === 'win32') require('node:child_process').execFileSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      else chrome.kill('SIGKILL');
    } catch (e) { /* already gone */ }
  };
  let port = null, target = null;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try {
      if (!port) port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) { /* not up yet */ }
  }
  if (!target) { killAll(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      errors.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log: ' + msg.params.entry.text);
  });
  const send = (method, params) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception ? r.result.exceptionDetails.exception.description : r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  const waitFor = async (expr, ms) => {
    for (let t = 0; t < ms; t += 100) { if (await js(expr)) return true; await sleep(100); }
    throw new Error('timed out waiting for ' + expr);
  };
  // Full-page screenshot (the whole scrollable page, not just the window).
  const shot = async (file) => {
    const m = await send('Page.getLayoutMetrics');
    const size = m.result.cssContentSize || m.result.contentSize;
    const r = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 }
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  // Browser zoom: a CSS viewport of width / scale with a device scale factor of scale.
  if (o.scale !== 1) {
    await send('Emulation.setDeviceMetricsOverride', { width: Math.round(o.width / o.scale), height: Math.round(o.height / o.scale), deviceScaleFactor: o.scale, mobile: false });
  }
  const open = async (hash) => {
    // A hash-only change does not reload the page, so go through about:blank first.
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(100);
    await send('Page.navigate', { url: PAGE + '#' + (hash === undefined ? o.hash : hash) });
    await sleep(300);
    await waitFor("document.body && document.body.getAttribute('data-ready') === '1'", 8000);
  };
  await open(o.hash);
  return {
    js, waitFor, shot, open, errors, sleep,
    close: () => {
      try { ws.close(); } catch (e) { /* closed */ }
      killAll();
      // Remove the browser profile; Chrome may hold files for a moment, so retry briefly.
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (e) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); }
      }
    }
  };
}

module.exports = { launch, sleep };
