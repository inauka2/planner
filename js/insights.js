// Pure read-only views over the ledger for the Accounts, Scheduled and Reports screens:
// balances now, account registers, scheduled items, forecast, report data and search.
// No DOM, no storage — unit tested in tests/insights.test.mjs.
import {
  monthSummary, openingInfo, closingBalances, monthTxs, txEffects, getRates, monthBounds, makeMonthId,
  parseMonthId, prevMonthId, nextMonthId, sourceMonthId, priceOf, zero, accountById, MONTH_NAMES,
} from './ledger.js';
import { combinedAll, convertCents, toAllCents } from './money.js';
import { LIABILITY_KINDS } from './defaults.js';

const pad2 = (n) => String(n).padStart(2, '0');
const txOrder = (a, b) => (a.date + a.time + (a.createdAt || '')).localeCompare(b.date + b.time + (b.createdAt || ''));

// ---------- balances ----------
/** Month whose closing is "now": today's month if it exists, else the latest earlier one. */
export function currentBalanceMonth(state, todayMonthId) {
  if (state.months[todayMonthId]) return todayMonthId;
  return sourceMonthId(state, todayMonthId);
}

/** Per-account balances as of today's month ({} when there is no data yet). */
export function balancesNow(state, todayMonthId) {
  const id = currentBalanceMonth(state, todayMonthId);
  return id ? closingBalances(state, id) : {};
}

/** Cents in `currency` → display currency, using the given rates. */
export function toDisplay(cents, currency, display, rates) {
  try { return convertCents(cents, currency, display, rates); } catch { return 0; }
}

/** Sum a {ALL, EUR, USD} pair in a display currency. */
export function pairIn(pair, display, rates) {
  const all = combinedAll(pair, rates);
  return display === 'ALL' ? all : toDisplay(all, 'ALL', display, rates);
}

// ---------- account register ----------
/**
 * One account's transactions, newest first, grouped by month, each with the running balance
 * after it. Every group has { monthId, rows: [{ tx, delta, balance }], income, spending, end }.
 */
export function accountRegister(state, accId) {
  const months = Object.keys(state.months).sort();
  const groups = [];
  for (const id of months) {
    const open = openingInfo(state, id).balances[accId] || 0;
    const txs = monthTxs(state, id).filter((t) => t.accountId === accId || t.toAccountId === accId).sort(txOrder);
    let bal = open;
    let income = 0;
    let spending = 0;
    const rows = [];
    for (const t of txs) {
      let delta = 0;
      for (const [a, d] of txEffects(t)) if (a === accId) delta += d;
      bal += delta;
      if (delta > 0) income += delta; else spending -= delta;
      rows.push({ tx: t, delta, balance: bal });
    }
    if (rows.length || open) groups.push({ monthId: id, opening: open, rows: rows.reverse(), income, spending, end: bal });
  }
  return groups.reverse();
}

/** All transactions, newest first, grouped by month. */
export function allRegister(state) {
  const byMonth = new Map();
  for (const t of [...state.transactions].sort(txOrder).reverse()) {
    if (!byMonth.has(t.monthId)) byMonth.set(t.monthId, []);
    byMonth.get(t.monthId).push(t);
  }
  return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([monthId, txs]) => {
    const s = state.months[monthId] ? monthSummary(state, monthId) : null;
    return { monthId, txs, income: s?.income ?? zero(), spending: s?.spending ?? zero(), rates: getRates(state, monthId) };
  });
}

// ---------- scheduled (bills, subscriptions, expected income) ----------
/** Due date of a planned item in its month, or null when it has no due day. */
export function dueDate(monthId, p) {
  if (!p.dueDay) return null;
  const { days } = monthBounds(monthId);
  return `${monthId}-${pad2(Math.min(Math.max(1, p.dueDay), days))}`;
}

/** Planned items that belong on the Scheduled screen: recurring, dated, or income. */
export const isScheduled = (p) => !!(p.recurring || p.dueDay || p.kind === 'income');

/**
 * The month's scheduled items with their state:
 * { item, due, status: 'paid' | 'overdue' | 'today' | 'upcoming' | 'nodate' }.
 */
export function scheduledItems(state, monthId, today) {
  const m = state.months[monthId];
  if (!m) return [];
  return (m.plan || []).filter(isScheduled).map((p) => {
    const due = dueDate(monthId, p);
    let status = 'upcoming';
    if (p.paid) status = 'paid';
    else if (!due) status = 'nodate';
    else if (due < today) status = 'overdue';
    else if (due === today) status = 'today';
    return { item: p, monthId, due, status };
  }).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.item.description.localeCompare(b.item.description));
}

/**
 * Upcoming unpaid planned money from today to `until` (inclusive): this month's and later
 * months' unpaid items with an amount. Months that don't exist yet repeat the latest month's
 * recurring items. Items without a due day count at the end of their month; overdue unpaid
 * items count today.
 * Returns [{ id, monthId, date, item, projected }] sorted by date.
 */
export function upcoming(state, today, until) {
  const out = [];
  let id = today.slice(0, 7);
  const lastId = until.slice(0, 7);
  let template = null;
  for (let guard = 0; id <= lastId && guard < 36; guard++, id = nextMonthId(id)) {
    const m = state.months[id];
    let items;
    let projected = false;
    if (m) {
      items = (m.plan || []).filter((p) => !p.paid && p.amount);
      template = m;
    } else {
      const src = template || state.months[sourceMonthId(state, id)];
      items = (src?.plan || []).filter((p) => p.recurring && p.amount);
      projected = true;
    }
    for (const p of items) {
      let date = dueDate(id, p) || monthBounds(id).last;
      const overdue = date < today; // still unpaid: it will be paid from now on
      if (overdue) date = today;
      if (date > until) continue;
      out.push({ id: projected ? `proj:${id}:${p.id}` : p.id, monthId: id, date, item: p, projected, overdue });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Forecast for one account: its balance now, then each upcoming planned item paid from it.
 * `accountFor(item)` says which account an item uses (its own, or the default for its currency).
 */
export function accountForecast(state, accId, today, until, accountFor) {
  const acc = accountById(state, accId);
  if (!acc) return { rows: [], start: 0, end: 0 };
  const start = balancesNow(state, today.slice(0, 7))[accId] || 0;
  let bal = start;
  const rows = [];
  for (const u of upcoming(state, today, until)) {
    if (accountFor(u.item) !== accId) continue;
    const rates = getRates(state, u.monthId);
    const amt = toDisplay(u.item.amount, u.item.currency, acc.currency, rates);
    const delta = u.item.kind === 'income' ? amt : -amt;
    bal += delta;
    rows.push({ ...u, delta, balance: bal });
  }
  return { rows, start, end: bal };
}

/** Net worth (in `display`) on a future date: today's balances plus everything planned until then. */
export function forecastTotal(state, today, until, display) {
  const monthId = today.slice(0, 7);
  const rates = getRates(state, currentBalanceMonth(state, monthId) || monthId);
  const bal = balancesNow(state, monthId);
  let total = 0;
  for (const [accId, cents] of Object.entries(bal)) {
    const a = accountById(state, accId);
    if (a) total += toDisplay(cents, a.currency, display, rates);
  }
  let income = 0;
  let expense = 0;
  for (const u of upcoming(state, today, until)) {
    const v = toDisplay(u.item.amount, u.item.currency, display, getRates(state, u.monthId));
    if (u.item.kind === 'income') income += v; else expense += v;
  }
  return { now: total, income, expense, end: total + income - expense };
}

// ---------- reports ----------
export const PERIODS = { '1m': 'This month', '3m': 'Last 3 months', '6m': 'Last 6 months', '1y': 'Last 12 months', ytd: 'This year', all: 'All time' };

/** Month ids covered by a period, oldest first, ending at `endMonthId`. */
export function periodMonths(state, period, endMonthId) {
  const back = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[period];
  const out = [];
  if (back) {
    let id = endMonthId;
    for (let i = 0; i < back; i++) { out.unshift(id); id = prevMonthId(id); }
    return out;
  }
  if (period === 'ytd') {
    const { year, month } = parseMonthId(endMonthId);
    for (let mm = 1; mm <= month; mm++) out.push(makeMonthId(year, mm));
    return out;
  }
  const ids = Object.keys(state.months).filter((k) => k <= endMonthId).sort();
  return ids.length ? ids : [endMonthId];
}

export const monthShort = (id) => `${MONTH_NAMES[parseMonthId(id).month - 1].slice(0, 3)} ${String(parseMonthId(id).year).slice(2)}`;

/** Latest name of a category id across months. */
export function categoryName(state, catId) {
  if (!catId) return 'Not categorised';
  const ids = Object.keys(state.months).sort().reverse();
  for (const id of ids) {
    const c = state.months[id].categories?.find((x) => x.id === catId);
    if (c) return c.name;
  }
  return 'Other';
}

export function subcategoryName(state, catId, listId) {
  for (const id of Object.keys(state.months).sort().reverse()) {
    const l = state.months[id].categories?.find((x) => x.id === catId)?.lists?.find((x) => x.id === listId);
    if (l) return l.name;
  }
  return null;
}

/** Spending per category over months, in `display`. [{ id, name, total, perMonth: {monthId: cents} }] */
export function spendingByCategory(state, monthIds, display) {
  const map = new Map();
  for (const id of monthIds) {
    if (!state.months[id]) continue;
    const s = monthSummary(state, id);
    for (const [cid, pair] of Object.entries(s.byCategory)) {
      const v = pairIn(pair, display, s.rates);
      if (!map.has(cid)) map.set(cid, { id: cid, name: categoryName(state, cid), total: 0, perMonth: {} });
      const r = map.get(cid);
      r.total += v;
      r.perMonth[id] = (r.perMonth[id] || 0) + v;
    }
  }
  return [...map.values()].filter((r) => r.total).sort((a, b) => b.total - a.total);
}

const normKey = (s) => String(s || '').trim().toLowerCase();

/** Expense or income transactions grouped by payee (description). */
export function byPayee(state, monthIds, display, type = 'expense') {
  const set = new Set(monthIds);
  const map = new Map();
  for (const t of state.transactions) {
    if (t.type !== type || !set.has(t.monthId)) continue;
    const key = normKey(t.description) || '—';
    const v = toDisplay(t.amount, t.currency, display, getRates(state, t.monthId));
    if (!map.has(key)) map.set(key, { name: t.description || '—', total: 0, count: 0 });
    const r = map.get(key);
    r.total += v;
    r.count++;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Per-month income, spending and net, in `display`. */
export function cashFlow(state, monthIds, display) {
  let cumulative = 0;
  return monthIds.map((id) => {
    if (!state.months[id]) return { id, income: 0, spending: 0, net: 0, cumulative };
    const s = monthSummary(state, id);
    const income = pairIn(s.income, display, s.rates);
    const spending = pairIn(s.spending, display, s.rates);
    cumulative += income - spending;
    return { id, income, spending, net: income - spending, cumulative };
  });
}

/** Net worth at the end of each month, split into assets and liabilities, in `display`. */
export function netWorth(state, monthIds, display) {
  return monthIds.map((id) => {
    const src = state.months[id] ? id : sourceMonthId(state, id);
    if (!src) return { id, assets: 0, liabilities: 0, total: 0, empty: true };
    const bal = closingBalances(state, src);
    const rates = getRates(state, src);
    let assets = 0;
    let liabilities = 0;
    for (const [accId, cents] of Object.entries(bal)) {
      const a = accountById(state, accId);
      if (!a) continue;
      const v = toDisplay(cents, a.currency, display, rates);
      if (v < 0 || LIABILITY_KINDS.includes(a.kind)) liabilities += v; else assets += v;
    }
    return { id, assets, liabilities, total: assets + liabilities };
  });
}

/**
 * Profit & loss table: income rows (by payee), expense rows (by category, then subcategory),
 * one column per month plus a total. Values are in `display`; expenses are negative.
 */
export function profitAndLoss(state, monthIds, display) {
  const set = new Set(monthIds);
  const income = new Map();
  const expense = new Map();
  const add = (map, key, label, monthId, v, extra = {}) => {
    if (!map.has(key)) map.set(key, { key, label, perMonth: {}, total: 0, ...extra });
    const r = map.get(key);
    r.perMonth[monthId] = (r.perMonth[monthId] || 0) + v;
    r.total += v;
  };
  for (const t of state.transactions) {
    if (!set.has(t.monthId)) continue;
    const v = toDisplay(t.amount, t.currency, display, getRates(state, t.monthId));
    if (t.type === 'income') add(income, normKey(t.description) || '—', t.description || 'Income', t.monthId, v);
    else if (t.type === 'expense') {
      const cid = t.categoryId || '';
      add(expense, cid, categoryName(state, cid), t.monthId, -v, { catId: cid, sub: null });
      if (t.listId) {
        const sub = subcategoryName(state, cid, t.listId);
        if (sub) add(expense, `${cid}/${t.listId}`, sub, t.monthId, -v, { catId: cid, sub: true });
      }
    }
  }
  const incomeRows = [...income.values()].sort((a, b) => b.total - a.total);
  const parents = [...expense.values()].filter((r) => !r.sub).sort((a, b) => a.total - b.total);
  const expenseRows = [];
  for (const p of parents) {
    expenseRows.push(p);
    expenseRows.push(...[...expense.values()].filter((r) => r.sub && r.catId === p.catId).sort((a, b) => a.total - b.total));
  }
  const sum = (rows) => {
    const perMonth = {};
    let total = 0;
    for (const r of rows) {
      if (r.sub) continue;
      for (const [k, v] of Object.entries(r.perMonth)) perMonth[k] = (perMonth[k] || 0) + v;
      total += r.total;
    }
    return { perMonth, total };
  };
  const ti = sum(incomeRows);
  const te = sum(expenseRows);
  const net = { perMonth: {}, total: ti.total + te.total };
  for (const id of monthIds) net.perMonth[id] = (ti.perMonth[id] || 0) + (te.perMonth[id] || 0);
  return { incomeRows, expenseRows, totalIncome: ti, totalExpense: te, net };
}

/** Budget vs spent per category for one month, in `display`. */
export function budgetStatus(state, monthId, plan, display) {
  const m = state.months[monthId];
  const s = monthSummary(state, monthId);
  return (m.categories || []).map((c) => {
    const planned = pairIn(plan.byCategory[c.id] || zero(), display, s.rates);
    const spent = pairIn(s.byCategoryPrice[c.id] || zero(), display, s.rates);
    return { cat: c, planned, spent, left: planned - spent, ratio: planned ? spent / planned : spent ? Infinity : 0 };
  });
}

// ---------- search ----------
/**
 * Parse a search like "coffee, >100, <01/02/2026, #work, @Cash".
 *   text        matches description, notes, category, account, tags
 *   >N / <N     price above / below N
 *   >date / <date   on or after / on or before (dd/mm/yyyy, dd.mm.yyyy or yyyy-mm-dd)
 *   #tag        has that tag      @name   uses an account whose name contains it
 */
export function parseSearch(q) {
  const f = { text: [], min: null, max: null, from: null, to: null, tags: [], accounts: [] };
  for (const raw of String(q || '').split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = tok.match(/^([<>])\s*(.+)$/);
    if (m) {
      const date = parseDate(m[2]);
      const num = Number(m[2].replace(',', '.'));
      if (date) f[m[1] === '>' ? 'from' : 'to'] = date;
      else if (Number.isFinite(num)) f[m[1] === '>' ? 'min' : 'max'] = Math.round(num * 100);
      continue;
    }
    if (tok[0] === '#' && tok.length > 1) { f.tags.push(tok.slice(1).toLowerCase()); continue; }
    if (tok[0] === '@' && tok.length > 1) { f.accounts.push(tok.slice(1).toLowerCase()); continue; }
    f.text.push(tok.toLowerCase());
  }
  return f;
}

function parseDate(s) {
  let m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  return null;
}

export function searchTransactions(state, q) {
  const f = parseSearch(q);
  if (!f.text.length && f.min == null && f.max == null && !f.from && !f.to && !f.tags.length && !f.accounts.length) return [];
  const accName = (id) => accountById(state, id)?.name?.toLowerCase() || '';
  return state.transactions.filter((t) => {
    const price = priceOf(t).amount;
    if (f.min != null && !(price > f.min)) return false;
    if (f.max != null && !(price < f.max)) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    const tags = (t.tags || []).map((x) => x.toLowerCase());
    if (f.tags.some((tag) => !tags.includes(tag))) return false;
    if (f.accounts.some((a) => !accName(t.accountId).includes(a) && !accName(t.toAccountId).includes(a))) return false;
    if (f.text.length) {
      const hay = [t.description, t.notes, categoryName(state, t.categoryId), accName(t.accountId), accName(t.toAccountId), ...tags].join(' ').toLowerCase();
      if (f.text.some((w) => !hay.includes(w))) return false;
    }
    return true;
  }).sort(txOrder).reverse();
}

// ---------- calendar ----------
/** Per day of a month: amount spent (past) and amount scheduled (unpaid), in `display`. */
export function calendarMonth(state, monthId, today, display) {
  const { days } = monthBounds(monthId);
  const rates = getRates(state, monthId);
  const out = {};
  for (let d = 1; d <= days; d++) out[`${monthId}-${pad2(d)}`] = { spent: 0, income: 0, due: 0, dueIncome: 0, items: [] };
  for (const t of state.transactions) {
    if (t.monthId !== monthId || !out[t.date]) continue;
    const v = toDisplay(t.amount, t.currency, display, rates);
    if (t.type === 'expense') out[t.date].spent += v;
    if (t.type === 'income') out[t.date].income += v;
  }
  for (const s of scheduledItems(state, monthId, today)) {
    if (!s.due || !out[s.due]) continue;
    out[s.due].items.push(s);
    if (s.status === 'paid' || !s.item.amount) continue;
    const v = toDisplay(s.item.amount, s.item.currency, display, rates);
    if (s.item.kind === 'income') out[s.due].dueIncome += v; else out[s.due].due += v;
  }
  return out;
}

export { toAllCents };
