// Tab 5 — Monthly summary: opening → income → spending → closing, categories,
// comparison with other months, and the review-and-close flow.
import { state, closeMonth, reopenMonth } from '../store.js';
import {
  monthSummary, yearOverview, canClose, canReopen, monthLabel, parseMonthId,
  MONTH_NAMES, getRates,
} from '../ledger.js';
import { parseAmount, parseRate, formatMoney, formatRate, centsToInput, combinedAll, FOREIGN } from '../money.js';
import { toCsv, saveFile } from '../backup.js';
import { icon } from '../icons.js';
import { esc, registerActions, openSheet, fieldError, toast, pairText, confirmDialog, moneyStack, shownCurrencies } from '../ui.js';

export function renderSummary(id) {
  const m = state.months[id];
  const s = monthSummary(state, id);
  const closed = !!m.closing;
  const { year, month } = parseMonthId(id);
  const monthName = MONTH_NAMES[month - 1];
  const show = shownCurrencies(s.opening, s.closing, s.income, s.spending);
  const extra = [
    ...(FOREIGN.concat('ALL').some((c) => s.exchange[c]) ? [['Currency exchange', s.exchange]] : []),
    ...(FOREIGN.concat('ALL').some((c) => s.adjust[c]) ? [['Corrections', s.adjust]] : []),
  ];
  const cats = Object.entries(s.byCategory)
    .map(([cid, pair]) => ({ name: cid ? m.categories.find((c) => c.id === cid)?.name ?? 'Other' : 'Not categorised', pair, all: combinedAll(pair, s.rates) }))
    .sort((a, b) => b.all - a.all);
  const maxCat = Math.max(1, ...cats.map((c) => c.all));

  return `
    <h1 class="large-title">Summary</h1>

    <section class="card status ${closed ? 'is-closed' : ''}">
      <span class="status-icon">${icon(closed ? 'lock' : 'calendar')}</span>
      <div class="row-main">
        <span class="row-title">${closed ? `Closed ${esc(m.closing.confirmedAt.slice(0, 10))}` : `${monthName} is open`}</span>
        <span class="row-sub">${closed ? `${MONTH_NAMES[month % 12]} starts from these balances` : 'Close it at month-end to confirm balances'}</span>
      </div>
      ${closed ? `<button class="btn btn-sm btn-ghost" data-act="month-reopen" data-month="${id}">Reopen</button>`
        : `<button class="btn btn-sm btn-primary" data-act="month-close" data-month="${id}">Close</button>`}
    </section>

    <p class="section-label"><span>${monthName} at a glance</span></p>
    <div class="tile-grid stats">
      <div class="tile stat-tile">${moneyStack('Started with', s.opening, { show })}</div>
      <div class="tile stat-tile">${moneyStack('Ends with', s.closing, { show })}</div>
      <div class="tile stat-tile">${moneyStack('Income', s.income, { show })}</div>
      <div class="tile stat-tile">${moneyStack('Spent', s.spending, { show })}</div>
    </div>
    ${extra.length ? `<ul class="list card flush">${extra.map(([label, pair]) => `
      <li class="row"><div class="row-main"><span class="row-title">${label}</span></div><span class="amount dim">${pairText(pair)}</span></li>`).join('')}</ul>` : ''}
    ${s.openingStatus === 'provisional' ? `<p class="hint" style="padding:0 16px">Starting balances update until ${monthLabel(s.openingFrom)} is closed.</p>` : ''}

    <p class="section-label"><span>Spending by category</span></p>
    <section class="card">
      ${cats.length ? `<ul class="bars">${cats.map((c) => `
        <li><div class="bar-label"><span>${esc(c.name)}</span><span>${pairText(c.pair)}</span></div>
          <div class="bar"><span style="width:${Math.max(2, Math.round((c.all / maxCat) * 100))}%"></span></div></li>`).join('')}</ul>`
      : '<p class="hint">No expenses recorded yet.</p>'}
    </section>

    <p class="section-label"><span>Spending by year</span><span>swipe for other years</span></p>
    ${yearCarousel(id, year)}

    <ul class="list card flush">
      <li class="row tappable" data-act="csv-month" data-month="${id}">
        <div class="row-main"><span class="row-title">Export ${monthName} as CSV</span></div>
        <span class="row-end">${icon('download')}</span>
      </li>
    </ul>
  `;
}

/** One card per year, swiped horizontally (scroll-snap), each with a 12-month column chart. */
function yearCarousel(id, year) {
  const years = Object.keys(state.months).map((k) => Number(k.slice(0, 4)));
  const first = Math.min(year - 1, ...years);
  const last = Math.max(year, ...years);
  const list = [];
  for (let y = first; y <= last; y++) list.push(y);
  return `<div class="carousel" data-carousel>
      ${list.map((y) => yearCard(id, y, y === year)).join('')}
    </div>
    <div class="dots" aria-hidden="true">${list.map((y) => `<span class="${y === year ? 'on' : ''}"></span>`).join('')}</div>`;
}

function yearCard(id, y, current) {
  const yo = yearOverview(state, y);
  const max = Math.max(1, ...yo.months.filter((x) => x.active).map((x) => x.spendingAll));
  return `<section class="card year-card" ${current ? 'data-scroll-here' : ''}>
    <div class="card-head"><h2>${y}</h2><span class="muted small">${yo.totalAll ? `≈ ${formatMoney(yo.totalAll, 'ALL')}` : 'No spending yet'}</span></div>
    <div class="cols">
      ${yo.months.map((x, i) => `<a class="col ${x.id === id ? 'sel' : ''}" href="#/m/${x.id}/summary" aria-label="${MONTH_NAMES[i]}${x.active ? `: ${formatMoney(x.spendingAll, 'ALL')}` : ''}">
        <span class="col-bar"><span style="height:${x.active ? Math.max(4, Math.round((x.spendingAll / max) * 100)) : 0}%"></span></span>
        <span class="col-label">${MONTH_NAMES[i][0]}</span>
      </a>`).join('')}
    </div>
    <p class="hint">${yo.highest ? `Highest ${MONTH_NAMES[Number(yo.highest.id.slice(5)) - 1]} · lowest ${MONTH_NAMES[Number(yo.lowest.id.slice(5)) - 1]}` : 'Tap a month to open it.'} · in ≈ ALL</p>
  </section>`;
}

registerActions({
  'month-close': (el) => {
    const id = el.dataset.month;
    const c = canClose(state, id);
    if (!c.ok) return toast(c.reason);
    const s = monthSummary(state, id);
    const accs = state.settings.accounts.filter((a) => !a.archived || s.closingBalances[a.id]);
    openSheet({
      title: `Close ${monthLabel(id)}`,
      body: `<p class="hint">Check each balance against your bank app and wallet. If one differs, type the real amount — a correction is recorded so everything adds up.</p>
        ${accs.map((a) => `<label class="field field-inline"><span class="label">${esc(a.name)} <span class="cur-tag">${a.currency}</span></span>
          <input class="input input-right" name="cb_${esc(a.id)}" inputmode="decimal" value="${centsToInput(s.closingBalances[a.id] || 0)}"></label>`).join('')}
        <label class="field field-inline"><span class="label">1 EUR = ? ALL</span>
          <input class="input input-right" name="rate" inputmode="decimal" value="${formatRate(getRates(state, id).EUR)}"></label>
        <label class="field field-inline"><span class="label">1 USD = ? ALL</span>
          <input class="input input-right" name="usdRate" inputmode="decimal" value="${formatRate(getRates(state, id).USD)}"></label>
        <p class="hint">The rates are saved with this month so its reports never change later.</p>`,
      submitLabel: 'Confirm & close month',
      onSubmit: async (form) => {
        const r = parseRate(form.rate.value);
        if (!r.ok) return fieldError(form, 'rate', r.error);
        const u = parseRate(form.usdRate.value);
        if (!u.ok) return fieldError(form, 'usdRate', u.error);
        const confirmed = {};
        let corrections = 0;
        for (const a of accs) {
          const p = parseAmount(form[`cb_${a.id}`].value, { allowNegative: true, allowZero: true });
          if (!p.ok) return fieldError(form, `cb_${a.id}`, p.error);
          confirmed[a.id] = p.cents;
          if (p.cents !== (s.closingBalances[a.id] || 0)) corrections++;
        }
        await closeMonth(id, confirmed, { EUR: r.rate, USD: u.rate });
        toast(`${monthLabel(id)} closed${corrections ? ` with ${corrections} correction${corrections > 1 ? 's' : ''}` : ''}`);
      },
    });
  },
  'month-reopen': async (el) => {
    const id = el.dataset.month;
    const c = canReopen(state, id);
    if (!c.ok) return toast(c.reason);
    const ok = await confirmDialog({
      title: `Reopen ${monthLabel(id)}?`,
      message: 'You can then edit its transactions again. Close it again when you’re done so the next month gets confirmed opening balances. Any corrections made at closing stay as transactions.',
      confirmLabel: 'Reopen',
    });
    if (!ok) return;
    await reopenMonth(id);
    toast('Month reopened');
  },
  'csv-month': async (el) => {
    const id = el.dataset.month;
    const r = await saveFile(`planner-${id}.csv`, toCsv(state, id), 'text/csv');
    if (r !== 'cancelled') toast('CSV exported');
  },
});

