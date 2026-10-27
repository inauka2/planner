import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeBackup, validateBackup, toCsv } from '../js/backup.js';
import { defaultSettings, createMonthRecord } from '../js/defaults.js';

function sample() {
  const state = { settings: defaultSettings(), months: {}, transactions: [], receivables: [] };
  state.months['2026-10'] = createMonthRecord(state, '2026-10', () => 'x');
  state.months['2026-10'].rate = 97;
  state.transactions.push(
    { id: 't1', monthId: '2026-10', type: 'expense', amount: 125000, currency: 'ALL', accountId: 'cash_all', description: 'Groceries, "big" shop', date: '2026-10-03', time: '18:20', categoryId: 'necessary' },
    { id: 't2', monthId: '2026-10', type: 'transfer', amount: 1000000, currency: 'ALL', accountId: 'bank1', toAccountId: 'cash_all', toAmount: 1000000, toCurrency: 'ALL', description: 'ATM withdrawal', date: '2026-10-01', time: '09:00' },
    { id: 't3', monthId: '2026-10', type: 'expense', amount: 1299, currency: 'EUR', accountId: 'bank2', description: 'Netflix', date: '2026-10-02', time: '08:00' },
  );
  return state;
}

test('backup round-trips through JSON and validation', () => {
  const state = sample();
  const json = JSON.stringify(makeBackup(state));
  const res = validateBackup(JSON.parse(json));
  assert.equal(res.ok, true);
  assert.equal(res.data.transactions.length, 3);
  assert.equal(res.data.months[0].id, '2026-10');
  assert.equal(res.data.settings.accounts.length, 4);
});

test('validation rejects foreign or corrupted files', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup({ hello: 1 }).ok, false);
  const b = makeBackup(sample());
  assert.equal(validateBackup({ ...b, schema: 999 }).ok, false);
  const bad = structuredClone(b);
  bad.transactions[0].accountId = 'nope';
  assert.equal(validateBackup(bad).ok, false);
  const dup = structuredClone(b);
  dup.transactions.push(dup.transactions[0]);
  assert.equal(validateBackup(dup).ok, false);
});

test('CSV export keeps original currencies, escapes text and sorts by time', () => {
  const csv = toCsv(sample());
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^2026-10-01,09:00,October 2026,Transfer,ATM withdrawal,10000,ALL,Bank account 1,Cash ALL,10000,ALL,,97,$/);
  assert.match(lines[2], /Netflix,-12.99,EUR,Bank account 2/);
  assert.match(lines[2], /,97,-1260.03$/); // €12.99 × 97 = 1,260.03 ALL equivalent
  assert.match(lines[3], /"Groceries, ""big"" shop",-1250,ALL/);
  assert.match(lines[3], /Necessary bills/);
});

test('service worker precaches every app file', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = [
    ...readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `./js/${f}`),
    ...readdirSync(new URL('../js/views/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `./js/views/${f}`),
    './css/app.css', './index.html', './manifest.webmanifest',
  ];
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `sw.js is missing ${f}`);
});
