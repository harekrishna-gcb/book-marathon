/**
 * Setup.gs — run these from the Apps Script editor (choose the function, press ▶ Run).
 *
 *   setup()  creates the sheets, headers and the first admin. Safe to run again:
 *            it only adds what is missing and never deletes data.
 *   seed()   adds sample books, users and sales so you can try the app.
 *            Only runs while the Books sheet is empty.
 */

// ⚠️ EDIT THESE THREE LINES before running setup(). Change the PIN after your first login.
var ADMIN_NAME = 'Admin';
var ADMIN_PHONE = '9000000000';
var ADMIN_PIN = '1234';

var SHEET_ORDER = ['Users', 'Books', 'Sales', 'Config'];

function setup() {
  var ss = getSpreadsheet();
  SHEET_ORDER.forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var wanted = Object.keys(SCHEMA[name]);
    var lastCol = sh.getLastColumn();
    var have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }).filter(String) : [];
    var missing = wanted.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    var headers = have.concat(missing);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    // Text columns as plain text so phone numbers keep leading 0/+ and dates aren't auto-converted.
    headers.forEach(function (h, i) {
      var type = SCHEMA[name][h];
      if (type === 's' || type === 'd') sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });

  // Remove the empty default sheet that new spreadsheets come with.
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  // Default config values.
  var cfg = readSheetObjects('Config');
  var toAdd = Object.keys(CONFIG_DEFAULTS)
    .filter(function (k) { return !cfg.some(function (r) { return r.key === k; }); })
    .map(function (k) { return { key: k, value: CONFIG_DEFAULTS[k] }; });
  appendObjects('Config', toAdd);

  getPepper(); // creates the secret used for PIN hashing

  // First admin.
  var users = readSheetObjects('Users');
  if (!users.some(function (u) { return u.role === 'admin' && u.approved; })) {
    assertPinFormat(ADMIN_PIN);
    appendObjects('Users', [{
      id: newId('u'), name: ADMIN_NAME, type: 'Person', phone: ADMIN_PHONE, members: '', role: 'admin',
      pin_hash: makePinHash(ADMIN_PIN), approved: true, created_at: new Date().toISOString(), team_id: ''
    }]);
    console.log('Admin created. Log in with phone ' + ADMIN_PHONE + ' and PIN ' + ADMIN_PIN + ', then change the PIN.');
  } else {
    console.log('An admin already exists, so no new admin was created.');
  }
  SHEET_ORDER.forEach(markChanged);
  console.log('Setup finished. Sheets: ' + SHEET_ORDER.join(', '));
}

/** Sample data. Every sample user has PIN 1111. */
function seed() {
  if (readSheetObjects('Books').length) {
    console.log('Books sheet is not empty, so seed() did nothing. (It only runs on an empty sheet.)');
    return;
  }
  var now = new Date().toISOString();
  var sample = [
    ['Bhagavad-gītā As It Is', 'Big books', 350, 120],
    ['Śrīmad-Bhāgavatam, Canto 1', 'Big books', 400, 40],
    ['Kṛṣṇa, the Supreme Personality of Godhead', 'Big books', 450, 30],
    ['The Nectar of Devotion', 'Medium books', 200, 25],
    ['Teachings of Lord Caitanya', 'Medium books', 150, 20],
    ['The Science of Self-Realization', 'Medium books', 120, 60],
    ['Perfect Questions, Perfect Answers', 'Small books', 40, 100],
    ['Beyond Birth and Death', 'Small books', 30, 100],
    ['Easy Journey to Other Planets', 'Small books', 30, 8],
    ['Chant and Be Happy', 'Small books', 50, 50]
  ];
  var books = sample.map(function (b) { return { id: newId('b'), title: b[0], category: b[1], price: b[2], quantity_received: b[3], updated_at: now }; });

  var pin = makePinHash('1111');
  var team = { id: newId('u'), name: 'Hyderabad Sankirtan Team', type: 'Team', phone: '9000000001', members: 'Gopal, Radha', role: 'lead', pin_hash: pin, approved: true, created_at: now, team_id: '' };
  var gopal = { id: newId('u'), name: 'Gopal', type: 'Person', phone: '9000000002', members: '', role: 'seller', pin_hash: pin, approved: true, created_at: now, team_id: team.id };
  var radha = { id: newId('u'), name: 'Radha', type: 'Person', phone: '9000000003', members: '', role: 'seller', pin_hash: pin, approved: true, created_at: now, team_id: team.id };
  var madhav = { id: newId('u'), name: 'Madhav', type: 'Person', phone: '9000000004', members: '', role: 'seller', pin_hash: pin, approved: true, created_at: now, team_id: '' };
  var pending = { id: newId('u'), name: 'Keshav (waiting for approval)', type: 'Person', phone: '9000000005', members: '', role: 'seller', pin_hash: pin, approved: false, created_at: now, team_id: '' };
  var sellers = [team, gopal, radha, madhav];

  var areas = ['Banjara Hills', 'Ameerpet', 'Secunderabad', 'Kukatpally', 'Gachibowli'];
  var base = new Date();
  var sales = [];
  for (var i = 0; i < 24; i++) {
    var d = new Date(base.getTime() - (i % 7) * 864e5);
    sales.push({
      id: newId('s'), book_id: books[(i * 3) % books.length].id, quantity: 1 + (i % 4),
      user_id: sellers[i % sellers.length].id, area: areas[i % areas.length],
      sale_date: Utilities.formatDate(d, getSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
      created_at: now, created_by: 'seed'
    });
  }
  withLock(function () {
    appendObjects('Books', books);
    appendObjects('Users', [team, gopal, radha, madhav, pending]);
    appendObjects('Sales', sales);
    ['Books', 'Users', 'Sales'].forEach(markChanged);
  });
  console.log('Seeded ' + books.length + ' books, 5 users (PIN 1111 for all) and ' + sales.length + ' sales.');
}

/**
 * Forgot the admin PIN? Put the admin's phone in ADMIN_PHONE and a new PIN in ADMIN_PIN
 * above, then run this. It also re-approves that user and makes them admin.
 */
function resetAdminPin() {
  assertPinFormat(ADMIN_PIN);
  withLock(function () {
    var users = readTable('Users', true);
    var u = users.filter(function (x) { return x.phone && normPhone(x.phone) === normPhone(ADMIN_PHONE); })[0];
    if (!u) throw new Error('No user with phone ' + ADMIN_PHONE + ' in the Users sheet.');
    u.pin_hash = makePinHash(ADMIN_PIN);
    u.role = 'admin';
    u.approved = true;
    updateObjects('Users', [u]);
    markChanged('Users');
    CacheService.getScriptCache().remove('fail:' + normPhone(ADMIN_PHONE));
    console.log('PIN reset for ' + u.name + '. Log in with phone ' + ADMIN_PHONE + ' and the new PIN.');
  });
}
