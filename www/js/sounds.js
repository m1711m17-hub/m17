// NEXORA sound preferences. Custom audio stays on this device; presets are synthesized tones.
const PREFIX = 'nexora.sound.';
const MAX_BYTES = 1500 * 1024;
const TYPES = { message: 'نغمة الرسائل', call: 'نغمة المكالمات' };
export const SOUND_PRESETS = [
  { id: 'soft', name: 'نسمة', notes: [784, 988], durations: [0.12, 0.18] },
  { id: 'crystal', name: 'كريستال', notes: [1047, 1319, 1568], durations: [0.10, 0.10, 0.22] },
  { id: 'pulse', name: 'نبض', notes: [659, 659, 880], durations: [0.10, 0.10, 0.20] },
  { id: 'classic', name: 'كلاسيك', notes: [880, 698, 880], durations: [0.18, 0.18, 0.25] },
  { id: 'calm', name: 'هدوء', notes: [523, 659, 784], durations: [0.16, 0.16, 0.30] }
];
function read(key) { try { return localStorage.getItem(PREFIX + key) || ''; } catch { return ''; } }
function selected(key) { try { return localStorage.getItem(PREFIX + key + '.preset') || ''; } catch { return ''; } }
export function selectedSoundPreset(key) { return selected(key); }
export function hasCustomSound(key) { return !!read(key); }
export function setSoundPreset(key, id) {
  if (!TYPES[key] || !SOUND_PRESETS.some((p) => p.id === id)) throw new Error('النغمة المحددة غير متاحة');
  try { localStorage.removeItem(PREFIX + key); localStorage.removeItem(PREFIX + key + '.name'); localStorage.setItem(PREFIX + key + '.preset', id); }
  catch { throw new Error('تعذر حفظ اختيار النغمة على هذا الجهاز'); }
}
export function setSoundFromFile(key, file) {
  return new Promise((resolve, reject) => {
    if (!TYPES[key]) return reject(new Error('نوع النغمة غير معروف'));
    if (!file || (!/^audio\\//i.test(file.type || '') && !/\\.(mp3|m4a|aac|wav|ogg|opus|3gp)$/i.test(file.name || ''))) return reject(new Error('اختر ملفاً صوتياً صالحاً'));
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
  try { const name = localStorage.getItem(PREFIX + key + '.name'); if (name) return name; const p = SOUND_PRESETS.find((x) => x.id === selected(key)); return p ? p.name : (read(key) ? 'نغمة مخصصة' : 'النغمة الأصلية'); }
  catch { return 'النغمة الأصلية'; }
}
export function resetSound(key) {
  try { localStorage.removeItem(PREFIX + key); localStorage.removeItem(PREFIX + key + '.name'); localStorage.removeItem(PREFIX + key + '.preset'); } catch {}
}
function makeAudio(key) { const src = read(key); if (!src) return null; try { const a = new Audio(src); a.preload = 'auto'; return a; } catch { return null; } }
function runPreset(key, loop) {
  const preset = SOUND_PRESETS.find((p) => p.id === selected(key)); if (!preset) return null;
  let ac; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  let stopped = false, timer = null;
  const play = () => {
    if (stopped) return;
    let at = ac.currentTime + 0.03;
    preset.notes.forEach((freq, i) => {
      const osc = ac.createOscillator(), gain = ac.createGain(), dur = preset.durations[i] || 0.16;
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, at); gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(key === 'call' ? 0.16 : 0.11, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain); gain.connect(ac.destination); osc.start(at); osc.stop(at + dur + 0.02); at += dur + 0.055;
    });
    if (loop) timer = setTimeout(play, Math.max(1100, (at - ac.currentTime) * 1000 + 500));
    else timer = setTimeout(() => { try { ac.close(); } catch {} }, Math.max(500, (at - ac.currentTime) * 1000 + 100));
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
