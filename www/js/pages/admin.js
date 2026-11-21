import { h, icon, avatar, clear, toast, sheet, actionSheet, confirmBox, timeAgo, badge, roleLabel } from '../lib/dom.js';
import { sb, state, hasPerm, POST_SELECT, PROFILE_MINI } from '../api.js';
import { headerBar } from './home.js';

const STAT_LABELS = { users: 'المستخدمون', new_users_7d: 'جدد (7 أيام)', disabled_users: 'معطّلون', posts: 'المنشورات', comments: 'التعليقات', likes: 'الإعجابات', messages: 'الرسائل', active_stories: 'حالات نشطة', open_reports: 'بلاغات مفتوحة' };
const ACTION_LABELS = { 'user.disable': 'تعطيل حساب', 'user.enable': 'تفعيل حساب', 'user.delete': 'حذف حساب', 'user.set_role': 'تغيير دور', 'post.delete': 'حذف منشور', 'post.hide': 'إخفاء منشور', 'post.unhide': 'إظهار منشور', 'comment.delete': 'حذف تعليق', 'report.resolved': 'معالجة بلاغ', 'report.dismissed': 'رفض بلاغ', 'broadcast.send': 'إشعار عام', 'feature.set': 'ميزة', 'setting.set': 'إعداد', 'permission.set': 'صلاحية', 'permission.add': 'إضافة صلاحية', 'owner.claimed': 'تفعيل المالك' };
const isOwner = () => state.me.role === 'OWNER';

export async function adminPage(root) {
  if (!state.perms.length) { root.append(headerBar('الإدارة', { back: true }), h('div', { class: 'empty' }, icon('lock', 44), h('h3', null, 'غير مصرّح'))); return; }
  const tabs = [
    ['stats', 'الإحصائيات', 'chart', hasPerm('stats.view'), statsTab],
    ['users', 'المستخدمون', 'users', hasPerm('users.view'), usersTab],
    ['posts', 'المنشورات', 'image', hasPerm('posts.view_all'), postsTab],
    ['reports', 'البلاغات', 'flag', hasPerm('reports.review'), reportsTab],
    ['broadcast', 'إشعار عام', 'megaphone', hasPerm('notifications.broadcast'), broadcastTab],
    ['features', 'المميزات', 'toggle', hasPerm('features.manage'), featuresTab],
    ['roles', 'الصلاحيات', 'shield', isOwner(), rolesTab],
    ['audit', 'السجل', 'list', hasPerm('audit.view'), auditTab],
  ].filter((t) => t[3]);
  let cur = tabs[0][0];
  const bar = h('div', { class: 'chips scroll admin-tabs' });
  const content = h('div', { class: 'admin-content' });
  root.append(headerBar('لوحة الإدارة', { back: true, right: [h('span', { class: 'role-badge ' + state.me.role }, roleLabel[state.me.role])] }), h('div', { class: 'page' }, bar, content));
  function paintTabs() { clear(bar).append(...tabs.map(([k, l, ic]) => h('button', { class: 'chip' + (k === cur ? ' on' : ''), onclick: () => { cur = k; paintTabs(); open(); } }, icon(ic, 16), l))); }
  async function open() {
    clear(content).append(h('div', { class: 'skeleton post-sk' }));
    try { await tabs.find((t) => t[0] === cur)[4](clear(content)); } catch (e) { clear(content).append(h('div', { class: 'empty' }, e.message)); }
  }
  paintTabs(); await open();
}

async function statsTab(box) {
  const s = await sb.rpc('admin_stats');
  box.append(h('div', { class: 'stat-grid' }, Object.keys(STAT_LABELS).map((k, i) => h('div', { class: 'stat-card c' + (i % 6) }, h('b', null, Number(s[k] ?? 0).toLocaleString('ar-EG-u-nu-latn')), h('span', null, STAT_LABELS[k])))));
}

async function usersTab(box) {
  const input = h('input', { class: 'input search', placeholder: 'ابحث بالاسم أو اسم المستخدم...' });
  const list = h('div', { class: 'card-list' });
  box.append(input, list);
  async function load() {
    const rows = await sb.rpc('admin_list_users', { search: input.value.trim().replace(/[%]/g, ''), lim: 60, off: 0 });
    clear(list); if (!rows.length) list.append(h('div', { class: 'empty small' }, 'لا نتائج'));
    rows.forEach((u) => list.append(h('div', { class: 'user-row' + (u.is_disabled ? ' disabled' : '') }, avatar(u, 44),
      h('div', { class: 'grow' }, h('div', { class: 'p-name' }, u.display_name || u.username, badge(u.role), u.is_disabled ? h('span', { class: 'role-badge OFF' }, 'معطّل') : null), h('div', { class: 'muted small' }, '@' + u.username + ' · ' + timeAgo(u.created_at))),
      u.id !== state.me.id && u.role !== 'OWNER' ? h('button', { class: 'icon-btn', 'aria-label': 'إجراءات', onclick: () => userActions(u, load) }, icon('more', 20)) : null)));
  }
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch((e) => toast(e.message, 'err')), 300); });
  await load();
}
function userActions(u, reload) {
  const run = (fn, msg) => async () => { try { await fn(); toast(msg, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  actionSheet('@' + u.username, [
    { label: 'عرض الملف الشخصي', icon: 'user', run: () => (location.hash = `#/u/${u.username}`) },
    hasPerm('users.disable') && { label: u.is_disabled ? 'تفعيل الحساب' : 'تعطيل الحساب', icon: 'block', danger: !u.is_disabled, run: run(() => sb.rpc('admin_set_disabled', { target: u.id, disabled: !u.is_disabled }), u.is_disabled ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب') },
    hasPerm('users.set_role') && u.role !== 'MODERATOR' && { label: 'تعيين كمراقب', icon: 'shield', run: run(() => sb.rpc('admin_set_role', { target: u.id, new_role: 'MODERATOR' }), 'تم تعيينه مراقباً') },
    isOwner() && u.role !== 'ADMIN' && { label: 'تعيين كمشرف عام', icon: 'shield', run: run(() => sb.rpc('admin_set_role', { target: u.id, new_role: 'ADMIN' }), 'تم تعيينه مشرفاً') },
    hasPerm('users.set_role') && u.role !== 'USER' && { label: 'سحب الصلاحيات (مستخدم عادي)', icon: 'user', run: run(() => sb.rpc('admin_set_role', { target: u.id, new_role: 'USER' }), 'تم سحب الصلاحيات') },
    hasPerm('users.delete') && { label: 'حذف الحساب نهائياً', icon: 'trash', danger: true, run: async () => { if (await confirmBox(`حذف حساب @${u.username} وكل بياناته نهائياً؟`, 'حذف', true)) run(() => sb.rpc('admin_delete_user', { target: u.id }), 'تم حذف الحساب')(); } },
  ]);
}

async function postsTab(box) {
  const rows = await sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(40);
  if (!rows.length) return box.append(h('div', { class: 'empty' }, 'لا توجد منشورات'));
  const list = h('div', { class: 'card-list' }); box.append(list);
  rows.forEach((p) => list.append(h('div', { class: 'adm-post' + (p.is_hidden ? ' hidden-post' : '') },
    h('div', { class: 'row between' }, h('a', { class: 'row gap', href: `#/u/${p.author.username}` }, avatar(p.author, 34), h('b', null, '@' + p.author.username)), h('span', { class: 'muted small' }, timeAgo(p.created_at))),
    p.body && h('p', null, p.body.slice(0, 220)), p.media_url && (p.media_type === 'video' ? h('video', { src: p.media_url, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { src: p.media_url, loading: 'lazy', alt: '' })),
    h('div', { class: 'row gap' },
      hasPerm('posts.delete') && h('button', { class: 'btn ghost sm', onclick: async (e) => { try { await sb.rpc('admin_set_post_hidden', { target: p.id, hidden: !p.is_hidden }); p.is_hidden = !p.is_hidden; e.target.textContent = p.is_hidden ? 'إظهار' : 'إخفاء'; toast('تم', 'ok'); } catch (er) { toast(er.message, 'err'); } } }, p.is_hidden ? 'إظهار' : 'إخفاء'),
      hasPerm('posts.delete') && h('button', { class: 'btn danger sm', onclick: async (e) => { if (!(await confirmBox('حذف المنشور نهائياً؟', 'حذف', true))) return; try { await sb.rpc('admin_delete_post', { target: p.id }); e.target.closest('.adm-post').remove(); toast('تم الحذف', 'ok'); } catch (er) { toast(er.message, 'err'); } } }, 'حذف')))));
}

async function reportsTab(box) {
  const status = ['open', 'resolved', 'dismissed']; let cur = 'open';
  const chips = h('div', { class: 'chips' }), list = h('div', { class: 'card-list' });
  box.append(chips, list);
  async function load() {
    clear(chips).append(...status.map((s) => h('button', { class: 'chip' + (s === cur ? ' on' : ''), onclick: () => { cur = s; load(); } }, { open: 'مفتوحة', resolved: 'تمت معالجتها', dismissed: 'مرفوضة' }[s])));
    const rows = await sb.from('reports').select(`*,reporter:profiles!reports_reporter_id_fkey(${PROFILE_MINI})`).eq('status', cur).order('created_at', { ascending: false }).limit(50);
    clear(list); if (!rows.length) list.append(h('div', { class: 'empty small' }, 'لا توجد بلاغات'));
    rows.forEach((r) => {
      const typeAr = { post: 'منشور', comment: 'تعليق', user: 'حساب' }[r.target_type];
      const done = (st, msg) => async () => { try { await sb.rpc('admin_resolve_report', { target: r.id, new_status: st }); toast(msg, 'ok'); load(); } catch (e) { toast(e.message, 'err'); } };
      list.append(h('div', { class: 'adm-post' },
        h('div', { class: 'row between' }, h('b', null, 'بلاغ عن ' + typeAr), h('span', { class: 'muted small' }, timeAgo(r.created_at))),
        h('p', null, r.reason), h('div', { class: 'muted small' }, 'المُبلِّغ: @' + (r.reporter?.username || '—')),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn ghost sm', onclick: () => openTarget(r) }, 'عرض المحتوى'),
          cur === 'open' && h('button', { class: 'btn primary sm', onclick: done('resolved', 'تمت المعالجة') }, 'تمت المعالجة'),
          cur === 'open' && h('button', { class: 'btn ghost sm', onclick: done('dismissed', 'تم الرفض') }, 'رفض'),
          cur !== 'open' && h('button', { class: 'btn ghost sm', onclick: done('open', 'أُعيد فتح البلاغ') }, 'إعادة فتح'),
          r.target_type === 'post' && hasPerm('posts.delete') && h('button', { class: 'btn danger sm', onclick: async () => { if (!(await confirmBox('حذف المنشور المبلّغ عنه؟', 'حذف', true))) return; try { await sb.rpc('admin_delete_post', { target: r.target_id }); await sb.rpc('admin_resolve_report', { target: r.id, new_status: 'resolved' }); toast('تم حذف المنشور', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } }, 'حذف المنشور'),
          r.target_type === 'comment' && hasPerm('comments.delete') && h('button', { class: 'btn danger sm', onclick: async () => { try { await sb.rpc('admin_delete_comment', { target: r.target_id }); await sb.rpc('admin_resolve_report', { target: r.id, new_status: 'resolved' }); toast('تم حذف التعليق', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } }, 'حذف التعليق'))));
    });
  }
  async function openTarget(r) {
    if (r.target_type === 'post') location.hash = `#/post/${r.target_id}`;
    else if (r.target_type === 'user') { const p = await sb.from('profiles').select('username').eq('id', r.target_id).one(); p ? (location.hash = `#/u/${p.username}`) : toast('الحساب غير موجود', 'err'); }
    else { const c = await sb.from('comments').select('post_id,body').eq('id', r.target_id).one(); c ? (location.hash = `#/post/${c.post_id}`) : toast('التعليق محذوف أو مخفي', 'err'); }
  }
  await load();
}

async function broadcastTab(box) {
  const title = h('input', { class: 'input', placeholder: 'عنوان الإشعار', maxlength: 100 });
  const body = h('textarea', { class: 'input', rows: 4, placeholder: 'نص الإشعار', maxlength: 300 });
  box.append(h('p', { class: 'muted' }, 'سيصل هذا الإشعار إلى جميع المستخدمين النشطين.'), title, body,
    h('button', { class: 'btn primary block lg', onclick: async (e) => {
      if (!title.value.trim()) return toast('العنوان مطلوب', 'err');
      if (!(await confirmBox('إرسال الإشعار إلى جميع المستخدمين؟', 'إرسال'))) return;
      e.target.disabled = true;
      try { const n = await sb.rpc('admin_broadcast', { p_title: title.value.trim(), p_body: body.value.trim() }); toast(`أُرسل إلى ${n} مستخدم`, 'ok'); title.value = ''; body.value = ''; } catch (er) { toast(er.message, 'err'); } finally { e.target.disabled = false; }
    } }, icon('megaphone', 20), 'إرسال للجميع'));
}

async function featuresTab(box) {
  const flags = await sb.from('feature_flags').select('*').order('key');
  box.append(h('div', { class: 'card-list' }, flags.map((f) => h('div', { class: 'set-row' }, h('div', { class: 'grow' }, h('b', null, f.description || f.key), h('div', { class: 'muted small', dir: 'ltr' }, f.key)),
    h('button', { class: 'switch' + (f.enabled ? ' on' : ''), role: 'switch', onclick: async (e) => { const b = e.currentTarget, v = !b.classList.contains('on'); b.classList.toggle('on', v); try { await sb.rpc('admin_set_flag', { p_key: f.key, p_enabled: v }); state.flags[f.key] = v; toast(v ? 'تم التشغيل' : 'تم الإيقاف', 'ok'); } catch (er) { b.classList.toggle('on', !v); toast(er.message, 'err'); } } }, h('i'))))));
}

async function rolesTab(box) {
  const [perms, matrix] = await Promise.all([sb.from('permissions').select('*').order('key'), sb.rpc('owner_role_matrix')]);
  const has = new Set(matrix.map((m) => m.role + ':' + m.permission_key));
  const roles = ['ADMIN', 'MODERATOR', 'USER'];
  box.append(h('p', { class: 'muted' }, 'المالك (OWNER) يملك كل الصلاحيات دائماً ولا يمكن تقييده. عدّل صلاحيات بقية الأدوار فيتم تطبيقها فوراً دون تحديث التطبيق.'));
  const table = h('div', { class: 'perm-table' }, h('div', { class: 'perm-row head' }, h('span', { class: 'grow' }, 'الصلاحية'), roles.map((r) => h('span', { class: 'cell' }, roleLabel[r]))));
  perms.forEach((p) => table.append(h('div', { class: 'perm-row' }, h('div', { class: 'grow' }, h('b', null, p.description || p.key), h('div', { class: 'muted small', dir: 'ltr' }, p.key)),
    roles.map((r) => h('span', { class: 'cell' }, h('button', { class: 'switch sm' + (has.has(r + ':' + p.key) ? ' on' : ''), 'aria-label': `${roleLabel[r]} ${p.key}`, onclick: async (e) => { const b = e.currentTarget, v = !b.classList.contains('on'); b.classList.toggle('on', v); try { await sb.rpc('owner_set_role_permission', { p_role: r, p_perm: p.key, p_allowed: v }); } catch (er) { b.classList.toggle('on', !v); toast(er.message, 'err'); } } }, h('i')))))));
  box.append(table, h('button', { class: 'btn ghost block', onclick: () => sheet('إضافة صلاحية جديدة', (body, close) => {
    const key = h('input', { class: 'input', placeholder: 'المفتاح مثل events.manage', dir: 'ltr' }), desc = h('input', { class: 'input', placeholder: 'الوصف بالعربية' });
    body.append(key, desc, h('button', { class: 'btn primary block lg', onclick: async () => { try { await sb.rpc('owner_add_permission', { p_key: key.value.trim(), p_desc: desc.value.trim() }); toast('تمت الإضافة', 'ok'); close(); rolesTab(clear(box)); } catch (e) { toast(e.message, 'err'); } } }, 'إضافة'));
  }) }, icon('plus', 18), 'إضافة صلاحية جديدة'));
}

async function auditTab(box) {
  const rows = await sb.from('audit_log').select('*').order('id', { ascending: false }).limit(80);
  if (!rows.length) return box.append(h('div', { class: 'empty' }, 'السجل فارغ'));
  box.append(h('div', { class: 'card-list' }, rows.map((r) => h('div', { class: 'audit' }, h('div', { class: 'row between' }, h('b', null, ACTION_LABELS[r.action] || r.action), h('span', { class: 'muted small' }, timeAgo(r.created_at))),
    h('div', { class: 'muted small' }, 'بواسطة @' + (r.actor_username || '—') + (r.target ? ' · الهدف: ' + String(r.target).slice(0, 18) : '')), Object.keys(r.details || {}).length ? h('div', { class: 'muted small', dir: 'ltr' }, JSON.stringify(r.details)) : null))));
}
