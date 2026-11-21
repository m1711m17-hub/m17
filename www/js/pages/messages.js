import { h, icon, avatar, clear, toast, timeAgo, hhmm, dayLabel, sheet, actionSheet } from '../lib/dom.js';
import { sb, state, uploadMedia, refreshBadges, PROFILE_MINI, feature } from '../api.js';
import { POLL_CHAT_MS } from '../config.js';
import { headerBar, bellButton } from './home.js';
import { userRow } from './explore.js';
import { blockUser, reportDialog, viewImage } from './postcard.js';

export async function messagesPage(root) {
  const list = h('div', { class: 'card-list' });
  const newBtn = h('button', { class: 'icon-btn', 'aria-label': 'محادثة جديدة', onclick: newChat }, icon('edit', 22));
  root.append(headerBar('الرسائل', { right: [newBtn, bellButton()] }), h('div', { class: 'page' }, list));

  function newChat() {
    sheet('محادثة جديدة', (body, close) => {
      const input = h('input', { class: 'input search', placeholder: 'ابحث باسم المستخدم...', autofocus: true });
      const res = h('div', { class: 'card-list' });
      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = input.value.trim().replace(/^@/, '').replace(/[%*,()\\]/g, ' ').trim();
          if (!q) return clear(res);
          try {
            const us = (await sb.from('profiles').select(PROFILE_MINI).or(`username.ilike.*${q}*,display_name.ilike.*${q}*`).limit(15)).filter((u) => u.id !== state.me.id);
            us.sort((a, b) => (b.username === q.toLowerCase()) - (a.username === q.toLowerCase()));
            clear(res); if (!us.length) res.append(h('div', { class: 'empty small' }, 'لا نتائج'));
            us.forEach((u) => res.append(h('div', { onclick: () => { close(); location.hash = `#/chat/${u.username}`; } }, userRow({ ...u }, null))));
          } catch (e) { toast(e.message, 'err'); }
        }, 300);
      });
      body.append(input, res);
    }, { full: true });
  }

  async function load() {
    try {
      const rows = await sb.rpc('my_conversations');
      clear(list);
      if (!rows.length) list.append(h('div', { class: 'empty' }, icon('chat', 44), h('h3', null, 'لا توجد محادثات'), h('p', null, 'ابدأ محادثة جديدة مع أي مستخدم بالضغط على زر القلم.')));
      rows.forEach((c) => list.append(h('a', { class: 'user-row conv', href: `#/chat/${c.username}` }, avatar(c, 52),
        h('div', { class: 'grow' }, h('div', { class: 'row between' }, h('b', null, c.display_name || c.username), h('span', { class: 'muted small' }, timeAgo(c.last_at))),
          h('div', { class: 'row between' }, h('span', { class: 'muted ellipsis' }, c.last_body || (c.last_media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة')), Number(c.unread_count) ? h('span', { class: 'pill' }, c.unread_count) : null)))));
    } catch (e) { clear(list).append(h('div', { class: 'empty' }, e.message)); }
  }
  await load();
  const iv = setInterval(load, 6000);
  return () => clearInterval(iv);
}

export async function chatPage(root, params) {
  const peer = await sb.from('profiles').select(PROFILE_MINI).eq('username', params.username).one();
  if (!peer) { root.append(headerBar('محادثة', { back: true }), h('div', { class: 'empty' }, 'المستخدم غير موجود')); return; }
  if (peer.id === state.me.id) { location.hash = '#/messages'; return; }
  const msgs = h('div', { class: 'chat-msgs' });
  const input = h('textarea', { class: 'input chat-input', rows: 1, maxlength: 2000, placeholder: 'اكتب رسالة...' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
  const sendBtn = h('button', { class: 'icon-btn accent', 'aria-label': 'إرسال' }, icon('send', 22));
  const attach = h('button', { class: 'icon-btn', 'aria-label': 'إرفاق', onclick: () => fileIn.click() }, icon('image', 22));
  let seen = new Map(), lastDay = '', stop = false, busy = false;

  root.classList.add('chat-root');
  root.append(h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', onclick: () => (location.hash = '#/messages'), 'aria-label': 'رجوع' }, icon('back', 22)),
    h('a', { class: 'row gap grow', href: `#/u/${peer.username}` }, avatar(peer, 38), h('div', null, h('b', null, peer.display_name || peer.username), h('div', { class: 'muted small' }, '@' + peer.username))),
    h('button', { class: 'icon-btn', 'aria-label': 'المزيد', onclick: () => actionSheet('@' + peer.username, [
      { label: 'عرض الملف الشخصي', icon: 'user', run: () => (location.hash = `#/u/${peer.username}`) },
      { label: 'إبلاغ', icon: 'flag', run: () => reportDialog('user', peer.id) },
      { label: 'حظر المستخدم', icon: 'block', danger: true, run: async () => { if (await blockUser(peer)) location.hash = '#/messages'; } },
    ]) }, icon('more', 22))),
    msgs,
    h('div', { class: 'chat-bar' }, attach, input, sendBtn, fileIn));

  function bubble(m) {
    const mine = m.sender_id === state.me.id;
    const media = m.media_url && (m.media_type === 'video' ? h('video', { src: m.media_url, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { src: m.media_url, alt: '', onclick: () => viewImage(m.media_url) }));
    return h('div', { class: 'bubble ' + (mine ? 'me' : 'them'), 'data-id': m.id }, media, m.body && h('div', { class: 'b-text' }, m.body), h('div', { class: 'b-meta' }, hhmm(m.created_at), mine && m.read_at ? ' ✓✓' : ''));
  }
  function addMsgs(rows) {
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 140;
    let added = false;
    for (const m of rows) {
      if (seen.has(m.id)) { const old = seen.get(m.id); if (!old.read_at && m.read_at) { old.read_at = m.read_at; const el = msgs.querySelector(`[data-id="${m.id}"] .b-meta`); if (el) el.textContent = hhmm(m.created_at) + ' ✓✓'; } continue; }
      seen.set(m.id, m); added = true;
      const d = dayLabel(m.created_at);
      if (d !== lastDay) { lastDay = d; msgs.append(h('div', { class: 'day-sep' }, d)); }
      msgs.append(bubble(m));
    }
    if (added && (near || seen.size === rows.length)) msgs.scrollTop = msgs.scrollHeight;
  }
  async function poll() {
    if (stop || busy) return; busy = true;
    try {
      const me = state.me.id;
      const rows = await sb.from('messages').select('*').or(`and(sender_id.eq.${me},receiver_id.eq.${peer.id}),and(sender_id.eq.${peer.id},receiver_id.eq.${me})`).order('created_at', { ascending: false }).limit(60);
      addMsgs(rows.reverse());
      if (rows.some((m) => m.receiver_id === me && !m.read_at)) { await sb.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', peer.id).eq('receiver_id', me).is('read_at', 'null'); refreshBadges(); }
    } catch { /* keep polling */ } finally { busy = false; }
  }
  async function send(extra = {}) {
    const body = input.value.trim();
    if (!body && !extra.media_url) return;
    if (!feature('messages')) return toast('الرسائل متوقفة حالياً', 'err');
    sendBtn.disabled = true;
    try {
      await sb.from('messages').insert({ sender_id: state.me.id, receiver_id: peer.id, body, ...extra });
      input.value = ''; input.style.height = ''; await poll(); msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { toast(e.message, 'err'); } finally { sendBtn.disabled = false; }
  }
  sendBtn.onclick = () => send();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try { toast('جارٍ رفع الملف...'); const m = await uploadMedia('chat', f); await send({ media_url: m.url, media_type: m.type }); } catch (e) { toast(e.message, 'err'); }
  };
  await poll();
  const iv = setInterval(poll, POLL_CHAT_MS);
  return () => { stop = true; clearInterval(iv); root.classList.remove('chat-root'); };
}
