// Small UI toolkit: escaping, bottom sheets, confirm dialog, toasts, shared widgets.
import { icon } from './icons.js';
import { formatMoney, combinedAll, formatRate } from './money.js';

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
export function openSheet({ title, body, submitLabel = 'Save', onSubmit = null, actions: acts = {}, onOpen, footer = '' }) {
  const root = document.getElementById('sheet-root');
  const wasOpen = root.classList.contains('open') && !root.classList.contains('closing');
  sheetToken++;
  if (!wasOpen) lastFocus = document.activeElement;
  sheetActions = { 'sheet-close': () => closeSheet(), ...acts };
  root.innerHTML = `
    <div class="sheet-backdrop" data-act="sheet-close"></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate autocomplete="off">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="glass-btn sm" data-act="sheet-close" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
      ${onSubmit || footer ? `<footer class="sheet-foot">${footer}${onSubmit ? `<button class="btn btn-primary btn-block" type="submit">${esc(submitLabel)}</button>` : ''}</footer>` : ''}
    </form>`;
  root.classList.remove('closing');
  root.classList.toggle('swap', wasOpen); // replacing one sheet with another: no slide-in
  root.classList.add('open');
  document.body.classList.add('sheet-open');
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
  onOpen?.(form);
  const auto = form.querySelector('[autofocus]');
  if (auto) auto.focus({ preventScroll: true });
  return form;
}

let sheetToken = 0;

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root.classList.contains('open') || root.classList.contains('closing')) return;
  const token = ++sheetToken;
  sheetActions = {};
  root.classList.add('closing');
  document.body.classList.remove('sheet-open');
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  const done = () => {
    if (token !== sheetToken) return; // a new sheet opened meanwhile
    root.classList.remove('open', 'closing', 'swap');
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
      footer: `<div class="btn-row">
          <button type="button" class="btn btn-ghost" data-act="cf-no">${esc(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="cf-yes">${esc(confirmLabel)}</button>
        </div>`,
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

export function segmented(name, options, value, { small = false } = {}) {
  return `<div class="seg ${small ? 'seg-sm' : ''}" role="radiogroup">${options.map(([v, label]) => `
    <label class="seg-opt"><input type="radio" name="${name}" value="${esc(v)}" ${v === value ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
  </div>`;
}

export const currencySeg = (value, name = 'currency') => segmented(name, [['ALL', 'ALL'], ['EUR', 'EUR']], value);

export function emptyState(title, text = '', button = '') {
  return `<div class="empty"><p class="empty-title">${esc(title)}</p>${text ? `<p class="empty-text">${text}</p>` : ''}${button}</div>`;
}

/** "12,500 ALL · €40.00" — only non-zero parts, never mixed. */
export function pairText(pair, { always = false } = {}) {
  const parts = [];
  if (pair.ALL || always) parts.push(formatMoney(pair.ALL, 'ALL'));
  if (pair.EUR) parts.push(formatMoney(pair.EUR, 'EUR'));
  return parts.length ? parts.join(' · ') : formatMoney(0, 'ALL');
}

/** Labelled converted total. */
export function convertedText(pair, rate) {
  return `≈ ${formatMoney(combinedAll(pair, rate), 'ALL')}`;
}

export function rateNote(rate) {
  return `converted at 1 EUR = ${formatRate(rate)} ALL`;
}

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
