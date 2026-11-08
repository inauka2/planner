// Accounts tab: grouped accounts with totals, net worth, "All Transactions", search,
// money owed to me, and each account's register (forecast + month sections, running balance).
import { state, saveSettings, uid, ensureMonth } from '../store.js';
import { localDateParts, getRates, accountById, nextMonthId, monthBounds } from '../ledger.js';
import { formatMoney, centsToInput, parseAmount, CURRENCIES, CURRENCY_NAMES } from '../money.js';
import { icon } from '../icons.js';
import { KIND_GROUPS, LIABILITY_KINDS } from '../defaults.js';
import { esc, registerActions, openSheet, fieldError, toast, confirmDialog, chooseDialog, emptyState, rerender } from '../ui.js';
import { routes } from '../routes.js';
import {
  balancesNow, currentBalanceMonth, accountRegister, allRegister, accountForecast, searchTransactions, toDisplay, pairIn,
} from '../insights.js';
import {
  topBar, pillBtn, privacyBtn, statusLine, accountSquare, square, txRow, statPills, monthHeading, searchField, longDate,
} from './chrome.js';
import { openTxSheet } from './txsheet.js';
import { openAccountSheet, setBalances } from './accounts.js';
import { planAccount, recordPlan } from './plan.js';
import { openImportSheet } from './importer.js';

const COLLAPSE_KEY = 'planner.collapsed';
let collapsed = new Set();
try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { /* private mode */ }
const saveCollapsed = () => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* ignore */ } };

let showHidden = false;
let pageMonths = 6; // month sections shown in a register before "Show earlier"
export const search = { accounts: '', all: '', account: '' };

const today = () => localDateParts();
const ratesNow = () => {
  const id = currentBalanceMonth(state, today().monthId);
  return getRates(state, id || today().monthId);
};

/** Accounts arranged in groups: custom groups first, then one group per account type. */
export function accountGroups() {
  const accs = state.settings.accounts.filter((a) => showHidden || !a.archived);
  const custom = (state.settings.accountGroups || []).map((g) => ({ key: `g:${g.id}`, id: g.id, name: g.name, custom: true, accounts: accs.filter((a) => a.groupId === g.id) }));
  const known = new Set(custom.map((g) => g.id));
  const byKind = Object.entries(KIND_GROUPS).map(([kind, name]) => ({
    key: `k:${kind}`, name, kind, accounts: accs.filter((a) => (!a.groupId || !known.has(a.groupId)) && (a.kind || 'other') === kind),
  }));
  return [...custom, ...byKind].filter((g) => g.accounts.length || g.custom);
}

/** One total for a group: in its single currency, else ≈ ALL. */
function groupTotal(accounts, bal, rates) {
  const curs = [...new Set(accounts.map((a) => a.currency))];
  if (curs.length === 1) return { cents: accounts.reduce((s, a) => s + (bal[a.id] || 0), 0), cur: curs[0], approx: false };
  return { cents: accounts.reduce((s, a) => s + toDisplay(bal[a.id] || 0, a.currency, 'ALL', rates), 0), cur: 'ALL', approx: true };
}

// ---------- accounts overview ----------
export function renderAccounts() {
  const t = today();
  const bal = balancesNow(state, t.monthId);
  const rates = ratesNow();
  const groups = accountGroups();
  const hidden = new Set(state.settings.hiddenGroups || []);
  const totals = { ALL: 0, EUR: 0, USD: 0 };
  for (const g of groups) {
    if (hidden.has(g.key)) continue;
    for (const a of g.accounts) if (!a.archived) totals[a.currency] += bal[a.id] || 0;
  }
  const net = pairIn(totals, 'ALL', rates);
  const archivedCount = state.settings.accounts.filter((a) => a.archived).length;
  const last = state.settings.lastBackupAt;
  const daysSince = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  const needsBackup = state.transactions.length > 0 && (daysSince === null || daysSince > 30);
  const q = search.accounts;

  return `
    ${topBar({ title: 'Accounts', subtitle: statusLine(), inlineTitle: true, buttons: [
      privacyBtn(),
      pillBtn({ act: 'acc-view-menu', ic: 'sliders', label: 'View options' }),
      pillBtn({ act: 'group-new', ic: 'folder-plus', label: 'New group' }),
      pillBtn({ act: 'new-tx', ic: 'plus', label: 'New transaction', primary: true }),
    ] })}
    <main class="content">
      ${state.storageError ? `<div class="banner danger">Storage is unavailable (${esc(state.storageError.message)}). Changes can’t be saved. In Safari, turn off Private Browsing.</div>` : ''}
      ${needsBackup ? `<a class="banner" href="${routes.settings()}">${icon('download')} <span>${daysSince === null ? 'You haven’t made a backup yet.' : `Last backup was ${daysSince} days ago.`} <b>Back up now</b></span></a>` : ''}

      <section class="net-card">
        <div class="net-cols">
          <div><p class="cap">Net worth</p><p class="net-big ${net < 0 ? 'neg' : ''}"><span class="mw-amt">≈ ${formatMoney(net, 'ALL')}</span></p></div>
        </div>
        <div class="net-cur">${CURRENCIES.filter((c) => c === 'ALL' || totals[c] || state.settings.accounts.some((a) => a.currency === c)).map((c) => `
          <span><span class="cap">${CURRENCY_NAMES[c]}</span><span class="mw-amt ${totals[c] < 0 ? 'neg' : ''}">${formatMoney(totals[c], c)}</span></span>`).join('')}</div>
      </section>

      <div class="search-wrap">
        ${searchField('accounts', q, 'Search: coffee, >100, #tag, @Cash')}
        <div data-search-results="accounts">${q ? searchResults(q) : ''}</div>
      </div>

      <div data-hide-on-search ${q ? 'hidden' : ''}>
        <a class="all-tx" href="${routes.allTransactions()}">${icon('list')}<span>All Transactions</span>${icon('chev-right')}</a>

        ${groups.length ? groups.map((g) => groupCard(g, bal, rates, hidden.has(g.key))).join('') : `<section class="group-card">${emptyState('Add your accounts', 'Bank accounts, cash, savings, cards and loans — each in its own currency.', '<button class="btn btn-primary" data-act="acc-new-here">Add account</button>')}</section>`}

        ${owedCard()}

        <div class="stack">
          <button class="text-btn" data-act="acc-new-here">${icon('plus')} Add account</button>
          ${archivedCount ? `<button class="text-btn" data-act="acc-toggle-hidden">${showHidden ? 'Hide' : 'Show'} ${archivedCount} hidden account${archivedCount > 1 ? 's' : ''}</button>` : ''}
        </div>
      </div>
    </main>`;
}

function groupCard(g, bal, rates, excluded) {
  const open = !collapsed.has(g.key);
  const tot = groupTotal(g.accounts.filter((a) => !a.archived), bal, rates);
  return `<section class="group-card ${open ? 'open' : ''}">
    <div class="group-head">
      <button class="group-toggle" data-act="group-toggle" data-key="${esc(g.key)}" aria-expanded="${open}">
        ${icon(open ? 'tri-down' : 'tri-right', 'tri')}<span class="group-name">${esc(g.name)}</span>
      </button>
      <span class="total-pill ${excluded ? 'off' : ''} ${tot.cents < 0 ? 'neg' : ''}">
        <span class="mw-amt">${tot.approx ? '≈ ' : ''}${formatMoney(tot.cents, tot.cur)}</span>
        <button data-act="group-eye" data-key="${esc(g.key)}" aria-label="${excluded ? 'Include in net worth' : 'Leave out of net worth'}">${icon(excluded ? 'eye-off' : 'eye')}</button>
      </span>
      ${g.custom ? `<button class="round-btn sm" data-act="group-edit" data-id="${esc(g.id)}" aria-label="Edit group">${icon('more')}</button>` : ''}
    </div>
    ${open ? `<ul class="acc-list">${g.accounts.map((a) => accountRow(a, bal[a.id] || 0)).join('')}
      ${g.custom && !g.accounts.length ? `<li class="acc-empty">No accounts yet. Choose this group when you edit an account.</li>` : ''}</ul>` : ''}
  </section>`;
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

function owedCard() {
  const open = state.receivables.filter((r) => !r.received);
  const key = 'owed';
  const isOpen = !collapsed.has(key);
  const totals = { ALL: 0, EUR: 0, USD: 0 };
  open.forEach((r) => { totals[r.currency] += r.amount; });
  const text = CURRENCIES.filter((c) => totals[c]).map((c) => formatMoney(totals[c], c)).join(' · ') || formatMoney(0, 'ALL');
  const monthId = today().monthId;
  return `<section class="group-card ${isOpen ? 'open' : ''}">
    <div class="group-head">
      <button class="group-toggle" data-act="group-toggle" data-key="${key}" aria-expanded="${isOpen}">
        ${icon(isOpen ? 'tri-down' : 'tri-right', 'tri')}<span class="group-name">Owed to me</span>
      </button>
      <span class="total-pill owed"><span class="mw-amt">${text}</span></span>
    </div>
    ${isOpen ? `<ul class="acc-list">
      ${open.map((r) => `<li><button class="acc-row" data-act="owed-open" data-id="${esc(r.id)}" data-month="${monthId}">
        ${square('#ff9f0a', 'kind-owed')}
        <span class="acc-main"><span class="acc-name">${esc(r.description)}</span><span class="acc-bal"><span class="mw-amt">${formatMoney(r.amount, r.currency)}</span></span></span>
      </button></li>`).join('')}
      <li><button class="acc-row add" data-act="owed-add">${icon('plus')}<span>Someone owes me money</span></button></li>
    </ul>` : ''}
  </section>`;
}

function searchResults(q) {
  const res = searchTransactions(state, q);
  if (!res.length) return `<p class="hint search-none">No transactions match “${esc(q)}”.</p>`;
  return `<p class="section-cap">${res.length} result${res.length > 1 ? 's' : ''}</p>
    <ul class="reg-list">${res.slice(0, 200).map((t) => txRow(t)).join('')}</ul>`;
}

// ---------- all transactions ----------
export function renderAllTransactions() {
  const q = search.all;
  const groups = allRegister(state);
  return `
    ${topBar({ back: routes.accounts(), center: '<span class="center-title">All Transactions</span>', buttons: [
      pillBtn({ act: 'new-tx', ic: 'plus', label: 'New transaction', primary: true }),
    ] })}
    <main class="content">
      <div class="search-wrap">
        ${searchField('all', q)}
        <div data-search-results="all">${q ? searchResults(q) : ''}</div>
      </div>
      <div data-hide-on-search ${q ? 'hidden' : ''}>
        ${groups.length ? groups.slice(0, pageMonths).map((g) => `
          <section class="reg-section">
            <h2 class="reg-head">${monthHeading(g.monthId)}</h2>
            ${statPills([
              [`Spent ${formatMoney(pairIn(g.spending, 'ALL', g.rates), 'ALL')}`, 'neg'],
              [`Income ${formatMoney(pairIn(g.income, 'ALL', g.rates), 'ALL')}`, 'pos'],
            ])}
            <ul class="reg-list">${g.txs.map((t) => txRow(t)).join('')}</ul>
          </section>`).join('') : `<section class="group-card">${emptyState('No transactions yet', 'Tap <b>+</b> to add an expense, income or transfer.')}</section>`}
        ${groups.length > pageMonths ? '<button class="btn btn-ghost btn-block" data-act="reg-more">Show earlier months</button>' : ''}
      </div>
    </main>`;
}

// ---------- one account ----------
export function renderAccount(accId) {
  const a = accountById(state, accId);
  if (!a) {
    return `${topBar({ back: routes.accounts() })}<main class="content"><section class="group-card">${emptyState('Account not found', '', `<a class="btn btn-primary" href="${routes.accounts()}">Back to accounts</a>`)}</section></main>`;
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
  'group-toggle': (el) => {
    const k = el.dataset.key;
    if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
    saveCollapsed();
    rerender();
  },
  'group-eye': (el) => {
    const k = el.dataset.key;
    const hidden = new Set(state.settings.hiddenGroups || []);
    if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
    return saveSettings({ hiddenGroups: [...hidden] });
  },
  'acc-toggle-hidden': () => { showHidden = !showHidden; rerender(); },
  'reg-more': () => { pageMonths += 6; rerender(); },
  'acc-new-here': async () => {
    const id = today().monthId;
    await ensureMonth(id);
    openAccountSheet({ monthId: id });
  },
  'acc-view-menu': async () => {
    const archived = state.settings.accounts.filter((a) => a.archived).length;
    const choice = await chooseDialog({
      title: 'Accounts',
      options: [
        { key: 'add', label: 'Add account', primary: true },
        { key: 'import', label: 'Import transactions', hint: 'CSV, OFX, QFX or QIF file from your bank' },
        ...(archived ? [{ key: 'hidden', label: `${showHidden ? 'Hide' : 'Show'} hidden accounts (${archived})` }] : []),
        { key: 'expand', label: collapsed.size ? 'Expand all groups' : 'Collapse all groups' },
      ],
    });
    if (choice === 'add') {
      const id = today().monthId;
      await ensureMonth(id);
      openAccountSheet({ monthId: id });
    } else if (choice === 'import') openImportSheet();
    else if (choice === 'hidden') { showHidden = !showHidden; rerender(); }
    else if (choice === 'expand') {
      if (collapsed.size) collapsed.clear();
      else for (const g of accountGroups()) collapsed.add(g.key);
      saveCollapsed();
      rerender();
    }
  },
  'group-new': () => groupSheet(null),
  'group-edit': (el) => groupSheet((state.settings.accountGroups || []).find((g) => g.id === el.dataset.id)),
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

function groupSheet(g) {
  openSheet({
    title: g ? 'Edit group' : 'New group',
    body: `<label class="field"><span class="label">Name</span>
        <input class="input" name="gname" maxlength="40" value="${esc(g?.name ?? '')}" placeholder="e.g. My cards, Family, Business" autofocus></label>
      <p class="hint">Put accounts in this group from each account’s settings. Accounts without a group are grouped by type.</p>
      ${g ? '<button type="button" class="btn btn-danger-ghost" data-act="group-delete">Delete group</button>' : ''}`,
    actions: {
      'group-delete': async () => {
        const ok = await confirmDialog({ title: `Delete “${esc(g.name)}”?`, message: 'Its accounts stay and go back to being grouped by type.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await saveSettings({
          accountGroups: state.settings.accountGroups.filter((x) => x.id !== g.id),
          accounts: state.settings.accounts.map((a) => (a.groupId === g.id ? { ...a, groupId: null } : a)),
        });
        toast('Group deleted');
      },
    },
    onSubmit: async (form) => {
      const name = form.gname.value.trim();
      if (!name) return fieldError(form, 'gname', 'Name the group');
      const groups = state.settings.accountGroups || [];
      await saveSettings({ accountGroups: g ? groups.map((x) => (x.id === g.id ? { ...x, name } : x)) : [...groups, { id: uid(), name }] });
      toast(g ? 'Saved' : 'Group added');
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
