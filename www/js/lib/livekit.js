// LiveKit (SFU) helpers for LIVE. The client SDK is copied into js/vendor/ by the CI build; if it is missing or LiveKit is
// not configured, everything returns null/false and the app keeps using the peer-to-peer path (max 6 viewers).
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { sb } from '../api.js';

let mod;
export async function loadLK() {
  if (mod !== undefined) return mod || null;
  try { mod = await import('../vendor/livekit-client.esm.mjs'); } catch { mod = false; }
  return mod || null;
}
export async function lkToken(liveId, role) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/livekit-token`, { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (sb.session?.access_token || SUPABASE_KEY) },
      body: JSON.stringify({ live_id: liveId, role }) });
    clearTimeout(t); return await r.json();
  } catch { return null; }
}
export const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
export const dec = (b) => new TextDecoder().decode(b);
