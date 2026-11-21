import { h, clear, toast } from '../lib/dom.js';
import { sb } from '../api.js';

export function authPage(root, onDone) {
  let mode = 'login';
  const err = h('div', { class: 'form-err', role: 'alert' });
  const user = h('input', { class: 'input', placeholder: 'اسم المستخدم (إنجليزي)', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', dir: 'ltr', maxlength: 20 });
  const name = h('input', { class: 'input', placeholder: 'الاسم الظاهر', maxlength: 50, autocomplete: 'name' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'كلمة المرور', autocomplete: 'current-password', dir: 'ltr' });
  const pass2 = h('input', { class: 'input', type: 'password', placeholder: 'تأكيد كلمة المرور', autocomplete: 'new-password', dir: 'ltr' });
  const btn = h('button', { class: 'btn primary block lg', type: 'submit' });
  const tabL = h('button', { type: 'button', class: 'seg-btn on', onclick: () => set('login') }, 'تسجيل الدخول');
  const tabR = h('button', { type: 'button', class: 'seg-btn', onclick: () => set('register') }, 'حساب جديد');
  const regOnly = [name, pass2];

  function set(m) {
    mode = m; err.textContent = '';
    tabL.classList.toggle('on', m === 'login'); tabR.classList.toggle('on', m === 'register');
    regOnly.forEach((e) => (e.style.display = m === 'register' ? '' : 'none'));
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    btn.textContent = m === 'login' ? 'دخول' : 'إنشاء الحساب';
  }
  const form = h('form', { class: 'auth-form', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const u = user.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return (err.textContent = 'اسم المستخدم: 3-20 حرفاً إنجليزياً أو أرقاماً أو _');
    if (pass.value.length < 6) return (err.textContent = 'كلمة المرور 6 أحرف على الأقل');
    if (mode === 'register' && pass.value !== pass2.value) return (err.textContent = 'كلمتا المرور غير متطابقتين');
    btn.disabled = true; btn.classList.add('loading');
    try {
      if (mode === 'login') await sb.auth.signIn(u, pass.value);
      else await sb.auth.signUp(u, pass.value, name.value.trim());
      await onDone();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; btn.classList.remove('loading'); }
  } }, user, name, pass, pass2, err, btn);

  clear(root).append(h('div', { class: 'auth' },
    h('div', { class: 'auth-glow' }),
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, 'M17'), h('p', null, 'تواصل مع من تحب، شارك لحظاتك')),
    h('div', { class: 'seg' }, tabL, tabR), form,
    h('p', { class: 'muted small center' }, 'بإنشاء حساب فأنت توافق على قواعد المجتمع.')));
  set('login');
}
