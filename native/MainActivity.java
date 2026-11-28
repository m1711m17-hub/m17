package com.m17.social;

import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void prepareIncomingCallWindow(Intent intent) {
        if (intent == null || !intent.hasExtra("m17_incoming_call_id")) return;
        NotificationManager notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (notifications != null) notifications.cancel("m17_incoming_call", 17017);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        prepareIncomingCallWindow(getIntent());
        registerPlugin(AudioRoutePlugin.class);
        registerPlugin(NotificationSoundPlugin.class);
        registerPlugin(IncomingCallAccessPlugin.class);
        registerPlugin(UpdateInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        prepareIncomingCallWindow(intent);
    }
}
