import { h, icon, clear, toast } from '../lib/dom.js';
import { sb, state, uploadMedia, feature } from '../api.js';
import { headerBar } from './home.js';
import { pending } from './quickcompose.js';

export function composePage(root, params) {
  let mode = params.story ? 'story' : 'post';
  let file = null, previewUrl = null;
  const text = h('textarea', { class: 'input big', rows: 5, maxlength: 2000, placeholder: 'بماذا تفكر؟' });
  const prev = h('div', { class: 'media-prev' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onchange: () => {
    const f = fileIn.files[0]; if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return toast('اختر صورة أو فيديو', 'err');
    file = f; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(f); paintPrev();
  } });
  const bar = h('div', { class: 'progress', style: { display: 'none' } }, h('i'));
  const publish = h('button', { class: 'btn primary lg', onclick: submit }, 'نشر');
  const tabP = h('button', { class: 'seg-btn', onclick: () => set('post') }, 'منشور');
  const tabS = h('button', { class: 'seg-btn', onclick: () => set('story') }, 'حالة (24 ساعة)');

  function paintPrev() {
    clear(prev);
    if (!file) return;
    prev.append(file.type.startsWith('video/') ? h('video', { src: previewUrl, controls: true, playsinline: true }) : h('img', { src: previewUrl, alt: '' }),
      h('button', { class: 'icon-btn prev-x', 'aria-label': 'إزالة', onclick: () => { file = null; fileIn.value = ''; paintPrev(); } }, icon('close', 18)));
  }
  function set(m) {
    mode = m; tabP.classList.toggle('on', m === 'post'); tabS.classList.toggle('on', m === 'story');
    text.placeholder = m === 'post' ? 'بماذا تفكر؟' : 'أضف تعليقاً على حالتك (اختياري)';
    text.maxLength = m === 'post' ? 2000 : 200; text.rows = m === 'post' ? 5 : 2;
  }
  async function submit() {
    const body = text.value.trim();
    if (mode === 'post' && !feature('posts')) return toast('النشر متوقف حالياً', 'err');
    if (mode === 'story' && !feature('stories')) return toast('الحالات متوقفة حالياً', 'err');
    if (mode === 'story' && !file) return toast('اختر صورة أو فيديو للحالة', 'err');
    if (mode === 'post' && !body && !file) return toast('اكتب شيئاً أو أضف وسائط', 'err');
    publish.disabled = true; publish.classList.add('loading'); bar.style.display = '';
    bar.firstChild.style.width = '35%';
    try {
      let media = null;
      if (file) media = await uploadMedia(mode === 'story' ? 'stories' : 'posts', file);
      bar.firstChild.style.width = '80%';
      if (mode === 'post') await sb.from('posts').insert({ author_id: state.me.id, body, media_url: media?.url || null, media_type: media?.type || null });
      else await sb.from('stories').insert({ author_id: state.me.id, media_url: media.url, media_type: media.type, caption: body });
      bar.firstChild.style.width = '100%';
      toast(mode === 'post' ? 'تم نشر المنشور' : 'تمت إضافة الحالة', 'ok');
      location.hash = '#/home';
    } catch (e) { toast(e.message, 'err'); bar.style.display = 'none'; }
    finally { publish.disabled = false; publish.classList.remove('loading'); }
  }
  root.append(headerBar('نشر', { right: [publish] }),
    h('div', { class: 'page' }, h('div', { class: 'seg' }, tabP, tabS),
      h('div', { class: 'row gap top' }, text), prev, bar,
      h('div', { class: 'row gap' }, h('button', { class: 'btn ghost', onclick: () => { fileIn.accept = 'image/*'; fileIn.click(); } }, icon('image', 20), 'صورة'),
        h('button', { class: 'btn ghost', onclick: () => { fileIn.accept = 'video/*'; fileIn.click(); } }, icon('video', 20), 'فيديو'), fileIn),
      h('p', { class: 'muted small' }, 'الصور حتى 15 ميغابايت، والفيديو حتى 50 ميغابايت.')));
  set(mode);
  if (pending.file) { file = pending.file; pending.file = null; previewUrl = URL.createObjectURL(file); paintPrev(); }
  return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
}
