# Assumptions and known limits

## Assumptions
- **One campaign per spreadsheet.** For a new campaign, make a copy of the spreadsheet (or a fresh one) and deploy again.
- **Name works as the username** and must be unique, so two people can't both be "Gopal". Phone numbers must be unique too.
- **Phone numbers are Indian.** `+91 98765 43210`, `09876543210` and `9876543210` all count as the same number.
- **Text dates in uploads are read day first:** `05/11/2026` means 5 November. Real Excel date cells are always read correctly. A blank date means today.
- **Teams.** A Team is a seller in its own right, the same as in the prototype. A Person can belong to one team (`team_id`). The Team's "Team total" column adds its members' sales, but the leaderboard ranks each person and team separately, as the prototype does.
- **Lead** means "team leader". A lead can be a Person with a team, or the Team account itself.
- **Quantity received is a total**, not a top-up. Uploading a book list sets it to the number in the file, the same as the prototype.
- **Deleting a book or user also deletes their sales**, the same as the prototype. The app asks for confirmation first and says how many sales will go.

## Known limits
- **Size.** Google Sheets is fine for thousands of rows (tested up to 3,000 sales and 500 books). It is not built for hundreds of thousands. Every request reads whole sheets. Expect slowdowns above about 20,000 sales; the sheet limit is 10 million cells.
- **Speed.** Each Apps Script call takes about 1–3 seconds, so the app loads everything in one `bootstrap` call and saves one item per click.
- **One writer at a time.** Writes queue behind a script lock. If the lock can't be had within 25 seconds, the user sees "server is busy" and the app retries once. This is fine for dozens of volunteers saving at the same time, but not for thousands.
- **Quotas** (free Google account): about 20,000 URL fetches/day and 90 minutes of total script run time/day. A busy campaign day with 50 volunteers stays well within this.
- **Sessions last 6 hours**, because that is CacheService's longest expiry. Then you log in again. If Google clears the cache early (rare), you also need to log in again.
- **PIN security.** A 4–6 digit PIN is weak by nature. Defences: 5 wrong tries locks that login for 15 minutes; hashes are salted, stretched and peppered; the sheet stays private. Don't reuse a bank PIN.
- **Changes made directly in the sheet** show up within about 10 seconds, after the cache expires. Don't rename the header row. Don't type over `id` columns.
- **Other people's changes** don't push to your screen. Press ↻ Refresh, or switch tabs after a minute.
- **Exports** contain only what your role can see. A seller's sales export holds only their own sales.
