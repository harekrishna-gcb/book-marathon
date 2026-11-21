You are a senior full-stack engineer. I am attaching book-marathon.html, a
single-file prototype that stores data in the browser only. Rebuild it as a
multi-user web app with logins, WITHOUT any database server. Use Google Sheets
as the data store and Google Apps Script as the backend. Keep the same
features and layout as the prototype; read it first and reuse its logic.

## About the project
"Book Marathon" is a book distribution campaign. All books are by Srila
Prabhupada, so there is NO author field anywhere. Volunteers (persons and
teams) sell books in different areas. Organisers track stock, sales, areas,
and a leaderboard. Currency is Indian Rupees (₹, en-IN formatting).

## Architecture
- Data store: one Google Spreadsheet with these sheets (first row = headers):
  - Users: id, name, type (Person/Team), phone, members, role
    (admin/lead/seller), pin_hash, approved, created_at
  - Books: id, title, category, price, quantity_received, updated_at
  - Sales: id, book_id, quantity, user_id, area, sale_date, created_at
  - Config: key, value (e.g. campaign name, low-stock threshold = 5)
- Backend: Google Apps Script bound to the spreadsheet, deployed as a Web App
  (execute as me, access: anyone). Expose a JSON API through doGet/doPost
  with actions such as: login, listBooks, upsertBooks, listSales, addSale,
  uploadSales, listUsers, registerUser, leaderboard, dashboard.
- Frontend: a static site (React + Vite + Tailwind, or plain HTML/JS if simpler)
  hosted free on GitHub Pages, Netlify or Vercel. It calls the Apps Script
  URL with fetch. Mobile-first, light and dark mode.
- Excel/CSV parsing happens in the browser with SheetJS (xlsx), then the
  parsed rows are sent to the API.

## Logins and roles
- Login with phone number or username + 4-6 digit PIN. Store only a salted
  hash of the PIN in the sheet. The API returns a session token (random
  string with expiry, stored in CacheService or a Sessions sheet).
- Roles, enforced in Apps Script on EVERY request (never trust the client):
  1. admin: manage books, uploads, users, all sales
  2. lead: manage own team's members and see own team's sales
  3. seller: add/edit only their own sales, view leaderboard and stock
- Registration: anyone can register (name, phone, PIN, person/team); an admin
  approves them before they can log in.

## Concurrency
- Use LockService.getScriptLock() around every write so that two volunteers
  saving at the same time do not corrupt data or oversell stock.
- Re-check available stock inside the lock before saving a sale.
- Read data in bulk (getDataRange().getValues()), never cell by cell, and
  cache read-heavy results for a few seconds with CacheService.

## Features
1. Books: list, search (title/category), add, edit, delete (admin).
   Upload CSV/Excel with columns Title, Category, Price, Quantity. Match on
   Title case-insensitively: update existing, add new. Preview before confirm
   and show a result summary (added/updated/skipped with row numbers).
   Show received, sold, available per book; red when 5 or fewer left.
2. Sales: add sale (book, quantity, sold by, area, date). Remember last
   seller/area/date as defaults. Area autocomplete from previous areas.
   Reject quantity above available stock. Upload sales from CSV/Excel with
   columns Book, Quantity, Sold By, Area, Date (handle Excel date cells;
   unknown sellers become pending persons; skip and report invalid rows).
   Sales log with search, edit and delete (role permitting).
3. Teams and users: register person/team, show copies sold per person/team.
4. Dashboard: cards for titles, total stock, sold, available, sales amount (₹);
   book-wise stock table; by category; by person/team; by area; date filter.
5. Leaderboard: rank persons and teams by number of books OR rupees
   (quantity x price); filter everyone/persons/teams; medals for top 3,
   progress bars, both numbers on each row.
6. Export: buttons to download books, sales and leaderboard as Excel/CSV.
7. UX: friendly empty states, a first-time "Start here" guide, clear
   validation messages, confirmation before delete, loading and error states.

## Non-functional requirements
- No secrets in the frontend. Keep the spreadsheet private to the owner;
  only the Apps Script exposes data, and only after token + role checks.
- Handle Apps Script quirks: CORS (use a simple POST with
  Content-Type text/plain and return JSON via ContentService), and the 6-minute
  execution limit (process uploads in chunks of ~500 rows).
- Provide a one-time setup function that creates all sheets and headers, and
  a seed function with sample books, users and sales.
- Include tests (or at least a manual test checklist) for stock calculation,
  overselling prevention and upload parsing.

## Deliverables
1. Apps Script code (Code.gs and any helper files) with comments.
2. Frontend source code with all files.
3. A step-by-step README for a non-developer: create the Google Sheet, open
   Extensions > Apps Script, paste the code, run setup, deploy as Web App,
   copy the URL into the frontend config, deploy the frontend for free.
4. A short list of assumptions and known limits (e.g. Sheets is fine for
   thousands of rows, not millions).

Work step by step: first propose the sheet structure and API list, then
write the Apps Script, then the frontend, then the README. Ask me before
changing any behaviour from the prototype.