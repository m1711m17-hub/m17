import { h, icon, avatar, clear, toast, badge } from '../lib/dom.js';
import { sb, state, PROFILE_MINI } from '../api.js';
import { headerBar, bellButton } from './home.js';
import { followButton } from './profile.js';
import { reelsView } from './reels.js';

export function userRow(p, extra) {
  return h('a', { class: 'user-row', href: `#/u/${p.username}` }, avatar(p, 46),
    h('div', { class: 'grow' }, h('div', { class: 'p-name' }, p.display_name || p.username, badge(p.role)), h('div', { class: 'muted small' }, '@' + p.username, p.is_private ? ' · 🔒' : '')), extra);
}

export async function explorePage(root) {
  const input = h('input', { class: 'input search', placeholder: 'ابحث عن مستخدمين...', type: 'search' });
  const results = h('div'), discover = h('div');
  const reelsHost = h('div', { class: 'reels-host', hidden: true });
  const wrap = h('div', { class: 'search-wrap' }, icon('search', 20), input);
  let tab = 'posts', stopReels = null;
  const tabs = h('div', { class: 'chips explore-tabs' });
  function paintTabs() {
    clear(tabs).append(...[['posts', 'الأشخاص', 'users'], ['reels', 'ريلز', 'video']].map(([k, l, ic]) => h('button', { class: 'chip' + (tab === k ? ' on' : ''), type: 'button', onclick: () => setTab(k) }, icon(ic, 16), l)));
  }
  function setTab(k) {
    tab = k; paintTabs();
    const r = k === 'reels';
    wrap.hidden = r; results.hidden = r; discover.hidden = r; reelsHost.hidden = !r;
    document.body.classList.toggle('reels-on', r);
    if (r && !stopReels) stopReels = reelsView(reelsHost);
    if (!r && stopReels) { stopReels(); stopReels = null; }
  }
  root.append(headerBar('استكشاف', { right: [h('button', { class: 'icon-btn accent', 'aria-label': 'NEXORA AI', title: 'NEXORA AI', onclick: () => (location.hash = '#/ai') }, icon('bolt', 22)), bellButton()] }),
    h('div', { class: 'page' }, tabs, wrap, results, discover, reelsHost));
  paintTabs();

  async function loadDiscover() {
    try {
      const fol = (await sb.from('follows').select('following_id').eq('follower_id', state.me.id)).map((r) => r.following_id);
      const exclude = new Set([state.me.id, ...fol]);
      const users = await sb.from('profiles').select(PROFILE_MINI).order('created_at', { ascending: false }).limit(60);
      const sugg = users.filter((u) => !exclude.has(u.id)).slice(0, 40);
      clear(discover);
      if (sugg.length) discover.append(h('h3', { class: 'sec' }, 'أشخاص قد تعرفهم'), h('div', { class: 'card-list' }, sugg.map((u) => userRow(u, followButton(u, { small: true })))));
      else discover.append(h('div', { class: 'empty' }, icon('users', 44), h('p', null, 'تتابع جميع المستخدمين حالياً')));
    } catch (e) { clear(discover).append(h('div', { class: 'empty' }, e.message)); }
  }

  let t = null, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim().replace(/^@/, '');
    if (!q) { clear(results); discover.style.display = ''; return; }
    discover.style.display = 'none';
    t = setTimeout(async () => {
      const my = ++seq;
      try {
        const safe = q.replace(/[%*,()\\]/g, ' ').trim(); if (!safe) return;
        const users = await sb.from('profiles').select(PROFILE_MINI).or(`username.ilike.*${safe}*,display_name.ilike.*${safe}*`).limit(30);
        if (my !== seq) return;
        users.sort((a, b) => (b.username === safe.toLowerCase()) - (a.username === safe.toLowerCase()));
        clear(results);
        if (!users.length) return results.append(h('div', { class: 'empty' }, icon('search', 44), h('p', null, 'لا نتائج مطابقة')));
        if (users.length) results.append(h('h3', { class: 'sec' }, 'المستخدمون'), h('div', { class: 'card-list' }, users.filter((u) => u.id !== state.me.id || true).map((u) => userRow(u, u.id === state.me.id ? null : followButton(u, { small: true })))));
      } catch (e) { toast(e.message, 'err'); }
    }, 350);
  });
  await loadDiscover();
  return () => { stopReels?.(); document.body.classList.remove('reels-on'); };
}
