import { h, icon, avatar, clear, toast, sheet, actionSheet, confirmBox, badge, verifiedBadge, compact } from '../lib/dom.js';
import { sb, state, enrichPosts, uploadMedia, POST_SELECT, PROFILE_MINI } from '../api.js';
import { postCard, blockUser, reportDialog } from './postcard.js';
import { headerBar } from './home.js';
import { quickComposer } from './quickcompose.js';

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

export function editProfileSheet(onSaved) {
  sheet('تعديل الملف الشخصي', (body, close) => {
    let avatarUrl = state.me.avatar_url;
    const name = h('input', { class: 'input', value: state.me.display_name, maxlength: 50, placeholder: 'الاسم' });
    const bio = h('textarea', { class: 'input', rows: 3, maxlength: 200, placeholder: 'نبذة عنك' }, state.me.bio || '');
    const preview = h('div', { class: 'edit-avatar' });
    const paintAv = () => clear(preview).append(avatar({ ...state.me, avatar_url: avatarUrl }, 96), h('span', { class: 'edit-cam' }, icon('camera', 16)));
    const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) return toast('اختر صورة فقط', 'err');
      try { preview.classList.add('busy'); avatarUrl = (await uploadMedia('avatars', f)).url; paintAv(); } catch (e) { toast(e.message, 'err'); } finally { preview.classList.remove('busy'); }
    } });
    preview.onclick = () => file.click(); paintAv();
    body.append(h('div', { class: 'center' }, preview, file),
      h('label', { class: 'lbl' }, 'اسم المستخدم'), h('input', { class: 'input', value: '@' + state.me.username, disabled: true, dir: 'ltr' }),
      h('label', { class: 'lbl' }, 'الاسم الظاهر'), name, h('label', { class: 'lbl' }, 'النبذة'), bio,
      h('button', { class: 'btn primary block lg', onclick: async (e) => {
        if (!name.value.trim()) return toast('الاسم مطلوب', 'err');
        e.target.disabled = true;
        try {
          await sb.from('profiles').update({ display_name: name.value.trim(), bio: bio.value.trim(), avatar_url: avatarUrl }).eq('id', state.me.id);
          Object.assign(state.me, { display_name: name.value.trim(), bio: bio.value.trim(), avatar_url: avatarUrl });
          toast('تم حفظ التعديلات', 'ok'); close(); onSaved?.();
        } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
      } }, 'حفظ'));
  });
}

export async function profilePage(root, params) {
  const uname = params.username || state.me.username;
  const isMe = uname === state.me.username;
  const box = h('div', { class: 'page' }, h('div', { class: 'skeleton post-sk' }));
  root.append(headerBar(isMe ? 'حسابي' : '@' + uname, { back: !isMe, right: isMe ? [h('button', { class: 'icon-btn', 'aria-label': 'الإعدادات', onclick: () => (location.hash = '#/settings') }, icon('settings', 23))] : [] }), box);

  const p = await sb.from('profiles').select('*').eq('username', uname).one();
  clear(box);
  if (!p) return box.append(h('div', { class: 'empty' }, icon('user', 44), h('h3', null, 'المستخدم غير موجود')));
  const [nPosts, nFollowers, nFollowing] = await Promise.all([
    sb.from('posts').select('id').eq('author_id', p.id).count().catch(() => 0),
    sb.from('follows').select('follower_id').eq('following_id', p.id).count().catch(() => 0),
    sb.from('follows').select('following_id').eq('follower_id', p.id).count().catch(() => 0),
  ]);
  let amFollowing = false;
  if (!isMe) amFollowing = !!(await sb.from('follows').select('follower_id').eq('follower_id', state.me.id).eq('following_id', p.id).one().catch(() => null));

  const stat = (n, label, fn) => h('button', { class: 'stat', onclick: fn }, h('b', null, compact(n)), h('span', null, label));
  const actions = isMe
    ? h('div', { class: 'row gap' }, h('button', { class: 'btn ghost grow', onclick: () => editProfileSheet(() => { clear(root); profilePage(root, params); }) }, icon('edit', 18), 'تعديل الملف'), state.perms.length ? h('a', { class: 'btn ghost', href: '#/admin' }, icon('shield', 18), 'الإدارة') : null)
    : h('div', { class: 'row gap' }, h('div', { class: 'grow' }, followButton(p, { onChange: (f) => { amFollowing = f; } })), h('a', { class: 'btn ghost', href: `#/chat/${p.username}` }, icon('chat', 18), 'مراسلة'),
      h('button', { class: 'icon-btn bordered', 'aria-label': 'المزيد', onclick: () => actionSheet('@' + p.username, [
        { label: 'إبلاغ عن الحساب', icon: 'flag', run: () => reportDialog('user', p.id) },
        { label: 'حظر المستخدم', icon: 'block', danger: true, run: async () => { if (await blockUser(p)) location.hash = '#/home'; } },
      ]) }, icon('more', 20)));

  async function verificationSheet() {
    sheet('توثيق الحساب', async (body, close) => {
      const reason = h('textarea', { class: 'input', rows: 3, maxlength: 500, placeholder: 'اكتب سبب طلب التوثيق (اختياري)' });
      const statusBox = h('div', { class: 'muted small' }, 'جارٍ تحميل حالة الطلب...');
      body.append(h('p', { class: 'muted small' }, 'يمكنك إرسال طلب واحد قيد المراجعة. المالك وحده يقرر قبول الطلب أو رفضه.'), statusBox);
      let pending = false;
      try {
        const rows = await sb.rpc('my_verification_request');
        const latest = Array.isArray(rows) ? rows[0] : rows;
        if (latest) {
          statusBox.textContent = ({ pending: 'طلبك قيد مراجعة المالك', approved: 'تمت الموافقة على توثيق حسابك', rejected: 'تم رفض طلب التوثيق' })[latest.status] || 'لا يوجد طلب';
          pending = latest.status === 'pending';
        } else statusBox.textContent = 'لم ترسل طلب توثيق بعد';
      } catch (e) { statusBox.textContent = 'تعذّر جلب حالة الطلب. تأكد من تفعيل ميزة التوثيق في قاعدة البيانات.'; }
      if (p.is_verified) { statusBox.textContent = 'حسابك موثّق بالفعل'; return; }
      if (pending) return;
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

  box.append(h('section', { class: 'profile-card' },
    h('div', { class: 'cover' }),
    h('div', { class: 'pc-main' }, avatar(p, 92, true),
      h('div', { class: 'pc-name' }, p.display_name || p.username, badge(p.role), verifiedBadge(p.is_verified)),
      h('div', { class: 'muted' }, '@' + p.username, p.is_private ? ' · 🔒 حساب خاص' : ''),
      p.bio && h('p', { class: 'bio' }, p.bio),
      h('div', { class: 'stats' }, stat(nPosts, 'منشور', () => {}), stat(nFollowers, 'متابِع', () => userListSheet('المتابِعون', p.id, 'followers')), stat(nFollowing, 'يتابع', () => userListSheet('يتابع', p.id, 'following'))),
      actions)));

  if (isMe && !p.is_verified) box.append(h('div', { class: 'verify-request-wrap' }, h('button', { class: 'btn ghost block', onclick: verificationSheet }, '✓ طلب توثيق الحساب')));
  box.append(isMe ? quickComposer() : null);
  const privateMessage = p.is_private && !isMe && !amFollowing
    ? h('span', null, icon('lock', 30), h('br'), 'هذا الحساب خاص. تابعه لرؤية منشوراته.')
    : null;
  try {
    const rows = await enrichPosts(await sb.from('posts').select(POST_SELECT).eq('author_id', p.id).order('created_at', { ascending: false }).limit(60));
    const videos = rows.filter((r) => r.media_type === 'video' && r.media_url);
    const otherPosts = rows.filter((r) => !(r.media_type === 'video' && r.media_url));

    if (videos.length) {
      const videoGrid = h('div', { class: 'profile-video-grid' });
      videos.forEach((r) => {
        const tile = h('button', { class: 'profile-video-tile', type: 'button', 'aria-label': 'مشاهدة الفيديو', onclick: () => { location.hash = '#/post/' + r.id; } },
          h('video', { src: r.media_url, muted: true, playsinline: true, preload: 'metadata' }),
          h('span', { class: 'profile-video-play' }, icon('play', 22)),
          h('span', { class: 'profile-video-caption' }, r.body || 'فيديو'));
        videoGrid.append(tile);
      });
      box.append(h('h3', { class: 'sec' }, 'الفيديوهات'), videoGrid);
    }

    if (otherPosts.length) {
      const postsBox = h('div', { class: 'feed' });
      box.append(h('h3', { class: 'sec' }, 'المنشورات'), postsBox);
      otherPosts.forEach((r) => postsBox.append(postCard(r)));
    }

    if (!rows.length) box.append(h('div', { class: 'empty small' }, privateMessage || 'لا توجد منشورات بعد'));
    else if (!videos.length && !otherPosts.length) box.append(h('div', { class: 'empty small' }, 'لا يوجد محتوى بعد'));
  } catch (e) { box.append(h('div', { class: 'empty small' }, e.message)); }
}
