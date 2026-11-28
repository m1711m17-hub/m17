import fs from 'node:fs';
import path from 'node:path';

const dir = 'node_modules/@capacitor/push-notifications/android/src/main/java/com/capacitorjs/plugins/pushnotifications';
const servicePath = path.join(dir, 'MessagingService.java');
const helperPath = path.join(dir, 'IncomingCallNotification.java');
if (!fs.existsSync(servicePath)) throw new Error('Capacitor MessagingService.java not found: ' + servicePath);
if (!fs.existsSync('native/IncomingCallNotification.java')) throw new Error('Native incoming call handler is missing');
fs.copyFileSync('native/IncomingCallNotification.java', helperPath);

let source = fs.readFileSync(servicePath, 'utf8');
const marker = 'IncomingCallNotification.show(this, remoteMessage);';
if (!source.includes(marker)) {
  const needle = 'super.onMessageReceived(remoteMessage);';
  if (!source.includes(needle)) throw new Error('Unexpected Capacitor MessagingService source; refusing unsafe patch');
  source = source.replace(needle, needle + '\n        ' + marker);
  fs.writeFileSync(servicePath, source);
}
if (!source.includes(marker) || !fs.existsSync(helperPath)) throw new Error('Incoming-call handler patch verification failed');
console.log('Patched Capacitor FCM service and installed native full-screen call handler');
