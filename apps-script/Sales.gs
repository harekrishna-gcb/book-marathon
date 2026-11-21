/**
 * Sales.gs — record, edit, delete and bulk-upload sales.
 *
 * Overselling protection: every write takes the script lock, re-reads Books and
 * Sales FRESH (no cache), and only then checks available stock and saves.
 */

function todayIso() {
  return Utilities.formatDate(new Date(), getSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

/** Sales the caller may see: admin = all, lead = own team, seller = own. Newest first. */
function visibleSales(me, sales, books, users) {
  var allowed = manageableUserIds(me, users);
  var bookById = {}, userById = {};
  books.forEach(function (b) { bookById[b.id] = b; });
  users.forEach(function (u) { userById[u.id] = u; });
  return sales
    .filter(function (s) { return allowed[s.user_id]; })
    .map(function (s) {
      var b = bookById[s.book_id] || {}, u = userById[s.user_id] || {};
      return {
        id: s.id, book_id: s.book_id, book_title: b.title || '(deleted book)', price: Number(b.price) || 0,
        quantity: s.quantity, amount: s.quantity * (Number(b.price) || 0),
        user_id: s.user_id, user_name: u.name || '(deleted user)', user_type: u.type || '',
        area: s.area, sale_date: s.sale_date, created_at: s.created_at
      };
    })
    .sort(function (a, b) {
      return a.sale_date < b.sale_date ? 1 : a.sale_date > b.sale_date ? -1 : (a.created_at < b.created_at ? 1 : -1);
    });
}

/** Distinct areas from all sales, for autocomplete. */
function allAreas(sales) {
  var seen = {}, out = [];
  sales.forEach(function (s) {
    var k = normTitle(s.area);
    if (k && !seen[k]) { seen[k] = true; out.push(s.area); }
  });
  return out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
}

function listSales(me) {
  var sales = readTable('Sales');
  return { sales: visibleSales(me, sales, readTable('Books'), readTable('Users')), areas: allAreas(sales) };
}

/** Response after any sale change: the caller's sales log plus updated stock. */
function salesResponse(me, extra) {
  var out = listSales(me);
  out.books = listBooks(me);
  if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

function assertCanUseSeller(me, users, userId) {
  var target = users.filter(function (u) { return u.id === userId; })[0];
  if (!target) throw new AppError('Choose who sold the books.', 'VALIDATION');
  if (!manageableUserIds(me, users)[userId]) {
    throw new AppError(me.role === 'seller' ? 'You can only record your own sales.' : 'You can only record sales for your own team.', 'FORBIDDEN');
  }
  return target;
}

function addSale(p, me) {
  var f = cleanSaleFields(p, todayIso());
  return withLock(function () {
    var users = readTable('Users', true);
    var userId = p.user_id || me.id;
    assertCanUseSeller(me, users, userId);
    var books = readTable('Books', true);
    var book = books.filter(function (b) { return b.id === p.book_id; })[0];
    if (!book) throw new AppError('Choose a book.', 'VALIDATION');
    var sales = readTable('Sales', true);
    assertStock(book, soldByBook(sales), f.quantity, 0); // re-checked inside the lock
    var sale = {
      id: newId('s'), book_id: book.id, quantity: f.quantity, user_id: userId, area: f.area,
      sale_date: f.sale_date, created_at: new Date().toISOString(), created_by: me.id
    };
    appendObjects('Sales', [sale]);
    markChanged('Sales');
    return salesResponse(me, { saleId: sale.id });
  });
}

function updateSale(p, me) {
  var f = cleanSaleFields(p, todayIso());
  return withLock(function () {
    var users = readTable('Users', true);
    var sales = readTable('Sales', true);
    var sale = sales.filter(function (s) { return s.id === p.id; })[0];
    if (!sale) throw new AppError('That sale no longer exists.', 'NOT_FOUND');
    if (!manageableUserIds(me, users)[sale.user_id]) throw new AppError('You cannot edit this sale.', 'FORBIDDEN');
    var userId = p.user_id || sale.user_id;
    assertCanUseSeller(me, users, userId);
    var bookId = p.book_id || sale.book_id;
    var book = readTable('Books', true).filter(function (b) { return b.id === bookId; })[0];
    if (!book) throw new AppError('Choose a book.', 'VALIDATION');
    // When the book stays the same, this sale's old copies go back to the pool first.
    assertStock(book, soldByBook(sales), f.quantity, bookId === sale.book_id ? sale.quantity : 0);
    sale.book_id = bookId;
    sale.quantity = f.quantity;
    sale.user_id = userId;
    sale.area = f.area;
    sale.sale_date = f.sale_date;
    updateObjects('Sales', [sale]);
    markChanged('Sales');
    return salesResponse(me);
  });
}

function deleteSale(p, me) {
  return withLock(function () {
    var users = readTable('Users', true);
    var sale = readTable('Sales', true).filter(function (s) { return s.id === p.id; })[0];
    if (!sale) throw new AppError('That sale no longer exists.', 'NOT_FOUND');
    if (!manageableUserIds(me, users)[sale.user_id]) throw new AppError('You cannot delete this sale.', 'FORBIDDEN');
    deleteRowNumbers('Sales', [sale._row]);
    markChanged('Sales');
    return salesResponse(me);
  });
}

/**
 * Bulk upload (admin). payload.rows = [{row, book, quantity, soldBy, area, date}], max 500 per call.
 * - book is matched by title (case-insensitive) and must already exist
 * - unknown sellers are created as pending Persons (no PIN, not approved)
 * - rows with an unknown book, bad quantity/date, missing seller or not enough stock are skipped
 * Rows are processed top to bottom, so stock used by row 5 is not available to row 6.
 */
function uploadSales(p, me) {
  requireRole(me, ['admin']);
  var rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw new AppError('No rows to upload.');
  if (rows.length > UPLOAD_CHUNK_MAX) throw new AppError('Send at most ' + UPLOAD_CHUNK_MAX + ' rows per request.');
  var today = todayIso();
  return withLock(function () {
    var books = readTable('Books', true), sales = readTable('Sales', true), users = readTable('Users', true);
    var bookByTitle = {}, userByName = {};
    books.forEach(function (b) { bookByTitle[normTitle(b.title)] = b; });
    users.forEach(function (u) { if (!userByName[normTitle(u.name)]) userByName[normTitle(u.name)] = u; });
    var sold = soldByBook(sales);
    var now = new Date().toISOString();
    var newUsers = [], newSales = [], imported = [], skipped = [];

    rows.forEach(function (r) {
      var skip = function (reason) { skipped.push({ row: r.row, reason: reason }); };
      var book = bookByTitle[normTitle(r.book)];
      if (!normTitle(r.book)) return skip('Book is missing');
      if (!book) return skip('Book “' + String(r.book).trim() + '” is not in the book list');
      var sellerName = String(r.soldBy === null || r.soldBy === undefined ? '' : r.soldBy).trim().replace(/\s+/g, ' ');
      if (!sellerName) return skip('Sold By is missing');
      var f;
      try { f = cleanSaleFields({ quantity: r.quantity, area: r.area, sale_date: r.date }, today); }
      catch (e) { return skip(e.message.replace(/\.$/, '')); }
      var avail = availableOf(book, sold, 0);
      if (f.quantity > avail) return skip('Not enough stock of “' + book.title + '” (' + Math.max(avail, 0) + ' left)');

      var seller = userByName[normTitle(sellerName)];
      if (!seller) {
        seller = { id: newId('u'), name: sellerName.slice(0, 100), type: 'Person', phone: '', members: '', role: 'seller', pin_hash: '', approved: false, created_at: now, team_id: '' };
        userByName[normTitle(sellerName)] = seller;
        newUsers.push(seller);
      }
      sold[book.id] = (sold[book.id] || 0) + f.quantity;
      newSales.push({ id: newId('s'), book_id: book.id, quantity: f.quantity, user_id: seller.id, area: f.area, sale_date: f.sale_date, created_at: now, created_by: me.id });
      imported.push(r.row);
    });

    appendObjects('Users', newUsers);
    appendObjects('Sales', newSales);
    if (newUsers.length) markChanged('Users');
    markChanged('Sales');
    return salesResponse(me, {
      imported: imported, skipped: skipped,
      newSellers: newUsers.map(function (u) { return u.name; })
    });
  });
}
