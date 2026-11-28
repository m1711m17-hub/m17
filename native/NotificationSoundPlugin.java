package com.m17.social;

import android.content.ContentValues;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.NotificationChannel;
import android.media.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "NotificationSound")
public class NotificationSoundPlugin extends Plugin {
    private static final String[] MESSAGE = {"soft", "crystal", "pulse", "classic", "calm"};
    private static final String[] CALL = {"moonlight", "cinema", "piano", "arabesque", "sunrise"};

    @PluginMethod
    public void setPresetSound(PluginCall call) {
        String kind = call.getString("kind", "message");
        String preset = call.getString("preset", "");
        if (!valid(kind, preset)) {
            call.reject("نغمة غير مدعومة");
            return;
        }
        String prefix = kind.equals("call") ? "m17_calls_" : "m17_default_";
        String channelId = prefix + preset;
        Uri uri = Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/nexora_" + preset);
        createChannel(channelId, kind, uri);
        JSObject result = new JSObject();
        result.put("channelId", channelId);
        call.resolve(result);
    }

    @PluginMethod
    public void setCustomSound(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("النغمات المخصصة للإشعارات تتطلب Android 10 أو أحدث");
            return;
        }
        String kind = call.getString("kind", "message");
        String encoded = call.getString("base64", "");
        String mime = call.getString("mimeType", "audio/mpeg");
        String fileName = call.getString("fileName", "NEXORA");
        if (!kind.equals("message") && !kind.equals("call")) {
            call.reject("نوع النغمة غير صالح");
            return;
        }
        try {
            int comma = encoded.indexOf(',');
            if (encoded.startsWith("data:") && comma >= 0) encoded = encoded.substring(comma + 1);
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > 1500 * 1024) {
                call.reject("حجم ملف النغمة غير صالح");
                return;
            }
            String hash = sha256(bytes).substring(0, 12);
            String ext = mime.contains("wav") ? ".wav" : mime.contains("ogg") ? ".ogg" : mime.contains("mp4") || mime.contains("m4a") ? ".m4a" : ".mp3";
            String channelId = (kind.equals("call") ? "m17_calls_custom_" : "m17_default_custom_") + hash;
            NotificationManager manager = (NotificationManager) getContext().getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26 && manager != null && manager.getNotificationChannel(channelId) != null) {
                JSObject existing = new JSObject(); existing.put("channelId", channelId); call.resolve(existing); return;
            }
            String name = "NEXORA_" + hash + ext;
            ContentValues values = new ContentValues();
            values.put(MediaStore.Audio.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Audio.Media.TITLE, fileName);
            values.put(MediaStore.Audio.Media.MIME_TYPE, mime);
            values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_NOTIFICATIONS + "/NEXORA");
            values.put(MediaStore.Audio.Media.IS_NOTIFICATION, 1);
            values.put(MediaStore.Audio.Media.IS_RINGTONE, 1);
            Uri uri = getContext().getContentResolver().insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("تعذر حفظ ملف النغمة");
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("تعذر كتابة ملف النغمة");
                out.write(bytes);
                out.flush();
            }
            try { getContext().grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) {}
            createChannel(channelId, kind, uri);
            JSObject result = new JSObject();
            result.put("channelId", channelId);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("تعذر تجهيز نغمة الإشعار: " + e.getMessage(), e);
        }
    }

    private boolean valid(String kind, String preset) {
        String[] choices = kind.equals("call") ? CALL : MESSAGE;
        if (!kind.equals("call") && !kind.equals("message")) return false;
        for (String choice : choices) if (choice.equals(preset)) return true;
        return false;
    }

    private void createChannel(String id, String kind, Uri sound) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) getContext().getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(id) != null) return;
        boolean isCall = kind.equals("call");
        NotificationChannel channel = new NotificationChannel(
            id,
            isCall ? "مكالمات NEXORA" : "رسائل وإشعارات NEXORA",
            isCall ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(isCall ? "نغمة المكالمات الواردة" : "نغمة إشعارات ورسائل التطبيق");
        channel.setSound(sound, new AudioAttributes.Builder()
            .setUsage(isCall ? AudioAttributes.USAGE_NOTIFICATION_RINGTONE : AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    private String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder out = new StringBuilder();
        for (byte b : digest) out.append(String.format(Locale.US, "%02x", b));
        return out.toString();
    }
}
