// Accounts are created by the user (bank accounts, cash, savings — each in one currency).
// Shared by Budget and Settings.
import { state, saveSettings, updateMonth, saveTx, uid } from '../store.js';
import { monthSummary, monthTxs, txEffects, canEdit } from '../ledger.js';
import { parseAmount, centsToInput } from '../money.js';
import { ACCOUNT_KINDS } from '../defaults.js';
import { esc, openSheet, fieldError, toast, confirmDialog, currencySeg, switchRow } from '../ui.js';
import { defaultDateTime } from './txsheet.js';

export const accountUsed = (accId) =>
  state.transactions.some((t) => t.accountId === accId || t.toAccountId === accId) ||
  Object.values(state.months).some((m) => m.openingBalances?.[accId] || m.closing?.balances?.[accId]);

/**
 * Make accounts show the given balances in `monthId`. If nothing has touched an account this
 * month (and the month's opening is entered manually), its starting balance is set directly;
 * otherwise the difference is recorded as a correction (never spending or income).
 */
export async function setBalances(monthId, targets, label = 'Balance update') {
  const m = state.months[monthId];
  const sum = monthSummary(state, monthId);
  const touched = new Set();
  for (const t of monthTxs(state, monthId)) for (const [acc] of txEffects(t)) touched.add(acc);
  const opening = { ...(m.openingBalances || {}) };
  let openingChanged = false;
  const corrections = [];
  for (const [accId, target] of Object.entries(targets)) {
    const diff = target - (sum.closingBalances[accId] || 0);
    if (!diff) continue;
    const acc = state.settings.accounts.find((a) => a.id === accId);
    if (m.openingMode === 'manual' && !touched.has(accId)) {
      opening[accId] = target;
      openingChanged = true;
    } else {
      const dt = defaultDateTime(monthId);
      corrections.push({
        id: uid(), monthId, type: 'adjust', amount: diff, currency: acc.currency, accountId: accId,
        description: label, date: dt.date, time: dt.time, createdAt: new Date().toISOString(),
      });
    }
  }
  if (openingChanged) await updateMonth(monthId, (mm) => { mm.openingBalances = opening; }, { financial: true });
  for (const c of corrections) await saveTx(c);
  return openingChanged || corrections.length > 0;
}

/** Add (account = null) or edit an account. Balance changes apply to `monthId`. */
export function openAccountSheet({ account = null, monthId, kind = null, groupId = null }) {
  const a = account;
  const used = a && accountUsed(a.id);
  const editable = monthId && canEdit(state, monthId).ok;
  const current = a && monthId ? monthSummary(state, monthId).closingBalances[a.id] || 0 : 0;
  openSheet({
    title: a ? a.name : 'New account',
    body: `
      <label class="field"><span class="label">Name</span>
        <input class="input" name="accName" maxlength="40" value="${esc(a?.name ?? '')}" placeholder="e.g. Raiffeisen, Revolut, Wallet" ${a ? '' : 'autofocus'}></label>
      <div class="field"><span class="label">Currency</span>
        ${used ? `<p class="small muted">${a.currency} — fixed once money is recorded</p>` : currencySeg(a?.currency ?? 'ALL')}</div>
      <label class="field"><span class="label">Type</span>
        <select class="select" name="kind">${Object.entries(ACCOUNT_KINDS).map(([k, v]) => `<option value="${k}" ${k === (a?.kind ?? kind ?? 'bank') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field" data-limit ${(a?.kind ?? kind) === 'credit' ? '' : 'hidden'}><span class="label">Credit limit <span class="optional">optional</span></span>
        <input class="input" name="limit" inputmode="decimal" placeholder="0" value="${a?.creditLimit ? centsToInput(a.creditLimit) : ''}"></label>
      ${editable ? `<label class="field"><span class="label">${a ? 'Balance now' : 'Current balance'} <span class="optional">${a ? '' : 'optional'}</span></span>
        <input class="input input-amount" name="balance" inputmode="decimal" placeholder="0" value="${a && current ? centsToInput(current) : ''}"></label>` : ''}
      ${a ? switchRow('archived', !!a.archived, 'Hide account', 'Keeps its history, hides it from forms') : ''}
      ${a ? `<button type="button" class="btn btn-danger-ghost" data-act="acc-delete">Delete account</button>` : ''}`,
    submitLabel: a ? 'Save' : 'Add account',
    onOpen: (form) => form.addEventListener('change', (e) => {
      if (e.target.name === 'kind') form.querySelector('[data-limit]').hidden = e.target.value !== 'credit';
    }),
    actions: {
      'acc-delete': async () => {
        if (used) return toast('This account has recorded money. Hide it instead to keep your history.');
        const ok = await confirmDialog({ title: `Delete ${esc(a.name)}?`, message: 'It has no recorded money, so nothing else changes.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await saveSettings({ accounts: state.settings.accounts.filter((x) => x.id !== a.id) });
        toast('Account deleted');
      },
    },
    onSubmit: async (form) => {
      const name = form.accName.value.trim();
      if (!name) return fieldError(form, 'accName', 'Name the account');
      const currency = form.currency?.value ?? a.currency;
      let balance = null;
      if (form.balance && form.balance.value.trim()) {
        const p = parseAmount(form.balance.value, { allowNegative: true, allowZero: true });
        if (!p.ok) return fieldError(form, 'balance', p.error);
        balance = p.cents;
      }
      let creditLimit = null;
      if (form.kind.value === 'credit' && form.limit.value.trim()) {
        const p = parseAmount(form.limit.value);
        if (!p.ok) return fieldError(form, 'limit', p.error);
        creditLimit = p.cents;
      }
      const id = a?.id ?? uid();
      const record = { ...(a || {}), id, name, kind: form.kind.value, currency, archived: form.archived?.checked || false, groupId: a?.groupId ?? groupId ?? null, creditLimit };
      await saveSettings({
        accounts: a ? state.settings.accounts.map((x) => (x.id === id ? record : x)) : [...state.settings.accounts, record],
      });
      if (balance !== null && editable) await setBalances(monthId, { [id]: balance }, a ? 'Balance update' : 'Starting balance');
      toast(a ? 'Saved' : `${name} added`);
    },
  });
}
