// Tab 4 — To Do, like iOS Reminders: a grid of list tiles; tapping one opens the list,
// where tasks are typed one after another in the "New task" line.
import { state, updateMonth, uid, saveSettings } from '../store.js';
import { sourceMonthId, monthLabel, localDateParts } from '../ledger.js';
import { icon } from '../icons.js';
import { ACTIVITIES_LIST_ID, listStyle } from '../defaults.js';
import { esc, registerActions, openSheet, fieldError, toast, checkbox, confirmDialog, chooseDialog, shortDate } from '../ui.js';

const findList = (m, listId) => m.todoLists.find((l) => l.id === listId);
const openCount = (l) => l.items.filter((it) => !it.done).length;
const unfinished = (m) => m.todoLists.reduce((n, l) => n + openCount(l), 0);

export function renderTodo(id, path = []) {
  const m = state.months[id];
  const l = path[0] && findList(m, path[0]);
  return l ? renderList(id, m, l) : renderGrid(id, m);
}

// ---------- grid of lists ----------
function renderGrid(id, m) {
  const open = unfinished(m);
  const total = m.todoLists.reduce((n, l) => n + l.items.length, 0);
  const src = sourceMonthId(state, id);
  const carry = src ? unfinished(state.months[src]) : 0;
  const today = localDateParts().date;
  const overdue = m.todoLists.reduce((n, l) => n + l.items.filter((it) => !it.done && it.deadline && it.deadline < today).length, 0);

  return `
    <div>
      <h1 class="large-title">To Do</h1>
      <p class="title-sub">${open} open${total - open ? ` · ${total - open} done` : ''}${overdue ? ` · <span class="warn">${overdue} overdue</span>` : ''}</p>
    </div>
    ${carry && total === 0 ? `<button class="btn btn-tinted btn-block" data-act="todo-carry" data-month="${id}">${icon('repeat')} Bring ${carry} unfinished from ${monthLabel(src).split(' ')[0]}</button>` : ''}
    <div class="tile-grid">
      ${m.todoLists.map((l, i) => {
        const { color, icon: ic } = listStyle(l, i);
        return `<a class="tile" href="#/m/${id}/todo/${esc(l.id)}" style="--c:${color}">
          <span class="tile-top"><span class="tile-icon">${icon(ic)}</span><span class="tile-count">${openCount(l)}</span></span>
          <span class="tile-name">${esc(l.name)}</span>
        </a>`;
      }).join('')}
    </div>
    <div class="title-row">
      <button class="text-btn" data-act="todo-list-add" data-month="${id}">${icon('plus')} New list</button>
      ${carry && total > 0 ? `<button class="text-btn" data-act="todo-carry" data-month="${id}">${icon('repeat')} Bring unfinished</button>` : ''}
    </div>`;
}

// ---------- one list ----------
export function taskRow(id, l, it, today = localDateParts().date) {
  const late = !it.done && it.deadline && it.deadline < today;
  return `<li class="swipe" data-swipe>
    <div class="row has-check swipe-content">
      ${checkbox(!!it.done, 'todo-tick', `data-month="${id}" data-list="${esc(l.id)}" data-id="${esc(it.id)}"`, 'Done', { id: it.id })}
      <div class="row-main tappable" data-act="todo-open" data-month="${id}" data-list="${esc(l.id)}" data-id="${esc(it.id)}">
        <span class="row-title ${it.done ? 'done' : ''}">${esc(it.text)}</span>
        ${it.deadline ? `<span class="row-sub ${late ? 'warn' : ''}">${icon('calendar', 'ic-xs')} ${late ? 'Was due' : 'By'} ${shortDate(it.deadline)}</span>` : ''}
      </div>
    </div>
    <button class="swipe-del" data-act="todo-delete" data-month="${id}" data-list="${esc(l.id)}" data-id="${esc(it.id)}">Delete</button>
  </li>`;
}

function renderList(id, m, l) {
  const i = m.todoLists.indexOf(l);
  const { color } = listStyle(l, i);
  const open = l.items.filter((it) => !it.done);
  const done = l.items.filter((it) => it.done);
  const today = localDateParts().date;
  return `
    <a class="back-link" href="#/m/${id}/todo">${icon('chev-left')} To Do</a>
    <div class="title-row">
      <h1 class="large-title" style="color:${color}">${esc(l.name)}</h1>
      <button class="glass-btn sm" data-act="todo-list-menu" data-month="${id}" data-list="${esc(l.id)}" aria-label="Rename or delete list">${icon('edit')}</button>
    </div>
    ${l.id === ACTIVITIES_LIST_ID ? ideasRow(id) : ''}
    <ul class="list card flush" data-task-list="${esc(l.id)}" style="--c:${color}">
      ${open.map((it) => taskRow(id, l, it, today)).join('')}
      <li class="row has-check add-task">
        <span class="check ghost" aria-hidden="true"></span>
        <input class="inline-input" data-new-task data-month="${id}" data-list="${esc(l.id)}" placeholder="New task" enterkeyhint="next" autocomplete="off" maxlength="120">
      </li>
    </ul>
    ${done.length ? `<p class="section-label"><span>Completed</span><span>${done.length}</span></p>
      <ul class="list card flush">${done.map((it) => taskRow(id, l, it, today)).join('')}</ul>` : ''}
    <p class="hint center">Type a task and press return to add the next one. Swipe left to delete.</p>`;
}

function ideasRow(id) {
  return `<div class="chips">
    ${state.settings.activityIdeas.map((idea, i) => `<button class="chip" data-act="idea-open" data-month="${id}" data-i="${i}">${esc(idea)}</button>`).join('')}
    <button class="chip chip-add" data-act="idea-add">${icon('plus')} Idea</button>
  </div>`;
}

// ---------- quick add (no page redraw, so the keyboard stays up) ----------
async function addInline(input) {
  const text = input.value.trim();
  if (!text) return;
  const { month: id, list } = input.dataset;
  const it = { id: uid(), text, deadline: null, done: false };
  input.value = '';
  await updateMonth(id, (mm) => { findList(mm, list).items.push(it); }, { silent: true });
  const l = findList(state.months[id], list);
  input.closest('li').insertAdjacentHTML('beforebegin', taskRow(id, l, it));
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('[data-new-task]')) return;
  e.preventDefault();
  addInline(e.target).catch((err) => toast(err.message));
});
document.addEventListener('focusout', (e) => {
  if (e.target.matches?.('[data-new-task]') && e.target.value.trim()) addInline(e.target).catch((err) => toast(err.message));
});

/** + button: on a list page jump into the "New task" line; on the grid ask which list. */
export function addTaskSheet(id, listId = null) {
  const inline = document.querySelector('[data-new-task]');
  if (inline) {
    inline.focus();
    inline.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
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

function nameSheet(title, value, onSave, extra = {}) {
  openSheet({
    title,
    body: `<label class="field"><span class="label">List name</span><input class="input" name="label" maxlength="40" value="${esc(value)}" ${value ? '' : 'autofocus'}></label>${extra.body || ''}`,
    actions: extra.actions || {},
    onSubmit: async (form) => {
      const name = form.label.value.trim();
      if (!name) return fieldError(form, 'label', 'Give the list a name');
      await onSave(name);
    },
  });
}

async function deleteTask(id, list, taskId) {
  const l = findList(state.months[id], list);
  const idx = l.items.findIndex((x) => x.id === taskId);
  const it = l.items[idx];
  if (!it) return;
  await updateMonth(id, (mm) => { const ll = findList(mm, list); ll.items = ll.items.filter((x) => x.id !== taskId); });
  toast('Task deleted', { actionLabel: 'Undo', onAction: () => updateMonth(id, (mm) => { findList(mm, list).items.splice(idx, 0, it); }) });
}

registerActions({
  'todo-tick': (el) => {
    const { month: id, list } = el.dataset;
    return updateMonth(id, (mm) => { const x = findList(mm, list).items.find((q) => q.id === el.dataset.id); if (x) x.done = !x.done; });
  },
  'todo-delete': (el) => deleteTask(el.dataset.month, el.dataset.list, el.dataset.id),
  'todo-open': (el) => {
    const { month: id, list } = el.dataset;
    const it = findList(state.months[id], list)?.items.find((x) => x.id === el.dataset.id);
    if (!it) return;
    openSheet({
      title: 'Task',
      body: taskForm(it) + '<button type="button" class="btn btn-danger-ghost" data-act="todo-sheet-delete">Delete task</button>',
      actions: { 'todo-sheet-delete': () => deleteTask(id, list, it.id) },
      onSubmit: async (form) => {
        const v = readTask(form);
        if (!v) return false;
        await updateMonth(id, (mm) => { Object.assign(findList(mm, list).items.find((x) => x.id === it.id), v); });
      },
    });
  },
  'todo-list-add': (el) => {
    const id = el.dataset.month;
    nameSheet('New list', '', async (name) => {
      const listId = uid();
      await updateMonth(id, (mm) => { mm.todoLists.push({ id: listId, name, items: [] }); });
      location.hash = `#/m/${id}/todo/${listId}`;
    });
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
          location.hash = `#/m/${id}/todo`;
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
