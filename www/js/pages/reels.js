import { h, icon, avatar, clear, toast, compact, badge, verifiedBadge } from '../lib/dom.js';
import { sb, state, enrichPosts, POST_SELECT } from '../api.js';
import { openComments } from './postcard.js';
import { sharePostSheet, hiddenReels } from './share.js';

// Reels: vertical, full-height, snap-scrolling video feed (videos only). Used inside the Explore page.
export function reelsView(host) {
  const box = h('div', { class: 'reels' });
  host.append(box);
  let before = null, loading = false, done = false, stopped = false, muted = false, current = null;
  const PAGE = 8;

  function fit() { const tb = document.querySelector('.tabbar'); const top = box.getBoundingClientRect().top; box.style.height = Math.max(300, window.innerHeight - top - (tb ? tb.offsetHeight + 16 : 0)) + 'px'; }
  const onResize = () => fit(); window.addEventListener('resize', onResize); setTimeout(fit, 0); requestAnimationFrame(fit);

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const v = en.target.querySelector('video'); if (!v) return;
      if (en.isIntersecting && en.intersectionRatio >= 0.7) {
        if (current && current !== v) current.pause();
        current = v; v.muted = muted;
        v.play().catch(() => { v.muted = true; muted = true; syncMute(); v.play().catch(() => {}); });
        const reels = [...box.querySelectorAll('.reel')]; if (reels.indexOf(en.target) >= reels.length - 2) loadMore();
      } else { v.pause(); if (current === v) current = null; }
    });
  }, { root: box, threshold: [0, 0.7] });

  function syncMute() { box.querySelectorAll('video').forEach((v) => (v.muted = muted)); box.querySelectorAll('.reel-mute').forEach((b) => { clear(b).append(icon(muted ? 'micoff' : 'speaker', 20)); b.setAttribute('aria-label', muted ? 'تشغيل الصوت' : 'كتم الصوت'); }); }

  function reel(post) {
    const a = post.author;
    const v = h('video', { class: 'reel-video', src: post.media_url, loop: true, playsinline: true, preload: 'metadata' });
    const likeBtn = h('button', { class: 'reel-act', type: 'button' }), cBtn = h('button', { class: 'reel-act', type: 'button' }), sBtn = h('button', { class: 'reel-act', type: 'button' });
    const paint = () => {
      clear(likeBtn).append(icon('heart', 28), h('span', null, compact(post.nLikes))); likeBtn.classList.toggle('on', post.liked);
      clear(cBtn).append(icon('comment', 28), h('span', null, compact(post.nComments)));
      clear(sBtn).append(icon('share', 28), h('span', null, compact(post.nShares)));
    };
    likeBtn.onclick = async () => {
      const was = post.liked; post.liked = !was; post.nLikes += was ? -1 : 1; paint();
      try { if (was) await sb.from('likes').delete().eq('post_id', post.id).eq('user_id', state.me.id); else await sb.from('likes').insert({ post_id: post.id, user_id: state.me.id }); }
      catch (e) { post.liked = was; post.nLikes += was ? 1 : -1; paint(); toast(e.message, 'err'); }
    };
    cBtn.onclick = () => openComments(post, (d) => { post.nComments += d; paint(); });
    sBtn.onclick = () => sharePostSheet(post, { onShared: paint, onHidden: () => { el.remove(); io.unobserve(el); if (!box.querySelector('.reel')) loadMore(); } });
    const playIcon = h('div', { class: 'reel-pause', hidden: true }, icon('play', 54));
    const muteBtn = h('button', { class: 'reel-mute', type: 'button', onclick: (e) => { e.stopPropagation(); muted = !muted; syncMute(); } }, icon(muted ? 'micoff' : 'speaker', 20));
    const el = h('section', { class: 'reel' }, v, playIcon, muteBtn,
      h('div', { class: 'reel-side' }, likeBtn, cBtn, sBtn),
      h('div', { class: 'reel-info' },
        h('a', { class: 'reel-user', href: '#/u/' + a.username }, avatar(a, 38), h('b', null, a.display_name || a.username, badge(a.role), verifiedBadge(a.is_verified))),
        post.body ? h('div', { class: 'reel-cap' }, post.body) : null));
    el.addEventListener('click', (e) => { if (e.target.closest('button,a')) return; if (v.paused) { v.play().catch(() => {}); playIcon.hidden = true; } else { v.pause(); playIcon.hidden = false; } });
    v.addEventListener('play', () => (playIcon.hidden = true));
    v.addEventListener('error', () => { el.classList.add('bad'); });
    paint(); io.observe(el);
    return el;
  }

  async function loadMore() {
    if (loading || done || stopped) return; loading = true;
    try {
      let q = sb.from('posts').select(POST_SELECT).eq('media_type', 'video').order('created_at', { ascending: false }).limit(PAGE);
      if (before) q = q.lt('created_at', before);
      const rows = await enrichPosts(await q);
      const hid = hiddenReels();
      rows.filter((p) => p.media_url && !hid.has(p.id)).forEach((p) => box.append(reel(p)));
      if (rows.length) before = rows.at(-1).created_at;
      if (rows.length < PAGE) done = true;
      if (!box.children.length) box.append(h('div', { class: 'empty reels-empty' }, icon('video', 46), h('h3', null, 'لا توجد فيديوهات بعد'), h('p', null, 'انشر أول فيديو من زر + وسيظهر هنا.')));
    } catch (e) { if (!box.children.length) box.append(h('div', { class: 'empty' }, e.message)); }
    finally { loading = false; }
  }
  box.append(h('div', { class: 'skeleton post-sk' }));
  loadMore().then(() => box.querySelector('.skeleton')?.remove());

  return () => { stopped = true; io.disconnect(); window.removeEventListener('resize', onResize); box.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); box.remove(); };
}
