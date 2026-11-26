// User-selectable NEXORA sounds. Audio files are stored locally on this device.
const PREFIX = 'nexora.sound.';
const MAX_BYTES = 1500 * 1024;
const TYPES = { message: 'نغمة الرسائل', call: 'نغمة المكالمات' };

function read(key) {
  try { return localStorage.getItem(PREFIX + key) || ''; } catch { return ''; }
}
export function hasCustomSound(key) { return !!read(key); }

export function setSoundFromFile(key, file) {
  return new Promise((resolve, reject) => {
    if (!TYPES[key]) return reject(new Error('نوع النغمة غير معروف'));
    if (!file || !/^audio\//i.test(file.type || '') && !/\.(mp3|m4a|aac|wav|ogg|opus|3gp)$/i.test(file.name || '')) {
      return reject(new Error('اختر ملفاً صوتياً صالحاً'));
    }
    if (file.size > MAX_BYTES) return reject(new Error('حجم الملف كبير. الحد الأقصى 1.5 ميغابايت'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذرت قراءة الملف'));
    reader.onload = () => {
      try {
        localStorage.setItem(PREFIX + key, String(reader.result));
        localStorage.setItem(PREFIX + key + '.name', file.name || TYPES[key]);
        resolve(file.name || TYPES[key]);
      } catch { reject(new Error('مساحة التخزين غير كافية لهذا الملف')); }
    };
    reader.readAsDataURL(file);
  });
}

export function soundName(key) {
  try { return localStorage.getItem(PREFIX + key + '.name') || (read(key) ? 'نغمة مخصصة' : 'النغمة الأصلية'); } catch { return 'النغمة الأصلية'; }
}
export function resetSound(key) {
  try { localStorage.removeItem(PREFIX + key); localStorage.removeItem(PREFIX + key + '.name'); } catch {}
}
function makeAudio(key) {
  const src = read(key);
  if (!src) return null;
  try { const a = new Audio(src); a.preload = 'auto'; return a; } catch { return null; }
}
export function previewSound(key) {
  const a = makeAudio(key);
  if (!a) return false;
  try { a.currentTime = 0; const p = a.play(); p?.catch?.(() => {}); return true; } catch { return false; }
}
export function playMessageSound() {
  const a = makeAudio('message');
  if (!a) return;
  try { a.volume = 0.8; a.play()?.catch?.(() => {}); } catch {}
}
export function startIncomingCallSound() {
  const a = makeAudio('call');
  if (!a) return null;
  let stopped = false;
  const play = () => { if (stopped) return; try { a.currentTime = 0; a.play()?.catch?.(() => {}); } catch {} };
  a.addEventListener('ended', play);
  play();
  return () => { stopped = true; a.removeEventListener('ended', play); try { a.pause(); a.currentTime = 0; } catch {} };
}
