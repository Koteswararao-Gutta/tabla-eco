package com.tabla.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Calendar;

/**
 * Tabla screen app: shows one screen of the Tabla web app full screen, forever.
 * First launch asks which screen this device is. Press Back 5 times quickly to choose again.
 * Recovers by itself from internet drops and browser crashes, and reloads once a night at 4 AM
 * to pick up updates.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://koteswararao-gutta.github.io/tabla-eco/#/";
    static final String[][] SCREENS = {
        {"TV 1 (front, left)", "tv/1"},
        {"TV 2 (front, right)", "tv/2"},
        {"TV 3 (mirrors TV 1)", "tv/3"},
        {"TV 4 (mirrors TV 2)", "tv/4"},
        {"TV 5 (music)", "tv/5"},
        {"Kitchen tablet", "kitchen"},
        {"Manager app", "manager/screens"},
    };
    static final long RETRY_MS = 15_000;
    static final long CHECK_MS = 30 * 60_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private WebView web;
    private boolean loadFailed;
    private int backPresses;
    private long firstBackAt;
    private int lastReloadDay = -1;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("tabla", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        String screen = prefs.getString("screen", null);
        if (screen == null) showChooser();
        else showScreen(screen);
        handler.postDelayed(nightly, CHECK_MS);
    }

    // ---------- choosing the screen ----------
    private void showChooser() {
        destroyWeb();
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setGravity(Gravity.CENTER_HORIZONTAL);
        list.setPadding(dp(32), dp(32), dp(32), dp(32));
        list.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("Which screen is this?");
        title.setTextSize(28);
        title.setTextColor(Color.BLACK);
        title.setPadding(0, 0, 0, dp(8));
        list.addView(title);

        TextView hint = new TextView(this);
        hint.setText("You can change it later: press Back 5 times quickly.");
        hint.setTextSize(16);
        hint.setTextColor(Color.DKGRAY);
        hint.setPadding(0, 0, 0, dp(16));
        list.addView(hint);

        Button first = null;
        for (String[] s : SCREENS) {
            Button b = button(s[0]);
            final String route = s[1];
            b.setOnClickListener(v -> {
                prefs.edit().putString("screen", route).apply();
                showScreen(route);
            });
            list.addView(b);
            if (first == null) first = b;
        }

        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            TextView note = new TextView(this);
            note.setText("To open by itself when the TV turns on, allow \"Display over other apps\" for Tabla.");
            note.setTextSize(16);
            note.setTextColor(Color.DKGRAY);
            note.setPadding(0, dp(24), 0, dp(8));
            list.addView(note);
            Button allow = button("Allow auto-start");
            allow.setOnClickListener(v -> openOverlaySettings());
            list.addView(allow);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.addView(list);
        setContentView(scroll);
        if (first != null) first.requestFocus();
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(20);
        b.setAllCaps(false);
        b.setMinHeight(dp(56));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(420), LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(4), 0, dp(4));
        b.setLayoutParams(lp);
        b.setFocusable(true);
        return b;
    }

    private void openOverlaySettings() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {
            }
        }
    }

    // ---------- showing the screen ----------
    @SuppressLint("SetJavaScriptEnabled")
    private void showScreen(String route) {
        destroyWeb();
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // TV 5 plays music without a tap
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " TablaScreen/1.0");
        s.setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                loadFailed = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) failed();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page crashed: start a fresh one instead of letting the app close.
                handler.post(() -> showScreen(prefs.getString("screen", "tv/1")));
                return true;
            }
        });
        setContentView(web);
        hideBars();
        web.loadUrl(SITE + route);
    }

    private void failed() {
        loadFailed = true;
        web.loadData("<html><body style='background:#000'></body></html>", "text/html", "utf-8");
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    private final Runnable retry = () -> {
        if (web == null || !loadFailed) return;
        web.getSettings().setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        web.loadUrl(SITE + prefs.getString("screen", "tv/1"));
    };

    /** Reloads once a night at 4 AM so screens pick up app updates and start fresh. */
    private final Runnable nightly = new Runnable() {
        @Override
        public void run() {
            Calendar c = Calendar.getInstance();
            int day = c.get(Calendar.DAY_OF_YEAR);
            if (web != null && c.get(Calendar.HOUR_OF_DAY) == 4 && day != lastReloadDay && online()) {
                lastReloadDay = day;
                web.clearCache(false);
                web.reload();
            }
            handler.postDelayed(this, CHECK_MS);
        }
    };

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    private void destroyWeb() {
        handler.removeCallbacks(retry);
        if (web != null) {
            web.destroy();
            web = null;
        }
    }

    // ---------- keys and full screen ----------
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            long now = System.currentTimeMillis();
            if (now - firstBackAt > 3000) {
                firstBackAt = now;
                backPresses = 0;
            }
            if (++backPresses >= 5) {
                backPresses = 0;
                showChooser();
            }
            return true; // Back never leaves the screen by accident
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && web != null) hideBars();
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        // Keep playing: this app is the only thing on the screen.
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        destroyWeb();
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
