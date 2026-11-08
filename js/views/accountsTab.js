// Accounts & Budgets tab: total money, your accounts, money owed to you, and this month's
// budget per category. Tapping an account opens its transactions (forecast + months, running balance).
import { state, saveSettings, ensureMonth } from '../store.js';
import { localDateParts, getRates, accountById, nextMonthId, monthBounds, monthSummary, planTotals, MONTH_NAMES } from '../ledger.js';
import { formatMoney, centsToInput, parseAmount, CURRENCIES, CURRENCY_NAMES } from '../money.js';
import { icon } from '../icons.js';
import { LIABILITY_KINDS, categoryStyle } from '../defaults.js';
import { esc, registerActions, openSheet, fieldError, toast, chooseDialog, emptyState, rerender } from '../ui.js';
import { routes } from '../routes.js';
import {
  balancesNow, currentBalanceMonth, accountRegister, accountForecast, searchTransactions, pairIn, budgetStatus,
} from '../insights.js';
import {
  topBar, pillBtn, privacyBtn, largeTitle, accountSquare, square, txRow, statPills, monthHeading, searchField, longDate,
} from './chrome.js';
import { openTxSheet } from './txsheet.js';
import { openAccountSheet, setBalances } from './accounts.js';
import { planAccount, recordPlan } from './plan.js';
import { openImportSheet } from './importer.js';

let showHidden = false;
let pageMonths = 6; // month sections shown in a register before "Show earlier"
export const search = { account: '' };

const today = () => localDateParts();
const ratesNow = () => {
  const id = currentBalanceMonth(state, today().monthId);
  return getRates(state, id || today().monthId);
};

// ---------- Accounts & Budgets ----------
export function renderAccounts() {
  const t = today();
  const bal = balancesNow(state, t.monthId);
  const rates = ratesNow();
  const accs = state.settings.accounts.filter((a) => showHidden || !a.archived);
  const totals = { ALL: 0, EUR: 0, USD: 0 };
  for (const a of state.settings.accounts) if (!a.archived) totals[a.currency] += bal[a.id] || 0;
  const net = pairIn(totals, 'ALL', rates);
  const archivedCount = state.settings.accounts.filter((a) => a.archived).length;
  const last = state.settings.lastBackupAt;
  const daysSince = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  const needsBackup = state.transactions.length > 0 && (daysSince === null || daysSince > 30);
  const multi = CURRENCIES.filter((c) => totals[c] || state.settings.accounts.some((a) => !a.archived && a.currency === c));

  return `
    ${topBar({ buttons: [
      privacyBtn(),
      pillBtn({ act: 'acc-new-here', ic: 'plus', label: 'Add account', primary: true }),
    ] })}
    <main class="content">
      ${state.storageError ? `<div class="banner danger">Storage is unavailable (${esc(state.storageError.message)}). Changes can’t be saved. In Safari, turn off Private Browsing.</div>` : ''}
      ${needsBackup ? `<a class="banner" href="${routes.settings()}">${icon('download')} <span>${daysSince === null ? 'You haven’t made a backup yet.' : `Last backup was ${daysSince} days ago.`} <b>Back up now</b></span></a>` : ''}
      ${largeTitle('Accounts & Budgets')}

      <section class="net-card">
        <p class="cap">All my money</p>
        <p class="net-big ${net < 0 ? 'neg' : ''}"><span class="mw-amt">${multi.length > 1 ? '≈ ' : ''}${formatMoney(net, 'ALL')}</span></p>
        ${multi.length > 1 ? `<div class="net-cur">${multi.map((c) => `
          <span><span class="cap">${CURRENCY_NAMES[c]}</span><span class="mw-amt ${totals[c] < 0 ? 'neg' : ''}">${formatMoney(totals[c], c)}</span></span>`).join('')}</div>` : ''}
      </section>

      <p class="section-label"><span>Accounts</span></p>
      <section class="group-card open"><ul class="acc-list">
        ${accs.map((a) => accountRow(a, bal[a.id] || 0)).join('')}
        <li><button class="acc-row add" data-act="acc-new-here">${icon('plus')}<span>Add bank account or cash</span></button></li>
      </ul></section>
      ${archivedCount ? `<button class="text-btn" data-act="acc-toggle-hidden">${showHidden ? 'Hide' : 'Show'} ${archivedCount} hidden account${archivedCount > 1 ? 's' : ''}</button>` : ''}

      ${owedSection()}
      ${budgetSection(t.monthId)}
    </main>`;
}

function accountRow(a, cents) {
  const neg = cents < 0;
  const limit = a.kind === 'credit' && a.creditLimit ? ` <span class="faint">/ ${formatMoney(a.creditLimit, a.currency)}</span>` : '';
  return `<li><a class="acc-row ${a.archived ? 'faded' : ''}" href="${routes.account(a.id)}">
    ${accountSquare(a)}
    <span class="acc-main"><span class="acc-name">${esc(a.name)}</span>
      <span class="acc-bal"><span class="mw-amt ${neg ? 'neg' : LIABILITY_KINDS.includes(a.kind) ? '' : 'pos-soft'}">${formatMoney(cents, a.currency)}</span>${limit}</span></span>
  </a></li>`;
}

function owedSection() {
  const open = state.receivables.filter((r) => !r.received);
  const totals = { ALL: 0, EUR: 0, USD: 0 };
  open.forEach((r) => { totals[r.currency] += r.amount; });
  const text = CURRENCIES.filter((c) => totals[c]).map((c) => formatMoney(totals[c], c)).join(' · ');
  const monthId = today().monthId;
  return `<p class="section-label"><span>Owed to me</span>${text ? `<span class="mw-amt">${text}</span>` : ''}</p>
    <section class="group-card open"><ul class="acc-list">
      ${open.map((r) => `<li><button class="acc-row" data-act="owed-open" data-id="${esc(r.id)}" data-month="${monthId}">
        ${square('#ff9f0a', 'kind-owed')}
        <span class="acc-main"><span class="acc-name">${esc(r.description)}</span><span class="acc-bal"><span class="mw-amt">${formatMoney(r.amount, r.currency)}</span></span></span>
      </button></li>`).join('')}
      <li><button class="acc-row add" data-act="owed-add">${icon('plus')}<span>Someone owes me money</span></button></li>
    </ul></section>`;
}

/** Whole units, no "ALL" suffix and no decimals — fits inside a progress pill. */
const short = (cents) => formatMoney(Math.round(cents / 100) * 100, 'ALL').replace(' ALL', '').replace(/\.00$/, '');

/** This month's budget: remaining vs budgeted, then one progress pill per category. */
function budgetSection(id) {
  const m = state.months[id];
  if (!m) return '';
  const s = monthSummary(state, id);
  const rows = budgetStatus(state, id, planTotals(m), 'ALL').filter((r) => r.planned || r.spent);
  const budgeted = rows.reduce((t, r) => t + r.planned, 0);
  const spent = pairIn(s.spendingByPrice, 'ALL', s.rates);
  const remaining = budgeted - spent;
  const name = MONTH_NAMES[Number(id.slice(5)) - 1];
  return `<p class="section-label"><span>Budget · ${name}</span><a class="link-btn" href="${routes.budgets(id)}">Edit</a></p>
    <section class="remain-card">
      <div><p class="cap accent-cap">Left to spend</p><p class="remain-big ${remaining < 0 ? 'neg' : ''}"><span class="mw-amt">${formatMoney(remaining, 'ALL')}</span></p></div>
      <div><p class="cap accent-cap">Budget</p><p class="remain-big"><span class="mw-amt">${formatMoney(budgeted, 'ALL')}</span></p></div>
    </section>
    ${rows.length ? `<section class="group-card open budget-list">${rows.map((r) => {
      const { color, icon: ic } = categoryStyle(r.cat.id, m.categories.indexOf(r.cat));
      const over = r.planned && r.spent > r.planned;
      const fill = r.planned ? Math.min(100, Math.round((r.spent / r.planned) * 100)) : 100;
      return `<a class="budget-line" href="${routes.budgets(id, r.cat.id)}">
        ${square(color, ic, 'sm')}
        <span class="budget-name">${esc(r.cat.name)}</span>
        <span class="budget-pill ${over ? 'over' : ''} ${r.planned ? '' : 'empty'}" style="--c:${color};--fill:${fill}%"><span class="mw-amt">${short(r.spent)} / ${r.planned ? short(r.planned) : '—'}</span></span>
      </a>`;
    }).join('')}</section>`
    : `<section class="group-card">${emptyState('No budget yet', 'Set how much you want to spend per category in Planned → To Buy.', `<a class="btn btn-primary" href="${routes.budgets(id)}">Set a budget</a>`)}</section>`}`;
}

function searchResults(q) {
  const res = searchTransactions(state, q);
  if (!res.length) return `<p class="hint search-none">No transactions match “${esc(q)}”.</p>`;
  return `<p class="section-cap">${res.length} result${res.length > 1 ? 's' : ''}</p>
    <ul class="reg-list">${res.slice(0, 200).map((t) => txRow(t)).join('')}</ul>`;
}

// ---------- one account ----------
export function renderAccount(accId) {
  const a = accountById(state, accId);
  if (!a) {
    return `${topBar({ back: routes.accounts() })}<main class="content"><section class="group-card">${emptyState('Account not found', '', `<a class="btn btn-primary" href="${routes.accounts()}">Back to Accounts</a>`)}</section></main>`;
  }
  const t = today();
  const bal = balancesNow(state, t.monthId)[a.id] || 0;
  const groups = accountRegister(state, a.id);
  const until = monthBounds(nextMonthId(t.monthId)).last;
  const fc = accountForecast(state, a.id, t.date, until, planAccount);
  const q = search.account;
  const balPill = a.kind === 'credit' && a.creditLimit
    ? `${formatMoney(bal, a.currency)} / ${formatMoney(a.creditLimit, a.currency)}`
    : formatMoney(bal, a.currency);
  const used = a.kind === 'credit' && a.creditLimit ? Math.min(100, Math.round((Math.abs(Math.min(0, bal)) / a.creditLimit) * 100)) : null;

  return `
    ${topBar({ back: routes.accounts(), center: `<div class="acc-head">${accountSquare(a)}<div><span class="acc-head-name">${esc(a.name)}</span>
        <span class="bal-pill ${bal < 0 ? 'neg' : ''}" ${used != null ? `style="--used:${used}%"` : ''}><span class="mw-amt">${balPill}</span></span></div></div>`, buttons: [
      pillBtn({ act: 'acc-menu', ic: 'more', label: 'Account options', attrs: `data-id="${esc(a.id)}"` }),
      pillBtn({ act: 'new-tx', ic: 'plus', label: 'New transaction', primary: true, attrs: `data-account="${esc(a.id)}"` }),
    ] })}
    <main class="content">
      <div class="search-wrap">
        ${searchField('account', q, `Search in ${a.name}`)}
        <div data-search-results="account" data-acc="${esc(a.id)}">${q ? searchResults(`${q}, @${a.name}`) : ''}</div>
      </div>
      <div data-hide-on-search ${q ? 'hidden' : ''}>
        ${fc.rows.length ? `<section class="reg-section forecast">
          <h2 class="reg-head">Forecast</h2>
          ${statPills([
            [`Balance ${formatMoney(fc.end, a.currency)}`],
            [formatMoney(-fc.rows.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0), a.currency), 'neg'],
            [formatMoney(fc.rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0), a.currency), 'pos'],
          ])}
          <ul class="reg-list">${fc.rows.map((r) => forecastRow(r, a)).join('')}</ul>
        </section>` : ''}

        ${groups.length ? groups.slice(0, pageMonths).map((g) => `
          <section class="reg-section">
            <h2 class="reg-head">${monthHeading(g.monthId)}</h2>
            ${statPills([
              [`Balance ${formatMoney(g.end, a.currency)}`],
              [formatMoney(-g.spending, a.currency), 'neg'],
              [formatMoney(g.income, a.currency), 'pos'],
            ])}
            ${g.rows.length ? `<ul class="reg-list">${g.rows.map((r) => txRow(r.tx, { delta: r.delta, balance: r.balance, cur: a.currency })).join('')}</ul>`
              : `<p class="hint reg-empty">No transactions · started with ${formatMoney(g.opening, a.currency)}</p>`}
          </section>`).join('') : `<section class="group-card">${emptyState('No transactions yet', `Tap <b>+</b> to add one to ${esc(a.name)}.`)}</section>`}
        ${groups.length > pageMonths ? '<button class="btn btn-ghost btn-block" data-act="reg-more">Show earlier months</button>' : ''}
      </div>
    </main>`;
}

function forecastRow(r, a) {
  const p = r.item;
  return `<li><div class="reg-row tappable ${r.projected ? '' : ''}" ${r.projected ? '' : `data-act="fc-open" data-month="${r.monthId}" data-id="${esc(p.id)}"`}>
    ${square(p.kind === 'income' ? '#34c759' : '#a2845e', 'repeat')}
    <div class="reg-main">
      <span class="reg-title">${esc(p.description)}</span>
      <span class="reg-date">${longDate(r.date)} <span class="chip-forecast ${r.overdue ? 'late' : ''}">${r.overdue ? 'overdue' : 'forecast'}</span></span>
    </div>
    <div class="reg-end"><span class="mw-amt ${r.delta < 0 ? 'neg' : 'pos'}">${formatMoney(Math.abs(r.delta), a.currency)}</span>
      <span class="mw-sub">${formatMoney(r.balance, a.currency)}</span></div>
  </div></li>`;
}

// ---------- actions ----------
async function newTx(el) {
  const t = today();
  await ensureMonth(t.monthId);
  const accountId = el?.dataset?.account;
  openTxSheet({ monthId: t.monthId, type: 'expense', prefill: accountId ? { accountId, currency: accountById(state, accountId)?.currency } : {} });
}

registerActions({
  'new-tx': (el) => newTx(el),
  'privacy-toggle': () => saveSettings({ privacy: !state.settings.privacy }),
  'acc-toggle-hidden': () => { showHidden = !showHidden; rerender(); },
  'reg-more': () => { pageMonths += 6; rerender(); },
  'acc-new-here': async () => {
    const id = today().monthId;
    await ensureMonth(id);
    openAccountSheet({ monthId: id });
  },
  'acc-menu': async (el) => {
    const a = accountById(state, el.dataset.id);
    if (!a) return;
    const id = today().monthId;
    await ensureMonth(id);
    const choice = await chooseDialog({
      title: a.name,
      options: [
        { key: 'edit', label: 'Edit account', primary: true },
        { key: 'balance', label: 'Reconcile balance', hint: 'Type what your bank shows — the difference is saved as a correction' },
        { key: 'transfer', label: 'Transfer money from this account' },
        { key: 'import', label: 'Import transactions into this account' },
      ],
    });
    if (choice === 'edit') openAccountSheet({ account: a, monthId: id });
    else if (choice === 'balance') reconcileSheet(a, id);
    else if (choice === 'transfer') openTxSheet({ monthId: id, type: 'transfer', prefill: { accountId: a.id } });
    else if (choice === 'import') openImportSheet(a.id);
  },
  'fc-open': (el) => {
    const m = state.months[el.dataset.month];
    const p = m?.plan.find((x) => x.id === el.dataset.id);
    if (p) recordPlan(m.id, p);
  },
});

function reconcileSheet(a, monthId) {
  const cur = balancesNow(state, monthId)[a.id] || 0;
  openSheet({
    title: `Reconcile ${a.name}`,
    body: `<p class="hint">The app says <b>${formatMoney(cur, a.currency)}</b>. Type the balance your bank or wallet shows right now.</p>
      <label class="field"><span class="label">Real balance <span class="cur-tag">${a.currency}</span></span>
        <input class="input input-amount" name="real" inputmode="decimal" value="${centsToInput(cur)}" autofocus></label>`,
    submitLabel: 'Reconcile',
    onSubmit: async (form) => {
      const p = parseAmount(form.real.value, { allowNegative: true, allowZero: true });
      if (!p.ok) return fieldError(form, 'real', p.error);
      const changed = await setBalances(monthId, { [a.id]: p.cents }, 'Reconciliation');
      toast(changed ? 'Balance reconciled' : 'Already matches');
    },
  });
}

// ---------- live search (no full redraw, so the keyboard stays up) ----------
let searchTimer = null;
document.addEventListener('input', (e) => {
  const input = e.target.closest?.('[data-search]');
  if (!input) return;
  const scope = input.dataset.search;
  search[scope] = input.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const box = document.querySelector(`[data-search-results="${scope}"]`);
    if (!box) return;
    const q = input.value.trim();
    const accName = box.dataset.acc ? accountById(state, box.dataset.acc)?.name : null;
    box.innerHTML = q ? searchResults(accName ? `${q}, @${accName}` : q) : '';
    document.querySelector('[data-hide-on-search]')?.toggleAttribute('hidden', !!q);
  }, 120);
});

export function resetAccountSearch() { search.account = ''; pageMonths = 6; }
