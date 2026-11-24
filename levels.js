(function (root) {
  'use strict';

  // Level definitions and the builder that turns an ASCII map into geometry.
  // No DOM access. World is y-up, in meters. Map rows are listed top to bottom.
  //   #  wall      .  floor      S  start      G  goal      o  slick floor

  var CELL = 0.5;

  var LEVELS = [
    {
      id: 1,
      name: 'First Steps',
      hint: 'Drive down the corridor, turn right and reach the goal.',
      map: [
        '#######',
        '#S....#',
        '#####.#',
        '#####G#',
        '#######'
      ],
      capacity: 3,
      timeLimit: 12,
      slickMu: 0.25,
      reference: 'forward 200\nright 90\nforward 100'
    },
    {
      id: 2,
      name: 'Staircase',
      hint: 'The path zigzags. A repeat loop saves typing.',
      map: [
        '#########',
        '#S..#####',
        '###.#####',
        '###...###',
        '#####.###',
        '#####..G#',
        '#########'
      ],
      capacity: 2.5,
      timeLimit: 25,
      slickMu: 0.25,
      reference: 'repeat 2 [ forward 100 right 90 forward 100 left 90 ]\nforward 100'
    },
    {
      id: 3,
      name: 'Slippery Corner',
      hint: 'The shiny floor has little grip. Wheels spin when they push too hard.',
      map: [
        '###########',
        '#S....#####',
        '#####o#####',
        '#####o...G#',
        '###########'
      ],
      capacity: 1.5,
      timeLimit: 22,
      slickMu: 0.25,
      reference: 'forward 200\nright 90\nforward 100\nleft 90\nforward 200'
    }
  ];

  function buildLevel(def) {
    def = def || LEVELS[0];
    var rows = def.map;
    var nRows = rows.length;
    var nCols = 0;
    var r, c;
    for (r = 0; r < nRows; r++) nCols = Math.max(nCols, rows[r].length);
    var walls = [], slick = [];
    var goal = null;
    var start = { x: CELL / 2, y: CELL / 2, theta: def.startHeading || 0 };
    for (r = 0; r < nRows; r++) {
      for (c = 0; c < rows[r].length; c++) {
        var ch = rows[r][c];
        var rect = { x: c * CELL, y: (nRows - 1 - r) * CELL, w: CELL, h: CELL };
        if (ch === '#') walls.push(rect);
        else if (ch === 'o') slick.push(rect);
        else if (ch === 'G') goal = rect;
        else if (ch === 'S') { start.x = rect.x + CELL / 2; start.y = rect.y + CELL / 2; }
      }
    }
    if (!goal) goal = { x: 0, y: 0, w: CELL, h: CELL };
    return {
      id: def.id,
      name: def.name,
      hint: def.hint,
      cell: CELL,
      width: nCols * CELL,
      height: nRows * CELL,
      walls: walls,
      slick: slick,
      goal: goal,
      start: start,
      capacity: def.capacity,
      timeLimit: def.timeLimit,
      mu: def.mu || 0.6,
      slickMu: def.slickMu || 0.25,
      reference: def.reference
    };
  }

  function getLevel(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return buildLevel(LEVELS[i]);
    return buildLevel(LEVELS[0]);
  }

  var api = { LEVELS: LEVELS, CELL: CELL, buildLevel: buildLevel, getLevel: getLevel };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.levels = api;
  }
})(typeof self !== 'undefined' ? self : this);
