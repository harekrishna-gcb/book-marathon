/**
 * Logic.gs — pure business rules. No SpreadsheetApp / CacheService calls in here,
 * so these functions are easy to test (see Tests.gs and tests/run-tests.js).
 */

function isWholeNumber(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

/** "  Bhagavad-Gītā   As It Is " -> "bhagavad-gītā as it is" (used to match titles case-insensitively). */
function normTitle(s) { return String(s === null || s === undefined ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }

/** Keeps digits only; Indian numbers lose a leading 91 / 0 so "+91 98765 43210" matches "09876543210". */
function normPhone(s) {
  var d = String(s === null || s === undefined ? '' : s).replace(/\D/g, '');
  if (d.length > 10 && (d.indexOf('91') === 0 || d.charAt(0) === '0')) d = d.slice(-10);
  return d;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function isValidYmd(y, m, d) {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  var dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[m - 1];
}

/**
 * Normalises a date to "yyyy-mm-dd". Accepts yyyy-mm-dd and day-first Indian
 * formats (dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy). Returns '' if it isn't a real date.
 */
function toIsoDateString(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  }
  var s = String(v === null || v === undefined ? '' : v).trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isValidYmd(+m[1], +m[2], +m[3]) ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : '';
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    var y = +m[3];
    if (y < 100) y += 2000;
    return isValidYmd(y, +m[2], +m[1]) ? y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]) : '';
  }
  return '';
}

/** { bookId: copiesSold } */
function soldByBook(sales) {
  var m = {};
  sales.forEach(function (s) { m[s.book_id] = (m[s.book_id] || 0) + (Number(s.quantity) || 0); });
  return m;
}

/** Copies of `book` still available. `extraBack` adds copies back (used when editing an existing sale). */
function availableOf(book, soldMap, extraBack) {
  return (Number(book.quantity_received) || 0) - (soldMap[book.id] || 0) + (extraBack || 0);
}

/** Books enriched with sold / available / low flags — what the frontend shows. */
function stockRows(books, sales, threshold) {
  var sold = soldByBook(sales);
  return books.map(function (b) {
    var s = sold[b.id] || 0;
    var a = (Number(b.quantity_received) || 0) - s;
    return {
      id: b.id, title: b.title, category: b.category, price: Number(b.price) || 0,
      quantity_received: Number(b.quantity_received) || 0, sold: s, available: a,
      low: a <= threshold, updated_at: b.updated_at
    };
  });
}

/**
 * Throws if `qty` copies of `book` can't be sold.
 * Called INSIDE the lock with freshly read sales, so two people can't both take the last copy.
 */
function assertStock(book, soldMap, qty, extraBack) {
  var avail = availableOf(book, soldMap, extraBack);
  if (qty > avail) {
    throw new AppError(avail <= 0
      ? '“' + book.title + '” is out of stock.'
      : 'Only ' + avail + ' cop' + (avail === 1 ? 'y' : 'ies') + ' of “' + book.title + '” ' + (avail === 1 ? 'is' : 'are') + ' left.', 'VALIDATION');
  }
}

/** Parses a number typed by a person: "1,200" -> 1200, "₹350" -> 350, "" -> null, "abc" -> NaN. */
function parseLooseNumber(v) {
  if (typeof v === 'number') return v;
  var s = String(v === null || v === undefined ? '' : v).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

/**
 * Validates one book from a form or upload.
 * Blank price/quantity: 0 for a new book, unchanged for an existing book.
 * @return {{ok:boolean, error?:string, value?:{title,category,price,quantity}}}
 */
function validateBookInput(raw) {
  var title = String(raw.title === null || raw.title === undefined ? '' : raw.title).trim().replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: 'Title is missing' };
  if (title.length > 200) return { ok: false, error: 'Title is longer than 200 characters' };
  var price = parseLooseNumber(raw.price);
  if (price !== null && (isNaN(price) || price < 0)) return { ok: false, error: 'Price "' + raw.price + '" is not a valid amount' };
  var qty = parseLooseNumber(raw.quantity);
  if (qty !== null && (isNaN(qty) || qty < 0 || !isWholeNumber(qty))) return { ok: false, error: 'Quantity "' + raw.quantity + '" is not a whole number' };
  return {
    ok: true,
    value: {
      title: title,
      category: String(raw.category === null || raw.category === undefined ? '' : raw.category).trim().slice(0, 100),
      price: price === null ? null : Math.round(price * 100) / 100,
      quantity: qty
    }
  };
}

/**
 * Decides what an uploaded book list does, matching titles case-insensitively.
 * Same rules as the prototype: existing title -> update, new title -> add.
 * A title repeated within the file updates the copy added earlier in the same file.
 * @param existing books currently in the sheet
 * @param rows     [{row, title, category, price, quantity}]  (row = line number in the file)
 * @return {added:[row], updated:[row], skipped:[{row, reason}], toAdd:[book], toUpdate:[book]}
 */
function planBookUpsert(existing, rows, nowIso, makeId) {
  var byTitle = {};
  existing.forEach(function (b) { byTitle[normTitle(b.title)] = b; });
  var res = { added: [], updated: [], skipped: [], toAdd: [], toUpdate: [] };
  var touched = {};
  rows.forEach(function (r) {
    var v = validateBookInput(r);
    if (!v.ok) { res.skipped.push({ row: r.row, reason: v.error }); return; }
    var b = v.value, key = normTitle(b.title), cur = byTitle[key];
    if (cur) {
      cur.title = b.title;
      if (b.category) cur.category = b.category;
      if (b.price !== null) cur.price = b.price;
      if (b.quantity !== null) cur.quantity_received = b.quantity;
      cur.updated_at = nowIso;
      if (cur._new) { /* already queued for add */ } else if (!touched[cur.id]) { touched[cur.id] = true; res.toUpdate.push(cur); }
      res.updated.push(r.row);
    } else {
      var nb = { id: makeId('b'), title: b.title, category: b.category, price: b.price || 0, quantity_received: b.quantity || 0, updated_at: nowIso, _new: true };
      byTitle[key] = nb;
      res.toAdd.push(nb);
      res.added.push(r.row);
    }
  });
  res.toAdd.forEach(function (b) { delete b._new; });
  return res;
}

/** Validates quantity / area / date for a sale. Returns cleaned values or throws AppError. */
function cleanSaleFields(p, todayIso) {
  var q = parseLooseNumber(p.quantity);
  if (q === null || isNaN(q) || !isWholeNumber(q) || q < 1) throw new AppError('Quantity must be a whole number of at least 1.');
  if (q > 100000) throw new AppError('Quantity looks too large.');
  var date = p.sale_date ? toIsoDateString(p.sale_date) : todayIso;
  if (!date) throw new AppError('Date "' + p.sale_date + '" is not a valid date (use yyyy-mm-dd or dd/mm/yyyy).');
  return { quantity: q, area: String(p.area === null || p.area === undefined ? '' : p.area).trim().replace(/\s+/g, ' ').slice(0, 100), sale_date: date };
}

/** Groups rows and sums values; returns [[key, total], ...] sorted biggest first (same as the prototype). */
function groupSum(rows, keyFn, valFn) {
  var m = {};
  rows.forEach(function (r) { var k = keyFn(r) || '—'; m[k] = (m[k] || 0) + valFn(r); });
  return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
}

/** True if the yyyy-mm-dd date is within [from, to] (either may be empty). */
function inDateRange(d, from, to) {
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
