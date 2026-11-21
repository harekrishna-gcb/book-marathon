/**
 * Data.gs — the only file that talks to the spreadsheet.
 *
 * Rules followed here:
 *  - Read a whole sheet at once with getDataRange().getValues(); never cell by cell.
 *  - Columns are found by header name, so column order in the sheet does not matter.
 *  - Read-heavy data is cached in CacheService for CACHE_SECONDS. Every write bumps a
 *    "generation" key, so a stale copy is never served after a write.
 *  - Writes happen only inside withLock(), and re-read the sheet fresh first.
 */

var CACHE_SECONDS = 10;
var CACHE_CHUNK_CHARS = 25000; // CacheService values max out at 100 KB; stay well below even for multi-byte text

/** Column definitions. Type: s = text, n = number, b = TRUE/FALSE, d = date as yyyy-mm-dd text. */
var SCHEMA = {
  Users: { id: 's', name: 's', type: 's', phone: 's', members: 's', role: 's', pin_hash: 's', approved: 'b', created_at: 's', team_id: 's', locked_at: 's' },
  Books: { id: 's', title: 's', category: 's', price: 'n', quantity_received: 'n', updated_at: 's' },
  Sales: { id: 's', book_id: 's', quantity: 'n', user_id: 's', area: 's', sale_date: 'd', created_at: 's', created_by: 's' },
  Config: { key: 's', value: 's' }
};

var _memo = {};
function resetMemo() { _memo = {}; }

function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  var sh = getSpreadsheet().getSheetByName(name);
  if (!sh) throw new AppError('Sheet "' + name + '" is missing. Run setup() from the Apps Script editor.', 'SERVER');
  return sh;
}

/**
 * Returns all rows of a sheet as objects, e.g. [{id:'b_1', title:'...', price:350, _row:2}, ...].
 * `_row` is the sheet row number (only trustworthy on a fresh read inside a lock).
 * @param {string} name   sheet name
 * @param {boolean} fresh true = skip caches (always use inside a lock before writing)
 */
function readTable(name, fresh) {
  if (!fresh && _memo[name]) return _memo[name];
  var cache = CacheService.getScriptCache();
  var gen = cache.get('gen:' + name) || 'none';
  if (!fresh) {
    var hit = cacheGetJson(cache, 'tbl:' + name + ':' + gen);
    if (hit) { _memo[name] = hit; return hit; }
  }
  var rows = readSheetObjects(name);
  // Only store if nobody wrote while we were reading.
  if ((cache.get('gen:' + name) || 'none') === gen) cachePutJson(cache, 'tbl:' + name + ':' + gen, rows, CACHE_SECONDS);
  _memo[name] = rows;
  return rows;
}

function readSheetObjects(name) {
  var schema = SCHEMA[name];
  var tz = getSpreadsheet().getSpreadsheetTimeZone();
  var values = getSheet(name).getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var cols = Object.keys(schema);
  var idx = {};
  cols.forEach(function (c) { idx[c] = headers.indexOf(c); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = true;
    for (var k = 0; k < line.length; k++) if (line[k] !== '' && line[k] !== null) { empty = false; break; }
    if (empty) continue;
    var o = { _row: r + 1 };
    cols.forEach(function (c) { o[c] = fromCell(idx[c] >= 0 ? line[idx[c]] : '', schema[c], tz); });
    out.push(o);
  }
  return out;
}

/** Converts a raw cell value into the type the code expects. Tolerates hand-edited sheets. */
function fromCell(v, type, tz) {
  if (v instanceof Date) {
    if (type === 'd') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return v.toISOString();
  }
  if (type === 'n') { var n = Number(v); return isFinite(n) ? n : 0; }
  if (type === 'b') return v === true || String(v).trim().toUpperCase() === 'TRUE';
  if (type === 'd') return toIsoDateString(v) || String(v === null ? '' : v).trim();
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Prepares a value for setValues(). Text starting with = + - @ is prefixed with ' so Sheets never runs it as a formula. */
function toCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function headerRow(name) {
  var sh = getSheet(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

function objectToRow(headers, obj, existingRow) {
  return headers.map(function (h, i) {
    if (obj.hasOwnProperty(h)) return toCell(obj[h]);
    return existingRow ? toCell(existingRow[i]) : ''; // keep user-added extra columns untouched
  });
}

/** Adds a header column if the sheet does not have it yet (for sheets made before an upgrade). */
function ensureColumn(name, col) {
  var headers = headerRow(name);
  if (headers.indexOf(col) >= 0) return;
  var sh = getSheet(name);
  sh.getRange(1, headers.length + 1).setValues([[col]]);
  sh.getRange(1, headers.length + 1, sh.getMaxRows(), 1).setNumberFormat('@');
}

/** Appends objects as new rows in one setValues() call. */
function appendObjects(name, objs) {
  if (!objs.length) return;
  var sh = getSheet(name);
  var headers = headerRow(name);
  var data = objs.map(function (o) { return objectToRow(headers, o, null); });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, headers.length).setValues(data);
}

/** Overwrites the given objects' rows (each needs `_row` from a fresh read). */
function updateObjects(name, objs) {
  if (!objs.length) return;
  var sh = getSheet(name);
  var headers = headerRow(name);
  objs.forEach(function (o) { if (!o._row) throw new Error('updateObjects needs _row'); });
  if (objs.length <= 5) {
    objs.forEach(function (o) {
      var range = sh.getRange(o._row, 1, 1, headers.length);
      range.setValues([objectToRow(headers, o, range.getValues()[0])]);
    });
    return;
  }
  // Many rows: patch the block in memory and write it back with one setValues().
  var minRow = Math.min.apply(null, objs.map(function (o) { return o._row; }));
  var maxRow = Math.max.apply(null, objs.map(function (o) { return o._row; }));
  var range = sh.getRange(minRow, 1, maxRow - minRow + 1, headers.length);
  // getValues() drops the protective ' from text like "=x", so re-apply toCell to every cell we write back.
  var block = range.getValues().map(function (line) { return line.map(toCell); });
  objs.forEach(function (o) { block[o._row - minRow] = objectToRow(headers, o, block[o._row - minRow]); });
  range.setValues(block);
}

/** Deletes rows by sheet row number. Many rows: rewrites the sheet in one go instead of deleteRow() per row. */
function deleteRowNumbers(name, rowNums) {
  if (!rowNums.length) return;
  var sh = getSheet(name);
  if (rowNums.length <= 20) {
    rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
    return;
  }
  var drop = {};
  rowNums.forEach(function (r) { drop[r] = true; });
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return;
  var body = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var keep = body.filter(function (_, i) { return !drop[i + 2]; })
    .map(function (line) { return line.map(toCell); });
  sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, lastCol).setValues(keep);
}

/** Call after writing a sheet: flushes, invalidates the cache generation and the in-request memo. */
function markChanged(name) {
  SpreadsheetApp.flush();
  CacheService.getScriptCache().put('gen:' + name, newId('g'), 21600);
  delete _memo[name];
}

/**
 * Runs fn() while holding the script-wide lock, so two volunteers saving at the
 * same moment are processed one after the other.
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw new AppError('The server is busy saving other entries. Please try again in a moment.', 'BUSY');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function newId(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/* ---------- CacheService helpers that split big JSON into chunks ---------- */

function cachePutJson(cache, key, value, seconds) {
  var s = JSON.stringify(value);
  var parts = {};
  var n = Math.ceil(s.length / CACHE_CHUNK_CHARS) || 1;
  if (n > 80) return; // very large sheet: skip caching rather than flood the cache
  for (var i = 0; i < n; i++) parts[key + ':' + i] = s.slice(i * CACHE_CHUNK_CHARS, (i + 1) * CACHE_CHUNK_CHARS);
  parts[key + ':n'] = String(n);
  try { cache.putAll(parts, seconds); } catch (e) { /* cache full or value too big: just skip */ }
}

function cacheGetJson(cache, key) {
  var n = Number(cache.get(key + ':n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + ':' + i);
  var got = cache.getAll(keys);
  var s = '';
  for (var j = 0; j < n; j++) {
    if (got[keys[j]] === undefined || got[keys[j]] === null) return null;
    s += got[keys[j]];
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* ---------- Config ---------- */

var CONFIG_DEFAULTS = { campaign_name: 'Book Marathon', low_stock_threshold: '5' };

function readConfig() {
  var cfg = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) { cfg[k] = CONFIG_DEFAULTS[k]; });
  readTable('Config').forEach(function (r) { if (r.key) cfg[r.key] = r.value; });
  return cfg;
}

function lowStockThreshold() {
  var n = Number(readConfig().low_stock_threshold);
  return isFinite(n) && n >= 0 ? n : 5;
}

function publicConfig() {
  var c = readConfig();
  return { campaign_name: c.campaign_name, low_stock_threshold: lowStockThreshold() };
}

function setConfig(p, me) {
  requireRole(me, ['admin']);
  return withLock(function () {
    var rows = readTable('Config', true);
    var changes = {};
    if (p.campaign_name !== undefined) {
      var name = String(p.campaign_name).trim();
      if (!name) throw new AppError('Campaign name cannot be empty.');
      changes.campaign_name = name.slice(0, 100);
    }
    if (p.low_stock_threshold !== undefined) {
      var t = Number(p.low_stock_threshold);
      if (!isWholeNumber(t) || t < 0) throw new AppError('Low-stock threshold must be a whole number, 0 or more.');
      changes.low_stock_threshold = String(t);
    }
    var toUpdate = [], toAdd = [];
    Object.keys(changes).forEach(function (k) {
      var row = rows.filter(function (r) { return r.key === k; })[0];
      if (row) { row.value = changes[k]; toUpdate.push(row); } else toAdd.push({ key: k, value: changes[k] });
    });
    updateObjects('Config', toUpdate);
    appendObjects('Config', toAdd);
    markChanged('Config');
    return publicConfig();
  });
}
