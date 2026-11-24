'use strict';
// Task 38: both Kiro hook files are valid and the level hook matches the right files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '.kiro', 'hooks');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

test('both hook files parse and have the required fields', () => {
  for (const name of ['run-tests-on-save.json', 'run-level-tests-on-save.json']) {
    const h = load(name);
    assert.strictEqual(h.version, 'v1', name);
    assert.ok(Array.isArray(h.hooks) && h.hooks.length === 1, name);
    const hook = h.hooks[0];
    assert.strictEqual(typeof hook.name, 'string');
    assert.strictEqual(hook.trigger, 'PostFileSave');
    assert.strictEqual(hook.action.type, 'command');
    assert.ok(/^node --test /.test(hook.action.command));
    assert.strictEqual(hook.enabled, true);
    assert.doesNotThrow(() => new RegExp(hook.matcher));
  }
  assert.deepStrictEqual(load('run-tests-on-save.json'), {
    version: 'v1',
    hooks: [{ name: 'Run tests on save', trigger: 'PostFileSave', action: { type: 'command', command: 'node --test tests/' }, matcher: '\\.js$', enabled: true }]
  }, 'the first hook is unchanged');
});

test('the level hook matches levels.js and gen.js, not other files', () => {
  const re = new RegExp(load('run-level-tests-on-save.json').hooks[0].matcher);
  for (const yes of ['levels.js', 'gen.js', 'C:\\proj\\levels.js', '/home/u/proj/gen.js']) assert.ok(re.test(yes), yes);
  for (const no of ['sim.js', 'mylevels.js', 'gen.json', 'tests/gen.test.js', 'levels.js.bak', 'oxygen.js']) assert.ok(!re.test(no), no);
});

test('every test file the level hook runs exists', () => {
  const cmd = load('run-level-tests-on-save.json').hooks[0].action.command;
  const files = cmd.split(/\s+/).filter((p) => p.startsWith('tests/'));
  assert.ok(files.length >= 4);
  for (const f of files) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});
