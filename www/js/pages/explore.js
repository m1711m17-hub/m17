import { h, icon, avatar, clear, toast, badge } from '../lib/dom.js';
import { sb, state, enrichPosts, POST_SELECT, PROFILE_MINI } from '../api.js';
import { postCard } from './postcard.js';
import { headerBar, bellButton } from './home.js';
import { followButton } from './profile.js';

export function userRow(p, extra) {
  return h('a', { class: 'user-row', href: `#/u/${p.username}` }, avatar(p, 46),
    h('div', { class: 'grow' }, h('div', { class: 'p-name' }, p.display_name || p.username, badge(p.role)), h('div', { class: 'muted small' }, '@' + p.username, p.is_private ? ' · 🔒' : '')), extra);
}

export async function explorePage(root) {
  const input = h('input', { class: 'input search', placeholder: 'ابحث عن مستخدمين أو منشورات...', type: 'search' });
  const results = h('div'), discover = h('div');
  root.append(headerBar('استكشاف', { right: [bellButton()] }),
    h('div', { class: 'page' }, h('div', { class: 'search-wrap' }, icon('search', 20), input), results, discover));

  async function loadDiscover() {
    try {
      const fol = (await sb.from('follows').select('following_id').eq('follower_id', state.me.id)).map((r) => r.following_id);
      const exclude = new Set([state.me.id, ...fol]);
      const [users, posts] = await Promise.all([
        sb.from('profiles').select(PROFILE_MINI).order('created_at', { ascending: false }).limit(30),
        sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(20),
      ]);
      const sugg = users.filter((u) => !exclude.has(u.id)).slice(0, 6);
      clear(discover);
      if (sugg.length) discover.append(h('h3', { class: 'sec' }, 'أشخاص قد تعرفهم'), h('div', { class: 'card-list' }, sugg.map((u) => userRow(u, followButton(u, { small: true })))));
      await enrichPosts(posts);
      discover.append(h('h3', { class: 'sec' }, 'أحدث المنشورات'));
      if (!posts.length) discover.append(h('div', { class: 'empty' }, icon('compass', 44), h('p', null, 'لا توجد منشورات بعد. كن أول من ينشر!')));
      posts.forEach((p) => discover.append(postCard(p)));
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
        const [users, posts] = await Promise.all([
          sb.from('profiles').select(PROFILE_MINI).or(`username.ilike.*${safe}*,display_name.ilike.*${safe}*`).limit(20),
          sb.from('posts').select(POST_SELECT).ilike('body', `*${safe}*`).order('created_at', { ascending: false }).limit(15),
        ]);
        if (my !== seq) return;
        users.sort((a, b) => (b.username === safe.toLowerCase()) - (a.username === safe.toLowerCase()));
        await enrichPosts(posts);
        clear(results);
        if (!users.length && !posts.length) return results.append(h('div', { class: 'empty' }, icon('search', 44), h('p', null, 'لا نتائج مطابقة')));
        if (users.length) results.append(h('h3', { class: 'sec' }, 'المستخدمون'), h('div', { class: 'card-list' }, users.filter((u) => u.id !== state.me.id || true).map((u) => userRow(u, u.id === state.me.id ? null : followButton(u, { small: true })))));
        if (posts.length) results.append(h('h3', { class: 'sec' }, 'المنشورات'), posts.map((p) => postCard(p)));
      } catch (e) { toast(e.message, 'err'); }
    }, 350);
  });
  await loadDiscover();
}
