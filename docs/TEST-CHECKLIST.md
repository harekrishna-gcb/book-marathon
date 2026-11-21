# Tests

## 1. Automatic tests (no Google account needed)
`tests/run-tests.js` runs the real Apps Script code against a fake in-memory spreadsheet (`tests/gas-mock.js`). It also tests the frontend's upload parser and previews. There are 153 checks covering stock maths, overselling (including a stale-cache race), every role permission, both uploads, PINs and login lockout, formula injection, reports, and a 3,000-row chunked upload.

```bash
gjs -m tests/run-tests.js     # gjs ships with GNOME on most Linux desktops
```

## 2. Inside Apps Script
Open the editor, choose `runTests` and press ▶ Run. It checks the pure rules in `Logic.gs` (stock, overselling, upload planning, dates) and never touches your sheets. The log should end with `failed: 0`.

## 3. Manual checklist on the real site
Run `setup()` and `seed()` first. All seeded users have PIN `1111`; the admin uses the PIN from `Setup.gs`.

**Stock calculation**
- [ ] Dashboard: Available = Total stock − Sold. Check it against the Books tab.
- [ ] "Easy Journey to Other Planets" (8 received) shows in red, because 5 or fewer are left.
- [ ] Record 1 copy of a book: Sold goes up by 1 and Available down by 1 on the Books tab, the Dashboard and the Sales form.
- [ ] Edit that sale to 3 copies: Available drops by 2 more. Delete it: the stock comes back.
- [ ] Change the low-stock threshold in Teams & users > Settings: the red marks update.

**Overselling prevention**
- [ ] Try to sell more than are left: you get "Only N copies … are left" and nothing is saved.
- [ ] Two phones, same book with 1 copy left. Both open the Sales form, then both press **Add sale** at the same moment. Exactly one succeeds; the other gets "out of stock".
- [ ] Edit an existing sale up to exactly the available amount plus its own quantity: allowed. One more: refused.
- [ ] Upload a sales file whose rows together need more than the stock: the later rows are skipped with "Not enough stock".

**Upload parsing**
- [ ] Book CSV with headers in any case (`TITLE, category, Price (₹), Qty`) is understood.
- [ ] The preview shows Add / Update / Skip per row **before** saving. Cancel saves nothing.
- [ ] A title in different capitals (`BHAGAVAD-GĪTĀ AS IT IS`) updates the existing book and doesn't add a duplicate.
- [ ] Rows with no title, price `abc` or quantity `-3` are skipped, and the summary lists their row numbers.
- [ ] Excel (.xlsx) sales file with real date cells: the dates come in right (no off-by-one day).
- [ ] CSV sales file with `05/11/2026`: saved as 5 November.
- [ ] Unknown seller name: shown as "new seller (pending)" in the preview, then appears under "Waiting for approval".
- [ ] Unknown book, quantity 0, missing seller, date `31/02/2026`: each skipped with a reason and row number.
- [ ] A file of more than 500 rows uploads in parts ("part 1 of 3…").

**Logins and roles**
- [ ] Register a new volunteer: they can't log in until an admin approves them.
- [ ] 5 wrong PINs: locked for 15 minutes.
- [ ] Seller: sees only their own sales; "Sold by" is fixed to themself; no book editing; no phone numbers of others.
- [ ] Lead: sees their team's sales; can add a member; can't edit people outside the team.
- [ ] Admin un-approves a logged-in user: that user's next action sends them to the login screen.

**UX**
- [ ] First login shows "Start here"; "Got it" hides it.
- [ ] Every Delete asks for confirmation.
- [ ] Turn off the internet and press a button: a clear "Cannot reach the server" message.
- [ ] Light / dark toggle works, and the layout works on a phone (about 400 px wide).
- [ ] Excel and CSV downloads work for books, sales and the leaderboard.
