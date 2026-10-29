// Tab 2 — Daily: today / this month at a glance, then every transaction grouped by day.
// New entries come from the + button.
import { state } from '../store.js';
import { monthSummary, monthTxs, localDateParts, accountById } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { esc, registerActions, emptyState, dayLabel, pairText, moneyStack, shownCurrencies } from '../ui.js';
import { openTxSheet } from './txsheet.js';


export function renderDaily(id) {
  const m = state.months[id];
  const sum = monthSummary(state, id);
  const today = localDateParts();
  const isCurrent = today.monthId === id;
  const zero = { ALL: 0, EUR: 0, USD: 0 };
  const left = isCurrent ? sum.daily[today.date] || zero : sum.income;
  const show = shownCurrencies(left, sum.spending);

  const txs = monthTxs(state, id).sort((a, b) => (b.date + b.time + (b.createdAt || '')).localeCompare(a.date + a.time + (a.createdAt || '')));
  const byDay = new Map();
  for (const t of txs) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }

  return `
    <section class="card hero">
      <div class="totals-2">
        ${moneyStack(isCurrent ? 'Spent today' : 'Income', left, { show })}
        ${moneyStack('Spent this month', sum.spending, { show })}
      </div>
      ${isCurrent && (sum.income.ALL || sum.income.EUR || sum.income.USD) ? `<div class="divider"></div>
        <div class="title-row"><span class="muted small">Income received</span><span class="amount pos">${pairText(sum.income)}</span></div>` : ''}
    </section>

    ${txs.length ? [...byDay.entries()].map(([date, list]) => {
      const spent = sum.daily[date];
      return `<section>
        <p class="section-label"><span>${dayLabel(date)}${date === today.date ? ' · Today' : ''}</span>${spent ? `<span>${pairText(spent)}</span>` : ''}</p>
        <ul class="list card flush" style="margin-top:8px">${list.map(txRow).join('')}</ul>
      </section>`;
    }).join('') : `<div class="card">${emptyState('No transactions yet', m.closing ? 'This month was closed without transactions.' : 'Tap <b>+</b> to add an expense — just the amount and what it was for.')}</div>`}
  `;
}

function txRow(t) {
  const acc = accountById(state, t.accountId);
  const cat = t.categoryId && state.months[t.monthId].categories.find((c) => c.id === t.categoryId);
  let sub;
  let amount;
  let ic;
  if (t.type === 'transfer') {
    const to = accountById(state, t.toAccountId);
    sub = `${esc(acc?.name)} → ${esc(to?.name)}`;
    amount = t.toCurrency !== t.currency
      ? `${formatMoney(t.amount, t.currency)} → ${formatMoney(t.toAmount, t.toCurrency)}`
      : formatMoney(t.amount, t.currency);
    ic = 'transfer';
  } else if (t.type === 'income') {
    sub = esc(acc?.name);
    amount = formatMoney(t.amount, t.currency, { plus: true });
    ic = 'income';
  } else if (t.type === 'adjust') {
    sub = `${esc(acc?.name)} · correction`;
    amount = formatMoney(t.amount, t.currency, { plus: true });
    ic = 'adjust';
  } else {
    sub = `${esc(acc?.name)}${cat ? ` · ${esc(cat.name)}` : ''}`;
    amount = formatMoney(-t.amount, t.currency);
    ic = 'expense';
  }
  return `<li class="row tappable tx tx-${t.type}" data-act="tx-open" data-id="${esc(t.id)}">
    <span class="tx-ic">${icon(ic)}</span>
    <div class="row-main"><span class="row-title">${esc(t.description)}</span><span class="row-sub">${t.time} · ${sub}</span></div>
    <span class="amount">${amount}</span>
  </li>`;
}

registerActions({
  'tx-open': (el) => {
    const tx = state.transactions.find((t) => t.id === el.dataset.id);
    if (tx) openTxSheet({ monthId: tx.monthId, tx });
  },
});
