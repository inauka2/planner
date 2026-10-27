// App state: loaded once from IndexedDB, kept in memory, written through on every change.
import * as db from './db.js';
import { normalizeSettings, createMonthRecord, migrateData } from './defaults.js';
import { canEdit, canClose, canReopen, buildClosing, validateTx } from './ledger.js';
import { makeBackup, validateBackup } from './backup.js';

export const state = {
  settings: normalizeSettings(null),
  months: {},
  transactions: [],
  receivables: [],
  hasRestorePoint: false,
  storageError: null,
  lock: null, // password hash record (never part of backups)
};

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

let onWriteError = (e) => console.error(e);
export const setWriteErrorHandler = (fn) => { onWriteError = fn; };

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

const clone = (v) => structuredClone(v);
const nowIso = () => new Date().toISOString();

export async function load() {
  try {
    const [kv, months, txs] = await Promise.all([db.getAll('kv'), db.getAll('months'), db.getAll('transactions')]);
    const kvMap = Object.fromEntries(kv.map((r) => [r.key, r.value]));
    const { data, changed } = migrateData({ settings: kvMap.settings, months, transactions: txs, receivables: kvMap.receivables });
    if (changed || !kvMap.settings) {
      await db.batch([
        { store: 'kv', value: { key: 'settings', value: data.settings } },
        ...data.months.map((m) => ({ store: 'months', value: m })),
        ...data.transactions.map((t) => ({ store: 'transactions', value: t })),
      ]);
    }
    state.settings = data.settings;
    state.receivables = data.receivables;
    state.months = Object.fromEntries(data.months.map((m) => [m.id, m]));
    state.transactions = data.transactions;
    state.hasRestorePoint = !!kvMap.restorePoint;
    state.lock = kvMap.lock || null;
    state.storageError = null;
  } catch (e) {
    console.error(e);
    state.storageError = e;
  }
}

/** Optimistically update UI, then persist. On failure, reload what is really stored. */
async function write(ops) {
  emit();
  try {
    await db.batch(ops);
  } catch (e) {
    onWriteError(e);
    await load();
    emit();
    throw e;
  }
}

const op = {
  month: (m) => ({ store: 'months', value: m }),
  tx: (t) => ({ store: 'transactions', value: t }),
  delTx: (id) => ({ store: 'transactions', delete: id }),
  settings: () => ({ store: 'kv', value: { key: 'settings', value: state.settings } }),
  receivables: () => ({ store: 'kv', value: { key: 'receivables', value: state.receivables } }),
};

function assertOk(check) {
  if (!check.ok) throw new Error(check.reason);
}

// ---------- settings ----------
export function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  return write([op.settings()]);
}

/** Exchange rate: becomes the default and applies to every open, editable month. */
export function setRate(rate) {
  state.settings = { ...state.settings, defaultRate: rate };
  const ops = [op.settings()];
  for (const m of Object.values(state.months)) {
    if (m.closing || !canEdit(state, m.id).ok || m.rate === rate) continue;
    const mm = { ...m, rate };
    state.months[m.id] = mm;
    ops.push(op.month(mm));
  }
  return write(ops);
}

// ---------- months ----------
export async function ensureMonth(id) {
  if (state.months[id]) return state.months[id];
  const m = createMonthRecord(state, id, uid);
  state.months[id] = m;
  await write([op.month(m)]);
  return m;
}

/** Mutate a copy of a month. `financial` changes are blocked on closed months. */
export function updateMonth(id, mutate, { financial = false } = {}) {
  if (financial) assertOk(canEdit(state, id));
  const m = clone(state.months[id]);
  mutate(m);
  state.months[id] = m;
  return write([op.month(m)]);
}

// ---------- transactions ----------
/** Apply the record a tx is linked to (planned item / receivable). */
function linkOps(link, txId, linked) {
  if (!link) return [];
  if (link.kind === 'receivable') {
    state.receivables = state.receivables.map((r) =>
      r.id === link.id ? { ...r, received: linked, receivedAt: linked ? nowIso() : null, txId: linked ? txId : null } : r);
    return [op.receivables()];
  }
  const m = state.months[link.monthId];
  if (!m || link.kind !== 'plan') return [];
  const mm = clone(m);
  const p = mm.plan.find((x) => x.id === link.itemId);
  if (p) { p.paid = linked; p.txId = linked ? txId : null; }
  state.months[link.monthId] = mm;
  return [op.month(mm)];
}

export function saveTx(tx, link = null) {
  assertOk(canEdit(state, tx.monthId));
  const existing = state.transactions.find((t) => t.id === tx.id);
  if (existing && existing.monthId !== tx.monthId) assertOk(canEdit(state, existing.monthId));
  const err = validateTx(tx, state.settings.accounts);
  if (err) throw new Error(err);
  const record = { ...tx, link: link ?? tx.link ?? null, updatedAt: nowIso() };
  state.transactions = existing
    ? state.transactions.map((t) => (t.id === tx.id ? record : t))
    : [...state.transactions, record];
  return write([op.tx(record), ...(link && !existing ? linkOps(link, record.id, true) : [])]);
}

/** Delete a transaction (and unlink its plan/buy/receivable). Returns an undo function. */
export async function deleteTx(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return () => {};
  assertOk(canEdit(state, t.monthId));
  state.transactions = state.transactions.filter((x) => x.id !== id);
  await write([op.delTx(id), ...linkOps(t.link, id, false)]);
  return async () => {
    assertOk(canEdit(state, t.monthId));
    state.transactions = [...state.transactions, t];
    await write([op.tx(t), ...linkOps(t.link, t.id, true)]);
  };
}

// ---------- money owed to me ----------
export function saveReceivable(r) {
  const exists = state.receivables.some((x) => x.id === r.id);
  state.receivables = exists ? state.receivables.map((x) => (x.id === r.id ? r : x)) : [...state.receivables, r];
  return write([op.receivables()]);
}

export function deleteReceivable(id) {
  state.receivables = state.receivables.filter((x) => x.id !== id);
  return write([op.receivables()]);
}

// ---------- closing ----------
export function closeMonth(id, confirmed, rate) {
  assertOk(canClose(state, id));
  const now = nowIso();
  const { closing, adjustments } = buildClosing(state, id, confirmed, rate, { makeId: uid, now });
  state.transactions = [...state.transactions, ...adjustments];
  const m = { ...state.months[id], rate, closing };
  state.months[id] = m;
  return write([...adjustments.map(op.tx), op.month(m)]);
}

export function reopenMonth(id) {
  assertOk(canReopen(state, id));
  const m = { ...state.months[id], closing: null, reopenedAt: nowIso() };
  state.months[id] = m;
  return write([op.month(m)]);
}

// ---------- backup / restore ----------
export function backupObject() {
  return makeBackup(state);
}

export async function restoreFrom(raw) {
  const { data } = migrateData(raw);
  const restorePoint = makeBackup(state); // so the restore itself can be undone
  await db.replaceAll({
    kv: [
      { key: 'settings', value: data.settings },
      { key: 'receivables', value: data.receivables },
      { key: 'restorePoint', value: restorePoint },
      ...lockKv(),
    ],
    months: data.months,
    transactions: data.transactions,
  });
  await load();
  emit();
}

export async function undoRestore() {
  const rp = await db.get('kv', 'restorePoint');
  const res = validateBackup(rp?.value);
  if (!res.ok) throw new Error('No previous data to go back to.');
  res.data = migrateData(res.data).data;
  await db.replaceAll({
    kv: [{ key: 'settings', value: res.data.settings }, { key: 'receivables', value: res.data.receivables }, ...lockKv()],
    months: res.data.months,
    transactions: res.data.transactions,
  });
  await load();
  emit();
}

// ---------- password ----------
const lockKv = () => (state.lock ? [{ key: 'lock', value: state.lock }] : []);

export async function saveLock(lock) {
  await db.batch([{ store: 'kv', value: { key: 'lock', value: lock } }]);
  state.lock = lock;
}

/** Forgotten password: wipe everything on this device (a backup can be restored afterwards). */
export async function eraseAll() {
  await db.replaceAll({ kv: [], months: [], transactions: [] });
  await load();
}

export function markBackedUp() {
  return saveSettings({ lastBackupAt: nowIso() });
}
