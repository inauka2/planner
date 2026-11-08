// Import sheet: choose a bank file (CSV, OFX, QFX, QIF) and the account it belongs to.
import { state, saveTxBatch, ensureMonth, uid } from '../store.js';
import { accountById } from '../ledger.js';
import { formatMoney } from '../money.js';
import { parseStatement, dedupe } from '../importer.js';
import { esc, openSheet, toast, segmented } from '../ui.js';

export function openImportSheet(accountId = null) {
  const accs = state.settings.accounts.filter((a) => !a.archived);
  if (!accs.length) return toast('Add an account first');
  let parsed = null;
  openSheet({
    title: 'Import transactions',
    body: `<p class="hint">Export a statement from your bank’s website or app as <b>CSV</b>, <b>OFX</b>, <b>QFX</b> or <b>QIF</b>, then choose it here. Nothing leaves this device.</p>
      <label class="field"><span class="label">Into account</span>
        <select class="select" name="acc">${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)} · ${a.currency}</option>`).join('')}</select></label>
      <div class="field"><span class="label">Dates like 03/04/2026 mean</span>${segmented('order', [['dmy', '3 April'], ['mdy', 'March 4']], 'dmy', { small: true })}</div>
      <label class="btn btn-ghost btn-block file-btn">Choose file…<input type="file" name="file" accept=".csv,.ofx,.qfx,.qif,.txt,text/csv" hidden></label>
      <div data-preview></div>`,
    submitLabel: 'Import',
    onOpen: (form) => {
      const read = async () => {
        const file = form.file.files?.[0];
        const box = form.querySelector('[data-preview]');
        parsed = null;
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { box.innerHTML = '<p class="field-error">That file is too large.</p>'; return; }
        try {
          const rows = parseStatement(file.name, await file.text(), { order: form.order.value });
          const acc = accountById(state, form.acc.value);
          const existing = state.transactions.filter((t) => t.accountId === acc.id).map((t) => ({ ...t, amount: t.type === 'expense' ? -t.amount : t.amount }));
          const fresh = dedupe(rows, existing);
          parsed = { rows: fresh, skipped: rows.length - fresh.length };
          const out = fresh.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
          const inn = fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
          box.innerHTML = `<div class="import-preview">
            <p><b>${fresh.length}</b> new transaction${fresh.length === 1 ? '' : 's'} in ${esc(file.name)}${parsed.skipped ? ` · ${parsed.skipped} already here, skipped` : ''}</p>
            <p class="hint">Out ${formatMoney(out, acc.currency)} · In ${formatMoney(inn, acc.currency)} · amounts are taken as ${acc.currency}</p>
            <ul class="mini-preview">${fresh.slice(0, 5).map((r) => `<li><span>${esc(r.date)} · ${esc(r.description)}</span><span class="${r.amount < 0 ? 'warn' : 'accent'}">${formatMoney(r.amount, acc.currency, { plus: true })}</span></li>`).join('')}</ul>
          </div>`;
        } catch (e) {
          box.innerHTML = `<p class="field-error">${esc(e.message)}</p>`;
        }
      };
      form.addEventListener('change', (e) => { if (['file', 'order', 'acc'].includes(e.target.name)) read(); });
    },
    onSubmit: async (form) => {
      if (!parsed?.rows.length) { toast(parsed ? 'Nothing new to import' : 'Choose a file first'); return false; }
      const acc = accountById(state, form.acc.value);
      const now = new Date().toISOString();
      for (const id of new Set(parsed.rows.map((r) => r.date.slice(0, 7)))) await ensureMonth(id);
      const records = parsed.rows.map((r) => ({
        id: uid(), monthId: r.date.slice(0, 7), type: r.amount < 0 ? 'expense' : 'income', amount: Math.abs(r.amount), currency: acc.currency,
        accountId: acc.id, description: r.description.slice(0, 120) || 'Imported', date: r.date, time: '12:00', categoryId: null,
        ...(r.notes ? { notes: r.notes.slice(0, 500) } : {}), imported: true, createdAt: now,
      }));
      const added = await saveTxBatch(records);
      const blocked = records.length - added;
      toast(`Imported ${added}${blocked ? ` · ${blocked} skipped (closed months)` : ''}`);
    },
  });
}
