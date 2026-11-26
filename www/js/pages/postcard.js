import { sharePostSheet } from './share.js';
import { h, icon, avatar, toast, sheet, actionSheet, confirmBox, timeAgo, compact, badge, verifiedBadge, clear } from '../lib/dom.js';
import { sb, state, hasPerm, feature, POST_SELECT, PROFILE_MINI } from '../api.js';
import { arabicError } from '../lib/supabase-lite.js';

export function go(hash) { location.hash = hash; }

export function reportDialog(targetType, targetId) {
  sheet('إبلاغ', (body, close) => {
    const reasons = ['محتوى مسيء أو عنيف', 'رسائل مزعجة أو إعلانات', 'انتحال شخصية', 'معلومات كاذبة', 'سبب آخر'];
    let chosen = reasons[0];
    const note = h('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: 'تفاصيل إضافية (اختياري)' });
    const list = h('div', { class: 'chips col' }, reasons.map((r, i) => {
      const b = h('button', { class: 'chip' + (i === 0 ? ' on' : ''), onclick: () => { chosen = r; [...list.children].forEach((c) => c.classList.toggle('on', c === b)); } }, r);
      return b;
    }));
    body.append(list, note, h('button', { class: 'btn primary block', onclick: async () => {
      try {
        await sb.from('reports').insert({ reporter_id: state.me.id, target_type: targetType, target_id: targetId, reason: (chosen + (note.value ? ' — ' + note.value : '')).slice(0, 500) });
        toast('تم إرسال البلاغ، شكراً لك', 'ok'); close();
      } catch (e) { toast(e.message, 'err'); }
    } }, 'إرسال البلاغ'));
  });
}

export async function blockUser(profile) {
  if (!(await confirmBox(`حظر @${profile.username}؟ لن يستطيع رؤية منشوراتك أو مراسلتك.`, 'حظر', true))) return false;
  try { await sb.from('blocks').insert({ blocker_id: state.me.id, blocked_id: profile.id }); toast('تم حظر المستخدم', 'ok'); return true; }
  catch (e) { toast(e.message, 'err'); return false; }
}

// ---------------- comments ----------------
export async function renderComments(container, postId, onCount) {
  clear(container);
  const list = h('div', { class: 'comments' });
  const input = h('input', { class: 'input', placeholder: 'اكتب تعليقاً...', maxlength: 500 });
  const sendBtn = h('button', { class: 'icon-btn accent', 'aria-label': 'إرسال' }, icon('send', 20));
  async function load() {
    const rows = await sb.from('comments').select(`*,author:profiles!comments_author_id_fkey(${PROFILE_MINI})`).eq('post_id', postId).order('created_at', { ascending: true }).limit(200);
    clear(list);
    if (!rows.length) list.append(h('div', { class: 'empty small' }, 'لا توجد تعليقات بعد. كن أول من يعلّق!'));
    rows.forEach((c) => list.append(h('div', { class: 'comment' },
      h('a', { href: `#/u/${c.author.username}` }, avatar(c.author, 36)),
      h('div', { class: 'c-body' },
        h('div', { class: 'c-head' }, h('b', null, c.author.display_name || c.author.username), badge(c.author.role), verifiedBadge(c.author.is_verified), h('span', { class: 'muted' }, timeAgo(c.created_at))),
        h('div', { class: 'c-text' }, c.body)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'خيارات', onclick: () => actionSheet('التعليق', [
        c.author_id === state.me.id && { label: 'حذف تعليقي', icon: 'trash', danger: true, run: async () => { try { await sb.from('comments').delete().eq('id', c.id); await load(); onCount?.(-1); } catch (e) { toast(e.message, 'err'); } } },
        c.author_id !== state.me.id && { label: 'إبلاغ عن التعليق', icon: 'flag', run: () => reportDialog('comment', c.id) },
        c.author_id !== state.me.id && hasPerm('comments.delete') && { label: 'حذف (إشراف)', icon: 'shield', danger: true, run: async () => { try { await sb.rpc('admin_delete_comment', { target: c.id }); await load(); onCount?.(-1); toast('تم الحذف', 'ok'); } catch (e) { toast(e.message, 'err'); } } },
      ]) }, icon('more', 18)))));
  }
  async function send() {
    const body = input.value.trim(); if (!body) return;
    if (!feature('comments')) return toast('التعليقات متوقفة حالياً', 'err');
    sendBtn.disabled = true;
    try { await sb.from('comments').insert({ post_id: postId, author_id: state.me.id, body }); input.value = ''; await load(); onCount?.(1); list.scrollTop = list.scrollHeight; }
    catch (e) { toast(e.message, 'err'); } finally { sendBtn.disabled = false; }
  }
  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  container.append(list, h('div', { class: 'composer-row' }, avatar(state.me, 36), input, sendBtn));
  try { await load(); } catch (e) { list.append(h('div', { class: 'empty small' }, e.message)); }
}
export function openComments(post, onCount) { sheet('التعليقات', (body) => renderComments(body, post.id, onCount), { full: true }); }

// ---------------- post card ----------------
export function postCard(post, { onDeleted, detail = false } = {}) {
  const a = post.author;
  const likeBtn = h('button', { class: 'act' + (post.liked ? ' on like' : '') });
  const cBtn = h('button', { class: 'act' });
  const sBtn = h('button', { class: 'act' + (post.shared ? ' on share' : '') });
  const card = h('article', { class: 'post' });

  function paint() {
    clear(likeBtn).append(icon('heart', 22), h('span', null, compact(post.nLikes)));
    likeBtn.classList.toggle('on', post.liked); likeBtn.classList.toggle('like', post.liked);
    clear(cBtn).append(icon('comment', 22), h('span', null, compact(post.nComments)));
    clear(sBtn).append(icon('share', 22), h('span', null, compact(post.nShares)));
    sBtn.classList.toggle('on', post.shared);
  }
  likeBtn.onclick = async () => {
    const was = post.liked; post.liked = !was; post.nLikes += was ? -1 : 1; paint();
    try {
      if (was) await sb.from('likes').delete().eq('post_id', post.id).eq('user_id', state.me.id);
      else await sb.from('likes').insert({ post_id: post.id, user_id: state.me.id });
    } catch (e) { post.liked = was; post.nLikes += was ? 1 : -1; paint(); toast(e.message, 'err'); }
  };
  cBtn.onclick = () => detail ? document.getElementById('comment-input-anchor')?.scrollIntoView({ behavior: 'smooth' }) : openComments(post, (d) => { post.nComments += d; paint(); });
  sBtn.onclick = () => sharePostSheet(post, { onShared: paint });

  const menu = () => actionSheet('خيارات المنشور', [
    a.id === state.me.id && { label: 'حذف المنشور', icon: 'trash', danger: true, run: async () => {
      if (!(await confirmBox('حذف هذا المنشور نهائياً؟', 'حذف', true))) return;
      try { await sb.from('posts').delete().eq('id', post.id); card.remove(); onDeleted?.(post); toast('تم حذف المنشور', 'ok'); } catch (e) { toast(e.message, 'err'); }
    } },
    a.id !== state.me.id && { label: 'إبلاغ عن المنشور', icon: 'flag', run: () => reportDialog('post', post.id) },
    a.id !== state.me.id && { label: `حظر @${a.username}`, icon: 'block', danger: true, run: async () => { if (await blockUser(a)) { card.remove(); onDeleted?.(post); } } },
    a.id !== state.me.id && hasPerm('posts.delete') && { label: 'حذف (إشراف)', icon: 'shield', danger: true, run: async () => {
      if (!(await confirmBox('حذف المنشور المخالف؟', 'حذف', true))) return;
      try { await sb.rpc('admin_delete_post', { target: post.id }); card.remove(); onDeleted?.(post); toast('تم الحذف', 'ok'); } catch (e) { toast(e.message, 'err'); }
    } },
  ]);

  let media = null;
  if (post.media_url) {
    media = post.media_type === 'video'
      ? h('video', { class: 'p-media', src: post.media_url, controls: true, playsinline: true, preload: 'metadata' })
      : h('img', { class: 'p-media', src: post.media_url, loading: 'lazy', alt: '', onclick: () => viewImage(post.media_url) });
  }
  card.append(
    h('header', { class: 'p-head' },
      h('a', { href: `#/u/${a.username}`, class: 'p-user' }, avatar(a, 42),
        h('div', null, h('div', { class: 'p-name' }, a.display_name || a.username, badge(a.role), verifiedBadge(a.is_verified)), h('div', { class: 'muted small' }, `@${a.username} · ${timeAgo(post.created_at)}`))),
      h('button', { class: 'icon-btn', 'aria-label': 'خيارات', onclick: menu }, icon('more', 20))),
    post.body && h('div', { class: 'p-body', onclick: () => !detail && go(`#/post/${post.id}`) }, post.body),
    media,
    h('footer', { class: 'p-actions' }, likeBtn, cBtn, sBtn));
  paint();
  return card;
}

export function viewImage(src) {
  const o = h('div', { class: 'lightbox', onclick: () => o.remove() }, h('img', { src, alt: '' }));
  document.body.append(o);
}

export async function fetchPostById(id) {
  return sb.from('posts').select(POST_SELECT).eq('id', id).one();
}
