import { h, icon, clear, toast } from '../lib/dom.js';
import { sb, state, uploadMedia, uploadAudio, feature } from '../api.js';
import { headerBar } from './home.js';
import { pending } from './quickcompose.js';
import { STORY_BGS, bgCss, VIS_LABEL } from './stories.js';
import { pickPeople } from './people.js';

export function composePage(root, params) {
  let mode = params.story ? 'story' : 'post';
  let sKind = 'media';                       // story: 'media' | 'text'
  let file = null, previewUrl = null, music = null, bg = 'g1';
  let vis = ['everyone', 'followers', 'custom'].includes(state.me.story_default) ? state.me.story_default : 'everyone';
  let allowed = new Set();
  const text = h('textarea', { class: 'input big', rows: 5, maxlength: 2000, placeholder: 'بماذا تفكر؟' });
  const overlay = h('input', { class: 'input', maxlength: 120, placeholder: 'نص فوق الصورة/الفيديو (اختياري)' });
  const textStory = h('textarea', { class: 'sv-compose-text', rows: 5, maxlength: 280, placeholder: 'اكتب حالتك...' });
  const prev = h('div', { class: 'media-prev' });
  const fileIn = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onchange: () => {
    const f = fileIn.files[0]; if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return toast('اختر صورة أو فيديو', 'err');
    file = f; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(f); paintPrev();
  } });
  const musicIn = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' }, onchange: () => {
    const f = musicIn.files[0]; musicIn.value = ''; if (!f) return;
    if (!/^audio\//.test(f.type)) return toast('اختر ملفاً صوتياً', 'err');
    if (f.size > 10 * 1024 * 1024) return toast('حجم الملف الصوتي كبير (الحد 10 ميغابايت)', 'err');
    music = { file: f, title: f.name.replace(/\.[^.]+$/, '').slice(0, 60) }; paintMusic();
  } });
  const bar = h('div', { class: 'progress', style: { display: 'none' } }, h('i'));
  const publish = h('button', { class: 'btn primary lg', onclick: submit }, 'نشر');
  const tabP = h('button', { class: 'seg-btn', onclick: () => set('post') }, 'منشور');
  const tabS = h('button', { class: 'seg-btn', onclick: () => set('story') }, 'حالة (24 ساعة)');
  const kMedia = h('button', { class: 'seg-btn', onclick: () => setKind('media') }, 'صورة / فيديو');
  const kText = h('button', { class: 'seg-btn', onclick: () => setKind('text') }, 'نص');
  const storyBox = h('div', { class: 'story-opts' });
  const textBox = h('div', { class: 'sv-compose', style: { display: 'none' } });
  const musicBox = h('div', { class: 'music-box' });
  const visBox = h('div', { class: 'vis-box' });
  const mediaBtns = h('div', { class: 'row gap' }, h('button', { class: 'btn ghost', onclick: () => { fileIn.accept = 'image/*'; fileIn.click(); } }, icon('image', 20), 'صورة'),
    h('button', { class: 'btn ghost', onclick: () => { fileIn.accept = 'video/*'; fileIn.click(); } }, icon('video', 20), 'فيديو'), fileIn);

  function paintPrev() {
    clear(prev);
    if (!file) return;
    prev.append(file.type.startsWith('video/') ? h('video', { src: previewUrl, controls: true, playsinline: true }) : h('img', { src: previewUrl, alt: '' }),
      overlay.value && mode === 'story' ? h('div', { class: 'sv-overlay static' }, overlay.value) : null,
      h('button', { class: 'icon-btn prev-x', 'aria-label': 'إزالة', onclick: () => { file = null; fileIn.value = ''; paintPrev(); } }, icon('close', 18)));
  }
  function paintMusic() {
    clear(musicBox);
    if (!music) { musicBox.append(h('button', { class: 'btn ghost', onclick: () => musicIn.click() }, icon('music', 20), 'إضافة موسيقى'), musicIn); return; }
    const title = h('input', { class: 'input', value: music.title, maxlength: 60, placeholder: 'اسم المقطع', oninput: () => { music.title = title.value; } });
    musicBox.append(h('div', { class: 'row gap' }, h('span', { class: 'music-ico' }, icon('music', 18)), title, h('button', { class: 'icon-btn', 'aria-label': 'إزالة الموسيقى', onclick: () => { music = null; paintMusic(); } }, icon('close', 18))), musicIn);
  }
  function paintVis() {
    clear(visBox);
    visBox.append(h('div', { class: 'muted small' }, 'من يستطيع رؤية الحالة؟'), h('div', { class: 'chips' }, Object.entries(VIS_LABEL).map(([k, l]) => h('button', { class: 'chip' + (vis === k ? ' on' : ''), onclick: async () => {
      vis = k; if (k === 'custom') { const r = await pickPeople('اختر من يرى الحالة', allowed); if (r) allowed = r; if (!allowed.size) { toast('اختر شخصاً واحداً على الأقل', 'err'); } }
      paintVis();
    } }, l + (k === 'custom' && allowed.size ? ` (${allowed.size})` : '')))),
      h('div', { class: 'muted small' }, 'يمكنك إخفاء حالاتك عن أشخاص محددين من الإعدادات ← خصوصية الحالات.'));
  }
  function paintBg() {
    clear(textBox);
    textBox.style.background = bgCss(bg);
    textBox.append(textStory, h('div', { class: 'bg-picks' }, Object.keys(STORY_BGS).map((k) => h('button', { class: 'bg-pick' + (bg === k ? ' on' : ''), 'aria-label': 'خلفية', style: { background: STORY_BGS[k] }, onclick: () => { bg = k; paintBg(); } }))));
  }
  function setKind(k) {
    sKind = k; kMedia.classList.toggle('on', k === 'media'); kText.classList.toggle('on', k === 'text');
    textBox.style.display = k === 'text' ? '' : 'none'; mediaBtns.style.display = k === 'media' ? '' : 'none'; prev.style.display = k === 'media' ? '' : 'none';
    overlay.style.display = k === 'media' ? '' : 'none'; text.style.display = k === 'media' ? '' : 'none';
  }
  function set(m) {
    mode = m; tabP.classList.toggle('on', m === 'post'); tabS.classList.toggle('on', m === 'story');
    storyBox.style.display = m === 'story' ? '' : 'none';
    text.placeholder = m === 'post' ? 'بماذا تفكر؟' : 'أضف تعليقاً على حالتك (اختياري)';
    text.maxLength = m === 'post' ? 2000 : 200; text.rows = m === 'post' ? 5 : 2;
    if (m === 'post') { mediaBtns.style.display = ''; prev.style.display = ''; text.style.display = ''; overlay.style.display = 'none'; textBox.style.display = 'none'; }
    else setKind(sKind);
    paintPrev();
  }
  overlay.addEventListener('input', paintPrev);

  async function submit() {
    const body = text.value.trim();
    if (mode === 'post' && !feature('posts')) return toast('النشر متوقف حالياً', 'err');
    if (mode === 'story' && !feature('stories')) return toast('الحالات متوقفة حالياً', 'err');
    if (mode === 'story' && sKind === 'media' && !file) return toast('اختر صورة أو فيديو للحالة', 'err');
    if (mode === 'story' && sKind === 'text' && !textStory.value.trim()) return toast('اكتب نص الحالة', 'err');
    if (mode === 'story' && vis === 'custom' && !allowed.size) return toast('اختر الأشخاص الذين يرون الحالة', 'err');
    if (mode === 'post' && !body && !file) return toast('اكتب شيئاً أو أضف وسائط', 'err');
    publish.disabled = true; publish.classList.add('loading'); bar.style.display = '';
    bar.firstChild.style.width = '30%';
    try {
      if (mode === 'post') {
        const media = file ? await uploadMedia('posts', file) : null;
        bar.firstChild.style.width = '80%';
        await sb.from('posts').insert({ author_id: state.me.id, body, media_url: media?.url || null, media_type: media?.type || null });
      } else {
        const row = { author_id: state.me.id, visibility: vis };
        if (sKind === 'text') Object.assign(row, { kind: 'text', text_content: textStory.value.trim(), bg });
        else { const media = await uploadMedia('stories', file); Object.assign(row, { kind: 'media', media_url: media.url, media_type: media.type, caption: body || null, overlay_text: overlay.value.trim() || null }); }
        if (music) { bar.firstChild.style.width = '60%'; const ext = (music.file.type.split('/')[1] || 'mp3').replace('mpeg', 'mp3').replace('x-m4a', 'm4a').split(';')[0]; row.music_url = await uploadAudio('stories', music.file, ext); row.music_title = music.title || null; }
        bar.firstChild.style.width = '80%';
        const created = await sb.from('stories').insert(row).select('id');
        const sid = created?.[0]?.id;
        if (vis === 'custom' && sid) await sb.from('story_allowed').insert([...allowed].map((u) => ({ story_id: sid, user_id: u })));
      }
      bar.firstChild.style.width = '100%';
      toast(mode === 'post' ? 'تم نشر المنشور' : 'تمت إضافة الحالة', 'ok');
      location.hash = '#/home';
    } catch (e) { toast(e.message, 'err'); bar.style.display = 'none'; }
    finally { publish.disabled = false; publish.classList.remove('loading'); }
  }
  storyBox.append(h('div', { class: 'seg' }, kMedia, kText), textBox, musicBox, visBox);
  root.append(headerBar('نشر', { right: [publish] }),
    h('div', { class: 'page' }, h('div', { class: 'seg' }, tabP, tabS), storyBox,
      h('div', { class: 'row gap top' }, text), overlay, prev, bar, mediaBtns,
      h('p', { class: 'muted small' }, 'الصور حتى 15 ميغابايت، والفيديو حتى 50 ميغابايت.')));
  paintMusic(); paintVis(); paintBg(); set(mode);
  if (pending.file) { file = pending.file; pending.file = null; sKind = 'media'; setKind('media'); previewUrl = URL.createObjectURL(file); paintPrev(); }
  return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
}
