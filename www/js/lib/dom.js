// Tiny DOM helpers, icons, toasts, sheets, formatting.
// Native append() turns null into the text "null" and arrays into "[object ...]"; make it safe app-wide.
for (const m of ['append', 'prepend']) {
  const native = Element.prototype[m];
  Element.prototype[m] = function (...nodes) {
    return native.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false));
  };
}
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const P = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.3-9.2A5 5 0 0 1 12 6.6a5 5 0 0 1 9.3 4.2C19.5 15.4 12 20 12 20z"/>',
  comment: '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.3A8.4 8.4 0 1 1 21 11.5z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="m16 6-4-4-4 4M12 2v13"/>',
  send: '<path d="m22 2-11 11M22 2l-7 20-4-9-9-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-5-5L5 21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m22 8-6 4 6 4z"/>',
  back: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>',
  forward: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  selectall: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M17 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l9 5V5L7 10H4a1 1 0 0 0-1 1zM19 9a4 4 0 0 1 0 6"/>',
  toggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2.5 4 2.5S16 14 16 14M9 9.5h.01M15 9.5h.01"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  flip: '<path d="M20 7h-9a5 5 0 0 0-5 5v1M4 17h9a5 5 0 0 0 5-5v-1"/><path d="m17 4 3 3-3 3M7 20l-3-3 3-3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  live: '<circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  micoff: '<path d="m3 3 18 18"/><path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.9-.7"/><path d="M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>',
  videooff: '<path d="m3 3 18 18"/><path d="M16 11.5V8l6-3v14l-4-2M11 6H5a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h9a3 3 0 0 0 2-.8"/>',
  phoneoff: '<path d="M10.7 13.3a14 14 0 0 1-2.5-3.4L10 8.8 8.5 5H5a2 2 0 0 0-2 2c0 1.7.4 3.3 1.1 4.8"/><path d="m3 3 18 18"/><path d="M13 16.8c1.6.8 3.4 1.2 5 1.2a2 2 0 0 0 2-2v-3.5l-4-1.5"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 20h16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  'user-plus': '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
  'log-out': '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>',
  crown: '<path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/>',
  heartoff: '<path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-.5 1.2-1.4 2.6-2.8 3.9M3 3l18 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
};
export function icon(name, size = 22, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.9'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('class', 'ico ' + cls); s.innerHTML = P[name] || '';
  return s;
}

// -------- avatar with deterministic gradient fallback --------
const GRADS = [['#00c6ff', '#7b5cff'], ['#ff5ca8', '#ff9a3c'], ['#22d3a6', '#2f8cff'], ['#a855f7', '#ec4899'], ['#f59e0b', '#ef4444'], ['#06b6d4', '#8b5cf6']];
export function avatar(p, size = 44, ring = false) {
  const name = p?.display_name || p?.username || '?';
  const g = GRADS[[...(p?.username || name)].reduce((a, c) => a + c.charCodeAt(0), 0) % GRADS.length];
  const el = h('div', { class: 'avatar' + (ring ? ' ring' : ''), style: { width: size + 'px', height: size + 'px', fontSize: size * 0.4 + 'px', background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` } });
  if (p?.avatar_url) el.append(h('img', { src: p.avatar_url, alt: '', loading: 'lazy' }));
  else el.append(document.createTextNode([...name][0].toUpperCase()));
  return el;
}

// -------- toast / confirm / sheet --------
export function toast(msg, kind = '') {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}
export function sheet(title, build, { full = false } = {}) {
  const back = h('div', { class: 'sheet-back' });
  const body = h('div', { class: 'sheet-body' });
  const box = h('div', { class: 'sheet' + (full ? ' full' : '') },
    h('div', { class: 'sheet-grip' }),
    h('div', { class: 'sheet-head' }, h('b', null, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'إغلاق' }, icon('close', 20))),
    body);
  function close() { box.classList.add('out'); back.classList.add('out'); setTimeout(() => back.remove(), 220); }
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.append(box); document.body.append(back);
  build(body, close);
  return close;
}
export function confirmBox(message, okText = 'تأكيد', danger = false) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'sheet-back center' });
    const done = (v) => { back.remove(); resolve(v); };
    back.append(h('div', { class: 'dialog' }, h('p', null, message),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, 'إلغاء'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, okText))));
    document.body.append(back);
  });
}
export function actionSheet(title, actions) {
  return sheet(title, (body, close) => {
    actions.filter(Boolean).forEach((a) => body.append(h('button', { class: 'menu-item' + (a.danger ? ' danger' : ''), onclick: () => { close(); a.run(); } }, icon(a.icon || 'more', 20), a.label)));
  });
}

// -------- formatting --------
export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'الآن';
  if (s < 3600) return `منذ ${Math.floor(s / 60)} د`;
  if (s < 86400) return `منذ ${Math.floor(s / 3600)} س`;
  if (s < 86400 * 7) return `منذ ${Math.floor(s / 86400)} يوم`;
  return new Date(iso).toLocaleDateString('ar', { day: 'numeric', month: 'short' });
}
export function hhmm(iso) { return new Date(iso).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }); }
export function dayLabel(iso) {
  const d = new Date(iso), n = new Date();
  const diff = Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return diff === 0 ? 'اليوم' : diff === 1 ? 'أمس' : d.toLocaleDateString('ar', { day: 'numeric', month: 'long' });
}
export const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
export const roleLabel = { OWNER: 'المالك', ADMIN: 'مشرف عام', MODERATOR: 'مراقب', USER: 'مستخدم' };
export function badge(role) { return role && role !== 'USER' ? h('span', { class: 'role-badge ' + role }, roleLabel[role]) : null; }

// Official red verification mark; granted only by the account owner.
export function verifiedBadge(verified) {
  return verified ? h('span', { class: 'verified-badge', title: 'حساب موثّق بموافقة المالك', 'aria-label': 'حساب موثّق' }, '✓') : null;
}
