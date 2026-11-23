// Voice messages: recorder (MediaRecorder + level analyser) and the playback bubble.
import { h, icon } from './dom.js';

const WAVE_BARS = 40;
export function encodeWave(levels) {
  if (!levels.length) return '0'.repeat(WAVE_BARS);
  const out = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    const a = Math.floor((i * levels.length) / WAVE_BARS), b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / WAVE_BARS));
    let mx = 0; for (let k = a; k < b && k < levels.length; k++) mx = Math.max(mx, levels[k]);
    out.push(mx);
  }
  const peak = Math.max(0.05, ...out);
  return out.map((v) => Math.min(35, Math.round((v / peak) * 35)).toString(36)).join('');
}
export const decodeWave = (s) => (s && s.length >= 10 ? [...s].map((c) => Math.max(0.08, parseInt(c, 36) / 35)) : Array.from({ length: WAVE_BARS }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(i * 1.7))));
export const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const recorderSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export function createRecorder() {
  let stream = null, mr = null, chunks = [], actx = null, an = null, timer = null, levels = [], t0 = 0, acc = 0, running = false, onLevel = () => {};
  const mimes = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  const now = () => performance.now();
  function cleanup() {
    clearInterval(timer); timer = null;
    try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { actx?.close(); } catch {}
    stream = null; actx = null; an = null;
  }
  return {
    set onLevel(f) { onLevel = f; },
    get elapsed() { return acc + (running ? now() - t0 : 0); },
    get paused() { return !running; },
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = mimes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 }); // ~3KB/s: small files, fine for voice
      chunks = []; levels = []; acc = 0;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)(); const src = actx.createMediaStreamSource(stream); an = actx.createAnalyser(); an.fftSize = 256; src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        timer = setInterval(() => { if (!running) return; an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; } const lv = Math.min(1, Math.sqrt(s / buf.length) * 3.2); levels.push(lv); onLevel(lv); }, 90);
      } catch { /* analyser optional */ }
      mr.start(250); t0 = now(); running = true;
    },
    pause() { if (!running || !mr || mr.state !== 'recording') return; mr.pause(); acc += now() - t0; running = false; },
    resume() { if (running || !mr || mr.state !== 'paused') return; mr.resume(); t0 = now(); running = true; },
    stop() {
      return new Promise((resolve) => {
        if (!mr) return resolve(null);
        if (running) { acc += now() - t0; running = false; }
        const type = (mr.mimeType || 'audio/webm').split(';')[0];
        mr.onstop = () => { const blob = new Blob(chunks, { type: mr.mimeType || type }); cleanup(); resolve({ blob, ms: Math.round(acc), wave: encodeWave(levels), type }); };
        try { mr.state !== 'inactive' ? mr.stop() : mr.onstop(); } catch { cleanup(); resolve(null); }
      });
    },
    cancel() { try { if (mr && mr.state !== 'inactive') { mr.onstop = null; mr.stop(); } } catch {} running = false; cleanup(); },
  };
}

// ---- playback bubble: play/pause, waveform with progress, duration; only one voice plays at a time ----
let current = null;
export function voiceBubble(m, { mine = false } = {}) {
  const wave = decodeWave(m.audio_wave);
  const total = Math.max(1000, m.audio_ms || 1000);
  const bars = wave.map((v) => h('i', { style: { height: Math.round(6 + v * 26) + 'px' } }));
  const time = h('span', { class: 'vm-time' }, fmtDur(total));
  const btn = h('button', { class: 'vm-play', type: 'button', 'aria-label': 'تشغيل' }, icon('play', 20));
  const wv = h('div', { class: 'vm-wave' }, bars);
  const el = h('div', { class: 'voice-msg' + (mine ? ' mine' : '') }, btn, wv, time);
  let audio = null, playing = false;
  const paint = (ratio) => { const n = Math.round(ratio * bars.length); bars.forEach((b, i) => b.classList.toggle('on', i < n)); };
  const setIcon = (p) => { btn.replaceChildren(icon(p ? 'pause' : 'play', 20)); btn.setAttribute('aria-label', p ? 'إيقاف' : 'تشغيل'); };
  function stop() { if (audio) audio.pause(); playing = false; setIcon(false); }
  async function toggle() {
    if (playing) { stop(); return; }
    if (current && current !== stop) current();
    if (!audio) {
      audio = new Audio(m.audio_url); audio.preload = 'auto';
      audio.ontimeupdate = () => { const t = audio.currentTime * 1000; paint(Math.min(1, t / total)); time.textContent = fmtDur(playing ? Math.max(0, total - t) : total); };
      audio.onended = () => { playing = false; setIcon(false); paint(0); time.textContent = fmtDur(total); if (current === stop) current = null; };
      audio.onerror = () => { playing = false; setIcon(false); time.textContent = '⚠️'; };
    }
    try { await audio.play(); playing = true; current = stop; setIcon(true); } catch { time.textContent = '⚠️'; }
  }
  btn.onclick = toggle;
  wv.addEventListener('click', (e) => {
    const r = wv.getBoundingClientRect(); let ratio = (e.clientX - r.left) / r.width; if (getComputedStyle(el).direction === 'rtl') ratio = 1 - ratio;
    ratio = Math.min(1, Math.max(0, ratio)); paint(ratio);
    if (audio) { try { audio.currentTime = (ratio * total) / 1000; } catch {} }
  });
  return el;
}
