// Planned → Bills: monthly bills, subscriptions and expected income, sorted by when they are due.
// Tick one to record the payment from its account.
import { state } from '../store.js';
import { localDateParts, getRates } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { categoryStyle } from '../defaults.js';
import { esc, registerActions, checkbox, emptyState, chooseDialog } from '../ui.js';
import { categoryName, scheduledItems, toDisplay } from '../insights.js';
import { square, longDate } from './chrome.js';
import { addPlanItem, doneWord } from './plan.js';
import { carryButtons } from './buy.js';
import { addTaskSheet } from './todo.js';

// ---------- list ----------
export function renderBills(id) {
  const today = localDateParts().date;
  const items = scheduledItems(state, id, today);
  const rates = getRates(state, id);
  const sumOf = (list, kind) => list.filter((s) => (s.item.kind === 'income') === (kind === 'income') && s.item.amount)
    .reduce((t, s) => t + toDisplay(s.item.amount, s.item.currency, 'ALL', rates), 0);
  const unpaid = items.filter((s) => s.status !== 'paid');
  const sections = [
    ['Overdue', items.filter((s) => s.status === 'overdue'), 'overdue'],
    ['Today', items.filter((s) => s.status === 'today'), ''],
    ['Upcoming', items.filter((s) => s.status === 'upcoming'), ''],
    ['No due date', items.filter((s) => s.status === 'nodate'), ''],
    ['Paid & received', items.filter((s) => s.status === 'paid'), 'done'],
  ].filter(([, list]) => list.length);

  return `
    <section class="remain-card three">
      <div><p class="cap accent-cap">To pay</p><p class="remain-big"><span class="mw-amt neg">${formatMoney(sumOf(unpaid, 'expense'), 'ALL')}</span></p></div>
      <div><p class="cap accent-cap">To receive</p><p class="remain-big"><span class="mw-amt pos">${formatMoney(sumOf(unpaid, 'income'), 'ALL')}</span></p></div>
    </section>
    ${carryButtons(id, { income: true })}
    ${sections.length ? sections.map(([title, list, cls]) => `
      <section class="reg-section ${cls}">
        <h2 class="reg-head">${title}</h2>
        <ul class="reg-list">${list.map((s) => schedRow(id, s)).join('')}</ul>
      </section>`).join('') : `<section class="group-card">${emptyState('No bills yet', 'Add your monthly bills, subscriptions and salary, with the day they are due.', state.months[id].closing ? '' : `<button class="btn btn-primary" data-act="sched-add" data-month="${id}">Add a bill</button>`)}</section>`}
    <p class="hint pad">Tick a bill when you pay it — the payment is recorded from its account.</p>`;
}

function schedRow(id, s) {
  const p = s.item;
  const m = state.months[id];
  const closed = !!m.closing;
  const income = p.kind === 'income';
  const { color, icon: ic } = income ? { color: '#34c759', icon: 'income' } : categoryStyle(p.categoryId, m.categories.findIndex((c) => c.id === p.categoryId));
  const when = s.due ? `${s.status === 'overdue' ? 'Was due' : 'Due'} ${longDate(s.due)}` : 'No due day';
  const meta = [when, p.recurring ? 'Monthly' : null, s.status === 'paid' ? doneWord(p) : null].filter(Boolean).join(' · ');
  return `<li><div class="reg-row sched ${s.status}">
    ${checkbox(p.paid, 'plan-tick', `data-month="${id}" data-id="${esc(p.id)}" ${closed ? 'disabled' : ''}`, doneWord(p), { sm: true, id: p.id })}
    ${square(color, ic)}
    <div class="reg-main tappable" data-act="plan-open" data-month="${id}" data-id="${esc(p.id)}">
      <span class="reg-title">${esc(p.description)} <span class="reg-ctx">(${esc(income ? 'Income' : categoryName(state, p.categoryId))})</span></span>
      <span class="reg-date">${meta}</span>
    </div>
    <div class="reg-end">${p.amount ? `<span class="mw-amt ${income ? 'pos' : 'neg'} ${p.paid ? 'dim' : ''}">${formatMoney(p.amount, p.currency)}</span>` : '<span class="faint">—</span>'}</div>
  </div></li>`;
}

registerActions({
  'sched-add': async (el) => {
    const id = el.dataset.month;
    const kind = await chooseDialog({
      title: 'Add to Bills',
      options: [
        { key: 'bill', label: 'Bill to pay', hint: 'Rent, phone, Netflix… can repeat every month', primary: true },
        { key: 'income', label: 'Expected income', hint: 'Salary or other money you expect' },
      ],
    });
    if (kind === 'bill') addPlanItem(id, { kind: 'expense' });
    else if (kind === 'income') addPlanItem(id, { kind: 'income' });
  },
  'sched-add-task': (el) => addTaskSheet(el.dataset.month, el.dataset.list || null),
});
