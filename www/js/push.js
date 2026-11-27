// Push notifications (FCM via @capacitor/push-notifications). Only active inside the Android app.
import { sb, state, refreshBadges } from './api.js';

const P = () => window.Capacitor?.Plugins?.PushNotifications;
export const pushSupported = () => !!(window.Capacitor?.isNativePlatform?.() && P());
const KEY = 'm17.pushtoken';
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} } };
export const pushStatus = { perm: 'unknown', error: '', token: false };
let wired = false;

async function openFromPush(data) {
  try {
    const t = data?.type;
    if (t === 'message' || t === 'story_reply') {
      if (data.actor_id) { const p = await sb.from('profiles').select('username').eq('id', data.actor_id).one(); if (p?.username) { location.hash = '#/chat/' + p.username; return; } }
      location.hash = '#/messages';
    } else if (t === 'call' || t === 'call_missed') location.hash = '#/messages';
    else if (data?.post_id) location.hash = '#/post/' + data.post_id;
    else location.hash = '#/notifications';
  } catch { location.hash = '#/notifications'; }
}

async function saveToken(tok) {
  store.set(tok); pushStatus.token = true;
  try { await sb.rpc('register_device_token', { tok, plat: 'android' }); pushStatus.error = ''; }
  catch (e) { pushStatus.error = 'تعذر حفظ رمز الجهاز: ' + e.message; }
}

export async function initPush() {
  if (!pushSupported() || !state.me) return pushStatus;
  const pn = P();
  try {
    if (!wired) {
      wired = true;
      await pn.addListener('registration', (t) => saveToken(t.value));
      await pn.addListener('registrationError', (e) => { pushStatus.error = 'فشل التسجيل في Firebase: ' + (e?.error || JSON.stringify(e)); });
      // Foreground pushes only refresh unread counts; keep the open app silent.
      await pn.addListener('pushNotificationReceived', () => { refreshBadges(); });
      await pn.addListener('pushNotificationActionPerformed', (a) => openFromPush(a?.notification?.data));
      try {
        await pn.createChannel({ id: 'm17_default', name: 'الإشعارات', description: 'الرسائل والمتابعات والإعجابات والتعليقات', importance: 4, visibility: 1, vibration: true });
        await pn.createChannel({ id: 'm17_calls', name: 'المكالمات', description: 'المكالمات الواردة', importance: 5, visibility: 1, vibration: true });
      } catch {}
    }
    let perm = await pn.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await pn.requestPermissions();
    pushStatus.perm = perm.receive;
    if (perm.receive !== 'granted') return pushStatus;
    await pn.register();
  } catch (e) { pushStatus.error = e.message || String(e); }
  return pushStatus;
}

export async function dropPushToken() {
  const t = store.get(); store.set(null);
  if (t) { try { await sb.from('device_tokens').delete().eq('token', t); } catch {} }
}
