import { h, icon, toast, clear } from '../lib/dom.js';
import { encodeGif } from '../lib/gif.js';

// Full-screen sticker creator: pick an image/video, cut a region by hand (lasso / circle / square / whole),
// pick a clip (start + length) for videos -> animated GIF sticker, or a PNG for images.
// onSave(blob, animated) uploads/saves and resolves when done.
export function openStickerMaker({ onSave }) {
  const ov = h('div', { class: 'sm-overlay' });
  let media = null, raf = 0, urlToFree = null, busy = false;
  const stopLoop = () => { cancelAnimationFrame(raf); raf = 0; if (media?.kind === 'video') media.el.pause(); };
  const close = () => { stopLoop(); if (urlToFree) URL.revokeObjectURL(urlToFree); if (ov.isConnected) ov.remove(); };
  ov.addEventListener('m17:back', () => { if (!busy) close(); });
  document.body.append(ov);

  const head = (title, onBack) => h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: onBack || close }, icon('close', 22)), h('div', { class: 'topbar-title' }, title));

  // ---------- step 1: choose source ----------
  const file = h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
  function stepPick() {
    stopLoop(); media = null;
    clear(ov).append(head('إنشاء ملصق اقتطاع'),
      h('div', { class: 'sm-pick' },
        h('div', { class: 'sm-pick-ic' }, icon('image', 44)),
        h('p', null, 'اختر صورة أو فيديو، ثم حدّد الجزء الذي تريده ملصقاً.'),
        h('p', { class: 'muted small' }, 'الفيديو يتحول إلى ملصق متحرك (حتى 3 ثوانٍ).'),
        h('button', { class: 'btn primary lg', onclick: () => file.click() }, 'اختيار من المعرض'), file));
  }
  file.onchange = async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    try {
      if (urlToFree) URL.revokeObjectURL(urlToFree);
      urlToFree = URL.createObjectURL(f);
      if (f.type.startsWith('image/')) {
        const img = new Image(); img.src = urlToFree; await img.decode();
        media = { kind: 'image', el: img, w: img.naturalWidth, h: img.naturalHeight, sourceBlob: f, isGif: f.type === 'image/gif' || f.type === 'image/webp' || /\.(gif|webp)$/i.test(f.name) };
      } else if (f.type.startsWith('video/')) {
        const v = h('video', { muted: true, playsinline: true, preload: 'auto', loop: false }); v.muted = true;
        v.src = urlToFree;
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('تعذّر قراءة الفيديو')); });
        if (!isFinite(v.duration) || !v.videoWidth) throw new Error('تعذّر قراءة الفيديو');
        media = { kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight, dur: v.duration };
      } else throw new Error('اختر صورة أو فيديو');
      stepEdit();
    } catch (e) { toast(e.message || 'تعذّر فتح الملف', 'err'); }
  };

  // ---------- step 2: edit ----------
  function stepEdit() {
    const BOX = Math.min(window.innerWidth - 24, 420), dpr = Math.min(2, window.devicePixelRatio || 1);
    const sc = Math.min(BOX / media.w, BOX / media.h), ow0 = media.w * sc, oh0 = media.h * sc, ox = (BOX - ow0) / 2, oy = (BOX - oh0) / 2;
    const cv = h('canvas', { class: 'sm-canvas', width: BOX * dpr, height: BOX * dpr, style: { width: BOX + 'px', height: BOX + 'px' } });
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    let mode = 'full', lasso = [], box = null, drawing = false;
    let start = 0, len = Math.min(2, media.dur || 2), animated = media.kind === 'video' || !!media.isGif;
    const MEDIA_RECT = { x0: ox, y0: oy, x1: ox + ow0, y1: oy + oh0 };

    const clamp = (p) => ({ x: Math.max(MEDIA_RECT.x0, Math.min(MEDIA_RECT.x1, p.x)), y: Math.max(MEDIA_RECT.y0, Math.min(MEDIA_RECT.y1, p.y)) });
    const bbox = () => {
      if (mode === 'lasso' && lasso.length > 7) { const xs = lasso.map((p) => p.x), ys = lasso.map((p) => p.y); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
      if ((mode === 'circle' || mode === 'square') && box) return { x0: Math.min(box.x0, box.x1), y0: Math.min(box.y0, box.y1), x1: Math.max(box.x0, box.x1), y1: Math.max(box.y0, box.y1) };
      return null;
    };
    const maskReady = () => { if (mode === 'full') return true; const b = bbox(); return !!b && b.x1 - b.x0 >= 12 && b.y1 - b.y0 >= 12; };
    function sub(c, map) {
      if (mode === 'lasso') { lasso.forEach((p, i) => { const q = map(p); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.closePath(); return; }
      const b = bbox(); const a = map({ x: b.x0, y: b.y0 }), z = map({ x: b.x1, y: b.y1 });
      if (mode === 'circle') { const rx = (z.x - a.x) / 2, ry = (z.y - a.y) / 2; c.moveTo((a.x + z.x) / 2 + rx, (a.y + z.y) / 2); c.ellipse((a.x + z.x) / 2, (a.y + z.y) / 2, rx, ry, 0, 0, Math.PI * 2); c.closePath(); return; }
      const r = Math.min(z.x - a.x, z.y - a.y) * 0.14;
      c.moveTo(a.x + r, a.y); c.arcTo(z.x, a.y, z.x, z.y, r); c.arcTo(z.x, z.y, a.x, z.y, r); c.arcTo(a.x, z.y, a.x, a.y, r); c.arcTo(a.x, a.y, z.x, a.y, r); c.closePath();
    }
    const path = (c, map) => { c.beginPath(); sub(c, map); };
    const ID = (p) => p;
    function paint() {
      ctx.clearRect(0, 0, BOX, BOX);
      ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, BOX, BOX);
      try { ctx.drawImage(media.el, ox, oy, ow0, oh0); } catch {}
      const show = mode === 'lasso' ? lasso.length > 1 : (mode !== 'full' && maskReady());
      if (show) {
        ctx.save(); ctx.fillStyle = 'rgba(5,8,20,.68)'; ctx.beginPath(); ctx.rect(0, 0, BOX, BOX); sub(ctx, ID); ctx.fill('evenodd'); ctx.restore();
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
        if (mode === 'lasso' && drawing) { ctx.beginPath(); lasso.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); } else path(ctx, ID);
        ctx.stroke(); ctx.restore();
      }
    }
    function tick() { paint(); if (media.kind === 'video' && animated) { const v = media.el; if (v.currentTime >= start + len - 0.03 || v.ended) v.currentTime = start; if (v.paused) v.play().catch(() => {}); } raf = requestAnimationFrame(tick); }

    const pos = (e) => { const r = cv.getBoundingClientRect(); return clamp({ x: ((e.clientX - r.left) / r.width) * BOX, y: ((e.clientY - r.top) / r.height) * BOX }); };
    cv.addEventListener('pointerdown', (e) => {
      if (mode === 'full' || busy) return; cv.setPointerCapture(e.pointerId); drawing = true; const p = pos(e);
      if (mode === 'lasso') lasso = [p]; else box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      syncUi();
    });
    cv.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); if (mode === 'lasso') { const l = lasso[lasso.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) > 2.5) lasso.push(p); } else { box.x1 = p.x; box.y1 = p.y; } });
    const up = () => { if (!drawing) return; drawing = false; if (mode === 'lasso' && lasso.length < 8) lasso = []; syncUi(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

    const chip = (label, key, ic) => h('button', { class: 'sm-chip' + (mode === key ? ' on' : ''), type: 'button', onclick: () => { mode = key; lasso = []; box = null; renderChips(); syncUi(); } }, ic ? icon(ic, 16) : null, label);
    const chips = h('div', { class: 'sm-chips' });
    const renderChips = () => clear(chips).append(chip('تحديد يدوي', 'lasso', 'edit'), chip('دائرة', 'circle'), chip('مربع', 'square'), chip('كامل', 'full'));
    renderChips();
    const hint = h('p', { class: 'muted small center sm-hint' });
    const saveBtn = h('button', { class: 'btn primary lg sm-save', type: 'button', onclick: save }, 'حفظ الملصق');

    // video clip controls
    let clipBox = null, startInput = null, lenChips = null;
    if (media.kind === 'video') {
      const maxStart = Math.max(0, media.dur - 0.5);
      startInput = h('input', { type: 'range', min: 0, max: maxStart, step: 0.05, value: 0, class: 'sm-range', 'aria-label': 'بداية المقطع', oninput: () => { start = +startInput.value; len = Math.min(len, Math.max(0.5, media.dur - start)); media.el.currentTime = start; paintLen(); } });
      lenChips = h('div', { class: 'sm-chips' });
      const paintLen = () => clear(lenChips).append(
        h('button', { class: 'sm-chip' + (!animated ? ' on' : ''), type: 'button', onclick: () => { animated = false; media.el.pause(); media.el.currentTime = start; paintLen(); } }, 'صورة ثابتة'),
        ...[1.5, 2, 3].filter((d) => d <= media.dur + 0.01 || d === 1.5).map((d) => h('button', { class: 'sm-chip' + (animated && Math.abs(len - d) < 0.01 ? ' on' : ''), type: 'button', onclick: () => { animated = true; len = Math.min(d, Math.max(0.5, media.dur - start)); media.el.currentTime = start; paintLen(); } }, `متحرك ${d}ث`)));
      paintLen();
      clipBox = h('div', { class: 'sm-clip' }, h('div', { class: 'muted small' }, 'اسحب لاختيار بداية المقطع'), startInput, lenChips);
    }

    function syncUi() {
      hint.textContent = media.isGif && mode !== 'full' ? 'للحفاظ على حركة GIF أو WebP، استخدم الملصق كاملاً دون اقتطاع.' : mode === 'full' ? (media.isGif ? 'سيتم حفظ الملف المتحرك الأصلي مع الحفاظ على الحركة.' : 'سيتم استخدام الصورة كاملة. اختر "تحديد يدوي" لاقتطاع جزء منها.')
        : mode === 'lasso' ? (maskReady() ? 'جاهز. أعد الرسم لتغيير التحديد.' : 'ارسم بإصبعك حول الشيء الذي تريد اقتطاعه.')
          : (maskReady() ? 'جاهز. اسحب من جديد لتغيير الحجم.' : 'اسحب على الصورة لتحديد المنطقة.');
      saveBtn.disabled = busy || !maskReady();
    }

    clear(ov).append(head('إنشاء ملصق اقتطاع', () => { if (!busy) stepPick(); }),
      h('div', { class: 'sm-body' }, h('div', { class: 'sm-stage' }, cv), hint, chips, clipBox,
        h('div', { class: 'sm-actions' }, saveBtn)));
    syncUi();
    if (media.kind === 'video') { media.el.currentTime = 0; }
    raf = requestAnimationFrame(tick);

    // ---------- render output ----------
    function geometry(maxSide) {
      const b = mode === 'full' ? MEDIA_RECT : bbox();
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0, k = maxSide / Math.max(bw, bh);
      return { b, k, w: Math.max(2, Math.round(bw * k)), h: Math.max(2, Math.round(bh * k)), sx: (b.x0 - ox) / sc, sy: (b.y0 - oy) / sc, sw: bw / sc, sh: bh / sc };
    }
    function renderTo(canvas, g) {
      const c = canvas.getContext('2d', { willReadFrequently: true }); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.clearRect(0, 0, g.w, g.h); c.save();
      if (mode !== 'full') { path(c, (p) => ({ x: (p.x - g.b.x0) * g.k, y: (p.y - g.b.y0) * g.k })); c.clip(); }
      c.drawImage(media.el, g.sx, g.sy, g.sw, g.sh, 0, 0, g.w, g.h); c.restore();
    }
    const seek = (v, t) => new Promise((res) => { const on = () => { v.removeEventListener('seeked', on); res(); }; v.addEventListener('seeked', on); v.currentTime = Math.min(t, Math.max(0, v.duration - 0.05)); setTimeout(res, 2000); });
    const toBlob = (cnv, type) => new Promise((res) => cnv.toBlob(res, type));

    async function save() {
      if (busy || !maskReady()) return;
      busy = true; saveBtn.disabled = true; stopLoop();
      const label = saveBtn.textContent;
      try {
        let blob, anim = false;
        if (media.kind === 'image' && media.isGif) {
          if (mode !== 'full') throw new Error('للحفاظ على حركة GIF أو WebP، اختر وضع كامل دون اقتطاع');
          blob = media.sourceBlob; anim = true;
        } else if (media.kind === 'image' || !animated) {
          if (media.kind === 'video') await seek(media.el, start);
          let g = geometry(512), out = h('canvas', { width: g.w, height: g.h }); renderTo(out, g);
          blob = await toBlob(out, 'image/png');
          if (blob && blob.size > 1.8 * 1024 * 1024) { g = geometry(360); out = h('canvas', { width: g.w, height: g.h }); renderTo(out, g); blob = await toBlob(out, 'image/png'); }
        } else {
          anim = true;
          const fps = 12, n = Math.max(6, Math.round(len * fps)), g = geometry(300), frames = [];
          for (let i = 0; i < n; i++) {
            saveBtn.textContent = `جارٍ الإنشاء ${i + 1}/${n}`;
            await seek(media.el, start + i / fps);
            const out = h('canvas', { width: g.w, height: g.h }); renderTo(out, g); frames.push(out);
          }
          let sizeSide = 300, bytes;
          for (let attempt = 0; attempt < 3; attempt++) {
            const k = sizeSide / 300, w = Math.max(2, Math.round(g.w * k)), hh = Math.max(2, Math.round(g.h * k));
            const data = frames.map((cnv) => { if (k === 1) return cnv.getContext('2d').getImageData(0, 0, g.w, g.h).data; const t = h('canvas', { width: w, height: hh }); const tc = t.getContext('2d', { willReadFrequently: true }); tc.imageSmoothingQuality = 'high'; tc.drawImage(cnv, 0, 0, w, hh); return t.getContext('2d').getImageData(0, 0, w, hh).data; });
            bytes = encodeGif(data, w, hh, Math.round(100 / fps));
            if (bytes.length <= 1.9 * 1024 * 1024) break;
            sizeSide = Math.round(sizeSide * 0.75);
          }
          if (bytes.length > 2 * 1024 * 1024) throw new Error('الملصق كبير جداً، اختر مقطعاً أقصر');
          blob = new Blob([bytes], { type: 'image/gif' });
        }
        if (!blob) throw new Error('تعذّر إنشاء الملصق');
        saveBtn.textContent = 'جارٍ الحفظ...';
        await onSave(blob, anim);
        busy = false; close();
      } catch (e) {
        toast(e.message || 'تعذّر إنشاء الملصق', 'err'); busy = false; saveBtn.textContent = label; syncUi();
        if (media?.kind === 'video' && animated && !raf) raf = requestAnimationFrame(tick);
        if (media?.kind === 'image' && !raf) raf = requestAnimationFrame(tick);
      }
    }
  }

  stepPick();
  return { close };
}
