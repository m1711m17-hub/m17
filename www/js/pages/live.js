// Live streaming: the host's phone sends one WebRTC stream to each viewer (peer-to-peer, signalling through Supabase `live_signals`).
// Comments / hearts / gifts travel over an RTCDataChannel (host <-> viewers), so no extra backend is needed.
// The host can stream the camera OR a still image picked from the gallery (cropped/edited, sent as a canvas video track + microphone).
// Limit: 6 simultaneous viewers per broadcast (no media server). Viewers = people who follow the host.
import { h, icon, avatar, toast, confirmBox, clear, sheet } from '../lib/dom.js';
import { sb, state, bus, rt, rtLive, beaconRpc, PROFILE_MINI } from '../api.js';
import { ICE_SERVERS } from '../config.js';

export const MAX_VIEWERS = 6;
let hostSession = null, watchSession = null;
const seen = new Set();
const fmt = (s) => { const m = Math.floor(s / 60), x = s % 60, hh = Math.floor(m / 60); return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };
const kfmt = (n) => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n); };
const sendSig = (live_id, to_id, kind, payload) => sb.from('live_signals').insert({ live_id, from_id: state.me.id, to_id, kind, payload: payload ?? {} }).catch(() => {});
const badge = () => h('span', { class: 'live-badge' }, h('i'), 'LIVE');
const svg = (html, size = 22, fill = 'none') => h('span', { class: 'lx-svg', html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${html}</svg>` });
const SV = {
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 1 1 0 5"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  info: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M12 11v5M12 7.8h.01" stroke="#0a1230" stroke-width="2.2"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  bars: '<path d="M5 20V11M12 20V4M19 20v-7" stroke-width="3.2"/>',
  pencil: '<path d="M4 17.5 3.6 21l3.5-.4L19 8.7a2.5 2.5 0 0 0-3.5-3.5zM14 6.7l3.3 3.3"/><path d="M10 22.5h11"/>',
  verified: '<path d="m12 1.5 2.6 1.9 3.2-.2 1 3 2.7 1.8-.9 3.1.9 3.1-2.7 1.8-1 3-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3-2.7-1.8.9-3.1-.9-3.1 2.7-1.8 1-3 3.2.2z" fill="#2f8cff" stroke="none"/><path d="m8.2 12.2 2.6 2.6 5-5.4" stroke="#fff" stroke-width="2.4"/>',
  camera: '<rect x="1" y="1" width="22" height="22" rx="6" fill="#2f7cff" stroke="none"/><path d="M5.5 9h2.4l1.3-2h5.6l1.3 2h2.4a.8.8 0 0 1 .8.8v7.4a.8.8 0 0 1-.8.8H5.5a.8.8 0 0 1-.8-.8V9.8a.8.8 0 0 1 .8-.8z" fill="#fff" stroke="none"/><circle cx="12" cy="13.4" r="3" fill="#2f7cff" stroke="none"/><circle cx="12" cy="13.4" r="1.5" fill="#fff" stroke="none"/>',
  photo: '<circle cx="12" cy="12" r="11.5" fill="#2f7cff" stroke="none"/><circle cx="8.3" cy="8.6" r="1.6" fill="#fff" stroke="none"/><path d="M4.6 17.8 9 11.4l3.1 4.4 2.2-2.9 5.1 4.9z" fill="#fff" stroke="none"/>',
};
SV.x = '<path d="M18 6 6 18M6 6l12 12" stroke-width="2.4"/>';
SV.vdots = '<circle cx="12" cy="5" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="2" fill="currentColor" stroke="none"/>';
SV.eye = '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>';
SV.smile = '<circle cx="12" cy="12" r="10" stroke-width="2"/><path d="M8 14.2s1.6 2.6 4 2.6 4-2.6 4-2.6" stroke-width="2"/><circle cx="8.8" cy="9.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.2" cy="9.6" r="1.2" fill="currentColor" stroke="none"/>';
SV.fwd = '<path d="M21 11 14 4v4.5C8 9 4.5 12.5 3.5 19 6 15.5 9.5 14 14 14v4z" stroke-width="2"/>';
SV.giftw = '<path d="M3 8h18v4H3zM4.5 12h15v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM12 8v13" fill="currentColor" stroke="none"/><path d="M12 8c-1-3-2.5-4.5-4.2-4.5a2 2 0 0 0 0 4zM12 8c1-3 2.5-4.5 4.2-4.5a2 2 0 0 1 0 4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v13" stroke="#232744" stroke-width="1.6"/>';
const GIFTS = ['🎁', '🌹', '👑', '💎', '🚀', '🔥', '❤️', '🏆'];
const EMOJIS = ['😍', '🔥', '👏', '❤️', '😂', '🇸🇾', '💙', '🙌'];
const isVerified = (p) => !!p?.role && p.role !== 'USER';
const countFollowers = (id) => sb.from('follows').select('follower_id').eq('following_id', id).count().catch(() => 0);

// ============ shared live overlay (host chip, comments, hearts, input row) ============
function buildOverlay({ host, isHost, onSend, onClose, onShare, menuItems, endBtn }) {
  const viewersTop = h('b', null, '0'), viewersBottom = h('b', null, '0');
  const follow = h('div', { class: 'lx-sub' }, '');
  countFollowers(host?.id).then((n) => { follow.textContent = kfmt(n) + ' متابع'; });
  const menu = menuItems?.length ? h('button', { class: 'lx-more', type: 'button', 'aria-label': 'المزيد', onclick: () => { const rows = menuItems(); sheet('خيارات البث', (body, close) => { for (const m of rows) body.append(h('button', { class: 'lx-menu-row', type: 'button', onclick: () => { close(); m.run(); } }, m.label)); }); } }, svg(SV.vdots, 26, 'currentColor')) : h('span', { class: 'lx-more' });
  const closeBtn = h('button', { class: 'lx-x2', type: 'button', 'aria-label': 'إغلاق', onclick: onClose }, svg(SV.x, 26));
  const chip = h('div', { class: 'lx-host' }, h('span', { class: 'lx-av' }, avatar(host || {}, 106)), h('div', { class: 'lx-hn' }, h('b', null, host?.display_name || host?.username || 'مضيف'), follow));
  const top = h('div', { class: 'lx-top' }, chip, h('span', { class: 'lx-live' }, h('i'), h('span', null, 'مباشر')), h('span', { class: 'lx-eye' }, svg(SV.eye, 26), viewersTop), h('span', { class: 'lx-sp' }), menu, closeBtn);
  const list = h('div', { class: 'lx-chat' });
  const hearts = h('div', { class: 'lx-hearts' });
  const input = h('input', { class: 'lx-input', placeholder: 'اكتب تعليقاً...', maxlength: 160, enterkeyhint: 'send' });
  const emo = h('div', { class: 'lx-emojis', hidden: true }, ...EMOJIS.map((e) => h('button', { type: 'button', onclick: () => { input.value += e; input.focus(); } }, e)));
  const send = () => { const x = input.value.trim(); if (!x) return; input.value = ''; emo.hidden = true; onSend({ t: 'c', x }); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  const giftSheet = () => sheet('أرسل هدية', (body, close) => body.append(h('div', { class: 'lx-gifts' }, ...GIFTS.map((g) => h('button', { type: 'button', onclick: () => { close(); onSend({ t: 'g', g }); } }, g)))));
  const bar = h('div', { class: 'lx-bar' },
    h('div', { class: 'lx-field' }, h('button', { class: 'lx-ic', type: 'button', 'aria-label': 'رموز', onclick: () => { emo.hidden = !emo.hidden; } }, svg(SV.smile, 30)), input),
    h('button', { class: 'lx-round', type: 'button', 'aria-label': 'مشاركة', onclick: onShare }, svg(SV.fwd, 28)),
    h('button', { class: 'lx-round', type: 'button', 'aria-label': 'هدية', onclick: giftSheet }, svg(SV.giftw, 28, 'currentColor')),
    h('button', { class: 'lx-round gift', type: 'button', 'aria-label': 'إرسال هدية', onclick: () => onSend({ t: 'g', g: '🎁' }) }, h('span', { class: 'lx-gift-e' }, '🎁')));
  const stage = h('div', { class: 'lx-stage' }, top, h('div', { class: 'lx-mid' }, list, hearts), emo, bar);
  const foot = h('div', { class: 'lx-foot' }, h('div', { class: 'lx-stat' }, svg(SV.bars, 26, 'currentColor'), h('span', null, 'المشاهدون'), viewersBottom), endBtn);
  const el = h('div', { class: 'lx-ui' }, stage, foot);
  function addComment(m) {
    if (!m) return;
    if (m.t === 'h') return heart();
    const gift = m.t === 'g';
    const row = h('div', { class: 'lx-c' + (gift ? ' gift' : '') }, h('span', { class: 'lx-cav' }, avatar({ id: m.u, display_name: m.n, avatar_url: m.a }, 98)), h('div', { class: 'lx-cb' }, h('b', null, String(m.n || '').slice(0, 30)), h('div', null, gift ? 'أرسل هدية ' + String(m.g || '🎁').slice(0, 4) : String(m.x || '').slice(0, 160), gift ? null : h('span', { class: 'lx-ch' }, ' ❤'))));
    list.append(row); while (list.children.length > 4) list.firstChild.remove();
    setTimeout(() => row.classList.add('fade'), 12000); setTimeout(() => row.remove(), 14000);
    if (gift) { heart(m.g || '🎁'); heart('✨'); }
  }
  let hc = 0;
  function heart(glyph) {
    const e = h('span', { class: 'lx-heart c' + (hc++ % 3) }, glyph || '❤');
    e.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(0) + 'px'); e.style.animationDuration = (2.4 + Math.random() * 1.2).toFixed(1) + 's';
    hearts.append(e); setTimeout(() => e.remove(), 3800); while (hearts.children.length > 40) hearts.firstChild.remove();
  }
  const setViewers = (n) => { viewersTop.textContent = viewersBottom.textContent = kfmt(n); };
  return { el, addComment, heart, setViewers };
}
const me = () => ({ u: state.me.id, n: state.me.display_name || state.me.username, a: state.me.avatar_url || null });
const shareLive = async (host, title) => {
  const text = `${host?.display_name || host?.username || ''} في بث مباشر الآن على NEXORA${title ? ' — ' + title : ''}`;
  try { if (navigator.share) return await navigator.share({ title: 'بث مباشر', text }); } catch { return; }
  try { await navigator.clipboard.writeText(text); toast('تم نسخ رابط/نص البث'); } catch { toast(text); }
};

// ============ image editor (crop / zoom / rotate / brightness) ============
const OW = 720, OH = 1280;
function renderImage(ctx, img, p, W, H) {
  ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const rot = p.rot % 2 === 1, iw = rot ? img.naturalHeight : img.naturalWidth, ih = rot ? img.naturalWidth : img.naturalHeight;
  const k = Math.max(W / iw, H / ih) * p.zoom, f = W / OW;
  ctx.translate(W / 2 + p.ox * f, H / 2 + p.oy * f); ctx.rotate(p.rot * Math.PI / 2); ctx.scale(k, k);
  ctx.filter = `brightness(${p.bright}) contrast(${p.contrast})`;
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2); ctx.restore();
}
function editImage(img, params) {
  return new Promise((resolve) => {
    const p = { ...params }; const vw = Math.min(Math.round(innerWidth * 0.78), 340), vh = Math.round(vw * OH / OW);
    const cv = h('canvas', { class: 'lx-ed-cv', width: vw, height: vh }); cv.style.width = vw + 'px'; cv.style.height = vh + 'px'; const ctx = cv.getContext('2d');
    const draw = () => renderImage(ctx, img, p, vw, vh);
    const ptrs = new Map(); let d0 = 0, z0 = 1;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = p.zoom; } });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; const old = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) { p.ox += (e.clientX - old[0]) * OW / vw; p.oy += (e.clientY - old[1]) * OW / vw; }
      else if (ptrs.size === 2 && d0) { const [a, b] = [...ptrs.values()]; p.zoom = Math.min(5, Math.max(1, z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / d0)); zoom.value = p.zoom; }
      draw();
    });
    const up = (e) => { ptrs.delete(e.pointerId); d0 = 0; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    const slider = (label, key, min, max, step) => { const i = h('input', { type: 'range', min, max, step, value: p[key], oninput: () => { p[key] = +i.value; draw(); } }); return [h('label', { class: 'lx-ed-l' }, label, i), i]; };
    const [zl, zoom] = slider('التكبير', 'zoom', 1, 5, 0.01), [bl] = slider('السطوع', 'bright', 0.5, 1.6, 0.01), [cl] = slider('التباين', 'contrast', 0.6, 1.6, 0.01);
    const back = h('div', { class: 'lx-ed' }, h('div', { class: 'lx-ed-box' }, h('div', { class: 'lx-ed-h' }, h('b', null, 'تعديل الصورة'), h('span', { class: 'small' }, 'اسحب للتحريك · قرّب بإصبعين')), cv, zl, bl, cl,
      h('div', { class: 'lx-ed-btns' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { p.rot = (p.rot + 1) % 4; p.ox = p.oy = 0; draw(); } }, svg(SV.rotate, 18), ' تدوير'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { Object.assign(p, { zoom: 1, ox: 0, oy: 0, bright: 1, contrast: 1 }); zoom.value = 1; back.querySelectorAll('input').forEach((i, n) => { i.value = [1, 1, 1][n]; }); draw(); } }, 'إعادة'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { back.remove(); resolve(null); } }, 'إلغاء'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { back.remove(); resolve(p); } }, 'تم'))));
    document.body.append(back); draw();
  });
}
const pickImage = () => new Promise((resolve) => {
  const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } }); document.body.append(inp);
  let done = false; const fin = (v) => { if (done) return; done = true; inp.remove(); resolve(v); };
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0]; if (!f) return fin(null);
    const url = URL.createObjectURL(f); const img = new Image(); img.src = url;
    try { await img.decode(); fin({ img, url }); } catch { URL.revokeObjectURL(url); toast('تعذّر فتح الصورة', 'err'); fin(null); }
  });
  inp.addEventListener('cancel', () => fin(null)); inp.click();
});
let voiceAv = null, voiceAvUrl = null, voiceGuests = [];
const bmpCache = new Map();
async function loadBitmap(url) {
  if (!url) return null; if (bmpCache.has(url)) return bmpCache.get(url);
  try { const r = await fetch(url, { mode: 'cors' }); const b = await createImageBitmap(await r.blob()); bmpCache.set(url, b); return b; } catch { return null; }
}
async function loadVoiceAvatar(url) { voiceAvUrl = url; voiceAv = await loadBitmap(url); return !!voiceAv; }
// Voice room: a 3x3 grid of seats; the host sits in the first seat (top-right) with the profile photo, invited guests take the next seats.
function renderVoice(ctx, W, H) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const d = W * 0.18, xs = [0.775, 0.5, 0.225];
  const initial = (n) => [...(n || '?')][0].toUpperCase();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const i = r * 3 + c, x = xs[c] * W, y = H * 0.25 + r * W * 0.245;
    const who = i === 0 ? { bmp: voiceAv, n: state.me?.display_name || state.me?.username } : voiceGuests[i - 1];
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, d / 2, 0, 7); ctx.clip();
    if (who?.bmp) { const k = Math.max(d / who.bmp.width, d / who.bmp.height); ctx.drawImage(who.bmp, x - who.bmp.width * k / 2, y - who.bmp.height * k / 2, who.bmp.width * k, who.bmp.height * k); }
    else if (who) { const g = ctx.createLinearGradient(x - d / 2, y - d / 2, x + d / 2, y + d / 2); g.addColorStop(0, '#00c6ff'); g.addColorStop(1, '#7b5cff'); ctx.fillStyle = g; ctx.fillRect(x - d / 2, y - d / 2, d, d); ctx.fillStyle = '#fff'; ctx.font = `bold ${d * 0.45}px Tajawal, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initial(who.n), x, y + 2); }
    else { ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x - d / 2, y - d / 2, d, d); ctx.fillStyle = '#4d4d4d'; ctx.beginPath(); ctx.arc(x, y - d * 0.1, d * 0.17, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y + d * 0.42, d * 0.34, d * 0.3, 0, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}

// ============ invites (broadcast on a per-user realtime channel; no DB changes) ============
let invOn = false; const seenInv = new Set();
export function initInvites() {
  if (invOn || !rt || !state.me) return; invOn = true;
  rt.channel('nx-live-' + state.me.id).onBroadcast('invite', onInvite).subscribe();
}
function sendInviteTo(p, liveId, title) {
  if (!rt || !state.me || !p?.id) return toast('تعذّر إرسال الدعوة (لا يوجد اتصال)', 'err');
  const payload = { liveId, hostId: state.me.id, n: state.me.display_name || state.me.username, a: state.me.avatar_url || null, title: title || '' };
  const ch = rt.channel('nx-live-' + p.id); const fire = () => { try { ch.broadcast('invite', payload); } catch {} };
  ch.onJoin(() => { fire(); setTimeout(fire, 1500); setTimeout(() => { try { ch.unsubscribe(); } catch {} }, 5000); }); ch.subscribe();
}
function onInvite(p) {
  if (!p?.hostId || p.hostId === state.me?.id || hostSession) return; const key = p.hostId + ':' + p.liveId; if (seenInv.has(key)) return; seenInv.add(key);
  if (watchSession && watchSession.hostId !== p.hostId) return;
  const close = () => back.remove();
  const back = h('div', { class: 'lx-inv-back' }, h('div', { class: 'lx-inv' }, avatar({ display_name: p.n, avatar_url: p.a }, 84), h('b', null, 'دعوة للانضمام للبث'), h('p', null, `${p.n || 'مضيف'} يدعوك للانضمام إلى بثه المباشر والتحدث معه بالصوت`),
    h('div', { class: 'lx-inv-btns' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); joinAsGuest(p); } }, 'انضمام'), h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'رفض'))));
  document.body.append(back); setTimeout(close, 45000);
}
async function joinAsGuest(p) {
  if (watchSession) { if (watchSession.hostId === p.hostId) watchSession.sendAccept?.(); return; }
  try { const l = ((await sb.rpc('live_now')) || []).find((x) => x.host_id === p.hostId); if (!l) return toast('انتهى هذا البث', 'err'); const pr = await sb.from('profiles').select(PROFILE_MINI).eq('id', p.hostId).one(); openWatch(l, pr, { guest: true }); } catch (e) { toast(e.message, 'err'); }
}
// followers picker (only followers can watch/join, so they are the people you can invite)
function pickPeople(sent, onPick) {
  sheet('إرسال دعوة', async (body) => {
    const q = h('input', { class: 'lx-search', placeholder: 'ابحث بالاسم...' }); const list = h('div', { class: 'lx-plist' }, h('div', { class: 'muted' }, 'جارٍ التحميل...')); body.append(q, list);
    let rows = []; try { rows = (await sb.from('follows').select(`follower_id,p:profiles!follows_follower_id_fkey(${PROFILE_MINI})`).eq('following_id', state.me.id).limit(200)).map((r) => r.p).filter(Boolean); } catch {}
    const paint = () => { const t = q.value.trim().toLowerCase(); clear(list); const f = rows.filter((p) => !t || (p.display_name || '').toLowerCase().includes(t) || (p.username || '').toLowerCase().includes(t)); if (!f.length) list.append(h('div', { class: 'muted' }, rows.length ? 'لا نتائج' : 'لا يوجد متابعون لدعوتهم بعد'));
      for (const p of f) { const b = h('button', { class: 'btn ' + (sent.has(p.id) ? 'ghost' : 'primary') + ' lx-pb', type: 'button', onclick: () => { if (sent.has(p.id)) return; sent.add(p.id); onPick(p); paint(); } }, sent.has(p.id) ? 'تم ✓' : 'دعوة'); list.append(h('div', { class: 'lx-prow' }, avatar(p, 44), h('div', { class: 'lx-pn' }, h('b', null, p.display_name || p.username), h('span', null, '@' + p.username)), b)); } };
    q.addEventListener('input', paint); paint();
  });
}
const newParams = () => ({ zoom: 1, ox: 0, oy: 0, rot: 0, bright: 1, contrast: 1 });

// ============ HOST ============
export function openLive() {
  if (hostSession || watchSession) return toast('أنت داخل بث مباشر حالياً', 'err');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('البث المباشر غير مدعوم على هذا الجهاز', 'err');
  const s = hostSession = { id: null, stream: null, facing: 'user', muted: false, peers: new Map(), timers: [], t0: 0, ended: false, lastSig: 0, mode: 'camera', opts: { comments: true, gifts: true }, guests: new Map(), queue: [], sentInv: new Set(), actx: null, img: null, imgUrl: null, params: newParams(), canvas: null, ov: null };
  const preview = h('video', { class: 'lv-video', playsinline: true, autoplay: true }); preview.muted = true; preview.volume = 0;
  const msg = h('div', { class: 'lv-msg', hidden: true });
  const title = h('input', { class: 'lt-title', placeholder: 'اكتب عنوان البث...', maxlength: 60 });
  const startBtn = h('button', { class: 'lt-start', type: 'button', onclick: () => start() }, 'بدء LIVE');
  const bgc = h('canvas', { class: 'lv-video lt-bg', width: 360, height: 640 });
  const go = (hash) => { requestClose(true); location.hash = hash; };
  const tip = h('div', { class: 'lt-tip' }, h('button', { class: 'lt-tx', type: 'button', onclick: () => tip.remove() }, svg(SV.x, 14)), h('div', { class: 'lt-tip-t' }, h('b', null, 'انشر أحدث لحظاتك البارزة'), h('span', null, 'ساعد المشاهدين الجدد على اكتشافك..')), h('span', { class: 'lt-spark' }, svg('<path d="M12 2c.6 5 2.4 8 8 10-5.6 2-7.4 5-8 10-.6-5-2.4-8-8-10 5.6-2 7.4-5 8-10z" fill="currentColor" stroke="none"/>', 30)));
  const tools = h('div', { class: 'lt-tools' });
  const modes = h('div', { class: 'lt-modes' });
  const tabs = h('div', { class: 'lt-tabs' }, h('button', { type: 'button', onclick: () => go('#/home') }, 'الإبداع'), h('button', { type: 'button', onclick: () => go('#/compose') }, 'الكاميرا'), h('button', { class: 'on', type: 'button' }, 'LIVE'));
  const setup = h('div', { class: 'lt-setup' },
    h('div', { class: 'lt-top' }, h('button', { class: 'lt-c', type: 'button', 'aria-label': 'الرئيسية', onclick: () => go('#/home') }, icon('home', 20)), h('button', { class: 'lt-c', type: 'button', 'aria-label': 'إرشادات', onclick: () => toast('بث آمن: لا تبث محتوى مخالفاً للقواعد.') }, icon('shield', 20)), h('span', { class: 'lt-sp' }), h('button', { class: 'lt-xx', type: 'button', 'aria-label': 'إغلاق', onclick: () => requestClose(true) }, svg(SV.x, 28))),
    tip, h('span', { class: 'lt-grow' }), tools,
    h('div', { class: 'lt-card' }, h('div', { class: 'lt-row' }, h('span', { class: 'lt-av' }, avatar(state.me, 40)), title), startBtn),
    modes, tabs, h('i', { class: 'lt-home' }));
  const el = h('div', { class: 'live-screen lx-screen', role: 'dialog' }, preview, bgc, msg, setup);
  s.ui = { el, preview }; document.body.append(el); el.addEventListener('m17:back', () => requestClose());

  const mkTool = (ico, label, fn, on) => h('button', { class: 'lt-tool' + (on ? ' on' : ''), type: 'button', onclick: fn }, icon(ico, 26), h('span', null, label));
  function paintOpts() {
    clear(tools).append(
      s.mode === 'camera' ? mkTool('flip', 'قلب', () => flip()) : null,
      s.mode === 'image' ? mkTool('image', s.img ? 'تغيير الصورة' : 'اختيار صورة', () => chooseImage()) : null,
      s.mode === 'image' && s.img ? mkTool('edit', 'تعديل', () => editCurrent()) : null,
      mkTool(s.muted ? 'micoff' : 'mic', s.muted ? 'مكتوم' : 'الصوت', () => { s.muted = !s.muted; s.stream?.getAudioTracks().forEach((t) => (t.enabled = !s.muted)); paintOpts(); }, s.muted),
      mkTool('users', 'دعوة', () => openInvite()),
      mkTool('share', 'مشاركة', () => shareLive(state.me, title.value.trim())),
      mkTool('settings', 'الإعدادات', () => sheet('إعدادات البث', (body) => { for (const [k, lbl] of [['comments', 'السماح بالتعليقات'], ['gifts', 'السماح بالهدايا']]) { const cb = h('input', { type: 'checkbox', checked: s.opts[k], onchange: () => { s.opts[k] = cb.checked; } }); body.append(h('label', { class: 'lt-set' }, h('span', null, lbl), cb)); } })));
    const M = [['camera', 'الكاميرا', 'camera'], ['image', 'صورة من الاستديو', 'image'], ['voice', 'دردشة صوتية', 'phone']];
    clear(modes).append(...M.map(([k, t, ic]) => h('button', { class: 'lt-m' + (s.mode === k ? ' on' : ''), type: 'button', onclick: () => setMode(k) }, icon(ic, 16), ' ', t)));
  }
  function paintThumb() {
    const cam = s.mode === 'camera';
    preview.style.display = cam ? '' : 'none'; bgc.style.display = cam ? 'none' : '';
    if (cam) { if (s.stream) { preview.srcObject = s.stream; preview.classList.toggle('mirror', s.facing === 'user'); preview.play?.().catch(() => {}); } return; }
    const ctx = bgc.getContext('2d');
    if (s.mode === 'image' && s.img) renderImage(ctx, s.img, s.params, 360, 640); else renderVoice(ctx, 360, 640);
    if (s.mode === 'image') paintOpts();
  }
  function clearImage() { if (s.imgUrl) URL.revokeObjectURL(s.imgUrl); s.img = s.imgUrl = null; s.params = newParams(); paintThumb(); }
  async function chooseImage() {
    const r = await pickImage(); if (!r) return; if (s.imgUrl) URL.revokeObjectURL(s.imgUrl);
    s.img = r.img; s.imgUrl = r.url; s.params = newParams(); paintThumb();
  }
  async function editCurrent() { if (!s.img) return; const p = await editImage(s.img, s.params); if (p) { s.params = p; paintThumb(); redraw(); } }
  async function setMode(m) {
    s.mode = m; msg.hidden = true; startBtn.disabled = false;
    if (m === 'camera') { paintOpts(); await cam(); paintThumb(); }
    else { s.stream?.getTracks().forEach((t) => t.stop()); s.stream = null; preview.srcObject = null; paintOpts(); paintThumb(); if (m === 'image' && !s.img) chooseImage(); if (m === 'voice') loadVoiceAvatar(state.me?.avatar_url).then((ok) => { if (ok && s.mode === 'voice') paintThumb(); }); }
  }
  async function cam() {
    try {
      s.stream?.getTracks().forEach((t) => t.stop());
      s.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: s.facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      if (s.ended || s.mode !== 'camera') { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; return; }
      s.stream.getAudioTracks().forEach((t) => (t.enabled = !s.muted));
    } catch (e) { startBtn.disabled = true; toast(e?.name === 'NotAllowedError' ? 'لم تُمنح صلاحية الكاميرا/الميكروفون. فعّلها من إعدادات التطبيق ثم أعد فتح البث.' : 'تعذّر تشغيل الكاميرا على هذا الجهاز.', 'err'); }
  }
  async function flip() {
    if (s.mode !== 'camera' || !s.stream) return;
    const old = s.facing; s.facing = old === 'user' ? 'environment' : 'user';
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: s.facing }, width: { ideal: 1280 }, height: { ideal: 720 } } }); const nt = ns.getVideoTracks()[0];
      const ot = s.stream.getVideoTracks()[0]; ot?.stop(); if (ot) s.stream.removeTrack(ot); s.stream.addTrack(nt);
      for (const p of s.peers.values()) { const snd = p.pc.getSenders().find((x) => x.track?.kind === 'video' || x.__v); if (snd) await snd.replaceTrack(nt); }
      preview.srcObject = s.stream; preview.classList.toggle('mirror', s.facing === 'user');
    } catch { s.facing = old; toast('تعذّر تبديل الكاميرا', 'err'); }
  }
  const redraw = () => { if (!s.canvas) return; if (s.mode === 'image' && s.img) renderImage(s.canvas.getContext('2d'), s.img, s.params, OW, OH); else renderVoice(s.canvas.getContext('2d'), OW, OH); };

  async function buildStream() {
    if (s.mode === 'camera') { if (!s.stream) await cam(); if (!s.stream) throw new Error('الكاميرا غير جاهزة'); return s.stream; }
    if (s.mode === 'image' && !s.img) { await chooseImage(); if (!s.img) throw new Error('اختر صورة للبث أولاً'); }
    if (s.mode === 'voice') await Promise.race([loadVoiceAvatar(state.me?.avatar_url), new Promise((r) => setTimeout(r, 2500))]);
    s.canvas = h('canvas', { width: OW, height: OH }); redraw();
    s.timers.push(setInterval(redraw, 200)); // keeps frames flowing for new viewers
    const out = new MediaStream(); out.addTrack(s.canvas.captureStream(15).getVideoTracks()[0]);
    try { const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); a.getAudioTracks().forEach((t) => { t.enabled = !s.muted; out.addTrack(t); }); }
    catch { toast('لا توجد صلاحية للميكروفون — سيكون البث بدون صوت', 'err'); }
    s.stream = out; return out;
  }
  async function start() {
    startBtn.disabled = true;
    try { await buildStream(); } catch (e) { startBtn.disabled = false; return toast(e.message || 'تعذّر تجهيز البث', 'err'); }
    try {
      const r = await sb.rpc('start_live', { p_title: title.value.trim() });
      if (!r?.ok) throw new Error('تعذّر بدء البث');
      s.id = r.id; s.t0 = Date.now(); s.title = title.value.trim();
    } catch (e) { startBtn.disabled = false; return toast(e.message, 'err'); }
    setupAudio();
    setup.hidden = true; bgc.style.display = 'none'; preview.style.display = ''; preview.srcObject = s.stream; preview.classList.toggle('mirror', s.mode === 'camera' && s.facing === 'user'); preview.classList.toggle('cover', true); preview.play?.().catch(() => {});
    const endBtn = h('button', { class: 'lx-end', type: 'button', onclick: () => requestClose() }, h('i', { class: 'lx-sq' }), h('span', null, 'إنهاء البث'));
    const ov = s.ov = buildOverlay({
      host: state.me, isHost: true, endBtn, onClose: () => requestClose(), onShare: () => shareLive(state.me, s.title),
      onSend: (m) => { const full = { ...m, ...me() }; ov.addComment(full); broadcast(full); },
      menuItems: () => [
        s.mode === 'camera' ? { label: 'تبديل الكاميرا', run: flip } : s.mode === 'voice' ? null : { label: 'تغيير الصورة', run: async () => { const r = await pickImage(); if (r) { s.img = r.img; s.params = newParams(); redraw(); const p = await editImage(s.img, s.params); if (p) { s.params = p; redraw(); } } } },
        s.mode === 'image' && s.img ? { label: 'تعديل الصورة', run: async () => { const p = await editImage(s.img, s.params); if (p) { s.params = p; redraw(); } } } : null,
        { label: 'إرسال دعوة', run: () => openInvite() },
        ...[...s.guests].map(([uid, g]) => ({ label: 'إنهاء حديث ' + g.prof.n, run: () => endGuest(uid) })),
        { label: s.muted ? 'تشغيل الميكروفون' : 'كتم الميكروفون', run: () => { s.muted = !s.muted; s.stream?.getAudioTracks().forEach((t) => (t.enabled = !s.muted)); toast(s.muted ? 'تم كتم الميكروفون' : 'تم تشغيل الميكروفون'); } },
      ].filter(Boolean),
    });
    el.append(ov.el); el.classList.add('live-on');
    el.append(h('button', { class: 'lx-invite', type: 'button', onclick: () => openInvite() }, svg('<path d="M12 5v14M5 12h14" stroke-width="2.6"/>', 16), ' إرسال دعوة'));
    for (const p of s.queue.splice(0)) sendInviteTo(p, s.id, s.title);
    if (s.title) ov.el.append(h('div', { class: 'lv-title-show' }, s.title));
    s.timers.push(setInterval(ping, 8000)); s.timers.push(setInterval(pollSig, 2000)); ping(); toast('بدأ البث المباشر 🔴');
  }
  // ---- guests (invited people who talk with you): their mic is mixed into the broadcast audio ----
  function sendTracks() { const v = s.stream.getVideoTracks()[0], a = s.mixTrack || s.stream.getAudioTracks()[0]; return [v, a].filter(Boolean); }
  function setupAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; s.actx = new AC(); s.actx.resume?.(); s.mixDest = s.actx.createMediaStreamDestination(); s.mixTrack = s.mixDest.stream.getAudioTracks()[0];
      const at = s.stream.getAudioTracks(); s.hostSrc = at.length ? s.actx.createMediaStreamSource(new MediaStream([at[0]])) : null; rewire();
    } catch { s.mixTrack = null; s.actx = null; }
  }
  function rewire() {
    if (!s.actx) return; const hs = s.hostSrc;
    try { hs?.disconnect(); } catch {} for (const g of s.guests.values()) { try { g.src?.disconnect(); } catch {} }
    hs?.connect(s.mixDest);
    for (const g of s.guests.values()) { if (g.src) { g.src.connect(s.mixDest); g.src.connect(s.actx.destination); } }
    for (const [uid, g] of s.guests) { hs?.connect(g.dest); for (const [u2, g2] of s.guests) if (u2 !== uid && g2.src) g2.src.connect(g.dest); }
  }
  const seatsUpdate = () => { voiceGuests = [...s.guests.values()].map((g) => ({ bmp: g.bmp, n: g.prof.n })); redraw(); };
  async function renego(p) { const offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer); if (p.dc?.readyState === 'open') p.dc.send(JSON.stringify({ t: 'off', sdp: offer.sdp })); }
  async function startGuest(uid, m) {
    const p = s.peers.get(uid); if (!p || !s.actx || s.guests.has(uid)) return; if (s.guests.size >= 3) { try { p.dc.send(JSON.stringify({ t: 'full' })); } catch {} return; }
    const tr = p.pc.getTransceivers().find((t) => t.sender?.track?.kind === 'audio'); if (!tr) return;
    const prof = { n: String(m.n || 'ضيف').slice(0, 30), a: typeof m.a === 'string' && m.a.startsWith('http') ? m.a : null };
    const g = { tr, prof, src: null, dest: s.actx.createMediaStreamDestination(), bmp: null, el: null }; s.guests.set(uid, g);
    try { rewire(); await tr.sender.replaceTrack(g.dest.stream.getAudioTracks()[0]); tr.direction = 'sendrecv'; await renego(p); } catch { s.guests.delete(uid); return toast('تعذّر ضم الضيف', 'err'); }
    toast(prof.n + ' انضم للحديث 🎙️'); seatsUpdate(); loadBitmap(prof.a).then((b) => { g.bmp = b; seatsUpdate(); });
  }
  async function gotAnswer(uid, m) {
    const p = s.peers.get(uid), g = s.guests.get(uid); if (!p) return;
    try {
      await p.pc.setRemoteDescription({ type: 'answer', sdp: String(m.sdp || '') });
      if (g && !g.src && g.tr.currentDirection && g.tr.currentDirection.includes('recv')) {
        const ms = new MediaStream([g.tr.receiver.track]); g.el = new Audio(); g.el.srcObject = ms; g.el.muted = true; g.el.play?.().catch(() => {});
        g.src = s.actx.createMediaStreamSource(ms); rewire();
      }
    } catch {}
  }
  function dropGuest(uid) { const g = s.guests.get(uid); if (!g) return; s.guests.delete(uid); try { g.src?.disconnect(); } catch {} try { g.el?.pause(); } catch {} rewire(); seatsUpdate(); }
  async function endGuest(uid) {
    const g = s.guests.get(uid), p = s.peers.get(uid); if (!g) return; dropGuest(uid);
    if (p && s.mixTrack) { try { g.tr.direction = 'sendonly'; await g.tr.sender.replaceTrack(s.mixTrack); await renego(p); } catch {} }
  }
  function openInvite() { pickPeople(s.sentInv, (p) => { if (s.id) sendInviteTo(p, s.id, s.title); else { s.queue.push(p); toast('ستصله الدعوة عند بدء البث'); } }); }
  function broadcast(m, exceptUid) { const data = JSON.stringify(m); for (const [uid, p] of s.peers) if (uid !== exceptUid && p.dc?.readyState === 'open') { try { p.dc.send(data); } catch {} } }
  async function ping() {
    try { const r = await sb.rpc('ping_live', { p_id: s.id }); if (r?.status === 'none' || r?.status === 'ended') return finish('انتهى البث'); s.ov?.setViewers(r?.viewers ?? 0); } catch {}
  }
  async function pollSig() {
    if (s.ended || !s.id) return;
    try { const rows = await sb.from('live_signals').select('*').eq('live_id', s.id).eq('to_id', state.me.id).gt('id', s.lastSig).order('id').limit(200); for (const r of rows) await onSig(r); } catch {}
  }
  async function onSig(sig) {
    if (!sig || seen.has('h' + sig.id) || s.ended || sig.live_id !== s.id) return; seen.add('h' + sig.id); s.lastSig = Math.max(s.lastSig, sig.id);
    const from = sig.from_id;
    try {
      if (sig.kind === 'join') await addViewer(from);
      else if (sig.kind === 'answer') { const p = s.peers.get(from); if (p && !p.remoteSet) { await p.pc.setRemoteDescription(sig.payload); p.remoteSet = true; for (const c of p.ice.splice(0)) { try { await p.pc.addIceCandidate(c); } catch {} } } }
      else if (sig.kind === 'ice') { const p = s.peers.get(from); if (p && p.remoteSet) { try { await p.pc.addIceCandidate(sig.payload); } catch {} } else if (p) p.ice.push(sig.payload); }
      else if (sig.kind === 'bye') dropViewer(from);
    } catch { /* bad signal */ }
  }
  async function addViewer(uid) {
    dropViewer(uid);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
    const p = { pc, remoteSet: false, ice: [], dc: null }; s.peers.set(uid, p);
    const dc = p.dc = pc.createDataChannel('chat');
    let last = 0;
    dc.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data); if (m && m.t === 'acc') return startGuest(uid, m); if (m && m.t === 'ans') return gotAnswer(uid, m); if (m && m.t === 'leave') return endGuest(uid); if (!m || !['c', 'h', 'g'].includes(m.t) || (m.t === 'c' && !s.opts.comments) || (m.t === 'g' && !s.opts.gifts)) return; const now = Date.now(); if (now - last < 400) return; last = now;
        const clean = { t: m.t, u: uid, n: String(m.n || '').slice(0, 30), a: typeof m.a === 'string' && m.a.startsWith('http') ? m.a : null, x: String(m.x || '').slice(0, 160), g: GIFTS.includes(m.g) ? m.g : undefined };
        s.ov?.addComment(clean); broadcast(clean, uid);
      } catch {}
    };
    pc.onicecandidate = (e) => { if (e.candidate) sendSig(s.id, uid, 'ice', e.candidate.toJSON()); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropViewer(uid, pc); };
    sendTracks().forEach((t) => { const snd = pc.addTrack(t, s.stream); if (t.kind === 'video') { snd.__v = true; try { const pr = snd.getParameters(); pr.encodings = pr.encodings?.length ? pr.encodings : [{}]; pr.encodings[0].maxBitrate = 900000; snd.setParameters(pr).catch(() => {}); } catch {} } });
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await sendSig(s.id, uid, 'offer', { type: offer.type, sdp: offer.sdp });
  }
  function dropViewer(uid, onlyPc) { const p = s.peers.get(uid); if (!p || (onlyPc && p.pc !== onlyPc)) return; dropGuest(uid); try { p.pc.close(); } catch {} s.peers.delete(uid); }
  const onRt = (e) => onSig(e.detail); bus.addEventListener('rt:live-signal', onRt);

  async function requestClose() {
    if (!s.id) return finish(); // still on the setup screen
    if (await confirmBox('إنهاء البث المباشر؟ سيتوقف البث لجميع المشاهدين.', 'إنهاء', true)) { try { await sb.rpc('end_live', { p_id: s.id }); } catch {} finish('تم إنهاء البث' + (s.t0 ? ' · المدة ' + fmt(Math.floor((Date.now() - s.t0) / 1000)) : '')); }
  }
  function finish(text) {
    if (s.ended) return; s.ended = true; s.timers.forEach((t) => clearInterval(t)); bus.removeEventListener('rt:live-signal', onRt);
    for (const id of [...s.peers.keys()]) dropViewer(id);
    s.stream?.getTracks().forEach((t) => t.stop()); try { s.actx?.close(); } catch {} voiceGuests = []; if (s.imgUrl) URL.revokeObjectURL(s.imgUrl); el.remove(); if (hostSession === s) hostSession = null;
    if (text) toast(text);
  }
  paintOpts(); paintThumb(); setMode('camera');
}
export const isLiveHost = () => !!hostSession;
export function endLiveOnExit() { if (hostSession?.id && !hostSession.ended) beaconRpc('end_live', { p_id: hostSession.id }); }

// ============ VIEWER ============
export async function openWatch(live, host, opts = {}) {
  if (hostSession || watchSession) return toast('أنت داخل بث مباشر حالياً', 'err');
  const w = watchSession = { id: live.id, pc: null, dc: null, timers: [], ended: false, offer: false, ice: [], remoteSet: false, lastSig: 0, hostId: live.host_id, mic: null, guest: false };
  const video = h('video', { class: 'lv-video', playsinline: true, autoplay: true });
  const status = h('div', { class: 'lv-msg' }, 'جارٍ الاتصال بالبث...');
  const ov = buildOverlay({
    host: host || { id: live.host_id }, isHost: false, onClose: () => leave(), onShare: () => shareLive(host, live.title),
    onSend: (m) => { const full = { ...m, ...me() }; ov.addComment(full); if (w.dc?.readyState === 'open') { try { w.dc.send(JSON.stringify(full)); } catch {} } else toast('التعليقات غير متاحة حالياً', 'err'); },
    endBtn: h('button', { class: 'lx-end leave', type: 'button', onclick: () => leave() }, h('i', { class: 'lx-sq' }), h('span', null, 'خروج')),
  });
  ov.setViewers(live.viewers ?? 0);
  const tap = h('button', { class: 'btn primary lv-tap', type: 'button', hidden: true, onclick: () => { video.play(); tap.hidden = true; } }, 'اضغط للتشغيل');
  const el = h('div', { class: 'live-screen watch lx-screen', role: 'dialog' }, video, status, tap, ov.el);
  if (live.title) ov.el.append(h('div', { class: 'lv-title-show' }, live.title));
  document.body.append(el); el.classList.add('live-on'); el.addEventListener('m17:back', () => leave());

  let r; try { r = await sb.rpc('join_live', { p_id: live.id }); } catch (e) { r = { ok: false, error: 'x', msg: e.message }; }
  if (!r?.ok) { status.textContent = r.error === 'full' ? `البث ممتلئ حالياً (الحد الأقصى ${MAX_VIEWERS} مشاهدين). حاول لاحقاً.` : r.error === 'ended' ? 'انتهى هذا البث.' : r.error === 'forbidden' ? 'هذا البث لمتابعي المضيف فقط.' : (r.msg || 'تعذّر الانضمام للبث'); w.timers.push(setTimeout(() => leave(true), 2200)); return; }
  const pc = w.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
  pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' });
  w.sendAccept = () => { if (w.dc?.readyState === 'open') { try { w.dc.send(JSON.stringify({ t: 'acc', ...me() })); } catch {} } else toast('لم يكتمل الاتصال بعد، حاول بعد لحظات', 'err'); };
  async function handleOffer(sdp) {
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const tr = pc.getTransceivers().find((t) => t.mid != null && t.receiver?.track?.kind === 'audio');
      const sec = sdp.split(/\r?\nm=/).find((x) => x.startsWith('audio')) || ''; const dir = (sec.match(/a=(sendrecv|sendonly|recvonly|inactive)/) || [])[1];
      if (tr && dir === 'sendrecv') {
        if (!w.mic) w.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        tr.direction = 'sendrecv'; await tr.sender.replaceTrack(w.mic.getAudioTracks()[0]); guestUi(true);
      } else if (tr) { tr.direction = 'recvonly'; guestUi(false); }
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); w.dc.send(JSON.stringify({ t: 'ans', sdp: ans.sdp }));
    } catch (e) { toast('تعذّر تشغيل الميكروفون للانضمام', 'err'); try { w.dc.send(JSON.stringify({ t: 'leave' })); } catch {} guestUi(false); }
  }
  function guestUi(on) {
    w.guest = on; w.guestBar?.remove(); w.guestBar = null;
    if (!on) { w.mic?.getTracks().forEach((t) => t.stop()); w.mic = null; return; }
    let muted = false; const mb = h('button', { type: 'button', onclick: () => { muted = !muted; w.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted)); mb.replaceChildren(icon(muted ? 'micoff' : 'mic', 20), muted ? ' صامت' : ' ميكروفونك يعمل'); mb.classList.toggle('off', muted); } }, icon('mic', 20), ' ميكروفونك يعمل');
    w.guestBar = h('div', { class: 'lx-guestbar' }, mb, h('button', { type: 'button', onclick: () => { try { w.dc.send(JSON.stringify({ t: 'leave' })); } catch {} } }, 'إنهاء المشاركة'));
    el.append(w.guestBar); toast('أنت الآن تتحدث مع المضيف 🎙️');
  }
  pc.ondatachannel = (e) => { w.dc = e.channel; e.channel.onopen = () => { if (opts.guest) w.sendAccept(); }; e.channel.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (!m) return; if (m.t === 'off') handleOffer(String(m.sdp || '')); else if (m.t === 'full') toast('اكتمل عدد المتحدثين', 'err'); else if (['c', 'h', 'g'].includes(m.t)) ov.addComment(m); } catch {} }; };
  const remote = new MediaStream();
  pc.ontrack = (e) => { remote.addTrack(e.track); if (video.srcObject !== remote) video.srcObject = remote; video.play?.().catch(() => { tap.hidden = false; }); };
  pc.onicecandidate = (e) => { if (e.candidate) sendSig(w.id, w.hostId, 'ice', e.candidate.toJSON()); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') status.hidden = true; else if (pc.connectionState === 'failed') { status.hidden = false; status.textContent = 'تعذّر الاتصال بالبث (الشبكة لا تسمح بالاتصال المباشر).'; } else if (pc.connectionState === 'disconnected') { status.hidden = false; status.textContent = 'الاتصال ضعيف...'; } };
  video.addEventListener('playing', () => { status.hidden = true; });
  const join = () => sendSig(w.id, w.hostId, 'join'); join();
  let tries = 0;
  w.timers.push(setInterval(() => { if (!w.offer && ++tries <= 3) join(); else if (!w.offer && tries > 3) { status.hidden = false; status.textContent = 'المضيف لا يستجيب حالياً...'; } }, 6000));
  w.timers.push(setInterval(pollSig, 2000));
  w.timers.push(setInterval(async () => { try { const v = await sb.rpc('view_ping', { p_id: w.id }); ov.setViewers(v?.viewers ?? 0); if (v?.status !== 'live') { status.hidden = false; status.textContent = 'انتهى البث'; w.timers.push(setTimeout(() => leave(true), 1800)); } else if (!v?.joined) { await sb.rpc('join_live', { p_id: w.id }); } } catch {} }, 8000));
  async function pollSig() { if (w.ended) return; try { const rows = await sb.from('live_signals').select('*').eq('live_id', w.id).eq('to_id', state.me.id).gt('id', w.lastSig).order('id').limit(200); for (const x of rows) await onSig(x); } catch {} }
  async function onSig(sig) {
    if (!sig || seen.has('w' + sig.id) || w.ended || sig.live_id !== w.id) return; seen.add('w' + sig.id); w.lastSig = Math.max(w.lastSig, sig.id);
    try {
      if (sig.kind === 'offer' && !w.remoteSet) { w.offer = true; await pc.setRemoteDescription(sig.payload); w.remoteSet = true; for (const c of w.ice.splice(0)) { try { await pc.addIceCandidate(c); } catch {} } const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); await sendSig(w.id, w.hostId, 'answer', { type: ans.type, sdp: ans.sdp }); }
      else if (sig.kind === 'ice') { if (w.remoteSet) { try { await pc.addIceCandidate(sig.payload); } catch {} } else w.ice.push(sig.payload); }
      else if (sig.kind === 'bye') { status.hidden = false; status.textContent = 'انتهى البث'; w.timers.push(setTimeout(() => leave(true), 1500)); }
    } catch {}
  }
  w.onRt = (e) => onSig(e.detail); bus.addEventListener('rt:live-signal', w.onRt);
  function leave(silent) {
    if (w.ended) return; w.ended = true; w.timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); if (w.onRt) bus.removeEventListener('rt:live-signal', w.onRt);
    if (r?.ok) { sendSig(w.id, w.hostId, 'bye'); sb.rpc('leave_live', { p_id: w.id }).catch(() => {}); }
    w.mic?.getTracks().forEach((t) => t.stop()); try { w.pc?.close(); } catch {} el.remove(); if (watchSession === w) watchSession = null;
  }
}

// ============ "LIVE now" strip on the home page ============
export function liveStrip() {
  const box = h('div', { class: 'live-strip', hidden: true });
  async function load() {
    try {
      const rows = (await sb.rpc('live_now')) || []; const list = rows.filter((l) => l.host_id !== state.me.id);
      if (!list.length) { box.hidden = true; return; }
      const ps = new Map((await sb.from('profiles').select(PROFILE_MINI).in('id', list.map((l) => l.host_id))).map((p) => [p.id, p]));
      clear(box).append(h('div', { class: 'ls-title' }, badge(), ' مباشر الآن'), h('div', { class: 'ls-row' }, ...list.map((l) => { const p = ps.get(l.host_id); return h('button', { class: 'ls-item', type: 'button', onclick: () => openWatch(l, p) }, h('span', { class: 'ls-ring' }, avatar(p || { id: l.host_id }, 56)), h('span', { class: 'ls-name' }, p?.display_name || p?.username || ''), h('span', { class: 'ls-n' }, icon('eye', 12), ' ' + l.viewers)); })));
      box.hidden = false;
    } catch { /* ignore */ }
  }
  const iv = setInterval(() => { if (!document.hidden) load(); }, 15000);
  const onRt = () => load(); bus.addEventListener('rt:live', onRt); bus.addEventListener('m17:resume', onRt); load();
  box.cleanup = () => { clearInterval(iv); bus.removeEventListener('rt:live', onRt); bus.removeEventListener('m17:resume', onRt); };
  return box;
}
export async function watchHost(hostId) {
  try { const l = ((await sb.rpc('live_now')) || []).find((x) => x.host_id === hostId); if (!l) return toast('انتهى هذا البث', 'err'); const p = await sb.from('profiles').select(PROFILE_MINI).eq('id', hostId).one(); openWatch(l, p); } catch (e) { toast(e.message, 'err'); }
}
