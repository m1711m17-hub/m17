import { h, icon, avatar, clear, toast, timeAgo, hhmm, dayLabel, sheet, actionSheet, confirmBox } from '../lib/dom.js';
import { sb, state, PROFILE_MINI, rt, bus, uploadMedia, uploadAudio } from '../api.js';
import { headerBar, bellButton } from './home.js';
import { pickPeople } from './people.js';
import { stickerPanel } from './stickers.js';
import { viewImage } from './postcard.js';
import { createRecorder, recorderSupported, voiceBubble, fmtDur } from '../lib/voice.js';

export function groupAvatar(group, size = 50) {
  return avatar({ display_name: group.name, username: group.id, avatar_url: group.avatar_url }, size);
}

export function groupError(error) {
  const message = String(error?.message || error || '');
  if (/relation .* does not exist|schema cache|could not find the table/i.test(message)) return 'قسم المجموعات غير مفعّل في قاعدة البيانات بعد.';
  return message || 'تعذّر تحميل المجموعات';
}

const stickerParts = (s) => { const [emoji, label, color] = String(s).split('|'); return { emoji, label, color }; };
export function previewOf(m) {
  if (!m) return '';
  if (m.sticker) return '🙂 ملصق';
  if (m.audio_url) return '🎙️ رسالة صوتية';
  if (m.media_url) return m.media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة';
  return (m.body || '').slice(0, 80);
}

// Join a group with an invite code. Resolves with {status: joined|pending|already, group_id, name}.
export async function joinByCode(code) {
  const r = await sb.rpc('join_group_by_code', { p_code: String(code || '').trim() });
  return r;
}
export async function joinRoute(root, params) {
  root.append(headerBar('الانضمام إلى مجموعة', { back: true }), h('div', { class: 'page' }, h('div', { class: 'skeleton post-sk' })));
  try {
    const r = await joinByCode(params.code);
    if (r.status === 'pending') { clear(root); root.append(headerBar('طلب الانضمام', { back: true }), h('div', { class: 'empty' }, icon('users', 44), h('h3', null, 'تم إرسال الطلب'), h('p', null, 'تحتاج مجموعة «' + r.name + '» موافقة المشرف. ستظهر لك في القائمة بعد القبول.'))); return; }
    toast(r.status === 'already' ? 'أنت عضو في هذه المجموعة' : 'تم الانضمام إلى «' + r.name + '»', 'ok');
    location.replace('#/group/' + r.group_id);
  } catch (e) { clear(root); root.append(headerBar('الانضمام إلى مجموعة', { back: true }), h('div', { class: 'empty' }, icon('close', 44), h('p', null, groupError(e)))); }
}

// In-app banner for new group messages (respects per-group mute). Called once after login.
let alertsRt = null;
const alertNames = new Map();
export function initGroupAlerts() {
  if (alertsRt === rt || !rt || !state.me) return;
  alertsRt = rt;
  rt.channel('group-inbox', { pg: [{ event: 'INSERT', table: 'group_messages' }] }).onPg('INSERT', 'group_messages', async (data) => {
    const m = data.record; if (!m || m.sender_id === state.me.id || document.hidden) return;
    if (location.hash === '#/group/' + m.group_id) return;
    try {
      if (!alertNames.has(m.group_id)) {
        const g = await sb.from('groups').select('id,name').eq('id', m.group_id).one();
        const me = await sb.from('group_members').select('muted').eq('group_id', m.group_id).eq('user_id', state.me.id).one();
        alertNames.set(m.group_id, g && me ? { name: g.name, muted: !!me.muted } : null);
        setTimeout(() => alertNames.delete(m.group_id), 60000);
      }
      const info = alertNames.get(m.group_id); if (!info || info.muted) return;
      const p = await sb.from('profiles').select(PROFILE_MINI).eq('id', m.sender_id).one();
      toast(`👥 ${info.name} · ${p?.display_name || p?.username || 'عضو'}: ${previewOf(m)}`);
    } catch {}
  }).subscribe();
}

// ---------------- list ----------------
export async function groupsPage(root) {
  const list = h('div', { class: 'card-list' });
  const search = h('input', { class: 'input search', placeholder: 'بحث في المجموعات...' });
  const createBtn = h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': 'إنشاء مجموعة', onclick: createGroup }, icon('plus', 23));
  const joinBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الانضمام برمز دعوة', onclick: joinSheet }, icon('link', 22));
  root.append(headerBar('المجموعات', { back: true, right: [joinBtn, createBtn, bellButton()] }), h('div', { class: 'page' }, search, list));
  let stopped = false, loading = false, rows = [];

  function paint() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const items = rows.filter((r) => !q || r.group.name.toLowerCase().includes(q));
    if (!rows.length) return list.append(h('div', { class: 'empty' }, icon('users', 46), h('h3', null, 'لا توجد مجموعات بعد'),
      h('p', null, 'أنشئ مجموعة أو انضم برمز دعوة من صديق.'),
      h('div', { class: 'row gap' }, h('button', { class: 'btn primary', type: 'button', onclick: createGroup }, icon('plus', 18), 'إنشاء مجموعة'), h('button', { class: 'btn ghost', type: 'button', onclick: joinSheet }, icon('link', 18), 'لدي رمز دعوة'))));
    if (!items.length) return list.append(h('div', { class: 'empty small' }, 'لا نتائج'));
    items.forEach(({ group, last, count, me }) => {
      const preview = last ? previewOf(last) : (group.description || 'ابدأ أول رسالة في المجموعة');
      list.append(h('a', { class: 'user-row conv group-row', href: '#/group/' + group.id },
        groupAvatar(group, 52),
        h('div', { class: 'grow' },
          h('div', { class: 'row between' }, h('b', { class: 'ellipsis' }, (me.pinned ? '📌 ' : '') + group.name), h('span', { class: 'muted small' }, timeAgo(last?.created_at || group.updated_at || group.created_at))),
          h('div', { class: 'row between' }, h('span', { class: 'muted ellipsis' }, preview), h('span', { class: 'muted small' }, (me.muted ? '🔕 ' : '') + count + ' أعضاء' + (group.owner_id === state.me.id ? ' · مالك' : me.role === 'admin' ? ' · مشرف' : ''))))));
    });
  }

  async function load() {
    if (loading || stopped) return; loading = true;
    try {
      const mine = await sb.from('group_members').select('group_id,role,muted,pinned').eq('user_id', state.me.id).limit(200);
      const ids = mine.map((r) => r.group_id);
      if (!ids.length) { rows = []; paint(); return; }
      const [groups, messages, members] = await Promise.all([
        sb.from('groups').select('*').in('id', ids).limit(100),
        sb.from('group_messages').select('group_id,body,media_url,media_type,audio_url,sticker,created_at').in('group_id', ids).order('created_at', { ascending: false }).limit(300),
        sb.from('group_members').select('group_id,user_id').in('group_id', ids).limit(3000),
      ]);
      const last = new Map(); messages.forEach((m) => { if (!last.has(m.group_id)) last.set(m.group_id, m); });
      const cnt = new Map(); members.forEach((m) => cnt.set(m.group_id, (cnt.get(m.group_id) || 0) + 1));
      const meBy = new Map(mine.map((r) => [r.group_id, r]));
      rows = groups.map((g) => ({ group: g, last: last.get(g.id), count: cnt.get(g.id) || 1, me: meBy.get(g.id) || {} }))
        .sort((a, b) => (b.me.pinned ? 1 : 0) - (a.me.pinned ? 1 : 0) || new Date(b.last?.created_at || b.group.updated_at) - new Date(a.last?.created_at || a.group.updated_at));
      paint();
    } catch (error) { clear(list).append(h('div', { class: 'empty' }, icon('users', 42), h('h3', null, 'تعذّر فتح المجموعات'), h('p', null, groupError(error)))); }
    finally { loading = false; }
  }
  search.addEventListener('input', paint);

  function joinSheet() {
    sheet('الانضمام برمز دعوة', (body, close) => {
      const code = h('input', { class: 'input', dir: 'ltr', placeholder: 'رمز الدعوة', autocapitalize: 'off' });
      body.append(h('p', { class: 'muted' }, 'اطلب رمز الدعوة من مشرف المجموعة (من معلومات المجموعة ← رابط الدعوة).'), code,
        h('button', { class: 'btn primary block lg', type: 'button', onclick: async (e) => {
          const v = code.value.trim().replace(/^.*[/#]join[/]/i, ''); if (!v) return toast('اكتب الرمز', 'err');
          e.target.disabled = true;
          try {
            const r = await joinByCode(v); close();
            if (r.status === 'pending') toast('أُرسل طلب الانضمام وبانتظار موافقة المشرف', 'ok');
            else { toast(r.status === 'already' ? 'أنت عضو بالفعل' : 'تم الانضمام', 'ok'); location.hash = '#/group/' + r.group_id; }
          } catch (er) { toast(groupError(er), 'err'); e.target.disabled = false; }
        } }, 'انضمام'));
    });
  }

  function createGroup() {
    sheet('إنشاء مجموعة', (body, close) => {
      const name = h('input', { class: 'input', maxlength: 60, placeholder: 'اسم المجموعة', autocomplete: 'off' });
      const description = h('textarea', { class: 'input', rows: 3, maxlength: 160, placeholder: 'وصف المجموعة (اختياري)' });
      const chosen = new Set();
      const label = h('div', { class: 'muted small' }, 'لم يتم اختيار أعضاء إضافيين');
      const pick = h('button', { class: 'btn ghost block', type: 'button', onclick: async () => {
        const ids = await pickPeople('اختيار أعضاء المجموعة', chosen); if (!ids) return;
        chosen.clear(); ids.forEach((id) => chosen.add(id));
        label.textContent = chosen.size ? 'تم اختيار ' + chosen.size + ' عضو' : 'سيتم إنشاء المجموعة بك فقط';
      } }, icon('users', 18), 'اختيار الأعضاء');
      const save = h('button', { class: 'btn primary block lg', type: 'button', onclick: async () => {
        if (!name.value.trim()) { toast('اكتب اسم المجموعة أولاً', 'err'); name.focus(); return; }
        save.disabled = true;
        try {
          const r = await sb.rpc('create_group', { p_name: name.value.trim(), p_description: description.value.trim(), p_member_ids: [...chosen] });
          close(); toast('تم إنشاء المجموعة', 'ok'); location.hash = '#/group/' + (typeof r === 'string' ? r : r?.id);
        } catch (error) { toast(groupError(error), 'err'); save.disabled = false; }
      } }, 'إنشاء المجموعة');
      body.append(h('label', { class: 'lbl' }, 'اسم المجموعة'), name, h('label', { class: 'lbl' }, 'الوصف'), description, pick, label, save);
      name.focus();
    }, { full: true });
  }

  await load();
  const timer = setInterval(() => { if (!document.hidden) load(); }, 12000);
  return () => { stopped = true; clearInterval(timer); };
}

// ---------------- search inside a group ----------------
export function openGroupSearch(groupId, people) {
  sheet('بحث في المحادثة', (body) => {
    const q = h('input', { class: 'input search', placeholder: 'اكتب كلمة للبحث...' });
    const out = h('div', { class: 'card-list' });
    let t = null;
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const v = q.value.trim().replace(/[%_,()]/g, ' ').trim(); clear(out);
        if (v.length < 2) return;
        try {
          const rows = await sb.from('group_messages').select('id,sender_id,body,created_at').eq('group_id', groupId).ilike('body', '%' + v + '%').order('created_at', { ascending: false }).limit(40);
          if (!rows.length) return out.append(h('div', { class: 'empty small' }, 'لا نتائج'));
          rows.forEach((m) => { const p = people?.get(m.sender_id); out.append(h('div', { class: 'user-row' }, h('div', { class: 'grow' }, h('b', null, p?.display_name || p?.username || 'عضو'), h('div', { class: 'ellipsis' }, m.body), h('div', { class: 'muted small' }, dayLabel(m.created_at) + ' · ' + hhmm(m.created_at))))); });
        } catch (e) { toast(groupError(e), 'err'); }
      }, 300);
    });
    body.append(q, out); q.focus();
  }, { full: true });
}

// ---------------- chat ----------------
export async function groupChatPage(root, params) {
  root.classList.add('chat-root', 'group-chat-root');
  let group, membership, memberRows = [];
  const people = new Map();

  async function refreshMembers() {
    memberRows = await sb.from('group_members').select('user_id,role,joined_at').eq('group_id', params.id).order('joined_at', { ascending: true }).limit(1000);
    const ids = memberRows.map((r) => r.user_id).slice(0, 200);
    const profiles = ids.length ? await sb.from('profiles').select(PROFILE_MINI).in('id', ids).limit(200) : [];
    profiles.forEach((p) => people.set(p.id, p));
  }

  try {
    group = await sb.from('groups').select('*').eq('id', params.id).one();
    if (!group) throw new Error('المجموعة غير موجودة أو لم تعد متاحة');
    membership = await sb.from('group_members').select('role,muted,pinned').eq('group_id', params.id).eq('user_id', state.me.id).one();
    if (!membership) throw new Error('أنت لست عضواً في هذه المجموعة');
    await refreshMembers();
  } catch (error) {
    root.classList.remove('chat-root', 'group-chat-root');
    root.append(headerBar('المجموعة', { back: true }), h('div', { class: 'empty' }, icon('users', 42), h('p', null, groupError(error))));
    return;
  }

  const messages = h('div', { class: 'chat-msgs' });
  const input = h('textarea', { class: 'input chat-input', rows: 1, maxlength: 2000, placeholder: 'اكتب رسالة للمجموعة...' });
  const sendBtn = h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': 'إرسال الرسالة', onclick: () => send() }, icon('send', 22));
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
  const attachBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إرفاق صورة أو فيديو', onclick: () => fileIn.click() }, icon('image', 22));
  const stickBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ملصقات', onpointerdown: (e) => e.preventDefault(), onclick: () => { input.blur(); panel.toggle(); stickBtn.classList.toggle('on', panel.isOpen); } }, icon('smile', 22));
  const panel = stickerPanel({ onPick: (st) => { panel.close(); stickBtn.classList.remove('on'); send({ sticker: `${st.emoji}|${st.label}|${st.color}` }); } });
  const micBtn = h('button', { class: 'icon-btn accent mic', type: 'button', 'aria-label': 'تسجيل رسالة صوتية', onclick: startRec }, icon('mic', 22));
  const replyBar = h('div', { class: 'reply-bar', hidden: true });
  const memberCount = h('div', { class: 'muted small' }, memberRows.length + ' أعضاء');
  const title = h('a', { class: 'group-title', href: '#/group/' + params.id + '/info' }, h('b', null, group.name), memberCount);
  const moreBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'خيارات المجموعة', onclick: openGroupMenu }, icon('more', 22));
  const chatBar = h('div', { class: 'chat-bar' }, attachBtn, stickBtn, input, sendBtn, micBtn, fileIn);
  root.append(headerBar(h('a', { class: 'row gap', href: '#/group/' + params.id + '/info' }, groupAvatar(group, 38), title), { back: true, right: [moreBtn] }), messages, panel, replyBar, chatBar);

  const seen = new Map(); const els = new Map();
  let lastDay = '', busy = false, sending = false, stopped = false, channel = null, replyTo = null;
  const hasText = () => input.value.trim().length > 0;
  const syncBtns = () => { sendBtn.hidden = !hasText(); micBtn.hidden = hasText() || !recorderSupported(); };
  syncBtns();

  function setReply(m) {
    replyTo = m; clear(replyBar); replyBar.hidden = !m; if (!m) return;
    const p = people.get(m.sender_id);
    replyBar.append(h('div', { class: 'rb-body' }, h('b', null, m.sender_id === state.me.id ? 'أنت' : (p?.display_name || p?.username || 'عضو')), h('div', { class: 'muted ellipsis' }, previewOf(m))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إلغاء الرد', onclick: () => setReply(null) }, icon('close', 18)));
    input.focus();
  }

  function jumpTo(id) {
    const el = els.get(id); if (!el) return toast('الرسالة الأصلية أقدم من المحمّلة');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
  }

  function bubbleFor(m) {
    const mine = m.sender_id === state.me.id; const sender = people.get(m.sender_id);
    const kids = [];
    if (!mine) kids.push(h('b', { class: 'group-sender' }, sender?.display_name || sender?.username || 'عضو'));
    if (m.reply_to) {
      const q = seen.get(m.reply_to); const qp = q && people.get(q.sender_id);
      kids.push(h('button', { class: 'reply-quote', type: 'button', onclick: (e) => { e.stopPropagation(); jumpTo(m.reply_to); } },
        h('b', null, q ? (q.sender_id === state.me.id ? 'أنت' : (qp?.display_name || qp?.username || 'عضو')) : 'رسالة'), h('span', { class: 'ellipsis' }, q ? previewOf(q) : 'رسالة محذوفة أو أقدم')));
    }
    if (m.sticker) { const st = stickerParts(m.sticker); kids.push(h('div', { class: 'sticker-msg', style: { '--sc': st.color || '#2f6bff' } }, h('span', { class: 'se' }, st.emoji), st.label ? h('span', { class: 'sl' }, st.label) : null)); }
    if (m.audio_url) kids.push(voiceBubble(m, { mine }));
    if (m.media_url) kids.push(m.media_type === 'video' ? h('video', { src: m.media_url, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { src: m.media_url, alt: '', onclick: () => viewImage(m.media_url) }));
    if (m.body) kids.push(h('div', { class: 'b-text' }, m.body));
    kids.push(h('div', { class: 'b-meta' }, hhmm(m.created_at)));
    const el = h('div', { class: 'bubble ' + (mine ? 'me' : 'them') + (m.sticker ? ' bare' : '') + (m.audio_url ? ' has-voice' : ''), 'data-id': m.id }, ...kids);
    el.addEventListener('click', (e) => { if (e.target.closest('button,video,img,.voice-msg,a')) return; openMsgMenu(m); });
    let pt = null; el.addEventListener('pointerdown', () => { pt = setTimeout(() => openMsgMenu(m), 450); });
    ['pointerup', 'pointerleave', 'pointermove'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(pt)));
    return el;
  }

  function openMsgMenu(m) {
    const mine = m.sender_id === state.me.id;
    actionSheet('الرسالة', [
      { label: 'رد', icon: 'reply', run: () => setReply(m) },
      m.body ? { label: 'نسخ النص', icon: 'copy', run: async () => { try { await navigator.clipboard.writeText(m.body); toast('تم النسخ', 'ok'); } catch { toast('تعذّر النسخ', 'err'); } } } : null,
      (mine || membership.role === 'admin') ? { label: mine ? 'حذف الرسالة' : 'حذف الرسالة (كمشرف)', icon: 'trash', danger: true, run: async () => {
        if (!(await confirmBox('حذف هذه الرسالة لجميع أعضاء المجموعة؟', 'حذف', true))) return;
        try { await sb.from('group_messages').delete().eq('id', m.id); removeMsg(m.id); toast('تم الحذف', 'ok'); } catch (e) { toast(groupError(e), 'err'); }
      } } : null,
    ]);
  }

  function removeMsg(id) { const el = els.get(id); if (el) el.remove(); els.delete(id); seen.delete(id); }

  function addRows(rows) {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 160; const first = seen.size === 0; let added = false;
    rows.forEach((m) => { if (m && !seen.has(m.id)) seen.set(m.id, m); });
    rows.forEach((m) => {
      if (!m || els.has(m.id)) return;
      const day = dayLabel(m.created_at);
      if (day !== lastDay) { lastDay = day; messages.append(h('div', { class: 'day-sep' }, day)); }
      const el = bubbleFor(m); els.set(m.id, el); messages.append(el); added = true;
    });
    if (added && (nearBottom || first)) messages.scrollTop = messages.scrollHeight;
  }

  async function poll() {
    if (busy || stopped) return; busy = true;
    try {
      const rows = (await sb.from('group_messages').select('*').eq('group_id', params.id).order('created_at', { ascending: false }).limit(80)).reverse();
      if (rows.length) { // drop messages deleted by others inside the loaded window
        const ids = new Set(rows.map((r) => r.id)); const oldest = rows[0].created_at;
        [...seen.values()].forEach((m) => { if (m.created_at >= oldest && !ids.has(m.id) && !String(m.id).startsWith('tmp')) removeMsg(m.id); });
      }
      addRows(rows);
    } catch (error) { if (!messages.children.length) messages.append(h('div', { class: 'empty small' }, groupError(error))); }
    finally { busy = false; }
  }

  async function send(extra = {}) {
    const body = extra.sticker || extra.audio_url || extra.media_url ? '' : input.value.trim();
    if (!body && !extra.sticker && !extra.audio_url && !extra.media_url) return;
    if (sending) return; sending = true; sendBtn.disabled = true;
    try {
      const row = { group_id: params.id, sender_id: state.me.id, body, ...extra };
      if (replyTo) row.reply_to = replyTo.id;
      await sb.from('group_messages').insert(row);
      if (!extra.sticker && !extra.audio_url && !extra.media_url) { input.value = ''; input.style.height = ''; syncBtns(); }
      setReply(null); await poll(); messages.scrollTop = messages.scrollHeight;
    } catch (error) { toast(groupError(error), 'err'); }
    finally { sending = false; sendBtn.disabled = false; }
  }

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try { toast('جارٍ الرفع...'); const m = await uploadMedia('chat', f); await send({ media_url: m.url, media_type: m.type }); } catch (error) { toast(groupError(error), 'err'); }
  });

  // ---- voice message: tap mic -> record -> send / delete ----
  let rec = null, recTimer = null;
  function endRec() { clearInterval(recTimer); recTimer = null; rec = null; micBtn.hidden = false; [attachBtn, stickBtn, input].forEach((e) => (e.hidden = false)); document.querySelector('.rec-bar.grp')?.remove(); syncBtns(); }
  async function startRec() {
    if (rec) return;
    rec = createRecorder();
    try { await rec.start(); } catch { rec = null; return toast('لم يُسمح باستخدام الميكروفون', 'err'); }
    [attachBtn, stickBtn, input, sendBtn, micBtn].forEach((e) => (e.hidden = true));
    const time = h('span', { class: 'rec-time' }, '0:00');
    const bar = h('div', { class: 'rec-bar grp' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'حذف التسجيل', onclick: () => { rec?.cancel(); endRec(); } }, icon('trash', 22)),
      h('i', { class: 'rec-dot' }), time, h('span', { class: 'grow' }),
      h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': 'إرسال التسجيل', onclick: async () => {
        const r = await rec.stop(); endRec();
        if (!r || r.ms < 700) return toast('التسجيل قصير جداً');
        try {
          toast('جارٍ إرسال التسجيل...');
          const ext = r.type.includes('mp4') ? 'm4a' : r.type.includes('ogg') ? 'ogg' : 'webm';
          const url = await uploadAudio('chat', r.blob, ext);
          await send({ audio_url: url, audio_ms: r.ms, audio_wave: r.wave });
        } catch (error) { toast(groupError(error), 'err'); }
      } }, icon('send', 22)));
    chatBar.append(bar);
    recTimer = setInterval(() => { time.textContent = fmtDur(rec?.elapsed || 0); if ((rec?.elapsed || 0) > 5 * 60000) bar.querySelector('.accent').click(); }, 250);
  }

  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; syncBtns(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  function openGroupMenu() {
    actionSheet(group.name, [
      { label: 'معلومات المجموعة', icon: 'users', run: () => (location.hash = '#/group/' + params.id + '/info') },
      { label: 'بحث في المحادثة', icon: 'search', run: () => openGroupSearch(params.id, people) },
    ]);
  }

  function attachRealtime() {
    if (channel || !rt) return;
    channel = rt.channel('group-' + params.id, { pg: [{ event: 'INSERT', table: 'group_messages', filter: 'group_id=eq.' + params.id }] })
      .onPg('INSERT', 'group_messages', (d) => { if (d.record?.group_id === params.id) addRows([d.record]); }).onReady(poll).subscribe();
  }
  attachRealtime(); bus.addEventListener('rt:ready', attachRealtime);
  await poll();
  let ticks = 0;
  const timer = setInterval(() => { if (document.hidden) return; ticks++; if (!channel?.ready || ticks % 4 === 0) poll(); }, 5000);

  return () => { stopped = true; clearInterval(timer); rec?.cancel(); clearInterval(recTimer); bus.removeEventListener('rt:ready', attachRealtime); channel?.unsubscribe(); root.classList.remove('chat-root', 'group-chat-root'); };
}
