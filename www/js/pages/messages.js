import { h, icon, avatar, clear, toast, timeAgo, hhmm, dayLabel, sheet, actionSheet } from '../lib/dom.js';
import { sb, state, uploadMedia, uploadAudio, refreshBadges, PROFILE_MINI, feature, bus, rt, rtLive, pairName, presenceOf } from '../api.js';
import { POLL_CHAT_MS } from '../config.js';
import { headerBar, bellButton } from './home.js';
import { userRow } from './explore.js';
import { blockUser, reportDialog, viewImage } from './postcard.js';
import { createRecorder, recorderSupported, voiceBubble, fmtDur, decodeWave } from '../lib/voice.js';
import { stickerPanel } from './stickers.js';
import { openCamera, cameraSupported } from './camera.js';
import { placeCall } from './calls.js';

function lastText(c) {
  if (c.last_kind === 'audio') return '🎙️ رسالة صوتية';
  if (c.last_kind === 'sticker') return '🙂 ملصق';
  if (c.last_kind === 'story_reply') return '↩️ رد على حالة' + (c.last_body ? ': ' + c.last_body : '');
  return c.last_body || (c.last_media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة');
}

export async function messagesPage(root) {
  const list = h('div', { class: 'card-list' });
  const newBtn = h('button', { class: 'icon-btn', 'aria-label': 'محادثة جديدة', onclick: newChat }, icon('edit', 22));
  const logBtn = h('button', { class: 'icon-btn', 'aria-label': 'سجل المكالمات', onclick: () => (location.hash = '#/calls') }, icon('phone', 22));
  root.append(headerBar('الرسائل', { right: [logBtn, newBtn, bellButton()] }), h('div', { class: 'page' }, list));

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
      let pres = new Map();
      try { (await sb.rpc('get_presence', { ids: rows.map((r) => r.partner_id) }) || []).forEach((p) => pres.set(p.user_id, p)); } catch {}
      rows.forEach((c) => list.append(h('a', { class: 'user-row conv', href: `#/chat/${c.username}` }, h('span', { class: 'av-wrap' }, avatar(c, 52), pres.get(c.partner_id)?.online ? h('i', { class: 'online-dot' }) : null),
        h('div', { class: 'grow' }, h('div', { class: 'row between' }, h('b', null, c.display_name || c.username), h('span', { class: 'muted small' }, timeAgo(c.last_at))),
          h('div', { class: 'row between' }, h('span', { class: 'muted ellipsis' }, (c.last_from_me ? 'أنت: ' : '') + lastText(c)), Number(c.unread_count) ? h('span', { class: 'pill' }, c.unread_count) : null)))));
    } catch (e) { clear(list).append(h('div', { class: 'empty' }, e.message)); }
  }
  await load();
  let t = null; const soon = () => { clearTimeout(t); t = setTimeout(load, 350); };
  ['rt:message', 'rt:message-update', 'rt:ready', 'm17:resume'].forEach((e) => bus.addEventListener(e, soon));
  const iv = setInterval(() => { if (!document.hidden) load(); }, rtLive() ? 30000 : 6000);
  return () => { clearInterval(iv); clearTimeout(t); ['rt:message', 'rt:message-update', 'rt:ready', 'm17:resume'].forEach((e) => bus.removeEventListener(e, soon)); };
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
  const camBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الكاميرا', onclick: () => openCamera({ onSend: async (f) => { toast('جارٍ الرفع...'); const m = await uploadMedia('chat', f); await send({ media_url: m.url, media_type: m.type }); } }) }, icon('camera', 22));
  const stickBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ملصقات', onpointerdown: keepFocus, onclick: () => { input.blur(); panel.toggle(); stickBtn.classList.toggle('on', panel.isOpen); } }, icon('smile', 22));
  const panel = stickerPanel({ onPick: (st) => { panel.close(); stickBtn.classList.remove('on'); send({ sticker: `${st.emoji}|${st.label}|${st.color}` }); } });
  const micBtn = h('button', { class: 'icon-btn accent mic', type: 'button', 'aria-label': 'تسجيل رسالة صوتية (اضغط مطولاً)' }, icon('mic', 22));
  const recBar = h('div', { class: 'rec-bar', hidden: true });
  const statusEl = h('div', { class: 'chat-status muted small' });
  let seen = new Map(), lastDay = '', stop = false, busy = false, peerKind = 'idle', peerKindTimer = null, pres = null;

  let chatBar;
  root.classList.add('chat-root');
  root.append(h('header', { class: 'topbar' },
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
    chatBar = h('div', { class: 'chat-bar' }, attach, cameraSupported() ? camBtn : null, stickBtn, input, sendBtn, micBtn, recBar, fileIn));

  // ---- status line: typing / recording / online / last seen ----
  function paintStatus() {
    const dot = root.querySelector('.topbar .online-dot');
    if (peerKind === 'typing' || peerKind === 'recording') {
      statusEl.className = 'chat-status small typing'; statusEl.textContent = peerKind === 'typing' ? 'يكتب الآن' : '🎙️ يسجّل رسالة صوتية';
      statusEl.append(h('span', { class: 'dots' }, h('i'), h('i'), h('i'))); if (dot) dot.hidden = false; return;
    }
    if (pres?.online) { statusEl.className = 'chat-status small online'; statusEl.textContent = 'متصل الآن'; if (dot) dot.hidden = false; return; }
    if (dot) dot.hidden = true;
    statusEl.className = 'chat-status muted small';
    statusEl.textContent = pres?.last_seen ? 'آخر ظهور ' + timeAgo(pres.last_seen) : '@' + peer.username;
  }
  function setPeerKind(k) {
    clearTimeout(peerKindTimer); peerKind = k === 'typing' || k === 'recording' ? k : 'idle'; paintStatus();
    if (peerKind !== 'idle') peerKindTimer = setTimeout(() => { peerKind = 'idle'; paintStatus(); }, 6000); // auto-clear if the "idle" signal is lost
  }
  async function refreshPresence() { pres = await presenceOf(peer.id); paintStatus(); }
  paintStatus();

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
  let idleTimer = null;
  const typingPulse = () => { sendStatus('typing'); clearTimeout(idleTimer); idleTimer = setTimeout(() => sendStatus('idle'), 3500); };

  // ---- bubbles ----
  function stickerParts(s) { const [emoji, label, color] = String(s).split('|'); return { emoji, label, color }; }
  function bubble(m, pending = false) {
    const mine = m.sender_id === state.me.id;
    const kids = [];
    if (m.story_id || m.story_preview) kids.push(h('div', { class: 'story-quote' }, m.story_preview ? h('img', { src: m.story_preview, alt: '' }) : null, h('span', null, mine ? 'رددت على حالة' : 'رد على حالتك')));
    if (m.sticker) { const st = stickerParts(m.sticker); kids.push(h('div', { class: 'sticker-msg', style: { '--sc': st.color || '#2f6bff' } }, h('span', { class: 'se' }, st.emoji), st.label ? h('span', { class: 'sl' }, st.label) : null)); }
    if (m.audio_url) kids.push(voiceBubble(m, { mine }));
    if (m.media_url) kids.push(m.media_type === 'video' ? h('video', { src: m.media_url, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { src: m.media_url, alt: '', onclick: () => viewImage(m.media_url) }));
    if (m.body) kids.push(h('div', { class: 'b-text' }, m.body));
    kids.push(h('div', { class: 'b-meta' }, pending ? '…' : hhmm(m.created_at), mine && m.read_at ? ' ✓✓' : ''));
    return h('div', { class: 'bubble ' + (mine ? 'me' : 'them') + (m.sticker ? ' bare' : '') + (m.audio_url ? ' has-voice' : '') + (pending ? ' pending' : ''), 'data-id': m.id }, ...kids);
  }
  function addMsgs(rows) {
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 160;
    let added = false;
    for (const m of rows) {
      if (seen.has(m.id)) { const old = seen.get(m.id); if (!old.read_at && m.read_at) { old.read_at = m.read_at; const el = msgs.querySelector(`[data-id="${m.id}"] .b-meta`); if (el) el.textContent = hhmm(m.created_at) + ' ✓✓'; } continue; }
      seen.set(m.id, m); added = true;
      msgs.querySelectorAll('.pending').forEach((p) => p.remove());
      const d = dayLabel(m.created_at);
      if (d !== lastDay) { lastDay = d; msgs.append(h('div', { class: 'day-sep' }, d)); }
      msgs.append(bubble(m));
    }
    if (added && (near || seen.size === rows.length)) msgs.scrollTop = msgs.scrollHeight;
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
    const tmp = bubble({ id: 'tmp' + Date.now() + Math.random(), sender_id: state.me.id, body, ...extra, created_at: new Date().toISOString() }, true);
    tmp.classList.add('tmp'); msgs.append(tmp); msgs.scrollTop = msgs.scrollHeight;
    if (!noText) { input.value = ''; input.style.height = ''; draftSet(''); syncBtn(); }
    clearTimeout(idleTimer); sendStatus('idle');
    try {
      const real = resolve ? await resolve() : extra;
      await sb.from('messages').insert({ sender_id: state.me.id, receiver_id: peer.id, body, ...real });
      await poll(); msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { tmp.remove(); if (body) { input.value = body; draftSet(body); syncBtn(); } toast(e.message, 'err'); }
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
    try { toast('جارٍ رفع الملف...'); const m = await uploadMedia('chat', f); await send({ media_url: m.url, media_type: m.type }); } catch (e) { toast(e.message, 'err'); }
  };
  const saved = draftGet(); if (saved) { input.value = saved; input.style.height = Math.min(120, input.scrollHeight) + 'px'; syncBtn(); }

  // ---- live updates ----
  const onMsg = (e) => { const m = e.detail; if (m && m.sender_id === peer.id) { addMsgs([m]); setPeerKind('idle'); markRead(); pres = { ...(pres || {}), online: true, last_seen: new Date().toISOString() }; paintStatus(); } };
  const onUpd = (e) => { const m = e.detail; if (m && m.receiver_id === peer.id) addMsgs([m]); };
  const onCatchUp = () => { poll(); refreshPresence(); };
  bus.addEventListener('rt:message', onMsg); bus.addEventListener('rt:message-update', onUpd);
  ['rt:ready', 'm17:resume'].forEach((n) => bus.addEventListener(n, onCatchUp));
  await poll(); refreshPresence();
  let n = 0;
  const iv = setInterval(() => { if (document.hidden) return; n++; if (!rtLive() || n % 7 === 0) poll(); if (n % 6 === 0) refreshPresence(); }, POLL_CHAT_MS);
  return () => {
    stop = true; try { rec?.cancel(); } catch {} clearInterval(rtick); clearInterval(rstat); clearInterval(iv); clearTimeout(idleTimer); clearTimeout(peerKindTimer); clearTimeout(draftTimer);
    saveDraftNow(); sendStatus('idle'); chan?.unsubscribe();
    window.removeEventListener('pagehide', saveDraftNow);
    bus.removeEventListener('rt:message', onMsg); bus.removeEventListener('rt:message-update', onUpd);
    ['rt:ready', 'm17:resume'].forEach((x) => bus.removeEventListener(x, onCatchUp));
    root.classList.remove('chat-root');
  };
}
