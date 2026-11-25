'use strict';
// Overnight item 5: every script and stylesheet path in index.html is relative and matches a
// real file with the exact same case, so the page loads from a file path and from GitHub Pages
// (which is case-sensitive, unlike Windows).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);

test('index.html references only relative paths', () => {
  assert.ok(refs.length >= 10, 'found ' + refs.length + ' references');
  for (const r of refs) {
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(r), r + ' has a scheme (http:, file:, data: ...)');
    assert.ok(!r.startsWith('/') && !r.startsWith('\\'), r + ' is absolute');
    assert.ok(!r.split('/').includes('..'), r + ' leaves the folder');
    assert.ok(!r.includes('\\'), r + ' uses a backslash');
    assert.ok(!/[?#]/.test(r), r + ' has a query or fragment');
  }
});

test('every referenced file exists with the exact same case', () => {
  for (const r of refs) {
    let dir = ROOT;
    for (const part of r.split('/')) {
      const names = fs.readdirSync(dir);
      assert.ok(names.includes(part), r + ': "' + part + '" not found with this exact case in ' + path.relative(ROOT, dir || '.'));
      dir = path.join(dir, part);
    }
  }
});

test('no file loads anything from the network', () => {
  for (const f of ['index.html', 'style.css', 'ui.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/https?:\/\//i.test(src), f + ' contains a URL');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(/.test(src), f + ' makes a request');
  }
});
