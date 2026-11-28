import { h, icon, clear, toast } from '../lib/dom.js';
import { sb, state } from '../api.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { headerBar } from './home.js';

const STARTER = 'أهلاً! أنا NEXORA 🤖\nكيف أقدر أساعدك اليوم؟';

export async function aiPage(root) {
  const messages = [{ role: 'assistant', content: STARTER }];
  const page = h('section', { class: 'page ai-page' });
  const feed = h('div', { class: 'ai-feed', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'input ai-input', rows: 1, placeholder: 'اكتب سؤالك هنا...', maxlength: 4000 });
  const send = h('button', { class: 'ai-send', type: 'button', 'aria-label': 'إرسال' }, icon('send', 20));
  const composer = h('div', { class: 'ai-composer' }, input, send);
  const status = h('div', { class: 'ai-status muted small' }, 'متصل بمساعد NEXORA الذكي');
  const quick = h('div', { class: 'ai-quick' });
  const suggestions = [
    ['✍️ اكتب منشوراً', 'ساعدني في كتابة منشور جذاب عن: '],
    ['🌍 ترجم نصاً', 'ترجم النص التالي إلى الإنجليزية مع الحفاظ على المعنى: '],
    ['💬 اقترح رداً', 'اقترح رداً لطيفاً ومناسباً على هذه الرسالة: '],
    ['📝 لخّص نصاً', 'لخّص النص التالي بنقاط واضحة: '],
  ];
  suggestions.forEach(([label, prompt]) => quick.append(h('button', { class: 'chip', type: 'button', onclick: () => { input.value = prompt; input.focus(); resize(); } }, label)));
  page.append(h('div', { class: 'ai-hero' },
    h('div', { class: 'ai-orb' }, icon('bolt', 30)),
    h('div', null, h('b', null, 'مساعدك الذكي'), h('div', { class: 'muted small' }, 'اسأل، اكتب، ترجم، أو اطلب المساعدة'))),
    quick, feed, status, composer);
  root.append(headerBar('NEXORA', { back: true }), page);

  // Keep the composer above Android/iOS soft keyboards inside Capacitor WebView.
  const viewport = window.visualViewport;
  const syncKeyboard = () => {
    if (!viewport) return;
    const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    page.style.setProperty('--ai-keyboard', keyboardHeight + 'px');
  };
  syncKeyboard();
  viewport?.addEventListener('resize', syncKeyboard);
  viewport?.addEventListener('scroll', syncKeyboard);
  window.addEventListener('resize', syncKeyboard);

  function resize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; }
  function bubble(role, text) {
    const item = h('article', { class: 'ai-message ' + (role === 'user' ? 'mine' : 'bot') });
    item.append(h('div', { class: 'ai-message-label' }, role === 'user' ? 'أنت' : 'NEXORA'),
      h('div', { class: 'ai-message-text' }, text));
    return item;
  }
  function paint() {
    clear(feed);
    messages.forEach((m) => feed.append(bubble(m.role, m.content)));
    feed.scrollTop = feed.scrollHeight;
  }
  paint();

  let busy = false;
  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (!sb.session?.access_token || !state.me) return toast('سجّل الدخول أولاً لاستخدام NEXORA', 'err');
    messages.push({ role: 'user', content: text });
    input.value = ''; resize(); paint();
    busy = true; send.disabled = true; status.textContent = 'يفكر الآن…';
    const waiting = h('div', { class: 'ai-thinking' }, h('i'), h('i'), h('i'), ' NEXORA يكتب');
    feed.append(waiting); feed.scrollTop = feed.scrollHeight;
    try {
      const response = await fetch(SUPABASE_URL + '/functions/v1/nexora-ai', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + sb.session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: messages.slice(-12).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'تعذر الاتصال بالمساعد الذكي');
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('وصل رد فارغ من المساعد');
      messages.push({ role: 'assistant', content: data.reply.trim() });
      if (messages.length > 13) messages.splice(1, messages.length - 13);
      paint();
      status.textContent = 'متصل بمساعد NEXORA الذكي';
    } catch (e) {
      messages.pop();
      paint();
      const message = e instanceof TypeError && /fetch/i.test(e.message)
        ? 'تعذّر الوصول إلى خادم NEXORA. قد تكون وظيفة المساعد غير منشورة أو أن إعدادات الاتصال تمنع الطلب.'
        : (e.message || 'حدث خطأ أثناء إرسال الرسالة');
      toast(message, 'err');
      status.textContent = 'تعذر الاتصال بالخادم — حاول مجدداً';
      input.value = text; resize();
    } finally {
      busy = false; send.disabled = false; input.focus();
    }
  }
  send.addEventListener('click', submit);
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  return () => { busy = false; viewport?.removeEventListener('resize', syncKeyboard); viewport?.removeEventListener('scroll', syncKeyboard); window.removeEventListener('resize', syncKeyboard); };
}
