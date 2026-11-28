import { h, icon, avatar, clear, toast, sheet } from '../lib/dom.js';
import { sb, state, PROFILE_MINI } from '../api.js';
import { reportDialog } from './postcard.js';
import { openExternal } from '../update.js';

const APK = 'https://github.com/m1711m17-hub/m17/releases/latest/download/NEXORA.apk';
const hiddenKey = 'nexora.reels.hidden';
export function hiddenReels() { try { return new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]')); } catch { return new Set(); } }
function hideReel(id) { try { const s = hiddenReels(); s.add(id); localStorage.setItem(hiddenKey, JSON.stringify([...s].slice(-500))); } catch {} }

// TikTok-style share sheet: people (in-app DM) / apps / actions.
export function sharePostSheet(post, { onShared, onHidden } = {}) {
  const a = post.author || {};
  // Use the actual public media URL as the share target. This opens the video directly\n  // in a browser/player and avoids copying an app-only deep link or promotional text.\n  const shareUrl = post.media_url || APK;\n  const text = `شاهد ${post.media_type === 'video' ? 'هذا الفيديو' : 'هذا المنشور'} على NEXORA من @${a.username || ''}` + (post.body ? `\\n«${post.body.slice(0, 120)}»` : '') + `\\n${shareUrl}`;
  let counted = post.shared;
  const count = async () => { if (counted) return; counted = true; try { await sb.from('shares').insert({ post_id: post.id, user_id: state.me.id }); post.shared = true; post.nShares++; onShared?.(); } catch {} };

  sheet('إرسال إلى', (body, close) => {
    body.classList.add('share-sheet');
    const people = h('div', { class: 'share-row people' });
    const search = h('input', { class: 'input search', placeholder: 'ابحث عن شخص...', hidden: true });
    let list = [];
    const paintPeople = () => {
      clear(people);
      const q = search.value.trim().toLowerCase();
      const shown = list.filter((p) => !q || (p.display_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
      if (!shown.length) return people.append(h('div', { class: 'muted small' }, list.length ? 'لا نتائج' : 'تابع أشخاصاً لتتمكن من إرسال المنشورات إليهم مباشرة'));
      shown.forEach((p) => {
        const btn = h('button', { class: 'share-item', type: 'button' }, avatar(p, 54), h('span', { class: 'share-name' }, p.display_name || p.username));
        btn.onclick = async () => {
          if (btn.dataset.sent) return; btn.disabled = true;
          try {
            await sb.from('messages').insert({ sender_id: state.me.id, receiver_id: p.id, body: `${post.media_type === 'video' ? '🎬' : '📝'} ${shareUrl}\n${post.body ? post.body.slice(0, 100) : ''}`.trim() });
            btn.dataset.sent = '1'; btn.classList.add('sent'); toast('تم الإرسال إلى ' + (p.display_name || p.username), 'ok'); count();
          } catch (e) { toast(e.message, 'err'); }
          btn.disabled = false;
        };
        people.append(btn);
      });
    };
    search.addEventListener('input', paintPeople);
    (async () => {
      try {
        const [fo, fr] = await Promise.all([
          sb.from('follows').select('following_id').eq('follower_id', state.me.id).limit(60),
          sb.from('follows').select('follower_id').eq('following_id', state.me.id).limit(60),
        ]);
        const ids = [...new Set([...fo.map((r) => r.following_id), ...fr.map((r) => r.follower_id)])].filter((i) => i !== state.me.id).slice(0, 60);
        list = ids.length ? await sb.from('profiles').select(PROFILE_MINI).in('id', ids).limit(60) : [];
      } catch { list = []; }
      paintPeople();
    })();

    const app = (label, ic, cls, fn) => h('button', { class: 'share-item', type: 'button', onclick: async () => { await count(); fn(); } }, h('span', { class: 'share-ic ' + cls }, ic), h('span', { class: 'share-name' }, label));
    const enc = encodeURIComponent;
    const apps = h('div', { class: 'share-row apps' },
      app('واتساب', icon('chat', 26), 'wa', () => openExternal('https://wa.me/?text=' + enc(text))),
      app('تيليجرام', icon('send', 26), 'tg', () => openExternal('https://t.me/share/url?url=' + enc(shareUrl) + '&text=' + enc(text.split('\n')[0]))),
      app('فيسبوك', icon('share', 26), 'fb', () => openExternal('https://www.facebook.com/sharer/sharer.php?u=' + enc(shareUrl))),
      app('رسالة SMS', icon('comment', 26), 'sms', () => { location.href = 'sms:?body=' + enc(text); }),
      app('البريد', icon('mail', 26), 'mail', () => { location.href = 'mailto:?subject=' + enc('NEXORA') + '&body=' + enc(text); }),
      app('نسخ الرابط', icon('link', 26), 'copy', async () => { try { await navigator.clipboard.writeText(shareUrl); toast('تم نسخ رابط الفيديو', 'ok'); } catch { try { const input = h('textarea', { readonly: true, value: shareUrl }); document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); toast('تم نسخ رابط الفيديو', 'ok'); } catch { toast('تعذّر النسخ', 'err'); } } }),
      app('المزيد', icon('more', 26), 'more', () => { if (navigator.share) navigator.share({ title: 'NEXORA', text: text.split('\\n')[0], url: shareUrl }).catch(() => {}); else toast('المشاركة غير مدعومة على هذا الجهاز'); }));

    const act = (label, ic, fn) => h('button', { class: 'share-item', type: 'button', onclick: fn }, h('span', { class: 'share-ic act' }, ic), h('span', { class: 'share-name' }, label));
    const actions = h('div', { class: 'share-row actions' },
      post.media_type === 'video' && post.media_url ? act('تنزيل', icon('download', 24), () => { openExternal(post.media_url).catch(() => toast('تعذّر فتح الفيديو', 'err')); }) : null,
      post.author_id !== state.me.id ? act('غير مهتم', icon('heartoff', 24), () => { hideReel(post.id); close(); onHidden?.(post); toast('لن نعرض لك هذا الفيديو مجدداً', 'ok'); }) : null,
      post.author_id !== state.me.id ? act('إبلاغ', icon('flag', 24), () => { close(); reportDialog('post', post.id); }) : null);

    const searchBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'بحث عن شخص', onclick: () => { search.hidden = !search.hidden; if (!search.hidden) search.focus(); } }, icon('search', 20));
    body.append(h('div', { class: 'row between' }, h('span', { class: 'muted small' }, 'أرسل إلى أصدقائك داخل NEXORA'), searchBtn), search, people, h('div', { class: 'muted small share-sep' }, 'مشاركة عبر'), apps, actions);
  });
}
