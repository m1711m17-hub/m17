// Live streaming: the host's phone sends one WebRTC video stream to each viewer (peer-to-peer, signalling through Supabase `live_signals`).
// Limit: 6 simultaneous viewers per broadcast (no media server). Viewers = people who follow the host.
import { h, icon, avatar, toast, confirmBox, clear } from '../lib/dom.js';
import { sb, state, bus, rtLive, beaconRpc, PROFILE_MINI } from '../api.js';
import { ICE_SERVERS } from '../config.js';

export const MAX_VIEWERS = 6;
let hostSession = null, watchSession = null;
const seen = new Set();
const fmt = (s) => { const m = Math.floor(s / 60), x = s % 60, hh = Math.floor(m / 60); return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };
const sendSig = (live_id, to_id, kind, payload) => sb.from('live_signals').insert({ live_id, from_id: state.me.id, to_id, kind, payload: payload ?? {} }).catch(() => {});
const badge = () => h('span', { class: 'live-badge' }, h('i'), 'LIVE');

// ============ HOST ============
export function openLive() {
  if (hostSession || watchSession) return toast('أنت داخل بث مباشر حالياً', 'err');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('البث المباشر غير مدعوم على هذا الجهاز', 'err');
  const s = hostSession = { id: null, stream: null, facing: 'user', muted: false, peers: new Map(), timers: [], t0: 0, ended: false, lastSig: 0, pend: new Map() };
  const preview = h('video', { class: 'lv-video', playsinline: true, autoplay: true }); preview.muted = true; preview.volume = 0;
  const title = h('input', { class: 'lv-title', placeholder: 'اكتب عنوان البث...', maxlength: 100 });
  const msg = h('div', { class: 'lv-msg', hidden: true });
  const startBtn = h('button', { class: 'btn primary lv-start', type: 'button', onclick: () => start() }, icon('live', 20), ' بدء البث المباشر');
  const closeBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => requestClose() }, icon('close', 24));
  const flipBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'تبديل الكاميرا', onclick: () => flip() }, icon('flip', 22));
  const muteBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'كتم الميكروفون', hidden: true, onclick: () => { s.muted = !s.muted; s.stream?.getAudioTracks().forEach((t) => (t.enabled = !s.muted)); muteBtn.classList.toggle('on', s.muted); muteBtn.replaceChildren(icon(s.muted ? 'micoff' : 'mic', 22)); } }, icon('mic', 22));
  const stats = h('div', { class: 'lv-stats', hidden: true }, badge(), h('span', { class: 'lv-time' }, '0:00'), h('span', { class: 'lv-viewers' }, icon('eye', 16), h('b', null, '0')));
  const endBtn = h('button', { class: 'btn lv-end', type: 'button', hidden: true, onclick: () => requestClose() }, icon('phoneoff', 18), ' إنهاء البث');
  const setup = h('div', { class: 'lv-setup' }, h('div', { class: 'lv-note' }, `يظهر البث لمتابعيك داخل التطبيق ويصلهم إشعار. السعة الحالية: ${MAX_VIEWERS} مشاهدين في نفس الوقت.`), title, startBtn);
  const el = h('div', { class: 'live-screen', role: 'dialog' }, preview, msg, h('div', { class: 'lv-top' }, closeBtn, stats, h('span', { class: 'lv-tools' }, muteBtn, flipBtn)), setup, h('div', { class: 'lv-bottom' }, endBtn));
  s.ui = { el, stats, endBtn, setup, muteBtn, preview };
  document.body.append(el);
  el.addEventListener('m17:back', () => requestClose());

  async function cam() {
    try {
      s.stream?.getTracks().forEach((t) => t.stop());
      s.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: s.facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      if (s.ended) { s.stream.getTracks().forEach((t) => t.stop()); return; }
      s.stream.getAudioTracks().forEach((t) => (t.enabled = !s.muted));
      preview.srcObject = s.stream; preview.classList.toggle('mirror', s.facing === 'user'); preview.play?.().catch(() => {}); msg.hidden = true; startBtn.disabled = false;
    } catch (e) { startBtn.disabled = true; msg.hidden = false; msg.textContent = e?.name === 'NotAllowedError' ? 'لم تُمنح صلاحية الكاميرا/الميكروفون. فعّلها من إعدادات التطبيق ثم أعد فتح البث.' : 'تعذّر تشغيل الكاميرا على هذا الجهاز.'; }
  }
  async function flip() {
    const old = s.facing; s.facing = old === 'user' ? 'environment' : 'user';
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: s.facing }, width: { ideal: 1280 }, height: { ideal: 720 } } }); const nt = ns.getVideoTracks()[0];
      const ot = s.stream.getVideoTracks()[0]; ot?.stop(); if (ot) s.stream.removeTrack(ot); s.stream.addTrack(nt);
      for (const p of s.peers.values()) { const snd = p.pc.getSenders().find((x) => x.track?.kind === 'video' || x.__v); if (snd) await snd.replaceTrack(nt); }
      preview.srcObject = s.stream; preview.classList.toggle('mirror', s.facing === 'user');
    } catch { s.facing = old; toast('تعذّر تبديل الكاميرا', 'err'); }
  }
  async function start() {
    startBtn.disabled = true;
    try {
      const r = await sb.rpc('start_live', { p_title: title.value.trim() });
      if (!r?.ok) throw new Error('تعذّر بدء البث');
      s.id = r.id; s.t0 = Date.now(); s.title = title.value.trim();
    } catch (e) { startBtn.disabled = false; return toast(e.message, 'err'); }
    setup.hidden = true; stats.hidden = false; endBtn.hidden = false; muteBtn.hidden = false;
    if (s.title) el.append(h('div', { class: 'lv-title-show' }, s.title));
    s.timers.push(setInterval(() => { stats.querySelector('.lv-time').textContent = fmt(Math.floor((Date.now() - s.t0) / 1000)); }, 1000));
    s.timers.push(setInterval(ping, 8000)); s.timers.push(setInterval(pollSig, 2000)); ping(); toast('بدأ البث المباشر 🔴');
  }
  async function ping() {
    try { const r = await sb.rpc('ping_live', { p_id: s.id }); if (r?.status === 'none' || r?.status === 'ended') return finish('انتهى البث'); stats.querySelector('b').textContent = r?.viewers ?? 0; } catch {}
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
    const p = { pc, remoteSet: false, ice: [] }; s.peers.set(uid, p);
    pc.onicecandidate = (e) => { if (e.candidate) sendSig(s.id, uid, 'ice', e.candidate.toJSON()); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropViewer(uid, pc); };
    s.stream.getTracks().forEach((t) => { const snd = pc.addTrack(t, s.stream); if (t.kind === 'video') { snd.__v = true; try { const pr = snd.getParameters(); pr.encodings = pr.encodings?.length ? pr.encodings : [{}]; pr.encodings[0].maxBitrate = 900000; snd.setParameters(pr).catch(() => {}); } catch {} } });
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await sendSig(s.id, uid, 'offer', { type: offer.type, sdp: offer.sdp });
  }
  function dropViewer(uid, onlyPc) { const p = s.peers.get(uid); if (!p || (onlyPc && p.pc !== onlyPc)) return; try { p.pc.close(); } catch {} s.peers.delete(uid); }
  const onRt = (e) => onSig(e.detail); bus.addEventListener('rt:live-signal', onRt);

  async function requestClose() {
    if (!s.id) return finish(); // still on the setup screen
    if (await confirmBox('إنهاء البث المباشر؟ سيتوقف البث لجميع المشاهدين.', 'إنهاء', true)) { try { await sb.rpc('end_live', { p_id: s.id }); } catch {} finish('تم إنهاء البث' + (s.t0 ? ' · المدة ' + fmt(Math.floor((Date.now() - s.t0) / 1000)) : '')); }
  }
  function finish(text) {
    if (s.ended) return; s.ended = true; s.timers.forEach((t) => clearInterval(t)); bus.removeEventListener('rt:live-signal', onRt);
    for (const id of [...s.peers.keys()]) dropViewer(id);
    s.stream?.getTracks().forEach((t) => t.stop()); el.remove(); if (hostSession === s) hostSession = null;
    if (text) toast(text);
  }
  cam();
}
export const isLiveHost = () => !!hostSession;
export function endLiveOnExit() { if (hostSession?.id && !hostSession.ended) beaconRpc('end_live', { p_id: hostSession.id }); }

// ============ VIEWER ============
export async function openWatch(live, host) {
  if (hostSession || watchSession) return toast('أنت داخل بث مباشر حالياً', 'err');
  const w = watchSession = { id: live.id, pc: null, timers: [], ended: false, offer: false, ice: [], remoteSet: false, lastSig: 0, hostId: live.host_id };
  const video = h('video', { class: 'lv-video', playsinline: true, autoplay: true });
  const status = h('div', { class: 'lv-msg' }, 'جارٍ الاتصال بالبث...');
  const viewers = h('b', null, '0');
  const closeBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'خروج', onclick: () => leave() }, icon('close', 24));
  const info = h('div', { class: 'lv-host' }, avatar(host || { id: live.host_id }, 38), h('div', null, h('b', null, host?.display_name || host?.username || 'مضيف'), live.title ? h('div', { class: 'small' }, live.title) : null));
  const tap = h('button', { class: 'btn primary lv-tap', type: 'button', hidden: true, onclick: () => { video.play(); tap.hidden = true; } }, 'اضغط للتشغيل');
  const el = h('div', { class: 'live-screen watch', role: 'dialog' }, video, status, tap, h('div', { class: 'lv-top' }, closeBtn, info, h('span', { class: 'lv-stats' }, badge(), h('span', { class: 'lv-viewers' }, icon('eye', 16), viewers))));
  document.body.append(el); el.addEventListener('m17:back', () => leave());

  let r; try { r = await sb.rpc('join_live', { p_id: live.id }); } catch (e) { r = { ok: false, error: 'x', msg: e.message }; }
  if (!r?.ok) { status.textContent = r.error === 'full' ? `البث ممتلئ حالياً (الحد الأقصى ${MAX_VIEWERS} مشاهدين). حاول لاحقاً.` : r.error === 'ended' ? 'انتهى هذا البث.' : r.error === 'forbidden' ? 'هذا البث لمتابعي المضيف فقط.' : (r.msg || 'تعذّر الانضمام للبث'); w.timers.push(setTimeout(() => leave(true), 2200)); return; }
  const pc = w.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
  pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' });
  const remote = new MediaStream();
  pc.ontrack = (e) => { remote.addTrack(e.track); if (video.srcObject !== remote) video.srcObject = remote; video.play?.().catch(() => { tap.hidden = false; }); };
  pc.onicecandidate = (e) => { if (e.candidate) sendSig(w.id, w.hostId, 'ice', e.candidate.toJSON()); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') status.hidden = true; else if (pc.connectionState === 'failed') { status.hidden = false; status.textContent = 'تعذّر الاتصال بالبث (الشبكة لا تسمح بالاتصال المباشر).'; } else if (pc.connectionState === 'disconnected') { status.hidden = false; status.textContent = 'الاتصال ضعيف...'; } };
  video.addEventListener('playing', () => { status.hidden = true; });
  const join = () => sendSig(w.id, w.hostId, 'join'); join();
  let tries = 0;
  w.timers.push(setInterval(() => { if (!w.offer && ++tries <= 3) join(); else if (!w.offer && tries > 3) { status.hidden = false; status.textContent = 'المضيف لا يستجيب حالياً...'; } }, 6000));
  w.timers.push(setInterval(pollSig, 2000));
  w.timers.push(setInterval(async () => { try { const v = await sb.rpc('view_ping', { p_id: w.id }); viewers.textContent = v?.viewers ?? 0; if (v?.status !== 'live') { status.hidden = false; status.textContent = 'انتهى البث'; w.timers.push(setTimeout(() => leave(true), 1800)); } else if (!v?.joined) { await sb.rpc('join_live', { p_id: w.id }); } } catch {} }, 8000));
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
    try { w.pc?.close(); } catch {} el.remove(); if (watchSession === w) watchSession = null;
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
