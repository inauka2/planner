// Pure accounting rules — no DOM, no storage. Everything here is unit tested.
//
// Rules implemented:
//  - Planned items (month.plan) never count as spending; only transactions do.
//  - expense:  money leaves one of my accounts            → counts as spending (once)
//  - income:   money arrives in one of my accounts        → counts as income when recorded (= received)
//  - transfer: money moves between my own accounts        → never spending (ATM, savings, exchange)
//  - adjust:   a balance correction (+/-)                 → never spending or income
//  - Money owed to me lives outside the ledger until it is received (then it becomes income).
//  - closing balance = opening balance + effects of the month's transactions
//  - A month's opening is either entered manually or carried from the closing of the
//    latest earlier month (its confirmed snapshot when closed, otherwise its live closing).

import { combinedAll, isCurrency } from './money.js';

export const TX_TYPES = ['expense', 'income', 'transfer', 'adjust'];
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- month ids ----------
export const makeMonthId = (year, month) => `${year}-${pad2(month)}`;
export const isMonthId = (id) => /^\d{4}-(0[1-9]|1[0-2])$/.test(id);

export function parseMonthId(id) {
  const [year, month] = id.split('-').map(Number);
  return { year, month };
}

export function prevMonthId(id) {
  let { year, month } = parseMonthId(id);
  month -= 1;
  if (month < 1) { month = 12; year -= 1; }
  return makeMonthId(year, month);
}

export function nextMonthId(id) {
  let { year, month } = parseMonthId(id);
  month += 1;
  if (month > 12) { month = 1; year += 1; }
  return makeMonthId(year, month);
}

export function monthBounds(id) {
  const { year, month } = parseMonthId(id);
  const days = new Date(year, month, 0).getDate();
  return { first: `${id}-01`, last: `${id}-${pad2(days)}`, days };
}

export function localDateParts(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    monthId: makeMonthId(d.getFullYear(), d.getMonth() + 1),
  };
}

// ---------- helpers ----------
export const zero = () => ({ ALL: 0, EUR: 0 });

export function sourceMonthId(state, id) {
  let best = null;
  for (const k of Object.keys(state.months)) if (k < id && (!best || k > best)) best = k;
  return best;
}

export function nextExistingMonthId(state, id) {
  let best = null;
  for (const k of Object.keys(state.months)) if (k > id && (!best || k < best)) best = k;
  return best;
}

export function monthTxs(state, id) {
  return state.transactions.filter((t) => t.monthId === id);
}

export function getRate(state, id) {
  const m = state.months[id];
  return m?.closing?.rate ?? m?.rate ?? state.settings.defaultRate;
}

export function accountById(state, id) {
  return state.settings.accounts.find((a) => a.id === id);
}

/** The balance changes a single transaction causes: [[accountId, cents], ...] */
export function txEffects(tx) {
  switch (tx.type) {
    case 'expense': return [[tx.accountId, -tx.amount]];
    case 'income': return [[tx.accountId, tx.amount]];
    case 'transfer': return [[tx.accountId, -tx.amount], [tx.toAccountId, tx.toAmount ?? tx.amount]];
    case 'adjust': return [[tx.accountId, tx.amount]];
    default: return [];
  }
}

export function applyTransactions(opening, txs) {
  const b = { ...opening };
  for (const tx of txs) for (const [acc, d] of txEffects(tx)) b[acc] = (b[acc] || 0) + d;
  return b;
}

/** Sum per-account balances into {ALL, EUR} using each account's currency. */
export function byCurrency(state, balances) {
  const r = zero();
  for (const [id, cents] of Object.entries(balances)) {
    const acc = accountById(state, id);
    if (acc) r[acc.currency] += cents;
  }
  return r;
}

// ---------- opening / closing ----------
export function openingInfo(state, id, depth = 0) {
  const m = state.months[id];
  const manual = { balances: { ...(m?.openingBalances || {}) }, status: 'manual', from: null };
  if (!m || m.openingMode !== 'carried' || depth > 1200) return manual;
  const src = sourceMonthId(state, id);
  if (!src) return manual;
  const s = state.months[src];
  if (s.closing) return { balances: { ...s.closing.balances }, status: 'confirmed', from: src };
  return { balances: closingBalances(state, src, depth + 1), status: 'provisional', from: src };
}

export function closingBalances(state, id, depth = 0) {
  return applyTransactions(openingInfo(state, id, depth).balances, monthTxs(state, id));
}

// ---------- month summary ----------
export function monthSummary(state, id) {
  const txs = monthTxs(state, id);
  const rate = getRate(state, id);
  const open = openingInfo(state, id);
  const closingBal = applyTransactions(open.balances, txs);
  const kind = (accId) => accountById(state, accId)?.kind;

  const income = zero();
  const spending = zero();
  const adjust = zero();
  const exchange = zero(); // net per-currency effect of cross-currency transfers
  const savings = zero(); // net moved into savings accounts
  const byCategory = {};
  const daily = {};

  for (const t of txs) {
    if (t.type === 'expense') {
      spending[t.currency] += t.amount;
      (byCategory[t.categoryId || ''] ??= zero())[t.currency] += t.amount;
      (daily[t.date] ??= zero())[t.currency] += t.amount;
    } else if (t.type === 'income') {
      income[t.currency] += t.amount;
    } else if (t.type === 'transfer') {
      const toAmount = t.toAmount ?? t.amount;
      const toCur = t.toCurrency ?? t.currency;
      if (toCur !== t.currency) {
        exchange[t.currency] -= t.amount;
        exchange[toCur] += toAmount;
      }
      const fromSav = kind(t.accountId) === 'savings';
      const toSav = kind(t.toAccountId) === 'savings';
      if (toSav && !fromSav) savings[toCur] += toAmount;
      if (fromSav && !toSav) savings[t.currency] -= t.amount;
    } else if (t.type === 'adjust') {
      adjust[t.currency] += t.amount;
    }
  }

  const opening = byCurrency(state, open.balances);
  const closing = byCurrency(state, closingBal);
  const all = (pair) => combinedAll(pair, rate);

  return {
    id, rate, count: txs.length,
    openingStatus: open.status, openingFrom: open.from,
    openingBalances: open.balances, closingBalances: closingBal,
    opening, closing, income, spending, adjust, exchange, savings, byCategory, daily,
    all: {
      opening: all(opening), closing: all(closing), income: all(income),
      spending: all(spending), savings: all(savings),
    },
  };
}

/** Spending per month for a year (ALL equivalent at each month's own rate). */
export function yearOverview(state, year) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const id = makeMonthId(year, m);
    if (!state.months[id]) { months.push({ id, exists: false }); continue; }
    const s = monthSummary(state, id);
    months.push({
      id, exists: true, active: s.count > 0, closed: !!state.months[id].closing,
      rate: s.rate, spending: s.spending, income: s.income,
      spendingAll: s.all.spending, incomeAll: s.all.income,
    });
  }
  const active = months.filter((m) => m.active);
  let highest = null;
  let lowest = null;
  for (const m of active) {
    if (!highest || m.spendingAll > highest.spendingAll) highest = m;
    if (!lowest || m.spendingAll < lowest.spendingAll) lowest = m;
  }
  const totalAll = active.reduce((s, m) => s + m.spendingAll, 0);
  return { months, highest: active.length > 1 ? highest : null, lowest: active.length > 1 ? lowest : null, totalAll };
}

// ---------- plan ----------
export function planTotals(month) {
  const expense = zero();
  const income = zero();
  const unpaid = zero();
  const notReceived = zero();
  const byCategory = {};
  for (const p of month.plan || []) {
    if (!p.amount) continue; // things to buy may have no estimated price
    if (p.kind === 'income') {
      income[p.currency] += p.amount;
      if (!p.paid) notReceived[p.currency] += p.amount;
    } else {
      expense[p.currency] += p.amount;
      if (!p.paid) unpaid[p.currency] += p.amount;
      (byCategory[p.categoryId] ??= zero())[p.currency] += p.amount;
    }
  }
  return { expense, income, unpaid, notReceived, byCategory };
}

// ---------- guards (keep closed months consistent) ----------
/** Can transactions / financial plan of this month be changed? */
export function canEdit(state, id) {
  const m = state.months[id];
  if (m?.closing) return { ok: false, reason: 'This month is closed. Reopen it in Summary to make changes.' };
  const next = nextExistingMonthId(state, id);
  const n = next && state.months[next];
  if (n && n.openingMode === 'carried' && n.closing) {
    return { ok: false, reason: `${monthLabel(next)} is closed and carries its opening balance from here. Reopen ${monthLabel(next)} first.` };
  }
  return { ok: true };
}

export function canClose(state, id) {
  const m = state.months[id];
  if (!m) return { ok: false, reason: 'Month not found.' };
  if (m.closing) return { ok: false, reason: 'Already closed.' };
  if (m.openingMode === 'carried') {
    const src = sourceMonthId(state, id);
    if (src && !state.months[src].closing) {
      return { ok: false, reason: `Close ${monthLabel(src)} first — this month's opening balance comes from it.` };
    }
  }
  return { ok: true };
}

export function canReopen(state, id) {
  const m = state.months[id];
  if (!m?.closing) return { ok: false, reason: 'This month is not closed.' };
  const next = nextExistingMonthId(state, id);
  const n = next && state.months[next];
  if (n && n.openingMode === 'carried' && n.closing) {
    return { ok: false, reason: `Reopen ${monthLabel(next)} first — it carries its opening balance from this month.` };
  }
  return { ok: true };
}

/**
 * Build the closing snapshot for a month. If confirmed balances differ from the
 * computed ones, balance-correction transactions are created so that
 * opening + transactions == confirmed closing (books always reconcile).
 */
export function buildClosing(state, id, confirmed, rate, { makeId, now }) {
  const computed = closingBalances(state, id);
  const { last } = monthBounds(id);
  const ids = new Set([...state.settings.accounts.map((a) => a.id), ...Object.keys(computed)]);
  const balances = {};
  const adjustments = [];
  for (const accId of ids) {
    const acc = accountById(state, accId);
    if (!acc) continue;
    const target = confirmed[accId] ?? computed[accId] ?? 0;
    const diff = target - (computed[accId] || 0);
    balances[accId] = target;
    if (diff !== 0) {
      adjustments.push({
        id: makeId(), monthId: id, type: 'adjust', amount: diff, currency: acc.currency,
        accountId: accId, description: 'Closing correction', date: last, time: '23:59',
        createdAt: now, updatedAt: now,
      });
    }
  }
  const after = { ...state, transactions: [...state.transactions, ...adjustments] };
  const s = monthSummary({ ...after, months: { ...state.months, [id]: { ...state.months[id], rate } } }, id);
  const closing = {
    balances, rate, confirmedAt: now,
    totals: { opening: s.opening, income: s.income, spending: s.spending, closing: s.closing, spendingAll: s.all.spending },
  };
  return { closing, adjustments };
}

// ---------- validation ----------
export function validateTx(tx, accounts) {
  const acc = (id) => accounts.find((a) => a.id === id);
  if (!TX_TYPES.includes(tx.type)) return 'Unknown transaction type';
  if (!isMonthId(tx.monthId)) return 'Invalid month';
  if (!Number.isSafeInteger(tx.amount)) return 'Invalid amount';
  if (tx.type === 'adjust' ? tx.amount === 0 : tx.amount <= 0) return 'Amount must be more than 0';
  if (!isCurrency(tx.currency)) return 'Currency must be ALL or EUR';
  const from = acc(tx.accountId);
  if (!from) return 'Choose an account';
  if (from.currency !== tx.currency) return `${from.name} holds ${from.currency}, not ${tx.currency}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date || '') || !tx.date.startsWith(tx.monthId)) return 'Date must be inside this month';
  if (tx.type === 'transfer') {
    const to = acc(tx.toAccountId);
    if (!to) return 'Choose the account to transfer to';
    if (to.id === from.id) return 'Choose two different accounts';
    if (!isCurrency(tx.toCurrency) || to.currency !== tx.toCurrency) return `${to.name} holds ${to.currency}`;
    if (!Number.isSafeInteger(tx.toAmount) || tx.toAmount <= 0) return 'Enter the amount received';
    if (tx.toCurrency === tx.currency && tx.toAmount !== tx.amount) return 'Same-currency transfers must move the same amount';
  }
  return null;
}

// ---------- labels ----------
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(id) {
  const { year, month } = parseMonthId(id);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}
