// Shared pieces of the main screens: top bar with the glass action pill, large titles,
// month switcher, coloured square icons, and the transaction row used by every register.
import { state } from '../store.js';
import { accountById, monthLabel, prevMonthId, nextMonthId, localDateParts, canEdit, MONTH_NAMES } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { categoryStyle, KIND_COLORS } from '../defaults.js';
import { esc } from '../ui.js';
import { categoryName, subcategoryName } from '../insights.js';
import { user } from '../app.js';
import { profileName } from '../auth.js';

const MON = MONTH_NAMES.map((n) => n.slice(0, 3));

/** Toolbar button inside the glass pill. `primary` is the blue round +. */
export function pillBtn({ act = '', href = '', ic, label, primary = false, attrs = '' }) {
  const cls = `pill-btn ${primary ? 'primary' : ''}`;
  return href
    ? `<a class="${cls}" href="${href}" aria-label="${esc(label)}" ${attrs}>${icon(ic)}</a>`
    : `<button class="${cls}" data-act="${act}" aria-label="${esc(label)}" ${attrs}>${icon(ic)}</button>`;
}

export const privacyBtn = () => pillBtn({ act: 'privacy-toggle', ic: state.settings.privacy ? 'eye-off' : 'eye', label: state.settings.privacy ? 'Show amounts' : 'Hide amounts' });

function settingsBtn() {
  return `<a class="round-btn" href="#/settings" aria-label="Settings">${icon('tab-settings')}</a>`;
}

/**
 * Top bar of a tab root: settings button (+ optional inline title) on the left, action pill on the right.
 * Sub-pages pass `back` (a href) and a centred `title` instead.
 */
export function topBar({ title = '', subtitle = '', inlineTitle = false, back = null, center = '', buttons = [] }) {
  const left = back
    ? `<a class="round-btn" href="${back}" aria-label="Back">${icon('chev-left')}</a>`
    : `${settingsBtn()}${inlineTitle ? `<div class="bar-title"><span class="t">${esc(title)}</span>${subtitle ? `<span class="s">${subtitle}</span>` : ''}</div>` : ''}`;
  return `<header class="mw-top">
    <div class="mw-left">${left}</div>
    ${center ? `<div class="mw-center">${center}</div>` : ''}
    ${buttons.length ? `<div class="glass-pill">${buttons.join('')}</div>` : '<span></span>'}
  </header>`;
}

export function largeTitle(title, subtitle = '') {
  return `<div class="mw-title"><h1>${esc(title)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>`;
}

export function statusLine() {
  return `${esc(profileName(user))} / ${icon('check', 'ic-xs')} Up to date`;
}

/** ‹ November 2026 › — links built by `hrefFor(monthId)`. */
export function monthSwitch(id, hrefFor) {
  const m = state.months[id];
  const today = localDateParts().monthId;
  return `<nav class="month-switch" aria-label="Month">
    <a href="${hrefFor(prevMonthId(id))}" aria-label="Previous month">${icon('chev-left')}</a>
    <span class="title">${m?.closing ? icon('lock', 'ic-xs') : ''}${monthLabel(id)}${id === today ? '' : ''}</span>
    <a href="${hrefFor(nextMonthId(id))}" aria-label="Next month">${icon('chev-right')}</a>
  </nav>`;
}

export function square(color, ic, cls = '') {
  return `<span class="sq ${cls}" style="--sq:${color}">${icon(ic)}</span>`;
}

export function accountSquare(a) {
  if (!a) return square('#8e8e93', 'kind-other');
  return square(a.color || KIND_COLORS[a.kind] || '#8e8e93', `kind-${a.kind || 'other'}`);
}

export function txSquare(t) {
  if (t.type === 'income') return square('#34c759', 'income');
  if (t.type === 'transfer') return square('#30b0c7', 'transfer');
  if (t.type === 'adjust') return square('#8e8e93', 'adjust');
  const { color, icon: ic } = categoryStyle(t.categoryId);
  return square(color, ic);
}

/** "Nov 8, 2026 at 14:05" */
export function longDate(date, time = '') {
  const [y, m, d] = date.split('-').map(Number);
  return `${MON[m - 1]} ${d}, ${y}${time ? ` at ${time}` : ''}`;
}

export function money(cents, currency, { cls = '', plus = false } = {}) {
  return `<span class="mw-amt ${cls}">${formatMoney(cents, currency, { plus })}</span>`;
}

/** What a transaction is "for", shown in brackets after the payee. */
function txContext(t) {
  if (t.type === 'transfer') {
    const from = accountById(state, t.accountId);
    const to = accountById(state, t.toAccountId);
    return `${from?.name ?? '?'} → ${to?.name ?? '?'}`;
  }
  if (t.type === 'adjust') return 'Balance correction';
  if (t.type === 'income') return accountById(state, t.accountId)?.name ?? '';
  if (!t.categoryId) return 'Not categorised';
  const sub = t.listId && subcategoryName(state, t.categoryId, t.listId);
  return `${categoryName(state, t.categoryId)}${sub ? `:${sub}` : ''}`;
}

/**
 * One register row (`inDay`: under a day heading, so show the time and account, not the date). `delta` (cents in `deltaCur`) is the change for the account being shown;
 * `balance` the running balance after it. Without them, the amount is shown as spent/received.
 */
export function txRow(t, { delta = null, balance = null, cur = null, inDay = false } = {}) {
  let amt;
  let cls;
  if (delta != null) {
    amt = formatMoney(Math.abs(delta), cur);
    cls = delta < 0 ? 'neg' : 'pos';
  } else if (t.type === 'transfer') {
    amt = t.toCurrency !== t.currency ? `${formatMoney(t.amount, t.currency)} → ${formatMoney(t.toAmount, t.toCurrency)}` : formatMoney(t.amount, t.currency);
    cls = 'neutral';
  } else {
    amt = formatMoney(Math.abs(t.amount), t.currency);
    cls = t.type === 'expense' || (t.type === 'adjust' && t.amount < 0) ? 'neg' : 'pos';
  }
  const price = t.origCurrency ? `<span class="mw-sub">${formatMoney(t.origAmount, t.origCurrency)}</span>` : '';
  const locked = !canEdit(state, t.monthId).ok;
  const tags = (t.tags || []).map((x) => `<span class="mini-tag">#${esc(x)}</span>`).join('');
  return `<li class="swipe" ${locked ? '' : 'data-swipe'}>
    <div class="reg-row swipe-content tappable" data-act="tx-open" data-id="${esc(t.id)}">
      ${txSquare(t)}
      <div class="reg-main">
        <span class="reg-title">${esc(t.description || '—')} <span class="reg-ctx">(${esc(txContext(t))})</span></span>
        <span class="reg-date">${inDay ? `${t.time}${t.type === 'transfer' || t.type === 'income' ? '' : ` · ${esc(accountById(state, t.accountId)?.name ?? '')}`}` : longDate(t.date, t.time)}${tags}</span>
      </div>
      <div class="reg-end">
        <span class="mw-amt ${cls}">${amt}</span>
        ${balance != null ? `<span class="mw-sub">${formatMoney(balance, cur)}</span>` : price}
      </div>
    </div>
    ${locked ? '' : `<button class="swipe-del" data-act="tx-swipe-delete" data-id="${esc(t.id)}">Delete</button>`}
  </li>`;
}

/** Grey summary pills under a register section title. */
export function statPills(items) {
  return `<div class="stat-pills">${items.map(([text, cls = '']) => `<span class="stat-pill ${cls}">${text}</span>`).join('')}</div>`;
}

/** "This Month", "Last Month", or "October 2026". */
export function monthHeading(id) {
  const today = localDateParts().monthId;
  if (id === today) return 'This Month';
  if (id === prevMonthId(today)) return 'Last Month';
  if (id === nextMonthId(today)) return 'Next Month';
  return monthLabel(id);
}

export function searchField(scope, value = '', placeholder = 'Search') {
  return `<label class="mw-search">${icon('search')}
    <input type="search" data-search="${scope}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search" aria-label="Search">
  </label>`;
}
