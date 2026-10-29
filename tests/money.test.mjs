import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseRate, toAllCents, convertCents, combinedAll, formatMoney, centsToInput } from '../js/money.js';

test('parseAmount accepts common formats', () => {
  const ok = (s, cents) => assert.deepEqual(parseAmount(s), { ok: true, cents }, s);
  ok('1500', 150000);
  ok('12.50', 1250);
  ok('12,5', 1250);
  ok('0.99', 99);
  ok('1,250.50', 125050);
  ok('1.250,50', 125050);
  ok('1,250,000', 125000000);
  ok('1 250', 125000);
  ok('€12.30', 1230);
  ok('2500 ALL', 250000);
});

test('parseAmount rejects invalid or ambiguous input', () => {
  for (const s of ['', '  ', 'abc', '12.500', '12,345', '1.2.3,4', '-5', '0', '12.3.4', '1e5', '1,25,000']) {
    assert.equal(parseAmount(s).ok, false, `should reject "${s}"`);
  }
  assert.equal(parseAmount('99999999999999').ok, false, 'too large');
});

test('parseAmount options for balances', () => {
  assert.deepEqual(parseAmount('-250', { allowNegative: true }), { ok: true, cents: -25000 });
  assert.deepEqual(parseAmount('0', { allowZero: true }), { ok: true, cents: 0 });
});

test('parseRate', () => {
  assert.deepEqual(parseRate('97.5'), { ok: true, rate: 97.5 });
  assert.deepEqual(parseRate('97,25'), { ok: true, rate: 97.25 });
  assert.equal(parseRate('0').ok, false);
  assert.equal(parseRate('-1').ok, false);
  assert.equal(parseRate('abc').ok, false);
});

test('currency conversion EUR → ALL uses the given rate and rounds to the cent', () => {
  assert.equal(toAllCents(1000, 'EUR', 97.5), 97500); // €10 → 975 ALL
  assert.equal(toAllCents(1, 'EUR', 97.555), 98); // €0.01 → 0.98 ALL (rounded)
  assert.equal(toAllCents(5000, 'ALL', 97.5), 5000); // ALL untouched
  assert.equal(convertCents(97500, 'ALL', 'EUR', 97.5), 1000);
  assert.equal(convertCents(1000, 'EUR', 'EUR', 97.5), 1000);
  assert.throws(() => toAllCents(100, 'EUR', 0));
  assert.throws(() => toAllCents(100, 'USD', 97));
});

test('USD support: parse, format, convert via ALL', () => {
  assert.deepEqual(parseAmount('$12.50'), { ok: true, cents: 1250 });
  assert.equal(formatMoney(1250, 'USD'), '$12.50');
  const rates = { EUR: 97, USD: 90 };
  assert.equal(toAllCents(1000, 'USD', rates), 90000);
  assert.equal(convertCents(1000, 'USD', 'EUR', rates), 928); // $10 = 900 ALL = €9.28
  assert.equal(combinedAll({ ALL: 100, EUR: 100, USD: 100 }, rates), 100 + 9700 + 9000);
  assert.throws(() => toAllCents(100, 'USD', 97), 'a bare number is only the EUR rate');
});

test('combinedAll never adds raw EUR to ALL', () => {
  // 10,000 ALL + €100 at 97 = 10,000 + 9,700 = 19,700 ALL (not 10,100)
  assert.equal(combinedAll({ ALL: 1000000, EUR: 10000 }, 97), 1970000);
});

test('formatting', () => {
  assert.equal(formatMoney(1250000, 'ALL'), '12,500 ALL');
  assert.equal(formatMoney(1250050, 'ALL'), '12,500.50 ALL');
  assert.equal(formatMoney(4500, 'EUR'), '€45.00');
  assert.equal(formatMoney(-4500, 'EUR'), '−€45.00');
  assert.equal(formatMoney(4500, 'EUR', { plus: true }), '+€45.00');
  assert.equal(centsToInput(1250), '12.50');
  assert.equal(centsToInput(150000), '1500');
  assert.equal(centsToInput(-5), '-0.05');
});
