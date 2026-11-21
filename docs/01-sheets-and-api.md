# Step 1 — Sheet structure and API

This is the proposal the code follows. The Apps Script `setup()` function
creates these sheets for you, so you never type the headers yourself.

## Spreadsheet: one file, five sheets

Row 1 of every sheet holds the headers. The code finds columns **by header
name**, so reordering columns or adding your own notes column on the right
won't break anything. Do not rename the headers.

### Users
| column       | example                  | notes |
|--------------|--------------------------|-------|
| id           | `u_k3j9x2p1`             | random, never changes |
| name         | `Gopal Das`              | also works as the login username (must be unique) |
| type         | `Person` / `Team`        | |
| phone        | `9876543210`             | login id; stored as text so leading `0`/`+` survive |
| members      | `Rama, Shyam, Hari`      | free text, for teams (same as the prototype) |
| role         | `admin` / `lead` / `seller` | |
| pin_hash     | `9f2c…$a81b…`            | `salt$sha256`, never the PIN itself. Empty = cannot log in |
| approved     | `TRUE` / `FALSE`         | registrations start as FALSE |
| created_at   | `2026-11-21T10:30:00Z`   | |
| **team_id**  | `u_team01`               | **added**: which team a person belongs to (empty = none). Needed so a lead can manage "their team" |
| **locked_at** | ISO timestamp           | **added**: set after 10 wrong PINs in 24 hours; empty = not locked. Added automatically to older sheets |

### Books
| column            | example                  |
|-------------------|--------------------------|
| id                | `b_x8k2m1qa`             |
| title             | `Bhagavad-gītā As It Is` |
| category          | `Big books`              |
| price             | `350`                    |
| quantity_received | `120`                    |
| updated_at        | ISO timestamp            |

Sold and available are **never stored**; they are computed from Sales each
time, which keeps them from drifting out of sync.

### Sales
| column         | example        | notes |
|----------------|----------------|-------|
| id             | `s_p0q9r8s7`   | |
| book_id        | `b_x8k2m1qa`   | |
| quantity       | `3`            | whole number ≥ 1 |
| user_id        | `u_k3j9x2p1`   | the person/team credited with the sale ("Sold by") |
| area           | `Banjara Hills`| |
| sale_date      | `2026-11-20`   | `yyyy-mm-dd`, stored as text |
| created_at     | ISO timestamp  | |
| **created_by** | `u_admin`      | **added**: who typed the entry (audit trail) |

### Config
| key                 | value          |
|---------------------|----------------|
| campaign_name       | `Book Marathon`|
| low_stock_threshold | `5`            |

### Sessions
No sheet. Session tokens live in Apps Script's `CacheService` with a 6-hour
expiry, which is the longest CacheService allows. After that the user logs in again.

## API

One URL (the Web App URL). Every call is an HTTP `POST` with
`Content-Type: text/plain` (this avoids the CORS pre-flight that Apps Script
cannot answer) and a JSON body:

```json
{ "action": "addSale", "token": "…", "payload": { … } }
```

Every response is JSON:

```json
{ "ok": true,  "data": { … } }
{ "ok": false, "error": "Only 2 copies of “Nectar of Devotion” are left.", "code": "VALIDATION" }
```

`code` is one of `AUTH` (log in again), `FORBIDDEN`, `VALIDATION`,
`NOT_FOUND`, `BUSY` (lock timeout, retry), `SERVER`.

| action        | who            | payload | returns |
|---------------|----------------|---------|---------|
| `ping`        | anyone         | – | `{time}` |
| `getConfig`   | anyone         | – | campaign name, threshold |
| `register`    | anyone         | name, phone, pin, type, members | pending notice |
| `login`       | anyone         | `id` (phone or name), pin | token, expiresAt, me |
| `logout`      | logged in      | – | – |
| `me`          | logged in      | – | current user |
| `changePin`   | logged in      | oldPin, newPin | – |
| `bootstrap`   | logged in      | – | me, config, books, users, sales, areas in one round-trip |
| `listBooks`   | logged in      | – | books with sold / available / low flag |
| `saveBook`    | admin          | id?, title, category, price, quantity | books |
| `deleteBook`  | admin          | id | books (its sales are deleted too, same as the prototype) |
| `upsertBooks` | admin          | rows[≤500] `{row,title,category,price,quantity}` | added/updated/skipped with row numbers, books |
| `listSales`   | logged in      | – | sales the caller may see, areas |
| `addSale`     | logged in      | book_id, quantity, user_id, area, sale_date | sales, books |
| `updateSale`  | logged in      | id + same fields | sales, books |
| `deleteSale`  | logged in      | id | sales, books |
| `uploadSales` | admin          | rows[≤500] `{row,book,quantity,soldBy,area,date}` | imported/skipped/newSellers, sales, books |
| `listUsers`   | logged in      | – | users the caller may see (phones only where allowed) |
| `saveUser`    | admin, lead    | id?, name, type, phone, members, role, approved, team_id, pin?, unlock? (admin only) | users |
| `deleteUser`  | admin          | id | users (their sales are deleted too, same as the prototype) |
| `dashboard`   | logged in      | from?, to? | totals, byBook, byCategory, bySeller, byArea |
| `leaderboard` | logged in      | by (`books`/`rupees`), type (`all`/`Person`/`Team`), from?, to? | ranked rows |
| `setConfig`   | admin          | campaign_name, low_stock_threshold | config |

### What each role may do (checked on the server, on every request)

| | admin | lead | seller |
|---|---|---|---|
| See books & stock | ✓ | ✓ | ✓ |
| Add/edit/delete/upload books | ✓ | – | – |
| See dashboard & leaderboard (totals only) | ✓ | ✓ | ✓ |
| See sales log | all | own team (team + its members) | own |
| Record a sale for | anyone | own team | self |
| Edit/delete a sale | any | own team's | own |
| Upload sales file | ✓ | – | – |
| See phone numbers | all | own team | own |
| Add/edit users | anyone, any role | members of own team (as sellers) | – |
| Approve registrations, delete users | ✓ | – | – |

### Concurrency rules
* Every write runs inside `LockService.getScriptLock()`.
* Inside the lock the sheet is re-read fresh (no cache) and stock is
  re-checked before a sale is saved, so two phones can't both sell the last copy.
* Reads use `getDataRange().getValues()` once per sheet, then a 10-second
  `CacheService` copy. Every write clears that copy.
* Uploads are sent in chunks of 500 rows. Each chunk is a separate request,
  so no single run gets near the 6-minute limit.
