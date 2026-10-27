// Planned items: things to buy / bills to pay (To Buy tab) and expected income (Budget tab).
// A planned item never counts as spending. Ticking it offers to record a real transaction.
import { state, updateMonth, uid, deleteTx } from '../store.js';
import { canEdit, monthLabel, accountById } from '../ledger.js';
import { parseAmount, formatMoney, centsToInput } from '../money.js';
import { BILL_CATEGORIES, SELFCARE_ID } from '../defaults.js';
import { icon } from '../icons.js';
import {
  esc, registerActions, openSheet, fieldError, toast, currencySeg, segmented, switchRow,
  confirmDialog, chooseDialog,
} from '../ui.js';
import { openTxSheet, defaultAccount } from './txsheet.js';

export const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };

export const isBill = (p) => BILL_CATEGORIES.includes(p.categoryId);
export const doneWord = (p) => (p.kind === 'income' ? 'received' : isBill(p) ? 'paid' : 'bought');

export function findCategory(m, catId) {
  return m.categories.find((c) => c.id === catId);
}

function guard(id) {
  const c = canEdit(state, id);
  if (!c.ok) { toast(c.reason); return false; }
  return true;
}

function subOptions(cat, selected) {
  return (cat?.lists || []).map((l) => `<option value="${esc(l.id)}" ${l.id === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
}

function itemForm(m, p, { kind, categoryId, listId, pickCategory }) {
  const catId = p?.categoryId ?? categoryId ?? m.categories[0]?.id;
  const cat = findCategory(m, catId);
  const bill = BILL_CATEGORIES.includes(catId);
  const recurring = p?.recurring ?? (kind === 'income' || bill);
  return `
    <label class="field"><span class="label">${kind === 'income' ? 'Income' : 'Name'}</span>
      <input class="input" name="description" maxlength="80" value="${esc(p?.description ?? '')}"
        placeholder="${kind === 'income' ? 'Salary' : bill ? 'Rent, phone, internet…' : 'What do you want to buy?'}" ${p ? '' : 'autofocus'}></label>
    ${kind === 'income' && !p ? `<div class="chips">
      <button type="button" class="chip" data-act="plan-suggest" data-text="Salary">Salary</button>
      <button type="button" class="chip" data-act="plan-suggest" data-text="Additional income">Additional income</button></div>` : ''}
    <div class="amount-row">
      <label class="field grow"><span class="label">${kind === 'income' ? 'Expected amount' : 'Amount'} ${kind === 'income' ? '' : '<span class="optional">optional</span>'}</span>
        <input class="input input-amount" name="amount" inputmode="decimal" value="${p?.amount ? centsToInput(p.amount) : ''}" placeholder="0"></label>
      <div class="field">${currencySeg(p?.currency ?? state.settings.lastCurrency ?? 'ALL')}</div>
    </div>
    ${kind === 'expense' && pickCategory ? `
      <label class="field"><span class="label">Category</span>
        <select class="select" name="category">${m.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === catId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    ${kind === 'expense' && (pickCategory || (catId === SELFCARE_ID && !listId && !p)) ? `
      <label class="field" data-sub ${cat?.lists?.length ? '' : 'hidden'}><span class="label">Subcategory</span>
        <select class="select" name="list">${subOptions(cat, p?.listId ?? listId)}</select></label>` : ''}
    ${kind === 'expense' ? `<div class="field" data-prio ${bill ? 'hidden' : ''}><span class="label">Priority <span class="optional">optional</span></span>
      ${segmented('priority', [['', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], p?.priority ?? '', { small: true })}</div>` : ''}
    ${switchRow('recurring', recurring, 'Repeats every month', `Copied to new months as not ${kind === 'income' ? 'received' : bill ? 'paid' : 'bought'}`)}`;
}

function readItem(form, kind, fixed) {
  const description = form.description.value.trim();
  if (!description) return fieldError(form, 'description', 'Give it a name');
  let amount = null;
  if (form.amount.value.trim() || kind === 'income') {
    const a = parseAmount(form.amount.value);
    if (!a.ok) return fieldError(form, 'amount', a.error);
    amount = a.cents;
  }
  const out = { description, amount, currency: form.currency.value, recurring: form.recurring.checked };
  if (kind === 'expense') {
    out.categoryId = form.category ? form.category.value : fixed.categoryId;
    out.listId = form.list && !form.list.closest('[hidden]') ? form.list.value || null : fixed.listId ?? null;
    if (out.categoryId !== SELFCARE_ID) out.listId = null;
    out.priority = form.priority && !BILL_CATEGORIES.includes(out.categoryId) ? form.priority.value || null : null;
  } else {
    out.categoryId = null;
  }
  return out;
}

function wireCategorySelect(form, m) {
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'category') return;
    const cat = findCategory(m, e.target.value);
    const sub = form.querySelector('[data-sub]');
    if (sub) {
      sub.hidden = !cat?.lists?.length;
      form.list.innerHTML = subOptions(cat, null);
    }
    const bill = BILL_CATEGORIES.includes(e.target.value);
    form.querySelector('[data-prio]')?.toggleAttribute('hidden', bill);
    form.recurring.checked = bill;
  });
}

/** Add a planned item. categoryId/listId fix where it goes; without them the user picks. */
export function addPlanItem(id, { kind = 'expense', categoryId = null, listId = null } = {}) {
  if (!guard(id)) return;
  const m = state.months[id];
  const cat = categoryId && findCategory(m, categoryId);
  const sub = listId && cat?.lists?.find((l) => l.id === listId);
  const title = kind === 'income' ? 'Expected income' : sub ? `Add to ${sub.name}` : cat ? `Add to ${cat.name}` : 'Add to plan';
  openSheet({
    title,
    body: itemForm(m, null, { kind, categoryId, listId, pickCategory: kind === 'expense' && !categoryId }),
    submitLabel: 'Add',
    onOpen: (form) => wireCategorySelect(form, m),
    actions: { 'plan-suggest': (b) => { const f = b.closest('form'); f.description.value = b.dataset.text; f.amount.focus(); } },
    onSubmit: async (form) => {
      const v = readItem(form, kind, { categoryId, listId });
      if (!v) return false;
      await updateMonth(id, (mm) => { mm.plan.push({ id: uid(), kind, ...v, paid: false, txId: null }); }, { financial: true });
      toast('Added');
    },
  });
}

export function openPlanItem(id, itemId) {
  if (!guard(id)) return;
  const m = state.months[id];
  const p = m.plan.find((x) => x.id === itemId);
  if (!p) return;
  const canRecord = !p.txId;
  openSheet({
    title: p.kind === 'income' ? 'Expected income' : p.description,
    body: itemForm(m, p, { kind: p.kind, pickCategory: p.kind === 'expense' }) + `
      ${p.txId ? `<p class="hint">${icon('check', 'ic-xs')} Recorded in Daily.</p>` : ''}
      <button type="button" class="btn btn-danger-ghost btn-block" data-act="plan-delete">Remove from ${monthLabel(id)}</button>`,
    footer: canRecord ? `<button type="button" class="btn btn-tinted btn-block" data-act="plan-record">Record ${p.kind === 'income' ? 'income' : 'expense'}…</button>` : '',
    onOpen: (form) => wireCategorySelect(form, m),
    actions: {
      'plan-record': () => recordPlan(id, p),
      'plan-delete': async () => {
        const ok = await confirmDialog({ title: 'Remove this item?', message: `“${esc(p.description)}” is removed from ${monthLabel(id)} only.${p.txId ? ' The recorded transaction stays.' : ''}`, confirmLabel: 'Remove', danger: true });
        if (!ok) return;
        const idx = state.months[id].plan.findIndex((x) => x.id === p.id);
        await updateMonth(id, (mm) => { mm.plan = mm.plan.filter((x) => x.id !== p.id); }, { financial: true });
        toast('Removed', { actionLabel: 'Undo', onAction: () => updateMonth(id, (mm) => { mm.plan.splice(idx, 0, p); }, { financial: true }) });
      },
    },
    onSubmit: async (form) => {
      const v = readItem(form, p.kind, p);
      if (!v) return false;
      await updateMonth(id, (mm) => { Object.assign(mm.plan.find((x) => x.id === p.id), v); }, { financial: true });
      toast('Saved');
    },
  });
}

function recordPlan(id, p) {
  openTxSheet({
    monthId: id, type: p.kind,
    prefill: { amount: p.amount || undefined, currency: p.currency, description: p.description, accountId: defaultAccount(p.kind, p.currency), categoryId: p.categoryId },
    link: { kind: 'plan', monthId: id, itemId: p.id },
  });
}

/** Tick a planned item: record a real transaction, or just mark it (if already recorded). */
export async function tickPlan(id, p) {
  const isIncome = p.kind === 'income';
  const word = doneWord(p);
  if (p.paid) {
    if (p.txId && state.transactions.some((t) => t.id === p.txId)) {
      const choice = await chooseDialog({
        title: `Un-tick “${p.description}”?`,
        message: `It was recorded as ${isIncome ? 'income' : 'an expense'}${p.amount ? ` of ${formatMoney(p.amount, p.currency)}` : ''}.`,
        options: [
          { key: 'keep', label: 'Un-tick, keep the transaction', primary: true },
          { key: 'delete', label: `Un-tick and delete the ${isIncome ? 'income' : 'expense'}` },
        ],
      });
      if (!choice) return;
      if (choice === 'delete') {
        const undo = await deleteTx(p.txId);
        toast('Transaction deleted', { actionLabel: 'Undo', onAction: undo });
        return;
      }
    }
    await updateMonth(id, (mm) => { const x = mm.plan.find((q) => q.id === p.id); x.paid = false; x.txId = null; }, { financial: true });
    return;
  }
  const acc = defaultAccount(p.kind, p.currency);
  const choice = await chooseDialog({
    title: `${word[0].toUpperCase() + word.slice(1)}: ${p.description}`,
    options: [
      { key: 'record', primary: true, label: `Record ${isIncome ? 'income' : 'expense'}${p.amount ? ` of ${formatMoney(p.amount, p.currency)}` : ''}`, hint: `${isIncome ? 'Into' : 'From'} ${accountById(state, acc)?.name ?? '—'} · you can adjust it` },
      { key: 'mark', label: `Just mark as ${word}`, hint: 'If you already added it in Daily — so it isn’t counted twice' },
    ],
  });
  if (choice === 'record') recordPlan(id, p);
  else if (choice === 'mark') await updateMonth(id, (mm) => { mm.plan.find((q) => q.id === p.id).paid = true; }, { financial: true });
}

registerActions({
  'plan-add': (el) => addPlanItem(el.dataset.month, { kind: el.dataset.kind || 'expense', categoryId: el.dataset.cat || null, listId: el.dataset.list || null }),
  'plan-open': (el) => openPlanItem(el.dataset.month, el.dataset.id),
  'plan-tick': (el) => {
    const id = el.dataset.month;
    if (!guard(id)) return;
    const p = state.months[id].plan.find((x) => x.id === el.dataset.id);
    if (p) return tickPlan(id, p);
  },
});
