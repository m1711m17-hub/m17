import { h, icon, clear, toast } from './lib/dom.js';
import { initPush } from './push.js';
import { sb, state, loadMe, refreshBadges, bus, emit, rt, startRealtime, stopRealtime, touchPresence, goOffline, PROFILE_MINI } from './api.js';
import { POLL_BADGE_MS } from './config.js';
import { authPage } from './pages/auth.js';
import { homePage } from './pages/home.js';
import { aiPage } from './pages/ai.js';
import { explorePage } from './pages/explore.js';
import { composePage } from './pages/compose.js';
import { messagesPage, chatPage } from './pages/messages.js';
import { groupsPage, groupChatPage, joinRoute, initGroupAlerts } from './pages/groups.js';
import { groupInfoPage } from './pages/group-info.js';
import { notificationsPage } from './pages/notifications.js';
import { profilePage } from './pages/profile.js';
import { settingsPage } from './pages/settings.js';
import { adminPage } from './pages/admin.js';
import { postPage } from './pages/postpage.js';
import { callsPage, initCalls, stopCalls, inCall } from './pages/calls.js';
import { openLive, endLiveOnExit, initInvites } from './pages/live.js';
import { checkForUpdates } from './update.js';
import { storePage } from './pages/store.js';

const root = document.getElementById('root');
const ROUTES = [
  [/^\/home$/, 'home', homePage], [/^\/explore$/, 'explore', explorePage], [/^\/ai$/, 'none', aiPage], [/^\/compose$/, 'compose', composePage],
  [/^\/messages$/, 'messages', messagesPage], [/^\/groups$/, 'messages', groupsPage], [/^\/group\/([0-9a-f-]{36})$/, 'messages', groupChatPage, ['id']], [/^\/group\/([0-9a-f-]{36})\/info$/, 'messages', groupInfoPage, ['id']], [/^\/join\/([a-z0-9]{6,20})$/, 'messages', joinRoute, ['code']], [/^\/chat\/([a-z0-9_]+)$/, 'messages', chatPage, ['username']],
  [/^\/notifications$/, 'none', notificationsPage], [/^\/profile$/, 'profile', profilePage],
  [/^\/u\/([a-z0-9_]+)$/, 'profile', profilePage, ['username']], [/^\/settings$/, 'profile', settingsPage],
  [/^\/admin$/, 'profile', adminPage], [/^\/store$/, 'none', storePage], [/^\/calls$/, 'messages', callsPage], [/^\/post\/([0-9a-f-]{36})$/, 'none', postPage, ['id']],
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
    h('a', { class: 'tab-fab tab-live', href: '#/home', 'aria-label': 'بث مباشر', onclick: (e) => { e.preventDefault(); openLive(); } }, h('i', { class: 'fab-dot' }), h('span', null, 'LIVE')),
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
  try { localStorage.setItem('m17.route', JSON.stringify({ h: location.hash, t: Date.now() })); } catch {}
  let match = null;
  for (const [re, tab, fn, names] of ROUTES) { const m = path.match(re); if (m) { match = { tab, fn, params: Object.fromEntries((names || []).map((n, i) => [n, m[i + 1]])) }; break; } }
  if (!match) { location.replace('#/home'); return; }
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  view?.remove();
  view = h('main', { class: 'view enter' });
  root.querySelector('.shell').prepend(view);
  tabbar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === match.tab));
  document.body.classList.toggle('in-chat', /^\/(chat|group)\//.test(path) || path === '/ai');
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

// After the Android WebView is recreated (memory pressure, returning from the camera/gallery...) come back to where the user was.
function restoreRoute() {
  try {
    const r = JSON.parse(localStorage.getItem('m17.route') || 'null');
    if (r && Date.now() - r.t < 6 * 3600e3 && /^#\/(chat\/|group\/|groups|u\/|post\/|messages|explore|profile|notifications|settings|ai)/.test(r.h)) return r.h;
  } catch {}
  return null;
}

async function boot() {
  stopRealtime(); clearInterval(badgeTimer); cleanup?.(); cleanup = null; nav++;
  let err = '';
  let slow = false;
  try { if (sb.session) await Promise.race([loadMe(), new Promise((_, rej) => setTimeout(() => { slow = true; rej(new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت.')); }, 12000))]); } catch (e) { err = e.message; state.me = null; }
  if (slow && sb.session) { // signed in but the network is down/slow: keep the session, offer a retry instead of throwing the user to the login page
    document.getElementById('splash')?.remove(); clear(root).append(h('div', { class: 'boot-retry' }, h('p', null, err), h('button', { class: 'btn primary', type: 'button', onclick: () => boot() }, 'إعادة المحاولة'))); return;
  }
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
  if (!location.hash || location.hash === '#/') location.hash = restoreRoute() || '#/home';
  await route();
  refreshBadges();
  initPush();
  startRealtime(); initCalls(); try { initGroupAlerts(); } catch (e) { console.warn(e); } try { initInvites(); } catch (e) { console.warn(e); } touchPresence();
  badgeTimer = setInterval(() => { if (!document.hidden) refreshBadges(); }, POLL_BADGE_MS);
}

window.addEventListener('hashchange', route);
sb.onAuth((s) => { if (!s && state.me) { stopCalls(); state.me = null; stopRealtime(); boot(); } });

// presence heartbeat + app resume
setInterval(() => { if ((!document.hidden || inCall()) && state.me) touchPresence(); }, 30000);
let offTimer = null;
document.addEventListener('visibilitychange', () => {
  clearTimeout(offTimer);
  if (document.hidden) { offTimer = setTimeout(() => { if (document.hidden && state.me && !inCall()) goOffline(); }, 3000); return; }
  if (!state.me) return;
  touchPresence(); refreshBadges(); emit('m17:resume'); rt?.reconnectNow();
});
window.addEventListener('pagehide', () => { endLiveOnExit(); if (state.me && !inCall()) goOffline(); });
window.addEventListener('online', () => { rt?.reconnectNow(); emit('m17:resume'); });

// in-app banner for new messages / notifications while not looking at that chat
const nameCache = new Map();
async function senderOf(id) { if (!nameCache.has(id)) { try { nameCache.set(id, await sb.from('profiles').select(PROFILE_MINI).eq('id', id).one()); } catch { return null; } } return nameCache.get(id); }
bus.addEventListener('rt:message', async (e) => {
  const m = e.detail; refreshBadges(); if (!m || document.hidden) return;
  const p = await senderOf(m.sender_id); if (!p) return;
  if (location.hash === '#/chat/' + p.username) return;
  const txt = m.audio_url ? '🎙️ رسالة صوتية' : m.sticker ? '🙂 ملصق' : m.media_url ? (m.media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة') : (m.body || '').slice(0, 60);
  toast(`💬 ${p.display_name || p.username}: ${txt}`);
});
bus.addEventListener('rt:notification', () => refreshBadges());

// Android hardware back button: close overlays first, then navigate, never just kill the app
const CapApp = window.Capacitor?.Plugins?.App;
CapApp?.addListener?.('backButton', () => {
  const sv = document.querySelector('.story-view'); if (sv) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return; }
  const ov = [...document.querySelectorAll('.cam-screen,.call-screen,.live-screen,.lightbox,.pv-overlay,.sm-overlay,.sheet-back')].pop(); if (ov) { ov.dispatchEvent(new CustomEvent('m17:back', { bubbles: false })); if (ov.isConnected) ov.click(); return; }
  const path = parseHash().path;
  if (/^\/(chat\/|group\/|groups|join\/|u\/|post\/|settings|admin|compose|notifications|calls|ai)/.test(path)) { if (history.length > 1) history.back(); else location.hash = '#/home'; return; }
  if (path !== '/home') { location.hash = '#/home'; return; }
  CapApp.minimizeApp?.();
});
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message) console.warn(e.reason); });
boot();
// Check for a newer NEXORA release after the first screen has had time to load.
setTimeout(() => checkForUpdates(), 6000);
window.addEventListener('m17:resume', () => checkForUpdates());
