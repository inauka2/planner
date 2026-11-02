// Full-screen sign up / sign in, shown only when no account is signed in on this iPhone.
import { signUp, signIn, resetPassword, hasAccounts } from '../auth.js';
import { MIN_PASSWORD } from '../passwords.js';
import { icon } from '../icons.js';

const root = () => document.getElementById('auth-root');

const emailField = (value = '') => `
  <label class="auth-field"><span>Email</span>
    <input class="input" type="email" name="email" value="${value.replace(/"/g, '&quot;')}" placeholder="you@gmail.com"
      autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="email"></label>`;

const passwordField = (name, label, autocomplete) => `
  <label class="auth-field"><span>${label}</span>
    <span class="pw-wrap">
      <input class="input" type="password" name="${name}" placeholder="At least ${MIN_PASSWORD} characters"
        autocomplete="${autocomplete}" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button type="button" class="pw-eye" data-eye aria-label="Show password">${icon('eye')}</button>
    </span></label>`;

const SCREENS = {
  signup: {
    title: 'Create your account',
    text: 'Sign up once. Planner keeps you signed in on this iPhone until you log out, and everything you enter is saved to your account.',
    fields: () => emailField() + passwordField('password', 'Password', 'new-password'),
    submit: 'Create account',
    links: (has) => (has ? '<button type="button" class="link-btn" data-go="signin">I already have an account</button>' : ''),
    run: (f) => signUp(f.email.value, f.password.value),
  },
  signin: {
    title: 'Sign in',
    text: 'Welcome back. Sign in to see your planner.',
    fields: () => emailField() + passwordField('password', 'Password', 'current-password'),
    submit: 'Sign in',
    links: () => '<button type="button" class="link-btn" data-go="forgot">Forgot password?</button><button type="button" class="link-btn" data-go="signup">Create a new account</button>',
    run: (f) => signIn(f.email.value, f.password.value),
  },
  forgot: {
    title: 'Reset password',
    text: 'Your account lives on this iPhone, so you can choose a new password here. Your data stays as it is.',
    fields: () => emailField() + passwordField('password', 'New password', 'new-password'),
    submit: 'Save new password',
    links: () => '<button type="button" class="link-btn" data-go="signin">Back to sign in</button>',
    run: (f) => resetPassword(f.email.value, f.password.value),
  },
};

/** Resolve with the signed-in user once they sign up or sign in. */
export async function authGate() {
  const has = await hasAccounts();
  return new Promise((resolve) => show(has ? 'signin' : 'signup', has, resolve));
}

function show(mode, has, done) {
  const sc = SCREENS[mode];
  root().innerHTML = `<div class="auth">
    <img class="auth-icon" src="icons/apple-touch-icon.png" alt="" width="76" height="76">
    <h1>${sc.title}</h1>
    <p class="auth-text">${sc.text}</p>
    <form class="auth-form" novalidate>
      <div class="auth-group">${sc.fields()}</div>
      <p class="field-error" data-err hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${sc.submit}</button>
    </form>
    <div class="auth-links">${sc.links(has)}</div>
    <p class="auth-note">${icon('lock', 'ic-xs')} Your account and data are stored only on this iPhone — not online.</p>
  </div>`;
  root().hidden = false;
  document.body.classList.add('authing');
  const form = root().querySelector('form');
  const err = form.querySelector('[data-err]');
  root().querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go, has, done)));
  root().querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
    const input = b.previousElementSibling;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    b.innerHTML = icon(showing ? 'eye' : 'eye-off');
    b.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  }));
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    err.hidden = true;
    try {
      const user = await sc.run(form);
      root().hidden = true;
      root().innerHTML = '';
      document.body.classList.remove('authing');
      done(user);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    } finally {
      busy = false;
    }
  });
}
