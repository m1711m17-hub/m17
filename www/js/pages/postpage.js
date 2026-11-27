import { h, icon, avatar, clear } from '../lib/dom.js';
import { enrichPosts } from '../api.js';
import { postCard, fetchPostById } from './postcard.js';

export async function postPage(root, params) {
  const box = h('div', { class: 'page video-detail-page' }, h('div', { class: 'skeleton post-sk' }));
  root.append(box);
  const p = await fetchPostById(params.id);
  clear(box);
  if (!p) return box.append(h('div', { class: 'empty' }, icon('eye', 44), h('h3', null, 'المنشور غير متاح'), h('p', null, 'ربما حُذف أو لا يمكنك رؤيته.')));
  await enrichPosts([p]);

  if (p.media_type === 'video' && p.media_url) {
    document.body.classList.add('video-post-open');
    const card = postCard(p);
    card.classList.add('video-post-card');
    const video = card.querySelector('video');
    if (video) {
      video.controls = false;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.play().catch(() => {});
    }
    const sound = h('button', { class: 'video-sound-btn', 'aria-label': 'تشغيل الصوت', onclick: () => {
      if (!video) return;
      video.muted = !video.muted;
      sound.innerHTML = '';
      sound.append(icon(video.muted ? 'micoff' : 'speaker', 21));
    } }, icon('micoff', 21));
    const back = h('button', { class: 'video-back-btn', 'aria-label': 'رجوع', onclick: () => history.length > 1 ? history.back() : (location.hash = '#/home') }, icon('back', 23));
    const user = h('a', { class: 'video-author', href: '#/u/' + p.author.username }, avatar(p.author, 38), h('span', null, '@' + p.author.username));
    const caption = h('div', { class: 'video-caption' }, p.body || '');
    const meta = h('div', { class: 'video-bottom-meta' }, user, caption);
    const tap = h('button', { class: 'video-play-toggle', 'aria-label': 'إيقاف الفيديو', onclick: () => {
      if (!video) return;
      if (video.paused) { video.play(); tap.innerHTML = ''; tap.append(icon('pause', 28)); }
      else { video.pause(); tap.innerHTML = ''; tap.append(icon('play', 28)); }
    } }, icon('pause', 28));
    card.append(back, sound, tap, meta);
    box.append(card);
    return () => { document.body.classList.remove('video-post-open'); try { video?.pause(); } catch {} };
  }

  box.append(postCard(p, { detail: true, onDeleted: () => (location.hash = '#/home') }));
  const cm = h('div', { id: 'comment-input-anchor' });
  box.append(h('h3', { class: 'sec' }, 'التعليقات'), cm);
  const { renderComments } = await import('./postcard.js');
  await renderComments(cm, p.id);
}
