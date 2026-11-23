export const SUPABASE_URL = 'https://zjxpsjgqtfoianxafsue.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_gc1eKYFLfgbPBSeSYrBKQw_kJhsfywp';
export const LOGIN_DOMAIN = 'm17.app';
export const POLL_CHAT_MS = 3000;
export const POLL_BADGE_MS = 8000;
// WebRTC: STUN + a public TURN relay (best effort, helps behind strict NAT / mobile carriers)
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
