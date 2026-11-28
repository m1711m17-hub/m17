package com.capacitorjs.plugins.pushnotifications;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {
    private String callId, kind, callerId;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(12, 17, 29));
        getWindow().setNavigationBarColor(Color.rgb(12, 17, 29));
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setFinishOnTouchOutside(false);

        Intent source = getIntent();
        callId = source.getStringExtra("m17_incoming_call_id");
        kind = source.getStringExtra("m17_incoming_call_type");
        callerId = source.getStringExtra("m17_incoming_caller_id");
        String title = source.getStringExtra("m17_incoming_title");
        String body = source.getStringExtra("m17_incoming_body");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(40), dp(28), dp(40));
        root.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.rgb(14, 22, 40), Color.rgb(5, 9, 18)}));

        TextView brand = label("NEXORA", 15, 0xff9ca9c2, Typeface.BOLD);
        TextView incoming = label("مكالمة واردة", 18, Color.WHITE, Typeface.NORMAL);
        TextView avatar = label("☎", 54, Color.WHITE, Typeface.BOLD);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(0xff263958);
        avatar.setBackground(circle);
        avatar.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams avatarLp = new LinearLayout.LayoutParams(dp(116), dp(116));
        avatarLp.setMargins(0, dp(34), 0, dp(26));
        root.addView(brand);
        root.addView(incoming);
        root.addView(avatar, avatarLp);
        root.addView(label(title == null || title.isEmpty() ? "مستخدم يتصل بك" : title, 27, Color.WHITE, Typeface.BOLD));
        root.addView(label(body == null || body.isEmpty() ? ("video".equals(kind) ? "مكالمة فيديو" : "مكالمة صوتية") : body,
            15, 0xffb9c4d8, Typeface.NORMAL));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.CENTER);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams buttonsLp = new LinearLayout.LayoutParams(-1, dp(64));
        buttonsLp.setMargins(0, dp(78), 0, 0);
        TextView reject = action("رفض", 0xffe34d59);
        TextView answer = action("رد", 0xff19b56b);
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(0, -1, 1);
        buttonLp.setMargins(dp(8), 0, dp(8), 0);
        buttons.addView(reject, buttonLp);
        buttons.addView(answer, buttonLp);
        root.addView(buttons, buttonsLp);
        setContentView(root);

        reject.setOnClickListener(v -> continueInApp("reject"));
        answer.setOnClickListener(v -> continueInApp("answer"));
    }

    private TextView label(String value, int size, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, style); view.setGravity(Gravity.CENTER);
        return view;
    }
    private TextView action(String value, int color) {
        TextView view = label(value, 19, Color.WHITE, Typeface.BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color); bg.setCornerRadius(dp(32));
        view.setBackground(bg);
        return view;
    }
    private int dp(int value) { return (int)(value * getResources().getDisplayMetrics().density + 0.5f); }

    private void continueInApp(String action) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) { finish(); return; }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("m17_incoming_call_id", callId);
        launch.putExtra("m17_incoming_call_type", kind);
        launch.putExtra("m17_incoming_caller_id", callerId);
        launch.putExtra("m17_incoming_action", action);
        startActivity(launch);
        finish();
    }
}