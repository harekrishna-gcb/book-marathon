/**
 * Users.gs — registration, user/team management.
 *
 * - Anyone can register (name, phone, PIN, Person/Team). They start unapproved.
 * - Admin: approve, edit anyone, set roles and teams, reset PINs, delete.
 * - Lead: add/edit/approve sellers in their own team, remove them from the team.
 */

var MAX_REGISTRATIONS_PER_10_MIN = 30;

function soldByUser(sales) {
  var m = {};
  sales.forEach(function (s) { m[s.user_id] = (m[s.user_id] || 0) + (Number(s.quantity) || 0); });
  return m;
}

/** Admin sees everyone. Others see approved users, plus (for leads) pending members of their team. */
function listUsers(me) {
  var users = readTable('Users'), sold = soldByUser(readTable('Sales'));
  var myTeam = teamIdOf(me);
  return users
    .filter(function (u) {
      if (me.role === 'admin' || u.approved || u.id === me.id) return true;
      return me.role === 'lead' && myTeam && teamIdOf(u) === myTeam;
    })
    .map(function (u) { return publicUser(u, me, sold[u.id] || 0); })
    .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
}

function cleanName(v) {
  var n = String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ');
  if (!n) throw new AppError('Name is required.');
  if (n.length > 100) throw new AppError('Name is too long (100 characters max).');
  if (/^[\d\s+\-()]+$/.test(n)) throw new AppError('Name cannot be only numbers (that is used for phone login).');
  return n;
}

function cleanPhone(v, required) {
  var raw = String(v === null || v === undefined ? '' : v).trim();
  if (!raw) { if (required) throw new AppError('Phone number is required.'); return ''; }
  var d = normPhone(raw);
  if (d.length < 10 || d.length > 13) throw new AppError('Phone number should have 10 digits.');
  return raw.replace(/[^\d+]/g, '');
}

function assertUnique(users, selfId, name, phone) {
  users.forEach(function (u) {
    if (u.id === selfId) return;
    if (normTitle(u.name) === normTitle(name)) throw new AppError('Someone is already registered as “' + u.name + '”. Please add a surname or team name.');
    if (phone && u.phone && normPhone(u.phone) === normPhone(phone)) throw new AppError('That phone number is already registered.');
  });
}

/** Public self-registration. The account is unusable until an admin approves it. */
function registerUser(p) {
  var name = cleanName(p.name);
  var phone = cleanPhone(p.phone, true);
  assertPinFormat(p.pin);
  var type = p.type === 'Team' ? 'Team' : 'Person';
  var members = String(p.members || '').trim().slice(0, 500);

  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('reg:count')) || 0;
  if (count >= MAX_REGISTRATIONS_PER_10_MIN) throw new AppError('Too many registrations right now. Please try again in a few minutes.', 'BUSY');
  cache.put('reg:count', String(count + 1), 600);

  return withLock(function () {
    var users = readTable('Users', true);
    // A seller created automatically by a sales upload (no phone, no PIN) can claim that record.
    var placeholder = users.filter(function (u) { return normTitle(u.name) === normTitle(name) && !u.pin_hash && !u.phone; })[0];
    assertUnique(users, placeholder ? placeholder.id : null, name, phone);
    var pinHash = makePinHash(String(p.pin));
    if (placeholder) {
      placeholder.name = name; placeholder.phone = phone; placeholder.pin_hash = pinHash;
      placeholder.type = type; placeholder.members = members; placeholder.approved = false;
      updateObjects('Users', [placeholder]);
    } else {
      appendObjects('Users', [{ id: newId('u'), name: name, type: type, phone: phone, members: members, role: 'seller', pin_hash: pinHash, approved: false, created_at: new Date().toISOString(), team_id: '' }]);
    }
    markChanged('Users');
    return { registered: true, message: 'Thank you, ' + name + '! An admin will approve your registration soon. Then you can log in with your phone number and PIN.' };
  });
}

/** Create (no id) or edit (id) a user. Admins can change everything; leads only their own team's sellers. */
function saveUser(p, me) {
  requireRole(me, ['admin', 'lead']);
  return withLock(function () {
    var users = readTable('Users', true);
    var byId = {};
    users.forEach(function (u) { byId[u.id] = u; });
    var existing = p.id ? byId[p.id] : null;
    if (p.id && !existing) throw new AppError('That user no longer exists.', 'NOT_FOUND');
    var u = existing || { id: newId('u'), created_at: new Date().toISOString(), pin_hash: '', team_id: '', members: '', phone: '', role: 'seller', type: 'Person', approved: true };

    if (me.role === 'lead') applyLeadEdit(u, p, me, existing);
    else applyAdminEdit(u, p, me, byId);

    if (p.pin) { assertPinFormat(p.pin); u.pin_hash = makePinHash(String(p.pin)); }
    assertUnique(users, u.id, u.name, u.phone);

    if (existing) updateObjects('Users', [u]); else appendObjects('Users', [u]);
    markChanged('Users');
    return listUsers(me);
  });
}

function applyAdminEdit(u, p, me, byId) {
  if (p.name !== undefined || !u.name) u.name = cleanName(p.name);
  if (p.phone !== undefined) u.phone = cleanPhone(p.phone, false);
  if (p.type !== undefined) u.type = p.type === 'Team' ? 'Team' : 'Person';
  if (p.members !== undefined) u.members = String(p.members).trim().slice(0, 500);
  if (p.role !== undefined) {
    if (ROLES.indexOf(p.role) < 0) throw new AppError('Role must be admin, lead or seller.');
    if (u.id === me.id && p.role !== 'admin') throw new AppError('You cannot remove your own admin role.');
    u.role = p.role;
  }
  if (p.approved !== undefined) {
    if (u.id === me.id && !p.approved) throw new AppError('You cannot un-approve yourself.');
    u.approved = !!p.approved;
  }
  if (p.team_id !== undefined) {
    var t = String(p.team_id || '');
    if (t && (!byId[t] || byId[t].type !== 'Team')) throw new AppError('Choose an existing team.');
    if (t === u.id) t = '';
    u.team_id = u.type === 'Team' ? '' : t;
  }
  if (u.type === 'Team') u.team_id = '';
}

function applyLeadEdit(u, p, me, existing) {
  var myTeam = teamIdOf(me);
  if (!myTeam) throw new AppError('You are not part of a team yet. Ask an admin to set your team.', 'FORBIDDEN');
  if (existing && existing.id === me.id) {
    // A lead may update their own contact details and member list, nothing else.
    if (p.name !== undefined) u.name = cleanName(p.name);
    if (p.phone !== undefined) u.phone = cleanPhone(p.phone, false);
    if (p.members !== undefined) u.members = String(p.members).trim().slice(0, 500);
    if (p.pin) throw new AppError('Use “Change my PIN” to change your own PIN.');
    return;
  }
  if (existing && (teamIdOf(existing) !== myTeam || existing.role !== 'seller' || existing.type === 'Team')) {
    throw new AppError('You can only manage sellers in your own team.', 'FORBIDDEN');
  }
  if (p.name !== undefined || !u.name) u.name = cleanName(p.name);
  if (p.phone !== undefined) u.phone = cleanPhone(p.phone, false);
  if (p.members !== undefined) u.members = String(p.members).trim().slice(0, 500);
  if (p.approved !== undefined) u.approved = !!p.approved;
  u.type = 'Person';
  u.role = 'seller';
  // Lead can add people to the team or remove them from it — not move them to another team.
  u.team_id = existing && p.team_id === '' ? '' : myTeam;
}

/** Admin only. Deletes the user and their sales (same as the prototype). Members of a deleted team are kept, without a team. */
function deleteUser(p, me) {
  requireRole(me, ['admin']);
  if (p.id === me.id) throw new AppError('You cannot delete yourself.');
  return withLock(function () {
    var users = readTable('Users', true);
    var u = users.filter(function (x) { return x.id === p.id; })[0];
    if (!u) throw new AppError('That user no longer exists.', 'NOT_FOUND');
    var saleRows = readTable('Sales', true).filter(function (s) { return s.user_id === u.id; }).map(function (s) { return s._row; });
    var members = users.filter(function (x) { return x.team_id === u.id; });
    members.forEach(function (m) { m.team_id = ''; });
    updateObjects('Users', members);
    deleteRowNumbers('Sales', saleRows);
    deleteRowNumbers('Users', [u._row]);
    markChanged('Sales');
    markChanged('Users');
    return { users: listUsers(me), deletedSales: saleRows.length };
  });
}
