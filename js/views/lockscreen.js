// Full-screen password gate shown before any data is rendered.
import { state, saveLock, eraseAll, setSignedIn } from '../store.js';
import { createLock, verifyLock, MIN_LENGTH } from '../lock.js';
import { openSheet, fieldError, toast } from '../ui.js';

const root = () => document.getElementById('lock-root');
let failures = 0;
let blockedUntil = 0;

function screen(inner) {
  root().innerHTML = `<div class="lock">
    <img class="lock-icon" src="icons/apple-touch-icon.png" alt="" width="72" height="72">
    ${inner}
  </div>`;
  root().hidden = false;
  document.body.classList.add('locked');
}

function hide() {
  root().hidden = true;
  root().innerHTML = '';
  document.body.classList.remove('locked');
}

/** Resolve once the user is allowed in. Creates a password first if none exists. */
export function lockGate() {
  if (state.lock && state.signedIn) return Promise.resolve();
  return new Promise((resolve) => (state.lock ? unlockScreen(resolve) : setupScreen(resolve)));
}

function setupScreen(done) {
  screen(`
    <h1>Create a password</h1>
    <p class="hint center">You’ll stay signed in on this device until you log out. The password is saved only here.</p>
    <form class="lock-form" novalidate>
      <input class="input" type="password" name="pw" placeholder="Password" autocomplete="new-password" autofocus>
      <input class="input" type="password" name="pw2" placeholder="Repeat password" autocomplete="new-password">
      <p class="field-error" data-err hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Continue</button>
    </form>
    <p class="hint center">If you forget it, the only way back in is to erase this device’s data and restore a backup.</p>`);
  const form = root().querySelector('form');
  form.pw.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('[data-err]');
    const pw = form.pw.value;
    if (pw.length < MIN_LENGTH) return showErr(err, `Use at least ${MIN_LENGTH} characters`);
    if (pw !== form.pw2.value) return showErr(err, 'The passwords don’t match');
    try {
      await saveLock(await createLock(pw));
      await setSignedIn(true);
    } catch (ex) {
      return showErr(err, `Couldn’t save the password: ${ex.message}`);
    }
    hide();
    done();
  });
}

function unlockScreen(done) {
  screen(`
    <h1>Planner</h1>
    <p class="hint center">Sign in with your password</p>
    <form class="lock-form" novalidate>
      <input class="input" type="password" name="pw" placeholder="Password" autocomplete="current-password" autofocus>
      <p class="field-error" data-err hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    </form>
    <button class="link-btn" type="button" data-forgot>Forgot password?</button>`);
  const form = root().querySelector('form');
  const err = form.querySelector('[data-err]');
  form.pw.focus();
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (wait > 0) return showErr(err, `Too many tries. Wait ${wait}s.`);
    busy = true;
    const ok = await verifyLock(state.lock, form.pw.value);
    busy = false;
    if (ok) {
      failures = 0;
      await setSignedIn(true).catch(() => {});
      hide();
      done();
      return;
    }
    failures++;
    if (failures >= 5) { blockedUntil = Date.now() + 30000; failures = 0; }
    form.pw.value = '';
    form.classList.remove('shake');
    void form.offsetWidth; // restart the animation
    form.classList.add('shake');
    showErr(err, blockedUntil > Date.now() ? 'Too many tries. Wait 30s.' : 'Wrong password');
  });
  root().querySelector('[data-forgot]').addEventListener('click', () => forgot());
}

function showErr(el, msg) {
  el.textContent = msg;
  el.hidden = false;
  return false;
}

function forgot() {
  openSheet({
    title: 'Forgot password?',
    body: `<p class="sheet-text">The password can’t be recovered. To use Planner again, erase all data on this device, then restore your latest backup from Settings.</p>
      <label class="field"><span class="label">Type ERASE to confirm</span><input class="input" name="confirm" autocomplete="off" autocapitalize="characters"></label>`,
    submitLabel: 'Erase all data on this device',
    onSubmit: async (form) => {
      if (form.confirm.value.trim().toUpperCase() !== 'ERASE') return fieldError(form, 'confirm', 'Type ERASE to confirm');
      await eraseAll();
      toast('Data erased');
      location.reload();
    },
  });
}

/** Settings: change password (asks for the current one). */
export function changePasswordSheet() {
  openSheet({
    title: 'Change password',
    body: `<label class="field"><span class="label">Current password</span><input class="input" type="password" name="cur" autocomplete="current-password" autofocus></label>
      <label class="field"><span class="label">New password</span><input class="input" type="password" name="pw" autocomplete="new-password"></label>
      <label class="field"><span class="label">Repeat new password</span><input class="input" type="password" name="pw2" autocomplete="new-password"></label>`,
    onSubmit: async (form) => {
      if (!(await verifyLock(state.lock, form.cur.value))) return fieldError(form, 'cur', 'That’s not your current password');
      if (form.pw.value.length < MIN_LENGTH) return fieldError(form, 'pw', `Use at least ${MIN_LENGTH} characters`);
      if (form.pw.value !== form.pw2.value) return fieldError(form, 'pw2', 'The passwords don’t match');
      await saveLock(await createLock(form.pw.value));
      toast('Password changed');
    },
  });
}

