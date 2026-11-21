/*
 * parse.js — turns rows read from a CSV/Excel file (see readFile.js) into clean
 * objects for the API. Pure functions with no imports, so tests/run-tests.js can
 * test them without a browser.
 *
 * Header names are matched loosely: case, spaces and anything in brackets are
 * ignored, so "Price (₹)", " PRICE " and "price" all mean Price.
 */

var BOOK_COLUMNS = {
  title: ['title', 'book', 'book name', 'book title', 'name'],
  category: ['category', 'type', 'group'],
  price: ['price', 'mrp', 'rate', 'price rs', 'price inr'],
  quantity: ['quantity', 'qty', 'stock', 'quantity received', 'copies', 'received']
};
var BOOK_REQUIRED = { title: 'Title', price: 'Price', quantity: 'Quantity' };

var SALES_COLUMNS = {
  book: ['book', 'title', 'book name', 'book title'],
  quantity: ['quantity', 'qty', 'sold', 'copies', 'quantity sold'],
  soldBy: ['sold by', 'soldby', 'seller', 'team', 'person', 'name', 'volunteer', 'sold by name'],
  area: ['area', 'location', 'place', 'locality'],
  date: ['date', 'sale date', 'sold on', 'day']
};
var SALES_REQUIRED = { book: 'Book', quantity: 'Quantity', soldBy: 'Sold By' };

var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function monthOf(name) { var n = name.toLowerCase(); return MONTHS[n.slice(0, 4)] || MONTHS[n.slice(0, 3)] || 0; }

export function normKey(k) {
  return String(k).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function validYmd(y, m, d) {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ymd(y, m, d) { return validYmd(y, m, d) ? y + '-' + pad2(m) + '-' + pad2(d) : null; }

/**
 * Any date-ish cell → "yyyy-mm-dd". Returns '' for blank (the server then uses today)
 * and null when the value cannot be understood (the row is reported as invalid).
 * Text dates are read DAY first (05/11/2026 = 5 November), as is usual in India.
 */
export function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // SheetJS date cells can be a few minutes off midnight; shifting to midday avoids landing on the previous day.
    var x = new Date(v.getTime() + 12 * 36e5);
    return ymd(x.getFullYear(), x.getMonth() + 1, x.getDate());
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // Excel serial day number (1955–2119)
      var u = new Date(Math.round((v - 25569) * 864e5));
      return ymd(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
    }
    return null;
  }
  var s = String(v).trim();
  if (!s) return '';
  var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s\-\/]+([a-z]{3,9})\.?[\s\-\/,]+(\d{2}|\d{4})$/i.exec(s); // 5 Nov 2026, 05-Nov-26
  if (m && monthOf(m[2])) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], monthOf(m[2]), +m[1]);
  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s); // Nov 5, 2026
  if (m && monthOf(m[1])) return ymd(+m[3], monthOf(m[1]), +m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return toIsoDate(Number(s));
  return null;
}

/** Finds which file column feeds each field. Returns {field: originalHeader}. */
function mapColumns(rows, spec) {
  var headers = {};
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { headers[k] = true; }); });
  var byNorm = {};
  Object.keys(headers).forEach(function (h) { var n = normKey(h); if (n && !byNorm[n]) byNorm[n] = h; });
  var map = {};
  Object.keys(spec).forEach(function (field) {
    for (var i = 0; i < spec[field].length; i++) {
      if (byNorm[spec[field][i]] !== undefined) { map[field] = byNorm[spec[field][i]]; break; }
    }
  });
  return map;
}

function cell(r, header) {
  if (header === undefined) return '';
  var v = r[header];
  return typeof v === 'string' ? v.trim() : (v === null || v === undefined ? '' : v);
}

/** File row number as the person sees it in Excel (header is row 1). */
function rowNumber(r, i) { return typeof r.__rowNum__ === 'number' ? r.__rowNum__ + 1 : i + 2; }

function isEmptyRow(r) {
  return Object.keys(r).every(function (k) { var v = r[k]; return v === '' || v === null || v === undefined || (typeof v === 'string' && !v.trim()); });
}

function missing(map, required) {
  return Object.keys(required).filter(function (f) { return map[f] === undefined; }).map(function (f) { return required[f]; });
}

/** Book list rows → {rows:[{row,title,category,price,quantity}], blank:[row numbers without a title], missingColumns:[...]}. */
export function normalizeBookRows(json) {
  var map = mapColumns(json, BOOK_COLUMNS);
  var out = { rows: [], blank: [], missingColumns: missing(map, BOOK_REQUIRED) };
  json.forEach(function (r, i) {
    if (isEmptyRow(r)) return;
    var row = rowNumber(r, i);
    var title = String(cell(r, map.title)).replace(/\s+/g, ' ').trim();
    if (!title) { out.blank.push(row); return; }
    out.rows.push({ row: row, title: title, category: String(cell(r, map.category)), price: cell(r, map.price), quantity: cell(r, map.quantity) });
  });
  return out;
}

/** Sales rows → {rows:[{row,book,quantity,soldBy,area,date}], invalid:[{row,reason}], missingColumns:[...]}. */
export function normalizeSalesRows(json) {
  var map = mapColumns(json, SALES_COLUMNS);
  var out = { rows: [], invalid: [], missingColumns: missing(map, SALES_REQUIRED) };
  json.forEach(function (r, i) {
    if (isEmptyRow(r)) return;
    var row = rowNumber(r, i);
    var rawDate = cell(r, map.date);
    var date = toIsoDate(rawDate);
    if (date === null) { out.invalid.push({ row: row, reason: 'Date "' + rawDate + '" is not a valid date' }); return; }
    out.rows.push({
      row: row,
      book: String(cell(r, map.book)),
      quantity: cell(r, map.quantity),
      soldBy: String(cell(r, map.soldBy)).replace(/\s+/g, ' '),
      area: String(cell(r, map.area)),
      date: date
    });
  });
  return out;
}

export function chunk(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
