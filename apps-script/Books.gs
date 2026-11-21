/**
 * Books.gs — list, add/edit, delete and bulk-upload books.
 * Sold and available are always computed from the Sales sheet, never stored.
 */

var UPLOAD_CHUNK_MAX = 500;

function listBooks(me) {
  return stockRows(readTable('Books'), readTable('Sales'), lowStockThreshold());
}

/** Add a new book or edit one (payload.id set). Titles must be unique (case-insensitive). */
function saveBook(p, me) {
  requireRole(me, ['admin']);
  var v = validateBookInput(p);
  if (!v.ok) throw new AppError(v.error + '.');
  return withLock(function () {
    var books = readTable('Books', true);
    var key = normTitle(v.value.title);
    var clash = books.filter(function (b) { return normTitle(b.title) === key && b.id !== p.id; })[0];
    var now = new Date().toISOString();
    if (p.id) {
      var b = books.filter(function (x) { return x.id === p.id; })[0];
      if (!b) throw new AppError('That book no longer exists.', 'NOT_FOUND');
      if (clash) throw new AppError('Another book is already called “' + clash.title + '”.');
      b.title = v.value.title;
      b.category = v.value.category;
      if (v.value.price !== null) b.price = v.value.price;
      if (v.value.quantity !== null) b.quantity_received = v.value.quantity;
      b.updated_at = now;
      updateObjects('Books', [b]);
    } else if (clash) {
      // Same as the prototype: saving an existing title updates that book.
      clash.title = v.value.title;
      if (v.value.category) clash.category = v.value.category;
      if (v.value.price !== null) clash.price = v.value.price;
      if (v.value.quantity !== null) clash.quantity_received = v.value.quantity;
      clash.updated_at = now;
      updateObjects('Books', [clash]);
    } else {
      appendObjects('Books', [{ id: newId('b'), title: v.value.title, category: v.value.category, price: v.value.price || 0, quantity_received: v.value.quantity || 0, updated_at: now }]);
    }
    markChanged('Books');
    return listBooks(me);
  });
}

/** Deletes a book and its sales (same as the prototype; the UI asks for confirmation first). */
function deleteBook(p, me) {
  requireRole(me, ['admin']);
  return withLock(function () {
    var b = readTable('Books', true).filter(function (x) { return x.id === p.id; })[0];
    if (!b) throw new AppError('That book no longer exists.', 'NOT_FOUND');
    var saleRows = readTable('Sales', true).filter(function (s) { return s.book_id === b.id; }).map(function (s) { return s._row; });
    deleteRowNumbers('Sales', saleRows);
    deleteRowNumbers('Books', [b._row]);
    markChanged('Sales');
    markChanged('Books');
    return { books: listBooks(me), deletedSales: saleRows.length };
  });
}

/**
 * Bulk upload. payload.rows = [{row, title, category, price, quantity}] — at most 500 per call;
 * the frontend sends bigger files in several chunks.
 * Returns which file rows were added, updated or skipped (with a reason).
 */
function upsertBooks(p, me) {
  requireRole(me, ['admin']);
  var rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw new AppError('No rows to upload.');
  if (rows.length > UPLOAD_CHUNK_MAX) throw new AppError('Send at most ' + UPLOAD_CHUNK_MAX + ' rows per request.');
  return withLock(function () {
    var books = readTable('Books', true);
    var plan = planBookUpsert(books, rows, new Date().toISOString(), newId);
    updateObjects('Books', plan.toUpdate);
    appendObjects('Books', plan.toAdd);
    markChanged('Books');
    return { added: plan.added, updated: plan.updated, skipped: plan.skipped, books: listBooks(me) };
  });
}
