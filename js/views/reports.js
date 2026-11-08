// Reports tab: a list of reports, each with a period (1m … all), a display currency,
// an interactive chart (tap/hover a mark for its value), a table, and CSV / print export.
import { state } from '../store.js';
import { localDateParts, monthLabel, getRates } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { esc, registerActions, rerender, chooseDialog, emptyState, toast } from '../ui.js';
import { routes } from '../routes.js';
import { saveFile } from '../backup.js';
import {
  PERIODS, periodMonths, monthShort, spendingByCategory, byPayee, cashFlow, netWorth, profitAndLoss, budgetStatus,
} from '../insights.js';
import { planTotals } from '../ledger.js';
import { topBar, pillBtn, privacyBtn, largeTitle, monthSwitch, statusLine } from './chrome.js';
import { renderSummary } from './summary.js';

export const view = { period: '1m', display: 'ALL', chart: 'donut' };

const REPORTS = [
  ['Overview', [
    ['review', 'Monthly review & closing', 'Started with, income, spending, ends with — close the month', 'calendar'],
    ['networth', 'Net worth', 'What you own minus what you owe, month by month', 'kind-investment'],
    ['cashflow', 'Cash flow', 'Money in, money out and what’s left each month', 'bars'],
  ]],
  ['Spending', [
    ['categories', 'Compare expense categories', 'Where your money goes', 'pie'],
    ['budget', 'Budget vs actual', 'Each category’s budget and what you spent', 'tab-budgets'],
    ['payees', 'Top payees', 'Who you pay the most', 'list'],
  ]],
  ['Income', [
    ['incexp', 'Income vs expenses', 'Side by side, every month', 'bars'],
    ['pl', 'Profit & Loss', 'Income and expenses by category, as a table', 'receipt'],
    ['income', 'Income by source', 'Salary and other income', 'income'],
  ]],
];
const TITLES = Object.fromEntries(REPORTS.flatMap(([, list]) => list.map(([k, t]) => [k, t])));

// Reference categorical palette (fixed order, validated for colour-blind separation).
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

export function renderReports(key = null, monthId = null) {
  if (key === 'review') return renderReview(monthId || localDateParts().monthId);
  if (key && TITLES[key]) return renderReport(key);
  return `
    ${topBar({ back: routes.summary(localDateParts().monthId), buttons: [privacyBtn()] })}
    <main class="content">
      ${largeTitle('Reports')}
      ${REPORTS.map(([group, list]) => `
        <p class="section-cap">${group}</p>
        <ul class="report-list">${list.map(([k, title, sub, ic]) => `
          <li><a class="report-link" href="${routes.report(k)}"><span class="rl-ic">${icon(ic)}</span>
            <span class="rl-main"><span class="rl-title">${title}</span><span class="rl-sub">${sub}</span></span>${icon('chev-right')}</a></li>`).join('')}
        </ul>`).join('')}
    </main>`;
}

function renderReview(id) {
  return `
    ${topBar({ back: routes.reports(), center: '<span class="center-title">Monthly review</span>', buttons: [privacyBtn()] })}
    <main class="content drill">
      ${monthSwitch(id, (x) => routes.report('review', x))}
      ${renderSummary(id).replace('<h1 class="large-title">Summary</h1>', '')}
    </main>`;
}

// ---------- one report ----------
function renderReport(key) {
  const end = localDateParts().monthId;
  const months = periodMonths(state, view.period, end);
  const d = view.display;
  const body = BUILD[key](months, d, end);
  return `
    ${topBar({ back: routes.reports(), center: `<span class="center-title">${esc(TITLES[key])}</span>`, buttons: [
      privacyBtn(), pillBtn({ act: 'report-menu', ic: 'more', label: 'Export', attrs: `data-key="${key}"` }),
    ] })}
    <main class="content report">
      <div class="period-bar">
        ${key === 'budget' ? `<span class="period-note">${monthLabel(end)}</span>` : Object.keys(PERIODS).map((p) => `<button class="${p === view.period ? 'on' : ''}" data-act="report-period" data-p="${p}">${p === 'ytd' ? 'YTD' : p === 'all' ? 'All' : p}</button>`).join('')}
        ${key === 'categories' ? `<span class="period-sep"></span>
          <button class="ic-btn ${view.chart === 'bars' ? 'on' : ''}" data-act="report-chart" data-c="bars" aria-label="Bar chart">${icon('bars')}</button>
          <button class="ic-btn ${view.chart === 'donut' ? 'on' : ''}" data-act="report-chart" data-c="donut" aria-label="Donut chart">${icon('pie')}</button>` : ''}
      </div>
      <section class="chart-card">
        <p class="chart-range">${key === 'budget' ? monthLabel(end) : rangeLabel(months)}</p>
        ${body.chart}
      </section>
      <div class="report-cur"><span>${body.unit || 'Amounts'} in: <b>${CUR_NAMES[d]}</b></span>
        <button class="round-btn sm" data-act="report-currency" aria-label="Change currency">${icon('repeat')}</button></div>
      ${body.table}
    </main>`;
}

const CUR_NAMES = { ALL: 'Lek (ALL)', EUR: 'Euro (€)', USD: 'Dollar ($)' };
const rangeLabel = (months) => (months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} — ${monthLabel(months[months.length - 1])}`);
const fm = (c) => formatMoney(c, view.display);
const nothing = (text = 'No data for this period yet.') => `<div class="chart-empty">${emptyState('Nothing to show', text)}</div>`;

/** Stable colour per category: its position in the latest month's category list. */
function categoryColor(catId) {
  if (!catId) return 'var(--s-other)';
  const latest = Object.keys(state.months).sort().pop();
  const idx = (state.months[latest]?.categories || []).findIndex((c) => c.id === catId);
  return idx >= 0 && idx < SERIES.length ? SERIES[idx] : 'var(--s-other)';
}

const BUILD = {
  categories(months, d) {
    const rows = spendingByCategory(state, months, d);
    const total = rows.reduce((s, r) => s + r.total, 0);
    if (!total) return { chart: nothing('No expenses recorded in this period.'), table: '', unit: 'Expenses' };
    const items = rows.map((r) => ({ label: r.name, value: r.total, color: categoryColor(r.id) }));
    return {
      unit: 'Expenses',
      chart: view.chart === 'bars' ? hbars(items, total) : donut(items, total),
      table: `<ul class="legend-table">${items.map((it) => `<li><i style="background:${it.color}"></i><span class="lt-name">${esc(it.label)}</span>
        <span class="lt-pct">${Math.round((it.value / total) * 100)}%</span><span class="mw-amt">${fm(it.value)}</span></li>`).join('')}
        <li class="total"><i></i><span class="lt-name">Total</span><span></span><span class="mw-amt">${fm(total)}</span></li></ul>`,
    };
  },
  payees(months, d) { return payeeReport(byPayee(state, months, d, 'expense'), 'Expenses'); },
  income(months, d) { return payeeReport(byPayee(state, months, d, 'income'), 'Income'); },
  incexp(months, d) {
    const cf = cashFlow(state, months, d);
    if (!cf.some((m) => m.income || m.spending)) return { chart: nothing(), table: '' };
    return {
      chart: columns(cf.map((m) => ({ label: monthShort(m.id), values: [m.income, m.spending], tip: `${monthLabel(m.id)} · income ${fm(m.income)} · spent ${fm(m.spending)}` })),
        [['Income', 'var(--s3)'], ['Expenses', 'var(--s2)']]),
      table: monthTable(['Income', 'Expenses', 'Net'], cf.map((m) => [m.id, m.income, -m.spending, m.net])),
    };
  },
  cashflow(months, d) {
    const cf = cashFlow(state, months, d);
    if (!cf.some((m) => m.income || m.spending)) return { chart: nothing(), table: '' };
    return {
      chart: netColumns(cf.map((m) => ({ label: monthShort(m.id), value: m.net, tip: `${monthLabel(m.id)} · ${m.net >= 0 ? 'saved' : 'overspent'} ${fm(Math.abs(m.net))}` }))),
      table: monthTable(['In', 'Out', 'Net', 'Running'], cf.map((m) => [m.id, m.income, -m.spending, m.net, m.cumulative])),
    };
  },
  networth(months, d) {
    const nw = netWorth(state, months, d).filter((m) => !m.empty);
    if (!nw.length) return { chart: nothing('Add accounts and balances to see your net worth.'), table: '' };
    return {
      chart: line(nw.map((m) => ({ label: monthShort(m.id), value: m.total, tip: `${monthLabel(m.id)} · ${fm(m.total)}` }))),
      table: monthTable(['Assets', 'Owed', 'Net worth'], nw.map((m) => [m.id, m.assets, m.liabilities, m.total])),
    };
  },
  pl(months, d) {
    const pl = profitAndLoss(state, months, d);
    if (!pl.incomeRows.length && !pl.expenseRows.length) return { chart: nothing(), table: '' };
    const firstData = months.findIndex((id) => state.transactions.some((t) => t.monthId === id));
    const cols = months.slice(Math.max(firstData, 0)).slice(-12);
    const cell = (v) => `<td class="${v < 0 ? 'neg' : ''}"><span class="mw-amt">${v ? fm(v).replace(/[^\d.,−-]/g, '') : '–'}</span></td>`;
    const row = (r, cls = '') => `<tr class="${cls} ${r.sub ? 'sub' : ''}"><th>${r.sub ? '<span class="tri-mark">▸</span> ' : ''}${esc(r.label)}</th>${cols.map((c) => cell(r.perMonth[c] || 0)).join('')}${cols.length > 1 ? cell(r.total) : ''}</tr>`;
    return {
      chart: `<div class="pl-head"><div><p class="cap">Income</p><p class="mw-amt pos">${fm(pl.totalIncome.total)}</p></div>
        <div><p class="cap">Expenses</p><p class="mw-amt neg">${fm(-pl.totalExpense.total)}</p></div>
        <div><p class="cap">Net</p><p class="mw-amt ${pl.net.total < 0 ? 'neg' : ''}"><b>${fm(pl.net.total)}</b></p></div></div>`,
      table: `<div class="pl-scroll"><table class="pl"><thead><tr><th></th>${cols.map((c) => `<th>${monthShort(c)}</th>`).join('')}${cols.length > 1 ? '<th>Total</th>' : ''}</tr></thead><tbody>
        ${pl.incomeRows.map((r) => row(r)).join('')}
        ${row({ label: 'TOTAL INCOME', perMonth: pl.totalIncome.perMonth, total: pl.totalIncome.total }, 'total')}
        <tr class="gap"><td colspan="${cols.length + 2}"></td></tr>
        ${pl.expenseRows.map((r) => row(r, r.sub ? '' : 'parent')).join('')}
        ${row({ label: 'TOTAL EXPENSES', perMonth: pl.totalExpense.perMonth, total: pl.totalExpense.total }, 'total')}
        ${row({ label: 'NET', perMonth: pl.net.perMonth, total: pl.net.total }, 'total net')}
      </tbody></table></div><p class="hint pad">Subcategories (▸) are part of the category above them. Swipe the table sideways for more months.</p>`,
    };
  },
  budget(_months, d, end) {
    const m = state.months[end];
    if (!m) return { chart: nothing('This month has no budget yet.'), table: '' };
    const rows = budgetStatus(state, end, planTotals(m), d).filter((r) => r.planned || r.spent);
    if (!rows.length) return { chart: nothing('Set budgets or plan items in Budgets.'), table: '' };
    const max = Math.max(1, ...rows.map((r) => Math.max(r.planned, r.spent)));
    return {
      chart: `<ul class="bva">${rows.map((r) => `<li data-tip="${esc(r.cat.name)} · spent ${esc(fm(r.spent))} of ${esc(fm(r.planned))}">
        <span class="bva-name">${esc(r.cat.name)}</span>
        <span class="bva-track"><span class="bva-plan" style="width:${(r.planned / max) * 100}%"></span><span class="bva-spent ${r.planned && r.spent > r.planned ? 'over' : ''}" style="width:${(r.spent / max) * 100}%"></span></span>
      </li>`).join('')}</ul>
      <div class="chart-legend"><span><i class="lg-plan"></i>Budget</span><span><i style="background:var(--s1)"></i>Spent</span><span><i style="background:var(--danger)"></i>Over budget</span></div>`,
      table: `<ul class="legend-table">${rows.map((r) => `<li><span class="lt-name">${esc(r.cat.name)}</span><span class="lt-pct">${r.planned ? `${Math.round((r.spent / r.planned) * 100)}%` : '—'}</span>
        <span class="mw-amt ${r.left < 0 ? 'neg' : ''}">${fm(r.spent)} / ${fm(r.planned)}</span></li>`).join('')}</ul>`,
    };
  },
};

function payeeReport(rows, unit) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  if (!total) return { chart: nothing(), table: '', unit };
  const top = rows.slice(0, 10).map((r) => ({ label: r.name, value: r.total, color: 'var(--s1)' }));
  return {
    unit,
    chart: hbars(top, Math.max(...top.map((t) => t.value)), { single: true }),
    table: `<ul class="legend-table">${rows.slice(0, 50).map((r) => `<li><span class="lt-name">${esc(r.name)}</span><span class="lt-pct">${r.count}×</span><span class="mw-amt">${fm(r.total)}</span></li>`).join('')}</ul>`,
  };
}

function monthTable(heads, rows) {
  return `<div class="pl-scroll"><table class="pl simple"><thead><tr><th></th>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${[...rows].reverse().filter(([, ...vals]) => vals.some(Boolean)).map(([id, ...vals]) => `<tr><th>${monthShort(id)}</th>${vals.map((v) => `<td class="${v < 0 ? 'neg' : ''}"><span class="mw-amt">${fm(v).replace(' ALL', '')}</span></td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- charts (inline SVG; every mark carries data-tip for the hover/tap tooltip) ----------
function donut(items, total) {
  const R = 80; const r = 52; const cx = 120; const cy = 110;
  let a0 = -Math.PI / 2;
  const shown = items.length > 8 ? [...items.slice(0, 7), { label: 'Other', value: items.slice(7).reduce((s, i) => s + i.value, 0), color: 'var(--s-other)' }] : items;
  const arcs = shown.map((it) => {
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const d = frac >= 0.9999
      ? `M ${p(0, R)} A ${R} ${R} 0 1 1 ${p(Math.PI, R)} A ${R} ${R} 0 1 1 ${p(0, R)} M ${p(0, r)} A ${r} ${r} 0 1 0 ${p(Math.PI, r)} A ${r} ${r} 0 1 0 ${p(0, r)} Z`
      : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
    const mid = (a0 + a1) / 2;
    a0 = a1;
    return { it, d, mid, frac };
  });
  const labels = arcs.filter((x) => x.frac >= 0.06).slice(0, 6).map((x) => {
    const lx = cx + (R + 14) * Math.cos(x.mid);
    const ly = cy + (R + 14) * Math.sin(x.mid);
    const anchor = Math.cos(x.mid) >= 0 ? 'start' : 'end';
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" class="dn-label"><tspan class="mw-amt">${esc(fm(x.it.value))}</tspan><tspan x="${lx.toFixed(1)}" dy="12">${esc(x.it.label.slice(0, 16))}</tspan></text>`;
  }).join('');
  return `<svg class="chart donut" viewBox="-20 0 280 222" role="img" aria-label="Spending by category">
    ${arcs.map((x) => `<path d="${x.d}" fill="${x.it.color}" class="mark" data-tip="${esc(x.it.label)} · ${esc(fm(x.it.value))} · ${Math.round(x.frac * 100)}%"/>`).join('')}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="dn-cap">Total</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="dn-total"><tspan class="mw-amt">${esc(fm(total))}</tspan></text>
    ${labels}
  </svg>
  <div class="chart-legend">${shown.map((it) => `<span><i style="background:${it.color}"></i>${esc(it.label)}</span>`).join('')}</div>`;
}

function hbars(items, max, { single = false } = {}) {
  return `<ul class="hbars ${single ? 'single' : ''}">${items.map((it) => `<li data-tip="${esc(it.label)} · ${esc(fm(it.value))}">
    <span class="hb-label">${esc(it.label)}</span>
    <span class="hb-track"><span class="hb-bar" style="width:${Math.max(1.5, (it.value / max) * 100)}%;background:${it.color}"></span></span>
    <span class="hb-val mw-amt">${esc(fm(it.value))}</span></li>`).join('')}</ul>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const axisLabel = (cents) => {
  const v = Math.abs(cents) / 100;
  const s = v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`;
  return `${cents < 0 ? '−' : ''}${s}`;
};

/** Grouped columns: data = [{ label, values: [a, b], tip }], series = [[name, color], …]. */
function columns(data, series) {
  const W = 320; const H = 180; const L = 34; const B = 22; const T = 8;
  const max = niceMax(Math.max(1, ...data.flatMap((x) => x.values)));
  const slot = (W - L) / data.length;
  const bw = Math.max(3, Math.min(18, (slot - 8) / series.length - 2));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/><text x="${L - 4}" y="${y(max * f) + 3}" text-anchor="end" class="axis mw-amt">${axisLabel(max * f)}</text>`).join('');
  const bars = data.map((x, i) => {
    const gx = L + slot * i + (slot - (bw + 2) * series.length) / 2;
    return `<g class="col-group" data-tip="${esc(x.tip)}"><rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" class="hit"/>
      ${x.values.map((v, j) => v > 0 ? `<path class="mark" fill="${series[j][1]}" d="${roundTop(gx + j * (bw + 2), y(v), bw, y(0) - y(v))}"/>` : '').join('')}
      ${data.length <= 12 ? `<text x="${L + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle" class="axis">${esc(data.length > 6 ? x.label.slice(0, 3) : x.label)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s[0]).join(' and ')} by month">${grid}${bars}<line x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="base"/></svg>
    <div class="chart-legend">${series.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>`;
}

/** Columns above / below zero (net per month). */
function netColumns(data) {
  const W = 320; const H = 180; const L = 34; const B = 22; const T = 8;
  const hi = Math.max(0, ...data.map((x) => x.value));
  const lo = Math.min(0, ...data.map((x) => x.value));
  const span = niceMax(Math.max(hi, -lo, 1));
  const top = hi > 0 ? span : 0;
  const bottom = lo < 0 ? -span : 0;
  const y = (v) => T + (H - T - B) * ((top - v) / (top - bottom || 1));
  const slot = (W - L) / data.length;
  const bw = Math.max(4, Math.min(22, slot - 10));
  const grid = [top, 0, bottom].filter((v, i, a) => a.indexOf(v) === i).map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'base' : 'grid'}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end" class="axis mw-amt">${axisLabel(v)}</text>`).join('');
  const bars = data.map((x, i) => {
    const bx = L + slot * i + (slot - bw) / 2;
    const h = Math.abs(y(x.value) - y(0));
    const d = x.value >= 0 ? roundTop(bx, y(x.value), bw, h) : roundBottom(bx, y(0), bw, h);
    return `<g data-tip="${esc(x.tip)}"><rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" class="hit"/>
      ${x.value ? `<path class="mark" fill="${x.value >= 0 ? 'var(--s3)' : 'var(--s2)'}" d="${d}"/>` : ''}
      ${data.length <= 12 ? `<text x="${L + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle" class="axis">${esc(data.length > 6 ? x.label.slice(0, 3) : x.label)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net cash flow by month">${grid}${bars}</svg>
    <div class="chart-legend"><span><i style="background:var(--s3)"></i>Saved</span><span><i style="background:var(--s2)"></i>Overspent</span></div>`;
}

function line(data) {
  const W = 320; const H = 180; const L = 40; const B = 22; const T = 12;
  const vals = data.map((x) => x.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 100; hi += Math.abs(hi) * 0.1 || 100; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const x = (i) => (data.length === 1 ? L + (W - L) / 2 : L + 8 + ((W - L - 16) * i) / (data.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const pts = data.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const grid = [lo + pad, (lo + hi) / 2, hi - pad].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end" class="axis mw-amt">${axisLabel(v)}</text>`).join('');
  const step = Math.ceil(data.length / 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth by month">${grid}
    ${lo < 0 && hi > 0 ? `<line x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="base"/>` : ''}
    <path d="M ${pts.join(' L ')} L ${x(data.length - 1)} ${H - B} L ${x(0)} ${H - B} Z" class="area"/>
    <polyline points="${pts.join(' ')}" class="line"/>
    ${data.map((p, i) => `<g data-tip="${esc(p.tip)}"><rect x="${x(i) - 14}" y="${T}" width="28" height="${H - T - B}" class="hit"/><circle cx="${x(i)}" cy="${y(p.value)}" r="4" class="dot"/>
      ${i % step === 0 || i === data.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(p.label)}</text>` : ''}</g>`).join('')}
  </svg>`;
}

function roundTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
function roundBottom(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
}

// ---------- tooltip (hover on desktop, tap on phone) ----------
let tipEl = null;
function showTip(target, x, y) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'chart-tip';
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = target.dataset.tip;
  tipEl.hidden = false;
  const w = tipEl.offsetWidth;
  tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
  tipEl.style.top = `${Math.max(8, y - 48)}px`;
}
const hideTip = () => { if (tipEl) tipEl.hidden = true; };
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest?.('.chart-card [data-tip], .chart-card [data-tip] *')?.closest('[data-tip]');
  if (t) showTip(t, e.clientX, e.clientY); else hideTip();
});
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest?.('.chart-card [data-tip]');
  if (t) showTip(t, e.clientX, e.clientY); else hideTip();
});
window.addEventListener('hashchange', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

// ---------- export ----------
function reportCsv(key) {
  const end = localDateParts().monthId;
  const months = periodMonths(state, view.period, end);
  const d = view.display;
  const n = (c) => (c / 100).toFixed(2);
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  let rows;
  if (key === 'categories') rows = [['Category', `Spent (${d})`], ...spendingByCategory(state, months, d).map((r) => [r.name, n(r.total)])];
  else if (key === 'payees' || key === 'income') rows = [['Payee', 'Count', `Total (${d})`], ...byPayee(state, months, d, key === 'income' ? 'income' : 'expense').map((r) => [r.name, r.count, n(r.total)])];
  else if (key === 'incexp' || key === 'cashflow') rows = [['Month', 'Income', 'Expenses', 'Net', 'Running'], ...cashFlow(state, months, d).map((m) => [m.id, n(m.income), n(m.spending), n(m.net), n(m.cumulative)])];
  else if (key === 'networth') rows = [['Month', 'Assets', 'Owed', 'Net worth'], ...netWorth(state, months, d).map((m) => [m.id, n(m.assets), n(m.liabilities), n(m.total)])];
  else if (key === 'budget') {
    const m = state.months[end];
    rows = [['Category', 'Budget', 'Spent', 'Left'], ...(m ? budgetStatus(state, end, planTotals(m), d).map((r) => [r.cat.name, n(r.planned), n(r.spent), n(r.left)]) : [])];
  } else {
    const pl = profitAndLoss(state, months, d);
    rows = [['', ...months, 'Total'],
      ...pl.incomeRows.map((r) => [r.label, ...months.map((m) => n(r.perMonth[m] || 0)), n(r.total)]),
      ['TOTAL INCOME', ...months.map((m) => n(pl.totalIncome.perMonth[m] || 0)), n(pl.totalIncome.total)],
      ...pl.expenseRows.map((r) => [r.sub ? `  ${r.label}` : r.label, ...months.map((m) => n(r.perMonth[m] || 0)), n(r.total)]),
      ['TOTAL EXPENSES', ...months.map((m) => n(pl.totalExpense.perMonth[m] || 0)), n(pl.totalExpense.total)],
      ['NET', ...months.map((m) => n(pl.net.perMonth[m] || 0)), n(pl.net.total)]];
  }
  return rows.map((r) => r.map(q).join(',')).join('\n');
}

registerActions({
  'report-period': (el) => { view.period = el.dataset.p; rerender(); },
  'report-chart': (el) => { view.chart = el.dataset.c; rerender(); },
  'report-currency': () => {
    const order = ['ALL', 'EUR', 'USD'];
    view.display = order[(order.indexOf(view.display) + 1) % order.length];
    rerender();
  },
  'report-menu': async (el) => {
    const key = el.dataset.key;
    const c = await chooseDialog({
      title: TITLES[key],
      options: [
        { key: 'csv', label: 'Export as CSV', hint: 'For Numbers, Excel or Google Sheets', primary: true },
        { key: 'print', label: 'Print or save as PDF', hint: 'Opens the print dialog — choose “Save as PDF”' },
      ],
    });
    if (c === 'csv') {
      const r = await saveFile(`report-${key}-${localDateParts().date}.csv`, reportCsv(key), 'text/csv');
      if (r !== 'cancelled') toast('Report exported');
    } else if (c === 'print') setTimeout(() => window.print(), 300);
  },
});

export const reportRates = (id) => getRates(state, id);
