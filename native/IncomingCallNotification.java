package com.capacitorjs.plugins.pushnotifications;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public final class IncomingCallNotification {
    private static final int NOTIFICATION_ID = 17017;
    private static final String TAG = "m17_incoming_call";

    private IncomingCallNotification() {}

    public static void show(Context context, RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"call".equals(data.get("type"))) return;
        String callId = data.get("call_id");
        if (callId == null || callId.isEmpty()) return;

        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (activityManager != null && activityManager.getRunningAppProcesses() != null) {
            for (ActivityManager.RunningAppProcessInfo process : activityManager.getRunningAppProcesses()) {
                if (context.getPackageName().equals(process.processName)
                    && process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) return;
            }
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        String channelId = data.get("channel_id");
        if (channelId == null || !channelId.matches("^m17_calls(_[a-z0-9_]{1,52})?$")) {
            channelId = "m17_calls";
        }
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channelId) == null) {
            NotificationChannel channel = new NotificationChannel(
                channelId, "مكالمات NEXORA", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("المكالمات الصوتية ومكالمات الفيديو الواردة");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("m17_incoming_call_id", callId);
        launch.putExtra("m17_incoming_call_type", data.get("kind"));
        launch.putExtra("m17_incoming_caller_id", data.get("actor_id"));

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(context, callId.hashCode(), launch, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, channelId)
            : new Notification.Builder(context);
        builder.setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(data.getOrDefault("title", "مكالمة واردة"))
            .setContentText(data.getOrDefault("body", "لديك مكالمة واردة"))
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setPriority(Notification.PRIORITY_MAX)
            .setOngoing(false)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setContentIntent(content)
            .setFullScreenIntent(content, true);
        if (Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(46000);

        Notification notification = builder.build();
        manager.notify(TAG, NOTIFICATION_ID, notification);
    }
}
