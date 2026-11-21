/**
 * Book Marathon — Apps Script backend: entry points and router.
 *
 * Files in this project (Apps Script merges them into one global scope):
 *   Code.gs     doGet/doPost, request routing, error handling   (this file)
 *   Data.gs     reading/writing sheets in bulk, caching, locking
 *   Auth.gs     PIN hashing, sessions, roles, login throttling
 *   Logic.gs    pure business rules (stock, validation) with no Google calls
 *   Books.gs    book actions
 *   Sales.gs    sale actions
 *   Users.gs    user / team actions
 *   Reports.gs  dashboard and leaderboard
 *   Setup.gs    one-time setup() and seed() functions
 *   Tests.gs    runTests(): self-checks you can run from the editor
 *
 * The frontend sends:  POST <web app url>
 *   Content-Type: text/plain        (plain text avoids a CORS pre-flight)
 *   body: {"action": "...", "token": "...", "payload": {...}}
 * and always gets JSON back: {"ok": true, "data": ...} or {"ok": false, "error": "...", "code": "..."}
 */

/** Actions that work without a session token. */
var PUBLIC_ACTIONS = {
  ping: function () { return { time: new Date().toISOString() }; },
  getConfig: function () { return publicConfig(); },
  register: function (p) { return registerUser(p); },
  login: function (p) { return login(p); }
};

/** Actions that need a valid session. Each receives (payload, me). Role checks happen inside each action. */
var PRIVATE_ACTIONS = {
  logout: function (p, me, token) { return logout(token); },
  me: function (p, me) { return publicUser(me, me); },
  changePin: function (p, me) { return changePin(p, me); },
  bootstrap: function (p, me) { return bootstrap(me); },

  listBooks: function (p, me) { return listBooks(me); },
  saveBook: function (p, me) { return saveBook(p, me); },
  deleteBook: function (p, me) { return deleteBook(p, me); },
  upsertBooks: function (p, me) { return upsertBooks(p, me); },

  listSales: function (p, me) { return listSales(me); },
  addSale: function (p, me) { return addSale(p, me); },
  updateSale: function (p, me) { return updateSale(p, me); },
  deleteSale: function (p, me) { return deleteSale(p, me); },
  uploadSales: function (p, me) { return uploadSales(p, me); },

  listUsers: function (p, me) { return listUsers(me); },
  saveUser: function (p, me) { return saveUser(p, me); },
  deleteUser: function (p, me) { return deleteUser(p, me); },

  dashboard: function (p, me) { return dashboard(p, me); },
  leaderboard: function (p, me) { return leaderboard(p, me); },
  setConfig: function (p, me) { return setConfig(p, me); }
};

/** A browser visiting the URL directly gets a small health check. */
function doGet() {
  return jsonOut({ ok: true, data: { app: 'Book Marathon API', time: new Date().toISOString() } });
}

function doPost(e) {
  var out;
  try {
    var req = parseRequest(e);
    out = { ok: true, data: route(req) };
  } catch (err) {
    out = toErrorResponse(err);
  }
  return jsonOut(out);
}

function parseRequest(e) {
  var body = e && e.postData && e.postData.contents;
  if (!body) throw new AppError('Empty request.', 'VALIDATION');
  var req;
  try { req = JSON.parse(body); } catch (x) { throw new AppError('Request is not valid JSON.', 'VALIDATION'); }
  if (!req || typeof req.action !== 'string') throw new AppError('Missing "action".', 'VALIDATION');
  req.payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
  return req;
}

function route(req) {
  resetMemo(); // each request starts with an empty in-memory cache
  if (PUBLIC_ACTIONS.hasOwnProperty(req.action)) return PUBLIC_ACTIONS[req.action](req.payload);
  if (!PRIVATE_ACTIONS.hasOwnProperty(req.action)) throw new AppError('Unknown action "' + req.action + '".', 'VALIDATION');
  var me = requireSession(req.token); // throws AUTH if the token is missing/expired or the user was disabled
  return PRIVATE_ACTIONS[req.action](req.payload, me, req.token);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Errors meant for the user (wrong PIN, not enough stock...) carry a code; anything else is a bug. */
function AppError(message, code) {
  this.message = message;
  this.code = code || 'VALIDATION';
  this.isAppError = true;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.name = 'AppError';

function toErrorResponse(err) {
  if (err && err.isAppError) return { ok: false, error: err.message, code: err.code };
  // Unexpected error: log details for the owner, show a short message to the user.
  console.error(err && err.stack ? err.stack : err);
  return { ok: false, error: 'Something went wrong on the server: ' + (err && err.message ? err.message : err), code: 'SERVER' };
}

/** Everything a freshly logged-in screen needs, in one round-trip (Apps Script calls take ~1–2 s each). */
function bootstrap(me) {
  var books = listBooks(me);
  var s = listSales(me);
  return {
    me: publicUser(me, me),
    config: publicConfig(),
    books: books,
    users: listUsers(me),
    sales: s.sales,
    areas: s.areas
  };
}
