// Supabase Realtime client (Phoenix channels, protocol v1) – no dependencies, works in browser/WebView and Deno.
// Supports postgres_changes + broadcast. Auto-reconnects and re-joins channels; callers keep a polling fallback.
export function createRealtime({ url, key, getToken, WS }) {
  const WSImpl = WS || WebSocket;
  const wsUrl = url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(key) + '&vsn=1.0.0';
  const channels = new Map(); // topic -> channel
  const statusFns = new Set();
  let ws = null, ref = 0, hb = null, tokTimer = null, retry = 0, closedByUs = false, status = 'down', retryTimer = null;

  const setStatus = (s) => { if (s === status) return; status = s; statusFns.forEach((f) => { try { f(s); } catch {} }); };
  const send = (obj) => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; };
  const nextRef = () => String(++ref);

  function joinPayload(ch) {
    const cfg = { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false };
    cfg.postgres_changes = ch.pg.map((p) => ({ event: p.event || '*', schema: p.schema || 'public', table: p.table, ...(p.filter ? { filter: p.filter } : {}) }));
    return { config: cfg, access_token: getToken() };
  }
  function join(ch) {
    ch.joinRef = nextRef(); ch.joined = false; ch.ready = !ch.pg.length;
    send({ topic: ch.topic, event: 'phx_join', payload: joinPayload(ch), ref: ch.joinRef });
  }
  function onMessage(ev) {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    const ch = channels.get(m.topic);
    if (m.event === 'phx_reply' && ch && m.ref === ch.joinRef) {
      if (m.payload?.status === 'ok') { ch.joined = true; retry = 0; setStatus('connected'); ch.onJoin?.(); if (!ch.pg.length) ch.onReady?.(); }
      else { ch.joined = false; ch.lastError = JSON.stringify(m.payload?.response || m.payload); }
      return;
    }
    if (!ch) return;
    if (m.event === 'system') { if (m.payload?.extension === 'postgres_changes' && m.payload?.status === 'ok') { ch.ready = true; ch.onReady?.(); } return; }
    if (m.event === 'postgres_changes') {
      const d = m.payload?.data; if (!d) return;
      ch.pgHandlers.forEach((h) => { if ((!h.table || h.table === d.table) && (h.event === '*' || h.event === d.type)) h.fn(d); });
    } else if (m.event === 'broadcast') {
      const p = m.payload || {};
      (ch.bcHandlers.get(p.event) || []).forEach((fn) => fn(p.payload));
    } else if (m.event === 'phx_close' || m.event === 'phx_error') { ch.joined = false; setTimeout(() => { if (!closedByUs && channels.has(ch.topic)) join(ch); }, 1500); }
  }
  function open() {
    if (closedByUs || ws) return;
    setStatus('connecting');
    try { ws = new WSImpl(wsUrl); } catch { ws = null; return schedule(); }
    ws.onopen = () => {
      channels.forEach(join);
      clearInterval(hb); hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }), 25000);
      clearInterval(tokTimer); tokTimer = setInterval(() => channels.forEach((ch) => ch.joined && send({ topic: ch.topic, event: 'access_token', payload: { access_token: getToken() }, ref: nextRef() })), 5 * 60000);
    };
    ws.onmessage = onMessage;
    ws.onclose = () => { clearInterval(hb); clearInterval(tokTimer); ws = null; channels.forEach((c) => { c.joined = false; c.ready = false; }); setStatus('down'); schedule(); };
    ws.onerror = () => { try { ws && ws.close(); } catch {} };
  }
  function schedule() {
    if (closedByUs) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)));
  }

  return {
    get status() { return status; },
    onStatus(fn) { statusFns.add(fn); return () => statusFns.delete(fn); },
    connect() { closedByUs = false; open(); },
    reconnectNow() { if (!ws) { retry = 0; clearTimeout(retryTimer); open(); } },
    disconnect() { closedByUs = true; clearTimeout(retryTimer); clearInterval(hb); clearInterval(tokTimer); try { ws && ws.close(); } catch {} ws = null; channels.clear(); setStatus('down'); },
    // channel('name', { pg: [{ event, table, filter }] })
    channel(name, { pg = [] } = {}) {
      const topic = 'realtime:' + name;
      const ch = { topic, pg, pgHandlers: [], bcHandlers: new Map(), joined: false, joinRef: null };
      const api = {
        onPg(event, table, fn) { ch.pgHandlers.push({ event, table, fn }); return api; },
        onBroadcast(event, fn) { if (!ch.bcHandlers.has(event)) ch.bcHandlers.set(event, []); ch.bcHandlers.get(event).push(fn); return api; },
        onJoin(fn) { ch.onJoin = fn; return api; },
        onReady(fn) { ch.onReady = fn; return api; }, // fires when the server has really started streaming changes (use it to catch up via REST)
        get ready() { return ch.joined && ch.ready; },
        get joined() { return ch.joined; },
        get lastError() { return ch.lastError; },
        broadcast(event, payload) { return ch.joined && send({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: nextRef() }); },
        subscribe() { channels.set(topic, ch); if (ws && ws.readyState === 1) join(ch); return api; },
        unsubscribe() { channels.delete(topic); send({ topic, event: 'phx_leave', payload: {}, ref: nextRef() }); },
      };
      return api;
    },
  };
}
