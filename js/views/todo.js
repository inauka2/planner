// Tab 4 — To Do: checklists (Projects, Activities & Fun, German Learning, …) with optional deadlines.
import { state, updateMonth, uid, saveSettings } from '../store.js';
import { sourceMonthId, monthLabel, localDateParts } from '../ledger.js';
import { icon } from '../icons.js';
import { ACTIVITIES_LIST_ID } from '../defaults.js';
import { esc, registerActions, openSheet, fieldError, toast, checkbox, confirmDialog, chooseDialog, shortDate } from '../ui.js';

const findList = (m, listId) => m.todoLists.find((l) => l.id === listId);
const unfinished = (m) => m.todoLists.reduce((n, l) => n + l.items.filter((it) => !it.done).length, 0);

export function renderTodo(id) {
  const m = state.months[id];
  const today = localDateParts().date;
  const open = unfinished(m);
  const total = m.todoLists.reduce((n, l) => n + l.items.length, 0);
  const overdue = m.todoLists.reduce((n, l) => n + l.items.filter((it) => !it.done && it.deadline && it.deadline < today).length, 0);
  const src = sourceMonthId(state, id);
  const carry = src ? unfinished(state.months[src]) : 0;

  return `
    <h1 class="large-title">To Do</h1>
    <section class="card hero">
      <div class="totals-2">
        <div><p class="eyebrow">Open</p><p class="big sm">${open}</p></div>
        <div><p class="eyebrow">Done</p><p class="big sm">${total - open}</p></div>
      </div>
      ${overdue ? `<p class="hint warn">${overdue} past the deadline</p>` : ''}
    </section>
    ${carry && total === 0 ? `<button class="btn btn-tinted btn-block" data-act="todo-carry" data-month="${id}">${icon('repeat')} Bring ${carry} unfinished from ${monthLabel(src).split(' ')[0]}</button>` : ''}
    ${m.todoLists.map((l) => listCard(id, l, today)).join('')}
    <div class="title-row">
      <button class="text-btn" data-act="todo-list-add" data-month="${id}">${icon('plus')} New list</button>
      ${carry && total > 0 ? `<button class="text-btn" data-act="todo-carry" data-month="${id}">${icon('repeat')} Bring unfinished</button>` : ''}
    </div>`;
}

function listCard(id, l, today) {
  const done = l.items.filter((it) => it.done).length;
  const sorted = [...l.items].sort((a, b) => Number(a.done) - Number(b.done));
  return `<section class="card">
    <div class="card-head">
      <button class="title-row" style="background:none;border:0;padding:0;gap:8px" data-act="todo-list-menu" data-month="${id}" data-list="${esc(l.id)}">
        <h3>${esc(l.name)}</h3>${l.items.length ? `<span class="muted small">${done}/${l.items.length}</span>` : ''}
      </button>
      <button class="plain-btn accent" data-act="todo-add" data-month="${id}" data-list="${esc(l.id)}" aria-label="Add to ${esc(l.name)}">${icon('plus')}</button>
    </div>
    ${l.id === ACTIVITIES_LIST_ID ? ideasRow(id) : ''}
    ${l.items.length ? `<ul class="list">${sorted.map((it) => {
      const late = !it.done && it.deadline && it.deadline < today;
      return `<li class="row has-check">
        ${checkbox(!!it.done, 'todo-tick', `data-month="${id}" data-list="${esc(l.id)}" data-id="${esc(it.id)}"`, 'Done', { id: it.id })}
        <div class="row-main tappable" data-act="todo-open" data-month="${id}" data-list="${esc(l.id)}" data-id="${esc(it.id)}">
          <span class="row-title ${it.done ? 'done' : ''}">${esc(it.text)}</span>
          ${it.deadline ? `<span class="row-sub ${late ? 'warn' : ''}">${icon('calendar', 'ic-xs')} ${late ? 'was due' : 'by'} ${shortDate(it.deadline)}</span>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>` : ''}
  </section>`;
}

function ideasRow(id) {
  return `<div class="ideas"><div class="chips">
    ${state.settings.activityIdeas.map((idea, i) => `<button class="chip" data-act="idea-open" data-month="${id}" data-i="${i}">${esc(idea)}</button>`).join('')}
    <button class="chip chip-add" data-act="idea-add">${icon('plus')} Idea</button>
  </div></div>`;
}

function taskForm(it) {
  return `<label class="field"><span class="label">Task</span>
      <input class="input" name="text" maxlength="120" value="${esc(it?.text ?? '')}" placeholder="What do you want to do?" ${it ? '' : 'autofocus'}></label>
    <label class="field"><span class="label">Deadline <span class="optional">optional</span></span>
      <input class="input" type="date" name="deadline" value="${esc(it?.deadline ?? '')}"></label>`;
}

function readTask(form) {
  const text = form.text.value.trim();
  if (!text) return fieldError(form, 'text', 'Describe the task');
  return { text, deadline: form.deadline.value || null };
}

/** Add-task sheet. Without a listId (from the + button) the user picks the list. */
export function addTaskSheet(id, listId = null) {
  const lists = state.months[id].todoLists;
  if (!lists.length) return toast('Create a list first');
  const l = listId && findList(state.months[id], listId);
  openSheet({
    title: l ? `Add to ${l.name}` : 'New task',
    body: (l ? '' : `<label class="field"><span class="label">List</span><select class="select" name="list">
        ${lists.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>`) + taskForm(null),
    submitLabel: 'Add',
    onSubmit: async (form) => {
      const v = readTask(form);
      if (!v) return false;
      const target = l ? l.id : form.list.value;
      await updateMonth(id, (mm) => { findList(mm, target).items.push({ id: uid(), ...v, done: false }); });
      toast('Added');
    },
  });
}

function nameSheet(title, value, onSave, extra = {}) {
  openSheet({
    title,
    body: `<label class="field"><span class="label">List name</span><input class="input" name="label" maxlength="40" value="${esc(value)}" autofocus></label>${extra.body || ''}`,
    actions: extra.actions || {},
    onSubmit: async (form) => {
      const name = form.label.value.trim();
      if (!name) return fieldError(form, 'label', 'Give the list a name');
      await onSave(name);
    },
  });
}

registerActions({
  'todo-add': (el) => addTaskSheet(el.dataset.month, el.dataset.list),
  'todo-tick': (el) => {
    const { month: id, list } = el.dataset;
    return updateMonth(id, (mm) => { const x = findList(mm, list).items.find((q) => q.id === el.dataset.id); if (x) x.done = !x.done; });
  },
  'todo-open': (el) => {
    const { month: id, list } = el.dataset;
    const it = findList(state.months[id], list)?.items.find((x) => x.id === el.dataset.id);
    if (!it) return;
    openSheet({
      title: 'Task',
      body: taskForm(it) + '<button type="button" class="btn btn-danger-ghost" data-act="todo-delete">Delete task</button>',
      actions: {
        'todo-delete': async () => {
          await updateMonth(id, (mm) => { const l = findList(mm, list); l.items = l.items.filter((x) => x.id !== it.id); });
          toast('Deleted', { actionLabel: 'Undo', onAction: () => updateMonth(id, (mm) => { findList(mm, list).items.push(it); }) });
        },
      },
      onSubmit: async (form) => {
        const v = readTask(form);
        if (!v) return false;
        await updateMonth(id, (mm) => { Object.assign(findList(mm, list).items.find((x) => x.id === it.id), v); });
      },
    });
  },
  'todo-list-add': (el) => {
    const id = el.dataset.month;
    nameSheet('New list', '', (name) => updateMonth(id, (mm) => { mm.todoLists.push({ id: uid(), name, items: [] }); }));
  },
  'todo-list-menu': (el) => {
    const { month: id, list } = el.dataset;
    const l = findList(state.months[id], list);
    nameSheet('List', l.name, (name) => updateMonth(id, (mm) => { findList(mm, list).name = name; }), {
      body: `<button type="button" class="btn btn-danger-ghost" data-act="todo-list-delete">Delete list</button>`,
      actions: {
        'todo-list-delete': async () => {
          if (l.items.length) {
            const ok = await confirmDialog({ title: `Delete “${esc(l.name)}”?`, message: `Its ${l.items.length} task(s) in ${monthLabel(id)} will be deleted.`, confirmLabel: 'Delete', danger: true });
            if (!ok) return;
          }
          const idx = state.months[id].todoLists.findIndex((x) => x.id === l.id);
          await updateMonth(id, (mm) => { mm.todoLists = mm.todoLists.filter((x) => x.id !== l.id); });
          toast('List deleted', { actionLabel: 'Undo', onAction: () => updateMonth(id, (mm) => { mm.todoLists.splice(idx, 0, l); }) });
        },
      },
    });
  },
  'todo-carry': async (el) => {
    const id = el.dataset.month;
    const src = state.months[sourceMonthId(state, id)];
    let n = 0;
    await updateMonth(id, (mm) => {
      for (const sl of src.todoLists) {
        const open = sl.items.filter((it) => !it.done);
        if (!open.length) continue;
        let target = mm.todoLists.find((l) => l.id === sl.id || l.name === sl.name);
        if (!target) { target = { id: sl.id, name: sl.name, items: [] }; mm.todoLists.push(target); }
        const have = new Set(target.items.map((x) => x.text.toLowerCase()));
        for (const it of open) {
          if (have.has(it.text.toLowerCase())) continue;
          target.items.push({ ...it, id: uid() });
          n++;
        }
      }
    });
    toast(n ? `Brought ${n} over` : 'Nothing new to bring over');
  },
  'idea-add': () => openSheet({
    title: 'Activity idea',
    body: `<label class="field"><span class="label">Idea</span><input class="input" name="idea" maxlength="60" placeholder="e.g. Picnic at the lake" autofocus></label>
      <p class="hint">Saved for every month. Tap an idea later to add it to your list.</p>`,
    submitLabel: 'Save idea',
    onSubmit: async (form) => {
      const idea = form.idea.value.trim();
      if (!idea) return fieldError(form, 'idea', 'Type an idea');
      await saveSettings({ activityIdeas: [...state.settings.activityIdeas, idea] });
    },
  }),
  'idea-open': async (el) => {
    const id = el.dataset.month;
    const i = Number(el.dataset.i);
    const idea = state.settings.activityIdeas[i];
    const choice = await chooseDialog({
      title: idea,
      options: [{ key: 'add', label: 'Add to Activities & Fun', primary: true }, { key: 'remove', label: 'Remove this idea' }],
    });
    if (choice === 'add') {
      await updateMonth(id, (mm) => { findList(mm, ACTIVITIES_LIST_ID)?.items.push({ id: uid(), text: idea, deadline: null, done: false }); });
      toast('Added to Activities & Fun');
    } else if (choice === 'remove') {
      await saveSettings({ activityIdeas: state.settings.activityIdeas.filter((_, j) => j !== i) });
    }
  },
});
