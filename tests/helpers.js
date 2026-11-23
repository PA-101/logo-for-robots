'use strict';

// Small seeded PRNG (mulberry32) so property tests are repeatable.
function makeRng(seed) {
  var a = seed >>> 0;
  function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    seed: seed,
    next: next,
    // integer in [lo, hi] inclusive
    int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
    bool: function (p) { return next() < (p === undefined ? 0.5 : p); }
  };
}

// Random text of mixed printable, whitespace, brackets, unicode and control characters.
function randomString(rng, maxLen) {
  var len = rng.int(0, maxLen === undefined ? 200 : maxLen);
  var pools = [
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '0123456789.-+e',
    ' \t\r\n',
    '[]();,:#"\'\\/*<>=!?-_',
    '\u0000\u0001\u007f\u00e9\u4e2d\u{1F422}\u200b\ufeff\u2028'
  ];
  var out = '';
  for (var i = 0; i < len; i++) {
    var pool = pools[rng.int(0, pools.length - 1)];
    var chars = Array.from(pool);
    out += chars[rng.int(0, chars.length - 1)];
  }
  return out;
}

// Runs fn(rng, i) for `count` cases. On failure the seed and case index are added to the error.
function forAll(seed, count, fn) {
  for (var i = 0; i < count; i++) {
    var rng = makeRng(seed + i);
    try {
      fn(rng, i);
    } catch (err) {
      err.message = '[seed=' + (seed + i) + ' case=' + i + '] ' + err.message;
      throw err;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { makeRng: makeRng, randomString: randomString, forAll: forAll };
