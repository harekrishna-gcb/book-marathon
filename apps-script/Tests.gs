/**
 * Tests.gs — run runTests() from the Apps Script editor. It only checks the pure
 * rules in Logic.gs and never touches your sheets. Results appear in the log.
 * (The full API, including locking and permissions, is tested locally with tests/run-tests.js.)
 */

function runTests() {
  var passed = 0, failed = [];
  function eq(name, actual, expected) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) passed++; else failed.push(name + ': expected ' + e + ' but got ' + a);
  }
  function throwsMsg(fn) { try { fn(); return null; } catch (e) { return e.message; } }

  // --- Stock calculation ---
  var books = [{ id: 'b1', title: 'Gita', category: 'Big', price: 350, quantity_received: 10 },
               { id: 'b2', title: 'Chant', category: 'Small', price: 50, quantity_received: 6 }];
  var sales = [{ book_id: 'b1', quantity: 3 }, { book_id: 'b1', quantity: 2 }, { book_id: 'b2', quantity: 1 }];
  var st = stockRows(books, sales, 5);
  eq('sold b1', st[0].sold, 5);
  eq('available b1', st[0].available, 5);
  eq('low at threshold (5 left is low)', st[0].low, true);
  eq('available b2', st[1].available, 5);
  eq('no sales -> all available', stockRows(books, [], 5)[0].available, 10);

  // --- Overselling prevention ---
  var sold = soldByBook(sales);
  eq('can sell exactly what is left', throwsMsg(function () { assertStock(books[0], sold, 5, 0); }), null);
  eq('cannot sell one more', throwsMsg(function () { assertStock(books[0], sold, 6, 0); }), 'Only 5 copies of “Gita” are left.');
  eq('editing a sale gives its copies back', throwsMsg(function () { assertStock(books[0], sold, 8, 3); }), null);
  eq('out of stock message', throwsMsg(function () { assertStock(books[0], { b1: 10 }, 1, 0); }), '“Gita” is out of stock.');

  // --- Book upload planning ---
  var ids = 0, mk = function (p) { return p + '_' + (++ids); };
  var existing = [{ id: 'b1', title: 'Gita', category: 'Big', price: 350, quantity_received: 10 }];
  var plan = planBookUpsert(existing, [
    { row: 2, title: 'GITA', category: '', price: '400', quantity: '' },   // update, case-insensitive
    { row: 3, title: 'New Book', category: 'Small', price: '₹1,200', quantity: '5' },
    { row: 4, title: '', price: 10, quantity: 1 },                          // skipped
    { row: 5, title: 'Bad qty', price: 10, quantity: 'ten' },              // skipped
    { row: 6, title: 'new book', price: '', quantity: '7' }                 // same file, updates row 3
  ], 'now', mk);
  eq('added rows', plan.added, [3]);
  eq('updated rows', plan.updated, [2, 6]);
  eq('skipped rows', plan.skipped.map(function (s) { return s.row; }), [4, 5]);
  eq('update keeps blank fields', [existing[0].price, existing[0].quantity_received, existing[0].category], [400, 10, 'Big']);
  eq('new book price parsed from ₹1,200', plan.toAdd[0].price, 1200);
  eq('later row updated the new book', plan.toAdd[0].quantity_received, 7);

  // --- Dates ---
  eq('iso date', toIsoDateString('2026-11-05'), '2026-11-05');
  eq('dd/mm/yyyy is day-first', toIsoDateString('05/11/2026'), '2026-11-05');
  eq('dd-mm-yy', toIsoDateString('5-11-26'), '2026-11-05');
  eq('invalid day', toIsoDateString('31/02/2026'), '');
  eq('text', toIsoDateString('yesterday'), '');

  // --- Sale fields ---
  eq('quantity 0 rejected', throwsMsg(function () { cleanSaleFields({ quantity: 0 }, '2026-01-01'); }), 'Quantity must be a whole number of at least 1.');
  eq('quantity 1.5 rejected', !!throwsMsg(function () { cleanSaleFields({ quantity: 1.5 }, '2026-01-01'); }), true);
  eq('blank date -> today', cleanSaleFields({ quantity: 2 }, '2026-01-01').sale_date, '2026-01-01');

  // --- Phones ---
  eq('phone +91', normPhone('+91 98765 43210'), '9876543210');
  eq('phone 0-prefix', normPhone('09876543210'), '9876543210');

  console.log('Passed: ' + passed + ', failed: ' + failed.length);
  failed.forEach(function (f) { console.log('FAIL ' + f); });
  return { passed: passed, failed: failed };
}
