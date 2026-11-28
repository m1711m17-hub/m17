import { h, icon, clear, toast, actionSheet } from '../lib/dom.js';
import { sb, state } from '../api.js';
import { SUPABASE_URL } from '../config.js';
import { openStickerMaker } from './sticker-maker.js';

let cache = null;
export async function loadStickers(force = false) {
  if (cache && !force) return cache;
  const [packs, stickers, favs, customs] = await Promise.all([
    sb.from('sticker_packs').select('*').eq('is_active', true).order('sort'),
    sb.from('stickers').select('*').order('sort').limit(3000),
    sb.from('sticker_favorites').select('sticker_id').eq('user_id', state.me.id),
    sb.from('saved_stickers').select('*').eq('user_id', state.me.id).order('created_at', { ascending: false }).limit(300).catch(() => []),
  ]);
  cache = { packs, stickers, favs: new Set(favs.map((f) => f.sticker_id)), customs };
  return cache;
}
export const dropStickerCache = () => { cache = null; };

// ---------- custom (created / saved) stickers ----------
const BASE = SUPABASE_URL + '/storage/v1/object/public/stickers/';
// A chat message stores a custom sticker as "u:<public url>". Only our own storage bucket is trusted.
export const customStickerUrl = (s) => (typeof s === 'string' && s.startsWith('u:') && s.slice(2).startsWith(BASE) && s.length < 700 ? s.slice(2) : null);
const isAnimated = (u) => /\.(gif|webp)($|\?)/i.test(u);

export async function saveCustomSticker(blob, animated) {
  const supported = ['image/gif', 'image/webp', 'image/png'];
  const mime = animated && supported.includes(blob?.type) ? blob.type : animated ? 'image/gif' : 'image/png';
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'png';
  const path = `${state.me.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const url = await sb.storage.upload('stickers', path, new File([blob], 'sticker.' + ext, { type: mime }));
  await addCustom(url, animated, true);
  return url;
}
async function addCustom(url, animated, mine) {
  const d = await loadStickers();
  if (d.customs.some((c) => c.url === url)) return;
  const row = await sb.from('saved_stickers').insert({ user_id: state.me.id, url, animated: !!animated, made_by_me: !!mine }).select('*').one();
  d.customs.unshift(row || { url, animated, made_by_me: mine });
}
async function removeCustom(url) {
  const d = await loadStickers();
  await sb.from('saved_stickers').delete().eq('user_id', state.me.id).eq('url', url);
  d.customs = d.customs.filter((c) => c.url !== url);
}
export const stickerImg = (url, cls = '') => h('img', { class: 'sticker-img ' + cls, src: url, alt: 'ملصق', loading: 'lazy', draggable: false });

// Sticker bubble content inside a chat: tap to add it to (or remove it from) your favourites.
export function customStickerBubble(url) {
  return h('button', { class: 'sticker-img-msg', type: 'button', 'aria-label': 'ملصق', onclick: async () => {
    let saved = false;
    try { saved = (await loadStickers()).customs.some((c) => c.url === url); } catch {}
    actionSheet('ملصق', [saved
      ? { label: 'إزالة من المفضلة', icon: 'heartoff', run: async () => { try { await removeCustom(url); toast('تمت الإزالة من المفضلة', 'ok'); } catch (e) { toast(e.message, 'err'); } } }
      : { label: 'إضافة إلى المفضلة', icon: 'star', run: async () => { try { await addCustom(url, isAnimated(url), false); toast('تمت الإضافة إلى المفضلة', 'ok'); } catch (e) { toast(e.message, 'err'); } } }]);
  } }, stickerImg(url));
}


// Sticker picker panel that sits above the chat bar. onPick({emoji,label,color}) sends it as a message.
export function stickerPanel({ onPick }) {
  const tabs = h('div', { class: 'sp-tabs' });
  const grid = h('div', { class: 'sp-grid' });
  const el = h('div', { class: 'sticker-panel', hidden: true }, tabs, grid);
  let tab = 'fav', data = null, loaded = false;

  async function ensure() {
    if (loaded) return true;
    clear(grid).append(h('div', { class: 'empty small' }, 'جارٍ التحميل...'));
    try { data = await loadStickers(true); loaded = true; return true; }
    catch (e) { clear(grid).append(h('div', { class: 'empty small' }, e.message)); return false; }
  }
  function createSticker() {
    openStickerMaker({ onSave: async (blob, animated) => { await saveCustomSticker(blob, animated); toast('تمت إضافة الملصق إلى المفضلة', 'ok'); if (!el.hidden) paint(); } });
  }
  function paintTabs() {
    clear(tabs).append(
      h('button', { class: 'sp-tab' + (tab === 'fav' ? ' on' : ''), 'aria-label': 'المفضلة', onclick: () => { tab = 'fav'; paint(); } }, icon('star', 20)),
      ...data.packs.map((p) => h('button', { class: 'sp-tab' + (tab === p.id ? ' on' : ''), title: p.name, onclick: () => { tab = p.id; paint(); } }, h('span', { class: 'sp-ico' }, p.icon || '🙂'))));
  }
  function paint() {
    if (!data) return;
    paintTabs(); clear(grid);
    const packOf = new Map(data.packs.map((p) => [p.id, p]));
    const list = tab === 'fav' ? data.stickers.filter((s) => data.favs.has(s.id) && packOf.has(s.pack_id)) : data.stickers.filter((s) => s.pack_id === tab);
    const customs = tab === 'fav' ? data.customs : [];
    if (tab === 'fav') grid.append(h('button', { class: 'sticker-tile create', type: 'button', onclick: createSticker }, icon('plus', 26), h('span', { class: 'sl' }, 'إنشاء ملصق')));
    customs.forEach((c) => grid.append(h('div', { class: 'sticker-tile custom' },
      h('button', { class: 'sc-pick', type: 'button', 'aria-label': 'إرسال الملصق', onclick: () => onPick({ url: c.url }) }, stickerImg(c.url)),
      h('button', { class: 'sc-del', type: 'button', 'aria-label': 'إزالة من المفضلة', onclick: async () => { try { await removeCustom(c.url); paint(); } catch (e) { toast(e.message, 'err'); } } }, icon('close', 12)))));
    if (!list.length && !customs.length) return grid.append(h('div', { class: 'empty small' }, tab === 'fav' ? 'لا توجد ملصقات مفضلة بعد. أنشئ ملصقاً، أو اضغط على ملصق وصلك في المحادثة لإضافته.' : 'لا توجد ملصقات في هذه الحزمة'));
    const pname = tab === 'fav' ? 'المفضلة' : packOf.get(tab)?.name;
    grid.insertBefore(h('div', { class: 'sp-title muted small' }, pname), grid.firstChild);
    list.forEach((s) => {
      const pack = packOf.get(s.pack_id); const color = pack?.color || '#2f6bff';
      const isFav = data.favs.has(s.id);
      const star = h('button', { class: 'sp-star' + (isFav ? ' on' : ''), type: 'button', 'aria-label': isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة', onclick: async (e) => {
        e.stopPropagation(); const was = data.favs.has(s.id);
        was ? data.favs.delete(s.id) : data.favs.add(s.id); star.classList.toggle('on', !was);
        try { if (was) await sb.from('sticker_favorites').delete().eq('user_id', state.me.id).eq('sticker_id', s.id); else await sb.from('sticker_favorites').insert({ user_id: state.me.id, sticker_id: s.id }); if (tab === 'fav') paint(); }
        catch (er) { was ? data.favs.add(s.id) : data.favs.delete(s.id); star.classList.toggle('on', was); toast(er.message, 'err'); }
      } }, icon('star', 14));
      grid.append(h('button', { class: 'sticker-tile', type: 'button', style: { '--sc': color }, onclick: () => onPick({ emoji: s.emoji, label: s.label || '', color }) }, h('span', { class: 'se' }, s.emoji), h('span', { class: 'sl' }, s.label || ''), star));
    });
  }
  return Object.assign(el, {
    async open() { el.hidden = false; if (await ensure()) paint(); },
    close() { el.hidden = true; },
    toggle() { el.hidden ? this.open() : this.close(); },
    get isOpen() { return !el.hidden; },
  });
}
