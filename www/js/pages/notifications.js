import { watchHost } from './live.js';
import { h, icon, avatar, clear, toast, timeAgo, dayLabel } from '../lib/dom.js';
import { sb, state, refreshBadges } from '../api.js';
import { headerBar } from './home.js';
import { updateCard, updateState, checkForUpdates, getWhatsappUrl, openExternal } from '../update.js';

const FILTERS = [['all', 'الكل'], ['like', 'إعجابات'], ['comment', 'تعليقات'], ['follow', 'متابعات'], ['message', 'رسائل'], ['broadcast', 'الإدارة']];
const TEXT = { like: 'أعجب بمنشورك', comment: 'علّق على منشورك', follow: 'بدأ بمتابعتك', message: 'أرسل لك رسالة', live: 'بدأ بثاً مباشراً' };
const ICON = { like: 'heart', comment: 'comment', follow: 'users', message: 'chat', broadcast: 'megaphone', system: 'bell', live: 'live' };

export async function notificationsPage(root) {
  let filter = 'all', rows = [], waUrl = '';
  const chips = h('div', { class: 'chips scroll' });
  const list = h('div', { class: 'notifs' });
  const markAll = h('button', { class: 'btn ghost sm', onclick: async () => {
    try { await sb.from('notifications').update({ is_read: true }).eq('user_id', state.me.id).eq('is_read', false); rows.forEach((n) => (n.is_read = true)); paint(); refreshBadges(); } catch (e) { toast(e.message, 'err'); }
  } }, 'تعليم الكل كمقروء');
  root.append(headerBar('الإشعارات', { right: [markAll] }), h('div', { class: 'page' }, chips, list));

  function paint() {
    clear(chips).append(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (k === filter ? ' on' : ''), onclick: () => { filter = k; paint(); } }, l)));
    clear(list);
    const uc = updateCard(h); if (uc) list.append(uc);
    if (waUrl) list.append(h('button', { class: 'upd-card wa', onclick: () => openExternal(waUrl) }, h('b', null, '💬 انضم إلى مجموعة NEXORA على واتساب'), h('div', { class: 'muted' }, 'للدعم والأخبار والتحديثات')));
    const items = rows.filter((n) => filter === 'all' || n.type === filter);
    if (!items.length) return list.append(h('div', { class: 'empty' }, icon('bell', 44), h('h3', null, 'لا توجد إشعارات'), h('p', null, 'ستظهر هنا الإعجابات والتعليقات والمتابعات.')));
    let day = '';
    items.forEach((n) => {
      const d = dayLabel(n.created_at);
      if (d !== day) { day = d; list.append(h('div', { class: 'day-sep left' }, d)); }
      const a = n.actor;
      const text = n.type === 'broadcast' || n.type === 'system' ? h('div', null, h('b', null, n.title || 'إشعار من الإدارة'), h('div', { class: 'muted' }, n.body))
        : h('div', null, h('b', null, a?.display_name || a?.username || 'مستخدم'), ' ' + TEXT[n.type], n.body && n.type !== 'follow' ? h('div', { class: 'muted ellipsis' }, '“' + n.body + '”') : null);
      list.append(h('button', { class: 'notif' + (n.is_read ? '' : ' unread'), onclick: () => {
        if (n.type === 'like' || n.type === 'comment') location.hash = `#/post/${n.post_id}`;
        else if (n.type === 'follow' && a) location.hash = `#/u/${a.username}`;
        else if (n.type === 'message' && a) location.hash = `#/chat/${a.username}`;
        else if (n.type === 'live' && a) watchHost(a.id);
      } }, h('div', { class: 'n-av' }, a ? avatar(a, 46) : h('div', { class: 'n-ico' }, icon(ICON[n.type], 22)), h('span', { class: 'n-type ' + n.type }, icon(ICON[n.type], 12))), h('div', { class: 'grow' }, text, h('div', { class: 'muted small' }, timeAgo(n.created_at)))));
    });
  }
  try {
    rows = await sb.from('notifications').select('*,actor:profiles!notifications_actor_id_fkey(id,username,display_name,avatar_url,role)').eq('user_id', state.me.id).order('created_at', { ascending: false }).limit(100);
    paint();
    Promise.all([checkForUpdates(), getWhatsappUrl()]).then(([, w]) => { waUrl = w || ''; paint(); }).catch(() => {});
    if (rows.some((n) => !n.is_read)) {
      // keep the unread highlight on screen for this visit, mark as read on the server
      sb.from('notifications').update({ is_read: true }).eq('user_id', state.me.id).eq('is_read', false).then(() => refreshBadges()).catch(() => {});
    }
  } catch (e) { clear(list).append(h('div', { class: 'empty' }, e.message)); paint(); }
}
