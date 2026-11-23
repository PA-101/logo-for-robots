(function (root) {
  'use strict';

  // TODO: implemented in a later task.

  var api = {};

  if (typeof module !== 'undefined') module.exports = api;
  else {
    root.LFR = root.LFR || {};
    root.LFR.levels = api;
  }
})(typeof self !== 'undefined' ? self : this);
