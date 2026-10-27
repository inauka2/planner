// Tab 1 — Budget: my current finances only. Balances (Lek and Euro), money owed to me,
// expected income, and planned vs actual spending.
import { state, updateMonth, saveTx, saveReceivable, deleteReceivable, uid } from '../store.js';
import { monthSummary, planTotals, canEdit, sourceMonthId, monthLabel, monthTxs, txEffects } from '../ledger.js';
import { parseAmount, formatMoney, centsToInput } from '../money.js';
import { icon } from '../icons.js';
import {
  esc, registerActions, openSheet, fieldError, toast, checkbox, currencySeg, confirmDialog, segmented,
} from '../ui.js';
import { openTxSheet, defaultAccount, defaultDateTime } from './txsheet.js';
import { doneWord } from './plan.js';

/** "158,650" + unit, for the big totals. */
function bigAmount(cents, cur) {
  const s = formatMoney(cents, cur);
  return cur === 'EUR' ? s : `${s.replace(' ALL', '')}<span class="unit">ALL</span>`;
}

export function renderBudget(id) {
  const m = state.months[id];
  const sum = monthSummary(state, id);
  const closed = !!m.closing;
  return `
    ${balancesCard(id, sum, closed)}
    <div class="split">
      ${owedCard(id)}
      ${incomeCard(id, m, closed)}
    </div>
    ${plannedVsActual(id, m, sum)}
  `;
}

// ---------- balances ----------
function balancesCard(id, sum, closed) {
  const accs = state.settings.accounts.filter((a) => !a.archived || sum.closingBalances[a.id]);
  return `<section class="card hero">
    <div class="card-head">
      <h2>Balances</h2>
      ${closed ? `<span class="tag">${icon('lock', 'ic-xs')} Closed</span>`
        : `<button class="glass-btn sm" data-act="balances-edit" data-month="${id}" aria-label="Edit balances">${icon('edit')}</button>`}
    </div>
    <div class="totals-2">
      <div><p class="eyebrow">Lek</p><p class="big ${sum.closing.ALL < 0 ? 'neg' : ''}">${bigAmount(sum.closing.ALL, 'ALL')}</p></div>
      <div><p class="eyebrow">Euro</p><p class="big ${sum.closing.EUR < 0 ? 'neg' : ''}">${bigAmount(sum.closing.EUR, 'EUR')}</p></div>
    </div>
    <div class="divider"></div>
    <ul class="list">
      ${accs.map((a) => `<li class="row">
        <div class="row-main"><span class="row-title">${esc(a.name)}</span></div>
        <span class="amount ${sum.closingBalances[a.id] < 0 ? 'neg' : ''}">${formatMoney(sum.closingBalances[a.id] || 0, a.currency)}</span>
      </li>`).join('')}
    </ul>
  </section>`;
}

/** Make each account show `target`: edit the opening if nothing else moved it, otherwise record a correction. */
async function applyBalances(id, targets) {
  const m = state.months[id];
  const sum = monthSummary(state, id);
  const touched = new Set();
  for (const t of monthTxs(state, id)) for (const [acc] of txEffects(t)) touched.add(acc);
  const opening = { ...(m.openingBalances || {}) };
  let openingChanged = false;
  const corrections = [];
  for (const [accId, target] of Object.entries(targets)) {
    const diff = target - (sum.closingBalances[accId] || 0);
    if (!diff) continue;
    const acc = state.settings.accounts.find((a) => a.id === accId);
    if (m.openingMode === 'manual' && !touched.has(accId)) {
      opening[accId] = target;
      openingChanged = true;
    } else {
      const dt = defaultDateTime(id);
      corrections.push({
        id: uid(), monthId: id, type: 'adjust', amount: diff, currency: acc.currency, accountId: accId,
        description: 'Balance update', date: dt.date, time: dt.time, createdAt: new Date().toISOString(),
      });
    }
  }
  if (openingChanged) await updateMonth(id, (mm) => { mm.openingBalances = opening; }, { financial: true });
  for (const c of corrections) await saveTx(c);
  return openingChanged || corrections.length > 0;
}

registerActions({
  'balances-edit': (el) => {
    const id = el.dataset.month;
    const c = canEdit(state, id);
    if (!c.ok) return toast(c.reason);
    const sum = monthSummary(state, id);
    const accs = state.settings.accounts.filter((a) => !a.archived);
    openSheet({
      title: 'Edit balances',
      body: `<p class="hint">Type what each account holds right now.</p>
        ${accs.map((a) => `<label class="field field-inline"><span class="label">${esc(a.name)} <span class="cur-tag">${a.currency}</span></span>
          <input class="input input-right" name="b_${esc(a.id)}" inputmode="decimal" placeholder="0" value="${sum.closingBalances[a.id] ? centsToInput(sum.closingBalances[a.id]) : ''}"></label>`).join('')}
        <button type="button" class="link-btn" data-act="opening-edit" data-month="${id}">Starting balances for ${monthLabel(id)}…</button>`,
      onSubmit: async (form) => {
        const targets = {};
        for (const a of accs) {
          const p = parseAmount(form[`b_${a.id}`].value || '0', { allowNegative: true, allowZero: true });
          if (!p.ok) return fieldError(form, `b_${a.id}`, p.error);
          targets[a.id] = p.cents;
        }
        const changed = await applyBalances(id, targets);
        toast(changed ? 'Balances updated' : 'No changes');
      },
    });
  },

  'opening-edit': (el) => {
    const id = el.dataset.month;
    const m = state.months[id];
    const src = sourceMonthId(state, id);
    const sum = monthSummary(state, id);
    const accs = state.settings.accounts.filter((a) => !a.archived);
    const vals = m.openingMode === 'manual' ? m.openingBalances : sum.openingBalances;
    openSheet({
      title: 'Starting balances',
      body: `
        ${src ? `<div class="field">${segmented('mode', [['carried', `From ${monthLabel(src).split(' ')[0]}`], ['manual', 'Enter manually']], m.openingMode === 'carried' ? 'carried' : 'manual')}</div>
          <p class="hint" data-carried ${m.openingMode === 'carried' ? '' : 'hidden'}>Uses the closing balances of ${monthLabel(src)}${state.months[src].closing ? '' : ' and updates automatically while it is open'}.</p>`
        : '<p class="hint">What each account held on the 1st. Later months carry these forward automatically.</p>'}
        <div class="stack" data-manual ${m.openingMode === 'carried' && src ? 'hidden' : ''}>
          ${accs.map((a) => `<label class="field field-inline"><span class="label">${esc(a.name)} <span class="cur-tag">${a.currency}</span></span>
            <input class="input input-right" name="ob_${esc(a.id)}" inputmode="decimal" placeholder="0" value="${vals[a.id] ? centsToInput(vals[a.id]) : ''}"></label>`).join('')}
        </div>`,
      onOpen: (form) => form.addEventListener('change', (e) => {
        if (e.target.name !== 'mode') return;
        const carried = e.target.value === 'carried';
        form.querySelector('[data-manual]').hidden = carried;
        form.querySelector('[data-carried]').hidden = !carried;
      }),
      onSubmit: async (form) => {
        const mode = src ? form.mode.value : 'manual';
        const balances = {};
        if (mode === 'manual') {
          for (const a of accs) {
            const v = form[`ob_${a.id}`].value.trim();
            if (!v) continue;
            const p = parseAmount(v, { allowNegative: true, allowZero: true });
            if (!p.ok) return fieldError(form, `ob_${a.id}`, p.error);
            if (p.cents) balances[a.id] = p.cents;
          }
        }
        await updateMonth(id, (mm) => { mm.openingMode = mode; mm.openingBalances = mode === 'manual' ? balances : {}; }, { financial: true });
        toast('Starting balances saved');
      },
    });
  },
});

// ---------- two columns: owed to me · expected income ----------
function miniTotal(pair) {
  if (!pair.ALL && !pair.EUR) return '';
  const all = pair.ALL ? formatMoney(pair.ALL, 'ALL') : '';
  const eur = pair.EUR ? formatMoney(pair.EUR, 'EUR') : '';
  return `<p class="mini-total">${all || eur}${all && eur ? `<span class="eur">${eur}</span>` : ''}</p>`;
}

function owedCard(id) {
  const open = state.receivables.filter((r) => !r.received);
  const total = { ALL: 0, EUR: 0 };
  open.forEach((r) => { total[r.currency] += r.amount; });
  return `<section class="card">
    <div class="mini-head"><h3>Owed to me</h3></div>
    ${miniTotal(total)}
    ${open.length ? `<ul class="mini-list">${open.map((r) => `
      <li class="mini-item tappable" data-act="owed-open" data-id="${esc(r.id)}" data-month="${id}">
        <div class="mi-text"><span class="mi-name">${esc(r.description)}</span><span class="mi-amt">${formatMoney(r.amount, r.currency)}</span></div>
      </li>`).join('')}</ul>
      `
      : '<p class="mini-empty">Nobody owes you money</p>'}
    <button class="mini-add" data-act="owed-add">${icon('plus')} Add</button>
  </section>`;
}

function incomeCard(id, m, closed) {
  const items = m.plan.filter((p) => p.kind === 'income');
  const total = { ALL: 0, EUR: 0 };
  items.forEach((p) => { total[p.currency] += p.amount || 0; });
  return `<section class="card">
    <div class="mini-head"><h3>Expected income</h3></div>
    ${miniTotal(total)}
    ${items.length ? `<ul class="mini-list">${items.map((p) => `
      <li class="mini-item ${p.paid ? 'done' : ''}">
        ${checkbox(p.paid, 'plan-tick', `data-month="${id}" data-id="${esc(p.id)}" ${closed ? 'disabled' : ''}`, 'Received', { sm: true, id: p.id })}
        <div class="mi-text tappable" data-act="plan-open" data-month="${id}" data-id="${esc(p.id)}">
          <span class="mi-name">${esc(p.description)}</span><span class="mi-amt">${p.paid ? doneWord(p) : formatMoney(p.amount, p.currency)}</span></div>
      </li>`).join('')}</ul>`
      : '<p class="mini-empty">Salary and other income you expect</p>'}
    ${closed ? '' : `<button class="mini-add" data-act="plan-add" data-kind="income" data-month="${id}">${icon('plus')} Add</button>`}
  </section>`;
}

// ---------- planned vs actual ----------
function plannedVsActual(id, m, sum) {
  const plan = planTotals(m);
  const rows = ['ALL', 'EUR'].filter((c) => plan.expense[c] || sum.spending[c] || c === 'ALL');
  return `<section class="card">
    <div class="card-head"><h2>Planned vs actual</h2><a class="link-btn" href="#/m/${id}/buy">See plan</a></div>
    <table class="table">
      <thead><tr><th></th><th>Planned</th><th>Spent</th></tr></thead>
      <tbody>${rows.map((c) => `<tr>
        <th scope="row">${c === 'ALL' ? 'Lek' : 'Euro'}</th>
        <td class="muted">${formatMoney(plan.expense[c], c)}</td>
        <td class="${plan.expense[c] && sum.spending[c] > plan.expense[c] ? 'warn' : ''}">${formatMoney(sum.spending[c], c)}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="hint">Still to pay ${['ALL', 'EUR'].filter((c) => plan.unpaid[c] || c === 'ALL').map((c) => formatMoney(plan.unpaid[c], c)).join(' · ')}. Only recorded expenses count as spent.</p>
  </section>`;
}

// ---------- money owed to me: sheets ----------
function owedForm(r = null) {
  return `<label class="field"><span class="label">Who owes you / what for</span>
      <input class="input" name="description" maxlength="80" value="${esc(r?.description ?? '')}" placeholder="e.g. Ana — concert tickets" ${r ? '' : 'autofocus'}></label>
    <div class="amount-row">
      <label class="field grow"><span class="label">Amount</span><input class="input input-amount" name="amount" inputmode="decimal" value="${r ? centsToInput(r.amount) : ''}" placeholder="0"></label>
      <div class="field">${currencySeg(r?.currency ?? 'ALL')}</div>
    </div>`;
}

function readOwed(form) {
  const description = form.description.value.trim();
  if (!description) return fieldError(form, 'description', 'Add a name or note');
  const p = parseAmount(form.amount.value);
  if (!p.ok) return fieldError(form, 'amount', p.error);
  return { description, amount: p.cents, currency: form.currency.value };
}

registerActions({
  'owed-add': () => openSheet({
    title: 'Owed to me',
    body: owedForm() + '<p class="hint">Kept separate from your balances until you mark it received.</p>',
    submitLabel: 'Add',
    onSubmit: async (form) => {
      const v = readOwed(form);
      if (!v) return false;
      await saveReceivable({ id: uid(), ...v, received: false, createdAt: new Date().toISOString() });
      toast('Added');
    },
  }),
  'owed-open': (el) => {
    const r = state.receivables.find((x) => x.id === el.dataset.id);
    const monthId = el.dataset.month;
    if (!r) return;
    openSheet({
      title: 'Owed to me',
      body: owedForm(r) + '<button type="button" class="btn btn-danger-ghost btn-block" data-act="owed-delete">Delete</button>',
      footer: `<button type="button" class="btn btn-tinted btn-block" data-act="owed-receive">Mark as received…</button>`,
      actions: {
        'owed-receive': () => openTxSheet({
          monthId, type: 'income',
          prefill: { amount: r.amount, currency: r.currency, description: `Repaid: ${r.description}`, accountId: defaultAccount('income', r.currency) },
          link: { kind: 'receivable', id: r.id },
        }),
        'owed-delete': async () => {
          const ok = await confirmDialog({ title: 'Delete this entry?', message: 'It is removed from “Owed to me”.', confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          await deleteReceivable(r.id);
          toast('Deleted', { actionLabel: 'Undo', onAction: () => saveReceivable(r) });
        },
      },
      onSubmit: async (form) => {
        const v = readOwed(form);
        if (!v) return false;
        await saveReceivable({ ...r, ...v });
        toast('Saved');
      },
    });
  },
});
