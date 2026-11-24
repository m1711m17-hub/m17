// Native audio routing (speaker / earpiece). Uses the Capacitor runtime injected into the WebView (no bundler needed).
const cap = window.Capacitor;
export const AudioRoute = cap?.registerPlugin ? cap.registerPlugin('AudioRoute') : { setSpeaker: async () => {}, reset: async () => {} };
