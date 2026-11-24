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

  // ---- Chapter 2: Grip and Power (ice). Starting values from design.md 7b; task 26 tunes them.
  var CHAPTER2 = [
    {
      id: 4,
      name: 'Ice Hairpin',
      hint: 'Long ice legs after a turn. Full power slides into the walls; too little power runs out of time.',
      map: [
        '############',
        '#Sooooooooo#',
        '##########o#',
        '#Gooooooooo#',
        '############'
      ],
      capacity: 2.5,
      timeLimit: 40,
      slickMu: 0.08,
      powerMatters: true,
      reference: 'power 70\nforward 450\nright 90\nforward 100\nright 90\nforward 450'
    },
    {
      id: 5,
      name: 'Frozen Switchback',
      hint: 'Four icy turns in a row. Find a power that keeps the wheels gripping.',
      map: [
        '#############',
        '#Soooooooooo#',
        '###########o#',
        '#ooooooooooo#',
        '#o###########',
        '#ooooooooooG#',
        '#############'
      ],
      capacity: 4,
      timeLimit: 75,
      slickMu: 0.08,
      powerMatters: true,
      reference: 'power 70\nforward 500\nright 90\nforward 100\nright 90\nforward 500\nleft 90\nforward 100\nleft 90\nforward 500'
    },
    {
      id: 6,
      name: 'Black Ice',
      hint: 'Normal floor, then ice, then normal floor. Change power on the way.',
      map: [
        '##############',
        '#S.....#######',
        '######o#######',
        '######o#######',
        '######o#######',
        '######o#######',
        '######o#######',
        '######o#######',
        '######......G#',
        '##############'
      ],
      capacity: 3,
      timeLimit: 30,
      slickMu: 0.08,
      powerMatters: true,
      reference: 'forward 250\nright 90\npower 60\nforward 350\npower 100\nleft 90\nforward 300'
    }
  ];

  // ---- Chapter 3: Bumpers. Each level has layouts A, B and C; a run must pass all three.
  function rows4(r1, r2) { return ['##########', r1, r2, '##########']; }
  function hall(rowsByIndex) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(rowsByIndex[i] || '##########');
    return out;
  }
  function doorRoom(doorRow) {
    return ['##########', '#S.......#', doorRow, '#........#', '#GGGGGGGG#', '##########'];
  }
  var CHAPTER3 = [
    {
      id: 7,
      name: 'Dark Corridor',
      hint: 'The corridor length changes between layouts. Let the bumper find the end.',
      layouts: [
        { name: 'A', map: rows4('#S...#####', '####G#####') },
        { name: 'B', map: rows4('#S.....###', '######G###') },
        { name: 'C', map: rows4('#S.......#', '########G#') }
      ],
      capacity: 3,
      timeLimit: 20,
      reference: 'until-bump\nback 15\nright 90\nforward 50'
    },
    {
      id: 8,
      name: 'Long Hall',
      hint: 'Two legs of unknown length. Bump, back off, turn, and bump again.',
      layouts: [
        { name: 'A', map: hall({ 1: '#S....####', 2: '#####.####', 3: '#####.G###' }) },
        { name: 'B', map: hall({ 1: '#S......##', 2: '#######.##', 3: '#######.##', 4: '#######.G#' }) },
        { name: 'C', map: hall({ 1: '#S...#####', 2: '####.#####', 3: '####.#####', 4: '####.#####', 5: '####.G####' }) }
      ],
      capacity: 3,
      timeLimit: 35,
      reference: 'until-bump\nback 15\nright 90\nuntil-bump\nback 15\nleft 90\nforward 50'
    },
    {
      id: 9,
      name: 'Find the Door',
      hint: 'The door in the south wall moves between layouts. Check for it, step by step.',
      layouts: [
        { name: 'A', map: doorRoom('###.######') },
        { name: 'B', map: doorRoom('#####.####') },
        { name: 'C', map: doorRoom('########.#') }
      ],
      capacity: 3,
      timeLimit: 45,
      reference: 'right 90\nrepeat 8 [ if wall-ahead [ left 90 forward 50 right 90 ] ]\nuntil-bump'
    }
  ];

  var ALL_LEVELS = LEVELS.concat(CHAPTER2, CHAPTER3);
  var CHAPTERS = [
    { id: 1, name: 'Basics', levels: [1, 2, 3] },
    { id: 2, name: 'Grip and Power', levels: [4, 5, 6] },
    { id: 3, name: 'Bumpers', levels: [7, 8, 9] }
  ];

  function chapterOf(id) {
    for (var i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].levels.indexOf(id) >= 0) return CHAPTERS[i].id;
    return null;
  }

  // layout: 0, 1 or 2 for levels with layouts; ignored otherwise. A level without layouts
  // builds exactly as before.
  function buildLevel(def, layout) {
    def = def || LEVELS[0];
    var layouts = Array.isArray(def.layouts) && def.layouts.length ? def.layouts : null;
    var li = layouts ? Math.max(0, Math.min(layouts.length - 1, Math.floor(+layout) || 0)) : 0;
    var rows = layouts ? layouts[li].map : def.map;
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
        else if (ch === 'G') goal = goal ? union(goal, rect) : rect;   // several G cells form one rectangle
        else if (ch === 'S') { start.x = rect.x + CELL / 2; start.y = rect.y + CELL / 2; }
      }
    }
    if (!goal) goal = { x: 0, y: 0, w: CELL, h: CELL };
    var built = {
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
    built.chapter = def.chapter || chapterOf(def.id);
    built.layout = layouts ? (layouts[li].name || String.fromCharCode(65 + li)) : null;
    built.layoutCount = layouts ? layouts.length : 1;
    built.powerMatters = def.powerMatters === true;
    return built;
  }

  function union(a, b) {
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  function findDef(id) {
    for (var i = 0; i < ALL_LEVELS.length; i++) if (ALL_LEVELS[i].id === id) return ALL_LEVELS[i];
    return null;
  }

  // Unknown ids still give level 1.
  function getLevel(id, layout) {
    return buildLevel(findDef(id) || LEVELS[0], layout);
  }

  // Every layout of a level, built (one entry for levels without layouts).
  function getLayouts(id) {
    var def = findDef(id) || LEVELS[0];
    var n = Array.isArray(def.layouts) && def.layouts.length ? def.layouts.length : 1;
    var out = [];
    for (var i = 0; i < n; i++) out.push(buildLevel(def, i));
    return out;
  }

  var api = {
    LEVELS: LEVELS,                 // chapter 1 only, kept as it was
    ALL_LEVELS: ALL_LEVELS,
    CHAPTERS: CHAPTERS,
    CELL: CELL,
    buildLevel: buildLevel,
    getLevel: getLevel,
    getLayouts: getLayouts
  };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.levels = api;
  }
})(typeof self !== 'undefined' ? self : this);
