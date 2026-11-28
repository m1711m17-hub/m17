package com.m17.social;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioRoutePlugin.class);
        registerPlugin(NotificationSoundPlugin.class);
        registerPlugin(UpdateInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
