// Scheduled tab: monthly bills, subscriptions and expected income (List), a calendar heat map
// with a balance forecast for any future day (Calendar), and your To Do lists.
import { state } from '../store.js';
import { localDateParts, monthBounds, parseMonthId, MONTH_NAMES, getRates } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { categoryStyle } from '../defaults.js';
import { esc, registerActions, rerender, checkbox, emptyState, chooseDialog } from '../ui.js';
import { routes } from '../routes.js';
import { scheduledItems, calendarMonth, forecastTotal, categoryName, toDisplay } from '../insights.js';
import { topBar, pillBtn, privacyBtn, largeTitle, monthSwitch, statusLine, square, txRow, longDate } from './chrome.js';
import { addPlanItem, doneWord } from './plan.js';
import { carryButtons } from './buy.js';
import { renderTodo, addTaskSheet } from './todo.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let selectedDay = null;

const VIEWS = [['list', 'List'], ['calendar', 'Calendar'], ['todo', 'To Do']];

export function renderScheduled(id, view = 'list', path = []) {
  const titles = { list: 'Scheduled', calendar: 'Scheduled', todo: 'To Do' };
  const isTodoList = view === 'todo' && path[0];
  const buttons = [privacyBtn()];
  if (view === 'todo') buttons.push(pillBtn({ act: 'sched-add-task', ic: 'plus', label: 'New task', primary: true, attrs: `data-month="${id}" ${path[0] ? `data-list="${esc(path[0])}"` : ''}` }));
  else if (!state.months[id].closing) buttons.push(pillBtn({ act: 'sched-add', ic: 'plus', label: 'New scheduled item', primary: true, attrs: `data-month="${id}"` }));
  return `
    ${topBar({ back: isTodoList ? routes.todo(id) : null, buttons })}
    <main class="content ${isTodoList ? 'drill' : ''}">
      ${isTodoList ? '' : `${largeTitle(titles[view], statusLine())}
      <nav class="seg-links" aria-label="View">${VIEWS.map(([k, label]) => `<a href="${routes.scheduled(id, k)}" class="${k === view ? 'on' : ''}" ${k === view ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      ${monthSwitch(id, (x) => (view === 'todo' ? routes.todo(x) : routes.scheduled(x, view)))}`}
      ${view === 'calendar' ? renderCalendar(id) : view === 'todo' ? `<div class="todo-wrap">${renderTodo(id, path)}</div>` : renderList(id)}
    </main>`;
}

// ---------- list ----------
function renderList(id) {
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
      </section>`).join('') : `<section class="group-card">${emptyState('Nothing scheduled', 'Add your monthly bills, subscriptions and salary — with the day they are due — and they repeat every month.', state.months[id].closing ? '' : `<button class="btn btn-primary" data-act="sched-add" data-month="${id}">Add scheduled item</button>`)}</section>`}
    <p class="hint pad">Bills and subscriptions are planned, not spent. Tick one to record the payment from its account.</p>`;
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

// ---------- calendar ----------
function renderCalendar(id) {
  const t = localDateParts();
  const { year, month } = parseMonthId(id);
  const { days } = monthBounds(id);
  const cal = calendarMonth(state, id, t.date, 'ALL');
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const max = Math.max(1, ...Object.values(cal).map((c) => Math.max(c.spent, c.due)));
  if (!selectedDay || selectedDay.slice(0, 7) !== id) selectedDay = t.monthId === id ? t.date : `${id}-01`;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span class="cal-cell blank"></span>');
  for (let d = 1; d <= days; d++) {
    const date = `${id}-${String(d).padStart(2, '0')}`;
    const c = cal[date];
    const future = date > t.date;
    const v = future ? c.due : c.spent;
    const heat = v ? Math.max(0.15, Math.min(1, v / max)) : 0;
    cells.push(`<button class="cal-cell ${date === t.date ? 'today' : ''} ${date === selectedDay ? 'sel' : ''} ${future ? 'future' : ''}" data-act="cal-day" data-date="${date}" style="--heat:${heat}">
      <span class="cal-num">${d}</span>
      <span class="cal-dots">${c.items.some((s) => s.item.kind !== 'income' && s.status !== 'paid') ? '<i class="dot due"></i>' : ''}${c.items.some((s) => s.item.kind === 'income') || c.income ? '<i class="dot inc"></i>' : ''}</span>
    </button>`);
  }
  const sel = cal[selectedDay];
  const dayTxs = state.transactions.filter((x) => x.date === selectedDay).sort((a, b) => b.time.localeCompare(a.time));
  const future = selectedDay >= t.date;
  const fc = future ? forecastTotal(state, t.date, selectedDay, 'ALL') : null;

  return `
    <section class="cal-card">
      <div class="cal-grid">${DOW.map((d) => `<span class="cal-dow">${d}</span>`).join('')}${cells.join('')}</div>
      <div class="cal-legend"><span><i class="sw spent"></i>Spent</span><span><i class="sw due"></i>Due</span><span><i class="dot inc"></i>Income</span></div>
    </section>

    ${fc ? `<section class="forecast-card">
      <h2>Forecast · ${longDate(selectedDay)}</h2>
      <div class="fc-grid">
        <div><p class="cap">Now</p><p class="mw-amt">${formatMoney(fc.now, 'ALL')}</p></div>
        <div><p class="cap">Bills</p><p class="mw-amt neg">${formatMoney(-fc.expense, 'ALL')}</p></div>
        <div><p class="cap">Income</p><p class="mw-amt pos">${formatMoney(fc.income, 'ALL')}</p></div>
        <div><p class="cap">Balance</p><p class="mw-amt ${fc.end < 0 ? 'neg' : ''}"><b>${formatMoney(fc.end, 'ALL')}</b></p></div>
      </div>
      <p class="hint">All accounts, ≈ ALL. Starts from today’s balances and adds every unpaid bill and expected income up to this day. Items without an amount aren’t counted.</p>
    </section>` : ''}

    <section class="reg-section">
      <h2 class="reg-head">${longDate(selectedDay)}</h2>
      ${sel.items.length ? `<ul class="reg-list">${sel.items.map((s) => schedRow(id, s)).join('')}</ul>` : ''}
      ${dayTxs.length ? `<ul class="reg-list">${dayTxs.map((x) => txRow(x)).join('')}</ul>` : ''}
      ${!sel.items.length && !dayTxs.length ? '<p class="hint reg-empty">Nothing on this day.</p>' : ''}
    </section>`;
}

registerActions({
  'cal-day': (el) => { selectedDay = el.dataset.date; rerender(); },
  'sched-add': async (el) => {
    const id = el.dataset.month;
    const kind = await chooseDialog({
      title: 'New scheduled item',
      options: [
        { key: 'bill', label: 'Bill or subscription', hint: 'Rent, phone, Netflix… repeats every month', primary: true },
        { key: 'income', label: 'Expected income', hint: 'Salary or other money you expect' },
      ],
    });
    if (kind === 'bill') addPlanItem(id, { kind: 'expense' });
    else if (kind === 'income') addPlanItem(id, { kind: 'income' });
  },
  'sched-add-task': (el) => addTaskSheet(el.dataset.month, el.dataset.list || null),
});

export const monthName = (id) => MONTH_NAMES[parseMonthId(id).month - 1];
