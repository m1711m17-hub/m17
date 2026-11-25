import { h, icon, avatar, clear, toast, timeAgo, hhmm, dayLabel, sheet, actionSheet, confirmBox } from '../lib/dom.js';
import { sb, state, uploadMedia, uploadAudio, refreshBadges, PROFILE_MINI, feature, bus, rt, rtLive, pairName, presenceOf, presenceMany, watchPresence } from '../api.js';
import { POLL_CHAT_MS } from '../config.js';
import { headerBar, bellButton } from './home.js';
import { userRow } from './explore.js';
import { blockUser, reportDialog, viewImage } from './postcard.js';
import { createRecorder, recorderSupported, voiceBubble, fmtDur, decodeWave } from '../lib/voice.js';
import { stickerPanel } from './stickers.js';
import { openCamera, cameraSupported } from './camera.js';
import { placeCall } from './calls.js';

function readCallEvent(body) {
  const m = /^NEXORA_CALL\|([^|]+)\|(audio|video)\|(completed|missed|rejected|cancelled)\|(\d+)$/.exec(String(body || ''));
  return m ? { id: m[1], kind: m[2], outcome: m[3], duration: Number(m[4]) } : null;
}
function callEventPreview(e) {
  if (!e) return '';
  const kind = e.kind === 'video' ? 'مكالمة فيديو' : 'مكالمة صوتية';
  const state = e.outcome === 'completed' ? 'تمت' : e.outcome === 'missed' ? 'فائتة' : e.outcome === 'rejected' ? 'مرفوضة' : 'ملغاة';
  const duration = e.duration ? ' · ' + String(Math.floor(e.duration / 60)).padStart(2, '0') + ':' + String(e.duration % 60).padStart(2, '0') : '';
  return '📞 ' + kind + ' · ' + state + duration;
}
function lastText(c) {
  const call = readCallEvent(c.last_body);
  if (call) return callEventPreview(call);
  if (c.last_kind === 'deleted') return '🚫 تم حذف هذه الرسالة';
  if (c.last_kind === 'audio') return '🎙️ رسالة صوتية';
  if (c.last_kind === 'sticker') return '🙂 ملصق';
  if (c.last_kind === 'story_reply') return '↩️ رد على حالة' + (c.last_body ? ': ' + c.last_body : '');
  return c.last_body || (c.last_media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة');
}

export async function messagesPage(root) {
  const list = h('div', { class: 'card-list' });
  const newBtn = h('button', { class: 'icon-btn', 'aria-label': 'محادثة جديدة', onclick: newChat }, icon('edit', 22));
  const logBtn = h('button', { class: 'icon-btn', 'aria-label': 'سجل المكالمات', onclick: () => (location.hash = '#/calls') }, icon('phone', 22));
  const groupsBtn = h('button', { class: 'icon-btn', 'aria-label': 'المجموعات', onclick: () => (location.hash = '#/groups') }, icon('users', 22));
  root.append(headerBar('الرسائل', { right: [groupsBtn, logBtn, newBtn, bellButton()] }), h('div', { class: 'page' }, list));

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

  let unwatchList = () => {};
  async function load() {
    try {
      const rows = await sb.rpc('my_conversations');
      clear(list);
      if (!rows.length) list.append(h('div', { class: 'empty' }, icon('chat', 44), h('h3', null, 'لا توجد محادثات'), h('p', null, 'ابدأ محادثة جديدة مع أي مستخدم بالضغط على زر القلم.')));
      let pres = new Map();
      try { (await sb.rpc('get_presence', { ids: rows.map((r) => r.partner_id) }) || []).forEach((p) => pres.set(p.user_id, p)); } catch {}
      unwatchList(); unwatchList = watchPresence(rows.map((r) => r.partner_id), (r) => { const d = list.querySelector(`.online-dot[data-uid="${r.user_id}"]`); if (d) d.hidden = !r.online; });
      rows.forEach((c) => list.append(h('a', { class: 'user-row conv', href: `#/chat/${c.username}` }, h('span', { class: 'av-wrap' }, avatar(c, 52), h('i', { class: 'online-dot', 'data-uid': c.partner_id, hidden: !pres.get(c.partner_id)?.online })),
        h('div', { class: 'grow' }, h('div', { class: 'row between' }, h('b', null, c.display_name || c.username), h('span', { class: 'muted small' }, timeAgo(c.last_at))),
          h('div', { class: 'row between' }, h('span', { class: 'muted ellipsis' }, (c.last_from_me ? 'أنت: ' : '') + lastText(c)), Number(c.unread_count) ? h('span', { class: 'pill' }, c.unread_count) : null)))));
    } catch (e) { clear(list).append(h('div', { class: 'empty' }, e.message)); }
  }
  await load();
  let t = null; const soon = () => { clearTimeout(t); t = setTimeout(load, 350); };
  ['rt:message', 'rt:message-update', 'rt:ready', 'm17:resume'].forEach((e) => bus.addEventListener(e, soon));
  const iv = setInterval(() => { if (!document.hidden && !rtLive()) load(); }, 6000);
  return () => { unwatchList(); clearInterval(iv); clearTimeout(t); ['rt:message', 'rt:message-update', 'rt:ready', 'm17:resume'].forEach((e) => bus.removeEventListener(e, soon)); };
}

export async function chatPage(root, params) {
  const peer = await sb.from('profiles').select(PROFILE_MINI).eq('username', params.username).one();
  if (!peer) { root.append(headerBar('محادثة', { back: true }), h('div', { class: 'empty' }, 'المستخدم غير موجود')); return; }
  if (peer.id === state.me.id) { location.hash = '#/messages'; return; }
  const DRAFT = 'm17.draft.' + peer.id;
  const draftGet = () => { try { return localStorage.getItem(DRAFT) || ''; } catch { return ''; } };
  const draftSet = (v) => { try { v ? localStorage.setItem(DRAFT, v) : localStorage.removeItem(DRAFT); } catch {} };

  const msgs = h('div', { class: 'chat-msgs' });
  const input = h('textarea', { class: 'input chat-input', rows: 1, maxlength: 2000, placeholder: 'اكتب رسالة...' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
  const keepFocus = (e) => e.preventDefault(); // pressing a button must not hide the keyboard / blur the field
  const sendBtn = h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': 'إرسال', onpointerdown: keepFocus }, icon('send', 22));
  const attach = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إرفاق من المعرض', onclick: () => fileIn.click() }, icon('image', 22));
  const camBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الكاميرا', onclick: () => openCamera({ onSend: async (f) => { toast('جارٍ الرفع...'); const m = await whileSending(f.type.startsWith('video') ? 'video' : 'image', () => uploadMedia('chat', f)); await send({ media_url: m.url, media_type: m.type }); } }) }, icon('camera', 22));
  const stickBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ملصقات', onpointerdown: keepFocus, onclick: () => { input.blur(); panel.toggle(); stickBtn.classList.toggle('on', panel.isOpen); } }, icon('smile', 22));
  const panel = stickerPanel({ onPick: (st) => { panel.close(); stickBtn.classList.remove('on'); send({ sticker: `${st.emoji}|${st.label}|${st.color}` }); } });
  const micBtn = h('button', { class: 'icon-btn accent mic', type: 'button', 'aria-label': 'تسجيل رسالة صوتية (اضغط مطولاً)' }, icon('mic', 22));
  const recBar = h('div', { class: 'rec-bar', hidden: true });
  const statusEl = h('div', { class: 'chat-status muted small' });
  const replyBar = h('div', { class: 'reply-bar', hidden: true });
  const selBar = h('div', { class: 'sel-bar', hidden: true });
  const quoteCache = new Map();
  let replyTo = null, selMode = false; const sel = new Set();
  let seen = new Map(), lastDay = '', stop = false, busy = false, peerKind = 'idle', peerKindTimer = null, pres = null;

  let chatBar;
  root.classList.add('chat-root');
  root.append(selBar, h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', type: 'button', onclick: () => (location.hash = '#/messages'), 'aria-label': 'رجوع' }, icon('back', 22)),
    h('a', { class: 'row gap grow', href: `#/u/${peer.username}` }, h('span', { class: 'av-wrap' }, avatar(peer, 38), h('i', { class: 'online-dot', hidden: true })), h('div', { class: 'grow' }, h('b', null, peer.display_name || peer.username), statusEl)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'اتصال صوتي', onclick: () => placeCall(peer, 'audio') }, icon('phone', 22)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'اتصال فيديو', onclick: () => placeCall(peer, 'video') }, icon('video', 22)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'المزيد', onclick: () => actionSheet('@' + peer.username, [
      { label: 'عرض الملف الشخصي', icon: 'user', run: () => (location.hash = `#/u/${peer.username}`) },
      { label: 'إبلاغ', icon: 'flag', run: () => reportDialog('user', peer.id) },
      { label: 'حظر المستخدم', icon: 'block', danger: true, run: async () => { if (await blockUser(peer)) location.hash = '#/messages'; } },
    ]) }, icon('more', 22))),
    msgs,
    panel,
    replyBar,
    chatBar = h('div', { class: 'chat-bar' }, attach, cameraSupported() ? camBtn : null, stickBtn, input, sendBtn, micBtn, recBar, fileIn));

  // ---- status line: typing / recording / online / last seen ----
  const KINDS = { typing: ['typing', 'يكتب الآن'], recording: ['rec', '🎙️ يسجل مقطعاً صوتياً'], image: ['sendk', '📷 يرسل صورة'], video: ['sendk', '🎬 يرسل فيديو'], sending: ['sendk', 'يرسل رسالة'] };
  function paintStatus() {
    const dot = root.querySelector('.topbar .online-dot');
    if (KINDS[peerKind]) {
      statusEl.className = 'chat-status small busy ' + KINDS[peerKind][0]; statusEl.textContent = KINDS[peerKind][1];
      statusEl.append(h('span', { class: 'dots' }, h('i'), h('i'), h('i'))); if (dot) dot.hidden = false; return;
    }
    if (pres?.online && pres.in_call) { statusEl.className = 'chat-status small incall'; statusEl.textContent = pres.in_call === 'video' ? '📹 داخل مكالمة فيديو' : '📞 داخل مكالمة صوتية'; if (dot) dot.hidden = false; return; }
    if (pres?.online) { statusEl.className = 'chat-status small online'; statusEl.textContent = 'متصل الآن'; if (dot) dot.hidden = false; return; }
    if (dot) dot.hidden = true;
    statusEl.className = 'chat-status muted small';
    statusEl.textContent = pres?.last_seen ? 'آخر ظهور ' + timeAgo(pres.last_seen) : '@' + peer.username;
  }
  function setPeerKind(k) {
    clearTimeout(peerKindTimer); peerKind = KINDS[k] ? k : 'idle'; paintStatus();
    if (peerKind !== 'idle') peerKindTimer = setTimeout(() => { peerKind = 'idle'; paintStatus(); }, 6000); // auto-clear if the "idle" signal is lost
  }
  async function refreshPresence() { pres = await presenceOf(peer.id); paintStatus(); }
  paintStatus();
  const unwatch = watchPresence([peer.id], (r) => { if (r && r.user_id === peer.id) { pres = { ...(pres || {}), online: !!r.online, last_seen: r.last_seen, in_call: r.in_call }; paintStatus(); } });

  // ---- my status broadcast (instant via Realtime, RPC fallback) ----
  const chan = rt ? rt.channel(pairName(state.me.id, peer.id)).onBroadcast('status', (p) => { if (p?.from === peer.id) setPeerKind(p.kind); }).subscribe() : null;
  let lastSent = '', lastSentAt = 0;
  function sendStatus(kind) {
    const now = Date.now();
    if (kind === lastSent && kind !== 'idle' && now - lastSentAt < 2500) return;
    lastSent = kind; lastSentAt = now;
    if (chan && chan.joined) chan.broadcast('status', { from: state.me.id, kind });
    if (!rtLive()) sb.rpc('set_chat_status', { peer: peer.id, k: kind }).catch(() => {});
  }
  async function whileSending(kind, fn) { sendStatus(kind); const t = setInterval(() => sendStatus(kind), 2600); try { return await fn(); } finally { clearInterval(t); sendStatus('idle'); } }
  let idleTimer = null;
  const typingPulse = () => { sendStatus('typing'); clearTimeout(idleTimer); idleTimer = setTimeout(() => sendStatus('idle'), 3500); };

  // ---- bubbles ----
  function stickerParts(s) { const [emoji, label, color] = String(s).split('|'); return { emoji, label, color }; }
  function previewOf(m) {
    if (!m) return 'رسالة';
    if (m.deleted_all) return '🚫 تم حذف هذه الرسالة';
    const call = readCallEvent(m.body); if (call) return callEventPreview(call);
    if (m.audio_url) return '🎙️ رسالة صوتية';
    if (m.sticker) return '🙂 ملصق' + (stickerParts(m.sticker).label ? ' · ' + stickerParts(m.sticker).label : '');
    if (m.body) return m.body.length > 90 ? m.body.slice(0, 90) + '…' : m.body;
    return m.media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة';
  }
  const nameOf = (m) => (m.sender_id === state.me.id ? 'أنت' : (peer.display_name || peer.username));
  function paintQuote(el, q) {
    el.replaceChildren(h('b', null, q ? nameOf(q) : 'رسالة'), h('span', null, q ? previewOf(q) : q === undefined ? '…' : 'الرسالة الأصلية غير متاحة'));
    el.classList.toggle('gone', q === null || !!q?.deleted_all);
    if (q && !q.deleted_all && q.media_url && q.media_type !== 'video') el.append(h('img', { src: q.media_url, alt: '' }));
  }
  function jumpTo(id) {
    const el = msgs.querySelector(`[data-id="${id}"]`);
    if (!el) return toast('الرسالة الأصلية قديمة وغير محمّلة', 'err');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
  }
  async function fillQuotes(rows) {
    const need = [...new Set(rows.filter((m) => m.reply_to && !seen.has(m.reply_to) && !quoteCache.has(m.reply_to)).map((m) => m.reply_to))];
    if (need.length) {
      try { (await sb.from('messages').select('*').in('id', need)).forEach((q) => quoteCache.set(q.id, q)); } catch {}
      need.forEach((id) => { if (!quoteCache.has(id)) quoteCache.set(id, null); });
    }
    msgs.querySelectorAll('.reply-quote[data-q]').forEach((el) => { paintQuote(el, seen.get(el.dataset.q) || quoteCache.get(el.dataset.q)); });
  }
  function bubble(m, pending = false) {
    const el = bubbleInner(m, pending); wireBubble(el, m, pending); return el;
  }
  function bubbleInner(m, pending = false) {
    const mine = m.sender_id === state.me.id;
    const kids = [];
    const call = readCallEvent(m.body);
    if (m.deleted_all) {
      kids.push(h('div', { class: 'b-text deleted-note' }, '🚫 تم حذف هذه الرسالة'));
      kids.push(h('div', { class: 'b-meta' }, hhmm(m.created_at)));
      return h('div', { class: 'bubble ' + (mine ? 'me' : 'them') + ' deleted', 'data-id': m.id }, ...kids);
    }
    if (m.forwarded) kids.push(h('div', { class: 'fwd-label' }, icon('forward', 13), ' معاد توجيهها'));
    if (m.reply_to) { const qe = h('div', { class: 'reply-quote', 'data-q': m.reply_to, onclick: (e) => { e.stopPropagation(); if (!selMode) jumpTo(m.reply_to); } }); paintQuote(qe, seen.get(m.reply_to) || quoteCache.get(m.reply_to)); kids.push(qe); }
    if (call) {
      const kind = call.kind === 'video' ? 'مكالمة فيديو' : 'مكالمة صوتية';
      const outcome = call.outcome === 'completed' ? 'تمت المكالمة' : call.outcome === 'missed' ? (mine ? 'لم يتم الرد' : 'مكالمة فائتة') : call.outcome === 'rejected' ? 'تم رفض المكالمة' : 'تم إلغاء المكالمة';
      const duration = call.duration ? String(Math.floor(call.duration / 60)).padStart(2, '0') + ':' + String(call.duration % 60).padStart(2, '0') : '';
      kids.push(h('div', { class: 'call-event-card' },
        h('span', { class: 'call-event-icon' }, icon(call.kind === 'video' ? 'video' : 'phone', 21)),
        h('div', { class: 'call-event-copy' },
          h('b', { class: 'call-event-title' }, kind + (mine ? ' صادرة' : ' واردة')),
          h('span', { class: 'call-event-sub' }, outcome + (duration ? ' · ' + duration : '')))));
    } else {
      if (m.story_id || m.story_preview) kids.push(h('div', { class: 'story-quote' }, m.story_preview ? h('img', { src: m.story_preview, alt: '' }) : null, h('span', null, mine ? 'رددت على حالة' : 'رد على حالتك')));
      if (m.sticker) { const st = stickerParts(m.sticker); kids.push(h('div', { class: 'sticker-msg', style: { '--sc': st.color || '#2f6bff' } }, h('span', { class: 'se' }, st.emoji), st.label ? h('span', { class: 'sl' }, st.label) : null)); }
      if (m.audio_url) kids.push(voiceBubble(m, { mine }));
      if (m.media_url) kids.push(m.media_type === 'video' ? h('video', { src: m.media_url, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { src: m.media_url, alt: '', onclick: () => viewImage(m.media_url) }));
      if (m.body) kids.push(h('div', { class: 'b-text' }, m.body));
    }
    kids.push(h('div', { class: 'b-meta' }, pending ? '…' : hhmm(m.created_at), mine && m.read_at ? ' ✓✓' : ''));
    return h('div', { class: 'bubble ' + (mine ? 'me' : 'them') + (call ? ' call-event' : '') + (m.sticker ? ' bare' : '') + (m.audio_url ? ' has-voice' : '') + (pending ? ' pending' : ''), 'data-id': m.id }, ...kids);
  }

  // ---- message actions: long-press menu, reply, forward, delete, copy, multi-select ----
  const isReal = (m) => m && !String(m.id).startsWith('tmp');
  const copyText = async (t) => {
    try { await navigator.clipboard.writeText(t); } catch { const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = t; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); }
    toast('تم النسخ');
  };
  function wireBubble(el, m, pending) {
    if (pending || !isReal(m)) return;
    let timer = null, sx0 = 0, sy0 = 0, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('pressing'); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      fired = false; sx0 = e.clientX; sy0 = e.clientY; el.classList.add('pressing');
      timer = setTimeout(() => { fired = true; cancel(); try { navigator.vibrate?.(15); } catch {} if (selMode) toggleSel(m.id); else openMenu(seen.get(m.id) || m); }, 430);
    });
    el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx0, e.clientY - sy0) > 10) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => el.addEventListener(n, cancel));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    el.addEventListener('click', (e) => { if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); return; } if (selMode) { e.preventDefault(); e.stopPropagation(); toggleSel(m.id); } }, true);
  }
  function openMenu(m) {
    const mine = m.sender_id === state.me.id, call = !!readCallEvent(m.body);
    if (m.deleted_all) return actionSheet('خيارات الرسالة', [{ label: 'حذف لديّ', icon: 'trash', danger: true, run: () => delMine([m.id]) }, { label: 'تحديد', icon: 'selectall', run: () => enterSel(m.id) }]);
    actionSheet('خيارات الرسالة', [
      !call ? { label: 'رد', icon: 'reply', run: () => startReply(m) } : null,
      !call ? { label: 'إعادة توجيه', icon: 'forward', run: () => forwardDialog([m]) } : null,
      m.body && !call ? { label: 'نسخ', icon: 'copy', run: () => copyText(m.body) } : null,
      { label: 'تحديد', icon: 'selectall', run: () => enterSel(m.id) },
      { label: 'حذف لديّ', icon: 'trash', danger: true, run: () => delMine([m.id]) },
      mine ? { label: 'حذف لدى الجميع', icon: 'trash', danger: true, run: () => delAll([m.id]) } : null,
    ]);
  }
  // reply
  function startReply(m) {
    replyTo = m; replyBar.hidden = false;
    replyBar.replaceChildren(h('span', { class: 'rb-ic' }, icon('reply', 18)), h('div', { class: 'rb-txt' }, h('b', null, nameOf(m)), h('span', null, previewOf(m))),
      m.media_url && m.media_type !== 'video' ? h('img', { src: m.media_url, alt: '' }) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إلغاء الرد', onclick: cancelReply }, icon('close', 18)));
    input.focus({ preventScroll: true });
  }
  function cancelReply() { replyTo = null; replyBar.hidden = true; replyBar.replaceChildren(); }
  // selection
  function enterSel(id) { selMode = true; root.classList.add('sel-on'); msgs.classList.add('selecting'); selBar.hidden = false; panel.close?.(); toggleSel(id, true); }
  function exitSel() { selMode = false; sel.clear(); root.classList.remove('sel-on'); msgs.classList.remove('selecting'); selBar.hidden = true; msgs.querySelectorAll('.bubble.selected').forEach((b) => b.classList.remove('selected')); }
  function toggleSel(id, force) {
    const el = msgs.querySelector(`[data-id="${id}"]`); if (!el) return;
    const on = force ?? !sel.has(id);
    on ? sel.add(id) : sel.delete(id); el.classList.toggle('selected', on);
    if (!sel.size) return exitSel();
    paintSelBar();
  }
  const selRows = () => [...sel].map((id) => seen.get(id)).filter(Boolean).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
  function paintSelBar() {
    const rows = selRows(), allMine = rows.every((r) => r.sender_id === state.me.id), canFwd = rows.every((r) => !r.deleted_all && !readCallEvent(r.body)), texts = rows.filter((r) => r.body && !r.deleted_all);
    selBar.replaceChildren(
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إلغاء التحديد', onclick: exitSel }, icon('close', 22)),
      h('b', { class: 'grow' }, `${rows.length} محددة`),
      texts.length ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'نسخ', onclick: () => { copyText(texts.map((r) => r.body).join('\n')); exitSel(); } }, icon('copy', 22)) : null,
      canFwd ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إعادة توجيه', onclick: () => forwardDialog(rows) }, icon('forward', 22)) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'حذف', onclick: () => deleteChoice(rows, allMine) }, icon('trash', 22)));
  }
  // delete
  function removeEl(id) { msgs.querySelector(`[data-id="${id}"]`)?.remove(); seen.delete(id); }
  async function delMine(ids) {
    ids = ids.filter((i) => isReal({ id: i }));
    if (!(await confirmBox(ids.length > 1 ? `حذف ${ids.length} رسائل من محادثتك فقط؟` : 'حذف هذه الرسالة من محادثتك فقط؟ سيبقى الطرف الآخر يراها.', 'حذف لديّ', true))) return;
    try { await sb.rpc('hide_messages', { p_ids: ids }); ids.forEach(removeEl); exitSel(); refreshBadges(); } catch (e) { toast(e.message || 'تعذّر الحذف', 'err'); }
  }
  async function delAll(ids) {
    ids = ids.filter((i) => isReal({ id: i }) && seen.get(i)?.sender_id === state.me.id);
    if (!ids.length) return toast('يمكنك الحذف لدى الجميع لرسائلك فقط', 'err');
    if (!(await confirmBox(ids.length > 1 ? `سيتم حذف ${ids.length} رسائل لدى الجميع ولا يمكن التراجع. متأكد؟` : 'سيتم حذف هذه الرسالة لدى الجميع ولا يمكن التراجع. متأكد؟', 'حذف لدى الجميع', true))) return;
    try {
      const n = await sb.rpc('delete_messages_all', { p_ids: ids });
      if (!n) toast('لم تُحذف أي رسالة', 'err');
      ids.forEach((i) => { const old = seen.get(i); if (old) markDeleted({ ...old, deleted_all: true, body: '', media_url: null, audio_url: null, sticker: null }); });
      exitSel();
    } catch (e) { toast(e.message || 'تعذّر الحذف', 'err'); }
  }
  function deleteChoice(rows, allMine) {
    const ids = rows.map((r) => r.id);
    actionSheet(`حذف ${rows.length} ${rows.length > 1 ? 'رسائل' : 'رسالة'}`, [
      { label: 'حذف لديّ', icon: 'trash', danger: true, run: () => delMine(ids) },
      allMine ? { label: 'حذف لدى الجميع', icon: 'trash', danger: true, run: () => delAll(ids) } : null,
    ]);
  }
  function markDeleted(m) {
    const old = seen.get(m.id); seen.set(m.id, { ...(old || {}), ...m });
    const el = msgs.querySelector(`[data-id="${m.id}"]`); if (el) { const n = bubble(seen.get(m.id)); if (sel.has(m.id)) sel.delete(m.id); el.replaceWith(n); }
    msgs.querySelectorAll('.reply-quote[data-q="' + m.id + '"]').forEach((q) => paintQuote(q, seen.get(m.id)));
    if (selMode && !sel.size) exitSel(); else if (selMode) paintSelBar();
  }
  // forward
  async function forwardDialog(rows) {
    rows = rows.filter((r) => !r.deleted_all && !readCallEvent(r.body));
    if (!rows.length) return toast('لا يمكن إعادة توجيه هذه الرسائل', 'err');
    let convs = []; try { convs = await sb.rpc('my_conversations'); } catch {}
    const chosen = new Map();
    sheet('إعادة توجيه إلى', (body, close) => {
      const q = h('input', { class: 'input', placeholder: 'ابحث في محادثاتك...' });
      const list = h('div', { class: 'fwd-list' });
      const go = h('button', { class: 'btn primary fwd-go', type: 'button', disabled: true }, 'إرسال');
      const paint = () => {
        const t = q.value.trim().toLowerCase(); clear(list);
        const shown = convs.filter((c) => !t || (c.display_name || '').toLowerCase().includes(t) || (c.username || '').toLowerCase().includes(t));
        if (!shown.length) list.append(h('div', { class: 'empty small' }, 'لا توجد محادثات مطابقة'));
        shown.forEach((c) => list.append(h('button', { class: 'user-row fwd-row' + (chosen.has(c.partner_id) ? ' on' : ''), type: 'button', onclick: () => { chosen.has(c.partner_id) ? chosen.delete(c.partner_id) : chosen.set(c.partner_id, c); go.disabled = !chosen.size; go.textContent = chosen.size ? `إرسال (${chosen.size})` : 'إرسال'; paint(); } },
          avatar(c, 40), h('b', { class: 'grow' }, c.display_name || c.username), h('span', { class: 'fwd-check' }, chosen.has(c.partner_id) ? icon('check', 16) : null))));
      };
      q.oninput = paint; paint();
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'جارٍ الإرسال...'; let ok = 0, bad = 0;
        for (const c of chosen.values()) {
          try {
            for (const r of rows) {
              const row = { sender_id: state.me.id, receiver_id: c.partner_id, body: r.body || '', forwarded: true };
              ['media_url', 'media_type', 'audio_url', 'audio_ms', 'audio_wave', 'sticker'].forEach((k) => { if (r[k] != null) row[k] = r[k]; });
              await sb.from('messages').insert(row);
            }
            ok++;
          } catch { bad++; }
        }
        close(); exitSel();
        toast(bad ? `أُعيد التوجيه إلى ${ok} وفشل ${bad}` : `تمت إعادة التوجيه إلى ${ok} ${ok > 1 ? 'محادثات' : 'محادثة'}`, bad ? 'err' : undefined);
        if (chosen.has(peer.id)) poll();
      };
      body.append(q, list, go);
    }, { full: true });
  }

  function addMsgs(rows) {
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 160;
    let added = false;
    for (const m of rows) {
      if (seen.has(m.id)) { const old = seen.get(m.id); if (m.deleted_all && !old.deleted_all) { markDeleted(m); continue; } if (!old.read_at && m.read_at) { old.read_at = m.read_at; const el = msgs.querySelector(`[data-id="${m.id}"] .b-meta`); if (el) el.textContent = hhmm(m.created_at) + ' ✓✓'; } continue; }
      seen.set(m.id, m); added = true;
      msgs.querySelectorAll('.pending').forEach((p) => p.remove());
      const d = dayLabel(m.created_at);
      if (d !== lastDay) { lastDay = d; msgs.append(h('div', { class: 'day-sep' }, d)); }
      msgs.append(bubble(m));
    }
    if (added && (near || seen.size === rows.length)) msgs.scrollTop = msgs.scrollHeight;
    if (rows.some((r) => r.reply_to)) fillQuotes(rows);
  }
  async function markRead() {
    try { await sb.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', peer.id).eq('receiver_id', state.me.id).is('read_at', 'null'); refreshBadges(); } catch {}
  }
  async function poll() {
    if (stop || busy) return; busy = true;
    try {
      const me = state.me.id;
      const rows = await sb.from('messages').select('*').or(`and(sender_id.eq.${me},receiver_id.eq.${peer.id}),and(sender_id.eq.${peer.id},receiver_id.eq.${me})`).order('created_at', { ascending: false }).limit(60);
      addMsgs(rows.reverse());
      if (rows.some((m) => m.receiver_id === me && !m.read_at)) await markRead();
      if (!rtLive()) { const k = await sb.rpc('get_chat_status', { peer: peer.id }).catch(() => null); if (k) setPeerKind(k); }
    } catch { /* keep going */ } finally { busy = false; }
  }

  // ---- sending (optimistic bubble, never loses the typed text) ----
  async function send(extra = {}, resolve = null) {
    const noText = !!(extra.audio_url || extra.sticker);
    const body = noText ? '' : input.value.trim();
    if (!body && !extra.media_url && !extra.audio_url && !extra.sticker) return;
    if (!feature('messages')) return toast('الرسائل متوقفة حالياً', 'err');
    const replying = replyTo; if (replying) { quoteCache.set(replying.id, replying); cancelReply(); }
    const tmp = bubble({ id: 'tmp' + Date.now() + Math.random(), sender_id: state.me.id, body, ...extra, reply_to: replying?.id, created_at: new Date().toISOString() }, true);
    tmp.classList.add('tmp'); msgs.append(tmp); msgs.scrollTop = msgs.scrollHeight;
    if (!noText) { input.value = ''; input.style.height = ''; draftSet(''); syncBtn(); }
    clearTimeout(idleTimer); sendStatus('sending');
    try {
      const real = resolve ? await resolve() : extra;
      await sb.from('messages').insert({ sender_id: state.me.id, receiver_id: peer.id, body, ...real, ...(replying ? { reply_to: replying.id } : {}) });
      await poll(); msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { tmp.remove(); if (body) { input.value = body; draftSet(body); syncBtn(); } if (replying) startReply(replying); toast(e.message, 'err'); }
    sendStatus('idle');
    if (!noText && !extra.media_url) input.focus({ preventScroll: true });
  }
  function syncBtn() { const has = input.value.trim().length > 0, can = recorderSupported(); sendBtn.hidden = !has && can; micBtn.hidden = has || !can; }

  // ---- voice recording: hold = record, release = send, slide sideways = cancel, slide up = lock (pause/resume/preview) ----
  let rec = null, rstate = 'idle', started = false, rtick = null, rstat = null, rlevels = [], rresult = null, rurl = null, sx = 0, sy = 0;
  const RW = 26; const liveBars = Array.from({ length: RW }, () => h('i'));
  const liveWave = h('div', { class: 'rec-wave' }, ...liveBars);
  const recTime = h('span', { class: 'rec-time' }, '0:00');
  const paintLive = () => liveBars.forEach((b, i) => { const v = rlevels[rlevels.length - RW + i] ?? 0.06; b.style.height = Math.round(4 + v * 26) + 'px'; });
  const rbtn = (cls, label, ic, fn) => h('button', { class: 'icon-btn ' + cls, type: 'button', 'aria-label': label, onclick: fn }, icon(ic, 22));
  function renderRec() {
    recBar.replaceChildren();
    if (rstate === 'idle') { recBar.hidden = true; chatBar.classList.remove('recording'); return; }
    recBar.hidden = false; chatBar.classList.add('recording');
    if (rstate === 'hold') recBar.append(h('i', { class: 'rec-dot' }), recTime, liveWave, h('span', { class: 'rec-hint' }, '‹ اسحب للإلغاء · ⌃ للقفل'));
    else if (rstate === 'locked') recBar.append(rbtn('danger', 'حذف', 'trash', () => discard()), h('i', { class: 'rec-dot' + (rec?.paused ? ' paused' : '') }), recTime, liveWave,
      rbtn('', rec?.paused ? 'متابعة' : 'إيقاف مؤقت', rec?.paused ? 'mic' : 'pause', () => { rec.paused ? rec.resume() : rec.pause(); sendStatus(rec.paused ? 'idle' : 'recording'); renderRec(); }),
      rbtn('', 'معاينة', 'stop', () => toPreview()), rbtn('accent', 'إرسال', 'send', () => finish(true)));
    else if (rstate === 'preview') recBar.append(rbtn('danger', 'حذف', 'trash', () => discard()), voiceBubble({ audio_url: rurl, audio_ms: rresult.ms, audio_wave: rresult.wave }, { mine: true }), rbtn('accent', 'إرسال', 'send', () => sendResult(rresult)));
  }
  function resetRec() { clearInterval(rtick); clearInterval(rstat); rtick = rstat = null; rec = null; started = false; rstate = 'idle'; rlevels = []; if (rurl) { URL.revokeObjectURL(rurl); rurl = null; } rresult = null; sendStatus('idle'); renderRec(); }
  async function beginRec() {
    if (rstate !== 'idle') return;
    rec = createRecorder(); rstate = 'hold'; rlevels = []; recTime.textContent = '0:00'; renderRec(); paintLive();
    const mine = rec; rec.onLevel = (lv) => { rlevels.push(lv); paintLive(); };
    try { await mine.start(); } catch (e) { if (rec === mine) resetRec(); toast(e?.name === 'NotAllowedError' ? 'لم تُمنح صلاحية الميكروفون. فعّلها من إعدادات التطبيق' : 'تعذّر تشغيل الميكروفون', 'err'); return; }
    if (rec !== mine || rstate === 'idle') { mine.cancel(); return; }
    started = true; navigator.vibrate?.(15);
    if (rstate === 'cancelling') { discard(); return; }
    sendStatus('recording'); rstat = setInterval(() => sendStatus('recording'), 2600);
    rtick = setInterval(() => { recTime.textContent = fmtDur(rec ? rec.elapsed : 0); if (rec && rec.elapsed > 5 * 60000) finish(true); }, 200);
  }
  function discard() { try { rec?.cancel(); } catch {} resetRec(); }
  async function toPreview() { const r = await rec.stop(); clearInterval(rtick); clearInterval(rstat); sendStatus('idle'); if (!r || r.ms < 500) return resetRec(); rresult = r; rurl = URL.createObjectURL(r.blob); rstate = 'preview'; renderRec(); }
  async function finish(send_) {
    const r = await rec.stop(); const ok = r && r.ms >= 700; if (!ok) { resetRec(); if (send_ && r) toast('الرسالة قصيرة — اضغط مطولاً للتسجيل'); return; }
    const local = URL.createObjectURL(r.blob); resetRec(); sendResult(r, local);
  }
  function sendResult(r, local) {
    const url0 = local || rurl; const keep = !local; // preview's url is revoked in resetRec; make a fresh one for the pending bubble
    const pendingUrl = keep ? URL.createObjectURL(r.blob) : url0; resetRec();
    send({ audio_url: pendingUrl, audio_ms: r.ms, audio_wave: r.wave }, async () => {
      const ext = r.type.includes('ogg') ? 'ogg' : r.type.includes('mp4') ? 'm4a' : 'webm';
      const up = await uploadAudio('voice', r.blob, ext); return { audio_url: up, audio_ms: r.ms, audio_wave: r.wave };
    }).finally(() => setTimeout(() => URL.revokeObjectURL(pendingUrl), 4000));
  }
  micBtn.style.touchAction = 'none';
  micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); sx = e.clientX; sy = e.clientY; try { micBtn.setPointerCapture(e.pointerId); } catch {} beginRec(); });
  micBtn.addEventListener('pointermove', (e) => {
    if (rstate !== 'hold') return; const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 90) { if (started) discard(); else rstate = 'cancelling'; }
    else if (dy < -70 && started) { rstate = 'locked'; navigator.vibrate?.(10); renderRec(); }
  });
  micBtn.addEventListener('pointerup', () => { if (rstate === 'hold') { if (started) finish(true); else rstate = 'cancelling'; } });
  micBtn.addEventListener('pointercancel', () => { if (rstate === 'hold') { if (started) discard(); else rstate = 'cancelling'; } });
  micBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  syncBtn();
  sendBtn.onclick = () => send();
  let draftTimer = null;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => {
    input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px';
    clearTimeout(draftTimer); draftTimer = setTimeout(() => draftSet(input.value), 250);
    syncBtn(); if (input.value.trim()) typingPulse(); else { clearTimeout(idleTimer); sendStatus('idle'); }
  });
  const saveDraftNow = () => draftSet(input.value);
  window.addEventListener('pagehide', saveDraftNow);
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try { toast('جارٍ رفع الملف...'); const m = await whileSending(f.type.startsWith('video') ? 'video' : 'image', () => uploadMedia('chat', f)); await send({ media_url: m.url, media_type: m.type }); } catch (e) { toast(e.message, 'err'); }
  };
  const saved = draftGet(); if (saved) { input.value = saved; input.style.height = Math.min(120, input.scrollHeight) + 'px'; syncBtn(); }

  // ---- live updates ----
  const onMsg = (e) => { const m = e.detail; if (m && ((m.sender_id === peer.id && m.receiver_id === state.me.id) || (m.sender_id === state.me.id && m.receiver_id === peer.id))) { addMsgs([m]); if (m.sender_id === peer.id) { setPeerKind('idle'); markRead(); } } };
  const onUpd = (e) => { const m = e.detail; if (m && ((m.sender_id === peer.id && m.receiver_id === state.me.id) || (m.sender_id === state.me.id && m.receiver_id === peer.id))) addMsgs([m]); };
  const onCatchUp = () => { poll(); refreshPresence(); };
  bus.addEventListener('rt:message', onMsg); bus.addEventListener('rt:message-update', onUpd);
  ['rt:ready', 'm17:resume'].forEach((n) => bus.addEventListener(n, onCatchUp));
  await poll(); refreshPresence();
  let n = 0;
  const iv = setInterval(() => { if (document.hidden) return; n++; if (!rtLive() || n % 7 === 0) poll(); if (n % 6 === 0) refreshPresence(); }, POLL_CHAT_MS);
  return () => {
    stop = true; try { rec?.cancel(); } catch {} clearInterval(rtick); clearInterval(rstat); clearInterval(iv); clearTimeout(idleTimer); clearTimeout(peerKindTimer); clearTimeout(draftTimer);
    saveDraftNow(); sendStatus('idle'); chan?.unsubscribe(); unwatch();
    window.removeEventListener('pagehide', saveDraftNow);
    bus.removeEventListener('rt:message', onMsg); bus.removeEventListener('rt:message-update', onUpd);
    ['rt:ready', 'm17:resume'].forEach((x) => bus.removeEventListener(x, onCatchUp));
    root.classList.remove('chat-root');
  };
}
