import { h, icon, avatar, timeAgo, confirmBox, toast, clear } from '../lib/dom.js';
import { sb, state, PROFILE_MINI, rt } from '../api.js';

export const STORY_BGS = {
  g1: 'linear-gradient(135deg,#22e0ff,#2f6bff 50%,#8b5cf6)', g2: 'linear-gradient(135deg,#ff4fa3,#ffb340)', g3: 'linear-gradient(135deg,#8b5cf6,#ff4fa3)',
  g4: 'linear-gradient(135deg,#2fe3a3,#22e0ff)', g5: 'linear-gradient(135deg,#ffb340,#ff4d6d)', g6: 'linear-gradient(160deg,#0a1226,#2f6bff)',
};
export const bgCss = (k) => STORY_BGS[k] || STORY_BGS.g1;
export const VIS_LABEL = { everyone: 'الجميع', followers: 'المتابعون', custom: 'أشخاص محددون' };

// groups: [{author, items:[story], allViewed}]
export async function loadStoryGroups(followIds) {
  const me = state.me.id;
  const rows = await sb.from('stories').select(`*,author:profiles!stories_author_id_fkey(${PROFILE_MINI})`).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true }).limit(300);
  const allowed = new Set([...followIds, me]);
  const list = rows.filter((s) => allowed.has(s.author_id));
  const ids = list.map((s) => s.id);
  let viewed = new Set(), liked = new Set();
  if (ids.length) {
    const [v, l] = await Promise.all([
      sb.from('story_views').select('story_id').eq('viewer_id', me).in('story_id', ids),
      sb.from('story_likes').select('story_id').eq('user_id', me).in('story_id', ids),
    ]);
    viewed = new Set(v.map((x) => x.story_id)); liked = new Set(l.map((x) => x.story_id));
  }
  const map = new Map();
  for (const s of list) {
    s.viewed = s.author_id === me || viewed.has(s.id); s.liked = liked.has(s.id);
    if (!map.has(s.author_id)) map.set(s.author_id, { author: s.author, items: [] });
    map.get(s.author_id).items.push(s);
  }
  const groups = [...map.values()];
  for (const g of groups) g.allViewed = g.items.every((s) => s.viewed);
  const last = (g) => new Date(g.items.at(-1).created_at);
  groups.sort((a, b) => (a.author.id === me ? -1 : b.author.id === me ? 1 : (a.allViewed - b.allViewed) || (last(b) - last(a))));
  return groups;
}

export function storyBar(groups, onChange) {
  const bar = h('div', { class: 'stories-bar' });
  const mine = groups.find((g) => g.author.id === state.me.id);
  bar.append(h('div', { class: 'story-item' },
    h('button', { class: 'story-ring-btn', 'aria-label': 'حالتي', onclick: () => (mine ? openViewer(groups, groups.indexOf(mine), onChange) : (location.hash = '#/compose?story=1')) },
      h('div', { class: 'story-ring' + (mine ? '' : ' none') }, avatar(state.me, 58))),
    mine && h('button', { class: 'story-plus', 'aria-label': 'إضافة حالة', onclick: () => (location.hash = '#/compose?story=1') }, icon('plus', 14)),
    !mine && h('span', { class: 'story-plus', style: { pointerEvents: 'none' } }, icon('plus', 14)),
    h('span', null, 'حالتي')));
  groups.forEach((g, i) => {
    if (g.author.id === state.me.id) return;
    bar.append(h('button', { class: 'story-item', onclick: () => openViewer(groups, i, onChange) },
      h('div', { class: 'story-ring' + (g.allViewed ? ' seen' : '') }, avatar(g.author, 58)), h('span', null, g.author.display_name || g.author.username)));
  });
  return bar;
}

export function openViewer(groups, gi, onChange) {
  const me = state.me.id;
  let g = gi, i = Math.max(0, groups[gi].items.findIndex((s) => !s.viewed && s.author_id !== me)), closed = false, anim = null, held = false, panelOpen = false, typing = false;
  let media = null, audio = null, ch = null, poller = null, refreshPanel = null;
  const root = h('div', { class: 'story-view' });
  document.body.append(root);
  document.addEventListener('keydown', key);
  root.addEventListener('m17:back', () => (panelOpen ? closePanel() : close()));

  function key(e) { if (e.key === 'Escape') (panelOpen ? closePanel() : close()); }
  function teardown() { anim?.cancel(); anim = null; try { ch?.unsubscribe(); } catch {} ch = null; clearInterval(poller); poller = null; if (audio) { audio.pause(); audio = null; } media = null; refreshPanel = null; }
  function close() { if (closed) return; closed = true; teardown(); root.remove(); document.removeEventListener('keydown', key); onChange?.(); }
  function next() { const grp = groups[g]; if (i < grp.items.length - 1) { i++; show(); } else if (g < groups.length - 1) { g++; i = 0; show(); } else close(); }
  function prev() { if (i > 0) { i--; show(); } else if (g > 0) { g--; i = 0; show(); } else show(); }
  const nextGroup = () => { if (g < groups.length - 1) { g++; i = 0; show(); } else close(); };
  const prevGroup = () => { if (g > 0) { g--; i = 0; show(); } };
  function pause() { anim?.pause(); media?.pause?.(); audio?.pause(); }
  function resume() { if (held || panelOpen || typing) return; anim?.play(); media?.play?.().catch(() => {}); audio?.play().catch(() => {}); }

  const panel = h('div', { class: 'sv-panel', hidden: true });
  function closePanel() { panel.hidden = true; panelOpen = false; refreshPanel = null; resume(); }

  async function peopleOf(table, sid) {
    const rows = await sb.from(table).select(table === 'story_views' ? 'viewer_id,created_at' : 'user_id,created_at').eq('story_id', sid).order('created_at', { ascending: false }).limit(300);
    const ids = rows.map((r) => r.viewer_id || r.user_id);
    const profs = ids.length ? await sb.from('profiles').select(PROFILE_MINI).in('id', ids) : [];
    const pm = new Map(profs.map((p) => [p.id, p]));
    return rows.map((r) => ({ p: pm.get(r.viewer_id || r.user_id), at: r.created_at })).filter((x) => x.p);
  }
  function openPanel(s, tab = 'views') {
    panelOpen = true; pause(); panel.hidden = false;
    const draw = async () => {
      let views = [], likes = [];
      try { [views, likes] = await Promise.all([peopleOf('story_views', s.id), peopleOf('story_likes', s.id)]); } catch (e) { toast(e.message, 'err'); }
      if (panel.hidden) return;
      const likedIds = new Set(likes.map((x) => x.p.id));
      const list = tab === 'views' ? views : likes;
      const row = (x) => h('button', { class: 'user-row', onclick: () => { const u = x.p.username; close(); location.hash = '#/u/' + u; } }, avatar(x.p, 42),
        h('div', { class: 'grow' }, h('b', null, x.p.display_name || x.p.username), h('div', { class: 'muted small' }, '@' + x.p.username + ' · ' + timeAgo(x.at))), likedIds.has(x.p.id) ? h('span', { class: 'liked-heart' }, icon('heart', 18)) : null);
      clear(panel).append(
        h('div', { class: 'sv-panel-head' }, h('div', { class: 'seg' },
          h('button', { class: 'seg-btn' + (tab === 'views' ? ' on' : ''), onclick: () => { tab = 'views'; draw(); } }, `المشاهدات (${views.length})`),
          h('button', { class: 'seg-btn' + (tab === 'likes' ? ' on' : ''), onclick: () => { tab = 'likes'; draw(); } }, `الإعجابات (${likes.length})`)),
          h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: closePanel }, icon('close', 20))),
        h('div', { class: 'sv-panel-body' }, list.length ? list.map(row) : h('div', { class: 'empty small' }, tab === 'views' ? 'لا توجد مشاهدات بعد' : 'لا توجد إعجابات بعد')));
    };
    refreshPanel = draw; draw();
  }

  function show() {
    if (closed) return;
    teardown(); held = false; typing = false; panelOpen = false; panel.hidden = true;
    const grp = groups[g], s = grp.items[i], mine = grp.author.id === me;
    clear(root);
    const bars = h('div', { class: 'sv-bars' }, grp.items.map((_, k) => h('div', { class: 'sv-bar' }, h('i', { class: k < i ? 'done' : '' }))));
    const fill = bars.children[i].firstChild;
    const begin = (ms) => { if (closed || !fill.isConnected) return; anim = fill.animate([{ width: '0%' }, { width: '100%' }], { duration: ms, easing: 'linear', fill: 'forwards' }); anim.onfinish = () => { if (anim && !held && !panelOpen) next(); }; if (held || panelOpen || typing) anim.pause(); };

    let stage;
    if (s.kind === 'text') {
      stage = h('div', { class: 'sv-text', style: { background: bgCss(s.bg) } }, h('div', null, s.text_content));
      setTimeout(() => begin(Math.min(10000, 4500 + (s.text_content || '').length * 60)), 0); // after the DOM is attached
    } else if (s.media_type === 'video') {
      media = h('video', { src: s.media_url, autoplay: true, playsinline: true });
      media.onloadedmetadata = () => begin(Math.min(30000, (media.duration || 8) * 1000));
      media.onerror = () => begin(3000);
      stage = h('div', { class: 'sv-stage' }, media, s.overlay_text && h('div', { class: 'sv-overlay' }, s.overlay_text));
    } else {
      const img = h('img', { src: s.media_url, alt: '' }); img.onload = () => begin(5000); img.onerror = () => begin(3000);
      stage = h('div', { class: 'sv-stage' }, img, s.overlay_text && h('div', { class: 'sv-overlay' }, s.overlay_text));
    }
    if (s.music_url) { audio = new Audio(s.music_url); audio.loop = true; audio.play().catch(() => {}); }

    // register the view once (own stories never count; duplicates ignored by the DB)
    if (!mine && !s.viewed) { s.viewed = true; sb.from('story_views').upsert({ story_id: s.id, viewer_id: me }, 'story_id,viewer_id', true).catch(() => {}); }

    // ---- gestures: tap = next/prev, hold = pause, swipe sideways = other person, swipe down = close, swipe up (owner) = viewers
    const touch = h('div', { class: 'sv-touch' });
    let sx = 0, sy = 0, st = 0, holdT = null, moved = false;
    touch.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false; clearTimeout(holdT); holdT = setTimeout(() => { held = true; pause(); }, 220); });
    touch.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) moved = true; });
    const end = (e) => {
      clearTimeout(holdT); const dx = e.clientX - sx, dy = e.clientY - sy; const wasHeld = held; held = false;
      if (e.type === 'pointercancel') return resume();
      if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) { if (dy > 0) return close(); if (mine) return openPanel(s); return resume(); }
      if (Math.abs(dx) > 70) return dx < 0 ? nextGroup() : prevGroup();
      if (wasHeld || moved) return resume();
      const w = touch.getBoundingClientRect().width; (e.clientX - touch.getBoundingClientRect().left) < w / 2 ? next() : prev();
    };
    touch.addEventListener('pointerup', end); touch.addEventListener('pointercancel', end);

    // ---- footer
    let footer;
    if (mine) {
      const viewsBtn = h('button', { class: 'sv-stat', onclick: () => openPanel(s, 'views') }, icon('eye', 18), h('b', null, '0'));
      const likesBtn = h('button', { class: 'sv-stat', onclick: () => openPanel(s, 'likes') }, icon('heart', 18), h('b', null, '0'));
      const refresh = async () => { try { const r = await sb.rpc('story_stats', { sid: s.id }); viewsBtn.lastChild.textContent = r?.views ?? 0; likesBtn.lastChild.textContent = r?.likes ?? 0; } catch {} refreshPanel?.(); };
      refresh(); poller = setInterval(refresh, 8000);
      if (rt) ch = rt.channel('sv-' + s.id, { pg: [{ event: 'INSERT', table: 'story_views', filter: 'story_id=eq.' + s.id }, { event: 'INSERT', table: 'story_likes', filter: 'story_id=eq.' + s.id }] })
        .onPg('INSERT', 'story_views', refresh).onPg('INSERT', 'story_likes', refresh).subscribe();
      footer = h('div', { class: 'sv-footer mine' }, viewsBtn, likesBtn, h('span', { class: 'sv-vis' }, icon('lock', 14), VIS_LABEL[s.visibility] || 'الجميع'),
        h('button', { class: 'sv-stat danger', 'aria-label': 'حذف', onclick: async () => {
          pause(); if (!(await confirmBox('حذف هذه الحالة؟', 'حذف', true))) { resume(); return; }
          try {
            await sb.from('stories').delete().eq('id', s.id); toast('تم حذف الحالة', 'ok');
            grp.items.splice(i, 1);
            if (!grp.items.length) { groups.splice(g, 1); return close(); } i = Math.min(i, grp.items.length - 1);
            onChange?.(); show();
          } catch (e) { toast(e.message, 'err'); resume(); }
        } }, icon('trash', 18)));
    } else {
      const input = h('input', { class: 'sv-reply', placeholder: 'أرسل رداً...', maxlength: 500 });
      const heart = h('button', { class: 'sv-heart' + (s.liked ? ' on' : ''), 'aria-label': 'إعجاب', onclick: async () => {
        const was = s.liked; s.liked = !was; heart.classList.toggle('on', s.liked);
        try { if (was) await sb.from('story_likes').delete().eq('story_id', s.id).eq('user_id', me); else await sb.from('story_likes').insert({ story_id: s.id, user_id: me }); }
        catch (e) { s.liked = was; heart.classList.toggle('on', was); toast(e.message, 'err'); }
      } }, icon('heart', 26));
      const reply = async (text) => {
        text = (text || '').trim(); if (!text) return;
        try {
          await sb.from('messages').insert({ sender_id: me, receiver_id: grp.author.id, body: text, story_id: s.id, story_preview: s.media_type === 'image' ? s.media_url : null });
          input.value = ''; input.blur(); toast('تم إرسال ردك', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
      input.addEventListener('focus', () => { typing = true; pause(); });
      input.addEventListener('blur', () => { typing = false; resume(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reply(input.value); } });
      const send = h('button', { class: 'sv-send', 'aria-label': 'إرسال', onpointerdown: (e) => e.preventDefault(), onclick: () => reply(input.value) }, icon('send', 20));
      footer = h('div', { class: 'sv-footer' },
        h('div', { class: 'sv-emojis' }, ['❤️', '🔥', '😂', '😮', '😢', '👏'].map((em) => h('button', { onclick: () => reply(em) }, em))),
        h('div', { class: 'sv-replyrow' }, input, send, heart));
    }

    root.append(bars,
      h('div', { class: 'sv-head' },
        h('button', { class: 'row gap sv-user', onclick: () => { const u = grp.author.username; close(); location.hash = '#/u/' + u; } }, avatar(grp.author, 36), h('b', null, grp.author.display_name || grp.author.username), h('span', { class: 'muted small' }, timeAgo(s.created_at))),
        h('div', { class: 'row' }, s.music_url && h('span', { class: 'sv-music' }, icon('music', 14), h('span', { class: 'ellipsis' }, s.music_title || 'موسيقى')),
          h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: close }, icon('close', 22)))),
      stage, s.caption && h('div', { class: 'sv-caption' }, s.caption), touch, footer, panel);
  }
  show();
}
