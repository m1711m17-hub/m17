export const SUPABASE_URL = 'https://zjxpsjgqtfoianxafsue.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_gc1eKYFLfgbPBSeSYrBKQw_kJhsfywp';
export const LOGIN_DOMAIN = 'm17.app';
export const POLL_CHAT_MS = 3000;
export const POLL_BADGE_MS = 8000;

// Keep a stable fallback list. Fresh credentials from the Edge Function are placed first.
const BASE_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: ['turn:freestun.net:3478', 'turn:freestun.net:5349'], username: 'free', credential: 'free' },
  { urls: ['turn:turn.anyfirewall.com:443?transport=tcp'], username: 'webrtc', credential: 'webrtc' },
];
export const ICE_SERVERS = [...BASE_ICE_SERVERS];
export let ICE_SOURCE = 'static';
let iceAt = 0;

export async function refreshIce(maxMs = 3000) {
  if (Date.now() - iceAt < 20 * 60 * 1000) return ICE_SOURCE;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), maxMs);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/turn-credentials`, {
      signal: ctl.signal,
      headers: { apikey: SUPABASE_KEY },
    });
    if (!r.ok) return ICE_SOURCE;
    const d = await r.json();
    iceAt = Date.now();
    if (Array.isArray(d?.iceServers) && d.iceServers.length) {
      // Replace previous temporary credentials instead of accumulating duplicates on every refresh.
      ICE_SERVERS.splice(0, ICE_SERVERS.length, ...d.iceServers, ...BASE_ICE_SERVERS);
      ICE_SOURCE = typeof d.source === 'string' ? d.source : 'edge';
    }
  } catch {
    // Static STUN/TURN fallbacks remain available when the Edge Function is unreachable.
  } finally {
    clearTimeout(timer);
  }
  return ICE_SOURCE;
}
