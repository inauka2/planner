// The Daily, Planned and Summary tabs, plus the To Do screen.
// Each page: settings button and one + button at the top, a large title, the month, then content.
import { state, ensureMonth } from '../store.js';
import { monthSummary, monthTxs, localDateParts } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { esc, registerActions, dayLabel, emptyState } from '../ui.js';
import { routes } from '../routes.js';
import { pairIn } from '../insights.js';
import { topBar, pillBtn, privacyBtn, largeTitle, monthSwitch, txRow } from './chrome.js';
import { openTxSheet } from './txsheet.js';
import { renderBuy } from './buy.js';
import { renderBills } from './scheduled.js';
import { renderSummary } from './summary.js';
import { renderTodo } from './todo.js';

const zero = { ALL: 0, EUR: 0, USD: 0 };
const allOf = (pair, rates) => pairIn(pair || zero, 'ALL', rates);
const stat = (label, cents, cls = '') => `<div><p class="cap accent-cap">${label}</p><p class="remain-big"><span class="mw-amt ${cls}">${formatMoney(cents, 'ALL')}</span></p></div>`;

// ---------- Daily expenses ----------
export function renderDailyPage(id) {
  const m = state.months[id];
  const s = monthSummary(state, id);
  const t = localDateParts();
  const isCurrent = t.monthId === id;
  const closed = !!m.closing;
  const txs = monthTxs(state, id).sort((a, b) => (b.date + b.time + (b.createdAt || '')).localeCompare(a.date + a.time + (a.createdAt || '')));
  const byDay = new Map();
  for (const x of txs) {
    if (!byDay.has(x.date)) byDay.set(x.date, []);
    byDay.get(x.date).push(x);
  }
  const add = (type, label, cls, ic) => `<button class="btn ${cls}" data-act="daily-add" data-type="${type}" data-month="${id}">${icon(ic)} ${label}</button>`;

  return `
    ${topBar({ buttons: [privacyBtn(), ...(closed ? [] : [pillBtn({ act: 'daily-add', ic: 'plus', label: 'Add expense', primary: true, attrs: `data-type="expense" data-month="${id}"` })])] })}
    <main class="content">
      ${largeTitle('Daily Expenses')}
      ${monthSwitch(id, routes.daily)}
      <section class="remain-card ${isCurrent ? 'three-up' : ''}">
        ${isCurrent ? stat('Today', allOf(s.daily[t.date], s.rates), 'neg') : ''}
        ${stat(isCurrent ? 'This month' : 'Spent', allOf(s.spending, s.rates), 'neg')}
        ${stat('Income', allOf(s.income, s.rates), 'pos')}
      </section>
      ${closed ? '<p class="hint pad">This month is closed. Reopen it from Summary to make changes.</p>' : `<div class="quick-add">
        ${add('expense', 'Expense', 'btn-primary', 'expense')}
        ${add('income', 'Income', 'btn-tinted', 'income')}
        ${add('transfer', 'Transfer', 'btn-ghost', 'transfer')}
      </div>`}
      ${txs.length ? [...byDay.entries()].map(([date, list]) => {
        const spent = s.daily[date] ? allOf(s.daily[date], s.rates) : 0;
        return `<section class="reg-section">
          <h2 class="day-head"><span>${dayLabel(date)}${date === t.date ? ' · Today' : ''}</span>${spent ? `<span class="mw-amt">${formatMoney(spent, 'ALL')}</span>` : ''}</h2>
          <ul class="reg-list">${list.map((x) => txRow(x, { inDay: true })).join('')}</ul>
        </section>`;
      }).join('') : `<section class="group-card">${emptyState('Nothing recorded yet', closed ? '' : 'Tap <b>Expense</b> to add what you spent — the amount and what it was for.')}</section>`}
    </main>`;
}

// ---------- Planned: Bills | To Buy ----------
const PLAN_VIEWS = [['bills', 'Bills'], ['buy', 'To Buy']];

export function renderPlanPage(id, view = 'bills', path = []) {
  const m = state.months[id];
  const closed = !!m.closing;
  if (view === 'buy' && path[0]) {
    // a category (its budget and items) or a subcategory
    return `
      ${topBar({ back: path[1] ? routes.budgets(id, path[0]) : routes.budgets(id), buttons: closed ? [] : [
        pillBtn({ act: 'plan-add', ic: 'plus', label: 'Add item', primary: true, attrs: `data-month="${id}" data-cat="${esc(path[0])}" ${path[1] ? `data-list="${esc(path[1])}"` : ''}` }),
      ] })}
      <main class="content drill">${renderBuy(id, path)}</main>`;
  }
  const add = view === 'buy'
    ? pillBtn({ act: 'plan-add', ic: 'plus', label: 'Add item to buy', primary: true, attrs: `data-month="${id}"` })
    : pillBtn({ act: 'sched-add', ic: 'plus', label: 'Add bill', primary: true, attrs: `data-month="${id}"` });
  return `
    ${topBar({ buttons: [privacyBtn(), ...(closed ? [] : [add])] })}
    <main class="content">
      ${largeTitle('Planned')}
      <nav class="seg-links two" aria-label="View">${PLAN_VIEWS.map(([k, label]) => `<a href="${k === 'buy' ? routes.budgets(id) : routes.bills(id)}" class="${k === view ? 'on' : ''}" ${k === view ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      ${monthSwitch(id, (x) => (view === 'buy' ? routes.budgets(x) : routes.bills(x)))}
      ${view === 'buy' ? renderBuy(id).replace(/<h1 class="large-title">To Buy<\/h1>/, '') : renderBills(id)}
    </main>`;
}

// ---------- Summary ----------
export function renderSummaryPage(id) {
  return `
    ${topBar({ buttons: [privacyBtn()] })}
    <main class="content">
      ${largeTitle('Summary')}
      ${monthSwitch(id, routes.summary)}
      ${renderSummary(id).replace(/<h1 class="large-title">Summary<\/h1>/, '')}
      <ul class="list card flush">
        <li><a class="row" href="${routes.reports()}"><div class="row-main"><span class="row-title">More reports</span><span class="row-sub">Net worth, cash flow, payees, profit &amp; loss</span></div><span class="row-end">${icon('chev-right')}</span></a></li>
      </ul>
    </main>`;
}

// ---------- To Do (opened from Settings) ----------
export function renderTodoPage(id, path = [], back = routes.settings()) {
  const list = path[0];
  return `
    ${topBar({ back: list ? routes.todo(id) : back, buttons: [
      pillBtn({ act: 'sched-add-task', ic: 'plus', label: 'New task', primary: true, attrs: `data-month="${id}" ${list ? `data-list="${esc(list)}"` : ''}` }),
    ] })}
    <main class="content ${list ? 'drill' : ''}">
      ${list ? '' : `${largeTitle('To Do')}${monthSwitch(id, (x) => routes.todo(x))}`}
      <div class="todo-wrap">${renderTodo(id, path)}</div>
    </main>`;
}

registerActions({
  'daily-add': async (el) => {
    const t = localDateParts();
    const monthId = el.dataset.month || t.monthId;
    await ensureMonth(monthId);
    openTxSheet({ monthId, type: el.dataset.type || 'expense' });
  },
});
