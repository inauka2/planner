// Tab 5 — Monthly summary: opening → income → spending → closing, categories,
// comparison with other months, and the review-and-close flow.
import { state, closeMonth, reopenMonth } from '../store.js';
import {
  monthSummary, yearOverview, canClose, canReopen, monthLabel, parseMonthId,
  MONTH_NAMES, getRate, sourceMonthId,
} from '../ledger.js';
import { parseAmount, parseRate, formatMoney, formatRate, centsToInput, combinedAll } from '../money.js';
import { toCsv, saveFile } from '../backup.js';
import { icon } from '../icons.js';
import { esc, registerActions, openSheet, fieldError, toast, pairText, confirmDialog } from '../ui.js';

export function renderSummary(id) {
  const m = state.months[id];
  const s = monthSummary(state, id);
  const rate = s.rate;
  const closed = !!m.closing;
  const { year } = parseMonthId(id);
  const yo = yearOverview(state, year);

  const line = (label, pair, cls = '', prefix = '') => `<tr class="${cls}">
      <th scope="row">${label}</th>
      <td>${prefix}${formatMoney(pair.ALL, 'ALL')}</td>
      <td>${prefix}${formatMoney(pair.EUR, 'EUR')}</td>
    </tr>`;
  const hasExchange = s.exchange.ALL || s.exchange.EUR;
  const hasAdjust = s.adjust.ALL || s.adjust.EUR;

  const cats = Object.entries(s.byCategory)
    .map(([cid, pair]) => ({ name: cid ? m.categories.find((c) => c.id === cid)?.name ?? 'Other' : 'Not categorised', pair, all: combinedAll(pair, rate) }))
    .sort((a, b) => b.all - a.all);
  const maxCat = Math.max(1, ...cats.map((c) => c.all));

  const prevId = sourceMonthId(state, id);
  const prev = prevId && monthSummary(state, prevId);
  let delta = '';
  if (prev && prev.count) {
    const diff = s.all.spending - prev.all.spending;
    const pct = prev.all.spending ? Math.round((diff / prev.all.spending) * 100) : null;
    delta = `${diff >= 0 ? '+' : '−'}${pct !== null ? `${Math.abs(pct)}%` : formatMoney(Math.abs(diff), 'ALL')} vs ${MONTH_NAMES[parseMonthId(prevId).month - 1]}`;
  }
  const maxMonth = Math.max(1, ...yo.months.filter((x) => x.active).map((x) => x.spendingAll));

  return `
    <section class="card ${closed ? 'hero' : ''}">
      <div class="title-row">
        <div>
          <p class="eyebrow">${closed ? `${icon('lock', 'ic-xs')} Closed ${esc(m.closing.confirmedAt.slice(0, 10))}` : 'Month is open'}</p>
          <p class="small">${closed ? 'Next month starts from these balances.' : 'At month-end, confirm your real balances.'}</p>
        </div>
        ${closed ? `<button class="btn btn-sm btn-ghost" data-act="month-reopen" data-month="${id}">Reopen</button>`
          : `<button class="btn btn-sm btn-primary" data-act="month-close" data-month="${id}">Close month</button>`}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Money flow</h2></div>
      <table class="table">
        <thead><tr><th></th><th>Lek</th><th>Euro</th></tr></thead>
        <tbody>
          ${line('Opening', s.opening, 'strong')}
          ${line('Income', s.income, '', '+')}
          ${line('Spending', s.spending, '', '−')}
          ${hasExchange ? line('Exchange', s.exchange) : ''}
          ${hasAdjust ? line('Corrections', s.adjust) : ''}
          ${line('Closing', s.closing, 'strong accent')}
        </tbody>
      </table>
      <p class="hint">Transfers between your own accounts don’t change what you own, so they aren’t listed.${s.openingStatus === 'provisional' ? ` Opening updates until ${monthLabel(s.openingFrom)} is closed.` : ''}</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>By category</h2></div>
      ${cats.length ? `<ul class="bars">${cats.map((c) => `
        <li><div class="bar-label"><span>${esc(c.name)}</span><span>${pairText(c.pair)}</span></div>
          <div class="bar"><span style="width:${Math.max(2, Math.round((c.all / maxCat) * 100))}%"></span></div></li>`).join('')}</ul>`
      : '<p class="hint">No expenses recorded yet.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>${year}</h2>${delta ? `<span class="tag ${delta.startsWith('−') ? 'accent' : ''}">${delta}</span>` : ''}</div>
      <ul class="bars months-bars">${yo.months.map((x, i) => {
        if (!x.active) return `<li class="faded"><div class="bar-label"><span>${MONTH_NAMES[i].slice(0, 3)}</span><span>—</span></div></li>`;
        const tag = yo.highest?.id === x.id ? '<span class="tag">highest</span>' : yo.lowest?.id === x.id ? '<span class="tag accent">lowest</span>' : '';
        return `<li class="${x.id === id ? 'current' : ''}"><div class="bar-label"><span>${MONTH_NAMES[i].slice(0, 3)} ${tag}</span><span>≈ ${formatMoney(x.spendingAll, 'ALL')}</span></div>
          <div class="bar"><span style="width:${Math.max(2, Math.round((x.spendingAll / maxMonth) * 100))}%"></span></div></li>`;
      }).join('')}</ul>
      <p class="hint">Spending in ≈ ALL, each month at its own rate (now 1 EUR = ${formatRate(rate)} ALL). Year ≈ ${formatMoney(yo.totalAll, 'ALL')}.</p>
    </section>

    <button class="text-btn" data-act="csv-month" data-month="${id}">${icon('download')} Export ${MONTH_NAMES[parseMonthId(id).month - 1]} as CSV</button>
  `;
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
        <label class="field field-inline"><span class="label">Rate: 1 EUR = ? ALL</span>
          <input class="input input-right" name="rate" inputmode="decimal" value="${formatRate(getRate(state, id))}"></label>
        <p class="hint">The rate is saved with this month so its reports never change later.</p>`,
      submitLabel: 'Confirm & close month',
      onSubmit: async (form) => {
        const r = parseRate(form.rate.value);
        if (!r.ok) return fieldError(form, 'rate', r.error);
        const confirmed = {};
        let corrections = 0;
        for (const a of accs) {
          const p = parseAmount(form[`cb_${a.id}`].value, { allowNegative: true, allowZero: true });
          if (!p.ok) return fieldError(form, `cb_${a.id}`, p.error);
          confirmed[a.id] = p.cents;
          if (p.cents !== (s.closingBalances[a.id] || 0)) corrections++;
        }
        await closeMonth(id, confirmed, r.rate);
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

