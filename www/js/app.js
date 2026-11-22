import { h, icon, clear, toast } from './lib/dom.js';
import { initPush } from './push.js';
import { sb, state, loadMe, refreshBadges } from './api.js';
import { POLL_BADGE_MS } from './config.js';
import { authPage } from './pages/auth.js';
import { homePage } from './pages/home.js';
import { explorePage } from './pages/explore.js';
import { composePage } from './pages/compose.js';
import { messagesPage, chatPage } from './pages/messages.js';
import { notificationsPage } from './pages/notifications.js';
import { profilePage } from './pages/profile.js';
import { settingsPage } from './pages/settings.js';
import { adminPage } from './pages/admin.js';
import { postPage } from './pages/postpage.js';

const root = document.getElementById('root');
const ROUTES = [
  [/^\/home$/, 'home', homePage], [/^\/explore$/, 'explore', explorePage], [/^\/compose$/, 'compose', composePage],
  [/^\/messages$/, 'messages', messagesPage], [/^\/chat\/([a-z0-9_]+)$/, 'messages', chatPage, ['username']],
  [/^\/notifications$/, 'none', notificationsPage], [/^\/profile$/, 'profile', profilePage],
  [/^\/u\/([a-z0-9_]+)$/, 'profile', profilePage, ['username']], [/^\/settings$/, 'profile', settingsPage],
  [/^\/admin$/, 'profile', adminPage], [/^\/post\/([0-9a-f-]{36})$/, 'none', postPage, ['id']],
];
let view = null, cleanup = null, nav = 0, tabbar = null, badgeTimer = null;
const ctx = { rerender: () => boot() };

function parseHash() {
  const raw = (location.hash || '#/home').slice(1);
  const [path, qs] = raw.split('?');
  return { path: path || '/home', q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function buildTabbar() {
  const tab = (key, ic, label, href) => h('a', { class: 'tab', 'data-tab': key, href }, h('span', { class: 'tab-ico' }, icon(ic, 24), h('span', { class: 'dot', 'data-badge': key })), h('span', null, label));
  return h('nav', { class: 'tabbar' },
    tab('home', 'home', 'الرئيسية', '#/home'), tab('explore', 'compass', 'استكشاف', '#/explore'),
    h('a', { class: 'tab-fab', href: '#/compose', 'aria-label': 'نشر' }, icon('plus', 28)),
    tab('messages', 'chat', 'الرسائل', '#/messages'), tab('profile', 'user', 'حسابي', '#/profile'));
}
function paintBadges() {
  const set = (k, n) => { const d = tabbar?.querySelector(`[data-badge="${k}"]`); if (d) { d.style.display = n ? '' : 'none'; d.textContent = n > 9 ? '9+' : n; } };
  set('messages', state.unreadChats);
}
document.addEventListener('m17:badges', paintBadges);

async function route() {
  if (!state.me || !root.querySelector('.shell')) return;
  const my = ++nav;
  const { path, q } = parseHash();
  let match = null;
  for (const [re, tab, fn, names] of ROUTES) { const m = path.match(re); if (m) { match = { tab, fn, params: Object.fromEntries((names || []).map((n, i) => [n, m[i + 1]])) }; break; } }
  if (!match) { location.replace('#/home'); return; }
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  view?.remove();
  view = h('main', { class: 'view enter' });
  root.querySelector('.shell').prepend(view);
  tabbar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === match.tab));
  document.body.classList.toggle('in-chat', /^\/chat\//.test(path));
  window.scrollTo(0, 0);
  try {
    const c = await match.fn(view, { ...match.params, ...q }, ctx);
    if (my !== nav) { if (typeof c === 'function') c(); return; }
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    if (my !== nav) return;
    clear(view).append(h('div', { class: 'empty' }, icon('close', 44), h('h3', null, 'تعذر تحميل الصفحة'), h('p', null, e.message), h('button', { class: 'btn primary', onclick: route }, 'إعادة المحاولة')));
  }
}

async function boot() {
  clearInterval(badgeTimer); cleanup?.(); cleanup = null; nav++;
  let err = '';
  try { if (sb.session) await loadMe(); } catch (e) { err = e.message; state.me = null; }
  document.getElementById('splash')?.remove();
  document.body.classList.remove('in-chat');
  if (!state.me) {
    authPage(root, async () => { await loadMe(); location.hash = '#/home'; boot(); });
    if (err) root.querySelector('.form-err').textContent = err;
    return;
  }
  clear(root);
  tabbar = buildTabbar();
  root.append(h('div', { class: 'shell' }, tabbar));
  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  await route();
  refreshBadges();
  initPush();
  badgeTimer = setInterval(() => { if (!document.hidden) refreshBadges(); }, POLL_BADGE_MS);
}

window.addEventListener('hashchange', route);
sb.onAuth((s) => { if (!s && state.me) { state.me = null; boot(); } });
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message) console.warn(e.reason); });
boot();
