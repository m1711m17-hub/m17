import { h, icon, clear, toast } from '../lib/dom.js';
import { sb, state } from '../api.js';

let cache = null;
export async function loadStickers(force = false) {
  if (cache && !force) return cache;
  const [packs, stickers, favs] = await Promise.all([
    sb.from('sticker_packs').select('*').eq('is_active', true).order('sort'),
    sb.from('stickers').select('*').order('sort').limit(3000),
    sb.from('sticker_favorites').select('sticker_id').eq('user_id', state.me.id),
  ]);
  cache = { packs, stickers, favs: new Set(favs.map((f) => f.sticker_id)) };
  return cache;
}
export const dropStickerCache = () => { cache = null; };

// Sticker picker panel that sits above the chat bar. onPick({emoji,label,color}) sends it as a message.
export function stickerPanel({ onPick }) {
  const tabs = h('div', { class: 'sp-tabs' });
  const grid = h('div', { class: 'sp-grid' });
  const el = h('div', { class: 'sticker-panel', hidden: true }, tabs, grid);
  let tab = 'fav', data = null, loaded = false;

  async function ensure() {
    if (loaded) return true;
    clear(grid).append(h('div', { class: 'empty small' }, 'جارٍ التحميل...'));
    try { data = await loadStickers(true); loaded = true; if (!data.favs.size && data.packs.length) tab = data.packs[0].id; return true; }
    catch (e) { clear(grid).append(h('div', { class: 'empty small' }, e.message)); return false; }
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
    if (!list.length) return grid.append(h('div', { class: 'empty small' }, tab === 'fav' ? 'لا توجد ملصقات مفضلة بعد. اضغط ⭐ على أي ملصق لإضافته.' : 'لا توجد ملصقات في هذه الحزمة'));
    const pname = tab === 'fav' ? 'المفضلة' : packOf.get(tab)?.name;
    grid.append(h('div', { class: 'sp-title muted small' }, pname));
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
