// Small UI toolkit: escaping, bottom sheets, confirm dialog, toasts, shared widgets.
import { icon } from './icons.js';
import { formatMoney, CURRENCIES, FOREIGN } from './money.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- re-render hook (set by app.js) ----------
let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const rerender = () => renderer();

// ---------- actions (event delegation) ----------
export const actions = {};
export const registerActions = (map) => Object.assign(actions, map);
let sheetActions = {};

/** Tiny bit of motion state that survives a re-render (e.g. the checkbox that was just ticked). */
export const motion = { pop: null };
let popTimer = null;

export function dispatch(el, ev) {
  const name = el.dataset.act;
  if (el.classList.contains('check')) {
    motion.pop = el.dataset.id;
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { motion.pop = null; }, 700);
  }
  const fn = sheetActions[name] || actions[name];
  if (fn) {
    ev.preventDefault();
    Promise.resolve(fn(el, ev)).catch((e) => toast(e.message || 'Something went wrong'));
  }
}

// ---------- bottom sheet ----------
let lastFocus = null;

/**
 * openSheet({ title, body, submitLabel, onSubmit(form) → false keeps it open, actions, onOpen })
 */
/**
 * openSheet({ title, body, submitLabel, onSubmit(form) → false keeps it open, actions, onOpen, footer })
 * Footer layout (top → bottom): [secondary · primary] then the destructive action, so the
 * main action is closest to the thumb and "Delete" is never between the fields and "Save".
 * Any .btn-danger-ghost in the body is moved to that last slot automatically.
 */
export function openSheet({ title, body, submitLabel = 'Save', onSubmit = null, actions: acts = {}, onOpen, footer = '' }) {
  const root = document.getElementById('sheet-root');
  const wasOpen = root.classList.contains('open') && !root.classList.contains('closing');
  sheetToken++;
  if (!wasOpen) { lastFocus = document.activeElement; lockPageScroll(); }
  sheetActions = { 'sheet-close': () => closeSheet(), ...acts };
  const primary = onSubmit ? `<button class="btn btn-primary" type="submit">${esc(submitLabel)}</button>` : '';
  root.innerHTML = `
    <div class="sheet-backdrop" data-act="sheet-close"></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate autocomplete="off">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="glass-btn sm" data-act="sheet-close" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
      <footer class="sheet-foot">
        ${footer || primary ? `<div class="foot-row">${footer}${primary}</div>` : ''}
        <div class="foot-danger"></div>
      </footer>
    </form>`;
  const foot = root.querySelector('.sheet-foot');
  const dangers = root.querySelectorAll('.sheet-body .btn-danger-ghost');
  dangers.forEach((b) => root.querySelector('.foot-danger').appendChild(b));
  if (!footer && !primary && !dangers.length) foot.remove();
  root.classList.remove('closing');
  root.classList.toggle('swap', wasOpen); // replacing one sheet with another: no slide-in
  root.classList.add('open');
  document.body.classList.add('sheet-open');
  trackViewport(true);
  const form = root.querySelector('form');
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit || busy) return;
    busy = true;
    clearErrors(form);
    try {
      const r = await onSubmit(form);
      if (r !== false) closeSheet();
    } catch (err) {
      toast(err.message || 'Could not save');
    } finally {
      busy = false;
    }
  });
  // keep the focused field visible inside the sheet once the keyboard has opened
  form.addEventListener('focusin', (e) => {
    if (!e.target.matches('input, select, textarea')) return;
    setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 320);
  });
  onOpen?.(form);
  const auto = form.querySelector('[autofocus]');
  if (auto) auto.focus({ preventScroll: true });
  return form;
}

let sheetToken = 0;

// ---------- keyboard-aware sheets ----------
// iOS doesn't shrink the page when the keyboard opens, it only shrinks the "visual viewport".
// The sheet layer follows the visual viewport, so the sheet sits right above the keyboard
// and the page underneath never has to scroll.
let scrollLockY = 0;
function lockPageScroll() {
  scrollLockY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${scrollLockY}px`, left: '0', right: '0' });
}
function unlockPageScroll() {
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' });
  window.scrollTo(0, scrollLockY);
}

function syncViewport() {
  const root = document.getElementById('sheet-root');
  const vv = window.visualViewport;
  if (!vv) return;
  root.style.top = `${vv.offsetTop}px`;
  root.style.height = `${vv.height}px`;
  root.classList.toggle('kb', window.innerHeight - vv.height > 120); // keyboard is up
}
function trackViewport(on) {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.removeEventListener('resize', syncViewport);
  vv.removeEventListener('scroll', syncViewport);
  if (on) {
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
    syncViewport();
  }
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root.classList.contains('open') || root.classList.contains('closing')) return;
  const token = ++sheetToken;
  sheetActions = {};
  root.classList.add('closing');
  document.body.classList.remove('sheet-open');
  document.activeElement?.blur?.();
  unlockPageScroll();
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  const done = () => {
    if (token !== sheetToken) return; // a new sheet opened meanwhile
    trackViewport(false);
    root.classList.remove('open', 'closing', 'swap', 'kb');
    root.style.top = '';
    root.style.height = '';
    root.innerHTML = '';
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else setTimeout(done, 260);
}

export const isSheetOpen = () => { const r = document.getElementById('sheet-root'); return r.classList.contains('open') && !r.classList.contains('closing'); };

export function fieldError(form, name, message) {
  const input = form.querySelector(`[name="${name}"]`);
  const field = input?.closest('.field') || input?.parentElement;
  if (field) {
    field.classList.add('has-error');
    let el = field.querySelector('.field-error');
    if (!el) {
      el = document.createElement('p');
      el.className = 'field-error';
      field.appendChild(el);
    }
    el.textContent = message;
    input.focus();
  } else {
    toast(message);
  }
  return false;
}

function clearErrors(form) {
  form.querySelectorAll('.has-error').forEach((f) => f.classList.remove('has-error'));
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
}

/** Promise<boolean> confirm dialog built on the sheet. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; closeSheet(); resolve(v); } };
    openSheet({
      title,
      body: `<p class="sheet-text">${message}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-act="cf-no">${esc(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="cf-yes">${esc(confirmLabel)}</button>`,
      actions: { 'cf-yes': () => answer(true), 'cf-no': () => answer(false), 'sheet-close': () => answer(false) },
    });
  });
}

/** Ask the user to pick one of several options. Resolves with the option key or null. */
export function chooseDialog({ title, message = '', options }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; closeSheet(); resolve(v); } };
    const acts = { 'sheet-close': () => answer(null) };
    options.forEach((o, i) => { acts[`ch-${i}`] = () => answer(o.key); });
    openSheet({
      title,
      body: `${message ? `<p class="sheet-text">${message}</p>` : ''}
        <div class="choice-list">${options.map((o, i) => `
          <button type="button" class="choice ${o.primary ? 'primary' : ''}" data-act="ch-${i}">
            <span class="choice-title">${esc(o.label)}</span>
            ${o.hint ? `<span class="choice-hint">${esc(o.hint)}</span>` : ''}
          </button>`).join('')}
        </div>`,
      actions: acts,
    });
  });
}

// ---------- toast ----------
let toastTimer = null;
export function toast(message, { actionLabel, onAction, duration = 3200 } = {}) {
  const root = document.getElementById('toast-root');
  clearTimeout(toastTimer);
  root.innerHTML = `<div class="toast" role="status">
      <span>${esc(message)}</span>
      ${actionLabel ? `<button type="button" class="toast-btn">${esc(actionLabel)}</button>` : ''}
    </div>`;
  const el = root.firstElementChild;
  const hide = () => {
    el.classList.add('out');
    setTimeout(() => { if (root.firstElementChild === el) root.innerHTML = ''; }, 220);
  };
  el.querySelector('.toast-btn')?.addEventListener('click', () => {
    hide();
    Promise.resolve(onAction?.()).catch((e) => toast(e.message));
  });
  toastTimer = setTimeout(hide, actionLabel ? Math.max(duration, 6000) : duration);
}

// ---------- shared widgets ----------
export function checkbox(checked, act, attrs = '', label = '', { sm = false, id = null } = {}) {
  const pop = checked && id && motion.pop === id ? 'pop' : '';
  return `<button type="button" class="check ${sm ? 'sm' : ''} ${checked ? 'on' : ''} ${pop}" role="checkbox" aria-checked="${checked}" aria-label="${esc(label)}" data-act="${act}" ${attrs}>${icon('check')}</button>`;
}

/** iOS-style switch row. */
export function switchRow(name, checked, label, hint = '') {
  return `<label class="check-line"><span>${esc(label)}${hint ? `<br><span class="hint">${esc(hint)}</span>` : ''}</span>
    <span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></span></label>`;
}

export function segmented(name, options, value, { small = false, cls = '' } = {}) {
  return `<div class="seg ${small ? 'seg-sm' : ''} ${cls}" role="radiogroup">${options.map(([v, label]) => `
    <label class="seg-opt" data-v="${esc(v)}"><input type="radio" name="${name}" value="${esc(v)}" ${v === value ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
  </div>`;
}

export const currencySeg = (value, name = 'currency') => segmented(name, CURRENCIES.map((c) => [c, c]), value, { cls: 'seg-cur' });

export function emptyState(title, text = '', button = '') {
  return `<div class="empty"><p class="empty-title">${esc(title)}</p>${text ? `<p class="empty-text">${text}</p>` : ''}${button}</div>`;
}

/** "12,500 ALL · €40.00 · $5.00" — only non-zero parts, never mixed. */
export function pairText(pair, { always = false } = {}) {
  const parts = CURRENCIES.filter((c) => pair[c] || (always && c === 'ALL')).map((c) => formatMoney(pair[c], c));
  return parts.length ? parts.join(' · ') : formatMoney(0, 'ALL');
}

/** Big ALL amount with a small unit, plus smaller lines for other currencies. */
export function moneyStack(label, pair, { show = ['EUR'], neg = false } = {}) {
  const others = FOREIGN.filter((c) => show.includes(c) || pair[c]);
  return `<div class="money-stack">
    <p class="eyebrow">${esc(label)}</p>
    <p class="big sm ${neg ? 'neg' : ''}">${formatMoney(pair.ALL || 0, 'ALL').replace(' ALL', '')}<span class="unit">ALL</span></p>
    ${others.map((c) => `<p class="sub-amt">${formatMoney(pair[c] || 0, c)}</p>`).join('')}
  </div>`;
}

/** Foreign currencies that should get a line in a group of stacks (EUR always, USD when used). */
export const shownCurrencies = (...pairs) => ['EUR', ...(pairs.some((p) => p.USD) ? ['USD'] : [])];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]}, ${d} ${MON[m - 1]}`;
}
export function shortDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MON[m - 1]}`;
}
