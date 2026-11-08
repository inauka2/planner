// Full-screen gates shown before any data is loaded:
// - signInGate: after logging out (Sign in with Google), or to pick a profile when there are several.
// - lockScreen: Face ID, when the profile has it turned on.
import { allUsers, useProfile, profileName, updateUser } from '../auth.js';
import { googleEnabled, startGoogleSignIn } from '../google.js';
import { unlockWithFaceId } from '../faceid.js';
import { icon } from '../icons.js';
import { esc, confirmDialog } from '../ui.js';

const root = () => document.getElementById('auth-root');

const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

export const googleButton = (act, label = 'Sign in with Google') => `<button type="button" class="btn btn-google btn-block" data-gact="${act}">${GOOGLE_G}<span>${label}</span></button>`;

function show(html) {
  root().innerHTML = `<div class="auth">${html}
    <p class="auth-note">${icon('lock', 'ic-xs')} Your data is stored only on this iPhone — not online.</p></div>`;
  root().hidden = false;
  document.body.classList.add('authing');
}

function hide() {
  root().hidden = true;
  root().innerHTML = '';
  document.body.classList.remove('authing');
}

const errorLine = (msg) => `<p class="field-error" data-err ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>`;

/** Sign in with Google and/or pick a profile. Resolves with the chosen profile (Google leaves the page). */
export async function signInGate(error = '') {
  const users = await allUsers();
  const open = users.filter((u) => !u.googleSub); // profiles that don't need Google
  const hasGoogle = users.some((u) => u.googleSub);
  return new Promise((resolve) => {
    show(`
      <img class="auth-icon" src="icons/apple-touch-icon.png" alt="" width="76" height="76">
      <h1>${hasGoogle ? 'Welcome back' : 'Choose a profile'}</h1>
      <p class="auth-text">${hasGoogle ? 'Sign in with your Google account to open your planner. You stay signed in until you log out.' : 'Each profile has its own data on this iPhone.'}</p>
      ${hasGoogle && googleEnabled() ? `<div class="auth-form">${googleButton('signin')}</div>` : ''}
      ${errorLine(error)}
      ${open.length ? `${hasGoogle ? '<p class="auth-or">or open a profile without Google</p>' : ''}
        <ul class="list card flush auth-list">${open.map((u) => `
          <li class="row tappable has-icon" data-id="${esc(u.id)}" role="button" tabindex="0">
            <span class="icon-tile">${icon('user')}</span>
            <div class="row-main"><span class="row-title">${esc(profileName(u))}</span>${u.email ? `<span class="row-sub">${esc(u.email)}</span>` : ''}</div>
            <span class="row-end">${icon('chev-right')}</span>
          </li>`).join('')}</ul>` : ''}`);
    root().querySelector('[data-gact="signin"]')?.addEventListener('click', () => {
      try { startGoogleSignIn({ intent: 'signin' }); } catch (e) { showError(e.message); }
    });
    root().querySelectorAll('[data-id]').forEach((row) => {
      const pick = async () => { const user = await useProfile(row.dataset.id); hide(); resolve(user); };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  });
}

function showError(msg) {
  const el = root().querySelector('[data-err]');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

/** Face ID lock. Resolves with the (possibly updated) profile once unlocked. */
export function lockScreen(user) {
  return new Promise((resolve) => {
    show(`
      <img class="auth-icon" src="icons/apple-touch-icon.png" alt="" width="76" height="76">
      <h1>Planner is locked</h1>
      <p class="auth-text">${esc(profileName(user))}${user.email ? ` · ${esc(user.email)}` : ''}</p>
      <div class="auth-form">
        <button type="button" class="btn btn-primary btn-block btn-lg" data-unlock>${icon('user')} Unlock with Face ID</button>
        ${errorLine('')}
      </div>
      <div class="auth-links"><button type="button" class="link-btn" data-escape>Can’t use Face ID?</button></div>`);
    let busy = false;
    const unlock = async () => {
      if (busy) return;
      busy = true;
      try {
        await unlockWithFaceId(user.faceId);
        hide();
        resolve(user);
      } catch (e) {
        showError(`${e.message} Tap to try again.`);
      } finally { busy = false; }
    };
    root().querySelector('[data-unlock]').addEventListener('click', unlock);
    root().querySelector('[data-escape]').addEventListener('click', async () => {
      if (user.googleSub && googleEnabled()) {
        const ok = await confirmDialog({ title: 'Sign in with Google instead?', message: `Sign in with ${esc(user.email)} to open your planner without Face ID.`, confirmLabel: 'Continue' });
        if (ok) try { startGoogleSignIn({ intent: 'signin' }); } catch (e) { showError(e.message); }
        return;
      }
      const ok = await confirmDialog({
        title: 'Turn off the Face ID lock?',
        message: 'Your planner will open without Face ID. You can turn it on again in Settings. Tip: sign in with Google first, so Google can unlock it instead.',
        confirmLabel: 'Turn off', danger: true,
      });
      if (!ok) return;
      const next = await updateUser(user.id, { faceId: null });
      hide();
      resolve(next);
    });
  });
}
