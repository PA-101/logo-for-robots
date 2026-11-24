(function (root) {
  'use strict';

  // Tiny Logo-style language: tokenizer + recursive-descent parser.
  // No DOM access. parse() never throws.

  var LIMITS = {
    MAX_MOVE: 1000,      // cm, forward / back
    MAX_TURN: 3600,      // degrees, left / right
    MAX_REPEAT: 100,
    MAX_WAIT: 60,        // seconds
    MAX_DEPTH: 8,        // nested [ ] blocks
    MAX_TEXT: 5000,      // characters
    MAX_COMMANDS: 2000,  // executed commands after expanding repeats
    MIN_POWER: 10,       // percent
    MAX_POWER: 100
  };

  var MOVES = { forward: LIMITS.MAX_MOVE, back: LIMITS.MAX_MOVE };
  var TURNS = { left: LIMITS.MAX_TURN, right: LIMITS.MAX_TURN };
  var NUMBER_RE = /^\d+(\.\d+)?$/;
  // New keywords go last, so ties in "did you mean" keep their old answers.
  var KEYWORDS = ['forward', 'back', 'left', 'right', 'repeat', 'if', 'wait', 'power', 'until-bump'];
  var CONDITIONS = { 'wall-ahead': true, bumped: true };
  var SATURATE = 1e9;

  function ParseError(line, message) {
    this.line = line;
    this.message = message;
  }

  // Shows untrusted text inside a message: printable only and at most 24 characters.
  function show(text) {
    var s = String(text).replace(/[^\x20-\x7e]/g, '?');
    return s.length > 24 ? s.slice(0, 24) + '...' : s;
  }

  function isSeparator(ch) {
    return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v' ||
      ch === '\u00a0' || ch === '\ufeff';
  }

  // Splits text into tokens: {kind:'open'|'close'|'word', text, line}.
  function tokenize(text) {
    var tokens = [];
    var line = 1;
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (ch === '\n') { line++; i++; continue; }
      if (isSeparator(ch)) { i++; continue; }
      if (ch === ';') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (ch === '[') { tokens.push({ kind: 'open', text: '[', line: line, start: i, end: i + 1 }); i++; continue; }
      if (ch === ']') { tokens.push({ kind: 'close', text: ']', line: line, start: i, end: i + 1 }); i++; continue; }
      var start = i;
      while (i < n) {
        var c = text[i];
        if (c === '\n' || c === ';' || c === '[' || c === ']' || isSeparator(c)) break;
        i++;
      }
      tokens.push({ kind: 'word', text: text.slice(start, i), line: line, start: start, end: i });
    }
    return tokens;
  }

  function editDistance(a, b) {
    var prev = [];
    var j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function suggest(word) {
    if (word.length < 3 || word.length > 20) return null;
    var best = null;
    var bestDist = 3;
    for (var i = 0; i < KEYWORDS.length; i++) {
      var d = editDistance(word, KEYWORDS[i]);
      if (d < bestDist) { bestDist = d; best = KEYWORDS[i]; }
    }
    return best;
  }

  // positions: when true, command nodes also get character offsets (see design.md section 8).
  function parseTokens(tokens, positions) {
    // Adds source offsets to a node only when asked, so the default node shape is unchanged.
    function at(node, kwTok, num) {
      if (!positions) return node;
      node.start = kwTok.start;
      if (num) { node.numStart = num.start; node.numEnd = num.end; }
      return node;
    }

    var pos = 0;

    function peek() { return pos < tokens.length ? tokens[pos] : null; }

    function readNumber(keyword, kwTok, example) {
      var tok = peek();
      var needs = keyword === 'power' ? ' needs a number from 10 to 100, like ' : ' needs a number, like ';
      if (!tok || tok.kind !== 'word') {
        throw new ParseError(kwTok.line, '"' + keyword + '"' + needs + example + '.');
      }
      if (keyword === 'power' && /^-\d/.test(tok.text)) {
        throw new ParseError(kwTok.line, '"power" must be at least ' + LIMITS.MIN_POWER + ', but I found ' + show(tok.text) + '.');
      }
      if (/^-\d/.test(tok.text)) {
        throw new ParseError(kwTok.line, '"' + keyword + '" cannot use a negative number (' + show(tok.text) +
          '). Use "back" or "right" to go the other way.');
      }
      if (!NUMBER_RE.test(tok.text)) {
        throw new ParseError(kwTok.line, '"' + keyword + '"' + needs + example +
          '. I found "' + show(tok.text) + '" instead.');
      }
      pos++;
      return { value: parseFloat(tok.text), text: tok.text, start: tok.start, end: tok.end };
    }

    function checkMax(keyword, num, max, line) {
      if (!(num.value <= max)) {
        throw new ParseError(line, show(num.text) + ' is too big for "' + keyword + '". The most is ' + max + '.');
      }
    }

    function expectOpen(what, after, line) {
      var tok = peek();
      if (!tok || tok.kind !== 'open') {
        throw new ParseError(line, what + ' needs a "[" after the ' + after + '.');
      }
      pos++;
      return tok;
    }

    // Parses commands until the matching "]" (or end of input at depth 0).
    function parseBlock(depth, openTok) {
      var nodes = [];
      for (;;) {
        var tok = peek();
        if (!tok) {
          if (openTok) throw new ParseError(openTok.line, 'This "[" is never closed. Add a "]".');
          return nodes;
        }
        if (tok.kind === 'close') {
          if (!openTok) throw new ParseError(tok.line, 'Found a "]" with no matching "[".');
          pos++;
          return nodes;
        }
        if (tok.kind === 'open') {
          throw new ParseError(tok.line, 'Found a "[" with no command before it. Use "repeat 3 [" or "if wall-ahead [".');
        }
        nodes.push(parseCommand(depth));
      }
    }

    function parseCommand(depth) {
      var tok = tokens[pos++];
      var word = tok.text.toLowerCase();
      var num;

      if (Object.prototype.hasOwnProperty.call(MOVES, word)) {
        num = readNumber(word, tok, word + ' 50');
        checkMax(word, num, MOVES[word], tok.line);
        return at({ type: word, n: num.value, line: tok.line }, tok, num);
      }
      if (Object.prototype.hasOwnProperty.call(TURNS, word)) {
        num = readNumber(word, tok, word + ' 90');
        checkMax(word, num, TURNS[word], tok.line);
        return at({ type: word, n: num.value, line: tok.line }, tok, num);
      }
      if (word === 'wait') {
        num = readNumber('wait', tok, 'wait 2');
        checkMax('wait', num, LIMITS.MAX_WAIT, tok.line);
        return at({ type: 'wait', n: num.value, line: tok.line }, tok, num);
      }
      if (word === 'power') {
        num = readNumber('power', tok, 'power 50');
        checkMax('power', num, LIMITS.MAX_POWER, tok.line);
        if (num.value < LIMITS.MIN_POWER) {
          throw new ParseError(tok.line, '"power" must be at least ' + LIMITS.MIN_POWER + ', but I found ' + show(num.text) + '.');
        }
        return at({ type: 'power', n: num.value, line: tok.line }, tok, num);
      }
      if (word === 'until-bump') {
        var after = peek();
        if (after && after.kind === 'word' && /^-?\d/.test(after.text)) {
          throw new ParseError(tok.line, '"until-bump" does not take a number. It drives until the bumper touches a wall.');
        }
        return at({ type: 'until-bump', line: tok.line }, tok, null);
      }
      if (word === 'repeat') {
        num = readNumber('repeat', tok, 'repeat 4 [ forward 50 right 90 ]');
        if (num.value > LIMITS.MAX_REPEAT) checkMax('repeat', num, LIMITS.MAX_REPEAT, tok.line);
        if (num.value < 1 || Math.floor(num.value) !== num.value) {
          throw new ParseError(tok.line, '"repeat" needs a whole number from 1 to ' + LIMITS.MAX_REPEAT +
            ', but I found ' + show(num.text) + '.');
        }
        var open = expectOpen('"repeat"', 'number', tok.line);
        if (depth + 1 > LIMITS.MAX_DEPTH) {
          throw new ParseError(open.line, 'Blocks are nested too deeply (limit ' + LIMITS.MAX_DEPTH + ').');
        }
        return at({ type: 'repeat', n: num.value, body: parseBlock(depth + 1, open), line: tok.line }, tok, num);
      }
      if (word === 'if') {
        var cond = peek();
        var condWord = cond && cond.kind === 'word' ? cond.text.toLowerCase() : '';
        if (!Object.prototype.hasOwnProperty.call(CONDITIONS, condWord)) {
          throw new ParseError(tok.line, '"if" needs a condition: wall-ahead or bumped, like: if wall-ahead [ left 90 ]');
        }
        pos++;
        var open2 = expectOpen('"if ' + condWord + '"', 'condition', tok.line);
        if (depth + 1 > LIMITS.MAX_DEPTH) {
          throw new ParseError(open2.line, 'Blocks are nested too deeply (limit ' + LIMITS.MAX_DEPTH + ').');
        }
        return at({ type: 'if', cond: condWord, body: parseBlock(depth + 1, open2), line: tok.line }, tok, null);
      }
      if (NUMBER_RE.test(tok.text)) {
        throw new ParseError(tok.line, 'I expected a command like forward or left, but found the number ' + show(tok.text) + '.');
      }
      var hint = suggest(word);
      throw new ParseError(tok.line, 'I don\'t know the word "' + show(tok.text) + '".' +
        (hint ? ' Did you mean "' + hint + '"?' : ''));
    }

    return parseBlock(0, null);
  }

  // Number of commands the robot would execute once repeats are expanded.
  // Every node costs 1; a repeat costs 1 + n * max(1, cost of its body). Saturates at 1e9.
  function countNodes(nodes) {
    var total = 0;
    for (var i = 0; i < nodes.length; i++) total = Math.min(SATURATE, total + countNode(nodes[i]));
    return total;
  }

  function countNode(node) {
    // Each loop pass costs at least 1, so nested empty loops cannot hide a huge amount of work.
    if (node.type === 'repeat') return Math.min(SATURATE, 1 + node.n * Math.max(1, countNodes(node.body)));
    if (node.type === 'if') return Math.min(SATURATE, 1 + countNodes(node.body));
    return 1;
  }

  function countCommands(program) {
    return Array.isArray(program) ? countNodes(program) : 0;
  }

  function fail(line, message) {
    return { ok: false, program: [], errors: [{ line: line, message: message }] };
  }

  function parse(text, options) {
    var positions = !!(options && typeof options === 'object' && options.positions === true);
    try {
      if (text === null || text === undefined) text = '';
      if (typeof text !== 'string') text = String(text);
      if (text.length > LIMITS.MAX_TEXT) {
        return fail(1, 'This program is too long (' + text.length + ' characters). The limit is ' + LIMITS.MAX_TEXT + '.');
      }
      var tokens = tokenize(text);
      if (tokens.length === 0) return fail(0, 'Nothing to run. Type a command like forward 50.');
      var program = parseTokens(tokens, positions);
      if (program.length === 0) return fail(0, 'Nothing to run. Type a command like forward 50.');
      var running = 0;
      for (var i = 0; i < program.length; i++) {
        running = Math.min(SATURATE, running + countNode(program[i]));
        if (running > LIMITS.MAX_COMMANDS) {
          return fail(program[i].line, 'This program would run more than ' + LIMITS.MAX_COMMANDS +
            ' commands once the repeats are expanded. Use smaller repeat counts.');
        }
      }
      return { ok: true, program: program, errors: [] };
    } catch (err) {
      if (err instanceof ParseError) return fail(err.line, err.message);
      return fail(0, 'Sorry, something unexpected went wrong while reading the program.');
    }
  }

  var api = { parse: parse, countCommands: countCommands, LIMITS: LIMITS };

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.lang = api;
  }
})(typeof self !== 'undefined' ? self : this);
