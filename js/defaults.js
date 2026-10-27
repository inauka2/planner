// Default accounts, categories and lists, the month template, and data migrations.
import { sourceMonthId } from './ledger.js';

export const SCHEMA_VERSION = 2;
export const DEFAULT_RATE = 97; // 1 EUR = 97 ALL — edit it in Settings to match today's rate

export const DEFAULT_ACCOUNTS = [
  { id: 'bank1', name: 'Bank account 1', currency: 'ALL', kind: 'bank' },
  { id: 'bank2', name: 'Bank account 2', currency: 'EUR', kind: 'bank' },
  { id: 'cash_all', name: 'Cash ALL', currency: 'ALL', kind: 'cash' },
  { id: 'cash_eur', name: 'Cash EUR', currency: 'EUR', kind: 'cash' },
];

export const ACCOUNT_KINDS = { bank: 'Bank', cash: 'Cash', savings: 'Savings' };

export const SELFCARE_ID = 'selfcare';
/** Categories whose items are bills (paid, repeat monthly) rather than purchases (bought). */
export const BILL_CATEGORIES = ['necessary', 'subscriptions'];

export const DEFAULT_SELFCARE_LISTS = [
  ['clothes', 'Clothes'], ['shoes', 'Shoes'], ['hair', 'Hair'], ['skincare', 'Skincare'],
  ['face', 'Face'], ['body', 'Body'], ['tech', 'Technology'], ['other', 'Other'],
].map(([id, name]) => ({ id, name }));

export const DEFAULT_CATEGORIES = [
  { id: 'necessary', name: 'Necessary bills' },
  { id: 'subscriptions', name: 'Online Subscriptions' },
  { id: SELFCARE_ID, name: 'Self-care', lists: DEFAULT_SELFCARE_LISTS },
  { id: 'fun', name: 'Fun & Social' },
  { id: 'other', name: 'Other' },
];

export const DEFAULT_TODO_LISTS = [
  ['projects', 'Projects'], ['activities', 'Activities & Fun'], ['selfdev', 'Self-development'],
  ['health', 'Health & Exercise'], ['german', 'German Learning'], ['spiritual', 'Spiritual Goals'],
  ['other', 'Other'],
].map(([id, name]) => ({ id, name }));

export const ACTIVITIES_LIST_ID = 'activities';

export function defaultSettings() {
  return {
    schema: SCHEMA_VERSION,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    defaultRate: DEFAULT_RATE,
    defaultAccounts: {
      expense: { ALL: 'cash_all', EUR: 'cash_eur' },
      income: { ALL: 'bank1', EUR: 'bank2' },
    },
    lastCurrency: 'ALL',
    activityIdeas: [],
    lastBackupAt: null,
  };
}

/** Fill in anything missing (older data, partial backups). */
export function normalizeSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  return {
    ...d,
    ...s,
    accounts: Array.isArray(s.accounts) && s.accounts.length ? s.accounts : d.accounts,
    defaultAccounts: {
      expense: { ...d.defaultAccounts.expense, ...(s.defaultAccounts?.expense || {}) },
      income: { ...d.defaultAccounts.income, ...(s.defaultAccounts?.income || {}) },
    },
    activityIdeas: Array.isArray(s.activityIdeas) ? s.activityIdeas : [],
  };
}

const copyCategories = (cats) =>
  cats.map((c) => ({ id: c.id, name: c.name, ...(c.lists ? { lists: c.lists.map((l) => ({ id: l.id, name: l.name })) } : {}) }));

/**
 * Create a new month. Category headings (and Self-care subcategories) and to-do lists are
 * copied from the latest earlier month so custom ones carry forward; the first month uses
 * the defaults. Recurring items (bills, subscriptions, salary) are copied as NOT paid.
 */
export function createMonthRecord(state, id, makeId, now = new Date().toISOString()) {
  const srcId = sourceMonthId(state, id);
  const src = srcId ? state.months[srcId] : null;
  return {
    id,
    createdAt: now,
    rate: src?.closing?.rate ?? src?.rate ?? state.settings.defaultRate,
    openingMode: src ? 'carried' : 'manual',
    openingBalances: {},
    closing: null,
    categories: copyCategories(src?.categories?.length ? src.categories : DEFAULT_CATEGORIES),
    plan: (src?.plan || [])
      .filter((p) => p.recurring)
      .map((p) => ({ ...p, id: makeId(), paid: false, txId: null })),
    todoLists: (src?.todoLists?.length ? src.todoLists : DEFAULT_TODO_LISTS).map((l) => ({ id: l.id, name: l.name, items: [] })),
  };
}

const planKey = (p) => `${p.kind}|${p.categoryId}|${p.listId || ''}|${p.description.trim().toLowerCase()}`;

/** Recurring planned items of the latest earlier month that are not yet in this month. */
export function missingRecurring(state, id) {
  const srcId = sourceMonthId(state, id);
  if (!srcId) return [];
  const have = new Set((state.months[id]?.plan || []).map(planKey));
  return (state.months[srcId].plan || []).filter((p) => p.recurring && !have.has(planKey(p)));
}

/** Unpaid, non-recurring things-to-buy of the latest earlier month not yet in this month. */
export function missingUnfinished(state, id) {
  const srcId = sourceMonthId(state, id);
  if (!srcId) return [];
  const have = new Set((state.months[id]?.plan || []).map(planKey));
  return (state.months[srcId].plan || []).filter((p) => p.kind === 'expense' && !p.recurring && !p.paid && !have.has(planKey(p)));
}

// ---------- migrations ----------
const OLD_CATEGORY_MAP = { shopping: 'other', savings: 'other' };

/** v1 → v2: budget categories + "Things to Buy" lists merged into one spending plan. */
export function migrateMonth(m) {
  const isOld = Array.isArray(m.buyLists) || (m.categories || []).some((c) => c.id in OLD_CATEGORY_MAP);
  if (!isOld) return m;
  const names = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.name]));
  const kept = (m.categories || [])
    .filter((c) => !(c.id in OLD_CATEGORY_MAP))
    .map((c) => ({ id: c.id, name: names[c.id] ?? c.name }));
  for (const d of DEFAULT_CATEGORIES) if (!kept.some((c) => c.id === d.id)) kept.push({ id: d.id, name: d.name });
  const order = DEFAULT_CATEGORIES.map((c) => c.id);
  kept.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  const buyLists = Array.isArray(m.buyLists) ? m.buyLists : DEFAULT_SELFCARE_LISTS.map((l) => ({ ...l, items: [] }));
  const selfcare = kept.find((c) => c.id === SELFCARE_ID);
  selfcare.lists = buyLists.map((l) => ({ id: l.id, name: l.name }));

  const plan = (m.plan || []).map((p) => (p.categoryId in OLD_CATEGORY_MAP ? { ...p, categoryId: OLD_CATEGORY_MAP[p.categoryId] } : p));
  for (const l of buyLists) {
    for (const it of l.items || []) {
      plan.push({
        id: it.id, kind: 'expense', categoryId: SELFCARE_ID, listId: l.id, description: it.name,
        amount: it.price ?? null, currency: it.currency || 'ALL', priority: it.priority || null,
        recurring: false, paid: !!it.bought, txId: it.txId || null,
      });
    }
  }
  const { buyLists: _drop, ...rest } = m;
  return { ...rest, categories: kept, plan };
}

export function migrateTx(t) {
  let out = t;
  if (t.categoryId in OLD_CATEGORY_MAP) out = { ...out, categoryId: OLD_CATEGORY_MAP[t.categoryId] };
  if (t.link?.kind === 'buy') out = { ...out, link: { kind: 'plan', monthId: t.link.monthId, itemId: t.link.itemId } };
  return out;
}

/** Bring any stored/backup data up to the current schema. Returns { data, changed }. */
export function migrateData({ settings, months, transactions, receivables }) {
  let changed = false;
  const s = normalizeSettings(settings);
  if (settings && (settings.schema ?? 1) < 2) {
    changed = true;
    // The default "Savings" account is no longer part of the app; drop it if it was never used.
    const used = transactions.some((t) => t.accountId === 'savings' || t.toAccountId === 'savings') ||
      months.some((m) => m.openingBalances?.savings || m.closing?.balances?.savings);
    if (!used) s.accounts = s.accounts.filter((a) => a.id !== 'savings');
    s.schema = SCHEMA_VERSION;
  }
  const ms = months.map((m) => {
    const n = migrateMonth(m);
    if (n !== m) changed = true;
    return n;
  });
  const ts = transactions.map((t) => {
    const n = migrateTx(t);
    if (n !== t) changed = true;
    return n;
  });
  return { data: { settings: s, months: ms, transactions: ts, receivables: receivables || [] }, changed };
}
