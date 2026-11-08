// App bootstrap: hash router, the five-tab shell, motion, global event delegation, service worker.
import { state, load, subscribe, ensureMonth, setWriteErrorHandler, saveSettings } from './store.js';
import { isMonthId, localDateParts } from './ledger.js';
import { icon } from './icons.js';
import { dispatch, registerActions, toast, isSheetOpen, closeSheet, setRenderer, esc } from './ui.js';
import { routes } from './routes.js';
import { renderAccounts, renderAccount, resetAccountSearch } from './views/accountsTab.js';
import { renderDailyPage, renderPlanPage, renderSummaryPage, renderTodoPage } from './views/pages.js';
import { renderReports } from './views/reports.js';
import { renderSettings, importBackupFile } from './views/settings.js';
import './views/budget.js'; // money owed to me + balance sheets (actions)
import './views/daily.js'; // transaction row actions (open / swipe-delete)
import { startSession, allUsers, useProfile } from './auth.js';
import { useDatabase } from './db.js';
import { profilePicker } from './views/authscreen.js';

const thisMonth = () => localDateParts().monthId;
const TABS = [
  { key: 'accounts', label: 'Accounts', ic: 'tab-accounts', href: () => routes.accounts() },
  { key: 'daily', label: 'Daily', ic: 'tab-daily', href: () => routes.daily(thisMonth()) },
  { key: 'plan', label: 'Planned', ic: 'tab-scheduled', href: () => routes.bills(thisMonth()) },
  { key: 'todo', label: 'To Do', ic: 'tab-todo', href: () => routes.todo(thisMonth()) },
  { key: 'summary', label: 'Summary', ic: 'tab-summary', href: () => routes.summary(thisMonth()) },
];

const app = document.getElementById('app');
let last = null; // previous route, for scroll keeping and transitions

/** Links from earlier versions: #/m/<month>/<tab>/…, #/y/<year>, #/budgets, #/scheduled, #/accounts/all. */
function legacy(parts) {
  const [p0, p1, p2, p3, p4] = parts;
  const month = isMonthId(p1 || '') ? p1 : thisMonth();
  if (p0 === 'y') return routes.summary(thisMonth());
  if (p0 === 'budgets') return routes.budgets(month, p2, p3);
  if (p0 === 'scheduled') return p2 === 'todo' ? routes.todo(month, p3) : routes.bills(month);
  if (p0 === 'reports' && p1 === 'review') return routes.summary(isMonthId(p2 || '') ? p2 : thisMonth());
  if (p0 === 'accounts' && p1 === 'all') return routes.daily(thisMonth());
  if (p0 !== 'm' || !isMonthId(p1 || '')) return null;
  if (p2 === 'buy') return routes.budgets(p1, p3, p4);
  if (p2 === 'todo') return routes.todo(p1, p3);
  if (p2 === 'summary') return routes.summary(p1);
  if (p2 === 'daily') return routes.daily(p1);
  return routes.accounts();
}

/** `tab` picks the screen; `nav` the highlighted tab (none for Settings). */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const old = legacy(parts);
  if (old) { history.replaceState(null, '', old); return parseRoute(); }
  const month = (x) => (isMonthId(x || '') ? x : thisMonth());
  switch (parts[0]) {
    case 'daily': return { tab: 'daily', nav: 'daily', month: month(parts[1]), depth: 0 };
    case 'plan': {
      const view = parts[2] === 'buy' ? 'buy' : 'bills';
      const path = view === 'buy' ? parts.slice(3, 5) : [];
      return { tab: 'plan', nav: 'plan', month: month(parts[1]), view, path, depth: path.length };
    }
    case 'summary': return { tab: 'summary', nav: 'summary', month: month(parts[1]), depth: 0 };
    case 'todo': return { tab: 'todo', nav: 'todo', month: month(parts[1]), path: parts.slice(2, 3), depth: parts[2] ? 1 : 0 };
    case 'reports': return { tab: 'reports', nav: 'summary', key: parts[1] || null, month: isMonthId(parts[2] || '') ? parts[2] : null, depth: parts[1] ? 2 : 1 };
    case 'settings': return { tab: 'settings', depth: 1 };
    default:
      if (parts[1] === 'a' && parts[2]) return { tab: 'accounts', nav: 'accounts', sub: 'account', id: parts[2], depth: 1 };
      return { tab: 'accounts', nav: 'accounts', depth: 0 };
  }
}

function renderScreen(r) {
  switch (r.tab) {
    case 'daily': return renderDailyPage(r.month);
    case 'plan': return renderPlanPage(r.month, r.view, r.path);
    case 'summary': return renderSummaryPage(r.month);
    case 'todo': return renderTodoPage(r.month, r.path);
    case 'reports': return renderReports(r.key, r.month);
    case 'settings': return renderSettings();
    default:
      if (r.sub === 'account') return renderAccount(r.id);
      return renderAccounts();
  }
}

function tabBar(active) {
  return `<nav class="mw-tabbar" aria-label="Sections">
    ${TABS.map((t) => `<a href="${t.href()}" class="mw-tab ${t.key === active ? 'active' : ''}" ${t.key === active ? 'aria-current="page"' : ''}>${icon(t.ic)}<span>${t.label}</span></a>`).join('')}
  </nav>`;
}

/** Where Settings' back button returns: the last tab page you were on. */
export let backHref = '#/accounts';

// Pages animate in only when opened from inside the app. When iOS's own swipe-back gesture
// (or the browser back button) navigates, iOS already animates — a second animation flickers.
let navIntent = false;
document.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) navIntent = true; }, true);
window.addEventListener('popstate', () => { setTimeout(() => { navIntent = false; }, 0); });

const routeKey = (r) => JSON.stringify(r);

/** Which entrance animation fits this navigation. */
function transitionFor(r) {
  if (!last) return 'enter';
  const fromTap = navIntent;
  navIntent = false;
  if (routeKey(last) === routeKey(r)) return null;
  if (!fromTap) return 'none';
  if (last.nav !== r.nav || last.tab !== r.tab) return r.depth > last.depth ? 'push' : r.depth < last.depth ? 'pop' : 'enter';
  if (r.depth > last.depth) return 'push';
  if (r.depth < last.depth) return 'pop';
  return 'fade';
}

/** Light / dark / automatic, and privacy mode, as classes on <html>. */
function applyDisplay() {
  const root = document.documentElement;
  const theme = state.settings.theme || 'system';
  if (theme === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = theme;
  root.classList.toggle('privacy', !!state.settings.privacy);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyDisplay);

export async function render() {
  const r = parseRoute();
  if (r.tab === 'accounts' && !r.sub && !state.months[thisMonth()]) {
    try { await ensureMonth(thisMonth()); } catch { /* the page still shows accounts */ }
  }
  if (r.month && !state.months[r.month]) {
    try { await ensureMonth(r.month); } catch { /* error toast shown by store */ }
    if (!state.months[r.month]) { app.innerHTML = '<p class="boot">Could not open this month.</p>'; return; }
  }
  if (last && (last.tab !== r.tab || last.id !== r.id || last.sub !== r.sub)) resetAccountSearch();
  if (r.nav && r.tab !== 'reports') backHref = location.hash || '#/accounts';
  applyDisplay();
  const motionClass = transitionFor(r);
  const y = window.scrollY;
  let html;
  try {
    html = renderScreen(r);
  } catch (e) {
    console.error(e);
    html = `<main class="content"><div class="banner danger">Something went wrong showing this screen: ${esc(e.message)}. Your data is safe.</div>
      <a class="btn btn-ghost" href="#/accounts">Back to Accounts</a></main>`;
  }
  const focused = document.activeElement?.dataset?.search;
  app.innerHTML = html + tabBar(r.nav);
  document.body.dataset.screen = r.tab;
  if (motionClass && motionClass !== 'none') app.querySelector('.content')?.classList.add(motionClass);
  window.scrollTo(0, motionClass ? 0 : y);
  if (focused) {
    const input = app.querySelector(`[data-search="${focused}"]`);
    if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
  }
  setupCarousels(motionClass !== null);
  last = r;
}

/** Horizontal carousels (Summary years): start on the current card and keep the page dots in sync. */
function setupCarousels(reset) {
  app.querySelectorAll('[data-carousel]').forEach((c) => {
    const dots = c.nextElementSibling?.classList.contains('dots') ? [...c.nextElementSibling.children] : [];
    const here = c.querySelector('[data-scroll-here]');
    if (here && (reset || !c.dataset.ready)) c.scrollLeft = here.offsetLeft - c.offsetLeft - parseFloat(getComputedStyle(c).paddingLeft || 0);
    c.dataset.ready = '1';
    const sync = () => {
      const i = Math.round(c.scrollLeft / Math.max(1, c.firstElementChild.offsetWidth + 16));
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
    };
    c.addEventListener('scroll', sync, { passive: true });
    sync();
  });
}

setRenderer(render);

registerActions({
  'profile-switch': async (el) => {
    await useProfile(el.dataset.id);
    closeSheet();
    location.hash = '#/';
    location.reload();
  },
});

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) dispatch(el, e);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.change === 'backup-import') importBackupFile(e.target).catch((err) => toast(err.message));
  if (e.target.name === 'theme' && !e.target.closest('.sheet')) saveSettings({ theme: e.target.value }).catch((err) => toast(err.message));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSheetOpen()) closeSheet();
});
window.addEventListener('hashchange', () => { closeSheet(); render(); });
subscribe(() => render());
setWriteErrorHandler((err) => toast(`Couldn’t save: ${err.message || 'storage error'}. Your last change was undone.`, { duration: 6000 }));

// ---------- boot ----------
export let user = null; // the profile in use (its data lives in its own database)
export let profiles = []; // every profile on this iPhone

(async function boot() {
  try {
    user = await startSession(); // no password: opens the last-used profile
    if (!user) { app.innerHTML = ''; user = await profilePicker(); }
    profiles = await allUsers();
    useDatabase(user.dataDb);
  } catch (e) {
    console.error(e);
    toast(`Profiles are unavailable: ${e.message}`);
  }
  await load();
  app.innerHTML = '';
  await render();
  navigator.storage?.persist?.().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isSheetOpen()) render(); // the date may have changed
  });
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
