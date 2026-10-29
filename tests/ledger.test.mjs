import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthSummary, closingBalances, openingInfo, buildClosing, canEdit, canClose, canReopen,
  validateTx, yearOverview, planTotals, prevMonthId, nextMonthId, monthBounds,
} from '../js/ledger.js';
import { defaultSettings, createMonthRecord, missingRecurring, missingUnfinished, migrateData } from '../js/defaults.js';
import { combinedAll } from '../js/money.js';

let n = 0;
const makeId = () => `id${++n}`;
const NOW = '2026-10-31T20:00:00.000Z';

function freshState() {
  const settings = defaultSettings();
  settings.accounts.push({ id: 'savings', name: 'Savings', currency: 'EUR', kind: 'savings' });
  return { settings, months: {}, transactions: [], receivables: [] };
}
function addMonth(state, id, patch = {}) {
  state.months[id] = { ...createMonthRecord(state, id, makeId, NOW), ...patch };
  return state.months[id];
}
function tx(state, t) {
  const full = { id: makeId(), date: `${t.monthId}-15`, time: '12:00', description: '', ...t };
  if (full.type === 'transfer') {
    const acc = (id) => state.settings.accounts.find((a) => a.id === id);
    full.currency ??= acc(full.accountId).currency;
    full.toCurrency ??= acc(full.toAccountId).currency;
    full.toAmount ??= full.amount;
  } else {
    full.currency ??= state.settings.accounts.find((a) => a.id === full.accountId).currency;
  }
  const err = validateTx(full, state.settings.accounts);
  assert.equal(err, null, `invalid test tx: ${err}`);
  state.transactions.push(full);
  return full;
}
function close(state, id, confirmed = {}, rate) {
  const { closing, adjustments } = buildClosing(state, id, confirmed, rate ?? state.months[id].rate, { makeId, now: NOW });
  state.transactions.push(...adjustments);
  state.months[id] = { ...state.months[id], closing, rate: closing.rate };
  return { closing, adjustments };
}

const OCT = '2026-10';
const NOV = '2026-11';
const DEC = '2026-12';

test('month id helpers', () => {
  assert.equal(prevMonthId('2026-01'), '2025-12');
  assert.equal(nextMonthId('2026-12'), '2027-01');
  assert.equal(monthBounds('2028-02').last, '2028-02-29');
});

test('expenses are counted exactly once and reduce the paying account', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 10000000, cash_all: 500000 }, rate: 100 });
  tx(s, { monthId: OCT, type: 'expense', amount: 120000, accountId: 'cash_all' });
  tx(s, { monthId: OCT, type: 'expense', amount: 2550, accountId: 'cash_eur', currency: 'EUR' });
  const sum = monthSummary(s, OCT);
  assert.deepEqual(sum.spending, { ALL: 120000, EUR: 2550, USD: 0 });
  assert.equal(sum.all.spending, 120000 + 255000); // €25.50 * 100
  assert.equal(sum.closingBalances.cash_all, 380000);
  assert.equal(sum.closingBalances.cash_eur, -2550);
  assert.equal(sum.closingBalances.bank1, 10000000);
});

test('planned expenses never count as spending', () => {
  const s = freshState();
  const m = addMonth(s, OCT, { openingBalances: { bank1: 1000000 } });
  m.plan.push({ id: 'p1', kind: 'expense', categoryId: 'necessary', description: 'Rent', amount: 3000000, currency: 'ALL', recurring: true, paid: false });
  m.plan.push({ id: 'p2', kind: 'expense', categoryId: 'subscriptions', description: 'Netflix', amount: 1299, currency: 'EUR', recurring: true, paid: true });
  const sum = monthSummary(s, OCT);
  assert.deepEqual(sum.spending, { ALL: 0, EUR: 0, USD: 0 });
  assert.equal(sum.closingBalances.bank1, 1000000);
  const p = planTotals(m);
  assert.deepEqual(p.expense, { ALL: 3000000, EUR: 1299, USD: 0 });
  assert.deepEqual(p.unpaid, { ALL: 3000000, EUR: 0, USD: 0 });
});

test('ATM withdrawal moves money bank → cash and is NOT spending', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 5000000, cash_all: 0 } });
  tx(s, { monthId: OCT, type: 'transfer', amount: 1000000, accountId: 'bank1', toAccountId: 'cash_all', description: 'ATM withdrawal' });
  const sum = monthSummary(s, OCT);
  assert.deepEqual(sum.spending, { ALL: 0, EUR: 0, USD: 0 });
  assert.equal(sum.closingBalances.bank1, 4000000);
  assert.equal(sum.closingBalances.cash_all, 1000000);
  assert.equal(sum.closing.ALL, sum.opening.ALL, 'total ALL unchanged by a withdrawal');
});

test('spending the withdrawn cash counts once (withdrawal + cash expense)', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 5000000 } });
  tx(s, { monthId: OCT, type: 'transfer', amount: 1000000, accountId: 'bank1', toAccountId: 'cash_all' });
  tx(s, { monthId: OCT, type: 'expense', amount: 300000, accountId: 'cash_all' });
  const sum = monthSummary(s, OCT);
  assert.equal(sum.spending.ALL, 300000);
  assert.equal(sum.closing.ALL, 5000000 - 300000);
});

test('transfers to savings are not spending and are reported as saved', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank2: 200000 } });
  tx(s, { monthId: OCT, type: 'transfer', amount: 50000, accountId: 'bank2', toAccountId: 'savings' });
  const sum = monthSummary(s, OCT);
  assert.deepEqual(sum.spending, { ALL: 0, EUR: 0, USD: 0 });
  assert.deepEqual(sum.savings, { ALL: 0, EUR: 50000, USD: 0 });
  assert.equal(sum.closingBalances.savings, 50000);
  assert.equal(sum.closing.EUR, 200000);
});

test('currency exchange EUR → ALL keeps currencies separate', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { cash_eur: 10000 }, rate: 97 });
  // €100 exchanged at the bureau, received 9,650 ALL (worse than the reference rate)
  tx(s, { monthId: OCT, type: 'transfer', amount: 10000, accountId: 'cash_eur', toAccountId: 'cash_all', toAmount: 965000 });
  const sum = monthSummary(s, OCT);
  assert.deepEqual(sum.spending, { ALL: 0, EUR: 0, USD: 0 });
  assert.deepEqual(sum.closing, { ALL: 965000, EUR: 0, USD: 0 });
  assert.deepEqual(sum.exchange, { ALL: 965000, EUR: -10000, USD: 0 });
  // per-currency equation holds
  for (const c of ['ALL', 'EUR']) {
    assert.equal(sum.closing[c], sum.opening[c] + sum.income[c] - sum.spending[c] + sum.exchange[c] + sum.adjust[c]);
  }
});

test('income increases balance only when recorded; money owed is outside the ledger', () => {
  const s = freshState();
  addMonth(s, OCT);
  s.receivables.push({ id: 'r1', description: 'Ana', amount: 500000, currency: 'ALL', received: false });
  let sum = monthSummary(s, OCT);
  assert.equal(sum.closing.ALL, 0, 'owed money is not available cash');
  tx(s, { monthId: OCT, type: 'income', amount: 500000, accountId: 'cash_all', description: 'Repaid: Ana' });
  sum = monthSummary(s, OCT);
  assert.equal(sum.income.ALL, 500000);
  assert.equal(sum.closingBalances.cash_all, 500000);
});

test('closing → carryover without double counting', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 10000000, cash_eur: 20000 }, rate: 97 });
  tx(s, { monthId: OCT, type: 'income', amount: 8000000, accountId: 'bank1' });
  tx(s, { monthId: OCT, type: 'expense', amount: 2000000, accountId: 'bank1' });
  tx(s, { monthId: OCT, type: 'expense', amount: 5000, accountId: 'cash_eur', currency: 'EUR' });
  addMonth(s, NOV);
  assert.equal(s.months[NOV].openingMode, 'carried');

  // provisional carry while October is still open
  let open = openingInfo(s, NOV);
  assert.equal(open.status, 'provisional');
  assert.equal(open.balances.bank1, 16000000);

  // close October with the computed balances
  const { closing, adjustments } = close(s, OCT);
  assert.equal(adjustments.length, 0);
  assert.equal(closing.rate, 97);
  assert.equal(closing.balances.bank1, 16000000);
  assert.equal(closing.balances.cash_eur, 15000);

  open = openingInfo(s, NOV);
  assert.equal(open.status, 'confirmed');
  assert.equal(open.balances.bank1, 16000000);

  // November activity builds on the opening; October's income is not counted again
  tx(s, { monthId: NOV, type: 'expense', amount: 1000000, accountId: 'bank1' });
  const nov = monthSummary(s, NOV);
  assert.deepEqual(nov.income, { ALL: 0, EUR: 0, USD: 0 });
  assert.equal(nov.spending.ALL, 1000000);
  assert.equal(nov.closingBalances.bank1, 15000000);
  assert.equal(nov.closingBalances.cash_eur, 15000);
});

test('confirmed closing that differs creates a correction so the books reconcile', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { cash_all: 1000000 } });
  tx(s, { monthId: OCT, type: 'expense', amount: 200000, accountId: 'cash_all' });
  // Real wallet has 7,500 ALL, the app computed 8,000 ALL → −500 ALL correction
  const { adjustments } = close(s, OCT, { cash_all: 750000 });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].amount, -50000);
  assert.equal(closingBalances(s, OCT).cash_all, 750000);
  const sum = monthSummary(s, OCT);
  assert.equal(sum.spending.ALL, 200000, 'corrections are not spending');
  assert.equal(sum.adjust.ALL, -50000);
});

test('the snapshot keeps its exchange rate for historical reports', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { cash_eur: 10000 }, rate: 97 });
  tx(s, { monthId: OCT, type: 'expense', amount: 1000, accountId: 'cash_eur', currency: 'EUR' });
  close(s, OCT, {}, 98);
  s.months[OCT].rate = 120; // even if the month's rate field changes later…
  assert.equal(monthSummary(s, OCT).rate, 98); // …reports use the closing rate
  assert.equal(monthSummary(s, OCT).all.spending, 98000);
  addMonth(s, NOV);
  assert.equal(s.months[NOV].rate, 98, 'new month starts from the last closing rate');
});

test('month chain stays consistent across three months', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 1000000, cash_all: 100000, bank2: 50000 } });
  tx(s, { monthId: OCT, type: 'income', amount: 500000, accountId: 'bank1' });
  tx(s, { monthId: OCT, type: 'transfer', amount: 200000, accountId: 'bank1', toAccountId: 'cash_all' });
  tx(s, { monthId: OCT, type: 'expense', amount: 150000, accountId: 'cash_all' });
  addMonth(s, NOV);
  tx(s, { monthId: NOV, type: 'transfer', amount: 20000, accountId: 'bank2', toAccountId: 'savings' });
  tx(s, { monthId: NOV, type: 'expense', amount: 50000, accountId: 'bank1' });
  addMonth(s, DEC);
  const dec = openingInfo(s, DEC);
  assert.equal(dec.status, 'provisional');
  assert.deepEqual(
    { bank1: dec.balances.bank1, cash_all: dec.balances.cash_all, bank2: dec.balances.bank2, savings: dec.balances.savings },
    { bank1: 1000000 + 500000 - 200000 - 50000, cash_all: 100000 + 200000 - 150000, bank2: 30000, savings: 20000 },
  );
  // Total wealth only changed by income − spending
  const total = (b) => Object.values(b).reduce((a, c) => a + c, 0);
  assert.equal(total(dec.balances), 1150000 + 500000 - 150000 - 50000);
});

test('ordering guards keep closed months immutable', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 100 } });
  addMonth(s, NOV);
  assert.equal(canClose(s, NOV).ok, false, 'must close October before November');
  close(s, OCT);
  assert.equal(canEdit(s, OCT).ok, false, 'closed month is read-only');
  assert.equal(canClose(s, NOV).ok, true);
  close(s, NOV);
  assert.equal(canReopen(s, OCT).ok, false, 'November depends on October');
  assert.equal(canReopen(s, NOV).ok, true);
  s.months[NOV].closing = null;
  assert.equal(canReopen(s, OCT).ok, true);
  s.months[OCT].closing = null;
  assert.equal(canEdit(s, OCT).ok, true);
});

test('editing an open month is blocked when the next carried month is closed', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 100 } });
  addMonth(s, NOV, { openingMode: 'manual' });
  close(s, NOV);
  assert.equal(canEdit(s, OCT).ok, true, 'November is manual, so October is independent');
  s.months[NOV].openingMode = 'carried';
  assert.equal(canEdit(s, OCT).ok, false);
});

test('validateTx rejects currency/account mismatches and bad transfers', () => {
  const { accounts } = defaultSettings();
  const base = { monthId: OCT, date: '2026-10-05', time: '10:00', amount: 100 };
  assert.match(validateTx({ ...base, type: 'expense', currency: 'EUR', accountId: 'bank1' }, accounts), /holds ALL/);
  assert.match(validateTx({ ...base, type: 'expense', currency: 'ALL', accountId: 'bank1', date: '2026-11-01' }, accounts), /inside this month/);
  assert.match(validateTx({ ...base, type: 'expense', currency: 'ALL', accountId: 'bank1', amount: 0 }, accounts), /more than 0/);
  assert.match(validateTx({ ...base, type: 'transfer', currency: 'ALL', accountId: 'bank1', toAccountId: 'bank1', toCurrency: 'ALL', toAmount: 100 }, accounts), /different/);
  assert.match(validateTx({ ...base, type: 'transfer', currency: 'ALL', accountId: 'bank1', toAccountId: 'cash_all', toCurrency: 'ALL', toAmount: 90 }, accounts), /same amount/);
  assert.equal(validateTx({ ...base, type: 'transfer', currency: 'EUR', accountId: 'bank2', toAccountId: 'cash_all', toCurrency: 'ALL', toAmount: 9700 }, accounts), null);
});

test('new month template: default headings, recurring items copied unpaid', () => {
  const s = freshState();
  const oct = addMonth(s, OCT);
  assert.deepEqual(oct.categories.map((c) => c.id), ['necessary', 'subscriptions', 'selfcare', 'fun', 'other']);
  assert.equal(oct.categories.find((c) => c.id === 'selfcare').lists.length, 8);
  assert.equal(oct.todoLists.length, 7);
  assert.equal(oct.buyLists, undefined);
  assert.equal(oct.openingMode, 'manual');
  oct.categories.push({ id: 'pets', name: 'Pets' });
  oct.categories.find((c) => c.id === 'selfcare').lists.push({ id: 'nails', name: 'Nails' });
  oct.plan.push({ id: 'p1', kind: 'expense', categoryId: 'subscriptions', description: 'Spotify', amount: 699, currency: 'EUR', recurring: true, paid: true, txId: 't1' });
  oct.plan.push({ id: 'p2', kind: 'expense', categoryId: 'other', description: 'Gift', amount: 500000, currency: 'ALL', recurring: false, paid: false });
  oct.plan.push({ id: 'p3', kind: 'expense', categoryId: 'selfcare', listId: 'shoes', description: 'Boots', amount: null, currency: 'ALL', recurring: false, paid: false });
  const nov = addMonth(s, NOV);
  assert.equal(nov.categories.length, 6, 'custom category carried forward');
  assert.equal(nov.categories.find((c) => c.id === 'selfcare').lists.length, 9, 'custom subcategory carried forward');
  assert.equal(nov.plan.length, 1);
  assert.equal(nov.plan[0].description, 'Spotify');
  assert.equal(nov.plan[0].paid, false);
  assert.equal(nov.plan[0].txId, null);
  assert.notEqual(nov.plan[0].id, 'p1');
  assert.equal(oct.plan[0].paid, true, 'previous month untouched');
  assert.equal(missingRecurring(s, NOV).length, 0);
  assert.deepEqual(missingUnfinished(s, NOV).map((p) => p.id), ['p2', 'p3'], 'unpaid one-off items can be brought over');
  nov.plan = [];
  assert.equal(missingRecurring(s, NOV).length, 1);
  assert.deepEqual(planTotals(oct).expense, { ALL: 500000, EUR: 699, USD: 0 }, 'items without a price are skipped');
});

test('migration from v1: buy lists become Self-care items, old categories are folded', () => {
  const v1Month = {
    id: OCT, rate: 97, openingMode: 'manual', openingBalances: {}, closing: null,
    categories: [
      { id: 'necessary', name: 'Necessary / Monthly' }, { id: 'subscriptions', name: 'Online Payments / Subscriptions' },
      { id: 'selfcare', name: 'Self-care' }, { id: 'fun', name: 'Fun & Social' }, { id: 'shopping', name: 'Shopping / Personal' },
      { id: 'other', name: 'Other / Unexpected' }, { id: 'savings', name: 'Savings' }, { id: 'pets', name: 'Pets' },
    ],
    plan: [{ id: 'p1', kind: 'expense', categoryId: 'shopping', description: 'Bag', amount: 100, currency: 'ALL', recurring: false, paid: false }],
    buyLists: [{ id: 'shoes', name: 'Shoes', items: [{ id: 'b1', name: 'Boots', price: 900000, currency: 'ALL', priority: 'high', bought: true, txId: 't1' }] }],
    todoLists: [],
  };
  const tx = { id: 't1', monthId: OCT, type: 'expense', amount: 900000, currency: 'ALL', accountId: 'cash_all', date: '2026-10-02', time: '10:00', categoryId: 'shopping', link: { kind: 'buy', monthId: OCT, listId: 'shoes', itemId: 'b1' } };
  const { data, changed } = migrateData({ settings: { ...defaultSettings(), schema: 1, accounts: [...defaultSettings().accounts, { id: 'savings', name: 'Savings', currency: 'EUR', kind: 'savings' }] }, months: [v1Month], transactions: [tx] });
  assert.equal(changed, true);
  const m = data.months[0];
  assert.deepEqual(m.categories.map((c) => c.id), ['necessary', 'subscriptions', 'selfcare', 'fun', 'other', 'pets']);
  assert.equal(m.categories[0].name, 'Necessary bills');
  assert.deepEqual(m.categories[2].lists, [{ id: 'shoes', name: 'Shoes' }]);
  assert.equal(m.buyLists, undefined);
  assert.equal(m.plan.find((p) => p.id === 'p1').categoryId, 'other');
  const boots = m.plan.find((p) => p.id === 'b1');
  assert.deepEqual([boots.categoryId, boots.listId, boots.amount, boots.paid, boots.txId, boots.priority], ['selfcare', 'shoes', 900000, true, 't1', 'high']);
  assert.deepEqual(data.transactions[0].link, { kind: 'plan', monthId: OCT, itemId: 'b1' });
  assert.equal(data.transactions[0].categoryId, 'other');
  assert.equal(data.settings.accounts.some((a) => a.id === 'savings'), false, 'unused Savings account removed');
  assert.equal(data.settings.accounts.some((a) => a.currency === 'USD'), true, 'USD account added');
  assert.equal(data.settings.usdRate > 0, true);
  assert.equal(migrateData(data).changed, false, 'migration is idempotent');
});

test('year overview finds highest and lowest spending months', () => {
  const s = freshState();
  addMonth(s, '2026-08', { rate: 100 });
  addMonth(s, '2026-09', { rate: 100 });
  addMonth(s, OCT, { rate: 100 });
  tx(s, { monthId: '2026-08', type: 'expense', amount: 500000, accountId: 'cash_all' });
  tx(s, { monthId: '2026-09', type: 'expense', amount: 10000, accountId: 'cash_eur', currency: 'EUR' }); // €100 = 10,000 ALL
  tx(s, { monthId: OCT, type: 'expense', amount: 100000, accountId: 'cash_all' });
  const y = yearOverview(s, 2026);
  assert.equal(y.highest.id, '2026-09');
  assert.equal(y.lowest.id, OCT);
  assert.equal(y.totalAll, 500000 + 1000000 + 100000);
});

test('US dollars: separate balance, converted with their own rate, carried over on close', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { cash_usd: 10000, cash_all: 100000 }, rate: 97, usdRate: 90 });
  tx(s, { monthId: OCT, type: 'expense', amount: 2500, accountId: 'cash_usd' }); // $25
  // $50 exchanged, received 4,400 ALL
  tx(s, { monthId: OCT, type: 'transfer', amount: 5000, accountId: 'cash_usd', toAccountId: 'cash_all', toAmount: 440000 });
  const sum = monthSummary(s, OCT);
  assert.deepEqual(sum.spending, { ALL: 0, EUR: 0, USD: 2500 });
  assert.deepEqual(sum.closing, { ALL: 540000, EUR: 0, USD: 2500 });
  assert.equal(sum.all.spending, 225000, '$25 × 90 = 2,250 ALL');
  const { closing } = close(s, OCT, {}, { EUR: 98, USD: 91 });
  assert.equal(closing.usdRate, 91);
  assert.equal(monthSummary(s, OCT).all.spending, 227500, 'closed month keeps its USD rate');
  addMonth(s, NOV);
  assert.equal(s.months[NOV].usdRate, 91);
  assert.equal(openingInfo(s, NOV).balances.cash_usd, 2500);
});

test('random ledgers always satisfy the balance equation per currency', () => {
  const s = freshState();
  addMonth(s, OCT, { openingBalances: { bank1: 999999, bank2: 12345, cash_all: 0, cash_eur: 500, savings: 100 }, rate: 97.3 });
  const accs = s.settings.accounts;
  let seed = 42;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % k; };
  for (let i = 0; i < 300; i++) {
    const a = accs[rnd(accs.length)];
    const type = ['expense', 'income', 'transfer', 'adjust'][rnd(4)];
    const amount = 1 + rnd(100000);
    if (type === 'transfer') {
      let b = accs[rnd(accs.length)];
      if (b.id === a.id) b = accs[(accs.indexOf(a) + 1) % accs.length];
      const toAmount = a.currency === b.currency ? amount : 1 + rnd(1000000);
      tx(s, { monthId: OCT, type, amount, accountId: a.id, toAccountId: b.id, toAmount });
    } else {
      tx(s, { monthId: OCT, type, amount: type === 'adjust' && rnd(2) ? -amount : amount, accountId: a.id });
    }
  }
  const sum = monthSummary(s, OCT);
  for (const c of ['ALL', 'EUR', 'USD']) {
    assert.equal(sum.closing[c], sum.opening[c] + sum.income[c] - sum.spending[c] + sum.exchange[c] + sum.adjust[c], c);
  }
  assert.equal(sum.all.closing, combinedAll(sum.closing, sum.rates));
});
