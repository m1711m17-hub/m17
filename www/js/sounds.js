// NEXORA sound preferences. Custom audio stays on this device; presets are synthesized tones.
const PREFIX = 'nexora.sound.';
const MAX_BYTES = 1500 * 1024;
const TYPES = { message: 'نغمة الرسائل', call: 'نغمة المكالمات' };
const MESSAGE_SOUND_PRESETS = [
  { id: 'soft', name: 'نسمة', notes: [659, 784, 988, 784, 659, 784, 988, 1175], durations: [0.38, 0.38, 0.52, 0.38, 0.38, 0.38, 0.52, 0.72] },
  { id: 'crystal', name: 'كريستال', notes: [784, 988, 1175, 1319, 1175, 988, 1175, 1568], durations: [0.32, 0.32, 0.42, 0.62, 0.32, 0.32, 0.42, 0.82] },
  { id: 'pulse', name: 'نبض', notes: [523, 659, 784, 659, 523, 659, 880, 784], durations: [0.42, 0.42, 0.58, 0.42, 0.42, 0.42, 0.58, 0.72] },
  { id: 'classic', name: 'كلاسيك', notes: [880, 784, 698, 784, 880, 988, 880, 784], durations: [0.48, 0.38, 0.38, 0.48, 0.48, 0.58, 0.48, 0.82] },
  { id: 'calm', name: 'هدوء', notes: [523, 587, 659, 784, 659, 587, 523, 659], durations: [0.48, 0.42, 0.48, 0.72, 0.48, 0.42, 0.58, 0.82] }
];
const CALL_SOUND_PRESETS = [
  { id: 'moonlight', name: 'ضوء القمر', waveform: 'triangle', notes: [523, 659, 784, 1047, 988, 784, 659, 587, 659, 784], durations: [0.42, 0.42, 0.55, 0.72, 0.42, 0.42, 0.55, 0.42, 0.55, 0.85] },
  { id: 'cinema', name: 'سينمائي', waveform: 'sine', notes: [392, 523, 659, 784, 698, 659, 523, 587, 784, 880], durations: [0.55, 0.45, 0.55, 0.8, 0.55, 0.45, 0.65, 0.5, 0.65, 1.0] },
  { id: 'piano', name: 'بيانو ناعم', waveform: 'triangle', notes: [659, 784, 880, 784, 659, 587, 659, 784, 988, 880], durations: [0.3, 0.35, 0.55, 0.35, 0.45, 0.4, 0.35, 0.5, 0.65, 0.9] },
  { id: 'arabesque', name: 'شرقي', waveform: 'sine', notes: [440, 494, 587, 659, 587, 523, 494, 440, 523, 587], durations: [0.42, 0.32, 0.52, 0.65, 0.38, 0.42, 0.32, 0.58, 0.42, 0.9] },
  { id: 'sunrise', name: 'شروق', waveform: 'triangle', notes: [587, 659, 784, 880, 1047, 880, 784, 659, 784, 988], durations: [0.4, 0.4, 0.48, 0.55, 0.8, 0.45, 0.45, 0.55, 0.5, 0.95] }
];
export const SOUND_PRESETS = MESSAGE_SOUND_PRESETS;
export function getSoundPresets(key) { return key === 'call' ? CALL_SOUND_PRESETS : MESSAGE_SOUND_PRESETS; }
function read(key) { try { return localStorage.getItem(PREFIX + key) || ''; } catch { return ''; } }
function selected(key) { try { return localStorage.getItem(PREFIX + key + '.preset') || ''; } catch { return ''; } }
export function selectedSoundPreset(key) { return selected(key); }
export function hasCustomSound(key) { return !!read(key); }
export function setSoundPreset(key, id) {
  if (!TYPES[key] || !getSoundPresets(key).some((p) => p.id === id)) throw new Error('النغمة المحددة غير متاحة');
  try { localStorage.removeItem(PREFIX + key); localStorage.removeItem(PREFIX + key + '.name'); localStorage.setItem(PREFIX + key + '.preset', id); }
  catch { throw new Error('تعذر حفظ اختيار النغمة على هذا الجهاز'); }
}
export function setSoundFromFile(key, file) {
  return new Promise((resolve, reject) => {
    if (!TYPES[key]) return reject(new Error('نوع النغمة غير معروف'));
    if (!file || (!/^audio\//i.test(file.type || '') && !/\.(mp3|m4a|aac|wav|ogg|opus|3gp)$/i.test(file.name || ''))) return reject(new Error('اختر ملفاً صوتياً صالحاً'));
    if (file.size > MAX_BYTES) return reject(new Error('حجم الملف كبير. الحد الأقصى 1.5 ميغابايت'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذرت قراءة الملف'));
    reader.onload = () => {
      try { localStorage.setItem(PREFIX + key, String(reader.result)); localStorage.setItem(PREFIX + key + '.name', file.name || TYPES[key]); localStorage.removeItem(PREFIX + key + '.preset'); resolve(file.name || TYPES[key]); }
      catch { reject(new Error('مساحة التخزين غير كافية لهذا الملف')); }
    };
    reader.readAsDataURL(file);
  });
}
export function soundName(key) {
  try { const name = localStorage.getItem(PREFIX + key + '.name'); if (name) return name; const p = getSoundPresets(key).find((x) => x.id === selected(key)); return p ? p.name : (read(key) ? 'نغمة مخصصة' : 'النغمة الأصلية'); }
  catch { return 'النغمة الأصلية'; }
}
export function resetSound(key) {
  try { localStorage.removeItem(PREFIX + key); localStorage.removeItem(PREFIX + key + '.name'); localStorage.removeItem(PREFIX + key + '.preset'); } catch {}
}
function makeAudio(key) { const src = read(key); if (!src) return null; try { const a = new Audio(src); a.preload = 'auto'; return a; } catch { return null; } }
function runPreset(key, loop) {
  const preset = getSoundPresets(key).find((p) => p.id === selected(key)); if (!preset) return null;
  let ac; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  let stopped = false, timer = null;
  const play = () => {
    if (stopped) return;
    let at = ac.currentTime + 0.04;
    preset.notes.forEach((freq, i) => {
      const dur = preset.durations[i] || 0.4;
      const melody = ac.createOscillator(), envelope = ac.createGain();
      melody.type = preset.waveform || 'triangle';
      melody.frequency.setValueAtTime(freq, at);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(key === 'call' ? 0.13 : 0.095, at + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      melody.connect(envelope); envelope.connect(ac.destination);
      melody.start(at); melody.stop(at + dur + 0.03);
      const harmony = ac.createOscillator(), harmonyGain = ac.createGain();
      harmony.type = 'sine'; harmony.frequency.setValueAtTime(freq * 1.5, at);
      harmonyGain.gain.setValueAtTime(0.0001, at);
      harmonyGain.gain.exponentialRampToValueAtTime(0.022, at + 0.035);
      harmonyGain.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.88);
      harmony.connect(harmonyGain); harmonyGain.connect(ac.destination);
      harmony.start(at); harmony.stop(at + dur + 0.03);
      at += dur + 0.075;
    });
    if (loop) timer = setTimeout(play, Math.max(300, (at - ac.currentTime) * 1000 + 300));
    else timer = setTimeout(() => { try { ac.close(); } catch {} }, Math.max(600, (at - ac.currentTime) * 1000 + 120));
  };
  try { ac.resume?.(); play(); } catch { try { ac.close(); } catch {} return null; }
  return () => { stopped = true; clearTimeout(timer); try { ac.close(); } catch {} };
}
export function previewSound(key) {
  const a = makeAudio(key);
  if (a) { try { a.currentTime = 0; a.play()?.catch?.(() => {}); return true; } catch { return false; } }
  return !!runPreset(key, false);
}
export function playMessageSound() {
  const a = makeAudio('message'); if (a) { try { a.volume = 0.8; a.play()?.catch?.(() => {}); } catch {} return; }
  runPreset('message', false);
}
export function startIncomingCallSound() {
  const a = makeAudio('call');
  if (a) { let stopped = false; const play = () => { if (!stopped) { try { a.currentTime = 0; a.play()?.catch?.(() => {}); } catch {} } }; a.addEventListener('ended', play); play(); return () => { stopped = true; a.removeEventListener('ended', play); try { a.pause(); a.currentTime = 0; } catch {} }; }
  return runPreset('call', true);
}

export function customSoundData(key) {
  const data = read(key);
  if (!data) return null;
  let name = TYPES[key] || 'NEXORA';
  try { name = localStorage.getItem(PREFIX + key + '.name') || name; } catch {}
  const match = /^data:([^;,]+)[^,]*;base64,/i.exec(data);
  return { dataUrl: data, mimeType: match?.[1] || 'audio/mpeg', fileName: name };
}
