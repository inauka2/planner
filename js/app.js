// App bootstrap: hash router, rendering, motion, global event delegation, service worker.
import { state, load, subscribe, ensureMonth, setWriteErrorHandler } from './store.js';
import { isMonthId, monthLabel, localDateParts, prevMonthId, nextMonthId, canEdit, parseMonthId } from './ledger.js';
import { icon } from './icons.js';
import { dispatch, registerActions, toast, isSheetOpen, closeSheet, setRenderer, esc } from './ui.js';
import { renderHome } from './views/home.js';
import { renderBudget } from './views/budget.js';
import { renderDaily } from './views/daily.js';
import { renderBuy } from './views/buy.js';
import { renderTodo, addTaskSheet } from './views/todo.js';
import { renderSummary } from './views/summary.js';
import { renderSettings, importBackupFile } from './views/settings.js';
import { openTxSheet } from './views/txsheet.js';
import { addPlanItem } from './views/plan.js';

const TABS = [
  { key: 'budget', label: 'Budget', title: 'Budget', render: renderBudget },
  { key: 'daily', label: 'Daily', title: 'Daily', render: renderDaily },
  { key: 'buy', label: 'To Buy', title: null, render: renderBuy }, // renders its own title (drill-down)
  { key: 'todo', label: 'To Do', title: null, render: renderTodo },
  { key: 'summary', label: 'Summary', title: 'Summary', render: renderSummary },
];
const TAB_KEY = 'planner.lastTab';

const app = document.getElementById('app');
let last = null; // previous route, for scroll keeping and transitions

function lastTab() {
  try { return localStorage.getItem(TAB_KEY) || 'budget'; } catch { return 'budget'; }
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'm' && isMonthId(parts[1] || '')) {
    const tab = TABS.some((t) => t.key === parts[2]) ? parts[2] : lastTab();
    return { name: 'month', id: parts[1], tab, path: tab === 'buy' ? parts.slice(3, 5) : [] };
  }
  if (parts[0] === 'settings') return { name: 'settings' };
  const y = parts[0] === 'y' && /^\d{4}$/.test(parts[1] || '') ? Number(parts[1]) : new Date().getFullYear();
  return { name: 'home', year: y };
}

function renderMonth(r) {
  const m = state.months[r.id];
  const tabIdx = TABS.findIndex((t) => t.key === r.tab);
  const tab = TABS[tabIdx];
  const { year } = parseMonthId(r.id);
  const hideAdd = m.closing && ['budget', 'daily', 'summary', 'buy'].includes(r.tab);
  const prevIdx = last?.name === 'month' ? TABS.findIndex((t) => t.key === last.tab) : tabIdx;
  return `
    <header class="topbar">
      <a class="glass-btn" href="#/y/${year}" aria-label="All months">${icon('grid')}</a>
      <nav class="pill-switch" aria-label="Month">
        <a href="#/m/${prevMonthId(r.id)}/${r.tab}" aria-label="Previous month">${icon('chev-left')}</a>
        <span class="title">${m.closing ? icon('lock') : ''}${monthLabel(r.id)}</span>
        <a href="#/m/${nextMonthId(r.id)}/${r.tab}" aria-label="Next month">${icon('chev-right')}</a>
      </nav>
      <span class="topbar-spacer"></span>
    </header>
    <main class="content" id="tab-${r.tab}">
      ${tab.title ? `<h1 class="large-title">${tab.title}</h1>` : ''}
      ${tab.render(r.id, r.path)}
    </main>
    <div class="dock">
      <nav class="tabbar" aria-label="Month sections">
        <span class="tab-indicator" style="--i:${prevIdx}"></span>
        ${TABS.map((t) => `<a href="#/m/${r.id}/${t.key}" class="tab ${t.key === r.tab ? 'active' : ''}" ${t.key === r.tab ? 'aria-current="page"' : ''}>${icon(`tab-${t.key}`)}<span>${t.label}</span></a>`).join('')}
      </nav>
      ${hideAdd ? '' : `<button class="add-btn" data-act="fab" data-month="${r.id}" data-tab="${r.tab}" data-path="${esc(r.path.join('/'))}" aria-label="Add">${icon('plus')}</button>`}
    </div>`;
}

/** Which entrance animation fits this navigation. */
function transitionFor(r) {
  if (!last) return 'enter';
  if (last.name !== r.name) return 'enter';
  if (r.name === 'month') {
    if (last.id !== r.id || last.tab !== r.tab) return 'enter';
    if (r.path.length > last.path.length) return 'push';
    if (r.path.length < last.path.length) return 'pop';
    if (r.path.join('/') !== last.path.join('/')) return 'push';
    return null;
  }
  if (r.name === 'home' && last.year !== r.year) return 'enter';
  return null;
}

export async function render() {
  const r = parseRoute();
  if (r.name === 'month' && !state.months[r.id]) {
    try { await ensureMonth(r.id); } catch { /* error toast shown by store */ }
    if (!state.months[r.id]) { app.innerHTML = '<p class="boot">Could not open this month.</p>'; return; }
  }
  const motionClass = transitionFor(r);
  const y = window.scrollY;
  let html;
  try {
    if (r.name === 'month') {
      html = renderMonth(r);
      try { localStorage.setItem(TAB_KEY, r.tab); } catch { /* private mode */ }
    } else if (r.name === 'settings') html = renderSettings();
    else html = renderHome(r.year);
  } catch (e) {
    console.error(e);
    html = `<main class="content"><div class="banner danger">Something went wrong showing this screen: ${esc(e.message)}. Your data is safe.</div>
      <a class="btn btn-ghost" href="#/">Back to months</a></main>`;
  }
  app.innerHTML = html;
  document.body.dataset.screen = r.name;
  if (motionClass) app.querySelector('.content')?.classList.add(motionClass);
  window.scrollTo(0, motionClass ? 0 : y);
  if (r.name === 'home' && motionClass) document.querySelector('.month-card.now')?.scrollIntoView({ block: 'center' });
  // slide the tab highlight from the previous tab to the current one
  const ind = app.querySelector('.tab-indicator');
  if (ind) {
    ind.getBoundingClientRect(); // commit the start position before moving
    ind.style.setProperty('--i', TABS.findIndex((t) => t.key === r.tab));
  }
  last = r;
}

setRenderer(render);

// ---------- add button ----------
registerActions({
  fab: (el) => {
    const { month: id, tab } = el.dataset;
    const [catId, listId] = (el.dataset.path || '').split('/').filter(Boolean);
    if (tab === 'todo') return addTaskSheet(id);
    if (tab === 'buy') return addPlanItem(id, { kind: 'expense', categoryId: catId || null, listId: listId || null });
    const c = canEdit(state, id);
    if (!c.ok) return toast(c.reason);
    openTxSheet({ monthId: id, type: 'expense' });
  },
  'fab-home': async () => {
    const id = localDateParts().monthId;
    await ensureMonth(id);
    openTxSheet({ monthId: id, type: 'expense' });
  },
});

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) dispatch(el, e);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.change === 'backup-import') importBackupFile(e.target).catch((err) => toast(err.message));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSheetOpen()) closeSheet();
});
window.addEventListener('hashchange', () => { closeSheet(); render(); });
subscribe(() => render());
setWriteErrorHandler((err) => toast(`Couldn’t save: ${err.message || 'storage error'}. Your last change was undone.`, { duration: 6000 }));

// ---------- boot ----------
(async function boot() {
  await load();
  await render();
  navigator.storage?.persist?.().catch(() => {});
  // Re-render when the app comes back to the foreground (date may have changed).
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !isSheetOpen()) render(); });
})();

// ---------- service worker (offline + updates) ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const offerUpdate = (worker) => toast('A new version is ready', {
        actionLabel: 'Update', duration: 15000,
        onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
      });
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    } catch (e) {
      console.warn('Service worker registration failed', e);
    }
  });
}
