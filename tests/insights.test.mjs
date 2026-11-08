import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balancesNow, accountRegister, allRegister, scheduledItems, upcoming, accountForecast, forecastTotal,
  periodMonths, spendingByCategory, cashFlow, netWorth, profitAndLoss, parseSearch, searchTransactions, calendarMonth, dueDate,
} from '../js/insights.js';
import { defaultSettings, createMonthRecord } from '../js/defaults.js';
import { parseCsv, parseOfx, parseQif, parseBankDate, dedupe, parseStatement } from '../js/importer.js';

let n = 0;
const makeId = () => `id${++n}`;
const NOW = '2026-11-01T10:00:00.000Z';

function freshState() {
  const settings = defaultSettings();
  settings.accounts = [
    { id: 'bank', name: 'Raiffeisen', currency: 'ALL', kind: 'bank' },
    { id: 'cash', name: 'Wallet', currency: 'ALL', kind: 'cash' },
    { id: 'eur', name: 'Revolut', currency: 'EUR', kind: 'bank' },
    { id: 'card', name: 'Visa', currency: 'ALL', kind: 'credit' },
  ];
  return { settings, months: {}, transactions: [], receivables: [] };
}
function addMonth(state, id, patch = {}) {
  state.months[id] = { ...createMonthRecord(state, id, makeId, NOW), ...patch };
  return state.months[id];
}
function tx(state, t) {
  const acc = (id) => state.settings.accounts.find((a) => a.id === id);
  const full = { id: makeId(), date: `${t.monthId}-15`, time: '12:00', description: '', ...t };
  full.currency ??= acc(full.accountId).currency;
  if (full.type === 'transfer') { full.toCurrency ??= acc(full.toAccountId).currency; full.toAmount ??= full.amount; }
  state.transactions.push(full);
  return full;
}

function sample() {
  const s = freshState();
  addMonth(s, '2026-10', { openingBalances: { bank: 100000, cash: 5000, eur: 20000 } });
  tx(s, { monthId: '2026-10', type: 'expense', amount: 2000, accountId: 'cash', categoryId: 'fun', description: 'Coffee', date: '2026-10-03', tags: ['work'] });
  tx(s, { monthId: '2026-10', type: 'income', amount: 80000, accountId: 'bank', description: 'Salary', date: '2026-10-05' });
  tx(s, { monthId: '2026-10', type: 'transfer', amount: 10000, accountId: 'bank', toAccountId: 'cash', description: 'ATM', date: '2026-10-06' });
  addMonth(s, '2026-11');
  tx(s, { monthId: '2026-11', type: 'expense', amount: 3000, accountId: 'bank', categoryId: 'necessary', description: 'Phone', date: '2026-11-02' });
  tx(s, { monthId: '2026-11', type: 'expense', amount: 1500, accountId: 'card', categoryId: 'selfcare', listId: 'hair', description: 'Haircut', date: '2026-11-03' });
  s.months['2026-11'].plan.push(
    { id: 'rent', kind: 'expense', categoryId: 'necessary', description: 'Rent', amount: 40000, currency: 'ALL', recurring: true, dueDay: 10, accountId: 'bank', paid: false },
    { id: 'net', kind: 'expense', categoryId: 'subscriptions', description: 'Netflix', amount: 1200, currency: 'EUR', recurring: true, dueDay: 31, paid: false },
    { id: 'sal', kind: 'income', categoryId: null, description: 'Salary', amount: 80000, currency: 'ALL', recurring: true, dueDay: 5, accountId: 'bank', paid: true },
    { id: 'shoes', kind: 'expense', categoryId: 'selfcare', description: 'Shoes', amount: 5000, currency: 'ALL', recurring: false, paid: false },
  );
  return s;
}

test('balances now come from the current month, or the latest earlier one', () => {
  const s = sample();
  assert.deepEqual(balancesNow(s, '2026-11'), { bank: 167000, cash: 13000, eur: 20000, card: -1500 });
  assert.equal(balancesNow(s, '2027-02').bank, 167000); // no month yet → latest earlier closing
  assert.deepEqual(balancesNow(freshState(), '2026-11'), {});
});

test('account register: newest first, running balance, month totals', () => {
  const s = sample();
  const reg = accountRegister(s, 'bank');
  assert.deepEqual(reg.map((g) => g.monthId), ['2026-11', '2026-10']);
  const oct = reg[1];
  assert.equal(oct.opening, 100000);
  assert.deepEqual(oct.rows.map((r) => [r.tx.description, r.delta, r.balance]), [['ATM', -10000, 170000], ['Salary', 80000, 180000]]);
  assert.equal(oct.income, 80000);
  assert.equal(oct.spending, 10000);
  assert.equal(reg[0].end, 167000);
  // the cash side of the ATM transfer is income for that account
  assert.equal(accountRegister(s, 'cash')[1].rows[0].delta, 10000);
});

test('all register groups by month, newest first', () => {
  const s = sample();
  const all = allRegister(s);
  assert.deepEqual(all.map((g) => g.monthId), ['2026-11', '2026-10']);
  assert.equal(all[0].txs[0].description, 'Haircut');
  assert.equal(all[1].spending.ALL, 2000);
});

test('scheduled items: recurring, dated or income; status by date', () => {
  const s = sample();
  const items = scheduledItems(s, '2026-11', '2026-11-12');
  assert.deepEqual(items.map((i) => [i.item.id, i.status, i.due]), [
    ['sal', 'paid', '2026-11-05'], ['rent', 'overdue', '2026-11-10'], ['net', 'upcoming', '2026-11-30'],
  ]);
  assert.equal(dueDate('2026-02', { dueDay: 31 }), '2026-02-28');
});

test('upcoming repeats recurring items into months that do not exist yet', () => {
  const s = sample();
  const up = upcoming(s, '2026-11-08', '2026-12-31');
  assert.deepEqual(up.map((u) => [u.item.id, u.date, u.projected]), [
    ['rent', '2026-11-10', false], ['net', '2026-11-30', false], ['shoes', '2026-11-30', false],
    ['sal', '2026-12-05', true], ['rent', '2026-12-10', true], ['net', '2026-12-31', true],
  ]);
});

test('overdue unpaid items count from today', () => {
  const s = sample();
  const up = upcoming(s, '2026-11-12', '2026-11-30');
  assert.deepEqual(up.map((u) => [u.item.id, u.date, u.overdue]), [['rent', '2026-11-12', true], ['net', '2026-11-30', false], ['shoes', '2026-11-30', false]]);
});

test('account forecast follows the item account and converts currency', () => {
  const s = sample();
  const accountFor = (p) => p.accountId || (p.currency === 'EUR' ? 'eur' : 'cash');
  const fc = accountForecast(s, 'bank', '2026-11-08', '2026-12-31', accountFor);
  assert.deepEqual(fc.rows.map((r) => [r.item.id, r.delta, r.balance]), [
    ['rent', -40000, 127000], ['sal', 80000, 207000], ['rent', -40000, 167000],
  ]);
  const eur = accountForecast(s, 'eur', '2026-11-08', '2026-11-30', accountFor);
  assert.equal(eur.end, 20000 - 1200);
});

test('forecast total adds planned income and bills up to the date', () => {
  const s = sample();
  const f = forecastTotal(s, '2026-11-08', '2026-11-30', 'ALL');
  const now = 167000 + 13000 + 20000 * 97 - 1500;
  assert.equal(f.now, now);
  assert.equal(f.expense, 40000 + 5000 + 1200 * 97);
  assert.equal(f.end, now - f.expense);
});

test('periods', () => {
  const s = sample();
  assert.deepEqual(periodMonths(s, '3m', '2026-02'), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(periodMonths(s, 'ytd', '2026-03'), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(periodMonths(s, 'all', '2026-11'), ['2026-10', '2026-11']);
});

test('reports: categories, cash flow, net worth, profit & loss', () => {
  const s = sample();
  const months = ['2026-10', '2026-11'];
  const cats = spendingByCategory(s, months, 'ALL');
  assert.deepEqual(cats.map((c) => [c.name, c.total]), [['Necessary bills', 3000], ['Fun & Social', 2000], ['Self-care', 1500]]);
  const cf = cashFlow(s, months, 'ALL');
  assert.deepEqual(cf.map((m) => [m.income, m.spending, m.net, m.cumulative]), [[80000, 2000, 78000, 78000], [0, 4500, -4500, 73500]]);
  const nw = netWorth(s, months, 'ALL');
  assert.equal(nw[1].liabilities, -1500);
  assert.equal(nw[1].total, 167000 + 13000 + 20000 * 97 - 1500);
  const pl = profitAndLoss(s, months, 'ALL');
  assert.equal(pl.totalIncome.total, 80000);
  assert.equal(pl.totalExpense.total, -6500);
  assert.equal(pl.net.perMonth['2026-11'], -4500);
  assert.deepEqual(pl.expenseRows.map((r) => r.label), ['Necessary bills', 'Fun & Social', 'Self-care', 'Hair']);
});

test('search tokens', () => {
  const s = sample();
  const f = parseSearch('coffee, >10, <01/12/2026, #Work, @wal');
  assert.deepEqual(f, { text: ['coffee'], min: 1000, max: null, from: null, to: '2026-12-01', tags: ['work'], accounts: ['wal'] });
  assert.deepEqual(searchTransactions(s, 'coffee').map((t) => t.description), ['Coffee']);
  assert.deepEqual(searchTransactions(s, '>25').map((t) => t.description), ['Phone', 'ATM', 'Salary']);
  assert.deepEqual(searchTransactions(s, '>100, <1000').map((t) => t.description), ['Salary']);
  assert.deepEqual(searchTransactions(s, '>2026-11-01').map((t) => t.description), ['Haircut', 'Phone']);
  assert.deepEqual(searchTransactions(s, '#work').map((t) => t.description), ['Coffee']);
  assert.deepEqual(searchTransactions(s, '@visa').map((t) => t.description), ['Haircut']);
  assert.deepEqual(searchTransactions(s, 'necessary').map((t) => t.description), ['Phone']); // by category name
  assert.deepEqual(searchTransactions(s, ''), []);
});

test('calendar: spent per past day, due per future day', () => {
  const s = sample();
  const cal = calendarMonth(s, '2026-11', '2026-11-08', 'ALL');
  assert.equal(cal['2026-11-02'].spent, 3000);
  assert.equal(cal['2026-11-10'].due, 40000);
  assert.equal(cal['2026-11-05'].due, 0); // salary already received
  assert.equal(cal['2026-11-30'].due, 1200 * 97);
});

// ---------- importer ----------
test('bank dates', () => {
  assert.equal(parseBankDate('2026-11-08'), '2026-11-08');
  assert.equal(parseBankDate('20261108120000[0:GMT]'), '2026-11-08');
  assert.equal(parseBankDate('03/04/2026'), '2026-04-03');
  assert.equal(parseBankDate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(parseBankDate('25/12/26', 'mdy'), '2026-12-25'); // impossible month → swapped
  assert.equal(parseBankDate('nope'), null);
});

test('CSV with amount column, quotes and semicolons', () => {
  const csv = '﻿Date;Description;Amount\n08.11.2026;"Coffee; large";-2,50\n09.11.2026;Salary;1.200,00\n;;\n';
  assert.deepEqual(parseCsv(csv), [
    { date: '2026-11-08', amount: -250, description: 'Coffee; large', notes: undefined },
    { date: '2026-11-09', amount: 120000, description: 'Salary', notes: undefined },
  ]);
});

test('CSV with debit / credit columns', () => {
  const csv = 'Booking Date,Details,Debit,Credit\n2026-11-01,Rent,400.00,\n2026-11-02,Refund,,15.50\n';
  assert.deepEqual(parseCsv(csv).map((r) => [r.description, r.amount]), [['Rent', -40000], ['Refund', 1550]]);
  assert.throws(() => parseCsv('Foo,Bar\n1,2'), /Date and Amount/);
});

test('OFX and QIF', () => {
  const ofx = '<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103<TRNAMT>-12.99<NAME>Netflix &amp; co<MEMO>Monthly</STMTTRN><STMTTRN><DTPOSTED>20261105<TRNAMT>800.00<NAME>Salary</STMTTRN></BANKTRANLIST></OFX>';
  assert.deepEqual(parseOfx(ofx), [
    { date: '2026-11-03', amount: -1299, description: 'Netflix & co', notes: 'Monthly' },
    { date: '2026-11-05', amount: 80000, description: 'Salary', notes: undefined },
  ]);
  const qif = '!Type:Bank\nD11/03/2026\nT-12.99\nPNetflix\n^\nD11/05\'2026\nT800.00\nPSalary\nMNovember\n^\n';
  assert.deepEqual(parseQif(qif).map((r) => [r.date, r.amount, r.description, r.notes]), [
    ['2026-11-03', -1299, 'Netflix', undefined], ['2026-11-05', 80000, 'Salary', 'November'],
  ]);
  assert.equal(parseStatement('x.qfx', ofx).length, 2);
});

test('dedupe skips rows already in the account', () => {
  const rows = [{ date: '2026-11-03', amount: -1299, description: 'Netflix' }, { date: '2026-11-03', amount: -1299, description: 'Netflix' }, { date: '2026-11-04', amount: -500, description: 'Bus' }];
  assert.deepEqual(dedupe(rows, [{ date: '2026-11-04', amount: -500, description: 'bus' }]).length, 1);
});
