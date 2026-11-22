import { h, icon, avatar, clear, sheet, toast } from '../lib/dom.js';
import { sb, state, PROFILE_MINI } from '../api.js';

// People picker over my network (people I follow + my followers). Resolves with a Set of ids, or null if dismissed.
export function pickPeople(title, initial = new Set()) {
  return new Promise((resolve) => {
    const chosen = new Set(initial); let saved = false;
    const close = sheet(title, async (body, closeSheet) => {
      const search = h('input', { class: 'input search', placeholder: 'بحث...' });
      const list = h('div', { class: 'card-list' }, h('div', { class: 'empty small' }, 'جارٍ التحميل...'));
      const done = h('button', { class: 'btn primary block lg', onclick: () => { saved = true; closeSheet(); resolve(chosen); } }, 'تم');
      body.append(search, list, done);
      let people = [];
      try {
        const [a, b] = await Promise.all([
          sb.from('follows').select('following_id').eq('follower_id', state.me.id).limit(500),
          sb.from('follows').select('follower_id').eq('following_id', state.me.id).limit(500),
        ]);
        const ids = [...new Set([...a.map((x) => x.following_id), ...b.map((x) => x.follower_id), ...initial])];
        people = ids.length ? await sb.from('profiles').select(PROFILE_MINI).in('id', ids) : [];
      } catch (e) { toast(e.message, 'err'); }
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        clear(list);
        const rows = people.filter((p) => !q || p.username.includes(q) || (p.display_name || '').toLowerCase().includes(q));
        if (!rows.length) return list.append(h('div', { class: 'empty small' }, people.length ? 'لا نتائج' : 'لا يوجد متابعون أو أشخاص تتابعهم بعد'));
        rows.forEach((p) => {
          const box = h('span', { class: 'check' + (chosen.has(p.id) ? ' on' : '') }, icon('check', 16));
          list.append(h('button', { class: 'user-row', onclick: () => { chosen.has(p.id) ? chosen.delete(p.id) : chosen.add(p.id); box.classList.toggle('on', chosen.has(p.id)); } },
            avatar(p, 42), h('div', { class: 'grow' }, h('b', null, p.display_name || p.username), h('div', { class: 'muted small' }, '@' + p.username)), box));
        });
      };
      search.addEventListener('input', draw); draw();
    }, { full: true });
    // resolve null if the sheet is dismissed without pressing "done"
    const obs = new MutationObserver(() => { if (!document.querySelector('.sheet-back')) { obs.disconnect(); if (!saved) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}
