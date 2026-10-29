// Tab 3 — To Buy: what I plan to spend money on this month, by category.
// Root → category → (Self-care) subcategory, iOS-style drill-down.
import { state, updateMonth, uid } from '../store.js';
import { monthSummary, planTotals, sourceMonthId, monthLabel } from '../ledger.js';
import { formatMoney } from '../money.js';
import { SELFCARE_ID, missingRecurring, missingUnfinished } from '../defaults.js';
import { icon, categoryIcon } from '../icons.js';
import { esc, registerActions, openSheet, fieldError, toast, checkbox, emptyState, pairText, confirmDialog, moneyStack, shownCurrencies } from '../ui.js';
import { PRIORITY, doneWord, findCategory } from './plan.js';

const zero = () => ({ ALL: 0, EUR: 0, USD: 0 });

function totalsOf(items) {
  const planned = zero();
  const left = zero();
  let open = 0;
  for (const p of items) {
    if (p.amount) planned[p.currency] += p.amount;
    if (!p.paid) { open++; if (p.amount) left[p.currency] += p.amount; }
  }
  return { planned, left, open, count: items.length };
}

const expenseItems = (m) => m.plan.filter((p) => p.kind !== 'income');
const amountText = (pair) => (pair.ALL || pair.EUR || pair.USD ? pairText(pair) : '');

export function renderBuy(id, path = []) {
  const m = state.months[id];
  const [catId, subId] = path;
  const cat = catId && findCategory(m, catId);
  if (!cat) return renderRoot(id, m);
  const sub = subId && cat.lists?.find((l) => l.id === subId);
  if (cat.id === SELFCARE_ID && cat.lists?.length && !sub) return renderSelfcare(id, m, cat);
  return renderItems(id, m, cat, sub);
}

// ---------- root ----------
function renderRoot(id, m) {
  const items = expenseItems(m);
  const t = totalsOf(items);
  const closed = !!m.closing;
  const src = sourceMonthId(state, id);
  const recurring = closed ? [] : missingRecurring(state, id).filter((p) => p.kind !== 'income');
  const unfinished = closed ? [] : missingUnfinished(state, id);

  return `
    <h1 class="large-title">To Buy</h1>
    <section class="card hero">
      <div class="totals-2">
        ${moneyStack('Planned', t.planned, { show: shownCurrencies(t.planned, t.left) })}
        ${moneyStack('Still to buy or pay', t.left, { show: shownCurrencies(t.planned, t.left) })}
      </div>
      ${t.count ? `<p class="hint">${t.open} of ${t.count} item${t.count > 1 ? 's' : ''} left</p>` : ''}
    </section>

    ${recurring.length || unfinished.length ? `<div class="stack">
      ${recurring.length ? `<button class="btn btn-tinted btn-block" data-act="buy-copy-recurring" data-month="${id}">${icon('repeat')} Copy ${recurring.length} monthly bill${recurring.length > 1 ? 's' : ''} from ${monthLabel(src).split(' ')[0]}</button>` : ''}
      ${unfinished.length ? `<button class="btn btn-ghost btn-block" data-act="buy-bring" data-month="${id}">Bring ${unfinished.length} unbought item${unfinished.length > 1 ? 's' : ''} from ${monthLabel(src).split(' ')[0]}</button>` : ''}
    </div>` : ''}

    <ul class="list card flush">
      ${m.categories.map((c) => {
        const ct = totalsOf(items.filter((p) => p.categoryId === c.id));
        const subline = ct.count ? `${ct.count} item${ct.count > 1 ? 's' : ''}${ct.open && ct.open < ct.count ? ` · ${ct.open} left` : ct.open ? '' : ' · all done'}`
          : c.lists?.length ? `${c.lists.length} subcategories` : 'Nothing planned';
        return `<li><a class="row has-icon" href="#/m/${id}/buy/${esc(c.id)}">
          <span class="icon-tile">${categoryIcon(c.id)}</span>
          <div class="row-main"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${subline}</span></div>
          <span class="row-end">${amountText(ct.planned)}${icon('chev-right')}</span>
        </a></li>`;
      }).join('')}
    </ul>
    ${closed ? '' : `<button class="text-btn" data-act="cats-edit" data-month="${id}">${icon('edit')} Edit categories</button>`}
  `;
}

// ---------- Self-care: subcategories ----------
function renderSelfcare(id, m, cat) {
  const items = expenseItems(m).filter((p) => p.categoryId === cat.id);
  const loose = items.filter((p) => !p.listId || !cat.lists.some((l) => l.id === p.listId));
  return `
    <a class="back-link" href="#/m/${id}/buy">${icon('chev-left')} To Buy</a>
    <div class="title-row"><h1 class="large-title">${esc(cat.name)}</h1>
      ${m.closing ? '' : `<button class="glass-btn sm" data-act="cat-edit" data-month="${id}" data-cat="${esc(cat.id)}" aria-label="Rename">${icon('edit')}</button>`}</div>
    ${summaryCard(id, cat, items)}
    <ul class="list card flush">
      ${cat.lists.map((l) => {
        const lt = totalsOf(items.filter((p) => p.listId === l.id));
        return `<li><a class="row" href="#/m/${id}/buy/${esc(cat.id)}/${esc(l.id)}">
          <div class="row-main"><span class="row-title">${esc(l.name)}</span>${lt.count ? `<span class="row-sub">${lt.open ? `${lt.open} to buy` : 'all bought'}</span>` : ''}</div>
          <span class="row-end">${amountText(lt.planned)}${icon('chev-right')}</span>
        </a></li>`;
      }).join('')}
    </ul>
    ${loose.length ? `<p class="section-label"><span>Other items</span></p>${itemList(id, loose)}` : ''}
    ${m.closing ? '' : `<button class="text-btn" data-act="sub-add" data-month="${id}" data-cat="${esc(cat.id)}">${icon('plus')} New subcategory</button>`}
  `;
}

// ---------- items of a category / subcategory ----------
function renderItems(id, m, cat, sub) {
  const items = expenseItems(m).filter((p) => p.categoryId === cat.id && (!sub || p.listId === sub.id));
  const closed = !!m.closing;
  return `
    <a class="back-link" href="#/m/${id}/buy${sub ? `/${esc(cat.id)}` : ''}">${icon('chev-left')} ${sub ? esc(cat.name) : 'To Buy'}</a>
    <div class="title-row"><h1 class="large-title">${esc(sub ? sub.name : cat.name)}</h1>
      ${closed ? '' : `<button class="glass-btn sm" data-act="${sub ? 'sub-edit' : 'cat-edit'}" data-month="${id}" data-cat="${esc(cat.id)}" ${sub ? `data-list="${esc(sub.id)}"` : ''} aria-label="Rename">${icon('edit')}</button>`}</div>
    ${sub ? '' : summaryCard(id, cat, items)}
    ${items.length ? itemList(id, items) : `<div class="card">${emptyState('Nothing here yet', closed ? '' : 'Tap <b>+</b> to add something you plan to buy or pay.')}</div>`}
    ${closed || !items.length ? '' : `<button class="text-btn" data-act="plan-add" data-month="${id}" data-cat="${esc(cat.id)}" ${sub ? `data-list="${esc(sub.id)}"` : ''}>${icon('plus')} Add item</button>`}
  `;
}

function summaryCard(id, cat, items) {
  const t = totalsOf(items);
  const spent = monthSummary(state, id).byCategory[cat.id] || zero();
  return `<section class="card">
    <div class="totals-2">
      <div><p class="eyebrow">Planned</p><p class="small"><b>${pairText(t.planned, { always: true })}</b></p></div>
      <div><p class="eyebrow">Spent</p><p class="small"><b>${pairText(spent, { always: true })}</b></p></div>
    </div>
  </section>`;
}

function itemList(id, items) {
  const closed = !!state.months[id].closing;
  const sorted = [...items].sort((a, b) => Number(a.paid) - Number(b.paid));
  return `<ul class="list card flush">${sorted.map((p) => {
    const meta = [];
    if (p.recurring) meta.push(`${icon('repeat', 'ic-xs')} Monthly`);
    if (p.priority) meta.push(`<span class="tag prio-${p.priority}">${PRIORITY[p.priority]}</span>`);
    if (p.paid) meta.push(p.txId ? `${doneWord(p)} · recorded` : doneWord(p));
    return `<li class="row has-check">
      ${checkbox(p.paid, 'plan-tick', `data-month="${id}" data-id="${esc(p.id)}" ${closed ? 'disabled' : ''}`, doneWord(p), { id: p.id })}
      <div class="row-main tappable" data-act="plan-open" data-month="${id}" data-id="${esc(p.id)}">
        <span class="row-title ${p.paid ? 'done' : ''}">${esc(p.description)}</span>
        ${meta.length ? `<span class="row-sub">${meta.join(' · ')}</span>` : ''}
      </div>
      ${p.amount ? `<span class="amount ${p.paid ? 'dim' : ''}">${formatMoney(p.amount, p.currency)}</span>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

// ---------- actions ----------
function nameSheet({ title, value, placeholder, onSave, onDelete, deleteLabel }) {
  openSheet({
    title,
    body: `<label class="field"><span class="label">Name</span><input class="input" name="label" maxlength="40" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus></label>
      ${onDelete ? `<button type="button" class="btn btn-danger-ghost" data-act="name-delete">${esc(deleteLabel)}</button>` : ''}`,
    actions: onDelete ? { 'name-delete': onDelete } : {},
    onSubmit: async (form) => {
      const name = form.label.value.trim();
      if (!name) return fieldError(form, 'label', 'Give it a name');
      await onSave(name);
    },
  });
}

registerActions({
  'buy-copy-recurring': async (el) => {
    const id = el.dataset.month;
    const items = missingRecurring(state, id).filter((p) => p.kind !== 'income');
    await updateMonth(id, (mm) => { for (const p of items) mm.plan.push({ ...p, id: uid(), paid: false, txId: null }); }, { financial: true });
    toast(`Copied ${items.length} (not paid yet)`);
  },
  'buy-bring': async (el) => {
    const id = el.dataset.month;
    const items = missingUnfinished(state, id);
    await updateMonth(id, (mm) => {
      for (const p of items) {
        const cat = mm.categories.find((c) => c.id === p.categoryId);
        if (!cat) mm.categories.push({ id: p.categoryId, name: findCategory(state.months[sourceMonthId(state, id)], p.categoryId)?.name || 'Other' });
        mm.plan.push({ ...p, id: uid(), paid: false, txId: null });
      }
    }, { financial: true });
    toast(`Brought ${items.length} over`);
  },
  'cat-edit': (el) => {
    const { month: id, cat: catId } = el.dataset;
    const cat = findCategory(state.months[id], catId);
    const used = state.months[id].plan.some((p) => p.categoryId === catId);
    nameSheet({
      title: 'Category', value: cat.name, placeholder: 'Category name',
      onSave: (name) => updateMonth(id, (mm) => { findCategory(mm, catId).name = name; }, { financial: true }),
      deleteLabel: 'Delete category',
      onDelete: async () => {
        if (used) return toast('Remove its items first');
        const ok = await confirmDialog({ title: `Delete “${esc(cat.name)}”?`, message: `Only in ${monthLabel(id)} and months created after it.`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await updateMonth(id, (mm) => { mm.categories = mm.categories.filter((c) => c.id !== catId); }, { financial: true });
        location.hash = `#/m/${id}/buy`;
      },
    });
  },
  'sub-add': (el) => {
    const { month: id, cat: catId } = el.dataset;
    nameSheet({
      title: 'New subcategory', value: '', placeholder: 'e.g. Nails',
      onSave: (name) => updateMonth(id, (mm) => { const c = findCategory(mm, catId); (c.lists ||= []).push({ id: uid(), name }); }, { financial: true }),
    });
  },
  'sub-edit': (el) => {
    const { month: id, cat: catId, list: listId } = el.dataset;
    const sub = findCategory(state.months[id], catId).lists.find((l) => l.id === listId);
    const used = state.months[id].plan.some((p) => p.listId === listId && p.categoryId === catId);
    nameSheet({
      title: 'Subcategory', value: sub.name, placeholder: 'Name',
      onSave: (name) => updateMonth(id, (mm) => { findCategory(mm, catId).lists.find((l) => l.id === listId).name = name; }, { financial: true }),
      deleteLabel: 'Delete subcategory',
      onDelete: async () => {
        if (used) return toast('Remove its items first');
        await updateMonth(id, (mm) => { const c = findCategory(mm, catId); c.lists = c.lists.filter((l) => l.id !== listId); }, { financial: true });
        location.hash = `#/m/${id}/buy/${catId}`;
      },
    });
  },
  'cats-edit': (el) => {
    const id = el.dataset.month;
    const m = state.months[id];
    const used = new Set(m.plan.map((p) => p.categoryId));
    const removed = new Set();
    openSheet({
      title: 'Categories',
      body: `<p class="hint">Changes apply to ${monthLabel(id)} and months created after it.</p>
        <div>${m.categories.map((c) => `
          <div class="edit-row" data-cat-row="${esc(c.id)}">
            <input class="input" name="cat_${esc(c.id)}" value="${esc(c.name)}" maxlength="40" aria-label="Category name">
            <button type="button" class="plain-btn" data-act="cat-remove" data-cat="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">${icon('trash')}</button>
          </div>`).join('')}</div>
        <input class="input" name="newCat" maxlength="40" placeholder="New category">`,
      actions: {
        'cat-remove': (b) => {
          if (used.has(b.dataset.cat)) return toast('Remove its items first');
          removed.add(b.dataset.cat);
          b.closest('[data-cat-row]').remove();
        },
      },
      onSubmit: async (form) => {
        const cats = m.categories.filter((c) => !removed.has(c.id))
          .map((c) => ({ ...c, name: form[`cat_${c.id}`].value.trim() || c.name }));
        const nc = form.newCat.value.trim();
        if (nc) cats.push({ id: uid(), name: nc });
        await updateMonth(id, (mm) => { mm.categories = cats; }, { financial: true });
        toast('Categories saved');
      },
    });
  },
});
