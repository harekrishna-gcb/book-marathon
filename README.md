# 📚 Book Marathon

A web app for the Srila Prabhupada book distribution campaign. Volunteers log in from their phones to record sales. Organisers track stock, areas, teams and a leaderboard.

- **Data** lives in **one Google Sheet** that stays private to you.
- **Backend** is **Google Apps Script** attached to that sheet. It checks every login and role.
- **Website** is a React app hosted free on GitHub Pages (or Netlify / Vercel).

No database server, no monthly bill.

```
apps-script/   paste these files into Apps Script (step 2)
frontend/      the website (React + Vite)
tests/         automatic tests (see docs/TEST-CHECKLIST.md)
docs/          sheet structure & API, assumptions & limits, test checklist
```

---

## Step 1: Create the Google Sheet
1. Go to <https://sheets.google.com> and create a **blank spreadsheet**.
2. Name it, for example **Book Marathon 2026**.
3. Keep it private. Don't share it; the website reaches it only through the script.

## Step 2: Add the script
1. In the spreadsheet, click **Extensions → Apps Script**. A new tab opens.
2. The editor already has a file called `Code.gs`. Select all its text and replace it with the contents of `apps-script/Code.gs` from this project.
3. For each of the other files, click **＋ (Add a file) → Script**, type the name **without** `.gs`, and paste the matching file's contents:

   | Name to type | Paste from |
   |---|---|
   | `Data` | `apps-script/Data.gs` |
   | `Auth` | `apps-script/Auth.gs` |
   | `Logic` | `apps-script/Logic.gs` |
   | `Books` | `apps-script/Books.gs` |
   | `Sales` | `apps-script/Sales.gs` |
   | `Users` | `apps-script/Users.gs` |
   | `Reports` | `apps-script/Reports.gs` |
   | `Setup` | `apps-script/Setup.gs` |
   | `Tests` | `apps-script/Tests.gs` |

4. In the **Setup** file, change these three lines to your own name, phone and a PIN of 4–6 digits:
   ```js
   var ADMIN_NAME = 'Admin';
   var ADMIN_PHONE = '9000000000';
   var ADMIN_PIN = '1234';
   ```
5. Click **💾 Save** (or Ctrl+S).

## Step 3: Run setup (once)
1. At the top of the editor, pick **`setup`** in the function list and click **▶ Run**.
2. Google asks for permission the first time. Click **Review permissions**, choose your account, then **Advanced → Go to (project name) (unsafe) → Allow**. It says "unsafe" only because this is your own unpublished script.
3. Go back to the spreadsheet tab. You now have the sheets **Users, Books, Sales, Config**.
4. *(Optional)* To try the app with sample data, run **`seed`** the same way. It adds 10 books, a team, 4 sellers and 24 sales; every sample user has PIN `1111`. Only run it on an empty sheet.
5. *(Optional)* Run **`runTests`**. **View → Logs** should show `failed: 0`.

## Step 4: Publish the script as a Web App
1. Click **Deploy → New deployment**.
2. Click the ⚙️ next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `Book Marathon API`
   - **Execute as: Me**
   - **Who has access: Anyone**. This is required so the website can call it. The script still demands a login for every action.
4. Click **Deploy** and copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.

> **Changing the script later?** Use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same. If you make a *new* deployment instead, you get a new URL and must update the website.

## Step 5: Connect the website to your script
Open `frontend/public/config.js` and paste your URL:
```js
window.BM_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfy…/exec'
};
```

## Step 6: Put the website online (free)

### Option A: GitHub Pages (nothing to install)
1. Create a free account at <https://github.com>. Click **New repository**, name it `book-marathon`, choose **Public**, and create it.
2. Click **uploading an existing file** and drag in **everything in this project folder**, including the hidden `.github` folder. Then click **Commit changes**.
   (If your file browser hides `.github`, turn on "show hidden files".)
3. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open the **Actions** tab and wait for the green ✓ (about 1–2 minutes).
5. Your site is live at `https://<your-username>.github.io/book-marathon/`.

Every later change you commit is published automatically.

### Option B: Netlify or Vercel
Sign up with your GitHub account, choose **Import project** and pick the repository, then set:
- **Base / root directory:** `frontend`
- **Build command:** `npm run build`
- **Publish / output directory:** `dist` (Netlify: `frontend/dist`)

### Option C: Build on your own computer
Install Node.js 20 or newer from <https://nodejs.org>, then:
```bash
cd frontend
npm install
npm run dev        # try it at http://localhost:5173
npm run build      # makes frontend/dist — upload that folder to any static host
```
You can still edit `dist/config.js` after building.

## Step 7: First login
1. Open the website and log in with the phone number and PIN you put in `Setup.gs`.
2. Click **Change PIN** at the top and choose a new PIN.
3. Follow the **Start here** guide: add books, approve volunteers, set team leads.
4. Share the website link with volunteers. They tap **Register here**, and you approve them under **Teams & users**.

---

## Who can do what
| | Admin | Team lead | Seller |
|---|---|---|---|
| Books and stock | view, add, edit, delete, upload | view | view |
| Record sales | for anyone | for own team | for self |
| Sales log, edit/delete | all | own team | own |
| Upload sales file | ✓ | | |
| People | approve, edit, roles, teams, delete | add/edit own team's sellers | view |
| Dashboard, leaderboard, downloads | ✓ | ✓ | ✓ |

The script enforces all of this on every request, not just the website.

## Upload file formats
**Book list:** `Title, Category, Price, Quantity`

**Sales:** `Book, Quantity, Sold By, Area, Date`

The first row must be the headers; capital letters don't matter. You always see a preview before anything is saved, and a summary of added / updated / skipped rows with row numbers afterwards.

## Troubleshooting
| Problem | Fix |
|---|---|
| "This website is not connected…" | Step 5: paste the URL into `config.js`. |
| "The server sent an unexpected answer" | The deployment's *Who has access* must be **Anyone**. Redeploy (step 4). |
| "Sheet "Users" is missing" | Run `setup` (step 3). |
| Script changes don't show up | Deploy a **new version** (see the note under step 4). |
| Forgot the admin PIN | In `Setup.gs`, set `ADMIN_PHONE` to the admin's phone and `ADMIN_PIN` to a new PIN, then run **`resetAdminPin`**. |
| "Too many wrong PINs" | Wait 15 minutes. |
| "This account is locked" | 10 wrong PINs in 24 hours. An admin opens **Teams & users → Locked accounts → Unlock** (and sets a new PIN if needed). If the only admin is locked: in `Setup.gs` set `ADMIN_PHONE` and a new `ADMIN_PIN`, then run **`resetAdminPin`**. |

More detail: [docs/01-sheets-and-api.md](docs/01-sheets-and-api.md) (sheet columns and API), [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) (assumptions and limits), [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) (tests).
