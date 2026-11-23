// In-app camera: live preview through a canvas (so the chosen filter is baked into photos AND videos),
// photo + video, flash (only when the device exposes a torch), front/back switch, preview/retake/send, gallery pick.
import { h, icon, toast } from '../lib/dom.js';

export const FILTERS = [
  { id: 'natural', name: 'طبيعي', css: 'none', vig: 0 },
  { id: 'cinematic', name: 'سينمائي', css: 'contrast(1.18) saturate(.82) sepia(.18) brightness(.94) hue-rotate(-6deg)', vig: 0.55 },
  { id: 'warm', name: 'دافئ', css: 'sepia(.28) saturate(1.3) hue-rotate(-12deg) brightness(1.03)', vig: 0.15 },
  { id: 'cool', name: 'بارد', css: 'saturate(1.08) hue-rotate(16deg) brightness(1.03) contrast(1.04)', vig: 0.1 },
  { id: 'bw', name: 'أبيض وأسود', css: 'grayscale(1) contrast(1.12)', vig: 0.3 },
];
const MAX_VIDEO_MS = 60000;
const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia;

// onSend(File) is called with the final image/video file. Returns a close() function.
export function openCamera({ onSend, allowVideo = true, sendLabel = 'إرسال' } = {}) {
  let stream = null, facing = 'environment', fi = 0, raf = 0, rec = null, chunks = [], recT0 = 0, recTimer = null, torch = false, result = null, resultUrl = null, closed = false;
  const video = h('video', { playsinline: true, muted: true, autoplay: true, style: { display: 'none' } });
  const canvas = h('canvas', { class: 'cam-canvas' });
  const ctx = canvas.getContext('2d');
  const msg = h('div', { class: 'cam-msg' }, 'جارٍ تشغيل الكاميرا...');
  const timer = h('div', { class: 'cam-timer', hidden: true });
  const fileIn = h('input', { type: 'file', accept: allowVideo ? 'image/*,video/*' : 'image/*', style: { display: 'none' } });
  const filterBar = h('div', { class: 'cam-filters' }, FILTERS.map((f, i) => h('button', { type: 'button', class: 'cam-filter' + (i === 0 ? ' on' : ''), 'data-f': f.id, onclick: () => { fi = i; [...filterBar.children].forEach((c, k) => c.classList.toggle('on', k === i)); } }, f.name)));
  const flashBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'الفلاش', hidden: true, onclick: async () => {
    const tr = stream?.getVideoTracks()[0]; if (!tr) return; torch = !torch;
    try { await tr.applyConstraints({ advanced: [{ torch }] }); flashBtn.classList.toggle('on', torch); } catch { torch = false; toast('الفلاش غير متاح', 'err'); }
  } }, icon('bolt', 22));
  const flipBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'تبديل الكاميرا', onclick: () => { facing = facing === 'user' ? 'environment' : 'user'; start(); } }, icon('flip', 22));
  const galBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'المعرض', onclick: () => fileIn.click() }, icon('image', 24));
  const shutter = h('button', { class: 'cam-shutter', type: 'button', 'aria-label': 'التقاط' });
  const modeBtns = allowVideo ? ['photo', 'video'].map((m) => h('button', { type: 'button', class: 'cam-mode' + (m === 'photo' ? ' on' : ''), 'data-m': m, onclick: () => setMode(m) }, m === 'photo' ? 'صورة' : 'فيديو')) : [];
  let mode = 'photo';
  const modes = h('div', { class: 'cam-modes' }, ...modeBtns);
  const closeBtn = h('button', { class: 'cam-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => close() }, icon('close', 24));
  const live = h('div', { class: 'cam-live' },
    h('div', { class: 'cam-top' }, closeBtn, timer, flashBtn),
    h('div', { class: 'cam-bottom' }, filterBar, modes, h('div', { class: 'cam-ctrl' }, galBtn, shutter, flipBtn)));
  const previewMedia = h('div', { class: 'cam-pv-media' });
  const preview = h('div', { class: 'cam-preview', hidden: true },
    previewMedia,
    h('div', { class: 'cam-pv-bar' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => retake() }, icon('back', 18), ' إعادة'),
      h('button', { class: 'btn primary', type: 'button', 'data-act': 'send', onclick: () => doSend() }, icon('send', 18), ' ' + sendLabel)));
  const el = h('div', { class: 'cam-screen', role: 'dialog' }, canvas, video, msg, live, preview, fileIn);
  document.body.append(el);

  function setMode(m) { mode = m; modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === m)); shutter.classList.toggle('video', m === 'video'); }

  function draw() {
    raf = requestAnimationFrame(draw);
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return;
    if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
    const f = FILTERS[fi];
    ctx.save();
    if (facing === 'user') { ctx.translate(vw, 0); ctx.scale(-1, 1); }
    ctx.filter = f.css; ctx.drawImage(video, 0, 0, vw, vh); ctx.filter = 'none';
    ctx.restore();
    if (f.vig) { const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.max(vw, vh) * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${f.vig})`); ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh); }
  }

  async function start() {
    stopStream(); msg.hidden = false; msg.textContent = 'جارٍ تشغيل الكاميرا...';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: allowVideo });
    } catch (e) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (e2) { msg.textContent = e2?.name === 'NotAllowedError' ? 'لم تُمنح صلاحية الكاميرا. فعّلها من إعدادات التطبيق ثم أعد المحاولة، أو اختر من المعرض.' : 'تعذّر تشغيل الكاميرا على هذا الجهاز. يمكنك الاختيار من المعرض.'; return; }
    }
    if (closed) { stopStream(); return; }
    video.srcObject = stream; try { await video.play(); } catch {}
    msg.hidden = true;
    const tr = stream.getVideoTracks()[0]; const caps = tr?.getCapabilities ? tr.getCapabilities() : {};
    torch = false; flashBtn.classList.remove('on'); flashBtn.hidden = !caps.torch;
    const used = tr?.getSettings?.().facingMode; if (used) facing = used === 'user' ? 'user' : 'environment';
    cancelAnimationFrame(raf); draw();
  }
  function stopStream() { cancelAnimationFrame(raf); try { stream?.getTracks().forEach((t) => t.stop()); } catch {} stream = null; }

  function showResult(file) {
    result = file; if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = URL.createObjectURL(file);
    previewMedia.replaceChildren(file.type.startsWith('video') ? h('video', { src: resultUrl, controls: true, playsinline: true, autoplay: true, loop: true }) : h('img', { src: resultUrl, alt: '' }));
    live.hidden = true; preview.hidden = false;
  }
  function retake() { result = null; previewMedia.replaceChildren(); preview.hidden = true; live.hidden = false; if (!stream) start(); }
  async function doSend() { if (!result) return; const b = preview.querySelector('[data-act=send]'); b.disabled = true; try { await onSend?.(result); close(); } catch (e) { toast(e.message || 'تعذّر الإرسال', 'err'); b.disabled = false; } }

  function takePhoto() {
    if (!canvas.width) return toast('الكاميرا غير جاهزة بعد', 'err');
    canvas.toBlob((b) => { if (!b) return toast('تعذّر التقاط الصورة', 'err'); showResult(new File([b], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' })); }, 'image/jpeg', 0.88);
  }
  function startRec() {
    if (!window.MediaRecorder || !canvas.captureStream || !canvas.width) return toast('تسجيل الفيديو غير مدعوم على هذا الجهاز', 'err');
    const out = canvas.captureStream(30); stream?.getAudioTracks().forEach((t) => out.addTrack(t));
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    chunks = []; rec = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 64000 });
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => { clearInterval(recTimer); timer.hidden = true; shutter.classList.remove('rec'); const type = (rec.mimeType || 'video/webm').split(';')[0]; const blob = new Blob(chunks, { type }); rec = null; if (blob.size < 500) return toast('الفيديو قصير جداً', 'err'); showResult(new File([blob], `video_${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type })); };
    rec.start(500); recT0 = performance.now(); shutter.classList.add('rec'); timer.hidden = false; timer.textContent = '0:00';
    recTimer = setInterval(() => { const ms = performance.now() - recT0; timer.textContent = fmt(ms); if (ms >= MAX_VIDEO_MS) stopRec(); }, 250);
  }
  function stopRec() { try { rec && rec.state !== 'inactive' && rec.stop(); } catch {} }
  shutter.onclick = () => { if (mode === 'photo') takePhoto(); else rec ? stopRec() : startRec(); };

  fileIn.onchange = () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) { stopRec(); showResult(f); } };

  function close() { if (closed) return; closed = true; stopRec(); clearInterval(recTimer); stopStream(); if (resultUrl) URL.revokeObjectURL(resultUrl); el.remove();  }
  const onBack = (e) => { if (!el.isConnected) return; if (!preview.hidden) retake(); else close(); };
  el.addEventListener('m17:back', onBack);
  start();
  return close;
}
