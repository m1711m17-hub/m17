import { h, icon, avatar, clear, toast, sheet, actionSheet, badge, verifiedBadge, compact } from '../lib/dom.js';
import { sb, state, enrichPosts, uploadMedia, POST_SELECT, PROFILE_MINI } from '../api.js';
import { postCard, blockUser, reportDialog, viewImage } from './postcard.js';
import { headerBar } from './home.js';
import { pending } from './quickcompose.js';
import { loadStoryGroups, openViewer } from './stories.js';
import { openExternal } from '../update.js';

export function followButton(p, { small = false, onChange } = {}) {
  const b = h('button', { class: 'btn sm' + (small ? '' : ' lg') });
  let following = null;
  const paint = () => { b.textContent = following ? 'إلغاء المتابعة' : 'متابعة'; b.className = 'btn ' + (following ? 'ghost' : 'primary') + (small ? ' sm' : ''); };
  b.textContent = '...'; b.disabled = true;
  sb.from('follows').select('follower_id').eq('follower_id', state.me.id).eq('following_id', p.id).one()
    .then((r) => { following = !!r; b.disabled = false; paint(); }).catch(() => { b.style.display = 'none'; });
  b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation(); b.disabled = true;
    try {
      if (following) await sb.from('follows').delete().eq('follower_id', state.me.id).eq('following_id', p.id);
      else await sb.from('follows').insert({ follower_id: state.me.id, following_id: p.id });
      following = !following; paint(); onChange?.(following);
    } catch (er) { toast(er.message, 'err'); } finally { b.disabled = false; }
  };
  return b;
}

async function userListSheet(title, profileId, which) {
  sheet(title, async (body) => {
    body.append(h('div', { class: 'skeleton row-sk' }));
    try {
      const col = which === 'followers' ? 'following_id' : 'follower_id', other = which === 'followers' ? 'follower_id' : 'following_id';
      const rows = await sb.from('follows').select(`${other},p:profiles!follows_${other}_fkey(${PROFILE_MINI})`).eq(col, profileId).order('created_at', { ascending: false }).limit(200);
      clear(body);
      if (!rows.length) body.append(h('div', { class: 'empty small' }, 'لا يوجد أحد بعد'));
      rows.forEach((r) => body.append(h('a', { class: 'user-row', href: `#/u/${r.p.username}`, onclick: () => document.querySelector('.sheet-back')?.remove() }, avatar(r.p, 42), h('div', { class: 'grow' }, h('b', null, r.p.display_name || r.p.username, verifiedBadge(r.p.is_verified)), h('div', { class: 'muted small' }, '@' + r.p.username)))));
    } catch (e) { clear(body).append(h('div', { class: 'empty small' }, e.message)); }
  }, { full: true });
}

const APK = 'https://github.com/m1711m17-hub/m17/releases/latest/download/NEXORA.apk';

// ---------- edit profile (full screen, field cards) ----------
export function editProfileSheet(onSaved) {
  sheet('تعديل الملف الشخصي', (body, close) => {
    let avatarUrl = state.me.avatar_url;
    const name = h('input', { class: 'pf-input', value: state.me.display_name, maxlength: 50, placeholder: 'الاسم' });
    const bio = h('textarea', { class: 'pf-input', rows: 4, maxlength: 200, placeholder: 'اكتب نبذة عنك' }, state.me.bio || '');
    const count = h('span', { class: 'pf-count' }, `${(state.me.bio || '').length}/200`);
    bio.addEventListener('input', () => { count.textContent = `${bio.value.length}/200`; });
    const preview = h('div', { class: 'edit-avatar' });
    const paintAv = () => clear(preview).append(avatar({ ...state.me, avatar_url: avatarUrl }, 96), h('span', { class: 'edit-cam' }, icon('camera', 16)));
    const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) return toast('اختر صورة فقط', 'err');
      try { preview.classList.add('busy'); avatarUrl = (await uploadMedia('avatars', f)).url; paintAv(); } catch (e) { toast(e.message, 'err'); } finally { preview.classList.remove('busy'); }
    } });
    preview.onclick = () => file.click(); paintAv();
    const field = (label, el, extra) => h('label', { class: 'pf-field' }, h('span', { class: 'pf-flabel' }, label), el, extra);
    body.append(
      h('div', { class: 'center pf-edit-top' }, preview, h('button', { class: 'pf-link', type: 'button', onclick: () => file.click() }, 'تعديل الصورة'), file),
      field('الاسم', name),
      field('اسم المستخدم', h('input', { class: 'pf-input', value: state.me.username, disabled: true, dir: 'ltr' })),
      field('النبذة', bio, count),
      h('button', { class: 'btn primary block lg', onclick: async (e) => {
        if (!name.value.trim()) return toast('الاسم مطلوب', 'err');
        e.target.disabled = true;
        try {
          await sb.from('profiles').update({ display_name: name.value.trim(), bio: bio.value.trim(), avatar_url: avatarUrl }).eq('id', state.me.id);
          Object.assign(state.me, { display_name: name.value.trim(), bio: bio.value.trim(), avatar_url: avatarUrl });
          toast('تم حفظ التعديلات', 'ok'); close(); onSaved?.();
        } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
      } }, 'حفظ'));
  }, { full: true });
}

// ---------- share profile ----------
function shareProfileSheet(p) {
  const text = `تابعني على NEXORA: ${p.display_name || p.username} (@${p.username})\n${APK}`;
  const enc = encodeURIComponent;
  sheet('مشاركة الملف الشخصي', (body, close) => {
    const app = (label, ic, cls, fn) => h('button', { class: 'share-item', type: 'button', onclick: () => { fn(); } }, h('span', { class: 'share-ic ' + cls }, ic), h('span', { class: 'share-name' }, label));
    const copy = async (t, ok) => { try { await navigator.clipboard.writeText(t); toast(ok, 'ok'); } catch { toast('تعذّر النسخ', 'err'); } };
    body.append(
      h('div', { class: 'pf-sharecard' }, avatar(p, 64, true), h('b', null, p.display_name || p.username), h('span', { class: 'muted', dir: 'ltr' }, '@' + p.username)),
      h('div', { class: 'share-row apps' },
        app('واتساب', icon('chat', 26), 'wa', () => openExternal('https://wa.me/?text=' + enc(text))),
        app('تيليجرام', icon('send', 26), 'tg', () => openExternal('https://t.me/share/url?url=' + enc(APK) + '&text=' + enc(text.split('\n')[0]))),
        app('فيسبوك', icon('share', 26), 'fb', () => openExternal('https://www.facebook.com/sharer/sharer.php?u=' + enc(APK))),
        app('رسالة SMS', icon('comment', 26), 'sms', () => { location.href = 'sms:?body=' + enc(text); }),
        app('البريد', icon('mail', 26), 'mail', () => { location.href = 'mailto:?subject=' + enc('NEXORA') + '&body=' + enc(text); }),
        app('نسخ الرابط', icon('link', 26), 'copy', () => copy(text, 'تم نسخ رابط الدعوة')),
        app('نسخ الاسم', icon('copy', 26), 'copy', () => copy('@' + p.username, 'تم نسخ اسم المستخدم')),
        app('المزيد', icon('more', 26), 'more', () => { if (navigator.share) navigator.share({ text }).catch(() => {}); else toast('المشاركة غير مدعومة على هذا الجهاز'); })),
      h('p', { class: 'muted small center' }, 'الرابط يحمّل التطبيق، ويجد صديقك حسابك بالبحث عن اسم المستخدم.'));
  });
}

// ---------- full-screen posts viewer (tap a tile) ----------
function postsViewer(rows, start, onDeleted) {
  const ov = h('div', { class: 'pv-overlay' });
  const close = () => { if (ov.isConnected) ov.remove(); window.removeEventListener('hashchange', close); };
  ov.addEventListener('m17:back', close); window.addEventListener('hashchange', close);
  const list = h('div', { class: 'pv-list' });
  rows.forEach((r, i) => { const c = postCard(r, { onDeleted: () => { c.remove(); onDeleted?.(r); if (!list.children.length) close(); } }); c.dataset.i = i; list.append(c); });
  ov.append(h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: close }, icon('back', 22)), h('div', { class: 'topbar-title' }, 'المنشورات')), list);
  document.body.append(ov);
  const t = list.querySelector(`[data-i="${start}"]`); if (t) list.scrollTop = Math.max(0, t.offsetTop - 4);
}

const TABS = [['all', 'grid', 'الكل'], ['video', 'video', 'الفيديو'], ['image', 'image', 'الصور'], ['text', 'text', 'النصوص']];
const kindOf = (r) => (r.media_url ? (r.media_type === 'video' ? 'video' : 'image') : 'text');
const GRADS = ['linear-gradient(135deg,#123a6b,#2f6bff)', 'linear-gradient(135deg,#3b1d63,#8b5cf6)', 'linear-gradient(135deg,#0f4c5c,#22e0ff)', 'linear-gradient(135deg,#5c1d3b,#ff4fa3)'];

function tile(r, onOpen) {
  const k = kindOf(r);
  const t = h('button', { class: 'pg-tile ' + k, type: 'button', onclick: onOpen, 'aria-label': 'فتح المنشور' });
  if (k === 'video') t.append(h('video', { src: r.media_url + '#t=0.1', preload: 'metadata', muted: true, playsinline: true, tabindex: -1 }));
  else if (k === 'image') t.append(h('img', { src: r.media_url, loading: 'lazy', alt: '' }));
  else t.append(h('div', { class: 'pg-text', style: { background: GRADS[[...r.id].reduce((a, c) => a + c.charCodeAt(0), 0) % GRADS.length] } }, (r.body || '').slice(0, 90)));
  if (k === 'video') t.append(h('span', { class: 'pg-badge' }, icon('play', 13)));
  t.append(h('span', { class: 'pg-likes' }, icon('heart', 12), compact(r.nLikes || 0)));
  return t;
}

export async function profilePage(root, params) {
  const uname = params.username || state.me.username;
  const isMe = uname === state.me.username;
  const box = h('div', { class: 'page pf-page' }, h('div', { class: 'skeleton post-sk' }));
  const refresh = () => { clear(root); profilePage(root, params); };

  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
  let asStory = false;
  fileIn.onchange = () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return toast('اختر صورة أو فيديو', 'err');
    pending.file = f; pending.story = asStory; location.hash = '#/compose' + (asStory ? '?story=1' : '');
  };
  const pick = (accept, story) => { asStory = story; fileIn.accept = accept; fileIn.click(); };

  const p = await sb.from('profiles').select('*').eq('username', uname).one();
  const topbar = (right, left) => h('header', { class: 'topbar pf-top' }, left, h('div', { class: 'topbar-title pf-user' }, isMe ? 'حسابي' : (p ? h('span', null, p.username, verifiedBadge(p.is_verified)) : '@' + uname)), h('div', { class: 'row' }, right));
  const back = h('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/home')) }, icon('back', 22));

  if (!p) { root.append(topbar([], isMe ? null : back), box); clear(box); return box.append(h('div', { class: 'empty' }, icon('user', 44), h('h3', null, 'المستخدم غير موجود'))); }

  async function verificationSheet() {
    sheet('توثيق الحساب', async (body, close) => {
      const reason = h('textarea', { class: 'input', rows: 3, maxlength: 500, placeholder: 'اكتب سبب طلب التوثيق (اختياري)' });
      const statusBox = h('div', { class: 'muted small' }, 'جارٍ تحميل حالة الطلب...');
      body.append(h('p', { class: 'muted small' }, 'يمكنك إرسال طلب واحد قيد المراجعة. المالك وحده يقرر قبول الطلب أو رفضه.'), statusBox);
      let pendingReq = false;
      try {
        const rows = await sb.rpc('my_verification_request');
        const latest = Array.isArray(rows) ? rows[0] : rows;
        if (latest) {
          statusBox.textContent = ({ pending: 'طلبك قيد مراجعة المالك', approved: 'تمت الموافقة على توثيق حسابك', rejected: 'تم رفض طلب التوثيق' })[latest.status] || 'لا يوجد طلب';
          pendingReq = latest.status === 'pending';
        } else statusBox.textContent = 'لم ترسل طلب توثيق بعد';
      } catch (e) { statusBox.textContent = 'تعذّر جلب حالة الطلب. تأكد من تفعيل ميزة التوثيق في قاعدة البيانات.'; }
      if (p.is_verified) { statusBox.textContent = 'حسابك موثّق بالفعل'; return; }
      if (pendingReq) return;
      body.append(reason, h('button', { class: 'btn primary block lg', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const result = await sb.rpc('request_verification', { p_reason: reason.value.trim() });
          if (!result?.ok) { toast(result?.message || 'تعذّر إرسال الطلب', 'err'); e.currentTarget.disabled = false; return; }
          toast('تم إرسال طلب التوثيق للمالك', 'ok'); close();
        } catch (er) { toast(er.message, 'err'); e.currentTarget.disabled = false; }
      } }, 'إرسال طلب التوثيق'));
    });
  }

  const settingsMenu = h('button', { class: 'icon-btn', 'aria-label': 'الإعدادات', onclick: () => actionSheet('حسابي', [
    { label: 'الإعدادات', icon: 'settings', run: () => (location.hash = '#/settings') },
    state.perms.length ? { label: 'الإدارة', icon: 'shield', run: () => (location.hash = '#/admin') } : null,
    !p.is_verified ? { label: 'طلب توثيق الحساب', icon: 'check', run: verificationSheet } : null,
    { label: 'مشاركة الملف الشخصي', icon: 'share', run: () => shareProfileSheet(p) },
  ]) }, icon('settings', 24));
  const more = h('button', { class: 'icon-btn', 'aria-label': 'المزيد', onclick: () => actionSheet('@' + p.username, [
    { label: 'إبلاغ عن الحساب', icon: 'flag', run: () => reportDialog('user', p.id) },
    { label: 'حظر المستخدم', icon: 'block', danger: true, run: async () => { if (await blockUser(p)) location.hash = '#/home'; } },
  ]) }, icon('more', 22));

  root.append(isMe ? topbar(settingsMenu, null) : topbar(more, back), box, fileIn);
  clear(box);

  const [nPosts, nFollowers, nFollowing] = await Promise.all([
    sb.from('posts').select('id').eq('author_id', p.id).count().catch(() => 0),
    sb.from('follows').select('follower_id').eq('following_id', p.id).count().catch(() => 0),
    sb.from('follows').select('following_id').eq('follower_id', p.id).count().catch(() => 0),
  ]);
  let amFollowing = false;
  if (!isMe) amFollowing = !!(await sb.from('follows').select('follower_id').eq('follower_id', state.me.id).eq('following_id', p.id).one().catch(() => null));

  let groups = [];
  try { groups = await loadStoryGroups(isMe ? [] : [p.id]); } catch { groups = []; }
  const gi = groups.findIndex((g) => g.author.id === p.id);
  const hasStory = gi >= 0;
  const openStory = () => openViewer(groups, gi, refresh);

  const stat = (n, label, fn) => h('button', { class: 'pf-stat', type: 'button', onclick: fn }, h('b', null, compact(n)), h('span', null, label));
  const av = h('div', { class: 'pf-av pf-av-hero' },
    h('button', { class: 'pf-av-btn' + (hasStory ? (groups[gi].allViewed ? ' seen' : ' story') : ''), type: 'button', 'aria-label': 'الصورة الشخصية',
      onclick: () => (hasStory ? openStory() : (p.avatar_url ? viewImage(p.avatar_url) : null)) }, avatar(p, 96)),
    p.is_verified ? h('span', { class: 'pf-av-ver', title: 'حساب موثّق بموافقة المالك', 'aria-label': 'حساب موثّق' }, '✓')
      : (isMe ? h('button', { class: 'pf-av-plus', type: 'button', 'aria-label': 'إضافة حالة', onclick: () => pick('image/*,video/*', true) }, icon('plus', 14)) : null));

  const insights = isMe ? h('div', { class: 'pf-insights' }, h('b', null, 'لوحة المعلومات الخاصة بك'), h('span', { class: 'muted small' }, 'جارٍ الحساب...')) : null;
  const profileActions = isMe
    ? h('div', { class: 'pf-actions pf-hero-actions' },
        h('button', { class: 'pf-btn pf-edit', onclick: () => editProfileSheet(refresh) }, icon('edit', 19), 'تعديل الملف'),
        state.perms.length ? h('button', { class: 'pf-btn pf-manage', onclick: () => (location.hash = '#/admin') }, icon('shield', 20), 'الإدارة') : null)
    : h('div', { class: 'pf-actions pf-hero-actions' },
        followButton(p, { onChange: (f) => { amFollowing = f; } }),
        h('a', { class: 'pf-btn pf-message', href: `#/chat/${p.username}` }, icon('chat', 18), 'مراسلة'),
        h('button', { class: 'pf-btn pf-share', onclick: () => shareProfileSheet(p) }, icon('share', 18), 'مشاركة'));

  const profileCard = h('section', { class: 'pf-profile-card' },
    h('div', { class: 'pf-cover' }),
    h('div', { class: 'pf-card-content' },
      h('div', { class: 'pf-head' }, av),
      h('div', { class: 'pf-bio pf-hero-bio' },
        h('div', { class: 'pf-name-line' }, p.role === 'OWNER' ? icon('crown', 22) : null, h('b', null, p.display_name || p.username)),
        p.role && p.role !== 'USER' ? h('div', { class: 'pf-role-line' }, badge(p.role)) : null,
        h('div', { class: 'muted small pf-username', dir: 'ltr' }, '@' + p.username + (p.is_private ? ' · 🔒 حساب خاص' : '')),
        p.bio && h('p', { class: 'bio pf-bio-text' }, p.bio)),
      h('div', { class: 'pf-divider' }),
      h('div', { class: 'pf-stats pf-hero-stats' },
        stat(nPosts, 'منشور', () => document.querySelector('.pf-tabs')?.scrollIntoView({ behavior: 'smooth' })),
        stat(nFollowers, 'متابع', () => userListSheet('المتابِعون', p.id, 'followers')),
        stat(nFollowing, 'يتابع', () => userListSheet('يتابع', p.id, 'following'))),
      profileActions));

  box.append(profileCard);
  if (isMe) box.append(h('div', { class: 'pf-quick-actions' },
    h('button', { class: 'pf-quick', type: 'button', onclick: () => (location.hash = '#/compose') }, icon('edit', 19), 'نص'),
    h('button', { class: 'pf-quick', type: 'button', onclick: () => pick('image/*,video/*', true) }, icon('plus', 21), 'حالة'),
    h('button', { class: 'pf-quick', type: 'button', onclick: () => pick('video/*', false) }, icon('video', 19), 'فيديو'),
    h('button', { class: 'pf-quick', type: 'button', onclick: () => pick('image/*', false) }, icon('image', 19), 'صورة')));
  if (hasStory || isMe) {
    const row = h('div', { class: 'pf-stories' });
    if (hasStory) row.append(h('button', { class: 'pf-circle', type: 'button', onclick: openStory }, h('span', { class: 'pf-ring' + (groups[gi].allViewed ? ' seen' : '') }, avatar(p, 62)), h('span', null, isMe ? 'حالتي' : 'الحالة')));
    if (isMe) row.append(h('button', { class: 'pf-circle', type: 'button', onclick: () => pick('image/*,video/*', true) }, h('span', { class: 'pf-ring new' }, icon('plus', 30)), h('span', null, 'جديد')));
    box.append(row);
  }

  if (insights) box.append(insights);

  const tabs = h('div', { class: 'pf-tabs' });
  const grid = h('div', { class: 'pg-grid' });
  box.append(tabs, grid);
  let rows = [], cur = 'all';
  const paintGrid = () => {
    clear(grid);
    const list = rows.filter((r) => cur === 'all' || kindOf(r) === cur);
    if (!list.length) return grid.append(h('div', { class: 'empty small pg-empty' }, p.is_private && !isMe && !amFollowing ? h('span', null, icon('lock', 30), h('br'), 'هذا الحساب خاص. تابعه لرؤية منشوراته.') : 'لا يوجد شيء هنا بعد'));
    const nonVideo = list.filter((x) => kindOf(x) !== 'video');
    list.forEach((r) => grid.append(tile(r, () => {
      if (kindOf(r) === 'video') { location.hash = '#/post/' + r.id; return; }
      postsViewer(nonVideo, nonVideo.indexOf(r), (d) => { rows = rows.filter((x) => x.id !== d.id); paintGrid(); });
    })));
  };
  const paintTabs = () => { clear(tabs); TABS.forEach(([k, ic, label]) => tabs.append(h('button', { class: 'pf-tab' + (k === cur ? ' on' : ''), type: 'button', 'aria-label': label, onclick: () => { cur = k; paintTabs(); paintGrid(); } }, icon(ic, 24)))); };
  paintTabs();
  grid.append(h('div', { class: 'skeleton post-sk' }));
  try {
    rows = await enrichPosts(await sb.from('posts').select(POST_SELECT).eq('author_id', p.id).order('created_at', { ascending: false }).limit(60));
    paintGrid();
    if (insights) {
      const likes = rows.reduce((a, r) => a + (r.nLikes || 0), 0), comments = rows.reduce((a, r) => a + (r.nComments || 0), 0), shares = rows.reduce((a, r) => a + (r.nShares || 0), 0);
      insights.lastChild.textContent = `${compact(likes)} إعجاب · ${compact(comments)} تعليق · ${compact(shares)} مشاركة على منشوراتك`;
    }
  } catch (e) { clear(grid).append(h('div', { class: 'empty small' }, e.message)); }
}
