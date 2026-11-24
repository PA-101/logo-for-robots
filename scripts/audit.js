'use strict';
// Developer tool (Part 4 visual audit): screenshots of every screen state at several window sizes
// and zoom levels, plus automatic layout checks in the page: horizontal scrollbars, overflowing
// text, elements outside their panel, overlapping blocks, tiny or stretched canvases, text
// contrast, and console errors. Prints a JSON report.
// Usage: node scripts/audit.js <output-folder> [--quick]
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launch } = require('./cdp');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'lfr-audit');
const QUICK = process.argv.includes('--quick');
const CONFIGS = QUICK
  ? [{ w: 1280, h: 720, z: 1.5 }, { w: 1920, h: 1080, z: 1 }]
  : [{ w: 1280, h: 720, z: 1 }, { w: 1366, h: 768, z: 1 }, { w: 1920, h: 1080, z: 1 },
     { w: 1366, h: 768, z: 1.25 }, { w: 1366, h: 768, z: 1.5 }, { w: 1920, h: 1080, z: 1.25 }, { w: 1920, h: 1080, z: 1.5 }];

const enc = encodeURIComponent;
const LONG = Array.from({ length: 45 }, (_, i) => (i % 3 === 0 ? '; a long comment line number ' + i + ' that keeps going well past the editor width' : i % 3 === 1 ? 'forward 10' : 'left 5')).join('\n');

// Each state: a hash to open, then optional page actions before the screenshot.
const STATES = [
  { name: 'boot', hash: '', wait: 500, skipChecks: true },
  { name: 'ready', hash: 'skipboot' },
  { name: 'running', hash: 'skipboot&level=4', act: "document.querySelector('[data-speed=\"1\"]').click(); const c=document.getElementById('code'); c.value=LFR.levels.getLevel(4).reference; c.dispatchEvent(new Event('input')); document.getElementById('run').click();", wait: 2500 },
  { name: 'pass', hash: 'autorun&level=1&t=30' },
  { name: 'fail-stall', hash: 'autorun&level=1&t=30&code=' + enc('forward 400') },
  { name: 'fail-slip', hash: 'autorun&level=4&t=60&code=' + enc('forward 450\nright 90\nforward 100\nright 90\nforward 450') },
  { name: 'fail-timeout', hash: 'autorun&level=1&t=30&code=' + enc('wait 30') },
  { name: 'fail-short', hash: 'autorun&level=1&t=30&code=' + enc('forward 50') },
  { name: 'fail-layout', hash: 'autorun&level=7&t=30&code=' + enc('forward 150\nright 90\nforward 50') },
  { name: 'coach', hash: 'autorun&level=1&t=30&code=' + enc('forward 200\nright 90\nforward 50'), act: "document.querySelector('#coach button').click();", until: "!!document.querySelector('.coach-head')" },
  { name: 'export', hash: 'skipboot', act: "document.getElementById('export').click();", wait: 300 },
  { name: 'challenge', hash: 'skipboot&level=c150', act: "document.getElementById('hint-box').open = true;", wait: 200 },
  { name: 'help-open', hash: 'skipboot', act: "document.querySelector('details.help').open = true;", wait: 200 },
  { name: 'long-program', hash: 'skipboot&code=' + enc(LONG) }
];

// In-page checks. Returns a list of issue strings.
const CHECKS = `(() => {
  const issues = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) issues.push('horizontal scroll: page ' + de.scrollWidth + ' px wide in a ' + window.innerWidth + ' px window');
  // overflowing text boxes (scrollable editors and the export code are allowed to scroll)
  const scrollers = new Set(['code', 'export-code', 'gutter']);
  document.querySelectorAll('.panel *, .export-dialog *, header *').forEach((el) => {
    if (!vis(el) || scrollers.has(el.id) || el.tagName === 'CANVAS' || el.tagName === 'OPTION' || el.tagName === 'SELECT') return;
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'auto' && s.overflowX !== 'scroll' && el.clientWidth > 0) issues.push('text overflows ' + name(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
  });
  // elements outside their panel
  document.querySelectorAll('.panel').forEach((p) => {
    const pr = p.getBoundingClientRect();
    p.querySelectorAll('*').forEach((el) => {
      if (!vis(el) || el.closest('dialog')) return;
      const r = el.getBoundingClientRect();
      if (r.right > pr.right + 1.5 || r.left < pr.left - 1.5) issues.push(name(el) + ' sticks out of ' + name(p) + ' by ' + Math.round(Math.max(r.right - pr.right, pr.left - r.left)) + ' px');
    });
  });
  // overlapping blocks: direct children of each panel and of the arena column
  document.querySelectorAll('.panel, .objective-box, .battery').forEach((p) => {
    const kids = [...p.children].filter(vis);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) issues.push('overlap: ' + name(kids[i]) + ' and ' + name(kids[j]) + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ' px)');
    }
  });
  // panels side by side must not overlap
  const panels = [...document.querySelectorAll('main > .panel')].map((p) => [p, p.getBoundingClientRect()]);
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i][1], b = panels[j][1];
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push('panels overlap: ' + name(panels[i][0]) + ' and ' + name(panels[j][0]));
  }
  // canvases: not tiny, not stretched
  document.querySelectorAll('canvas').forEach((c) => {
    const r = c.getBoundingClientRect();
    if (r.width < 280 || r.height < 200) issues.push('canvas ' + name(c) + ' is small: ' + Math.round(r.width) + 'x' + Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    const sx = c.width / (r.width * dpr), sy = c.height / (r.height * dpr);
    if (Math.abs(sx - sy) > 0.03) issues.push('canvas ' + name(c) + ' is stretched (x ' + sx.toFixed(2) + ', y ' + sy.toFixed(2) + ')');
  });
  // contrast of visible text against the nearest opaque background
  const parse = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0.5) return c; } return [5, 8, 5]; };
  const seen = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    if (!vis(el) || el.closest('#boot') || el.closest('dialog:not([open])')) return;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const s = getComputedStyle(el);
    const fg = parse(s.color), bg = bgOf(el);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const disabled = el.disabled || el.closest('[disabled]');
    const key = name(el) + ' ' + ratio.toFixed(1);
    /* steering: text contrast at least 7:1 */ if (!disabled && ratio < 7 && !seen.has(key)) { seen.add(key); issues.push('low contrast ' + ratio.toFixed(1) + ':1 on ' + name(el) + ' "' + el.textContent.trim().slice(0, 30) + '"'); }
  });
  return issues;
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};
  for (const cfg of CONFIGS) {
    const tag = cfg.w + 'x' + cfg.h + '@' + Math.round(cfg.z * 100);
    const page = await launch({ width: cfg.w, height: cfg.h, scale: cfg.z, hash: 'skipboot' });
    try {
      for (const st of STATES) {
        page.errors.length = 0;
        await page.open(st.hash);
        if (st.act) await page.js('(() => { ' + st.act + ' })()');
        if (st.until) await page.waitFor(st.until, 20000);
        await page.sleep(st.wait || 250);
        await page.shot(path.join(OUT, tag, st.name + '.png'));
        const issues = st.skipChecks ? [] : await page.js(CHECKS);
        const errs = page.errors.slice();
        if (issues.length || errs.length) report[tag + ' ' + st.name] = issues.concat(errs.map((e) => 'console: ' + e));
      }
    } finally { page.close(); }
  }
  const out = JSON.stringify(report, null, 1);
  fs.writeFileSync(path.join(OUT, 'report.json'), out);
  console.log(out);
  console.log('states with issues: ' + Object.keys(report).length + ' of ' + CONFIGS.length * STATES.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
