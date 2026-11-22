// Minimal Supabase client (Auth + PostgREST + Storage + Edge Functions) built on fetch.
// No external dependency so the app works inside a Capacitor APK without a CDN.
const LS = 'm17.session';

export class ApiError extends Error {
  constructor(message, status, raw) { super(message); this.status = status; this.raw = raw; }
}

const AR_ERRORS = [
  [/invalid login credentials/i, 'اسم المستخدم أو كلمة المرور غير صحيحة'],
  [/jwt expired|invalid jwt/i, 'انتهت الجلسة، سجّل الدخول من جديد'],
  [/row-level security|permission denied/i, 'ليست لديك صلاحية لهذا الإجراء'],
  [/duplicate key/i, 'هذا العنصر موجود مسبقاً'],
  [/Failed to fetch|NetworkError|Load failed/i, 'تعذر الاتصال بالإنترنت'],
  [/user is banned|banned/i, 'هذا الحساب معطّل'],
  [/new password should be different/i, 'كلمة المرور الجديدة يجب أن تختلف عن القديمة'],
  [/Password should be at least/i, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'],
];
export function arabicError(msg) {
  const m = String(msg || '');
  for (const [re, ar] of AR_ERRORS) if (re.test(m)) return ar;
  return m || 'حدث خطأ غير متوقع';
}

export function createClient(url, key, loginDomain) {
  let session = null;
  let refreshing = null;
  const listeners = new Set();
  try { session = JSON.parse(localStorage.getItem(LS)); } catch { session = null; }

  function setSession(s) {
    session = s;
    try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch {}
    listeners.forEach((f) => f(s));
  }
  const normalize = (j) => ({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: j.user,
  });

  async function parse(r) {
    const text = await r.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return data;
  }
  function fail(r, data) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || r.statusText;
    return new ApiError(arabicError(msg), r.status, data);
  }

  async function fresh() {
    if (!session) return;
    if (session.expires_at * 1000 - Date.now() > 60000) return;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { apikey: key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: session.refresh_token }),
          });
          const d = await parse(r);
          if (!r.ok) {
            if (r.status >= 400 && r.status < 500) setSession(null);
            throw fail(r, d);
          }
          setSession(normalize(d));
        } finally { refreshing = null; }
      })();
    }
    await refreshing;
  }
  function headers(extra = {}) {
    const h = { apikey: key, ...extra };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }
  async function http(method, path, { query, body, prefer, raw } = {}) {
    await fresh();
    const h = headers(raw ? {} : { 'Content-Type': 'application/json' });
    if (prefer) h.Prefer = prefer;
    const r = await fetch(url + path + (query ? '?' + query : ''), {
      method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await parse(r);
    if (!r.ok) throw fail(r, data);
    return { data, headers: r.headers };
  }

  // ---------- query builder ----------
  const enc = encodeURIComponent;
  const val = (v) => (typeof v === 'string' && /[,()"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : String(v));
  class Q {
    constructor(table) { this.t = table; this.f = []; this.ord = []; this.method = 'GET'; this.prefer = []; this.sel = null; this.body = undefined; this.lim = null; this.off = null; this.conflict = null; }
    select(cols = '*') { this.sel = cols; return this; }
    insert(rows) { this.method = 'POST'; this.body = rows; return this; }
    update(patch) { this.method = 'PATCH'; this.body = patch; return this; }
    delete() { this.method = 'DELETE'; return this; }
    upsert(rows, onConflict, ignore = false) { this.method = 'POST'; this.body = rows; this.conflict = onConflict || null; this.prefer.push(ignore ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates'); return this; }
    _f(col, op, v) { this.f.push(`${enc(col)}=${op}.${enc(v)}`); return this; }
    eq(c, v) { return this._f(c, 'eq', v); }
    neq(c, v) { return this._f(c, 'neq', v); }
    gt(c, v) { return this._f(c, 'gt', v); }
    gte(c, v) { return this._f(c, 'gte', v); }
    lt(c, v) { return this._f(c, 'lt', v); }
    lte(c, v) { return this._f(c, 'lte', v); }
    is(c, v) { return this._f(c, 'is', v); }
    ilike(c, v) { this.f.push(`${enc(c)}=ilike.${enc(v)}`); return this; }
    in(c, arr) { this.f.push(`${enc(c)}=in.(${arr.map((x) => enc(val(x))).join(',')})`); return this; }
    or(expr) { this.f.push(`or=(${enc(expr).replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')').replace(/%3A/g, ':').replace(/%2A/g, '*')})`); return this; }
    order(c, { ascending = true } = {}) { this.ord.push(`${c}.${ascending ? 'asc' : 'desc'}`); return this; }
    limit(n) { this.lim = n; return this; }
    range(from, to) { this.off = from; this.lim = to - from + 1; return this; }
    _qs() {
      const p = [...this.f];
      if (this.sel) p.push(`select=${enc(this.sel).replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')').replace(/%2A/g, '*').replace(/%3A/g, ':').replace(/%21/g, '!')}`);
      if (this.ord.length) p.push(`order=${this.ord.join(',')}`);
      if (this.lim != null) p.push(`limit=${this.lim}`);
      if (this.off != null) p.push(`offset=${this.off}`);
      if (this.conflict) p.push(`on_conflict=${enc(this.conflict)}`);
      return p.join('&');
    }
    async exec() {
      const prefer = [...this.prefer];
      if (this.method !== 'GET') prefer.push(this.sel ? 'return=representation' : 'return=minimal');
      const { data } = await http(this.method, `/rest/v1/${this.t}`, { query: this._qs(), body: this.body, prefer: prefer.join(',') || undefined });
      return data;
    }
    async one() { this.lim = 1; const d = await this.exec(); return Array.isArray(d) ? d[0] || null : d; }
    async count() {
      await fresh();
      const r = await fetch(`${url}/rest/v1/${this.t}?${this._qs() || 'select=*'}`, { method: 'HEAD', headers: headers({ Prefer: 'count=exact' }) });
      if (!r.ok) throw new ApiError(arabicError(r.statusText), r.status);
      const cr = r.headers.get('content-range') || '';
      const n = parseInt(cr.split('/')[1], 10);
      return Number.isFinite(n) ? n : 0;
    }
    then(res, rej) { return this.exec().then(res, rej); }
    catch(rej) { return this.exec().catch(rej); }
    finally(fn) { return this.exec().finally(fn); }
  }

  return {
    url,
    get session() { return session; },
    get userId() { return session?.user?.id || null; },
    onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    from: (t) => new Q(t),
    async rpc(name, args = {}) { const { data } = await http('POST', `/rest/v1/rpc/${name}`, { body: args }); return data; },
    auth: {
      async signUp(username, password, displayName) {
        const r = await fetch(`${url}/functions/v1/signup`, {
          method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, display_name: displayName }),
        });
        const d = await parse(r);
        if (!r.ok) throw new ApiError(arabicError(d?.error || d?.message), r.status, d);
        return this.signIn(username, password);
      },
      async signIn(username, password) {
        const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `${username.trim().toLowerCase()}@${loginDomain}`, password }),
        });
        const d = await parse(r);
        if (!r.ok) throw fail(r, d);
        setSession(normalize(d));
        return session;
      },
      async signOut() {
        try { if (session) await fetch(`${url}/auth/v1/logout`, { method: 'POST', headers: headers() }); } catch {}
        setSession(null);
      },
      async updatePassword(password) { await http('PUT', '/auth/v1/user', { body: { password } }); },
    },
    storage: {
      publicUrl: (bucket, path) => `${url}/storage/v1/object/public/${bucket}/${path}`,
      async upload(bucket, path, file) {
        await http('POST', `/storage/v1/object/${bucket}/${path}`, { body: file, raw: true, prefer: undefined, query: '' }
        ).catch((e) => { throw e; });
        return `${url}/storage/v1/object/public/${bucket}/${path}`;
      },
      async remove(bucket, path) { await http('DELETE', `/storage/v1/object/${bucket}/${path}`); },
    },
  };
}
