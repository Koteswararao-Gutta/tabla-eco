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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tabla screen app: shows one screen of the Tabla web app full screen, forever.
 * First launch asks which screen this device is. Press Back 5 times quickly to choose again.
 * Recovers by itself from internet drops and browser crashes, and reloads once a night at 4 AM
 * to pick up updates. Watchdog brings it back to the front if something else is showing.
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
        {"Manager app", "manager"},
    };
    static final long RETRY_MS = 15_000;
    static final long CHECK_MS = 30 * 60_000;
    /** Older web viewers can't run the Tabla web app. */
    static final int MIN_CHROME = 93; // the web app uses Object.hasOwn (Chrome 93)

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private WebView web;
    private boolean loadFailed;
    private int backPresses;
    private long firstBackAt;
    private long lastLoadAt;

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
        Watchdog.start(this);
    }

    // ---------- choosing the screen ----------
    private void showChooser() {
        destroyWeb();
        Watchdog.quiet(this, true); // the owner may go into settings from here
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
                Watchdog.quiet(this, false);
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

        Button settings = button("Open device settings");
        settings.setOnClickListener(v -> openSettings());
        LinearLayout.LayoutParams slp = (LinearLayout.LayoutParams) settings.getLayoutParams();
        slp.topMargin = dp(24);
        list.addView(settings);

        String[] viewer = webViewer();
        TextView version = new TextView(this);
        version.setText("Web viewer: " + viewer[0]);
        version.setTextSize(14);
        version.setTextColor(Color.DKGRAY);
        version.setPadding(0, dp(24), 0, 0);
        list.addView(version);
        int major = Integer.parseInt(viewer[1]);
        if (major > 0 && major < MIN_CHROME) {
            TextView old = new TextView(this);
            old.setText("This web viewer is too old for Tabla. Update \"Android System WebView\" (or Chrome) "
                + "from the app store, then restart the device.");
            old.setTextSize(18);
            old.setTextColor(Color.rgb(176, 0, 32));
            old.setPadding(0, dp(8), 0, 0);
            list.addView(old);
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

    private void openSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        } catch (Exception ignored) {
        }
    }

    /** {"Chrome 120.0.6099.230", "120"}, or {"unknown", "0"}. */
    private String[] webViewer() {
        try {
            Matcher m = Pattern.compile("Chrome/((\\d+)[\\d.]*)").matcher(WebSettings.getDefaultUserAgent(this));
            if (m.find()) return new String[] {"Chrome " + m.group(1), m.group(2)};
        } catch (Exception ignored) {
            // No web viewer installed at all.
        }
        return new String[] {"unknown", "0"};
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
                if (!loadFailed) lastLoadAt = System.currentTimeMillis();
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
        loadFailed = false;
        web.getSettings().setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        web.loadUrl(SITE + prefs.getString("screen", "tv/1"));
    };

    /**
     * Reloads once a day, after 4 AM, so screens pick up app updates and start fresh.
     * If the TV was off or asleep at 4 AM, it catches up as soon as it is on again.
     */
    private final Runnable nightly = new Runnable() {
        @Override
        public void run() {
            reloadIfStale();
            handler.postDelayed(this, CHECK_MS);
        }
    };

    private void reloadIfStale() {
        if (web == null || loadFailed || lastLoadAt == 0 || !online()) return;
        Calendar c = Calendar.getInstance();
        if (c.get(Calendar.HOUR_OF_DAY) < 4) c.add(Calendar.DAY_OF_YEAR, -1);
        c.set(Calendar.HOUR_OF_DAY, 4);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        if (lastLoadAt < c.getTimeInMillis()) {
            lastLoadAt = System.currentTimeMillis();
            web.clearCache(false);
            web.reload();
        }
    }

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
        Watchdog.inFront = true;
        String screen = prefs.getString("screen", null);
        if (web == null && screen != null && !Watchdog.isQuiet(this)) {
            // Chooser left open (e.g. the owner went into settings) and the quiet time is over: back to work.
            showScreen(screen);
        } else if (web != null) {
            web.onResume();
            reloadIfStale(); // TV woke from standby after missing the 4 AM reload
        }
    }

    @Override
    protected void onPause() {
        // Keep playing: this app is the only thing on the screen.
        Watchdog.inFront = false;
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
