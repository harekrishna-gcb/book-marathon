/**
 * Auth.gs — PINs, sessions and role checks.
 *
 *  - PINs are 4–6 digits. Only "salt$hash" is stored: a random per-user salt and a
 *    SHA-256 hash stretched over many rounds, mixed with a secret "pepper" kept in
 *    Script Properties (not in the sheet).
 *  - A successful login creates a random session token kept in CacheService for
 *    6 hours (CacheService's maximum). The user's role and approval are re-read on
 *    EVERY request, so disabling someone takes effect within seconds.
 *  - 5 wrong PINs for the same phone/name lock that login for 15 minutes.
 */

var SESSION_SECONDS = 6 * 60 * 60;
var HASH_ROUNDS = 300;
var MAX_FAILS = 5;
var FAIL_WINDOW_SECONDS = 15 * 60;
var ROLES = ['admin', 'lead', 'seller'];

function bytesToHex(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function sha256Hex(s) {
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

function getPepper() {
  var props = PropertiesService.getScriptProperties();
  var p = props.getProperty('PIN_PEPPER');
  if (!p) { p = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('PIN_PEPPER', p); }
  return p;
}

function hashPin(pin, salt) {
  var pepper = getPepper();
  var h = sha256Hex(salt + ':' + pin + ':' + pepper);
  for (var i = 0; i < HASH_ROUNDS; i++) h = sha256Hex(h + salt);
  return h;
}

function makePinHash(pin) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  return salt + '$' + hashPin(pin, salt);
}

function verifyPin(pin, stored) {
  if (!stored || stored.indexOf('$') < 0) return false;
  var parts = stored.split('$');
  var expected = parts[1], actual = hashPin(String(pin), parts[0]);
  if (expected.length !== actual.length) return false;
  var diff = 0; // constant-time compare
  for (var i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function assertPinFormat(pin) {
  if (!/^\d{4,6}$/.test(String(pin === null || pin === undefined ? '' : pin))) throw new AppError('PIN must be 4 to 6 digits.');
}

/** Finds a user by phone number or by name (case-insensitive). */
function findUserByLoginId(users, id) {
  var raw = String(id === null || id === undefined ? '' : id).trim();
  if (!raw) return null;
  var phone = normPhone(raw);
  if (phone.length >= 7 && /^[\d\s+\-()]+$/.test(raw)) {
    return users.filter(function (u) { return u.phone && normPhone(u.phone) === phone; })[0] || null;
  }
  var byName = users.filter(function (u) { return normTitle(u.name) === normTitle(raw); });
  if (byName.length > 1) throw new AppError('More than one user has that name. Please log in with your phone number.');
  return byName[0] || null;
}

function login(p) {
  var id = String(p.id === null || p.id === undefined ? '' : p.id).trim();
  var pin = String(p.pin === null || p.pin === undefined ? '' : p.pin).trim();
  if (!id || !pin) throw new AppError('Enter your phone number (or name) and PIN.');
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + (normPhone(id).length >= 7 ? normPhone(id) : normTitle(id));
  var fails = Number(cache.get(failKey)) || 0;
  if (fails >= MAX_FAILS) throw new AppError('Too many wrong PINs. Please wait 15 minutes and try again.', 'FORBIDDEN');

  var user = findUserByLoginId(readTable('Users'), id);
  if (!user || !verifyPin(pin, user.pin_hash)) {
    cache.put(failKey, String(fails + 1), FAIL_WINDOW_SECONDS);
    throw new AppError('Phone/name or PIN is not correct.', 'AUTH');
  }
  cache.remove(failKey);
  if (!user.approved) throw new AppError('Your registration is waiting for an admin to approve it.', 'FORBIDDEN');
  if (ROLES.indexOf(user.role) < 0) throw new AppError('Your account has no role yet. Ask an admin.', 'FORBIDDEN');

  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess:' + token, user.id, SESSION_SECONDS);
  return { token: token, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(), me: publicUser(user, user) };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess:' + token);
  return { loggedOut: true };
}

/** Returns the logged-in user (fresh from the sheet) or throws AUTH. */
function requireSession(token) {
  if (!token || typeof token !== 'string') throw new AppError('Please log in.', 'AUTH');
  var userId = CacheService.getScriptCache().get('sess:' + token);
  if (!userId) throw new AppError('Your session has expired. Please log in again.', 'AUTH');
  var user = readTable('Users').filter(function (u) { return u.id === userId; })[0];
  if (!user || !user.approved || ROLES.indexOf(user.role) < 0) {
    logout(token);
    throw new AppError('Your account is no longer active. Ask an admin.', 'AUTH');
  }
  return user;
}

function requireRole(me, roles) {
  if (roles.indexOf(me.role) < 0) throw new AppError('You do not have permission to do that.', 'FORBIDDEN');
}

function changePin(p, me) {
  assertPinFormat(p.newPin);
  return withLock(function () {
    var users = readTable('Users', true);
    var u = users.filter(function (x) { return x.id === me.id; })[0];
    if (!u || !verifyPin(String(p.oldPin || ''), u.pin_hash)) throw new AppError('Your current PIN is not correct.');
    u.pin_hash = makePinHash(String(p.newPin));
    updateObjects('Users', [u]);
    markChanged('Users');
    return { changed: true };
  });
}

/* ---------- Teams and visibility ---------- */

/** The team a user belongs to: a Team row is its own team; a Person uses team_id. */
function teamIdOf(u) { return u ? (u.type === 'Team' ? u.id : (u.team_id || '')) : ''; }

/** Ids of users whose sales `me` may see and edit. */
function manageableUserIds(me, users) {
  var ids = {};
  if (me.role === 'admin') { users.forEach(function (u) { ids[u.id] = true; }); return ids; }
  ids[me.id] = true;
  if (me.role === 'lead') {
    var t = teamIdOf(me);
    if (t) users.forEach(function (u) { if (teamIdOf(u) === t) ids[u.id] = true; });
  }
  return ids;
}

/** What other people may see about a user. Phone numbers only for admins, the user, and their lead. */
function publicUser(u, viewer, soldCount) {
  var showContact = viewer.role === 'admin' || viewer.id === u.id ||
    (viewer.role === 'lead' && teamIdOf(viewer) && teamIdOf(viewer) === teamIdOf(u));
  var o = {
    id: u.id, name: u.name, type: u.type, members: u.members, role: u.role,
    approved: u.approved, team_id: u.team_id || '', has_pin: !!u.pin_hash, created_at: u.created_at
  };
  if (showContact) o.phone = u.phone;
  if (soldCount !== undefined) o.sold = soldCount;
  return o;
}
