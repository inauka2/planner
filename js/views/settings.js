// Settings — accounts, default exchange rate, backup / restore, CSV, install help.
import { state, saveSettings, setRate, uid, backupObject, restoreFrom, undoRestore, markBackedUp } from '../store.js';
import { parseRate, formatRate } from '../money.js';
import { validateBackup, toCsv, saveFile } from '../backup.js';
import { ACCOUNT_KINDS } from '../defaults.js';
import { icon } from '../icons.js';
import { esc, registerActions, openSheet, fieldError, toast, confirmDialog, segmented, currencySeg } from '../ui.js';
import { localDateParts } from '../ledger.js';

export const APP_VERSION = '1.1.0';
let persisted = null;

export function renderSettings() {
  const s = state.settings;
  const last = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString() : 'never';
  navigator.storage?.persisted?.().then((p) => {
    if (p !== persisted) { persisted = p; const el = document.querySelector('[data-persist]'); if (el) el.textContent = p ? 'Protected from automatic clean-up' : 'Standard (install to Home Screen for best protection)'; }
  });

  return `
    <header class="topbar">
      <a class="glass-btn" href="#/" aria-label="Back">${icon('chev-left')}</a>
      <span class="title-plain">Settings</span>
      <span class="topbar-spacer"></span>
    </header>
    <main class="content">
      <p class="section-label"><span>Accounts</span></p>
      <ul class="list card flush">${s.accounts.map((a) => `
        <li class="row tappable ${a.archived ? 'faded' : ''}" data-act="acc-open" data-id="${esc(a.id)}">
          <div class="row-main"><span class="row-title">${esc(a.name)}</span><span class="row-sub">${ACCOUNT_KINDS[a.kind] || 'Account'} · ${a.currency}${a.archived ? ' · hidden' : ''}</span></div>
          <span class="row-end">${icon('chev-right')}</span>
        </li>`).join('')}
        <li class="row tappable" data-act="acc-add"><span class="accent">${icon('plus', 'ic-xs')} Add account</span></li>
      </ul>

      <p class="section-label"><span>Exchange rate</span></p>
      <ul class="list card flush">
        <li class="row tappable" data-act="defrate-edit">
          <div class="row-main"><span class="row-title">1 EUR = ${formatRate(s.defaultRate)} ALL</span><span class="row-sub">Used for “≈ ALL” figures in Summary</span></div>
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

const isUsed = (accId) =>
  state.transactions.some((t) => t.accountId === accId || t.toAccountId === accId) ||
  Object.values(state.months).some((m) => m.openingBalances?.[accId] || m.closing?.balances?.[accId]);

function accountForm(a) {
  const used = a && isUsed(a.id);
  return `
    <label class="field"><span class="label">Name</span><input class="input" name="accName" maxlength="40" value="${esc(a?.name ?? '')}" placeholder="e.g. Revolut" ${a ? '' : 'autofocus'}></label>
    <div class="field"><span class="label">Type</span>${segmented('kind', Object.entries(ACCOUNT_KINDS), a?.kind ?? 'bank')}</div>
    <div class="field"><span class="label">Currency</span>
      ${used ? `<p class="small"><b>${a.currency}</b> <span class="hint">— can’t change once the account has money recorded</span></p>` : currencySeg(a?.currency ?? 'ALL')}</div>
    ${a ? `<label class="check-line"><input type="checkbox" name="archived" ${a.archived ? 'checked' : ''}> Hide from forms (keeps its history)</label>` : ''}
    ${a && !used ? `<button type="button" class="btn btn-danger-ghost btn-block" data-act="acc-delete">Delete account</button>` : ''}`;
}

registerActions({
  'acc-add': () => openSheet({
    title: 'New account',
    body: accountForm(null),
    submitLabel: 'Add account',
    onSubmit: async (form) => {
      const name = form.accName.value.trim();
      if (!name) return fieldError(form, 'accName', 'Name the account');
      await saveSettings({ accounts: [...state.settings.accounts, { id: uid(), name, kind: form.kind.value, currency: form.currency.value }] });
      toast('Account added');
    },
  }),
  'acc-open': (el) => {
    const a = state.settings.accounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    openSheet({
      title: 'Account',
      body: accountForm(a),
      actions: {
        'acc-delete': async () => {
          const ok = await confirmDialog({ title: `Delete ${esc(a.name)}?`, message: 'It has no recorded money, so nothing else changes.', confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          await saveSettings({ accounts: state.settings.accounts.filter((x) => x.id !== a.id) });
          toast('Account deleted');
        },
      },
      onSubmit: async (form) => {
        const name = form.accName.value.trim();
        if (!name) return fieldError(form, 'accName', 'Name the account');
        const currency = form.currency?.value ?? a.currency;
        await saveSettings({
          accounts: state.settings.accounts.map((x) => (x.id === a.id ? { ...x, name, kind: form.kind.value, currency, archived: form.archived.checked } : x)),
        });
        toast('Saved');
      },
    });
  },
  'defrate-edit': () => openSheet({
    title: 'Exchange rate',
    body: `<label class="field"><span class="label">1 EUR = ? ALL</span><input class="input input-amount" name="rate" inputmode="decimal" value="${formatRate(state.settings.defaultRate)}" autofocus></label>
      <p class="hint">Applies to open months and new months. Closed months keep the rate saved when they were closed. Your ALL and EUR amounts are never changed.</p>`,
    onSubmit: async (form) => {
      const r = parseRate(form.rate.value);
      if (!r.ok) return fieldError(form, 'rate', r.error);
      await setRate(r.rate);
      toast(`1 EUR = ${formatRate(r.rate)} ALL`);
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

