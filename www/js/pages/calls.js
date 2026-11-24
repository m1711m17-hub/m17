// Audio / video calls over WebRTC. Signaling = Supabase tables `calls` + `call_signals` (Realtime events with REST polling fallback).
import { h, icon, avatar, clear, toast, timeAgo } from '../lib/dom.js';
import { sb, state, bus, rtLive, PROFILE_MINI } from '../api.js';
import { ICE_SERVERS, refreshIce } from '../config.js';
import { headerBar } from './home.js';

let cur = null;
const seenSig = new Set(); const handled = new Set(); const pendingIncoming = new Set();
export const inCall = () => !!cur;
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// ---- tones (generated, no asset files) ----
function ringer(mode) {
  let ac; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return () => {}; }
  let stopped = false;
  const beep = (f, d) => { if (stopped) return; try { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = 0.0001; o.connect(g); g.connect(ac.destination); const t = ac.currentTime; g.gain.exponentialRampToValueAtTime(0.22, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.start(t); o.stop(t + d + 0.05); } catch {} };
  const pat = mode === 'in' ? () => { beep(880, 0.35); setTimeout(() => beep(660, 0.35), 420); try { navigator.vibrate?.([300, 150, 300]); } catch {} } : () => beep(425, 1);
  try { ac.resume?.(); } catch {}
  pat(); const iv = setInterval(pat, mode === 'in' ? 2200 : 3000);
  return () => { stopped = true; clearInterval(iv); try { ac.close(); } catch {} try { navigator.vibrate?.(0); } catch {} };
}

async function getMedia(kind) {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (kind === 'audio') return { stream: await navigator.mediaDevices.getUserMedia({ audio }), camDenied: false };
  try { return { stream: await navigator.mediaDevices.getUserMedia({ audio, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } }), camDenied: false }; }
  catch { return { stream: await navigator.mediaDevices.getUserMedia({ audio }), camDenied: true }; }
}

async function sendSignal(s, kind, payload) {
  try { await sb.from('call_signals').insert({ call_id: s.callId, from_id: state.me.id, to_id: s.peer.id, kind, payload: payload ?? {} }); } catch { /* call may already be over */ }
}

// ---- starting an outgoing call ----
export async function placeCall(peer, kind) {
  if (cur) return toast('أنت في مكالمة حالياً', 'err');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('المكالمات غير مدعومة على هذا الجهاز', 'err');
  let media;
  try { media = await getMedia(kind); } catch (e) { return toast(e?.name === 'NotAllowedError' ? 'لم تُمنح صلاحية الميكروفون/الكاميرا. فعّلها من إعدادات التطبيق' : 'تعذّر الوصول للميكروفون', 'err'); }
  let r;
  try { r = await sb.rpc('start_call', { p_callee: peer.id, p_kind: kind }); } catch (e) { media.stream.getTracks().forEach((t) => t.stop()); return toast(e.message, 'err'); }
  if (!r?.ok) { media.stream.getTracks().forEach((t) => t.stop()); return toast(r?.error === 'busy' ? 'المستخدم مشغول بمكالمة أخرى' : 'تعذّر بدء المكالمة', 'err'); }
  handled.add(r.id);
  const s = newSession({ callId: r.id, peer, kind, role: 'caller' });
  s.local = media.stream; s.camOn = kind === 'video' && !media.camDenied;
  s.local.getAudioTracks().forEach((t) => (t.enabled = false)); // mic stays silent while ringing; enabled once connected
  if (media.camDenied) toast('لم تُمنح صلاحية الكاميرا — المكالمة بالصوت فقط', 'err');
  mountUI(s); s.stopRing = ringer('out');
  s.timers.push(setTimeout(() => { if (cur === s && s.status === 'calling') hangup(s, 'لا يوجد رد'); }, 45000));
  try {
    await refreshIce(2500); setupPc(s);
    const a = s.local.getAudioTracks()[0]; s.pc.addTransceiver(a, { direction: 'sendrecv' });
    const vt = s.local.getVideoTracks()[0];
    if (kind === 'video') s.vSender = s.pc.addTransceiver(vt || 'video', { direction: 'sendrecv' }).sender;
    const offer = await s.pc.createOffer(); await s.pc.setLocalDescription(offer);
    await sendSignal(s, 'offer', { type: offer.type, sdp: offer.sdp });
  } catch (e) { hangup(s, 'تعذّر إنشاء المكالمة'); return; }
  startTick(s);
}

function newSession({ callId, peer, kind, role }) {
  const s = { callId, peer, kind, role, pc: null, local: null, remote: new MediaStream(), remoteAudio: new MediaStream(), remoteVideo: new MediaStream(), muted: false, camOn: kind === 'video', facing: 'user', status: role === 'caller' ? 'calling' : 'ringing',
    connectedAt: 0, timers: [], stopRing: null, ended: false, peerCam: true, peerMuted: false, offer: null, pendingIce: [], remoteSet: false, speaker: kind === 'video', ctl: null, vSender: null, ui: {}, lostTimer: null };
  cur = s; return s;
}

function setupPc(s) {
  s.cands = { host: 0, srflx: 0, relay: 0 };
  const pc = s.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
  pc.onicecandidate = (e) => { if (e.candidate) { const ty = e.candidate.type; if (ty in s.cands) s.cands[ty]++; } if (e.candidate) sendSignal(s, 'ice', e.candidate.toJSON()); };
  pc.ontrack = (e) => { const target = e.track.kind === 'audio' ? s.remoteAudio : s.remoteVideo; if (!target.getTracks().some((t) => t.id === e.track.id)) target.addTrack(e.track); e.track.onunmute = () => { attachRemote(s); paint(s); }; e.track.onmute = () => paint(s); e.track.onended = () => { try { target.removeTrack(e.track); } catch {} attachRemote(s); paint(s); }; attachRemote(s); paint(s); };
  pc.oniceconnectionstatechange = () => { if (!s.ended && ['connected', 'completed'].includes(pc.iceConnectionState)) onConnected(s); };
  pc.onconnectionstatechange = () => {
    if (s.ended) return;
    const st = pc.connectionState;
    if (st === 'connected') { clearTimeout(s.lostTimer); s.lostTimer = null; onConnected(s); }
    else if (st === 'disconnected') { s.weak = true; paint(s); clearTimeout(s.lostTimer); s.lostTimer = setTimeout(() => { if (cur === s && pc.connectionState !== 'connected') hangup(s, 'انقطع الاتصال'); }, 10000); }
    else if (st === 'failed') hangup(s, 'تعذّر الاتصال (الشبكة لا تسمح بالمكالمات المباشرة)');
  };
  const t0 = Date.now(); let restarted = false;
  s.timers.push(setInterval(() => {
    if (s.ended || s.connectedAt) return;
    const sec = (Date.now() - t0) / 1000, c = s.cands;
    s.diag = `ICE: ${pc.iceConnectionState} · host ${c.host} / srflx ${c.srflx} / relay ${c.relay}`; paint(s);
    if (sec > 12 && !restarted && ['checking', 'disconnected', 'failed', 'new'].includes(pc.iceConnectionState)) { restarted = true; try { pc.restartIce?.(); } catch {} }
    if (sec > 30) hangup(s, c.relay ? 'تعذّر إكمال الاتصال بين الهاتفين' : 'تعذّر الاتصال: لا يوجد خادم تمرير (TURN) يعمل على شبكتك');
  }, 1000));
  const ch = pc.createDataChannel('ctl', { negotiated: true, id: 0 }); s.ctl = ch;
  ch.onmessage = (e) => { try { const m = JSON.parse(e.data); if ('cam' in m) s.peerCam = !!m.cam; if ('muted' in m) s.peerMuted = !!m.muted; paint(s); } catch {} };
  ch.onopen = () => sendCtl(s);
}
const sendCtl = (s) => { try { if (s.ctl?.readyState === 'open') s.ctl.send(JSON.stringify({ cam: s.kind === 'video' ? s.camOn : false, muted: s.muted })); } catch {} };
function attachRemote(s) { const v = s.ui.remote, a = s.ui.remoteAudio; if (v && v.srcObject !== s.remoteVideo) { v.srcObject = s.remoteVideo; v.muted = true; v.playsInline = true; v.play?.().catch(() => {}); } if (a && a.srcObject !== s.remoteAudio) { a.srcObject = s.remoteAudio; a.muted = false; a.volume = 1; a.play?.().catch(() => {}); } else if (a && a.paused && s.remoteAudio.getAudioTracks().length) a.play?.().catch(() => {}); }

function onConnected(s) {
  if (s.connectedAt) { s.weak = false; s.local?.getAudioTracks().forEach((t) => { if (t.enabled === s.muted) t.enabled = !s.muted; }); paint(s); return; }
  s.stopRing?.(); s.stopRing = null; s.status = 'connected'; s.connectedAt = Date.now(); s.weak = false; s.local?.getAudioTracks().forEach((t) => (t.enabled = !s.muted));
  s.timers.push(setInterval(() => { s.local?.getAudioTracks().forEach((t) => { if (t.enabled === s.muted) t.enabled = !s.muted; }); const v = s.ui.remote; if (v && v.paused) v.play?.().catch(() => {}); const a = s.ui.remoteAudio; if (a && a.paused && s.remoteAudio.getAudioTracks().some((t) => t.readyState === 'live')) a.play?.().catch(() => {}); paint(s); }, 1000)); sendCtl(s); paint(s); attachRemote(s);
}

// ---- incoming ----
async function onIncoming(call) {
  if (!call || call.status !== 'ringing' || cur || handled.has(call.id) || pendingIncoming.has(call.id) || call.callee_id !== state.me?.id) return;
  if (Date.now() - new Date(call.created_at).getTime() > 46000) return;
  // Profile lookup is asynchronous; reserve this call while it is in flight so
  // realtime + polling cannot open duplicate incoming-call screens.
  pendingIncoming.add(call.id);
  try {
    let peer = null; try { peer = await sb.from('profiles').select(PROFILE_MINI).eq('id', call.caller_id).one(); } catch {}
    if (cur || handled.has(call.id)) return; // another call/session won the race
    handled.add(call.id);
    const s = newSession({ callId: call.id, peer: peer || { id: call.caller_id, username: '?', display_name: 'مستخدم' }, kind: call.kind, role: 'callee' });
    mountUI(s); s.stopRing = ringer('in');
    s.timers.push(setTimeout(() => { if (cur === s && s.status === 'ringing') finish(s, 'فاتتك المكالمة'); }, 46000));
    startTick(s);
  } finally {
    pendingIncoming.delete(call.id);
  }
}
async function acceptCall(s) {
  if (s.status !== 'ringing') return;
  s.status = 'connecting'; s.stopRing?.(); s.stopRing = null; paint(s);
  let media;
  try { media = await getMedia(s.kind); } catch (e) { try { await sb.rpc('reject_call', { p_id: s.callId }); } catch {} sendSignal(s, 'bye'); finish(s, 'لم تُمنح صلاحية الميكروفون'); toast('فعّل صلاحية الميكروفون من إعدادات التطبيق', 'err'); return; }
  if (s.ended) { media.stream.getTracks().forEach((t) => t.stop()); return; }
  let ok = false; try { ok = await sb.rpc('answer_call', { p_id: s.callId }); } catch {}
  if (!ok) { media.stream.getTracks().forEach((t) => t.stop()); finish(s, 'انتهت المكالمة'); return; }
  s.local = media.stream; s.camOn = s.kind === 'video' && !media.camDenied; if (media.camDenied) toast('الكاميرا غير متاحة — بالصوت فقط', 'err');
  paint(s);
  try { await refreshIce(2500); await applyOffer(s); } catch (e) { hangup(s, 'تعذّر إنشاء المكالمة'); }
}
async function applyOffer(s) {
  if (!s.offer || !s.local || s.pc) return;
  setupPc(s); await s.pc.setRemoteDescription(s.offer); s.remoteSet = true;
  for (const t of s.pc.getTransceivers()) {
    t.direction = 'sendrecv'; const k = t.receiver.track.kind; const tr = s.local.getTracks().find((x) => x.kind === k);
    if (tr) await t.sender.replaceTrack(tr); if (k === 'video') s.vSender = t.sender;
  }
  await flushIce(s);
  const ans = await s.pc.createAnswer(); await s.pc.setLocalDescription(ans);
  await sendSignal(s, 'answer', { type: ans.type, sdp: ans.sdp });
}
async function flushIce(s) { const q = s.pendingIce.splice(0); for (const c of q) { try { await s.pc.addIceCandidate(c); } catch {} } }

// ---- signaling intake (realtime push + polling fallback, deduped by id) ----
async function onSignal(sig) {
  if (!sig) return;
  const s = cur;
  // Do not mark a signal as seen until its call session exists; the offer can arrive
  // before the incoming-call event and must remain available to the polling fallback.
  if (!s || sig.call_id !== s.callId || s.ended || seenSig.has(sig.id)) return;
  seenSig.add(sig.id);
  try {
    if (sig.kind === 'offer') { s.offer = sig.payload; if (s.local) await applyOffer(s); }
    else if (sig.kind === 'answer') { if (s.pc && !s.remoteSet) { await s.pc.setRemoteDescription(sig.payload); s.remoteSet = true; await flushIce(s); } }
    else if (sig.kind === 'ice') { if (s.pc && s.remoteSet) { try { await s.pc.addIceCandidate(sig.payload); } catch {} } else s.pendingIce.push(sig.payload); }
    else if (sig.kind === 'bye') finish(s, s.connectedAt ? 'انتهت المكالمة' : s.role === 'caller' ? 'تم رفض المكالمة' : 'فاتتك المكالمة');
  } catch { /* ignore a bad signal */ }
}
async function pollSignals(s) {
  try { const rows = await sb.from('call_signals').select('*').eq('call_id', s.callId).eq('to_id', state.me.id).order('id').limit(200); for (const r of rows) await onSignal(r); } catch {}
}
function onCallUpdate(c) {
  const s = cur; if (!s || !c || c.id !== s.callId || s.ended) return;
  if (c.status === 'accepted' && s.role === 'caller' && s.status === 'calling') { s.status = 'connecting'; s.stopRing?.(); s.stopRing = null; paint(s); }
  else if (c.status === 'rejected') finish(s, 'تم رفض المكالمة');
  else if (c.status === 'missed' || c.status === 'cancelled') finish(s, s.role === 'caller' ? 'لا يوجد رد' : 'فاتتك المكالمة');
  else if (c.status === 'ended' && s.status !== 'ringing') finish(s, 'انتهت المكالمة');
}
function startTick(s) {
  let n = 0;
  const tick = async () => {
    if (cur !== s || s.ended) return; n++;
    const fast = s.status !== 'connected';
    if (fast || n % 5 === 0 || !rtLive()) await pollSignals(s);
    try {
      if (s.status === 'connected' || s.status === 'connecting') { if (n % 4 === 0 || !rtLive()) { const st = await sb.rpc('ping_call', { p_id: s.callId }); if (st && st !== 'accepted' && cur === s) finish(s, 'انتهت المكالمة'); } }
      else { const c = await sb.from('calls').select('id,status').eq('id', s.callId).one(); onCallUpdate(c); }
    } catch {}
  };
  s.timers.push(setInterval(tick, 2000)); tick();
}

// ---- ending ----
async function hangup(s, why) {
  if (!s || s.ended) return;
  const wasRinging = s.status === 'ringing';
  sendSignal(s, 'bye');
  try { if (wasRinging && s.role === 'callee') await sb.rpc('reject_call', { p_id: s.callId }); else await sb.rpc('end_call', { p_id: s.callId }); } catch {}
  finish(s, why || 'انتهت المكالمة');
}
function finish(s, text) {
  if (s.ended) return; s.ended = true; s.status = 'ended'; s.statusText = text;
  s.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); clearTimeout(s.lostTimer); s.stopRing?.();
  try { s.pc?.close(); } catch {} try { s.ui.remote?.pause?.(); s.ui.remoteAudio?.pause?.(); s.ui.remote.srcObject = null; s.ui.remoteAudio.srcObject = null; } catch {} try { s.local?.getTracks().forEach((t) => t.stop()); } catch {}
  paint(s); setTimeout(() => { s.ui.el?.remove(); if (cur === s) cur = null; bus.dispatchEvent(new CustomEvent('m17:call-ended')); }, 900);
  if (cur === s) cur = null; // free immediately so a new call can start; UI fades out
}

// ---- UI ----
const ctlBtn = (cls, label, ic, fn, on) => h('button', { class: 'cs-btn ' + cls + (on ? ' on' : ''), type: 'button', 'aria-label': label, onclick: fn }, icon(ic, 26), h('span', null, label));
function mountUI(s) {
  const remote = h('video', { class: 'cs-remote', playsinline: true, autoplay: true }); remote.muted = true;
  const remoteAudio = h('audio', { class: 'cs-audio', autoplay: true }); remoteAudio.hidden = true; remoteAudio.muted = false; remoteAudio.volume = 1;
  const local = h('video', { class: 'cs-local', playsinline: true, autoplay: true }); local.muted = true; local.volume = 0;
  const name = h('h2', null, s.peer.display_name || s.peer.username), status = h('div', { class: 'cs-status' }), flags = h('div', { class: 'cs-flags' });
  const info = h('div', { class: 'cs-info' }, h('div', { class: 'cs-av' }, avatar(s.peer, 120)), name, status, flags);
  const controls = h('div', { class: 'cs-controls' });
  const el = h('div', { class: 'call-screen ' + s.kind, role: 'dialog' }, remote, remoteAudio, local, info, controls);
  s.ui = { el, remote, remoteAudio, local, status, flags, controls, info };
  document.body.append(el);
  el.addEventListener('m17:back', () => { /* back button never silently drops a call */ toast('اضغط زر إنهاء المكالمة لإنهائها'); });
  paint(s);
}
async function toggleSpeaker(s) {
  const v = s.ui.remoteAudio || s.ui.remote;
  if (!v?.setSinkId || !navigator.mediaDevices.enumerateDevices) return toast('تبديل مخرج الصوت غير مدعوم على هذا الجهاز', 'err');
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    const want = !s.speaker; const pick = want ? outs.find((d) => /speaker/i.test(d.label)) : outs.find((d) => /earpiece|receiver|handset|phone/i.test(d.label));
    if (!pick && outs.length < 2) return toast('لا يوجد مخرج صوت آخر متاح على هذا الجهاز', 'err');
    await v.setSinkId((pick || outs.find((d) => d.deviceId !== 'default') || outs[0]).deviceId); s.speaker = want; paint(s);
  } catch { toast('تعذّر تبديل مخرج الصوت', 'err'); }
}
function toggleMute(s) { s.muted = !s.muted; s.local?.getAudioTracks().forEach((t) => (t.enabled = !s.muted)); sendCtl(s); paint(s); }
async function toggleCam(s) {
  if (s.kind !== 'video' || !s.vSender) return;
  try {
    if (s.camOn) { const t = s.local.getVideoTracks()[0]; t?.stop(); if (t) s.local.removeTrack(t); await s.vSender.replaceTrack(null); s.camOn = false; }
    else { const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: s.facing, width: { ideal: 640 }, height: { ideal: 480 } } }); const t = ns.getVideoTracks()[0]; s.local.addTrack(t); await s.vSender.replaceTrack(t); s.camOn = true; s.ui.local.srcObject = null; }
    sendCtl(s); paint(s);
  } catch { toast('تعذّر تشغيل الكاميرا', 'err'); }
}
async function flipCam(s) {
  if (!s.camOn || !s.vSender) return;
  const nf = s.facing === 'user' ? 'environment' : 'user';
  try {
    const old = s.local.getVideoTracks()[0]; old?.stop();
    const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nf }, width: { ideal: 640 }, height: { ideal: 480 } } }); const t = ns.getVideoTracks()[0];
    if (old) s.local.removeTrack(old); s.local.addTrack(t); await s.vSender.replaceTrack(t); s.facing = nf; s.ui.local.srcObject = null; paint(s);
  } catch { toast('تعذّر تبديل الكاميرا', 'err'); try { const t = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0]; s.local.addTrack(t); await s.vSender.replaceTrack(t); } catch {} paint(s); }
}
function paint(s) {
  const u = s.ui; if (!u.el) return;
  const connected = s.status === 'connected';
  const txt = s.statusText || (s.status === 'calling' ? 'جارٍ الاتصال...' : s.status === 'ringing' ? (s.kind === 'video' ? 'مكالمة فيديو واردة' : 'مكالمة صوتية واردة') : s.status === 'connecting' ? 'جارٍ التوصيل...' : connected ? (s.weak ? 'الاتصال ضعيف...' : fmt(Math.floor((Date.now() - s.connectedAt) / 1000))) : '');
  u.status.textContent = txt;
  if (s.diag && !connected && s.status === 'connecting') u.status.append(h('div', { class: 'small muted', dir: 'ltr' }, s.diag));
  u.flags.replaceChildren(...[s.peerMuted && connected ? h('span', null, icon('micoff', 16), ' الطرف الآخر كتم الصوت') : null, s.kind === 'video' && connected && !s.peerCam ? h('span', null, icon('videooff', 16), ' أغلق الكاميرا') : null].filter(Boolean));
  const remoteVideoLive = s.kind === 'video' && connected && s.peerCam && s.remoteVideo.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
  u.el.classList.toggle('has-video', remoteVideoLive); u.el.classList.toggle('connected', connected);
  if (s.local && s.kind === 'video' && s.camOn) { if (!u.local.srcObject) { u.local.srcObject = new MediaStream(s.local.getVideoTracks()); u.local.muted = true; u.local.play?.().catch(() => {}); } u.local.hidden = false; u.local.classList.toggle('mirror', s.facing === 'user'); } else u.local.hidden = true;
  const c = []; const ended = s.ended;
  if (!ended) {
    if (s.status === 'ringing') c.push(ctlBtn('reject', 'رفض', 'phoneoff', () => hangup(s, 'تم رفض المكالمة')), ctlBtn('accept', 'رد', s.kind === 'video' ? 'video' : 'phone', () => acceptCall(s)));
    else {
      c.push(ctlBtn('', s.muted ? 'تشغيل الصوت' : 'كتم', s.muted ? 'micoff' : 'mic', () => toggleMute(s), s.muted), ctlBtn('', 'السماعة', 'speaker', () => toggleSpeaker(s), s.speaker));
      if (s.kind === 'video') c.push(ctlBtn('', s.camOn ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا', s.camOn ? 'video' : 'videooff', () => toggleCam(s), !s.camOn), ctlBtn('', 'قلب', 'flip', () => flipCam(s)));
      c.push(ctlBtn('reject', 'إنهاء', 'phoneoff', () => hangup(s)));
    }
  }
  u.controls.replaceChildren(...c);
}

// ---- wiring: called once after login ----
let wired = false, ivCheck = null;
async function checkIncoming() {
  if (!state.me || cur) return;
  try { const rows = await sb.from('calls').select('*').eq('callee_id', state.me.id).eq('status', 'ringing').gte('created_at', new Date(Date.now() - 44000).toISOString()).order('created_at', { ascending: false }).limit(1); if (rows[0]) onIncoming(rows[0]); } catch {}
}
export function initCalls() {
  if (wired) return; wired = true;
  bus.addEventListener('rt:call', (e) => onIncoming(e.detail));
  bus.addEventListener('rt:call-update', (e) => onCallUpdate(e.detail));
  bus.addEventListener('rt:signal', (e) => onSignal(e.detail));
  ['rt:ready', 'm17:resume'].forEach((n) => bus.addEventListener(n, checkIncoming));
  ivCheck = setInterval(() => { if (!document.hidden && !rtLive()) checkIncoming(); }, 3000);
  checkIncoming();
}
export function stopCalls() { if (cur) hangup(cur); }

// ---- call log page (#/calls) ----
export async function callsPage(root) {
  const list = h('div', { class: 'card-list' });
  root.append(headerBar('سجل المكالمات', { back: true }), h('div', { class: 'page' }, list));
  try {
    const me = state.me.id;
    const rows = await sb.from('calls').select('*').or(`caller_id.eq.${me},callee_id.eq.${me}`).order('created_at', { ascending: false }).limit(60);
    if (!rows.length) return list.append(h('div', { class: 'empty' }, icon('phone', 44), h('h3', null, 'لا توجد مكالمات'), h('p', null, 'ابدأ مكالمة من داخل أي محادثة.')));
    const ids = [...new Set(rows.map((r) => (r.caller_id === me ? r.callee_id : r.caller_id)))];
    const ps = new Map((await sb.from('profiles').select(PROFILE_MINI).in('id', ids)).map((p) => [p.id, p]));
    rows.forEach((c) => {
      const out = c.caller_id === me, pid = out ? c.callee_id : c.caller_id, p = ps.get(pid); if (!p) return;
      const missed = !out && ['missed', 'cancelled'].includes(c.status);
      const dur = c.answered_at && c.ended_at ? Math.max(0, Math.round((new Date(c.ended_at) - new Date(c.answered_at)) / 1000)) : 0;
      const label = missed ? 'فائتة' : out ? 'صادرة' : c.status === 'rejected' ? 'مرفوضة' : 'واردة';
      const sub = `${out ? '↗' : '↙'} ${label} · ${c.kind === 'video' ? 'فيديو' : 'صوتية'}${dur ? ' · ' + fmt(dur) : ''}`;
      list.append(h('div', { class: 'user-row call-row' + (missed ? ' missed' : '') }, h('a', { href: `#/u/${p.username}` }, avatar(p, 48)),
        h('div', { class: 'grow' }, h('b', null, p.display_name || p.username), h('div', { class: 'muted small cl-sub' }, sub), h('div', { class: 'muted small' }, timeAgo(c.created_at))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'اتصال صوتي', onclick: () => placeCall(p, 'audio') }, icon('phone', 22)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'اتصال فيديو', onclick: () => placeCall(p, 'video') }, icon('video', 22))));
    });
  } catch (e) { list.append(h('div', { class: 'empty' }, e.message)); }
}
