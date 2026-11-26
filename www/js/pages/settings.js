import { h, icon, avatar, clear, toast, sheet, confirmBox } from '../lib/dom.js';
import { goOffline, touchPresence, sb, state, loadMe, PROFILE_MINI } from '../api.js';
import { headerBar } from './home.js';
import { pickPeople } from './people.js';
import { VIS_LABEL } from './stories.js';
import { pushSupported, pushStatus, initPush, dropPushToken } from '../push.js';
import { editProfileSheet } from './profile.js';
import { checkForUpdates, updateState, getWhatsappUrl, openExternal, updateCard } from '../update.js';
import { setSoundFromFile, soundName, resetSound, previewSound, setSoundPreset, SOUND_PRESETS } from '../sounds.js';

export async function settingsPage(root, params, ctx) {
  const box = h('div', { class: 'page' });
  root.append(headerBar('الإعدادات', { back: true }), box);

  const row = (ic, title, sub, right, onclick) => h('div', { class: 'set-row', onclick }, h('div', { class: 'set-ico' }, icon(ic, 20)), h('div', { class: 'grow' }, h('b', null, title), sub && h('div', { class: 'muted small' }, sub)), right);
  const sw = (on, onChange) => { const b = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on, onclick: async (e) => { e.stopPropagation(); const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', v); try { await onChange(v); } catch (er) { b.classList.toggle('on', !v); toast(er.message, 'err'); } } }, h('i')); return b; };

  async function storyPrivacySheet() {
    sheet('خصوصية الحالات', async (body, close) => {
      const cur = ['everyone', 'followers', 'custom'].includes(state.me.story_default) ? state.me.story_default : 'everyone';
      const opts = h('div', { class: 'chips' });
      const paint = (v) => { clear(opts); ['everyone', 'followers'].forEach((k) => opts.append(h('button', { class: 'chip' + (v === k ? ' on' : ''), onclick: async () => {
        try { await sb.from('profiles').update({ story_default: k }).eq('id', state.me.id); state.me.story_default = k; paint(k); toast('تم الحفظ', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, VIS_LABEL[k]))); };
      paint(cur === 'custom' ? 'everyone' : cur);
      const hideRow = h('button', { class: 'menu-item', onclick: async () => {
        try {
          const old = new Set((await sb.from('story_hide_from').select('user_id').eq('owner_id', state.me.id)).map((r) => r.user_id));
          const chosen = await pickPeople('إخفاء حالاتي عن', old); if (!chosen) return;
          const add = [...chosen].filter((x) => !old.has(x)), del = [...old].filter((x) => !chosen.has(x));
          if (add.length) await sb.from('story_hide_from').insert(add.map((u) => ({ owner_id: state.me.id, user_id: u })));
          for (const u of del) await sb.from('story_hide_from').delete().eq('owner_id', state.me.id).eq('user_id', u);
          toast(`تم الحفظ (${chosen.size} مخفي عنهم)`, 'ok');
        } catch (e) { toast(e.message, 'err'); }
      } }, icon('block', 20), 'إخفاء حالاتي عن أشخاص محددين');
      body.append(h('p', { class: 'muted small' }, 'الخصوصية الافتراضية للحالات الجديدة. يمكنك تغييرها لكل حالة عند النشر. المشاهدات والإعجابات تظهر لك أنت فقط.'), opts, hideRow);
    });
  }

  async function blockedSheet() {
    sheet('المحظورون', async (body) => {
      try {
        const rows = await sb.from('blocks').select(`blocked_id,p:profiles!blocks_blocked_id_fkey(${PROFILE_MINI})`).eq('blocker_id', state.me.id);
        const draw = (list) => { clear(body); if (!list.length) body.append(h('div', { class: 'empty small' }, 'لا يوجد مستخدمون محظورون'));
          list.forEach((r) => body.append(h('div', { class: 'user-row' }, avatar(r.p, 42), h('div', { class: 'grow' }, h('b', null, r.p.display_name || r.p.username), h('div', { class: 'muted small' }, '@' + r.p.username)),
            h('button', { class: 'btn ghost sm', onclick: async () => { try { await sb.from('blocks').delete().eq('blocker_id', state.me.id).eq('blocked_id', r.blocked_id); draw(list.filter((x) => x !== r)); toast('تم إلغاء الحظر', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'إلغاء الحظر')))); };
        draw(rows);
      } catch (e) { body.append(h('div', { class: 'empty small' }, e.message)); }
    }, { full: true });
  }
  function passwordSheet() {
    sheet('تغيير كلمة المرور', (body, close) => {
      const p1 = h('input', { class: 'input', type: 'password', placeholder: 'كلمة المرور الجديدة', dir: 'ltr', autocomplete: 'new-password' });
      const p2 = h('input', { class: 'input', type: 'password', placeholder: 'تأكيد كلمة المرور', dir: 'ltr', autocomplete: 'new-password' });
      body.append(p1, p2, h('button', { class: 'btn primary block lg', onclick: async (e) => {
        if (p1.value.length < 6) return toast('6 أحرف على الأقل', 'err');
        if (p1.value !== p2.value) return toast('كلمتا المرور غير متطابقتين', 'err');
        e.target.disabled = true;
        try { await sb.auth.updatePassword(p1.value); toast('تم تغيير كلمة المرور', 'ok'); close(); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
      } }, 'حفظ'));
    });
  }
  function claimSheet() {
    sheet('تفعيل حساب المالك', (body, close) => {
      const code = h('input', { class: 'input', placeholder: 'رمز المالك', dir: 'ltr', autocapitalize: 'characters' });
      body.append(h('p', { class: 'muted' }, 'أدخل رمز المالك لمرة واحدة. بعد التفعيل يُحذف الرمز نهائياً ولا يمكن استخدامه مرة أخرى.'), code,
        h('button', { class: 'btn primary block lg', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await sb.rpc('claim_owner', { code: code.value.trim().toUpperCase() }); if (!r || !r.ok) { toast((r && r.error) || 'رمز غير صحيح', 'err'); e.target.disabled = false; return; } await loadMe(); toast('تم تفعيل حساب المالك', 'ok'); close(); ctx.rerender(); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
        } }, 'تفعيل'));
    });
  }

  box.append(
    h('div', { class: 'user-row big' }, avatar(state.me, 60), h('div', { class: 'grow' }, h('b', null, state.me.display_name), h('div', { class: 'muted' }, '@' + state.me.username))),
    h('h4', { class: 'sec' }, 'الحساب'),
    h('div', { class: 'card-list' },
      row('edit', 'تعديل الملف الشخصي', 'الاسم والنبذة والصورة', null, () => editProfileSheet(() => ctx.rerender())),
      row('lock', 'حساب خاص', 'فقط من تتابعهم يرون منشوراتك', sw(state.me.is_private, async (v) => { await sb.from('profiles').update({ is_private: v }).eq('id', state.me.id); state.me.is_private = v; })),
      row('users', 'حالة الاتصال وآخر ظهور', 'إظهار "متصل الآن" وآخر ظهور. إذا أخفيتها لن ترى حالة الآخرين أيضاً', sw(state.me.show_presence !== false, async (v) => { await sb.from('profiles').update({ show_presence: v }).eq('id', state.me.id); state.me.show_presence = v; if (v) touchPresence(); else goOffline(); })),
      row('eye', 'خصوصية الحالات', 'من يرى حالاتك ومن تُخفى عنه', null, storyPrivacySheet),
      row('block', 'المحظورون', 'إدارة قائمة الحظر', null, blockedSheet),
      row('shield', 'تغيير كلمة المرور', null, null, passwordSheet)),
    state.perms.length ? h('h4', { class: 'sec' }, 'الإدارة') : null,
    state.perms.length ? h('div', { class: 'card-list' }, row('shield', 'لوحة الإدارة', 'حسب صلاحيات دورك', null, () => (location.hash = '#/admin'))) : null);

  // offer owner activation only while no owner exists
  try { if (state.me.role !== 'OWNER' && !(await sb.rpc('owner_exists'))) box.append(h('div', { class: 'card-list' }, row('shield', 'تفعيل حساب المالك', 'لديك رمز المالك؟', null, claimSheet))); } catch {}

  function soundSettingsSheet() {
    sheet('نغمات التطبيق', (body) => {
      body.append(h('p', { class: 'muted small' }, 'اختر نغمة جاهزة أو حمّل صوتاً من ملفات هاتفك. لكل من الرسائل والمكالمات نغمة مستقلة، ويتم حفظ اختيارك على هذا الجهاز.'));
      const makeSoundRow = (key, title, desc) => {
        const status = h('div', { class: 'muted small' }, soundName(key));
        const file = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.3gp', style: { display: 'none' }, onchange: async () => {
          const selected = file.files?.[0]; if (!selected) return;
          try { const name = await setSoundFromFile(key, selected); status.textContent = name; toast('تم حفظ النغمة على هذا الجهاز', 'ok'); }
          catch (e) { toast(e.message || 'تعذر حفظ النغمة', 'err'); }
          file.value = '';
        } });
        const choose = h('button', { class: 'btn primary sm', onclick: () => file.click() }, 'اختيار من الملفات');
        const preview = h('button', { class: 'btn ghost sm', onclick: () => { if (!previewSound(key)) toast('اختر نغمة أولاً', 'err'); } }, 'معاينة');
        const reset = h('button', { class: 'btn ghost sm', onclick: () => { resetSound(key); status.textContent = 'النغمة الأصلية'; toast('تمت استعادة النغمة الأصلية', 'ok'); } }, 'استعادة الأصلية');
        const presets = h('div', { class: 'row wrap gap', style: { margin: '8px 0 10px' } },
          ...SOUND_PRESETS.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => {
            try { setSoundPreset(key, p.id); status.textContent = p.name; previewSound(key); toast('تم اختيار نغمة ' + p.name, 'ok'); }
            catch (e) { toast(e.message, 'err'); }
          } }, p.name)));
        return h('div', { class: 'menu-item', style: { display: 'block', padding: '14px 12px' } },
          h('div', { class: 'row between' }, h('b', null, title), status),
          h('div', { class: 'muted small', style: { margin: '5px 0 10px' } }, desc),
          h('div', { class: 'muted small' }, 'نغمات جاهزة'),
          presets,
          h('div', { class: 'row wrap gap' }, choose, preview, reset), file);
      };
      body.append(makeSoundRow('message', 'نغمة الرسائل', 'تعمل عند وصول رسالة جديدة والتطبيق مفتوح.'),
        makeSoundRow('call', 'نغمة المكالمات', 'تعمل عند ورود مكالمة والتطبيق مفتوح.'));
      body.append(h('p', { class: 'muted small' }, 'ملاحظة: نغمات إشعارات النظام التي تصل والتطبيق مغلق تعتمد حالياً على إعدادات إشعارات Android.'));
    }, { full: true });
  }

  box.append(h('h4', { class: 'sec' }, 'الإشعارات'), h('div', { class: 'card-list' },
    row('music', 'نغمات التطبيق', 'تخصيص نغمة الرسائل والمكالمات واختيار ملفات من الهاتف', null, soundSettingsSheet),
    row('bell', 'اختبار الإشعارات', 'يرسل إشعاراً حقيقياً إلى هذا الجهاز', null, async () => {
      if (!pushSupported()) return toast('إشعارات Push تعمل داخل تطبيق Android فقط', 'err');
      await initPush();
      if (pushStatus.perm !== 'granted') return toast('صلاحية الإشعارات غير ممنوحة. فعّلها من إعدادات الهاتف ← التطبيقات ← M17 ← الإشعارات', 'err');
      if (pushStatus.error) return toast(pushStatus.error, 'err');
      await new Promise((r) => setTimeout(r, 1500));
      try { const r = await sb.rpc('send_test_push'); toast(r?.ok ? 'أُرسل إشعار تجريبي، انتظر ثوانٍ قليلة' : 'لم يُسجَّل هذا الجهاز بعد، أعد المحاولة بعد لحظات', r?.ok ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); }
    })));

  const wa = await getWhatsappUrl();
  const verRow = row('download', 'التحقق من التحديثات', 'إصدارك: ' + (updateState.current || '—'), null, async () => {
    const i = await checkForUpdates({ force: true });
    if (!i) return toast('أنت تستخدم أحدث إصدار', 'ok');
    sheet('تحديث متاح', (b) => b.append(updateCard(h)));
  });
  box.append(h('h4', { class: 'sec' }, 'التطبيق'), h('div', { class: 'card-list' }, verRow,
    wa ? row('chat', 'مجموعة واتساب', 'انضم للدعم والأخبار', null, () => openExternal(wa)) : null));

  box.append(h('h4', { class: 'sec' }, 'الجلسة'),
    h('div', { class: 'card-list' },
      row('logout', 'تسجيل الخروج', null, null, async () => { await dropPushToken(); goOffline(); await sb.auth.signOut(); ctx.rerender(); }),
      row('trash', 'حذف حسابي نهائياً', 'يحذف منشوراتك ورسائلك ولا يمكن التراجع', null, async () => {
        if (state.me.role === 'OWNER') return toast('لا يمكن حذف حساب المالك من التطبيق', 'err');
        if (!(await confirmBox('سيُحذف حسابك وكل بياناتك نهائياً. هل أنت متأكد؟', 'حذف الحساب', true))) return;
        try { await sb.rpc('delete_my_account'); await sb.auth.signOut(); ctx.rerender(); } catch (e) { toast(e.message, 'err'); }
      })),
    h('p', { class: 'muted small center' }, 'NEXORA · الإصدار 1.0'));
  [...box.querySelectorAll('.set-row')].find((r) => r.textContent.includes('حذف حسابي نهائياً'))?.classList.add('danger-row');
}
