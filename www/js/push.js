// Push notifications (FCM via @capacitor/push-notifications). Only active inside the Android app.
import { sb, state, refreshBadges } from './api.js';
import { selectedSoundPreset, hasCustomSound, customSoundData } from './sounds.js';

const P = () => window.Capacitor?.Plugins?.PushNotifications;
export const pushSupported = () => !!(window.Capacitor?.isNativePlatform?.() && P());
const KEY = 'm17.pushtoken';
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} } };
export const pushStatus = { perm: 'unknown', error: '', token: false };
let wired = false;
const SOUND_CHANNEL_KEY = 'm17.sound.channel.';
const getChannel = (kind) => { try { return localStorage.getItem(SOUND_CHANNEL_KEY + kind) || (kind === 'call' ? 'm17_calls' : 'm17_default'); } catch { return kind === 'call' ? 'm17_calls' : 'm17_default'; } };

export async function applyNotificationSound(kind) {
  if (kind !== 'message' && kind !== 'call') throw new Error('نوع النغمة غير معروف');
  const plugin = window.Capacitor?.Plugins?.NotificationSound;
  if (!plugin) throw new Error('حدّث تطبيق M17 لتفعيل نغمة الإشعارات');
  let channelId = kind === 'call' ? 'm17_calls' : 'm17_default';
  if (hasCustomSound(kind)) {
    const custom = customSoundData(kind);
    const result = await plugin.setCustomSound({ kind, base64: custom.dataUrl, mimeType: custom.mimeType, fileName: custom.fileName });
    channelId = result.channelId;
  } else {
    const preset = selectedSoundPreset(kind);
    if (preset) {
      const result = await plugin.setPresetSound({ kind, preset });
      channelId = result.channelId;
    }
  }
  try { localStorage.setItem(SOUND_CHANNEL_KEY + kind, channelId); } catch {}
  await syncNotificationChannels();
  return channelId;
}

async function syncNotificationChannels() {
  const token = store.get();
  if (!token || !sb.session?.access_token) return;
  await sb.rpc('set_device_notification_channels', {
    p_token: token,
    p_message_channel: getChannel('message'),
    p_call_channel: getChannel('call'),
  });
}

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
  try { await sb.rpc('register_device_token', { tok, plat: 'android' }); await syncNotificationChannels(); pushStatus.error = ''; }
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
    // Recreate the selected Android channels before registering for remote pushes.
    for (const kind of ['message', 'call']) {
      try {
        if (hasCustomSound(kind) || selectedSoundPreset(kind)) await applyNotificationSound(kind);
      } catch (e) { pushStatus.error = e.message || String(e); }
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
