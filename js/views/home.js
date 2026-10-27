// Home — year selector and 12 month cards.
import { state } from '../store.js';
import { yearOverview, makeMonthId, localDateParts, MONTH_NAMES } from '../ledger.js';
import { formatMoney } from '../money.js';
import { icon } from '../icons.js';
import { esc } from '../ui.js';

export function renderHome(year) {
  const today = localDateParts();
  const yo = yearOverview(state, year);
  const last = state.settings.lastBackupAt;
  const hasData = state.transactions.length > 0;
  const daysSince = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  const needsBackup = hasData && (daysSince === null || daysSince > 30);

  return `
    <header class="topbar">
      <span class="topbar-spacer"></span>
      <nav class="pill-switch" aria-label="Year">
        <a href="#/y/${year - 1}" aria-label="Previous year">${icon('chev-left')}</a>
        <span class="title num">${year}</span>
        <a href="#/y/${year + 1}" aria-label="Next year">${icon('chev-right')}</a>
      </nav>
      <a class="glass-btn" href="#/settings" aria-label="Settings &amp; backup">${icon('settings')}</a>
    </header>
    <main class="content">
      <h1 class="large-title">Planner</h1>
      ${state.storageError ? `<div class="banner danger">Storage is unavailable (${esc(state.storageError.message)}). Changes can’t be saved. In Safari, turn off Private Browsing.</div>` : ''}
      ${needsBackup ? `<a class="banner" href="#/settings">${icon('download')} <span>${daysSince === null ? 'You haven’t made a backup yet.' : `Last backup was ${daysSince} days ago.`} <b>Back up now</b></span></a>` : ''}
      ${yo.totalAll ? `<p class="year-total">Spent in ${year} <b>≈ ${formatMoney(yo.totalAll, 'ALL')}</b></p>` : ''}
      <div class="month-grid">
        ${MONTH_NAMES.map((name, i) => {
          const id = makeMonthId(year, i + 1);
          const info = yo.months[i];
          const isNow = id === today.monthId;
          let status = '<span class="m-status">Not started</span>';
          if (info.exists) {
            status = info.closed
              ? `<span class="m-status ok">${icon('check', 'ic-xs')} Closed</span>`
              : `<span class="m-status">${isNow ? 'This month' : 'Open'}</span>`;
          } else if (isNow) status = '<span class="m-status">This month</span>';
          return `<a class="month-card ${isNow ? 'now' : ''} ${info.exists ? '' : 'not-started'}" href="#/m/${id}">
            <span class="m-name">${name}</span>
            ${info.active ? `<span class="m-amount">≈ ${formatMoney(Math.round(info.spendingAll / 100) * 100, 'ALL')}</span><span class="m-label">spent</span>` : '<span class="m-amount dim">—</span><span class="m-label">&nbsp;</span>'}
            ${status}
          </a>`;
        }).join('')}
      </div>
      <p class="hint center">All data is stored only on this device. Back up regularly from Settings.</p>
    </main>
    <div class="dock solo"><button class="add-btn" data-act="fab-home" aria-label="Add expense to ${MONTH_NAMES[Number(today.monthId.slice(5)) - 1]}">${icon('plus')}</button></div>
  `;
}
