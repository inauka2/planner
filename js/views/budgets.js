// Budgets tab: one row per spending category with a progress pill (spent / budget),
// remaining vs budgeted at the top. Expanding a row shows its planned items (your To Buy list);
// tapping the name opens the category (items, subcategories, budget).
import { state } from '../store.js';
import { planTotals, monthSummary, monthLabel, localDateParts } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { categoryStyle } from '../defaults.js';
import { esc, registerActions, rerender, emptyState, chooseDialog } from '../ui.js';
import { routes } from '../routes.js';
import { budgetStatus, pairIn } from '../insights.js';
import { topBar, pillBtn, privacyBtn, largeTitle, monthSwitch, statusLine, square } from './chrome.js';
import { renderBuy, itemList, carryButtons } from './buy.js';
import { addPlanItem } from './plan.js';

const open = new Set();

/** Whole units, no "ALL" suffix and no decimals — fits inside a progress pill. */
const short = (cents, cur) => formatMoney(Math.round(cents / 100) * 100, cur).replace(' ALL', '').replace(/\.00$/, '');
export const budgetView = { display: 'ALL' };

export function renderBudgets(id, path = []) {
  if (path[0]) return renderCategory(id, path);
  const m = state.months[id];
  const plan = planTotals(m);
  const s = monthSummary(state, id);
  const d = budgetView.display;
  const rows = budgetStatus(state, id, plan, d);
  const budgeted = rows.reduce((t, r) => t + r.planned, 0);
  const spent = pairIn(s.spendingByPrice, d, s.rates);
  const remaining = budgeted - spent;
  const uncategorised = pairIn(s.byCategoryPrice[''] || { ALL: 0, EUR: 0, USD: 0 }, d, s.rates);
  const closed = !!m.closing;

  return `
    ${topBar({ buttons: [
      privacyBtn(),
      pillBtn({ act: 'budget-currency', ic: 'sliders', label: 'Currency' }),
      ...(closed ? [] : [pillBtn({ act: 'cats-edit', ic: 'folder-plus', label: 'Edit categories', attrs: `data-month="${id}"` }),
        pillBtn({ act: 'budget-add', ic: 'plus', label: 'Add planned item', primary: true, attrs: `data-month="${id}"` })]),
    ] })}
    <main class="content">
      ${largeTitle('Budgets', statusLine())}
      ${monthSwitch(id, (x) => routes.budgets(x))}
      <section class="remain-card">
        <div><p class="cap accent-cap">Remaining</p><p class="remain-big ${remaining < 0 ? 'neg' : ''}"><span class="mw-amt">${short(remaining, d)}${d === 'ALL' ? ' ALL' : ''}</span></p></div>
        <div><p class="cap accent-cap">Budgeted</p><p class="remain-big"><span class="mw-amt">${short(budgeted, d)}${d === 'ALL' ? ' ALL' : ''}</span></p></div>
      </section>
      ${carryButtons(id)}
      ${rows.length ? rows.map((r) => budgetRow(id, m, r, d)).join('') : `<section class="group-card">${emptyState('No categories', 'Add categories to plan your spending.')}</section>`}
      ${uncategorised ? `<section class="budget-row other"><div class="budget-head">
          <span class="budget-name muted">Not categorised</span>
          <span class="budget-pill" style="--c:#8e8e93;--fill:100%"><span class="mw-amt">${short(uncategorised, d)} spent</span></span>
        </div></section>` : ''}
      <p class="hint pad">Spent counts recorded expenses in their price currency, converted at ${monthLabel(id).split(' ')[0]}’s rate. A category’s budget is the amount you set, or the total of its planned items.</p>
    </main>`;
}

function budgetRow(id, m, r, d) {
  const isOpen = open.has(`${id}:${r.cat.id}`);
  const idx = m.categories.indexOf(r.cat);
  const { color, icon: ic } = categoryStyle(r.cat.id, idx);
  const over = r.planned && r.spent > r.planned;
  const fill = r.planned ? Math.min(100, Math.round((r.spent / r.planned) * 100)) : r.spent ? 100 : 0;
  const items = m.plan.filter((p) => p.kind !== 'income' && p.categoryId === r.cat.id);
  const left = items.filter((p) => !p.paid).length;
  return `<section class="budget-row ${isOpen ? 'open' : ''}">
    <div class="budget-head">
      <button class="group-toggle" data-act="budget-toggle" data-key="${id}:${esc(r.cat.id)}" aria-expanded="${isOpen}" aria-label="Show items">${icon(isOpen ? 'tri-down' : 'tri-right', 'tri')}</button>
      <a class="budget-name" href="${routes.budgets(id, r.cat.id)}">${esc(r.cat.name)}</a>
      <a class="budget-pill ${over ? 'over' : ''} ${r.planned ? '' : 'empty'}" href="${routes.budgets(id, r.cat.id)}" style="--c:${color};--fill:${fill}%">
        <span class="mw-amt">${short(r.spent, d)} / ${r.planned ? short(r.planned, d) : '—'}</span>
      </a>
    </div>
    ${isOpen ? `<div class="budget-body">
      <div class="budget-meta">${square(color, ic, 'sm')}<span>${items.length ? `${items.length} planned · ${left} left` : 'Nothing planned yet'}${r.cat.budget ? ' · own budget' : ''}</span>
        <a class="link-btn" href="${routes.budgets(id, r.cat.id)}">Open</a></div>
      ${items.length ? itemList(id, items) : ''}
      ${m.closing ? '' : `<button class="text-btn" data-act="plan-add" data-month="${id}" data-cat="${esc(r.cat.id)}">${icon('plus')} Add item</button>`}
    </div>` : ''}
  </section>`;
}

/** Category drill-down reuses the To Buy screens (items, subcategories, budget). */
function renderCategory(id, path) {
  const m = state.months[id];
  const cat = m.categories.find((c) => c.id === path[0]);
  const sub = cat && path[1] && cat.lists?.find((l) => l.id === path[1]);
  const back = sub ? routes.budgets(id, cat.id) : routes.budgets(id);
  return `
    ${topBar({ back, buttons: m.closing ? [] : [
      pillBtn({ act: 'plan-add', ic: 'plus', label: 'Add item', primary: true, attrs: `data-month="${id}" data-cat="${esc(path[0])}" ${sub ? `data-list="${esc(sub.id)}"` : ''}` }),
    ] })}
    <main class="content drill">${cat ? renderBuy(id, path) : `<section class="group-card">${emptyState('Category not found')}</section>`}</main>`;
}

registerActions({
  'budget-toggle': (el) => {
    const k = el.dataset.key;
    if (open.has(k)) open.delete(k); else open.add(k);
    rerender();
  },
  'budget-add': (el) => addPlanItem(el.dataset.month, { kind: 'expense' }),
  'budget-currency': async () => {
    const c = await chooseDialog({
      title: 'Show budgets in',
      options: [['ALL', 'Lek (ALL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dollar (USD)']].map(([key, label]) => ({ key, label, primary: key === budgetView.display })),
    });
    if (c) { budgetView.display = c; rerender(); }
  },
});

export const currentMonthId = () => localDateParts().monthId;
