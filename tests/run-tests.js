#!/usr/bin/env gjs
/*
 * Runs the real Apps Script code (apps-script/*.gs) and the frontend upload parser
 * (frontend/src/lib/parse.js, plan.js) against the in-memory mock in gas-mock.js.
 *
 *   gjs -m tests/run-tests.js        (from the project folder)
 *
 * Covers: stock calculation, overselling prevention (including stale caches),
 * roles/permissions, uploads (books + sales, chunk limits, row reporting),
 * PIN hashing/login throttling, formula-injection safety, reports.
 */
import GLib from 'gi://GLib';
import System from 'system';
import * as BMParse from '../frontend/src/lib/parse.js';
import * as Plan from '../frontend/src/lib/plan.js';

const here = GLib.path_get_dirname(GLib.canonicalize_filename(import.meta.url.replace('file://', ''), null));
const rootDir = GLib.path_get_dirname(here);
const read = p => new TextDecoder().decode(GLib.file_get_contents(GLib.build_filenamev([rootDir, p]))[1]);

globalThis.__sha256Hex = s => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, s, -1);
globalThis.__uuid = () => GLib.uuid_string_random();

(0, eval)(read('tests/gas-mock.js'));
for (const f of ['Code', 'Data', 'Auth', 'Logic', 'Books', 'Sales', 'Users', 'Reports', 'Setup', 'Tests']) {
  (0, eval)(read(`apps-script/${f}.gs`));
}

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) passed++;
  else { failed++; print(`  ✗ ${name}${extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''}`); }
}
function section(t) { print(`\n▶ ${t}`); }
function api(action, payload, token) {
  const res = doPost({ postData: { contents: JSON.stringify({ action, payload: payload || {}, token }) } });
  return JSON.parse(res.getContent());
}
function must(action, payload, token) {
  const r = api(action, payload, token);
  if (!r.ok) throw new Error(`${action} failed: ${r.error}`);
  return r.data;
}
function freshStart() {
  SpreadsheetApp._reset(); CacheService._clear();
  ADMIN_PHONE = '9000000000'; ADMIN_PIN = '1234';
  setup();
  return must('login', { id: '9000000000', pin: '1234' }).token;
}

// ---------------------------------------------------------------------------
section('In-editor self tests (Tests.gs runTests)');
{
  const r = runTests();
  ok(r.failed.length === 0, 'runTests() has no failures', r.failed);
  print(`  runTests: ${r.passed} passed`);
}

section('Setup');
let admin = freshStart();
{
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ok(['Users', 'Books', 'Sales', 'Config'].every(n => ss.getSheetByName(n)), 'all sheets created');
  ok(!ss.getSheetByName('Sheet1'), 'empty Sheet1 removed');
  ok(JSON.stringify(ss.getSheetByName('Sales').data[0]) === JSON.stringify(['id', 'book_id', 'quantity', 'user_id', 'area', 'sale_date', 'created_at', 'created_by']), 'Sales headers');
  setup(); // second run must not duplicate the admin
  ok(readSheetObjects('Users').filter(u => u.role === 'admin').length === 1, 'setup() is safe to re-run');
  const u = readSheetObjects('Users')[0];
  ok(u.pin_hash && u.pin_hash.indexOf('1234') < 0 && u.pin_hash.includes('$'), 'PIN stored only as salt$hash');
}

section('Login, sessions, throttling');
{
  ok(api('login', { id: '9000000000', pin: '9999' }).code === 'AUTH', 'wrong PIN rejected');
  ok(api('login', { id: '+91 90000 00000', pin: '1234' }).ok, 'phone with +91 and spaces works');
  ok(api('login', { id: 'admin', pin: '1234' }).ok, 'username (case-insensitive) works');
  ok(api('listBooks', {}).code === 'AUTH', 'no token -> AUTH');
  ok(api('listBooks', {}, 'garbage').code === 'AUTH', 'bad token -> AUTH');
  for (let i = 0; i < 5; i++) api('login', { id: 'Admin', pin: '0000' });
  const locked = api('login', { id: 'Admin', pin: '1234' });
  ok(!locked.ok && /Too many/.test(locked.error), 'locked after 5 wrong PINs', locked);
  clearDailyFailures(readSheetObjects('Users').find(u => u.role === 'admin').id);
  const t = must('login', { id: 'Admin', pin: '1234' }).token;
  must('logout', {}, t);
  ok(api('me', {}, t).code === 'AUTH', 'token dead after logout');
  ok(api('unknownThing', {}, admin).error.includes('Unknown action'), 'unknown action rejected');
  ok(api('', {}).ok === false, 'missing action rejected');
  const bad = JSON.parse(doPost({ postData: { contents: '{not json' } }).getContent());
  ok(!bad.ok && bad.code === 'VALIDATION', 'invalid JSON body handled');
}

section('Registration and approval');
let gopalId, teamId;
{
  const r = api('register', { name: 'Gopal', phone: '09876543210', pin: '4321', type: 'Person' });
  ok(r.ok, 'register works', r);
  ok(api('register', { name: 'gopal', phone: '9000011111', pin: '4321' }).error.includes('already registered as'), 'duplicate name rejected');
  ok(api('register', { name: 'Other', phone: '+919876543210', pin: '4321' }).error.includes('phone number is already'), 'duplicate phone rejected (different format)');
  ok(api('register', { name: 'X', phone: '123', pin: '4321' }).error.includes('10 digits'), 'short phone rejected');
  ok(api('register', { name: 'Y', phone: '9000022222', pin: '12' }).error.includes('4 to 6'), 'short PIN rejected');
  ok(api('register', { name: '12345', phone: '9000022223', pin: '1234' }).error.includes('only numbers'), 'numeric name rejected');
  const pend = api('login', { id: '9876543210', pin: '4321' });
  ok(pend.code === 'FORBIDDEN' && /approve/.test(pend.error), 'pending user cannot log in', pend);
  const users = must('listUsers', {}, admin);
  const g = users.find(u => u.name === 'Gopal');
  gopalId = g.id;
  ok(g.phone === '09876543210', 'phone keeps leading 0');
  ok(g.approved === false && g.role === 'seller', 'registered as unapproved seller');
  const teamUsers = must('saveUser', { name: 'Hyd Team', type: 'Team', phone: '9111111111', role: 'lead', pin: '5555', approved: true }, admin);
  teamId = teamUsers.find(u => u.name === 'Hyd Team').id;
  must('saveUser', { id: gopalId, approved: true, team_id: teamId }, admin);
  ok(api('login', { id: '9876543210', pin: '4321' }).ok, 'approved user can log in');
  ok(api('saveUser', { id: readSheetObjects('Users')[0].id, role: 'seller' }, admin).error.includes('own admin role'), 'admin cannot demote self');
}

section('Books: add, edit, permissions, formula safety');
let gopal = must('login', { id: 'Gopal', pin: '4321' }).token;
let lead = must('login', { id: '9111111111', pin: '5555' }).token;
{
  let books = must('saveBook', { title: 'Bhagavad-gītā As It Is', category: 'Big books', price: 350, quantity: 10 }, admin);
  ok(books.length === 1 && books[0].available === 10 && books[0].low === false, 'book added with 10 available');
  books = must('saveBook', { title: '  bhagavad-GĪTĀ as it is ', price: 300 }, admin);
  ok(books.length === 1 && books[0].price === 300 && books[0].quantity_received === 10, 'same title (any case) updates, blank qty kept');
  ok(api('saveBook', { title: 'Hack', price: 1, quantity: 1 }, gopal).code === 'FORBIDDEN', 'seller cannot add books');
  ok(api('saveBook', { title: 'Hack', price: 1, quantity: 1 }, lead).code === 'FORBIDDEN', 'lead cannot add books');
  ok(api('saveBook', { title: '', price: 1 }, admin).error.includes('Title'), 'title required');
  ok(api('saveBook', { title: 'Z', price: -5 }, admin).error.includes('Price'), 'negative price rejected');
  books = must('saveBook', { title: '=HYPERLINK("http://evil","x")', category: '+cmd', price: 10, quantity: 3 }, admin);
  const evil = books.find(b => b.title.startsWith('='));
  ok(evil && evil.title === '=HYPERLINK("http://evil","x")' && evil.category === '+cmd', 'formula-like text stored as plain text', evil);
  const raw = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Books').data.flat();
  ok(!raw.some(v => v && v.formula), 'no formulas in the sheet');
  must('deleteBook', { id: evil.id }, admin);
  books = must('saveBook', { title: 'Chant and Be Happy', category: 'Small books', price: 50, quantity: 3 }, admin);
  ok(books.find(b => b.title === 'Chant and Be Happy').low === true, '3 left is shown as low (≤5)');
  const gita = books.find(b => b.title.toLowerCase().startsWith('bhagavad'));
  const other = must('saveBook', { title: 'Other', price: 1, quantity: 1 }, admin).find(b => b.title === 'Other');
  ok(api('saveBook', { id: other.id, title: 'Chant and be happy' }, admin).error.includes('already called'), 'renaming onto an existing title rejected');
  must('deleteBook', { id: other.id }, admin);
  ok(gita.quantity_received === 10, 'gita still 10');
}

section('Sales: stock and overselling');
const bookBy = t => must('listBooks', {}, admin).find(b => b.title.toLowerCase().startsWith(t.toLowerCase()));
{
  const chant = bookBy('Chant');
  let r = must('addSale', { book_id: chant.id, quantity: 2, user_id: gopalId, area: 'Ameerpet', sale_date: '2026-11-20' }, gopal);
  ok(r.books.find(b => b.id === chant.id).available === 1, 'available drops to 1');
  ok(r.sales.length === 1 && r.sales[0].amount === 100, 'sale returned with amount ₹100');
  const over = api('addSale', { book_id: chant.id, quantity: 2, user_id: gopalId }, gopal);
  ok(!over.ok && over.error === 'Only 1 copy of “Chant and Be Happy” is left.', 'overselling rejected with clear message', over);

  // Stale-cache race: admin's read is cached, then Gopal sells the last copy; admin's sale must still be refused.
  must('listBooks', {}, admin); // warms cache with available = 1
  must('addSale', { book_id: chant.id, quantity: 1, user_id: gopalId }, gopal);
  resetMemo();
  const race = api('addSale', { book_id: chant.id, quantity: 1, user_id: gopalId }, admin);
  ok(!race.ok && race.error.includes('out of stock'), 'second buyer of the last copy is refused even with a warm cache', race);
  ok(bookBy('Chant').available === 0, 'available is exactly 0, never negative');

  ok(api('addSale', { book_id: chant.id, quantity: 0, user_id: gopalId }, gopal).error.includes('at least 1'), 'zero quantity rejected');
  ok(api('addSale', { book_id: chant.id, quantity: 1.5, user_id: gopalId }, gopal).error.includes('whole number'), 'fractional quantity rejected');
  ok(api('addSale', { book_id: 'nope', quantity: 1, user_id: gopalId }, gopal).error.includes('Choose a book'), 'unknown book rejected');
  ok(api('addSale', { book_id: chant.id, quantity: 1, sale_date: '31/02/2026' }, gopal).error.includes('not a valid date'), 'invalid date rejected');

  // Editing: copies of the edited sale go back to the pool first.
  const gita = bookBy('Bhagavad');
  r = must('addSale', { book_id: gita.id, quantity: 4, area: 'Banjara Hills', sale_date: '2026-11-19' }, gopal);
  const sid = r.saleId;
  r = must('updateSale', { id: sid, book_id: gita.id, quantity: 10, user_id: gopalId, area: 'Banjara Hills', sale_date: '2026-11-19' }, gopal);
  ok(r.books.find(b => b.id === gita.id).available === 0, 'edit 4 → 10 allowed (all 10 copies)');
  ok(api('updateSale', { id: sid, book_id: gita.id, quantity: 11, user_id: gopalId }, gopal).error.includes('Only 10'), 'edit beyond stock rejected');
  must('updateSale', { id: sid, book_id: gita.id, quantity: 4, user_id: gopalId, area: 'Banjara Hills', sale_date: '2026-11-19' }, gopal);
  ok(bookBy('Bhagavad').available === 6, 'edit back to 4 → 6 available');
  { const l = must('listSales', {}, gopal).sales; ok(l.every((x, i) => i === 0 || l[i - 1].sale_date >= x.sale_date), 'sales log newest first', l.map(x => x.sale_date)); }
  ok(must('listSales', {}, gopal).areas.join('|') === 'Ameerpet|Banjara Hills', 'area list for autocomplete');
}

section('Roles: seller / lead / admin boundaries');
let radhaId, madhavId;
{
  // Lead adds a member to their team; another person is outside the team.
  let us = must('saveUser', { name: 'Radha', phone: '9222222222', pin: '1111' }, lead);
  const radha = us.find(u => u.name === 'Radha');
  radhaId = radha.id;
  ok(radha && radha.team_id === teamId && radha.role === 'seller' && radha.approved, 'lead-added member is an approved seller in the lead\'s team');
  us = must('saveUser', { name: 'Madhav', phone: '9333333333', pin: '1111', role: 'admin' }, admin);
  madhavId = us.find(u => u.name === 'Madhav').id;
  ok(us.find(u => u.name === 'Madhav').role === 'admin', 'admin can set roles');
  must('saveUser', { id: madhavId, role: 'seller' }, admin);
  const madhav = must('login', { id: 'Madhav', pin: '1111' }).token;
  const radhaT = must('login', { id: 'Radha', pin: '1111' }).token;

  const gita = bookBy('Bhagavad');
  ok(api('addSale', { book_id: gita.id, quantity: 1, user_id: radhaId }, gopal).error === 'You can only record your own sales.', 'seller cannot record a sale for someone else');
  ok(api('addSale', { book_id: gita.id, quantity: 1, user_id: madhavId }, lead).error.includes('own team'), 'lead cannot record for someone outside the team');
  must('addSale', { book_id: gita.id, quantity: 1, user_id: radhaId, area: 'Kukatpally' }, lead);
  must('addSale', { book_id: gita.id, quantity: 1, area: 'Gachibowli' }, madhav);

  const leadSales = must('listSales', {}, lead).sales;
  ok(leadSales.every(s => [teamId, gopalId, radhaId].includes(s.user_id)) && leadSales.length === 4, 'lead sees only own team\'s sales', leadSales.map(s => s.user_name));
  ok(must('listSales', {}, radhaT).sales.length === 1, 'seller sees only own sales');
  ok(must('listSales', {}, admin).sales.length === 5, 'admin sees all sales');

  const madhavSale = must('listSales', {}, madhav).sales[0];
  ok(api('deleteSale', { id: madhavSale.id }, gopal).code === 'FORBIDDEN', 'seller cannot delete another\'s sale');
  ok(api('updateSale', { id: madhavSale.id, quantity: 1 }, lead).code === 'FORBIDDEN', 'lead cannot edit outside team');
  const radhaSale = must('listSales', {}, radhaT).sales[0];
  ok(api('updateSale', { id: radhaSale.id, book_id: gita.id, quantity: 2, user_id: radhaId }, lead).ok, 'lead can edit team member\'s sale');

  ok(api('saveUser', { id: madhavId, name: 'Hacked' }, lead).code === 'FORBIDDEN', 'lead cannot edit users outside the team');
  ok(api('saveUser', { name: 'Z', phone: '9444444444' }, gopal).code === 'FORBIDDEN', 'seller cannot add users');
  ok(api('deleteUser', { id: radhaId }, lead).code === 'FORBIDDEN', 'lead cannot delete users');
  ok(api('uploadSales', { rows: [{ row: 2 }] }, lead).code === 'FORBIDDEN', 'lead cannot upload sales');
  ok(api('setConfig', { low_stock_threshold: 9 }, gopal).code === 'FORBIDDEN', 'seller cannot change config');

  const seenBySeller = must('listUsers', {}, madhav);
  ok(seenBySeller.filter(u => u.id !== madhavId).every(u => u.phone === undefined), 'sellers do not see other people\'s phone numbers');
  ok(must('listUsers', {}, lead).find(u => u.id === radhaId).phone === '9222222222', 'lead sees own team phones');
  ok(must('listUsers', {}, lead).find(u => u.id === madhavId).phone === undefined, 'lead does not see other phones');
  ok(!JSON.stringify(must('listUsers', {}, admin)).includes('pin_hash'), 'pin hashes never leave the server');

  // Removing approval kills the session on the next request.
  must('saveUser', { id: madhavId, approved: false }, admin);
  resetMemo();
  ok(api('listBooks', {}, madhav).code === 'AUTH', 'un-approved user is logged out immediately');
  must('saveUser', { id: madhavId, approved: true }, admin);
  // Lead removes Radha from the team.
  must('saveUser', { id: radhaId, team_id: '' }, lead);
  ok(must('listUsers', {}, admin).find(u => u.id === radhaId).team_id === '', 'lead can remove a member from the team');
  must('saveUser', { id: radhaId, team_id: teamId }, admin);
  admin = must('login', { id: 'Admin', pin: '1234' }).token;
}

section('Upload parsing (frontend parse.js)');
{
  const P = BMParse;
  ok(P.toIsoDate(new Date(2026, 10, 5)) === '2026-11-05', 'Excel date cell (Date object)');
  ok(P.toIsoDate(46331) === '2026-11-05', 'Excel serial number 46331 → 2026-11-05', P.toIsoDate(46331));
  ok(P.toIsoDate('05/11/2026') === '2026-11-05', 'dd/mm/yyyy is day-first');
  ok(P.toIsoDate('2026-11-05') === '2026-11-05', 'yyyy-mm-dd');
  ok(P.toIsoDate('5 Nov 2026') === '2026-11-05', '"5 Nov 2026"', P.toIsoDate('5 Nov 2026'));
  ok(P.toIsoDate('') === '', 'blank stays blank (server uses today)');
  ok(P.toIsoDate('soon') === null, 'garbage → null (row reported invalid)');

  const b = P.normalizeBookRows([
    { ' Title ': 'Gita', CATEGORY: 'Big', 'Price (₹)': '350', Qty: 5 },
    { ' Title ': 'Chant', CATEGORY: '', 'Price (₹)': '', Qty: '' },
    { ' Title ': '', CATEGORY: 'x', 'Price (₹)': '', Qty: '' },
    { ' Title ': '   ', CATEGORY: '', 'Price (₹)': 'abc', Qty: '' },
    { ' Title ': '', CATEGORY: '', 'Price (₹)': '', Qty: '' }
  ]);
  ok(b.rows.length === 2 && b.rows[0].row === 2 && b.rows[1].row === 3, 'book rows numbered like the file (header = row 1)', b.rows);
  ok(b.rows[0].title === 'Gita' && b.rows[0].price === '350' && b.rows[0].quantity === 5, 'header variants mapped', b.rows[0]);
  ok(b.blank.join(',') === '4,5', 'empty-title rows listed as blank; fully empty rows ignored', b.blank);
  ok(P.normalizeBookRows([{ 'Book Name': 'x', Stock: 3 }]).rows[0].quantity === 3, '"Book Name" / "Stock" headers understood');
  ok(P.normalizeBookRows([{ Title: 'x', __rowNum__: 0 }].map(r => { const o = { Title: r.Title }; Object.defineProperty(o, '__rowNum__', { value: 9 }); return o; })).rows[0].row === 10, 'uses SheetJS __rowNum__ when present (blank lines in file)');
  ok(b.missingColumns.length === 0, 'no missing columns');
  ok(P.normalizeBookRows([{ Name: 'x' }]).missingColumns.join() === 'Price,Quantity', 'missing columns reported', P.normalizeBookRows([{ Name: 'x' }]).missingColumns);

  const s = P.normalizeSalesRows([
    { Book: 'Gita', Qty: 2, 'Sold By': 'Gopal', Area: 'Ameerpet', Date: new Date(2026, 10, 1) },
    { Book: 'Chant', Qty: '1', 'Sold By': 'New Person', Area: 'X', Date: 'nonsense' },
    { Book: 'Chant', Qty: '1', 'Sold By': 'New Person', Area: 'X', Date: '' },
    { Book: '', Qty: '', 'Sold By': '', Area: '', Date: '' }
  ]);
  ok(s.rows.length === 2 && s.rows[0].date === '2026-11-01' && s.rows[0].soldBy === 'Gopal' && s.rows[0].quantity === 2, 'sales row mapped', s.rows);
  ok(s.rows[1].row === 4 && s.rows[1].date === '', 'blank date passed through for server default');
  ok(s.invalid.length === 1 && s.invalid[0].row === 3 && /date/i.test(s.invalid[0].reason), 'bad date caught in browser with row number', s.invalid);
  ok(P.normalizeSalesRows([{ Title: 'x', Seller: 'y' }]).missingColumns.join() === 'Quantity', 'missing sales column reported');
  ok(P.chunk([1, 2, 3, 4, 5], 2).length === 3, 'chunking');
}

section('Upload previews (frontend plan.js)');
{
  const books = [{ id: 'b1', title: 'Gita', available: 3 }, { id: 'b2', title: 'Chant', available: 0 }];
  const users = [{ id: 'u1', name: 'Gopal' }];
  const pb = Plan.planBooks({ rows: [
    { row: 2, title: 'gita', price: '400', quantity: '' },
    { row: 3, title: 'New', price: '₹1,200', quantity: '5' },
    { row: 4, title: 'new', price: '', quantity: '6' },
    { row: 6, title: 'Bad', price: 'x', quantity: 1 }], blank: [5] }, books);
  ok(pb.map(i => i.action).join() === 'update,add,update,skip,skip', 'book preview actions in row order', pb.map(i => i.action));
  ok(pb[2].note === 'repeated in this file' && pb[3].reason === 'Title is missing', 'book preview notes');
  const ps = Plan.planSales({ rows: [
    { row: 2, book: 'GITA', quantity: 2, soldBy: 'gopal' },
    { row: 3, book: 'Gita', quantity: 2, soldBy: 'New One' },
    { row: 4, book: 'Gita', quantity: 1, soldBy: 'new one' },
    { row: 5, book: 'Chant', quantity: 1, soldBy: 'Gopal' },
    { row: 6, book: 'Nope', quantity: 1, soldBy: 'Gopal' },
    { row: 7, book: 'Gita', quantity: 0, soldBy: 'Gopal' }], invalid: [{ row: 8, reason: 'bad date' }] }, books, users);
  ok(ps.items.map(i => i.ok ? 'Y' : 'N').join('') === 'YNYNNNN', 'sales preview uses running stock', ps.items.map(i => i.reason));
  ok(ps.newSellers === 1 && ps.items[2].note === 'new seller (pending)', 'new seller counted once');
  ok(Plan.ranges([9, 2, 3, 4, 5, 7]) === '2–5, 7, 9', 'row ranges', Plan.ranges([9, 2, 3, 4, 5, 7]));
}

section('Upload: books');
{
  const res = must('upsertBooks', { rows: [
    { row: 2, title: 'BHAGAVAD-GĪTĀ AS IT IS', category: '', price: '', quantity: 20 },
    { row: 3, title: 'Nectar of Devotion', category: 'Medium books', price: '200', quantity: '15' },
    { row: 4, title: 'Bad', category: '', price: 'abc', quantity: 1 },
    { row: 5, title: 'Neg', category: '', price: 5, quantity: -1 },
    { row: 6, title: 'nectar of devotion', category: '', price: 210, quantity: '' }
  ] }, admin);
  ok(res.added.join() === '3' && res.updated.join() === '2,6' && res.skipped.map(x => x.row).join() === '4,5', 'added/updated/skipped with row numbers', res);
  ok(res.skipped[0].reason.includes('Price'), 'skip reason given');
  const nod = res.books.find(b => b.title.toLowerCase() === 'nectar of devotion');
  ok(nod.price === 210 && nod.quantity_received === 15, 'duplicate in file updates earlier row');
  ok(res.books.find(b => b.title.toLowerCase().startsWith('bhagavad')).quantity_received === 20, 'existing title updated (quantity received = 20)');
  ok(api('upsertBooks', { rows: new Array(501).fill({ row: 1, title: 'x' }) }, admin).error.includes('500'), 'more than 500 rows per call rejected');
  ok(api('upsertBooks', { rows: [] }, admin).error.includes('No rows'), 'empty upload rejected');
}

section('Upload: sales');
{
  const before = bookBy('Nectar').available; // 15
  const res = must('uploadSales', { rows: [
    { row: 2, book: 'nectar of devotion', quantity: 10, soldBy: 'gopal', area: 'Ameerpet', date: '2026-11-18' },
    { row: 3, book: 'Nectar of Devotion', quantity: 6, soldBy: 'Gopal', area: 'Ameerpet', date: '2026-11-18' },
    { row: 4, book: 'Nectar of Devotion', quantity: 5, soldBy: 'Brand New Seller', area: 'Uppal', date: '' },
    { row: 5, book: 'Unknown Book', quantity: 1, soldBy: 'Gopal' },
    { row: 6, book: 'Nectar of Devotion', quantity: 'two', soldBy: 'Gopal' },
    { row: 7, book: 'Nectar of Devotion', quantity: 1, soldBy: '' },
    { row: 8, book: 'Nectar of Devotion', quantity: 1, soldBy: 'brand new seller', date: '31/02/2026' }
  ] }, admin);
  ok(before === 15, 'start with 15');
  ok(res.imported.join() === '2,4', 'rows 2 and 4 imported', res.imported);
  const reasons = Object.fromEntries(res.skipped.map(x => [x.row, x.reason]));
  ok(/Not enough stock.*5 left/.test(reasons[3]), 'row 3 skipped: stock already used by row 2', reasons[3]);
  ok(/not in the book list/.test(reasons[5]) && /whole number/.test(reasons[6]) && /Sold By/.test(reasons[7]) && /valid date/.test(reasons[8]), 'reasons for each invalid row', reasons);
  ok(res.newSellers.join() === 'Brand New Seller', 'unknown seller created once', res.newSellers);
  const nu = must('listUsers', {}, admin).find(u => u.name === 'Brand New Seller');
  ok(nu && nu.approved === false && nu.type === 'Person' && !nu.has_pin, 'new seller is a pending Person without PIN');
  ok(bookBy('Nectar').available === 0, 'stock now 0');
  ok(res.sales.find(s => s.user_name === 'Brand New Seller').sale_date === todayIso(), 'blank date → today');
  // The placeholder seller can register and claim the record.
  ok(api('register', { name: 'Brand New Seller', phone: '9555555555', pin: '7777' }).ok, 'placeholder seller can register with the same name');
  ok(must('listUsers', {}, admin).filter(u => u.name === 'Brand New Seller').length === 1, 'no duplicate user created');
}

section('Dashboard and leaderboard');
{
  const d = must('dashboard', {}, gopal);
  const books = must('listBooks', {}, admin);
  const sales = must('listSales', {}, admin).sales;
  const sold = sales.reduce((a, s) => a + s.quantity, 0);
  const amt = sales.reduce((a, s) => a + s.amount, 0);
  ok(d.totals.titles === books.length, 'titles');
  ok(d.totals.sold === sold && d.totals.amount === amt, 'sold and ₹ totals match the log', [d.totals, sold, amt]);
  ok(d.totals.available === d.totals.stock - sold, 'available = stock − sold');
  ok(d.byCategory.reduce((a, c) => a + c.titles, 0) === books.length, 'category titles add up');
  ok(d.bySeller.reduce((a, x) => a + x.copies, 0) === sold, 'by-seller adds up');
  ok(d.byArea.reduce((a, x) => a + x.copies, 0) === sold, 'by-area adds up');

  const f = must('dashboard', { from: '2026-11-18', to: '2026-11-18' }, admin);
  ok(f.totals.sold === 10 && f.totals.available === d.totals.available, 'date filter changes sold, not available', f.totals);
  ok(api('dashboard', { from: '2026-11-20', to: '2026-11-01' }, admin).error.includes('after'), 'from > to rejected');

  const lbB = must('leaderboard', { by: 'books' }, gopal).rows;
  ok(lbB[0].name === 'Gopal' && lbB[0].rank === 1, 'Gopal leads by books', lbB);
  for (let i = 1; i < lbB.length; i++) ok(lbB[i - 1].books >= lbB[i].books, 'sorted by books ' + i);
  const lbR = must('leaderboard', { by: 'rupees' }, gopal).rows;
  for (let i = 1; i < lbR.length; i++) ok(lbR[i - 1].rupees >= lbR[i].rupees, 'sorted by rupees ' + i);
  ok(must('leaderboard', { type: 'Team' }, gopal).rows.every(r => r.type === 'Team'), 'teams-only filter');
  ok(must('leaderboard', { type: 'Person' }, gopal).rows.every(r => r.type === 'Person'), 'persons-only filter');
  ok(lbB.every(r => r.books > 0), 'only sellers with sales ranked');
  ok(lbB.find(r => r.name === 'Gopal').me === true, '"me" flag for highlighting');
}

section('Config, delete cascades, bootstrap');
{
  must('setConfig', { low_stock_threshold: 0, campaign_name: 'Kartik Marathon 2026' }, admin);
  ok(must('getConfig').campaign_name === 'Kartik Marathon 2026', 'campaign name saved');
  ok(must('listBooks', {}, admin).every(b => b.low === (b.available <= 0)), 'threshold applies');
  ok(api('setConfig', { low_stock_threshold: -1 }, admin).error.includes('whole number'), 'bad threshold rejected');
  must('setConfig', { low_stock_threshold: 5 }, admin);

  const nod = bookBy('Nectar');
  const salesBefore = must('listSales', {}, admin).sales.length;
  const del = must('deleteBook', { id: nod.id }, admin);
  ok(del.deletedSales === 2 && must('listSales', {}, admin).sales.length === salesBefore - 2, 'deleting a book deletes its sales');

  const delU = must('deleteUser', { id: radhaId }, admin);
  ok(delU.deletedSales === 1 && !delU.users.find(u => u.id === radhaId), 'deleting a user deletes their sales');
  ok(api('deleteUser', { id: readSheetObjects('Users').find(u => u.role === 'admin').id }, admin).error.includes('yourself'), 'admin cannot delete self');
  must('deleteUser', { id: teamId }, admin);
  ok(must('listUsers', {}, admin).find(u => u.id === gopalId).team_id === '', 'members of a deleted team keep their account');

  const boot = must('bootstrap', {}, gopal);
  ok(boot.me && boot.config && Array.isArray(boot.books) && Array.isArray(boot.sales) && Array.isArray(boot.users) && Array.isArray(boot.areas), 'bootstrap returns everything');
  ok(must('changePin', { oldPin: '4321', newPin: '864209' }, gopal).changed, 'change own PIN');
  ok(api('login', { id: 'Gopal', pin: '4321' }).ok === false && api('login', { id: 'Gopal', pin: '864209' }).ok, 'new PIN works, old does not');
  ok(api('changePin', { oldPin: 'nope', newPin: '1234' }, gopal).error.includes('current PIN'), 'wrong old PIN rejected');
}

section('Account lock after 10 wrong PINs in a day');
{
  const sid = must('saveUser', { name: 'Lockme', phone: '9666666666', pin: '1357' }, admin).find(u => u.name === 'Lockme').id;
  const sess = must('login', { id: 'Lockme', pin: '1357' }).token;   // an already-open session
  // 5 wrong by phone, then the 15-minute pause applies to the NAME too (same account).
  for (let i = 0; i < 5; i++) api('login', { id: '9666666666', pin: '0000' });
  ok(/wait 15 minutes/.test(api('login', { id: 'lockme', pin: '1357' }).error), 'phone and name share the per-account counter');
  CacheService.getScriptCache().remove('fail:u:' + sid);               // pretend 15 minutes passed
  const r9 = [];
  for (let i = 0; i < 4; i++) r9.push(api('login', { id: 'Lockme', pin: '0000' }).error);
  ok(/1 more wrong PIN and this account will be locked/.test(r9[3]), 'warning before the lock', r9[3]);
  const r10 = api('login', { id: 'Lockme', pin: '0000' });
  ok(r10.code === 'FORBIDDEN' && /locked/.test(r10.error), '10th wrong PIN locks the account', r10);
  CacheService.getScriptCache().remove('fail:u:' + sid);
  ok(/locked/.test(api('login', { id: 'Lockme', pin: '1357' }).error), 'correct PIN refused while locked');
  ok(readSheetObjects('Users').find(u => u.id === sid).locked_at !== '', 'lock stored in the sheet (survives cache loss)');
  resetMemo();
  ok(api('me', {}, sess).ok, 'an already-logged-in session keeps working');
  ok(must('listUsers', {}, admin).find(u => u.id === sid).locked === true, 'admin sees the lock');
  ok(must('listUsers', {}, sess).every(u => u.locked === undefined), 'non-admins do not see lock status');
  must('saveUser', { name: 'Lock Team', type: 'Team', phone: '9777777777', role: 'lead', pin: '2580', approved: true }, admin);
  const leadT = must('login', { id: '9777777777', pin: '2580' }).token;
  must('saveUser', { id: sid, team_id: readSheetObjects('Users').find(u => u.name === 'Lock Team').id }, admin);
  ok(api('saveUser', { id: sid, unlock: true }, leadT).code === 'FORBIDDEN', 'lead cannot unlock (even own team member)');
  must('saveUser', { id: sid, unlock: true }, admin);
  ok(api('login', { id: 'Lockme', pin: '1357' }).ok, 'admin unlock lets the user log in');
  ok(must('listUsers', {}, admin).find(u => u.id === sid).locked === false, 'lock cleared');
  ok(!PropertiesService.getScriptProperties().getProperty('pinfails:' + sid), 'wrong-PIN counter cleared on success');
  // Correct PIN before the 10th resets the daily count.
  for (let i = 0; i < 4; i++) api('login', { id: 'Lockme', pin: '0000' });
  must('login', { id: 'Lockme', pin: '1357' });
  for (let i = 0; i < 4; i++) api('login', { id: 'Lockme', pin: '0000' });
  ok(!/account is locked/.test(api('login', { id: 'Lockme', pin: '0000' }).error), 'a successful login resets the count');
  // Old sheet without the locked_at column still locks (column added on the fly).
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  const col = sh.data[0].indexOf('locked_at');
  sh.data.forEach(r => r.splice(col, 1));
  CacheService.getScriptCache().remove('fail:u:' + sid);
  clearDailyFailures(sid); resetMemo(); CacheService._clear();
  for (let i = 0; i < 10; i++) { api('login', { id: 'Lockme', pin: '0000' }); CacheService.getScriptCache().remove('fail:u:' + sid); }
  ok(sh.data[0].includes('locked_at') && /locked/.test(api('login', { id: 'Lockme', pin: '1357' }).error), 'locked_at column added automatically on old sheets');
  admin = must('login', { id: '9000000000', pin: '1234' }).token;
}

section('resetAdminPin');
{
  const aid = readSheetObjects('Users').find(u => u.role === 'admin').id;
  for (let i = 0; i < 10; i++) { api('login', { id: '9000000000', pin: '0000' }); CacheService.getScriptCache().remove('fail:u:' + aid); }
  ok(/locked/.test(api('login', { id: '9000000000', pin: '1234' }).error), 'admin can be locked too');
  ADMIN_PIN = '2468';
  resetAdminPin();
  resetMemo();
  ok(api('login', { id: '9000000000', pin: '2468' }).ok, 'resetAdminPin sets the PIN and unlocks the admin');
  ADMIN_PIN = '1234';
}

section('Busy lock and big data');
{
  LockService._state.failNext = true;
  const busy = api('addSale', { book_id: bookBy('Bhagavad').id, quantity: 1 }, admin);
  ok(busy.code === 'BUSY', 'lock timeout → BUSY with a friendly message', busy);

  admin = freshStart();
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push({ row: i + 2, title: `Book ${i} ${'ā'.repeat(40)}`, category: 'Cat ' + (i % 7), price: 10 + i, quantity: 1000 });
  must('upsertBooks', { rows }, admin);
  const t0 = Date.now();
  const sales = [];
  for (let c = 0; c < 6; c++) {
    const chunk = [];
    for (let i = 0; i < 500; i++) chunk.push({ row: c * 500 + i + 2, book: `Book ${(c * 500 + i) % 500} ${'ā'.repeat(40)}`, quantity: 1, soldBy: 'Seller ' + (i % 40), area: 'Area ' + (i % 25), date: '2026-11-0' + (1 + (i % 9)) });
    const r = must('uploadSales', { rows: chunk }, admin);
    ok(r.imported.length === 500, 'chunk ' + c + ' fully imported');
    sales.push(...chunk);
  }
  const stats = SpreadsheetApp._stats;
  const g0 = stats.getValues;
  resetMemo();
  must('dashboard', {}, admin);
  resetMemo();
  must('dashboard', {}, admin);
  ok(stats.getValues - g0 <= 6, 'second dashboard served from cache (few sheet reads)', stats.getValues - g0);
  const d = must('dashboard', {}, admin);
  ok(d.totals.sold === 3000 && d.byArea.length === 25, '3000 sales from 6 chunks counted', d.totals);
  ok(must('listUsers', {}, admin).length === 41, '40 new sellers created once each across chunks');
  print(`  (500 books + 3000 sales via 6 chunks in ${Date.now() - t0} ms on the mock)`);
}

print(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
if (failed) System.exit(1);
