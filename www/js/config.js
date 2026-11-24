export const SUPABASE_URL = 'https://zjxpsjgqtfoianxafsue.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_gc1eKYFLfgbPBSeSYrBKQw_kJhsfywp';
export const LOGIN_DOMAIN = 'm17.app';
export const POLL_CHAT_MS = 3000;
export const POLL_BADGE_MS = 8000;
// WebRTC: STUN + a public TURN relay (best effort, helps behind strict NAT / mobile carriers)
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: ['turn:freestun.net:3478', 'turn:freestun.net:5349'], username: 'free', credential: 'free' },
  { urls: ['turn:turn.anyfirewall.com:443?transport=tcp'], username: 'webrtc', credential: 'webrtc' },
];
// Dedicated TURN (Cloudflare/Metered) comes from the turn-credentials edge function when its secrets are set; it is put first.
export let ICE_SOURCE = 'static'; let iceAt = 0;
export async function refreshIce(maxMs = 3000) {
  if (Date.now() - iceAt < 20 * 60 * 1000) return ICE_SOURCE;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), maxMs);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/turn-credentials`, { signal: ctl.signal, headers: { apikey: SUPABASE_KEY } }); clearTimeout(t);
    const d = await r.json(); iceAt = Date.now();
    if (d?.iceServers?.length) { ICE_SERVERS.unshift(...d.iceServers); ICE_SOURCE = d.source; }
  } catch {}
  return ICE_SOURCE;
}
