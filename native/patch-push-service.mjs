import fs from 'node:fs';

const path = 'node_modules/@capacitor/push-notifications/android/src/main/java/com/capacitorjs/plugins/pushnotifications/MessagingService.java';
if (!fs.existsSync(path)) throw new Error('Capacitor MessagingService.java not found: ' + path);
let source = fs.readFileSync(path, 'utf8');
const marker = 'com.m17.social.IncomingCallNotification.show(this, remoteMessage);';
if (!source.includes(marker)) {
  const needle = 'super.onMessageReceived(remoteMessage);';
  if (!source.includes(needle)) throw new Error('Unexpected Capacitor MessagingService source; refusing unsafe patch');
  source = source.replace(needle, needle + '\n        ' + marker);
  fs.writeFileSync(path, source);
}
if (!source.includes(marker)) throw new Error('Incoming-call handler patch verification failed');
console.log('Patched Capacitor FCM service for native incoming-call UI');
