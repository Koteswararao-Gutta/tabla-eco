package com.tabla.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.media.AudioManager;
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
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
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
 * Updater installs newer versions of this app by itself.
 * On the kitchen tablet it also reads the Toast menu once an hour (see ToastReader).
 * Pages can print (catering name tags) through window.TablaPrint, since a web view has no window.print().
 */
public class MainActivity extends Activity {
    static final String SITE = "https://koteswararao-gutta.github.io/tabla-eco/#/";
    /** Pages on this host and path stay inside the app; every other link opens outside (see openOutside). */
    static final String SITE_HOST = "koteswararao-gutta.github.io";
    static final String SITE_PATH = "/tabla-eco";
    static final String[][] SCREENS = {
        {"TV 1 (front, left)", "tv/1"},
        {"TV 2 (front, right)", "tv/2"},
        {"TV 3 (mirrors TV 1)", "tv/3"},
        {"TV 4 (mirrors TV 2)", "tv/4"},
        {"TV 5 (music)", "tv/5"},
        {"Kitchen tablet", "kitchen"},
        {"Front app (front staff phone)", "front"},
        {"Manager app", "manager"},
    };
    static final long RETRY_MS = 15_000;
    static final long CHECK_MS = 30 * 60_000;
    /** Older web viewers can't run the Tabla web app. */
    static final int MIN_CHROME = 93; // the web app uses Object.hasOwn (Chrome 93)

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private WebView web;
    private ToastReader toast;
    private boolean loadFailed;
    private int backPresses;
    private long firstBackAt;
    private long lastLoadAt;
    /** True while Android's print screen is open, so the watchdog leaves it alone. */
    private boolean printing;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("tabla", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            // Use the whole glass, even beside a camera notch, so no black strip shows where the bar was.
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        // Someone swiped the bars into view: hide them again after a moment (some tablets keep them otherwise).
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(flags -> {
            if ((flags & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) rehideSoon();
        });
        String screen = prefs.getString("screen", null);
        if (screen == null) showChooser();
        else showScreen(screen);
        handler.postDelayed(nightly, CHECK_MS);
        handler.postDelayed(() -> Updater.checkSoon(this), 2 * 60_000);
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
                finishSetup(route);
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

        if (!Updater.allowed(this)) {
            TextView note = new TextView(this);
            note.setText("To update itself, Tabla needs \"Install unknown apps\" allowed.");
            note.setTextSize(16);
            note.setTextColor(Color.DKGRAY);
            note.setPadding(0, dp(24), 0, dp(8));
            list.addView(note);
            Button allow = button("Allow automatic updates");
            allow.setOnClickListener(v -> openInstallSettings());
            list.addView(allow);
        }

        Button settings = button("Open device settings");
        settings.setOnClickListener(v -> openSettings());
        LinearLayout.LayoutParams slp = (LinearLayout.LayoutParams) settings.getLayoutParams();
        slp.topMargin = dp(24);
        list.addView(settings);

        String[] viewer = webViewer();
        TextView version = new TextView(this);
        version.setText("Web viewer: " + viewer[0] + "   ·   Tabla app: " + appVersion());
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

    /** On a TV device: give Tabla the settings that otherwise need a computer (see SelfSetup).
     *  Not on tablets or phones: their debugging doesn't listen on the network, and their own settings work. */
    private void finishSetup(String route) {
        boolean tv = SelfSetup.amazon() || getPackageManager().hasSystemFeature("android.software.leanback");
        if (!tv || SelfSetup.phone(route) || !SelfSetup.needed(this)) return;
        SelfSetup.run(this, route, message -> {
            if (isFinishing()) return;
            android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show();
        });
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

    private void openInstallSettings() {
        try {
            if (Build.VERSION.SDK_INT < 26) throw new IllegalStateException();
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            // Fire TV: Settings > My Fire TV > Developer options > Install unknown apps > Tabla.
            openSettings();
        }
    }

    private void openSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        } catch (Exception ignored) {
        }
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "unknown";
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

        // Links with target="_blank" or window.open() stay in this one view (no new windows), so they too
        // pass through shouldOverrideUrlLoading below.
        s.setSupportMultipleWindows(false);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new PrintBridge(), "TablaPrint");
        web.addJavascriptInterface(new AlarmBridge(), "TablaAlarm");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!loadFailed) lastLoadAt = System.currentTimeMillis();
            }

            // Phone, WhatsApp, maps and other sites open in their own app; only the Tabla site stays in here.
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openOutside(url); // Android 6 and older
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (!req.isForMainFrame()) return false; // e.g. inside the YouTube player on TV 5
                return openOutside(req.getUrl().toString());
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
        if ("kitchen".equals(route)) {
            toast = new ToastReader(this, report -> deliverToast(report, 1));
            toast.start();
        }
    }

    /**
     * A link that leaves the Tabla site (tel:, whatsapp:, intent:, mailto:, geo:, wa.me, Google Maps, any other
     * site): hand it to Android, which opens the phone app, WhatsApp, Maps or the browser. Returns true when it
     * was handed over (the web view stays on Tabla). Nothing installed for it: nothing happens.
     */
    private boolean openOutside(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (scheme.equals("about") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("javascript")) return false;
        if (scheme.equals("https") && SITE_HOST.equalsIgnoreCase(uri.getHost())
            && uri.getPath() != null && uri.getPath().startsWith(SITE_PATH)) return false; // the Tabla site itself
        try {
            Intent intent;
            if (scheme.equals("intent")) {
                intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null); // only apps that open links, never a hidden part of some app
                intent.setSelector(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                // e.g. WhatsApp not installed: an intent: link may name a web page to use instead.
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null && fallback.startsWith("https://")) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(fallback)));
            }
        } catch (Exception ignored) {
            // Nothing on this device opens it (or a bad link): stay on the Tabla page.
        }
        return true;
    }

    /** window.TablaPrint.print(name): opens Android's print screen for the page as it prints (letter paper). */
    private class PrintBridge {
        @JavascriptInterface
        public void print(String jobName) {
            handler.post(() -> {
                if (web == null) return;
                String name = jobName == null || jobName.trim().isEmpty() ? "Tabla" : jobName.trim();
                try {
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (pm == null) return;
                    printing = true;
                    Watchdog.quiet(MainActivity.this, true); // the print screen is another app: don't pull Tabla back over it
                    pm.print(name, web.createPrintDocumentAdapter(name),
                        new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.NA_LETTER).build());
                } catch (Exception e) {
                    printing = false;
                    Watchdog.quiet(MainActivity.this, false);
                }
            });
        }
    }

    /** window.TablaAlarm.loud(on): the kitchen's 1-hour alarm turns the volume all the way up while it rings,
     *  then puts it back to where it was. */
    private class AlarmBridge {
        private int before = -1;

        @JavascriptInterface
        public void loud(boolean on) {
            handler.post(() -> {
                try {
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am == null) return;
                    if (on) {
                        if (before < 0) before = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0);
                    } else if (before >= 0) {
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, before, 0);
                        before = -1;
                    }
                } catch (Exception ignored) {
                    // Do Not Disturb or a locked volume: the alarm still plays at the current volume.
                }
            });
        }
    }

    /** Hands the Toast menu report to the kitchen page, which sends it to the server. Retries if the page isn't ready. */
    private void deliverToast(String report, int attempt) {
        if (web == null) return;
        web.evaluateJavascript("window.tablaToastMenu ? window.tablaToastMenu(" + report + ") : false", ok -> {
            if (!"true".equals(ok) && attempt < 3) handler.postDelayed(() -> deliverToast(report, attempt + 1), 60_000);
        });
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
            Updater.checkSoon(MainActivity.this);
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
        if (toast != null) {
            toast.stop();
            toast = null;
        }
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

    /** Full screen: no status bar and no navigation bar. A swipe from the edge shows them for a moment only. */
    private void hideBars() {
        if (web == null) return; // the screen chooser keeps the bars, so the owner can reach settings
        handler.removeCallbacks(rehide);
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 30) {
            // Android 11+ tablets ignore the old flags above in some cases; this is the current way.
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    private final Runnable rehide = this::hideBars;

    private void rehideSoon() {
        handler.removeCallbacks(rehide);
        handler.postDelayed(rehide, 2500);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Watchdog.inFront = true;
        if (printing) {
            printing = false; // back from the print screen
            Watchdog.quiet(this, false);
        }
        String screen = prefs.getString("screen", null);
        if (web == null && screen != null && !Watchdog.isQuiet(this)) {
            // Chooser left open (e.g. the owner went into settings) and the quiet time is over: back to work.
            showScreen(screen);
        } else if (web != null) {
            hideBars(); // back from another app, the lock screen or standby
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
