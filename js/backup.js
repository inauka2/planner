// Backup (JSON), restore validation and CSV export. Nothing is ever uploaded:
// files are handed to the iOS share sheet / browser download only.
import { TX_TYPES, isMonthId, getRate, monthLabel } from './ledger.js';
import { isCurrency, toAllCents, centsToInput } from './money.js';
import { SCHEMA_VERSION, normalizeSettings } from './defaults.js';

export const BACKUP_APP_ID = 'monthly-planner';

export function makeBackup(state) {
  return {
    app: BACKUP_APP_ID,
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    receivables: state.receivables,
    months: Object.values(state.months).sort((a, b) => a.id.localeCompare(b.id)),
    transactions: [...state.transactions].sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id)),
  };
}

/** Validate a parsed backup file. Returns { ok, data } or { ok:false, error }. */
export function validateBackup(obj) {
  const fail = (error) => ({ ok: false, error });
  if (!obj || typeof obj !== 'object') return fail('This file is not a planner backup.');
  if (obj.app !== BACKUP_APP_ID) return fail('This file is not a planner backup.');
  if (typeof obj.schema !== 'number' || obj.schema > SCHEMA_VERSION) {
    return fail('This backup was made by a newer version of the app. Update the app first.');
  }
  if (!obj.settings || !Array.isArray(obj.settings.accounts)) return fail('Backup is missing accounts.');
  if (!Array.isArray(obj.months) || !Array.isArray(obj.transactions)) return fail('Backup is incomplete.');

  const accIds = new Set();
  for (const a of obj.settings.accounts) {
    if (!a || typeof a.id !== 'string' || !isCurrency(a.currency)) return fail('Backup has an invalid account.');
    accIds.add(a.id);
  }
  const monthIds = new Set();
  for (const m of obj.months) {
    if (!m || !isMonthId(m.id)) return fail('Backup has an invalid month.');
    if (monthIds.has(m.id)) return fail(`Month ${m.id} appears twice.`);
    monthIds.add(m.id);
  }
  const txIds = new Set();
  for (const t of obj.transactions) {
    const bad = !t || typeof t.id !== 'string' || txIds.has(t.id) || !TX_TYPES.includes(t.type) ||
      !isMonthId(t.monthId) || !Number.isSafeInteger(t.amount) || !isCurrency(t.currency) ||
      !accIds.has(t.accountId) || (t.type === 'transfer' && !accIds.has(t.toAccountId));
    if (bad) return fail('Backup contains an invalid transaction.');
    txIds.add(t.id);
  }
  return {
    ok: true,
    data: {
      settings: normalizeSettings(obj.settings),
      receivables: Array.isArray(obj.receivables) ? obj.receivables : [],
      months: obj.months,
      transactions: obj.transactions,
    },
    summary: { months: obj.months.length, transactions: obj.transactions.length, exportedAt: obj.exportedAt },
  };
}

const TYPE_LABEL = { expense: 'Expense', income: 'Income', transfer: 'Transfer', adjust: 'Balance correction' };

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of transactions (all, or a single month). Amounts in original currency. */
export function toCsv(state, monthId = null) {
  const accName = (id) => state.settings.accounts.find((a) => a.id === id)?.name ?? '';
  const catName = (t) => state.months[t.monthId]?.categories?.find((c) => c.id === t.categoryId)?.name ?? '';
  const rows = [[
    'Date', 'Time', 'Month', 'Type', 'Description', 'Amount', 'Currency', 'Account',
    'To account', 'Amount received', 'Received currency', 'Category',
    'Rate (1 EUR = x ALL)', 'ALL equivalent',
  ]];
  const txs = state.transactions
    .filter((t) => !monthId || t.monthId === monthId)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  for (const t of txs) {
    const rate = getRate(state, t.monthId);
    const signed = t.type === 'expense' ? -t.amount : t.amount;
    rows.push([
      t.date, t.time, monthLabel(t.monthId), TYPE_LABEL[t.type], t.description,
      centsToInput(signed), t.currency, accName(t.accountId),
      t.type === 'transfer' ? accName(t.toAccountId) : '',
      t.type === 'transfer' ? centsToInput(t.toAmount) : '',
      t.type === 'transfer' ? t.toCurrency : '',
      t.type === 'expense' ? catName(t) : '',
      rate,
      t.type === 'transfer' ? '' : centsToInput(toAllCents(signed, t.currency, rate)),
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Hand a file to the user: iOS share sheet ("Save to Files") or a normal download. */
export async function saveFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && typeof File === 'function' && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
