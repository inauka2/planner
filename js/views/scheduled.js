// Rows for planned bills and expected income (due date, tick to pay or receive), used on the
// Planned page for "Due soon" and "Expected income".
import { state } from '../store.js';
import { formatMoney } from '../money.js';
import { categoryStyle } from '../defaults.js';
import { esc, registerActions, checkbox } from '../ui.js';
import { categoryName } from '../insights.js';
import { square, longDate } from './chrome.js';
import { addPlanItem, doneWord } from './plan.js';
import { addTaskSheet } from './todo.js';

/** One planned bill or income with its due date; tick it to record the payment. */
export function schedRow(id, s) {
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
  'income-add': (el) => addPlanItem(el.dataset.month, { kind: 'income' }),
  'sched-add-task': (el) => addTaskSheet(el.dataset.month, el.dataset.list || null),
});
