'use strict';
// Developer tool: runs each level's reference program and prints time, charge and events.
const path = require('node:path');
const root = path.join(__dirname, '..');
const { parse } = require(path.join(root, 'lang.js'));
const { getLevel, LEVELS } = require(path.join(root, 'levels.js'));
const { runToEnd } = require(path.join(root, 'sim.js'));

for (const d of LEVELS) {
  const l = getLevel(d.id);
  const p = parse(d.reference);
  const s = runToEnd(l, p.program);
  const used = l.capacity - s.state.charge;
  console.log('Level ' + d.id, p.ok, JSON.stringify(s.result),
    't=' + s.state.t.toFixed(2) + '/' + l.timeLimit,
    'charge used ' + used.toFixed(2) + '/' + l.capacity,
    'pos ' + s.state.x.toFixed(2) + ',' + s.state.y.toFixed(2));
  console.log('   events:', JSON.stringify(s.events.map((e) => e.type + (e.peak ? ' ' + e.peak.toFixed(2) + '/' + e.limit.toFixed(2) + 'N' : ''))));
}
