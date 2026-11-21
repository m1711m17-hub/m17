import { h, icon, clear } from '../lib/dom.js';
import { enrichPosts } from '../api.js';
import { postCard, renderComments, fetchPostById } from './postcard.js';
import { headerBar } from './home.js';

export async function postPage(root, params) {
  const box = h('div', { class: 'page' }, h('div', { class: 'skeleton post-sk' }));
  root.append(headerBar('المنشور', { back: true }), box);
  const p = await fetchPostById(params.id);
  clear(box);
  if (!p) return box.append(h('div', { class: 'empty' }, icon('eye', 44), h('h3', null, 'المنشور غير متاح'), h('p', null, 'ربما حُذف أو لا يمكنك رؤيته.')));
  await enrichPosts([p]);
  const cm = h('div', { id: 'comment-input-anchor' });
  box.append(postCard(p, { detail: true, onDeleted: () => (location.hash = '#/home') }), h('h3', { class: 'sec' }, 'التعليقات'), cm);
  await renderComments(cm, p.id);
}
