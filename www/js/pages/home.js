import { h, icon, clear, toast } from '../lib/dom.js';
import { sb, state, enrichPosts, followingIds, POST_SELECT, isStaff } from '../api.js';
import { postCard } from './postcard.js';
import { loadStoryGroups, storyBar } from './stories.js';
import { quickComposer } from './quickcompose.js';

export function headerBar(title, { back = false, right = [] } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/home')) }, icon('back', 22)) : null,
    h('div', { class: 'topbar-title' }, title), h('div', { class: 'row' }, right));
}
export function bellButton() {
  const dot = h('span', { class: 'dot', style: { display: 'none' } });
  const b = h('button', { class: 'icon-btn', 'aria-label': 'الإشعارات', onclick: () => (location.hash = '#/notifications') }, icon('bell', 23), dot);
  const upd = () => { dot.style.display = state.unreadNotifs ? '' : 'none'; dot.textContent = state.unreadNotifs > 9 ? '9+' : state.unreadNotifs; };
  document.addEventListener('m17:badges', upd); upd();
  return b;
}

export async function homePage(root) {
  const feed = h('div', { class: 'feed' });
  const storiesBox = h('div');
  const more = h('button', { class: 'btn ghost block', style: { display: 'none' } }, 'عرض المزيد');
  root.append(headerBar(h('span', { class: 'logo-text' }, 'M17'), { right: [isStaff() ? h('button', { class: 'icon-btn', 'aria-label': 'الإدارة', onclick: () => (location.hash = '#/admin') }, icon('shield', 23)) : null, bellButton()] }),
    h('div', { class: 'page' }, quickComposer(), storiesBox, feed, more));
  let ids = [], before = null, loading = false;
  const PAGE = 15;

  async function loadStories() {
    try { const groups = await loadStoryGroups(ids); clear(storiesBox).append(storyBar(groups, loadStories)); }
    catch { clear(storiesBox); }
  }
  async function loadMore() {
    if (loading) return; loading = true; more.disabled = true;
    try {
      let q = sb.from('posts').select(POST_SELECT).in('author_id', [state.me.id, ...ids]).order('created_at', { ascending: false }).limit(PAGE);
      if (before) q = q.lt('created_at', before);
      const rows = await enrichPosts(await q);
      rows.forEach((p) => feed.append(postCard(p)));
      if (rows.length) before = rows.at(-1).created_at;
      more.style.display = rows.length === PAGE ? '' : 'none';
      if (!feed.children.length) feed.append(h('div', { class: 'empty' }, icon('users', 44), h('h3', null, 'صفحتك الرئيسية فارغة'), h('p', null, 'تابع أشخاصاً من صفحة الاستكشاف لتظهر منشوراتهم هنا.'), h('a', { class: 'btn primary', href: '#/explore' }, 'استكشف الآن')));
    } catch (e) { toast(e.message, 'err'); } finally { loading = false; more.disabled = false; }
  }
  more.onclick = loadMore;
  feed.append(...[1, 2].map(() => h('div', { class: 'skeleton post-sk' })));
  try { ids = await followingIds(); } catch (e) { toast(e.message, 'err'); }
  clear(feed);
  await Promise.all([loadStories(), loadMore()]);
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && more.style.display !== 'none') loadMore(); }, { rootMargin: '400px' });
  io.observe(more);
  return () => io.disconnect();
}
