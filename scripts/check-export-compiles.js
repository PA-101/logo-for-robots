'use strict';
// Developer tool: compile every exported sample in tests/fixtures/export/ with g++ against stub
// board functions (syntax and type check only). Needs g++ on PATH; it is not part of node --test.
// Usage: node scripts/check-export-compiles.js
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'tests', 'fixtures', 'export');
const stubs = [
  'void setMotorPwm(int, int) {}',
  'int readDistanceCm() { return 100; }',
  'bool bumperPressed() { return false; }',
  'void delayMs(unsigned long) {}',
  'static unsigned long fakeNow = 0;',
  'unsigned long millisNow() { return fakeNow += 5; }',
  'int main() { runProgram(); return 0; }'
].join('\n');
let failed = 0;
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.cpp'))) {
  const src = path.join(os.tmpdir(), 'lfr-export-' + f);
  fs.writeFileSync(src, fs.readFileSync(path.join(dir, f), 'utf8') + '\n' + stubs + '\n');
  try {
    execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-fsyntax-only', src], { stdio: 'pipe' });
    console.log('OK   ' + f);
  } catch (e) {
    failed++;
    console.log('FAIL ' + f + '\n' + String(e.stderr || e.message));
  }
}
process.exitCode = failed ? 1 : 0;
