# Planner — personal finance, budgets, bills and to-dos

An installable, offline-first web app (PWA) for iPhone, light and dark. No backend.
**All data stays on your device** (IndexedDB). Nothing is sent to any server.

Five simple tabs. Every page has the ⚙︎ Settings button at the top left and one blue **+** at the top right.

- **Accounts & Budgets:** all your money (with a Lek / Euro / Dollar breakdown), your bank accounts and cash, money people owe you, and this month's budget: how much is left to spend, then one bar per category (spent / budget).
  - Tap an account to see its transactions with the running balance, and upcoming bills paid from it. The ••• menu edits the account, corrects its balance, transfers money or imports a bank file.
- **Daily:** what you spent today and this month, and your income. Big **Expense**, **Income** and **Transfer** buttons, then every transaction grouped by day.
- **Planned:** everything you plan to buy or pay this month, bills included, on one page. At the top: **Spent** and **Still to buy**. Then *Due soon* (bills due in the next 7 days or overdue), your **categories** (open one to set its budget, add items and use subcategories) and *Expected income*. Tick an item when you pay it and the payment is recorded.
- **To Do:** the month's activities and important things to do, in lists (Activities, Projects, Health…). Type tasks one after another, give them a deadline or a cost (a cost also appears in To Buy), tick them off, and bring unfinished ones into the next month.
- **Summary:** the month at a glance (started with, ends with, income, spent), spending by category and by year, and **closing the month**. *More reports* has charts for net worth, cash flow, payees and more.
- **Settings:** accounts, appearance (auto / light / dark), privacy mode (hides every amount — also the eye at the top), reports, import, categories, exchange rates, backup and restore.
- **Transactions** (blue +): expense, income or transfer, any date, category and subcategory, tags and notes. Paying in USD from a Lek or Euro account records both the price and what the bank took.
- **Import** CSV, OFX, QFX or QIF statements from your bank into any account; rows already there are skipped.
- **Currencies:** ALL, EUR and USD are kept separate (one currency per account). The exchange rates (Settings) are only used for the "≈ ALL" figures, budgets and reports, and are saved with each closed month.

## Tech

Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no runtime dependencies.

| Path | What it does |
| --- | --- |
| `js/money.js` | Amount parsing, formatting, currency conversion (integer cents) |
| `js/ledger.js` | Accounting rules: balances, transfers, closing, carry-over (pure, tested) |
| `js/insights.js` | Registers, running balances, scheduled items, forecast, report data, search (pure, tested) |
| `js/importer.js` | CSV / OFX / QFX / QIF statement parsers (pure, tested) |
| `js/routes.js` | URLs of every screen |
| `js/defaults.js` | Default accounts, categories, lists and the new-month template |
| `js/db.js`, `js/store.js` | IndexedDB storage and app state |
| `js/backup.js` | Backup, restore and CSV export |
| `js/views/*` | Screens: `accountsTab.js` (Accounts & Budgets), `pages.js` (Daily, Planned, To Do, Summary), `buy.js` (Planned categories and items), `scheduled.js` (bill and income rows), `summary.js`, `todo.js`, `reports.js`, `settings.js`; `chrome.js` holds the shared top bar and rows; `plan.js` the logic for planned items |
| `sw.js` | Service worker (offline cache, updates) |
| `tests/` | Unit tests for the money logic (`npm test`) |

## Run locally

You need Node.js 18 or newer.

```bash
npm start
```

Open http://localhost:5173. To run the tests (currency conversion, ATM withdrawals, transfers, savings, closing, carry-over, backups, registers, forecast, reports, search, bank-file import):

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

## No password

Planner opens straight into your data — there is no sign-up, sign-in or password.

- Your data lives **only on that iPhone**. Nothing is sent online and nothing syncs to other devices, so use backups (below) to keep a copy.
- If you created more than one account in an earlier version, each one is kept as a separate **profile** with its own data. Switch between them in *Settings → Profile*.
- Anyone who can unlock your iPhone can open the app. Turn on **Privacy mode** (the eye button) to blur amounts.

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
- **Paying in another currency:** an expense or income can be priced in ALL, EUR or USD and paid from any account. If the account holds another currency (e.g. dollars paid with a Lek card), you also enter what the bank actually took — the app suggests it from your rate. Balances and spending use the amount taken; plans and To Buy compare the original price (so a $25 plan matches a $25 payment).
- **Transfer:** money moves between your own accounts and is never spending. This covers ATM withdrawals (bank → cash) and currency exchange (EUR → ALL, where you enter the amount actually received).
- **Editing balances (✎ on Budget):** if an account has no transactions yet this month, its starting balance is set directly. Otherwise the difference is saved as a correction, which is never spending.
- **Money owed to you** is tracked separately and only joins your balance when you mark it received. That creates an income transaction.
- **Closing balance** = opening balance + the month's transactions.
- **Closing a month** (Summary → Review & close): confirm or type each real balance. Any difference is saved as a *correction*, which is never spending. The month's exchange rate is stored with the closing. The next month's opening balances come from the confirmed closing, so no money is counted twice.
- A closed month is read-only for money. To change it, reopen it. Months must be reopened newest first and closed oldest first, so balances always chain correctly.
- **One job per page, so nothing is counted twice:** *To Buy* is the plan, *Daily* is the real money (the only place spending is counted), *To Do* is tasks.
  - A To Do task can have a **cost** (e.g. "Trip to Kosovo — €150"): it is stored once, as a planned item in To Buy, and shown on both pages.
  - Adding an expense in Daily that matches something unpaid in To Buy asks *"Is this …?"* — yes links them (marked paid, counted once).
  - Ticking a To Buy item that's already in Daily offers *"Link to … in Daily"* instead of recording it again.
- **Category budgets:** in Planned, open a category and *Set budget* in Lek, Euro and/or Dollar; otherwise Planned is the total of its items.
- **To Buy items** are a plan, not spending. Ticking one asks whether to *record the expense* or *just mark it* (if you already added it in Daily), so nothing is counted twice.
- New months automatically get the same categories and lists, plus your **recurring** items (bills, subscriptions, salary), marked as *not paid*. *To Buy* and *To Do* can bring over unfinished items from the previous month.
- Data saved by version 1.0 is converted automatically on first launch: shopping lists become Self-care subcategories, and the unused default "Savings" account is removed. You can add a savings account in Settings at any time.

## Regenerating icons

```bash
npm run icons
```
