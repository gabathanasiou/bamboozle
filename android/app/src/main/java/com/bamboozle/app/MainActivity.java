package com.bamboozle.app;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Hide Status Bar (Fullscreen)
        // This is the classic way to hide the status bar in Android
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        // Hide navigation bar as well if you want true "Immersive Mode"
        // For now, let's keep it to status bar as requested.
        View decorView = getWindow().getDecorView();
        int uiOptions = View.SYSTEM_UI_FLAG_FULLSCREEN;
        decorView.setSystemUiVisibility(uiOptions);

        // 2. Lock orientation for phones, allow for tablets
        // Tablets are typically defined as devices with smallest screen width >= 600dp
        boolean isTablet = getResources().getConfiguration().smallestScreenWidthDp >= 600;

        if (!isTablet) {
            // Lock phones to portrait
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        } else {
            // Allow rotation for tablets
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
        }
    }
}
