// Add / edit transaction sheet: Expense, Income, Transfer. Kept deliberately minimal:
// a new expense needs only an amount (with currency) and a description.
import { state, saveTx, deleteTx, saveSettings, uid } from '../store.js';
import { parseAmount, centsToInput, convertCents, formatMoney, formatRate } from '../money.js';
import { canEdit, monthBounds, localDateParts, getRates, accountById } from '../ledger.js';
import { openSheet, closeSheet, fieldError, toast, esc, segmented, currencySeg, confirmDialog } from '../ui.js';
import { ACCOUNT_KINDS } from '../defaults.js';

export const accountsFor = (currency) => state.settings.accounts.filter((a) => a.currency === currency && !a.archived);

export function defaultAccount(type, currency) {
  const pref = state.settings.defaultAccounts?.[type === 'income' ? 'income' : 'expense']?.[currency];
  const list = accountsFor(currency);
  return (list.find((a) => a.id === pref) || list[0])?.id ?? null;
}

export function accountOptions(list, selected) {
  return list.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function allAccountOptions(selected) {
  return state.settings.accounts
    .filter((a) => !a.archived || a.id === selected)
    .map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)} · ${a.currency}</option>`)
    .join('');
}

/** Default date/time for a new entry in `monthId`: now, or clamped into that month. */
export function defaultDateTime(monthId) {
  const now = localDateParts();
  if (now.monthId === monthId) return { date: now.date, time: now.time };
  const { first, last } = monthBounds(monthId);
  return { date: monthId < now.monthId ? last : first, time: now.time };
}

function guard(monthId) {
  const c = canEdit(state, monthId);
  if (!c.ok) { toast(c.reason); return false; }
  return true;
}

function dateFields(monthId, date, time) {
  const { first, last } = monthBounds(monthId);
  return `<div class="row-2">
      <label class="field"><span class="label">Date</span><input class="input" type="date" name="date" value="${date}" min="${first}" max="${last}" required></label>
      <label class="field"><span class="label">Time</span><input class="input" type="time" name="time" value="${time}" required></label>
    </div>`;
}

const TITLES = { expense: 'Add expense', income: 'Add income', transfer: 'Move money' };

/**
 * @param {object} o
 * @param {string} o.monthId
 * @param {'expense'|'income'|'transfer'} [o.type]
 * @param {object} [o.tx]       existing transaction to edit
 * @param {object} [o.prefill]  { amount (cents) | amountText, currency, description, categoryId, accountId, preset }
 * @param {object} [o.link]     link to a plan item / buy item / receivable
 */
export function openTxSheet({ monthId, type = 'expense', tx = null, prefill = {}, link = null, onSaved = null }) {
  if (!guard(monthId)) return;
  const t = tx ? tx.type : type;
  if (t === 'adjust') return openAdjustmentInfo(tx);
  if (t === 'transfer') return openTransferSheet({ monthId, tx, prefill });

  const editing = !!tx;
  const month = state.months[monthId];
  const cur = tx?.currency ?? prefill.currency ?? state.settings.lastCurrency ?? 'ALL';
  const acc = tx?.accountId ?? prefill.accountId ?? defaultAccount(t, cur);
  const amountText = tx ? centsToInput(tx.amount) : prefill.amountText ?? (prefill.amount ? centsToInput(prefill.amount) : '');
  const dt = tx ? { date: tx.date, time: tx.time } : defaultDateTime(monthId);
  const catId = tx?.categoryId ?? prefill.categoryId ?? '';

  const body = `
    ${editing || link ? '' : typeSwitch(t)}
    <div class="amount-row">
      <label class="field grow"><span class="label">Amount</span>
        <input class="input input-amount" name="amount" inputmode="decimal" enterkeyhint="next" placeholder="0" value="${esc(amountText)}" ${editing ? '' : 'autofocus'}>
      </label>
      <div class="field">${currencySeg(cur)}</div>
    </div>
    <label class="field"><span class="label">${t === 'expense' ? 'What was it for?' : 'Where is it from?'}</span>
      <input class="input" name="description" maxlength="120" enterkeyhint="done"
        placeholder="${t === 'expense' ? 'Coffee, groceries, taxi…' : 'Salary, gift, refund…'}" value="${esc(tx?.description ?? prefill.description ?? '')}">
    </label>
    <label class="field field-inline"><span class="label">${t === 'expense' ? 'Paid from' : 'Received into'}</span>
      <select class="select" name="account">${accountOptions(accountsFor(cur), acc)}</select>
    </label>
    ${editing ? dateFields(monthId, dt.date, dt.time) : '<p class="hint">Date and time are recorded automatically.</p>'}
    ${t === 'expense' && (editing || catId) ? `
      <label class="field"><span class="label">Category <span class="optional">optional</span></span>
        <select class="select" name="category">
          <option value="">Not categorised</option>
          ${month.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === catId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>` : ''}
    ${tx?.link ? `<p class="hint">Linked to ${tx.link.kind === 'plan' ? 'a planned item' : 'money owed to you'}. Deleting this un-ticks it.</p>` : ''}
    ${editing ? `<button type="button" class="btn btn-danger-ghost" data-act="tx-delete">Delete ${t}</button>` : ''}
  `;

  openSheet({
    title: editing ? `Edit ${t}` : link ? (t === 'expense' ? 'Record expense' : 'Record income') : TITLES[t],
    body,
    submitLabel: editing ? 'Save changes' : t === 'expense' ? 'Add expense' : 'Add income',
    onOpen: (form) => {
      form.addEventListener('change', (e) => {
        if (e.target.name === 'currency') {
          const c = e.target.value;
          form.account.innerHTML = accountOptions(accountsFor(c), defaultAccount(t, c));
        }
        if (e.target.name === 'type') {
          openTxSheet({ monthId, type: e.target.value, prefill: { amountText: form.amount.value, description: form.description.value } });
        }
      });
    },
    actions: {
      'tx-delete': async () => {
        const ok = await confirmDialog({ title: `Delete ${t}?`, message: `${esc(tx.description || t)} · ${formatMoney(tx.amount, tx.currency)}`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        const undo = await deleteTx(tx.id);
        toast('Deleted', { actionLabel: 'Undo', onAction: undo });
      },
    },
    onSubmit: async (form) => {
      const amt = parseAmount(form.amount.value);
      if (!amt.ok) return fieldError(form, 'amount', amt.error);
      const currency = form.currency.value;
      const accountId = form.account.value;
      if (!accountId) return fieldError(form, 'account', `Add a ${currency} account in Settings first`);
      const description = form.description.value.trim() || (t === 'expense' ? 'Expense' : 'Income');
      const date = form.date?.value || dt.date;
      const time = form.time?.value || dt.time;
      const record = {
        ...(tx || {}),
        id: tx?.id ?? uid(), monthId, type: t, amount: amt.cents, currency, accountId, description, date, time,
        categoryId: form.category ? form.category.value || null : catId || null,
        createdAt: tx?.createdAt ?? new Date().toISOString(),
      };
      await saveTx(record, link);
      rememberDefaults(t, currency, accountId);
      toast(editing ? 'Saved' : `${t === 'expense' ? 'Expense' : 'Income'} added · ${formatMoney(amt.cents, currency)}`);
      onSaved?.(record);
    },
  });
}

function typeSwitch(t) {
  return `<div class="type-switch">${segmented('type', [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']], t)}</div>`;
}

function rememberDefaults(type, currency, accountId) {
  const key = type === 'income' ? 'income' : 'expense';
  const da = state.settings.defaultAccounts;
  if (state.settings.lastCurrency === currency && da[key][currency] === accountId) return;
  saveSettings({
    lastCurrency: currency,
    defaultAccounts: { ...da, [key]: { ...da[key], [currency]: accountId } },
  }).catch(() => {});
}

// ---------- transfer ----------
function presetAccounts(preset) {
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const find = (kind, cur) => accs.find((a) => a.kind === kind && (!cur || a.currency === cur));
  if (preset === 'atm') {
    const cur = state.settings.lastCurrency || 'ALL';
    const from = find('bank', cur) || find('bank');
    const to = find('cash', from?.currency) || find('cash');
    return [from, to];
  }
  if (preset === 'savings') {
    const to = find('savings');
    const from = find('bank', to?.currency) || find('bank');
    return [from, to];
  }
  if (preset === 'exchange') {
    const cur = state.settings.lastCurrency !== 'ALL' ? state.settings.lastCurrency : 'EUR';
    return [find('cash', cur) || find('cash', 'EUR'), find('cash', 'ALL')];
  }
  return [accs[0], accs[1]];
}

function openTransferSheet({ monthId, tx, prefill }) {
  const editing = !!tx;
  const rates = getRates(state, monthId);
  const [pf, pt] = presetAccounts(prefill.preset || 'atm');
  const fromId = tx?.accountId ?? pf?.id;
  const toId = tx?.toAccountId ?? pt?.id;
  const dt = tx ? { date: tx.date, time: tx.time } : defaultDateTime(monthId);
  const amountText = tx ? centsToInput(tx.amount) : prefill.amountText ?? '';

  const body = `
    ${editing ? '' : typeSwitch('transfer')}
    ${editing ? '' : `<div class="chips" role="group" aria-label="Quick presets">
      <button type="button" class="chip" data-act="tr-preset" data-preset="atm">ATM withdrawal</button>
      ${state.settings.accounts.some((a) => a.kind === 'savings' && !a.archived) ? '<button type="button" class="chip" data-act="tr-preset" data-preset="savings">To savings</button>' : ''}
      <button type="button" class="chip" data-act="tr-preset" data-preset="exchange">Exchange → ALL</button>
    </div>`}
    <label class="field"><span class="label">From</span><select class="select" name="from">${allAccountOptions(fromId)}</select></label>
    <label class="field"><span class="label">To</span><select class="select" name="to">${allAccountOptions(toId)}</select></label>
    <label class="field"><span class="label">Amount <span class="cur-tag" data-from-cur></span></span>
      <input class="input input-amount" name="amount" inputmode="decimal" placeholder="0" value="${esc(amountText)}" ${editing ? '' : 'autofocus'}>
    </label>
    <div class="field" data-received hidden>
      <span class="label">Amount received <span class="cur-tag" data-to-cur></span></span>
      <input class="input" name="toAmount" inputmode="decimal" placeholder="0" value="${tx && tx.toCurrency !== tx.currency ? centsToInput(tx.toAmount) : ''}">
      <p class="hint" data-rate-hint></p>
    </div>
    <label class="field"><span class="label">Note <span class="optional">optional</span></span>
      <input class="input" name="description" maxlength="120" placeholder="e.g. ATM withdrawal" value="${esc(tx?.description ?? '')}">
    </label>
    ${editing ? dateFields(monthId, dt.date, dt.time) : ''}
    <p class="hint">Moving money between your own accounts is never counted as spending.</p>
    ${editing ? `<button type="button" class="btn btn-danger-ghost" data-act="tx-delete">Delete transfer</button>` : ''}
  `;

  let toEdited = editing && tx.toCurrency !== tx.currency;

  const sync = (form) => {
    const from = accountById(state, form.from.value);
    const to = accountById(state, form.to.value);
    form.querySelector('[data-from-cur]').textContent = from?.currency ?? '';
    form.querySelector('[data-to-cur]').textContent = to?.currency ?? '';
    const cross = from && to && from.currency !== to.currency;
    form.querySelector('[data-received]').hidden = !cross;
    if (cross) {
      const foreign = from.currency === 'ALL' ? to.currency : from.currency;
      form.querySelector('[data-rate-hint]').textContent = `Suggested at 1 ${foreign} = ${formatRate(rates[foreign])} ALL — change it to what you actually received.`;
    }
    if (cross && !toEdited) {
      const a = parseAmount(form.amount.value);
      form.toAmount.value = a.ok ? centsToInput(convertCents(a.cents, from.currency, to.currency, rates)) : '';
    }
  };

  openSheet({
    title: editing ? 'Edit transfer' : 'Move money',
    body,
    submitLabel: editing ? 'Save changes' : 'Save transfer',
    onOpen: (form) => {
      sync(form);
      form.addEventListener('input', (e) => {
        if (e.target.name === 'toAmount') toEdited = true;
        if (e.target.name === 'amount') sync(form);
      });
      form.addEventListener('change', (e) => {
        if (e.target.name === 'from' || e.target.name === 'to') { toEdited = false; sync(form); }
        if (e.target.name === 'type') {
          openTxSheet({ monthId, type: e.target.value, prefill: { amountText: form.amount.value, description: form.description.value } });
        }
      });
    },
    actions: {
      'tr-preset': (el) => {
        const form = el.closest('form');
        const [f, t] = presetAccounts(el.dataset.preset);
        if (f) form.from.value = f.id;
        if (t) form.to.value = t.id;
        toEdited = false;
        sync(form);
        form.amount.focus();
      },
      'tx-delete': async () => {
        const ok = await confirmDialog({ title: 'Delete transfer?', message: `${formatMoney(tx.amount, tx.currency)} from ${esc(accountById(state, tx.accountId)?.name)}`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        const undo = await deleteTx(tx.id);
        toast('Deleted', { actionLabel: 'Undo', onAction: undo });
      },
    },
    onSubmit: async (form) => {
      const from = accountById(state, form.from.value);
      const to = accountById(state, form.to.value);
      if (!from || !to) return fieldError(form, 'from', 'Choose both accounts');
      if (from.id === to.id) return fieldError(form, 'to', 'Choose a different account');
      const amt = parseAmount(form.amount.value);
      if (!amt.ok) return fieldError(form, 'amount', amt.error);
      let toAmount = amt.cents;
      if (from.currency !== to.currency) {
        const r = parseAmount(form.toAmount.value);
        if (!r.ok) return fieldError(form, 'toAmount', r.error);
        toAmount = r.cents;
      }
      const isAtm = from.kind === 'bank' && to.kind === 'cash' && from.currency === to.currency;
      const description = form.description.value.trim() ||
        (isAtm ? 'ATM withdrawal' : to.kind === 'savings' ? 'To savings' : from.currency !== to.currency ? 'Currency exchange' : 'Transfer');
      const record = {
        ...(tx || {}),
        id: tx?.id ?? uid(), monthId, type: 'transfer',
        amount: amt.cents, currency: from.currency, accountId: from.id,
        toAccountId: to.id, toAmount, toCurrency: to.currency,
        description, date: form.date?.value || dt.date, time: form.time?.value || dt.time,
        createdAt: tx?.createdAt ?? new Date().toISOString(),
      };
      await saveTx(record);
      toast(editing ? 'Saved' : `${description} · ${formatMoney(amt.cents, from.currency)}`);
    },
  });
}

// ---------- balance correction (adjust) ----------
function openAdjustmentInfo(tx) {
  const acc = accountById(state, tx.accountId);
  openSheet({
    title: 'Balance correction',
    body: `<p class="sheet-text">${formatMoney(tx.amount, tx.currency, { plus: true })} on <b>${esc(acc?.name)}</b> (${esc(tx.description)}).</p>
      <p class="hint">Corrections make the app match your real balance. They are not spending or income.</p>
      <button type="button" class="btn btn-danger-ghost" data-act="adj-delete">Delete correction</button>`,
    actions: {
      'adj-delete': async () => {
        const undo = await deleteTx(tx.id);
        closeSheet();
        toast('Correction deleted', { actionLabel: 'Undo', onAction: undo });
      },
    },
  });
}

export function accountKindLabel(a) {
  return ACCOUNT_KINDS[a.kind] || 'Account';
}
