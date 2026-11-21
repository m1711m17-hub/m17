import { createClient } from './lib/supabase-lite.js';
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN);
export const state = { me: null, perms: [], flags: {}, unreadNotifs: 0, unreadChats: 0 };
export const hasPerm = (p) => state.perms.includes(p);
export const isStaff = () => ['OWNER', 'ADMIN', 'MODERATOR'].includes(state.me?.role);

export const PROFILE_MINI = 'id,username,display_name,avatar_url,role,is_private';
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
export async function uploadMedia(bucket, file) {
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) throw new Error('نوع الملف غير مدعوم');
  if (isVideo && !feature('video_upload')) throw new Error('رفع الفيديو متوقف حالياً');
  if (isVideo && file.size > MAX_VID) throw new Error('حجم الفيديو أكبر من 50 ميغابايت');
  if (isImage && file.size > MAX_IMG * 2) throw new Error('حجم الصورة كبير جداً');
  const body = isImage ? await compressImage(file) : file;
  const ext = body.type === 'image/jpeg' ? 'jpg' : (body.type.split('/')[1] || 'bin').replace('quicktime', 'mov');
  const path = `${state.me.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const url = await sb.storage.upload(bucket, path, body);
  return { url, type: isVideo ? 'video' : 'image' };
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
