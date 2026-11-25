const cap = window.Capacitor;
const UpdateInstaller = cap?.registerPlugin ? cap.registerPlugin('UpdateInstaller') : { openDownload: async () => { throw new Error('native only'); } };
const App = cap?.Plugins?.App || { getInfo: async () => ({ version: '0' }) };
import { sb } from './api.js';
const MANIFEST_URL = 'https://raw.githubusercontent.com/m1711m17-hub/m17/update-info/update.json';
const CHECK_EVERY = 20 * 60 * 1000;
let lastCheck = 0;
export const updateState = { info: null, current: null };
export function openExternal(url) {
  if (!/^https:\/\//i.test(url || '')) return Promise.reject(new Error('bad url'));
  return UpdateInstaller.openDownload({ url }).catch(() => { window.open(url, '_blank'); });
}
let waCache;
export async function getWhatsappUrl() {
  if (waCache !== undefined) return waCache;
  try { const r = await sb.from('app_settings').select('value').eq('key', 'whatsapp_group_url').one(); const v = r && r.value; waCache = typeof v === 'string' && /^https:\/\//i.test(v) ? v : ''; } catch { waCache = ''; }
  return waCache;
}
export function resetWhatsappCache() { waCache = undefined; }

function newerVersion(remote, local) {
  const a = String(remote || '').split('.').map(v => Number.parseInt(v, 10) || 0);
  const b = String(local || '').split('.').map(v => Number.parseInt(v, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function showUpdate(info) {
  if (document.getElementById('nexora-update-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'nexora-update-overlay';
  overlay.dir = 'rtl';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000b;display:grid;place-items:center;padding:22px;font-family:system-ui,sans-serif';
  const card = document.createElement('section');
  card.style.cssText = 'width:min(100%,380px);background:#101a30;color:#fff;border:1px solid #29436d;border-radius:22px;padding:24px;box-shadow:0 18px 60px #0008;text-align:center';
  const title = document.createElement('h2');
  title.textContent = 'تحديث جديد من NEXORA';
  title.style.cssText = 'margin:0 0 10px;font-size:22px';
  const detail = document.createElement('p');
  detail.textContent = 'الإصدار ' + info.version + ' أصبح متاحاً.';
  detail.style.cssText = 'color:#c8d5eb;line-height:1.7;margin:0 0 12px';
  const notes = document.createElement('p');
  notes.textContent = info.notes || 'يتضمن التحديث تحسينات وإصلاحات.';
  notes.style.cssText = 'color:#aebed8;font-size:14px;line-height:1.7;white-space:pre-wrap;margin:0 0 20px';
  const update = document.createElement('button');
  update.type = 'button';
  update.textContent = 'تنزيل التحديث';
  update.style.cssText = 'width:100%;border:0;border-radius:14px;padding:14px;background:#2878ff;color:white;font-weight:700;font-size:16px';
  update.onclick = async () => {
    update.disabled = true;
    update.textContent = 'جارٍ فتح رابط التنزيل…';
    try {
      await openExternal(info.downloadUrl);
    } catch (e) {
      update.disabled = false;
      update.textContent = 'تعذّر فتح التنزيل - حاول مجدداً';
    }
  };
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'لاحقاً';
  later.style.cssText = 'margin-top:12px;width:100%;border:1px solid #425777;border-radius:14px;padding:12px;background:transparent;color:#dce7f8;font-size:15px';
  later.onclick = () => overlay.remove();
  card.append(title, detail, notes, update, later);
  overlay.append(card);
  document.body.append(overlay);
}

export async function checkForUpdates({ force = false } = {}) {
  if (!force && Date.now() - lastCheck < CHECK_EVERY) return updateState.info;
  lastCheck = Date.now();
  try {
    const app = await App.getInfo();
    updateState.current = app.version;
    const response = await fetch(MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return updateState.info;
    const remote = await response.json();
    if (!remote || !remote.version || !/^https:\/\//i.test(remote.downloadUrl || '')) return updateState.info;
    if (newerVersion(remote.version, app.version)) {
      updateState.info = remote;
      window.dispatchEvent(new CustomEvent('nexora:update', { detail: remote }));
      let seen = ''; try { seen = localStorage.getItem('nexora.upd.seen') || ''; } catch {}
      if (seen !== remote.version) { try { localStorage.setItem('nexora.upd.seen', remote.version); } catch {} showUpdate(remote); }
    } else updateState.info = null;
  } catch (error) {
    console.info('[NEXORA update] check skipped:', error?.message || error);
  }
  return updateState.info;
}

// Card used by the notifications page and settings: update available + download button.
export function updateCard(h) {
  const info = updateState.info; if (!info) return null;
  return h('div', { class: 'upd-card' },
    h('b', null, '🚀 تحديث جديد متاح: ' + info.version),
    h('div', { class: 'muted' }, info.notes || 'يتضمن التحديث تحسينات وإصلاحات.'),
    h('button', { class: 'btn primary block', onclick: (e) => { e.target.disabled = true; openExternal(info.downloadUrl).finally(() => { e.target.disabled = false; }); } }, 'تنزيل وتثبيت التحديث'),
    h('div', { class: 'muted sm' }, 'بعد انتهاء التنزيل افتح الملف واضغط "تثبيت". إن طلب الهاتف السماح بالتثبيت من هذا المصدر فوافق.'));
}
