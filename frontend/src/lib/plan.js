/*
 * plan.js — what an upload WILL do, shown in the preview before anything is saved.
 * Mirrors the server rules in apps-script/Logic.gs and Sales.gs; the server
 * checks everything again when saving. Pure functions, tested in tests/run-tests.js.
 */

export const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** "1,200" → 1200, "₹350" → 350, "" → null, "abc" → NaN */
export function parseLooseNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** [2,3,4,5,9] → "2–5, 9" */
export function ranges(rows) {
  const a = [...rows].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < a.length;) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${a[i]}–${a[j]}` : String(a[i]));
    i = j + 1;
  }
  return out.join(', ');
}

/**
 * Book list preview. Returns items sorted by file row:
 * {r, action: 'add'|'update'|'skip', reason, note}
 */
export function planBooks(parsed, books) {
  const byTitle = {};
  books.forEach((b) => { byTitle[norm(b.title)] = b; });
  const inFile = {};
  const items = parsed.rows.map((r) => {
    const p = parseLooseNumber(r.price), q = parseLooseNumber(r.quantity);
    let reason = '';
    if (p !== null && (Number.isNaN(p) || p < 0)) reason = `Price “${r.price}” is not a valid amount`;
    else if (q !== null && (Number.isNaN(q) || q < 0 || !Number.isInteger(q))) reason = `Quantity “${r.quantity}” is not a whole number`;
    const k = norm(r.title);
    const action = reason ? 'skip' : (byTitle[k] || inFile[k]) ? 'update' : 'add';
    if (!reason) inFile[k] = true;
    return { r, action, reason, note: action === 'update' && !byTitle[k] ? 'repeated in this file' : '' };
  });
  parsed.blank.forEach((row) => items.push({ r: { row, title: '' }, action: 'skip', reason: 'Title is missing', note: '' }));
  return items.sort((a, b) => a.r.row - b.r.row);
}

/**
 * Sales file preview, using the stock we know about. Rows are taken top to bottom,
 * so copies used by one row are not available to the next.
 * Returns {items: [{r, ok, reason, note, title}], newSellers: count}
 */
export function planSales(parsed, books, users) {
  const byTitle = {}, byName = {}, avail = {}, newSellers = {};
  books.forEach((b) => { byTitle[norm(b.title)] = b; avail[b.id] = b.available; });
  users.forEach((u) => { byName[norm(u.name)] = u; });
  const items = parsed.rows.map((r) => {
    const b = byTitle[norm(r.book)], q = parseLooseNumber(r.quantity), seller = norm(r.soldBy);
    let reason = '', note = '';
    if (!norm(r.book)) reason = 'Book is missing';
    else if (!b) reason = `Book “${r.book}” is not in the book list`;
    else if (!seller) reason = 'Sold By is missing';
    else if (q === null || Number.isNaN(q) || q < 1 || !Number.isInteger(q)) reason = `Quantity “${r.quantity}” is not a whole number of at least 1`;
    else if (q > avail[b.id]) reason = `Not enough stock of “${b.title}” (${Math.max(avail[b.id], 0)} left)`;
    if (!reason) {
      avail[b.id] -= q;
      if (!byName[seller] && !newSellers[seller]) { newSellers[seller] = true; note = 'new seller (pending)'; }
    }
    return { r, ok: !reason, reason, note, title: b ? b.title : r.book };
  });
  parsed.invalid.forEach((x) => items.push({ r: { row: x.row }, ok: false, reason: x.reason, note: '', title: '' }));
  items.sort((a, b) => a.r.row - b.r.row);
  return { items, newSellers: Object.keys(newSellers).length };
}
