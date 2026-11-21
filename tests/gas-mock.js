/*
 * gas-mock.js — a small in-memory imitation of the Google Apps Script services the
 * backend uses (SpreadsheetApp, CacheService, LockService, PropertiesService,
 * Utilities, ContentService). It lets tests/run-tests.js run the real .gs files
 * with `gjs` (or in a browser for the UI demo) without a Google account.
 *
 * It mimics the behaviours the code relies on:
 *   - getValues() on an empty sheet returns [['']]
 *   - setValues() turns text starting with "=" into a formula (stored as {formula})
 *     unless it is prefixed with an apostrophe, which Sheets strips
 *   - CacheService values over 100 KB are rejected
 */
(function (root) {
  'use strict';

  function Sheet(name) { this.name = name; this.data = []; this.formats = {}; this.frozen = 0; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () {
    for (var r = this.data.length - 1; r >= 0; r--) if (this.data[r] && this.data[r].some(function (v) { return v !== '' && v !== null && v !== undefined; })) return r + 1;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    var max = 0;
    this.data.forEach(function (row) { for (var c = row.length - 1; c >= 0; c--) if (row[c] !== '' && row[c] !== undefined) { max = Math.max(max, c + 1); break; } });
    return max;
  };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.data.length); };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
  Sheet.prototype.getRange = function (row, col, nr, nc) {
    if (row < 1 || col < 1) throw new Error('Range out of bounds: ' + row + ',' + col);
    return new Range(this, row, col, nr || 1, nc || 1);
  };
  Sheet.prototype.getDataRange = function () {
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  };
  Sheet.prototype.deleteRow = function (r) { this.data.splice(r - 1, 1); };
  Sheet.prototype.cell = function (r, c) { var row = this.data[r - 1]; var v = row ? row[c - 1] : ''; return v === undefined ? '' : v; };

  function Range(sheet, row, col, nr, nc) { this.sheet = sheet; this.row = row; this.col = col; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    var out = [];
    for (var r = 0; r < this.nr; r++) {
      var line = [];
      for (var c = 0; c < this.nc; c++) {
        var v = this.sheet.cell(this.row + r, this.col + c);
        line.push(v && v.formula ? '#FORMULA!' : v);
      }
      out.push(line);
    }
    return out;
  };
  Range.prototype.setValues = function (vals) {
    if (vals.length !== this.nr || vals.some(function (l) { return l.length !== this.nc; }, this)) {
      throw new Error('The number of rows/columns in the data does not match the range (' + this.nr + 'x' + this.nc + ').');
    }
    for (var r = 0; r < this.nr; r++) {
      var idx = this.row + r - 1;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      for (var c = 0; c < this.nc; c++) {
        var v = vals[r][c];
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
        else if (typeof v === 'string' && v.charAt(0) === '=') v = { formula: v };
        if (v === undefined || v === null) v = '';
        this.sheet.data[idx][this.col + c - 1] = v;
      }
    }
    return this;
  };
  Range.prototype.clearContent = function () {
    for (var r = 0; r < this.nr; r++) {
      var row = this.sheet.data[this.row + r - 1];
      if (row) for (var c = 0; c < this.nc; c++) row[this.col + c - 1] = '';
    }
    return this;
  };
  Range.prototype.setNumberFormat = function (f) { this.sheet.formats[this.col] = f; return this; };
  Range.prototype.setFontWeight = function () { return this; };

  function Spreadsheet() { this.sheets = [new Sheet('Sheet1')]; }
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
  Spreadsheet.prototype.insertSheet = function (n) { var s = new Sheet(n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };
  Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Kolkata'; };

  var stats = { getValues: 0, setValues: 0 };
  var origGet = Range.prototype.getValues, origSet = Range.prototype.setValues;
  Range.prototype.getValues = function () { stats.getValues++; return origGet.apply(this, arguments); };
  Range.prototype.setValues = function () { stats.setValues++; return origSet.apply(this, arguments); };

  var ss = new Spreadsheet();
  root.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return ss; },
    openById: function () { return ss; },
    flush: function () {},
    _reset: function () { ss = new Spreadsheet(); },
    _stats: stats
  };

  var now = function () { return root.__mockNow || Date.now(); };
  var store = {};
  var cache = {
    get: function (k) { var e = store[k]; if (!e) return null; if (e.exp < now()) { delete store[k]; return null; } return e.v; },
    put: function (k, v, ttl) {
      if (typeof v !== 'string') throw new Error('Cache values must be strings');
      if (v.length > 100000) throw new Error('Argument too large: value');
      store[k] = { v: v, exp: now() + (ttl || 600) * 1000 };
    },
    remove: function (k) { delete store[k]; },
    getAll: function (keys) { var o = {}; keys.forEach(function (k) { var v = cache.get(k); if (v !== null) o[k] = v; }); return o; },
    putAll: function (obj, ttl) { Object.keys(obj).forEach(function (k) { cache.put(k, obj[k], ttl); }); },
    removeAll: function (keys) { keys.forEach(function (k) { delete store[k]; }); }
  };
  root.CacheService = { getScriptCache: function () { return cache; }, _clear: function () { store = {}; } };

  var lockState = { held: false, acquired: 0, failNext: false };
  root.LockService = {
    getScriptLock: function () {
      return {
        tryLock: function () { if (lockState.failNext) { lockState.failNext = false; return false; } if (lockState.held) throw new Error('Re-entrant lock in test'); lockState.held = true; lockState.acquired++; return true; },
        waitLock: function () { lockState.held = true; },
        releaseLock: function () { lockState.held = false; },
        hasLock: function () { return lockState.held; }
      };
    },
    _state: lockState
  };

  var props = {};
  root.PropertiesService = {
    getScriptProperties: function () {
      return { getProperty: function (k) { return props.hasOwnProperty(k) ? props[k] : null; }, setProperty: function (k, v) { props[k] = String(v); } };
    }
  };

  root.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (s) { return { content: s, setMimeType: function () { return this; }, getContent: function () { return this.content; } }; }
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  root.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: function (alg, s) {
      var hex = root.__sha256Hex(s);
      var out = [];
      for (var i = 0; i < hex.length; i += 2) { var b = parseInt(hex.substr(i, 2), 16); out.push(b > 127 ? b - 256 : b); }
      return out;
    },
    getUuid: function () { return root.__uuid(); },
    formatDate: function (d, tz, fmt) {
      if (fmt !== 'yyyy-MM-dd') throw new Error('mock formatDate supports yyyy-MM-dd only');
      var x = new Date(d.getTime() + 330 * 60000); // Asia/Kolkata = UTC+5:30
      return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
