import { watchHost } from './live.js';
import { h, icon, avatar, clear, toast, timeAgo, dayLabel } from '../lib/dom.js';
import { sb, state, refreshBadges, bus } from '../api.js';
import { headerBar } from './home.js';
import { updateCard, updateState, checkForUpdates, getWhatsappUrl, openExternal } from '../update.js';

const FILTERS = [['all', 'الكل'], ['like', 'إعجابات'], ['comment', 'تعليقات'], ['follow', 'متابعات'], ['message', 'رسائل'], ['broadcast', 'الإدارة']];
const TEXT = { like: 'أعجب بمنشورك', comment: 'علّق على منشورك', follow: 'بدأ بمتابعتك', message: 'أرسل لك رسالة', live: 'بدأ بثاً مباشراً' };
const ICON = { like: 'heart', comment: 'comment', follow: 'users', message: 'chat', broadcast: 'megaphone', system: 'bell', live: 'live' };

export async function notificationsPage(root) {
  let filter = 'all', rows = [], waUrl = '', loading = false, disposed = false, request = 0;
  const chips = h('div', { class: 'chips scroll' });
  const list = h('div', { class: 'notifs' });
  const markAll = h('button', { class: 'btn ghost sm', onclick: async () => {
    try {
      await sb.from('notifications').update({ is_read: true }).eq('user_id', state.me.id).eq('is_read', false);
      rows.forEach((n) => (n.is_read = true)); paint(); await refreshBadges();
    } catch (e) { toast(e.message, 'err'); }
  } }, 'تعليم الكل كمقروء');
  root.append(headerBar('الإشعارات', { right: [markAll] }), h('div', { class: 'page' }, chips, list));

  async function loadRows() {
    if (loading || disposed) return;
    loading = true; const seq = ++request;
    try {
      const result = await sb.from('notifications').select('*,actor:profiles!notifications_actor_id_fkey(id,username,display_name,avatar_url,role)').eq('user_id', state.me.id).order('created_at', { ascending: false }).limit(100);
      if (disposed || seq !== request) return;
      rows = result || [];
      paint();
      if (rows.some((n) => !n.is_read)) {
        await sb.from('notifications').update({ is_read: true }).eq('user_id', state.me.id).eq('is_read', false);
        rows.forEach((n) => (n.is_read = true));
        await refreshBadges();
        if (!disposed) paint();
      }
    } catch (e) {
      if (!disposed) clear(list).append(h('div', { class: 'empty' }, e.message));
    } finally { loading = false; }
  }

  async function openNotification(n) {
    if (!n.is_read) {
      try {
        await sb.from('notifications').update({ is_read: true }).eq('id', n.id).eq('user_id', state.me.id);
        n.is_read = true; paint(); await refreshBadges();
      } catch (e) { toast(e.message, 'err'); }
    }
    if (n.type === 'like' || n.type === 'comment') location.hash = `#/post/${n.post_id}`;
    else if (n.type === 'follow' && n.actor) location.hash = `#/u/${n.actor.username}`;
    else if (n.type === 'message' && n.actor) location.hash = `#/chat/${n.actor.username}`;
    else if (n.type === 'live' && n.actor) watchHost(n.actor.id);
  }

  function paint() {
    clear(chips).append(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (k === filter ? ' on' : ''), onclick: () => { filter = k; paint(); } }, l)));
    clear(list);
    const uc = updateCard(h); if (uc) list.append(uc);
    if (waUrl) list.append(h('button', { class: 'upd-card wa', onclick: () => openExternal(waUrl) }, h('b', null, '💬 انضم إلى مجموعة NEXORA على واتساب'), h('div', { class: 'muted' }, 'للدعم والأخبار والتحديثات')));
    const items = rows.filter((n) => filter === 'all' || (filter === 'broadcast' ? ['broadcast', 'system'].includes(n.type) : n.type === filter));
    if (!items.length) return list.append(h('div', { class: 'empty' }, icon('bell', 44), h('h3', null, 'لا توجد إشعارات'), h('p', null, 'ستظهر هنا الإعجابات والتعليقات والمتابعات.')));
    let day = '';
    items.forEach((n) => {
      const d = dayLabel(n.created_at);
      if (d !== day) { day = d; list.append(h('div', { class: 'day-sep left' }, d)); }
      const a = n.actor;
      const text = n.type === 'broadcast' || n.type === 'system'
        ? h('div', null, h('b', null, n.title || 'إشعار من الإدارة'), h('div', { class: 'muted' }, n.body))
        : h('div', null, h('b', null, a?.display_name || a?.username || 'مستخدم'), ' ' + (TEXT[n.type] || 'أرسل إليك إشعاراً'), n.body && n.type !== 'follow' ? h('div', { class: 'muted ellipsis' }, '“' + n.body + '”') : null);
      list.append(h('button', { class: 'notif' + (n.is_read ? '' : ' unread'), onclick: () => openNotification(n) },
        h('div', { class: 'n-av' }, a ? avatar(a, 46) : h('div', { class: 'n-ico' }, icon(ICON[n.type] || 'bell', 22)), h('span', { class: 'n-type ' + n.type }, icon(ICON[n.type] || 'bell', 12))),
        h('div', { class: 'grow' }, text, h('div', { class: 'muted small' }, timeAgo(n.created_at)))));
    });
  }

  await loadRows();
  Promise.all([checkForUpdates(), getWhatsappUrl()]).then(([, w]) => { if (!disposed) { waUrl = w || ''; paint(); } }).catch(() => {});
  const onNotification = (e) => {
    if (!e.detail || e.detail.user_id === state.me.id) { loadRows(); refreshBadges(); }
  };
  const onResume = () => { loadRows(); refreshBadges(); };
  bus.addEventListener('rt:notification', onNotification);
  bus.addEventListener('m17:resume', onResume);
  return () => {
    disposed = true; bus.removeEventListener('rt:notification', onNotification); bus.removeEventListener('m17:resume', onResume);
  };
}
