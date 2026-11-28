import { createClient } from './lib/supabase-lite.js';
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config.js';
import { createRealtime } from './lib/realtime.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN);
export const state = { me: null, perms: [], flags: {}, unreadNotifs: 0, unreadChats: 0 };
export const hasPerm = (p) => state.perms.includes(p);
export const isStaff = () => ['OWNER', 'ADMIN', 'MODERATOR'].includes(state.me?.role);

export const PROFILE_MINI = 'id,username,display_name,avatar_url,role,is_private,is_verified';
export const POST_SELECT = `*,author:profiles!posts_author_id_fkey(${PROFILE_MINI}),likes(count),comments(count),shares(count)`;

export async function loadMe() {
  const id = sb.userId;
  if (!id) { state.me = null; return null; }
  const me = await sb.from('profiles').select('*').eq('id', id).one();
  if (!me) { await sb.auth.signOut(); return null; }
  if (me.is_disabled) { await sb.auth.signOut(); state.me = null; throw new Error('هذا الحساب معطّل من قبل الإدارة'); }
  state.me = me;
  const [perms, flags] = await Promise.all([sb.rpc('my_permissions'), sb.from('feature_flags').select('*')]);
  state.perms = perms || [];
  state.flags = Object.fromEntries((flags || []).map((f) => [f.key, f.enabled]));
  return me;
}
export const feature = (k) => state.flags[k] !== false;

// add like/comment/share counts and "liked by me" to posts
export async function enrichPosts(posts) {
  if (!posts.length) return posts;
  const ids = posts.map((p) => p.id);
  const [likes, shares] = await Promise.all([
    sb.from('likes').select('post_id').eq('user_id', state.me.id).in('post_id', ids),
    sb.from('shares').select('post_id').eq('user_id', state.me.id).in('post_id', ids),
  ]);
  const L = new Set(likes.map((x) => x.post_id)), S = new Set(shares.map((x) => x.post_id));
  for (const p of posts) {
    p.nLikes = p.likes?.[0]?.count ?? 0;
    p.nComments = p.comments?.[0]?.count ?? 0;
    p.nShares = p.shares?.[0]?.count ?? 0;
    p.liked = L.has(p.id);
    p.shared = S.has(p.id);
  }
  return posts;
}

// ---- uploads ----
export const MAX_IMG = 15 * 1024 * 1024, MAX_VID = 50 * 1024 * 1024;
async function compressImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}
export async function uploadMedia(bucket, file, opts = {}) {
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) throw new Error('نوع الملف غير مدعوم');
  if (isVideo && !feature('video_upload')) throw new Error('رفع الفيديو متوقف حالياً');
  if (isVideo && file.size > MAX_VID) throw new Error('حجم الفيديو أكبر من 50 ميغابايت');
  if (isImage && file.size > MAX_IMG * 2) throw new Error('حجم الصورة كبير جداً');
  const body = isImage ? await compressImage(file) : file;
  const ext = body.type === 'image/jpeg' ? 'jpg' : (body.type.split('/')[1] || 'bin').replace('quicktime', 'mov');
  const path = `${state.me.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const url = await sb.storage.upload(bucket, path, body, opts);
  return { url, type: isVideo ? 'video' : 'image' };
}

export async function uploadAudio(bucket, file, ext = 'webm', max = 10 * 1024 * 1024) {
  if (!file || file.size === 0) throw new Error('الملف الصوتي فارغ');
  if (file.size > max) throw new Error('حجم الملف الصوتي كبير (الحد 10 ميغابايت)');
  const path = `${state.me.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  return sb.storage.upload(bucket, path, file);
}

export async function followingIds() {
  const rows = await sb.from('follows').select('following_id').eq('follower_id', state.me.id);
  return rows.map((r) => r.following_id);
}
export async function refreshBadges() {
  if (!state.me) return;
  try {
    const [n, convs] = await Promise.all([
      sb.from('notifications').select('id').eq('user_id', state.me.id).eq('is_read', false).count(),
      sb.rpc('my_conversations'),
    ]);
    state.unreadNotifs = n;
    state.unreadChats = (convs || []).reduce((a, c) => a + Number(c.unread_count || 0), 0);
    document.dispatchEvent(new CustomEvent('m17:badges'));
  } catch { /* offline - keep old badges */ }
}

// ---- realtime (instant messages / notifications / typing) with REST polling as fallback ----
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export let rt = null;
let inbox = null;
async function acknowledgeDelivered(message) {
  if (!state.me || !message?.id || message.receiver_id !== state.me.id || message.delivered_at) return;
  try {
    await sb.from('messages').update({ delivered_at: new Date().toISOString() })
      .eq('id', message.id).is('delivered_at', 'null');
  } catch { /* retry when the message is loaded again */ }
}
async function flushPendingDeliveries() {
  if (!state.me) return;
  try {
    const rows = await sb.from('messages').select('id')
      .eq('receiver_id', state.me.id).is('delivered_at', 'null')
      .limit(100);
    if (rows.length) await sb.from('messages').update({ delivered_at: new Date().toISOString() })
      .in('id', rows.map((m) => m.id)).is('delivered_at', 'null');
  } catch { /* retry on the next connection */ }
}
export function startRealtime() {
  if (rt || !state.me) return;
  const me = state.me.id;
  rt = createRealtime({ url: SUPABASE_URL, key: SUPABASE_KEY, getToken: () => sb.session?.access_token });
  inbox = rt.channel('inbox-' + me, { pg: [
    { event: 'INSERT', table: 'messages', filter: `receiver_id=eq.${me}` },
    { event: 'UPDATE', table: 'messages', filter: `sender_id=eq.${me}` },
    { event: 'UPDATE', table: 'messages', filter: `receiver_id=eq.${me}` },
    { event: 'INSERT', table: 'notifications', filter: `user_id=eq.${me}` },
    { event: 'INSERT', table: 'calls', filter: `callee_id=eq.${me}` },
    { event: 'UPDATE', table: 'calls', filter: `caller_id=eq.${me}` },
    { event: 'UPDATE', table: 'calls', filter: `callee_id=eq.${me}` },
    { event: 'INSERT', table: 'call_signals', filter: `to_id=eq.${me}` },
    { event: 'INSERT', table: 'live_signals', filter: `to_id=eq.${me}` },
    { event: 'INSERT', table: 'lives' }, { event: 'UPDATE', table: 'lives' },
  ] })
    .onPg('INSERT', 'messages', (d) => { emit('rt:message', d.record); acknowledgeDelivered(d.record); })
    .onPg('UPDATE', 'messages', (d) => emit('rt:message-update', d.record))
    .onPg('INSERT', 'notifications', (d) => emit('rt:notification', d.record))
    .onPg('INSERT', 'calls', (d) => emit('rt:call', d.record))
    .onPg('UPDATE', 'calls', (d) => emit('rt:call-update', d.record))
    .onPg('INSERT', 'call_signals', (d) => emit('rt:signal', d.record))
    .onPg('INSERT', 'live_signals', (d) => emit('rt:live-signal', d.record))
    .onPg('INSERT', 'lives', (d) => emit('rt:live', d.record)).onPg('UPDATE', 'lives', (d) => emit('rt:live', d.record))
    .onReady(() => { emit('rt:ready'); flushPendingDeliveries(); }).subscribe();
  rt.onStatus((s) => emit('rt:status', s));
  rt.connect();
}
export function stopRealtime() { try { rt?.disconnect(); } catch {} rt = null; inbox = null; }
export const rtLive = () => !!(rt && rt.status === 'connected' && inbox?.ready);
export const pairName = (a, b) => 'chat-' + [a, b].sort().join('_');
// presence: one heartbeat row per DEVICE (so several phones of one user stay in sync); closing/hiding the app marks this device offline at once
export const DEVICE = (() => { try { let d = localStorage.getItem('m17.device'); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem('m17.device', d); } return d; } catch { return 'web'; } })();
export const touchPresence = () => (state.me && state.me.show_presence !== false ? sb.rpc('touch_presence', { p_device: DEVICE }).catch(() => {}) : Promise.resolve());
export function goOffline() {
  const tok = sb.session?.access_token; if (!tok) return;
  try { fetch(SUPABASE_URL + '/rest/v1/rpc/go_offline', { method: 'POST', keepalive: true, headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ p_device: DEVICE }) }).catch(() => {}); } catch {}
}
// fire-and-forget RPC that survives the page being closed (used to end a live broadcast on exit)
export function beaconRpc(name, args) {
  const tok = sb.session?.access_token; if (!tok) return;
  try { fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, { method: 'POST', keepalive: true, headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(args || {}) }).catch(() => {}); } catch {}
}
export async function presenceOf(id) { try { return (await sb.rpc('get_presence', { ids: [id] }))?.[0] || null; } catch { return null; } }
export async function presenceMany(ids) { try { return new Map(((await sb.rpc('get_presence', { ids })) || []).map((p) => [p.user_id, p])); } catch { return new Map(); } }
// live presence changes (Realtime postgres_changes on `presence`; RLS hides users who turned the setting off / blocked)
export function watchPresence(ids, fn) {
  if (!rt || !ids.length) return () => {};
  const list = ids.slice(0, 100);
  const ch = rt.channel('pres-' + Math.random().toString(36).slice(2, 8), { pg: [{ event: 'INSERT', table: 'presence', filter: list.length === 1 ? `user_id=eq.${list[0]}` : `user_id=in.(${list.join(',')})` }, { event: 'UPDATE', table: 'presence', filter: list.length === 1 ? `user_id=eq.${list[0]}` : `user_id=in.(${list.join(',')})` }] })
    .onPg('INSERT', 'presence', (d) => fn(d.record)).onPg('UPDATE', 'presence', (d) => fn(d.record)).subscribe();
  return () => { try { ch.unsubscribe(); } catch {} };
}
