/**
 * Reports.gs — dashboard and leaderboard. Totals only, so every logged-in role may see them.
 *
 * Date filter (from / to, yyyy-mm-dd, both optional) applies to "sold" and "amount".
 * Stock received and available are always current (all sales ever).
 */

function cleanRange(p) {
  var from = p.from ? toIsoDateString(p.from) : '', to = p.to ? toIsoDateString(p.to) : '';
  if (p.from && !from) throw new AppError('“From” date is not valid.');
  if (p.to && !to) throw new AppError('“To” date is not valid.');
  if (from && to && from > to) throw new AppError('“From” date is after the “To” date.');
  return { from: from, to: to };
}

function dashboard(p, me) {
  var range = cleanRange(p || {});
  var books = readTable('Books'), sales = readTable('Sales'), users = readTable('Users');
  var threshold = lowStockThreshold();
  var stock = stockRows(books, sales, threshold);
  var inRange = sales.filter(function (s) { return inDateRange(s.sale_date, range.from, range.to); });
  var soldInRange = soldByBook(inRange);
  var priceOf = {}, userName = {};
  books.forEach(function (b) { priceOf[b.id] = Number(b.price) || 0; });
  users.forEach(function (u) { userName[u.id] = u.name; });
  var amount = function (s) { return s.quantity * (priceOf[s.book_id] || 0); };

  var cats = {};
  stock.forEach(function (b) {
    var c = b.category || 'Uncategorised';
    var x = cats[c] = cats[c] || { category: c, titles: 0, stock: 0, sold: 0, available: 0, period_sold: 0 };
    x.titles++; x.stock += b.quantity_received; x.sold += b.sold; x.available += b.available;
    x.period_sold += soldInRange[b.id] || 0;
  });

  var bySeller = {}, byArea = {};
  inRange.forEach(function (s) {
    var n = userName[s.user_id] || '(deleted user)', a = s.area || '—';
    bySeller[n] = bySeller[n] || { name: n, copies: 0, amount: 0 };
    bySeller[n].copies += s.quantity; bySeller[n].amount += amount(s);
    var ak = normTitle(a);
    byArea[ak] = byArea[ak] || { area: a, copies: 0, amount: 0 };
    byArea[ak].copies += s.quantity; byArea[ak].amount += amount(s);
  });
  var desc = function (a, b) { return b.copies - a.copies || b.amount - a.amount; };

  return {
    range: range,
    threshold: threshold,
    totals: {
      titles: books.length,
      stock: stock.reduce(function (a, b) { return a + b.quantity_received; }, 0),
      sold: inRange.reduce(function (a, s) { return a + s.quantity; }, 0),
      amount: inRange.reduce(function (a, s) { return a + amount(s); }, 0),
      available: stock.reduce(function (a, b) { return a + b.available; }, 0)
    },
    byBook: stock.map(function (b) { b.period_sold = soldInRange[b.id] || 0; return b; }),
    byCategory: Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (a, b) { return b.stock - a.stock; }),
    bySeller: Object.keys(bySeller).map(function (k) { return bySeller[k]; }).sort(desc),
    byArea: Object.keys(byArea).map(function (k) { return byArea[k]; }).sort(desc)
  };
}

/**
 * payload: by = 'books' | 'rupees', type = 'all' | 'Person' | 'Team', from/to optional.
 * Same rules as the prototype: only people/teams with at least one sale are ranked,
 * ties are broken by the other measure.
 */
function leaderboard(p, me) {
  p = p || {};
  var by = p.by === 'rupees' ? 'rupees' : 'books';
  var type = p.type === 'Person' || p.type === 'Team' ? p.type : 'all';
  var range = cleanRange(p);
  var priceOf = {};
  readTable('Books').forEach(function (b) { priceOf[b.id] = Number(b.price) || 0; });
  var m = {};
  readTable('Users').forEach(function (u) {
    if (type === 'all' || u.type === type) m[u.id] = { id: u.id, name: u.name, type: u.type, books: 0, rupees: 0 };
  });
  readTable('Sales').forEach(function (s) {
    var x = m[s.user_id];
    if (x && inDateRange(s.sale_date, range.from, range.to)) { x.books += s.quantity; x.rupees += s.quantity * (priceOf[s.book_id] || 0); }
  });
  var k = by, o = by === 'books' ? 'rupees' : 'books';
  var rows = Object.keys(m).map(function (id) { return m[id]; })
    .filter(function (x) { return x.books > 0; })
    .sort(function (a, b) { return b[k] - a[k] || b[o] - a[o] || (a.name < b.name ? -1 : 1); });
  rows.forEach(function (r, i) { r.rank = i + 1; r.me = r.id === me.id; });
  return { by: by, type: type, range: range, rows: rows };
}
