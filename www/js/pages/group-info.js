import { h, icon, avatar, clear, toast, sheet, actionSheet, confirmBox } from '../lib/dom.js';
import { sb, state, PROFILE_MINI, uploadMedia } from '../api.js';
import { headerBar } from './home.js';
import { pickPeople } from './people.js';
import { viewImage } from './postcard.js';
import { groupAvatar, groupError, openGroupSearch } from './groups.js';

const sw = (on, onchange) => { const b = h('button', { class: 'switch' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(!!on) }); b.onclick = async () => { const v = !b.classList.contains('on'); b.disabled = true; try { await onchange(v); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); } catch (e) { toast(groupError(e), 'err'); } b.disabled = false; }; return b; };
const row = (ic, title, sub, right, onclick, danger) => h('div', { class: 'set-row' + (danger ? ' danger' : ''), onclick }, h('div', { class: 'set-ico' }, icon(ic, 20)), h('div', { class: 'grow' }, h('b', null, title), sub ? h('div', { class: 'muted small' }, sub) : null), right || null);

export async function groupInfoPage(root, params, ctx) {
  const id = params.id;
  let group, me, members = [], reqs = [];
  const people = new Map();
  const box = h('div', { class: 'page group-info' });
  root.append(headerBar('معلومات المجموعة', { back: true }), box);

  async function load() {
    group = await sb.from('groups').select('*').eq('id', id).one();
    if (!group) throw new Error('المجموعة غير موجودة أو لم تعد متاحة');
    me = await sb.from('group_members').select('role,muted,pinned').eq('group_id', id).eq('user_id', state.me.id).one();
    if (!me) throw new Error('أنت لست عضواً في هذه المجموعة');
    members = await sb.from('group_members').select('user_id,role,joined_at').eq('group_id', id).order('joined_at', { ascending: true }).limit(1000);
    const ids = members.map((m) => m.user_id).slice(0, 200);
    const profiles = ids.length ? await sb.from('profiles').select(PROFILE_MINI).in('id', ids).limit(200) : [];
    profiles.forEach((p) => people.set(p.id, p));
    reqs = me.role === 'admin' ? await sb.from('group_join_requests').select('user_id,invited_by,created_at').eq('group_id', id).limit(200) : [];
    const rp = reqs.map((r) => r.user_id).filter((u) => !people.has(u));
    if (rp.length) (await sb.from('profiles').select(PROFILE_MINI).in('id', rp)).forEach((p) => people.set(p.id, p));
  }
  const isOwner = () => group.owner_id === state.me.id;
  const isAdmin = () => me.role === 'admin';
  const nameOf = (uid) => { const p = people.get(uid); return p?.display_name || p?.username || 'عضو'; };

  let tab = 'members';
  async function render() {
    clear(box);
    const av = h('div', { class: 'gi-av' }, groupAvatar(group, 96), isAdmin() ? h('div', { class: 'muted small link' }, 'تغيير الصورة') : null);
    if (isAdmin()) {
      const f = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      f.addEventListener('change', async () => { const file = f.files[0]; if (!file) return; try { toast('جارٍ الرفع...'); const m = await uploadMedia('avatars', file); await sb.from('groups').update({ avatar_url: m.url }).eq('id', id); group.avatar_url = m.url; toast('تم تحديث الصورة', 'ok'); render(); } catch (e) { toast(groupError(e), 'err'); } });
      av.append(f); av.onclick = () => f.click();
    }
    box.append(h('div', { class: 'gi-head' }, av, h('h2', null, group.name), group.description ? h('p', { class: 'muted' }, group.description) : null,
      h('div', { class: 'muted small' }, members.length + ' أعضاء'), isAdmin() ? h('button', { class: 'btn ghost sm', type: 'button', onclick: editInfo }, icon('edit', 16), 'تعديل الاسم والوصف') : null));

    const act = (ic, label, fn) => h('button', { class: 'gi-act', type: 'button', onclick: fn }, h('span', { class: 'gi-act-i' }, icon(ic, 22)), label);
    box.append(h('div', { class: 'gi-acts' }, act('search', 'بحث', () => openGroupSearch(id, people)), act('link', 'رابط الدعوة', inviteSheet), act('user-plus', 'إضافة أشخاص', addPeople)));

    box.append(h('div', { class: 'card-list' },
      row('pin', 'التثبيت في الأعلى', 'تظهر المجموعة أول القائمة', sw(me.pinned, async (v) => { await sb.from('group_members').update({ pinned: v }).eq('group_id', id).eq('user_id', state.me.id); me.pinned = v; })),
      row('bell', 'كتم الإشعارات', 'لا تظهر تنبيهات الرسائل الجديدة داخل التطبيق', sw(me.muted, async (v) => { await sb.from('group_members').update({ muted: v }).eq('group_id', id).eq('user_id', state.me.id); me.muted = v; })),
      isAdmin() ? row('shield', 'إدارة المجموعة', reqs.length ? reqs.length + ' طلب انضمام بالانتظار' : 'الصلاحيات والمسؤولون والطلبات', null, manageSheet) : null,
      row('log-out', 'مغادرة المجموعة', null, null, leave, true)));

    const tabs = h('div', { class: 'chips' }, [['members', 'الأعضاء (' + members.length + ')'], ['media', 'الوسائط']].map(([k, l]) => h('button', { class: 'chip' + (tab === k ? ' on' : ''), type: 'button', onclick: () => { tab = k; render(); } }, l)));
    const body = h('div', { class: 'card-list' });
    box.append(tabs, body);
    if (tab === 'members') paintMembers(body); else await paintMedia(body);
  }

  function paintMembers(body) {
    members.forEach((m) => {
      const p = people.get(m.user_id) || { display_name: 'عضو', username: '' };
      const owner = m.user_id === group.owner_id;
      const mine = m.user_id === state.me.id;
      const canManage = isAdmin() && !mine && !owner && (m.role !== 'admin' || isOwner());
      body.append(h('div', { class: 'user-row' }, avatar(p, 42), h('div', { class: 'grow' }, h('b', null, (p.display_name || p.username) + (mine ? ' (أنت)' : '')), h('div', { class: 'muted small' }, '@' + (p.username || ''))),
        owner ? h('span', { class: 'role-badge OWNER' }, 'المالك') : m.role === 'admin' ? h('span', { class: 'role-badge ADMIN' }, 'مشرف') : null,
        !mine && p.username ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => (location.hash = '#/chat/' + p.username) }, 'مراسلة') : null,
        canManage ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إدارة العضو', onclick: () => memberMenu(m, p) }, icon('more', 20)) : null));
    });
  }

  async function paintMedia(body) {
    try {
      const rows = await sb.from('group_messages').select('id,media_url,media_type').eq('group_id', id).in('media_type', ['image', 'video']).order('created_at', { ascending: false }).limit(60);
      if (!rows.length) return body.append(h('div', { class: 'empty small' }, icon('image', 36), h('p', null, 'لا توجد صور أو فيديوهات بعد')));
      body.append(h('div', { class: 'gi-grid' }, rows.map((r) => r.media_type === 'video' ? h('video', { src: r.media_url, preload: 'metadata', controls: true }) : h('img', { src: r.media_url, alt: '', loading: 'lazy', onclick: () => viewImage(r.media_url) }))));
    } catch (e) { body.append(h('div', { class: 'empty small' }, groupError(e))); }
  }

  function memberMenu(m, p) {
    const n = p.display_name || p.username;
    actionSheet(n, [
      m.role === 'admin' ? (isOwner() ? { label: 'إزالة صلاحية المشرف', icon: 'shield', run: () => act(() => sb.rpc('set_group_role', { p_group_id: id, p_user_id: m.user_id, p_role: 'member' }), 'تم التحديث') } : null)
        : { label: 'جعله مشرفاً', icon: 'shield', run: () => act(() => sb.rpc('set_group_role', { p_group_id: id, p_user_id: m.user_id, p_role: 'admin' }), 'أصبح مشرفاً') },
      { label: 'إزالة من المجموعة', icon: 'close', danger: true, run: async () => { if (await confirmBox('إزالة ' + n + ' من المجموعة؟', 'إزالة', true)) act(() => sb.rpc('remove_group_member', { p_group_id: id, p_user_id: m.user_id }), 'تمت الإزالة'); } },
    ]);
  }
  async function act(fn, okMsg) { try { await fn(); toast(okMsg, 'ok'); await load(); await render(); } catch (e) { toast(groupError(e), 'err'); } }

  function editInfo() {
    sheet('تعديل معلومات المجموعة', (body, close) => {
      const name = h('input', { class: 'input', maxlength: 60, value: group.name });
      const desc = h('textarea', { class: 'input', rows: 3, maxlength: 160, placeholder: 'الوصف' }, group.description || '');
      body.append(h('label', { class: 'lbl' }, 'الاسم'), name, h('label', { class: 'lbl' }, 'الوصف'), desc, h('button', { class: 'btn primary block lg', type: 'button', onclick: async (e) => {
        if (!name.value.trim()) return toast('الاسم مطلوب', 'err'); e.target.disabled = true;
        try { await sb.from('groups').update({ name: name.value.trim(), description: desc.value.trim() }).eq('id', id); group.name = name.value.trim(); group.description = desc.value.trim(); close(); toast('تم الحفظ', 'ok'); render(); } catch (er) { toast(groupError(er), 'err'); e.target.disabled = false; }
      } }, 'حفظ'));
    });
  }

  async function addPeople() {
    if (!isAdmin() && !group.members_can_add) return toast('إضافة الأعضاء متاحة للمشرفين فقط في هذه المجموعة', 'err');
    const sel = await pickPeople('إضافة أشخاص إلى ' + group.name, new Set(members.map((m) => m.user_id)));
    if (!sel) return;
    const fresh = [...sel].filter((u) => !members.some((m) => m.user_id === u));
    if (!fresh.length) return;
    try { const n = await sb.rpc('add_group_members', { p_group_id: id, p_member_ids: fresh }); toast(!isAdmin() && group.require_approval ? 'أُرسلت الطلبات لموافقة المشرف' : 'تمت إضافة ' + Number(n || 0) + ' عضو', 'ok'); await load(); render(); } catch (e) { toast(groupError(e), 'err'); }
  }

  function inviteSheet() {
    sheet('رابط الدعوة', (body, close) => {
      const draw = () => {
        clear(body);
        if (!group.join_by_link) return body.append(h('div', { class: 'empty small' }, icon('lock', 36), h('p', null, 'الانضمام عبر الرابط معطّل لهذه المجموعة.'), isAdmin() ? h('p', { class: 'muted small' }, 'فعّله من إدارة المجموعة.') : null));
        const link = location.origin + location.pathname + '#/join/' + group.invite_code;
        const text = 'انضم إلى مجموعة «' + group.name + '» على NEXORA\nرمز الدعوة: ' + group.invite_code + '\n(من المجموعات ← أيقونة الرابط ← الصق الرمز)';
        body.append(h('p', { class: 'muted' }, 'أرسل هذا الرمز لمن تريد دعوته. يدخل من «المجموعات ← أيقونة الرابط».'),
          h('div', { class: 'invite-code', dir: 'ltr' }, group.invite_code),
          h('button', { class: 'btn primary block', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(group.invite_code); toast('تم نسخ الرمز', 'ok'); } catch { toast('تعذّر النسخ', 'err'); } } }, icon('copy', 18), 'نسخ الرمز'),
          navigator.share ? h('button', { class: 'btn ghost block', type: 'button', onclick: () => navigator.share({ text }).catch(() => {}) }, 'مشاركة الدعوة') : null,
          isAdmin() ? h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { if (!(await confirmBox('سيتوقف الرمز القديم عن العمل. متابعة؟', 'إعادة توليد'))) return; try { group.invite_code = await sb.rpc('regenerate_group_invite', { p_group_id: id }); draw(); toast('تم توليد رمز جديد', 'ok'); } catch (e) { toast(groupError(e), 'err'); } } }, 'إعادة توليد الرمز') : null);
      };
      draw();
    });
  }

  function manageSheet() {
    sheet('إدارة المجموعة', (body, close) => {
      const owner = isOwner();
      const adminCount = members.filter((m) => m.role === 'admin' && m.user_id !== group.owner_id).length;
      const save = async (k, v) => { const next = { p_join_by_link: group.join_by_link, p_require_approval: group.require_approval, p_members_can_add: group.members_can_add, [k]: v }; await sb.rpc('update_group_settings', { p_group_id: id, ...next }); group.join_by_link = next.p_join_by_link; group.require_approval = next.p_require_approval; group.members_can_add = next.p_members_can_add; };
      body.append(h('div', { class: 'card-list' },
        row('users', 'طلب موافقة المسؤول للانضمام', 'الأعضاء الجدد ينتظرون موافقتك', sw(group.require_approval, (v) => save('p_require_approval', v))),
        row('link', 'السماح بالانضمام عبر الرابط', 'من يملك رمز الدعوة يمكنه الدخول', sw(group.join_by_link, (v) => save('p_join_by_link', v))),
        row('user-plus', 'السماح للأعضاء بإضافة أعضاء', 'إن عُطّل فالمشرفون فقط يضيفون', sw(group.members_can_add, (v) => save('p_members_can_add', v)))),
        h('div', { class: 'card-list' },
          row('bell', 'طلبات الانضمام', reqs.length ? reqs.length + ' بالانتظار' : 'لا توجد طلبات', null, () => { close(); requestsSheet(); }),
          row('shield', 'إدارة المسؤولين (' + adminCount + '/5)', owner ? 'ترقية الأعضاء أو إزالة الصلاحية' : 'ترقية الأعضاء إلى مشرفين', null, () => { close(); adminsSheet(); }),
          row('close', 'إزالة أعضاء', null, null, () => { close(); removeSheet(); })),
        owner ? h('div', { class: 'card-list' },
          row('crown', 'نقل الملكية', 'اختر مالكاً جديداً للمجموعة', null, () => { close(); transferSheet(); }),
          row('trash', 'إنهاء المجموعة', 'تُحذف المجموعة ورسائلها للجميع نهائياً', null, async () => {
            if (!(await confirmBox('إنهاء المجموعة «' + group.name + '» وحذف كل رسائلها لجميع الأعضاء؟ لا يمكن التراجع.', 'إنهاء المجموعة', true))) return;
            try { await sb.rpc('delete_group', { p_group_id: id }); close(); toast('تم إنهاء المجموعة', 'ok'); location.hash = '#/groups'; } catch (e) { toast(groupError(e), 'err'); }
          }, true)) : null);
    }, { full: true });
  }

  function requestsSheet() {
    sheet('طلبات الانضمام', (body) => {
      const draw = () => {
        clear(body);
        if (!reqs.length) return body.append(h('div', { class: 'empty small' }, 'لا توجد طلبات'));
        reqs.forEach((r) => {
          const p = people.get(r.user_id) || { display_name: 'مستخدم' };
          const review = async (ok) => { try { await sb.rpc('review_join_request', { p_group_id: id, p_user_id: r.user_id, p_approve: ok }); reqs = reqs.filter((x) => x.user_id !== r.user_id); toast(ok ? 'تم القبول' : 'تم الرفض', 'ok'); draw(); } catch (e) { toast(groupError(e), 'err'); } };
          body.append(h('div', { class: 'user-row' }, avatar(p, 42), h('div', { class: 'grow' }, h('b', null, p.display_name || p.username), r.invited_by ? h('div', { class: 'muted small' }, 'بدعوة من ' + nameOf(r.invited_by)) : h('div', { class: 'muted small' }, 'عبر رابط الدعوة')),
            h('button', { class: 'btn primary sm', type: 'button', onclick: () => review(true) }, 'قبول'), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => review(false) }, 'رفض')));
        });
      };
      draw();
    }, { full: true });
    // refresh the page after the sheet is used
    setTimeout(() => {}, 0);
  }

  function memberPicker(title, filter, labelFn, onPick) {
    sheet(title, (body, close) => {
      const list = members.filter(filter);
      if (!list.length) return body.append(h('div', { class: 'empty small' }, 'لا يوجد أعضاء مناسبون'));
      list.forEach((m) => { const p = people.get(m.user_id) || { display_name: 'عضو' }; body.append(h('button', { class: 'user-row', type: 'button', onclick: () => { close(); onPick(m, p); } }, avatar(p, 42), h('div', { class: 'grow' }, h('b', null, p.display_name || p.username), h('div', { class: 'muted small' }, labelFn(m))))); });
    }, { full: true });
  }
  const adminsSheet = () => memberPicker('إدارة المسؤولين', (m) => m.user_id !== group.owner_id && m.user_id !== state.me.id,
    (m) => (m.role === 'admin' ? 'مشرف · اضغط لإزالة الصلاحية' : 'عضو · اضغط للترقية'),
    (m, p) => {
      if (m.role === 'admin' && !isOwner()) return toast('إزالة المشرفين متاحة للمالك فقط', 'err');
      act(() => sb.rpc('set_group_role', { p_group_id: id, p_user_id: m.user_id, p_role: m.role === 'admin' ? 'member' : 'admin' }), 'تم التحديث');
    });
  const removeSheet = () => memberPicker('إزالة أعضاء', (m) => m.user_id !== group.owner_id && m.user_id !== state.me.id && (m.role !== 'admin' || isOwner()), (m) => (m.role === 'admin' ? 'مشرف' : 'عضو'),
    async (m, p) => { if (await confirmBox('إزالة ' + (p.display_name || p.username) + ' من المجموعة؟', 'إزالة', true)) act(() => sb.rpc('remove_group_member', { p_group_id: id, p_user_id: m.user_id }), 'تمت الإزالة'); });
  const transferSheet = () => memberPicker('اختر المالك الجديد', (m) => m.user_id !== state.me.id, (m) => (m.role === 'admin' ? 'مشرف' : 'عضو'),
    async (m, p) => { if (await confirmBox('نقل ملكية المجموعة إلى ' + (p.display_name || p.username) + '؟ ستبقى مشرفاً.', 'نقل الملكية')) act(() => sb.rpc('transfer_group_owner', { p_group_id: id, p_user_id: m.user_id }), 'تم نقل الملكية'); });

  async function doLeave(newOwner) {
    try { await sb.rpc('leave_group', { p_group_id: id, p_new_owner: newOwner || null }); toast('غادرت المجموعة'); location.hash = '#/groups'; } catch (e) { toast(groupError(e), 'err'); }
  }
  async function leave() {
    if (isOwner() && members.length > 1) {
      sheet('اختر مالك المجموعة الجديد', (body, close) => {
        body.append(h('p', { class: 'muted' }, 'يمكنك اختيار مالك جديد لهذه المجموعة، أو المغادرة ليُعيَّن أقدم مشرف تلقائياً.'),
          h('button', { class: 'btn primary block lg', type: 'button', onclick: () => { close(); memberPicker('اختر المالك الجديد', (m) => m.user_id !== state.me.id, (m) => (m.role === 'admin' ? 'مشرف' : 'عضو'), (m) => doLeave(m.user_id)); } }, 'اختر مالك المجموعة'),
          h('button', { class: 'btn ghost block', type: 'button', onclick: () => { close(); doLeave(null); } }, 'مغادرة المجموعة'),
          h('button', { class: 'btn ghost block', type: 'button', onclick: close }, 'إلغاء'));
      });
      return;
    }
    if (await confirmBox('هل تريد مغادرة هذه المجموعة؟ لن تتمكن من قراءة رسائلها بعد المغادرة.', 'مغادرة', true)) doLeave(null);
  }

  try { await load(); await render(); } catch (e) { clear(box).append(h('div', { class: 'empty' }, icon('users', 42), h('p', null, groupError(e)))); }
}
