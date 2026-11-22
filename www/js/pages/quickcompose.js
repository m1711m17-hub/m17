import { h, icon, toast } from '../lib/dom.js';

// Pending file handed over to the compose page (set from a real tap, so the Android file chooser works).
export const pending = { file: null, story: false };

// Quick "share" strip: pick a photo/video straight from home or profile, then land on the compose page with it attached.
export function quickComposer() {
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
  let story = false;
  fileIn.onchange = () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return toast('اختر صورة أو فيديو', 'err');
    pending.file = f; pending.story = story;
    location.hash = '#/compose' + (story ? '?story=1' : '');
  };
  const pick = (accept, asStory) => () => { story = asStory; fileIn.accept = accept; fileIn.click(); };
  const btn = (ic, label, fn) => h('button', { class: 'btn ghost quick-btn', onclick: fn }, icon(ic, 20), label);
  return h('div', { class: 'quick-compose' },
    h('div', { class: 'row gap' },
      btn('image', 'صورة', pick('image/*', false)),
      btn('video', 'فيديو', pick('video/*', false)),
      btn('plus', 'حالة', pick('image/*,video/*', true)),
      h('a', { class: 'btn ghost quick-btn', href: '#/compose' }, icon('edit', 20), 'نص')),
    fileIn);
}
