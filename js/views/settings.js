// Settings — accounts, default exchange rate, backup / restore, CSV, install help.
import { state, setRates, ensureMonth, backupObject, restoreFrom, undoRestore, markBackedUp } from '../store.js';
import { parseRate, formatRate } from '../money.js';
import { validateBackup, toCsv, saveFile } from '../backup.js';
import { ACCOUNT_KINDS } from '../defaults.js';
import { icon } from '../icons.js';
import { esc, registerActions, actions, openSheet, fieldError, toast, confirmDialog } from '../ui.js';
import { localDateParts } from '../ledger.js';
import { openAccountSheet } from './accounts.js';
import { topBar, largeTitle, accountSquare } from './chrome.js';
import { openImportSheet } from './importer.js';
import { segmented, actions as allActions } from '../ui.js';
import { user, profiles, backHref } from '../app.js';
import { routes } from '../routes.js';
import { profileName } from '../auth.js';

export const APP_VERSION = '2.1.1';
let persisted = null;

export function renderSettings() {
  const s = state.settings;
  const last = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString() : 'never';
  navigator.storage?.persisted?.().then((p) => {
    if (p !== persisted) { persisted = p; const el = document.querySelector('[data-persist]'); if (el) el.textContent = p ? 'Protected from automatic clean-up' : 'Standard (install to Home Screen for best protection)'; }
  });

  return `
    ${topBar({ back: backHref })}
    <main class="content">
      ${largeTitle('Settings')}
      <p class="section-label"><span>Accounts</span></p>
      <ul class="list card flush">${s.accounts.map((a) => `
        <li class="row tappable has-icon ${a.archived ? 'faded' : ''}" data-act="acc-open" data-id="${esc(a.id)}">
          ${accountSquare(a)}
          <div class="row-main"><span class="row-title">${esc(a.name)}</span><span class="row-sub">${ACCOUNT_KINDS[a.kind] || 'Account'} · ${a.currency}${a.archived ? ' · hidden' : ''}</span></div>
          <span class="row-end">${icon('chev-right')}</span>
        </li>`).join('')}
        <li class="row tappable" data-act="acc-add"><span class="accent">${icon('plus', 'ic-xs')} Add account</span></li>
      </ul>
      <p class="hint" style="padding:0 16px">Add each account once. A balance you type here applies to the current month.</p>

      <p class="section-label"><span>Display</span></p>
      <ul class="list card flush">
        <li class="row"><div class="row-main"><span class="row-title">Appearance</span></div>
          ${segmented('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme || 'system', { small: true, cls: 'seg-theme' })}</li>
        <li class="row tappable" data-act="privacy-toggle"><div class="row-main"><span class="row-title">Privacy mode</span><span class="row-sub">Hides every amount — handy in public. Also the ${icon('eye', 'ic-xs')} button at the top.</span></div>
          <span class="switch"><input type="checkbox" ${s.privacy ? 'checked' : ''} tabindex="-1"><span></span></span></li>
      </ul>

      <p class="section-label"><span>More</span></p>
      <ul class="list card flush">
        <li><a class="row" href="${routes.reports()}"><div class="row-main"><span class="row-title">Reports</span><span class="row-sub">Charts for spending, income, net worth and more</span></div><span class="row-end">${icon('chev-right')}</span></a></li>
      </ul>

      <p class="section-label"><span>Data</span></p>
      <ul class="list card flush">
        <li class="row tappable" data-act="import-open"><div class="row-main"><span class="row-title">Import transactions</span><span class="row-sub">CSV, OFX, QFX or QIF from your bank</span></div><span class="row-end">${icon('chev-right')}</span></li>
        <li class="row tappable" data-act="cats-open"><div class="row-main"><span class="row-title">Categories</span><span class="row-sub">Rename, add or remove spending categories</span></div><span class="row-end">${icon('chev-right')}</span></li>
      </ul>

      ${user ? `<p class="section-label"><span>Profile</span></p>
      <ul class="list card flush">
        <li class="row has-icon"><span class="icon-tile">${icon('user')}</span><div class="row-main"><span class="row-title">${esc(profileName(user))}</span><span class="row-sub">On this iPhone since ${esc(user.createdAt.slice(0, 10))} · no password</span></div></li>
        ${profiles.filter((p) => p.id !== user.id).map((p) => `<li class="row tappable" data-act="profile-switch" data-id="${esc(p.id)}"><div class="row-main"><span class="row-title">Switch to ${esc(profileName(p))}</span>${p.email ? `<span class="row-sub">${esc(p.email)}</span>` : ''}</div><span class="row-end">${icon('chev-right')}</span></li>`).join('')}
      </ul>` : ''}

      <p class="section-label"><span>Exchange rate</span></p>
      <ul class="list card flush">
        <li class="row tappable" data-act="defrate-edit">
          <div class="row-main"><span class="row-title">1 EUR = ${formatRate(s.defaultRate)} ALL</span><span class="row-sub">1 USD = ${formatRate(s.usdRate)} ALL · used for “≈ ALL” figures</span></div>
          <span class="row-end">${icon('chev-right')}</span>
        </li>
      </ul>

      <p class="section-label"><span>Backup</span><span>Last: ${esc(last)}</span></p>
      <div class="card">
        <p class="hint">Your data lives only on this device — no cloud copy or sync. Export a backup regularly and keep it in Files / iCloud Drive.</p>
        <div class="stack">
          <button class="btn btn-primary btn-block" data-act="backup-export">${icon('download')} Export backup</button>
          <label class="btn btn-ghost btn-block file-btn">${icon('upload')} Restore backup…<input type="file" accept=".json,application/json" data-change="backup-import" hidden></label>
          ${state.hasRestorePoint ? `<button class="btn btn-ghost btn-block" data-act="restore-undo">${icon('undo')} Undo last restore</button>` : ''}
          <button class="btn btn-ghost btn-block" data-act="csv-all">${icon('receipt')} Export transactions (CSV)</button>
        </div>
      </div>

      <p class="section-label"><span>Install on iPhone</span></p>
      <div class="card">
        <ol class="steps">
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>
          <li>Open <b>Planner</b> from your Home Screen — it works offline.</li>
        </ol>
        <p class="hint">Safari and the Home Screen app keep separate data. Use the installed app, or move data with Export / Restore.</p>
      </div>

      <p class="section-label"><span>About</span></p>
      <ul class="list card flush">
        <li class="row"><div class="row-main"><span class="row-title">Storage</span><span class="row-sub" data-persist>Checking…</span></div></li>
        <li class="row"><div class="row-main"><span class="row-title">Records</span><span class="row-sub">${Object.keys(state.months).length} months · ${state.transactions.length} transactions</span></div></li>
        <li class="row"><div class="row-main"><span class="row-title">Version ${APP_VERSION}</span><span class="row-sub">Works offline · no data leaves this device</span></div></li>
      </ul>
    </main>`;
}

registerActions({
  'import-open': () => openImportSheet(),
  'cats-open': async () => {
    const id = localDateParts().monthId;
    await ensureMonth(id);
    const btn = document.createElement('button');
    btn.dataset.month = id;
    allActions['cats-edit'](btn);
  },
  'acc-add': async () => {
    const monthId = localDateParts().monthId;
    await ensureMonth(monthId);
    openAccountSheet({ monthId });
  },
  'acc-open': async (el) => {
    const monthId = localDateParts().monthId;
    await ensureMonth(monthId);
    const a = state.settings.accounts.find((x) => x.id === el.dataset.id);
    if (a) openAccountSheet({ account: a, monthId });
  },
  'defrate-edit': () => openSheet({
    title: 'Exchange rates',
    body: `<label class="field field-inline"><span class="label">1 EUR = ? ALL</span><input class="input input-right" name="eur" inputmode="decimal" value="${formatRate(state.settings.defaultRate)}"></label>
      <label class="field field-inline"><span class="label">1 USD = ? ALL</span><input class="input input-right" name="usd" inputmode="decimal" value="${formatRate(state.settings.usdRate)}"></label>
      <p class="hint">Applies to open months and new months. Closed months keep the rates saved when they were closed. Your amounts always stay in their own currency.</p>`,
    onSubmit: async (form) => {
      const e = parseRate(form.eur.value);
      if (!e.ok) return fieldError(form, 'eur', e.error);
      const u = parseRate(form.usd.value);
      if (!u.ok) return fieldError(form, 'usd', u.error);
      await setRates({ EUR: e.rate, USD: u.rate });
      toast('Rates saved');
    },
  }),

  'backup-export': async () => {
    const data = backupObject();
    const name = `planner-backup-${localDateParts().date}.json`;
    const r = await saveFile(name, JSON.stringify(data, null, 1), 'application/json');
    if (r === 'cancelled') return;
    await markBackedUp();
    toast(r === 'shared' ? 'Backup ready — choose “Save to Files”' : 'Backup downloaded');
  },
  'csv-all': async () => {
    const r = await saveFile(`planner-transactions-${localDateParts().date}.csv`, toCsv(state), 'text/csv');
    if (r !== 'cancelled') toast('CSV exported');
  },
  'restore-undo': async () => {
    const ok = await confirmDialog({ title: 'Undo last restore?', message: 'Your data goes back to how it was just before the last restore.', confirmLabel: 'Undo restore' });
    if (!ok) return;
    await undoRestore();
    toast('Previous data is back');
  },
});

/** File input change handler (wired by app.js via data-change). */
export async function importBackupFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return toast('That file is too large to be a planner backup.');
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast('Could not read this file. Choose a planner backup (.json).');
  }
  const res = validateBackup(parsed);
  if (!res.ok) return toast(res.error);
  const when = res.summary.exportedAt ? new Date(res.summary.exportedAt).toLocaleString() : 'unknown date';
  const ok = await confirmDialog({
    title: 'Replace data with this backup?',
    message: `Backup from <b>${esc(when)}</b>: ${res.summary.months} months, ${res.summary.transactions} transactions.<br><br>All current data on this device is replaced. You can undo this right after with “Undo last restore”.`,
    confirmLabel: 'Restore',
    danger: true,
  });
  if (!ok) return;
  await restoreFrom(res.data);
  toast('Backup restored');
}

