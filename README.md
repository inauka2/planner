# Planner — personal monthly finance & life planner

An installable, offline-first web app (PWA) for iPhone. Dark mode, no account, no backend.
**All data stays on your device** (IndexedDB). Nothing is sent to any server.

- **Home:** year selector and 12 month cards.
- **Each month:**
  - **Budget:** balances in Lek and Euro (✎ to edit), Owed to me, Expected income, Planned vs actual.
  - **Daily:** today and this month at a glance, plus every transaction grouped by day.
  - **To Buy:** Necessary bills, Online Subscriptions, Self-care (with subcategories Clothes, Shoes, Hair, Skincare, Face, Body, Technology, Other), Fun & Social, Other.
  - **To Do:** checklists.
  - **Summary:** money flow, spending by category, the year at a glance, and month closing.
- The green **+** next to the tab bar always adds the right thing for the page you're on.
- **Currencies:** ALL and EUR are kept separate. The exchange rate (Settings) is only used for the "≈ ALL" figures in Summary and on the month cards.

## Tech

Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no runtime dependencies.

| Path | What it does |
| --- | --- |
| `js/money.js` | Amount parsing, formatting, currency conversion (integer cents) |
| `js/ledger.js` | Accounting rules: balances, transfers, closing, carry-over (pure, tested) |
| `js/defaults.js` | Default accounts, categories, lists and the new-month template |
| `js/db.js`, `js/store.js` | IndexedDB storage and app state |
| `js/backup.js` | Backup, restore and CSV export |
| `js/views/*` | Screens (`plan.js` holds the shared logic for planned items) |
| `sw.js` | Service worker (offline cache, updates) |
| `tests/` | Unit tests for the money logic (`npm test`) |

## Run locally

You need Node.js 18 or newer.

```bash
npm start
```

Open http://localhost:5173. To run the tests (currency conversion, ATM withdrawals, transfers, savings, closing, carry-over, backups):

```bash
npm test
```

> Offline mode and installing only work over **https** or on `localhost`. Opening the computer's IP address on your phone (http) won't install properly. Deploy it instead (below).

## Deploy for free

The app is just static files: everything in this folder except `tests/`, `scripts/` and `.claude/`. Any static host works. Two easy options:

**Netlify Drop (no account setup, ~1 minute)**
1. Go to https://app.netlify.com/drop and sign in (free).
2. Drag this whole folder onto the page.
3. You get an https URL like `https://your-name.netlify.app`. Rename it under *Site settings* if you like.
4. To update later, open the site in Netlify → *Deploys* → drag the folder again. Use the **same site** so the URL stays the same.

**GitHub Pages**
1. Create a GitHub repository and push this folder to it.
2. Repository → *Settings* → *Pages* → *Deploy from a branch* → `main` / root.
3. Your app is at `https://<username>.github.io/<repo>/`.

Cloudflare Pages and Vercel (static, no framework) work the same way.

## Install on iPhone

1. Open your deployed URL in **Safari**. It must be Safari.
2. Tap **Share** (square with an arrow) → **Add to Home Screen** → **Add**.
3. Open **Planner** from the Home Screen. After the first launch it works fully offline.

**Important:** the Home Screen app and Safari keep **separate** storage on iPhone. Enter your data in the installed app. If you entered data in Safari first, use *Settings → Export backup* there, then *Restore backup* in the installed app.

## Back up your data

There is no cloud copy and no sync. Your data exists only on that phone, so back it up regularly. The app reminds you after 30 days.

- **Export backup:** Settings → *Export backup* → in the share sheet choose **Save to Files** (iCloud Drive is a good place). The file is `planner-backup-YYYY-MM-DD.json`.
- **Restore backup:** Settings → *Restore backup…* → pick the `.json` file. It replaces all data on the device. Before replacing, the app keeps a copy of your current data, so you can use **Undo last restore** right after.
- **CSV:** Settings → *Export all transactions (CSV)*, or Summary → *Export [month] as CSV*. CSV is for spreadsheets only, not for restoring.

## Update the app without losing data

Your data lives in the browser's IndexedDB for the site's address. Updating the code never touches it, as long as:

1. You deploy to the **same URL** (same domain and path). A new URL means an empty app.
2. You change `VERSION` in `sw.js` (for example `1.0.0` → `1.0.1`) every time you deploy, so phones download the new files.

On the iPhone, open the app. Within a moment it shows **"A new version is ready · Update"**. Tap it. To be extra safe, export a backup before big updates.

Don't use "Remove from Home Screen" or Settings → Safari → Clear History and Website Data on the phone. Those delete the app's data.

## How the money rules work

- **Planned** items (budget, bills, expected income) never count as spending. Only recorded transactions do.
- **Expense:** money leaves an account and counts once as spending.
- **Income:** counts when you record it, which means when it's received.
- **Transfer:** money moves between your own accounts and is never spending. This covers ATM withdrawals (bank → cash) and currency exchange (EUR → ALL, where you enter the amount actually received).
- **Editing balances (✎ on Budget):** if an account has no transactions yet this month, its starting balance is set directly. Otherwise the difference is saved as a correction, which is never spending.
- **Money owed to you** is tracked separately and only joins your balance when you mark it received. That creates an income transaction.
- **Closing balance** = opening balance + the month's transactions.
- **Closing a month** (Summary → Review & close): confirm or type each real balance. Any difference is saved as a *correction*, which is never spending. The month's exchange rate is stored with the closing. The next month's opening balances come from the confirmed closing, so no money is counted twice.
- A closed month is read-only for money. To change it, reopen it. Months must be reopened newest first and closed oldest first, so balances always chain correctly.
- **To Buy items** are a plan, not spending. Ticking one asks whether to *record the expense* or *just mark it* (if you already added it in Daily), so nothing is counted twice.
- New months automatically get the same categories and lists, plus your **recurring** items (bills, subscriptions, salary), marked as *not paid*. *To Buy* and *To Do* can bring over unfinished items from the previous month.
- Data saved by version 1.0 is converted automatically on first launch: shopping lists become Self-care subcategories, and the unused default "Savings" account is removed. You can add a savings account in Settings at any time.

## Regenerating icons

```bash
npm run icons
```
