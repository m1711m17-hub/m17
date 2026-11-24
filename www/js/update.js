import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

const UpdateInstaller = registerPlugin('UpdateInstaller');
const MANIFEST_URL = 'https://raw.githubusercontent.com/m1711m17-hub/m17/main/www/update.json';
let checked = false;

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
      await UpdateInstaller.openDownload({ url: info.downloadUrl });
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

export async function checkForUpdates() {
  if (checked) return;
  checked = true;
  try {
    const app = await App.getInfo();
    const response = await fetch(MANIFEST_URL + '?t=' + Date.now(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return;
    const remote = await response.json();
    if (!remote || !remote.version || !/^https:\/\//i.test(remote.downloadUrl || '')) return;
    if (newerVersion(remote.version, app.version)) {
      showUpdate(remote);
    }
  } catch (error) {
    console.info('[NEXORA update] check skipped:', error?.message || error);
  }
}
