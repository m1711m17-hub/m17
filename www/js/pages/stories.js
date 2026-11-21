import { h, icon, avatar, timeAgo, confirmBox, toast, clear } from '../lib/dom.js';
import { sb, state, PROFILE_MINI } from '../api.js';

// groups: [{author, items:[story]}]
export async function loadStoryGroups(followIds) {
  const rows = await sb.from('stories').select(`*,author:profiles!stories_author_id_fkey(${PROFILE_MINI})`).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true }).limit(300);
  const allowed = new Set([...followIds, state.me.id]);
  const map = new Map();
  for (const s of rows) {
    if (!allowed.has(s.author_id)) continue;
    if (!map.has(s.author_id)) map.set(s.author_id, { author: s.author, items: [] });
    map.get(s.author_id).items.push(s);
  }
  const groups = [...map.values()];
  groups.sort((a, b) => (a.author.id === state.me.id ? -1 : b.author.id === state.me.id ? 1 : new Date(b.items.at(-1).created_at) - new Date(a.items.at(-1).created_at)));
  return groups;
}

export function storyBar(groups, onChange) {
  const bar = h('div', { class: 'stories-bar' });
  const mine = groups.find((g) => g.author.id === state.me.id);
  bar.append(h('button', { class: 'story-item', onclick: () => (mine ? openViewer(groups, groups.indexOf(mine), onChange) : (location.hash = '#/compose?story=1')) },
    h('div', { class: 'story-ring' + (mine ? '' : ' none') }, avatar(state.me, 58), !mine && h('span', { class: 'story-plus' }, icon('plus', 14))),
    h('span', null, 'حالتي')));
  groups.forEach((g, i) => {
    if (g.author.id === state.me.id) return;
    bar.append(h('button', { class: 'story-item', onclick: () => openViewer(groups, i, onChange) },
      h('div', { class: 'story-ring' }, avatar(g.author, 58)), h('span', null, g.author.display_name || g.author.username)));
  });
  return bar;
}

export function openViewer(groups, gi, onChange) {
  let g = gi, i = 0, timer = null, closed = false;
  const root = h('div', { class: 'story-view' });
  document.body.append(root);

  function close() { closed = true; clearTimeout(timer); root.remove(); document.removeEventListener('keydown', key); }
  function key(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', key);
  function next() { const grp = groups[g]; if (i < grp.items.length - 1) { i++; show(); } else if (g < groups.length - 1) { g++; i = 0; show(); } else close(); }
  function prev() { if (i > 0) { i--; show(); } else if (g > 0) { g--; i = 0; show(); } else show(); }

  function show() {
    if (closed) return;
    clearTimeout(timer);
    const grp = groups[g], s = grp.items[i];
    clear(root);
    const bars = h('div', { class: 'sv-bars' }, grp.items.map((_, k) => h('div', { class: 'sv-bar' }, h('i', { class: k < i ? 'done' : '' }))));
    const fill = bars.children[i].firstChild;
    let media;
    const start = (ms) => { fill.style.transition = `width ${ms}ms linear`; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '100%'; })); timer = setTimeout(next, ms); };
    if (s.media_type === 'video') {
      media = h('video', { src: s.media_url, autoplay: true, playsinline: true });
      media.onloadedmetadata = () => start(Math.min(30000, (media.duration || 8) * 1000));
      media.onerror = () => start(3000);
    } else {
      media = h('img', { src: s.media_url, alt: '' });
      media.onload = () => start(5000); media.onerror = () => start(3000);
    }
    const isMine = grp.author.id === state.me.id;
    root.append(bars,
      h('div', { class: 'sv-head' },
        h('div', { class: 'row gap' }, avatar(grp.author, 36), h('b', null, grp.author.display_name || grp.author.username), h('span', { class: 'muted small' }, timeAgo(s.created_at))),
        h('div', { class: 'row' },
          isMine && h('button', { class: 'icon-btn', 'aria-label': 'حذف', onclick: async (e) => {
            e.stopPropagation(); clearTimeout(timer);
            if (!(await confirmBox('حذف هذه الحالة؟', 'حذف', true))) { show(); return; }
            try { await sb.from('stories').delete().eq('id', s.id); grp.items.splice(i, 1); toast('تم حذف الحالة', 'ok'); onChange?.(); if (!grp.items.length) { groups.splice(g, 1); if (!groups.length) return close(); g = Math.min(g, groups.length - 1); } i = Math.min(i, (groups[g].items.length || 1) - 1); show(); } catch (er) { toast(er.message, 'err'); show(); }
          } }, icon('trash', 20)),
          h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: close }, icon('close', 22)))),
      h('div', { class: 'sv-stage' }, media),
      s.caption && h('div', { class: 'sv-caption' }, s.caption),
      h('div', { class: 'sv-tap l', onclick: next }), h('div', { class: 'sv-tap r', onclick: prev }));
  }
  show();
}
