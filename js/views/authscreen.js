// Profile picker, shown only when this iPhone has more than one profile and none is in use.
// No passwords: tap a profile to open it.
import { allUsers, useProfile, profileName } from '../auth.js';
import { icon } from '../icons.js';
import { esc } from '../ui.js';

const root = () => document.getElementById('auth-root');

/** Resolve with the chosen profile. */
export async function profilePicker() {
  const users = await allUsers();
  return new Promise((resolve) => {
    root().innerHTML = `<div class="auth">
      <img class="auth-icon" src="icons/apple-touch-icon.png" alt="" width="76" height="76">
      <h1>Choose a profile</h1>
      <p class="auth-text">Each profile has its own data on this iPhone.</p>
      <ul class="list card flush auth-list">${users.map((u) => `
        <li class="row tappable has-icon" data-id="${esc(u.id)}" role="button" tabindex="0">
          <span class="icon-tile">${icon('user')}</span>
          <div class="row-main"><span class="row-title">${esc(profileName(u))}</span>${u.email ? `<span class="row-sub">${esc(u.email)}</span>` : ''}</div>
          <span class="row-end">${icon('chev-right')}</span>
        </li>`).join('')}</ul>
      <p class="auth-note">${icon('lock', 'ic-xs')} Your data is stored only on this iPhone — not online.</p>
    </div>`;
    root().hidden = false;
    document.body.classList.add('authing');
    root().querySelectorAll('[data-id]').forEach((row) => {
      const pick = async () => {
        const user = await useProfile(row.dataset.id);
        root().hidden = true;
        root().innerHTML = '';
        document.body.classList.remove('authing');
        resolve(user);
      };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  });
}
