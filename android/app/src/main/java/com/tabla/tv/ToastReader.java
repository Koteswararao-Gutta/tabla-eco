package com.tabla.tv;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * Kitchen tablet only: once an hour, opens Tabla's Toast online ordering page in a hidden web view, the same
 * as a person opening it, and takes the menu data built into the page (window.__OO_STATE__). Toast blocks
 * cloud servers, so the tablet does this over the restaurant's internet. The result goes to the Tabla page
 * (window.tablaToastMenu), which sends it to the server.
 */
class ToastReader {
    static final String PAGE =
        "https://order.toasttab.com/online/tabla-indian-restaurant-phoenix-az-2501-w-happy-valley-rd-suite-50-1240";
    static final long FIRST_MS = 2 * 60_000;
    static final long EVERY_MS = 60 * 60_000;
    /** After a failed read, try again sooner (a slow network or a busy Toast page usually passes). */
    static final long RETRY_MS = 10 * 60_000;
    static final long GIVE_UP_MS = 90_000;
    static final long POLL_MS = 3_000;

    /** Gets a JavaScript string literal holding the report's JSON: {"menus":[...]} or {"error":"..."}. */
    interface Sink {
        void report(String jsStringLiteral);
    }

    /** Returns the page's menus as a JSON string, or null while they aren't there. */
    private static final String EXTRACT =
        "(function(){var s=window.__OO_STATE__;if(!s)return null;"
            + "var m=Object.keys(s).filter(function(k){return k.indexOf('Menu:')===0;})"
            + ".map(function(k){return s[k];}).filter(function(x){return x&&x.groups;});"
            + "return m.length?JSON.stringify({menus:m}):null;})()";

    private final Context context;
    private final Sink sink;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView view;
    private long startedAt;
    private int lastStatus;
    private boolean done;

    ToastReader(Context context, Sink sink) {
        this.context = context;
        this.sink = sink;
    }

    void start() {
        stop();
        handler.postDelayed(tick, FIRST_MS);
    }

    void stop() {
        handler.removeCallbacksAndMessages(null);
        finish();
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            handler.postDelayed(this, EVERY_MS); // replaced by send() with the right wait once this read ends
            read();
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    private void read() {
        finish();
        done = false;
        lastStatus = 0;
        startedAt = System.currentTimeMillis();
        view = new WebView(context);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBlockNetworkImage(true); // the menu data is in the page itself; no need for the photos
        // Look like the tablet's normal Chrome: some sites turn away Android's in-app web view ("; wv").
        s.setUserAgentString(s.getUserAgentString().replace("; wv", "").replaceAll(" Version/[\\d.]+", ""));
        // A view that is never shown has no size, and some pages never finish drawing without one.
        view.measure(
            android.view.View.MeasureSpec.makeMeasureSpec(1280, android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec(800, android.view.View.MeasureSpec.EXACTLY));
        view.layout(0, 0, 1280, 800);
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedHttpError(WebView v, WebResourceRequest req, WebResourceResponse res) {
                if (req.isForMainFrame()) lastStatus = res.getStatusCode();
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                handler.removeCallbacks(poll);
                handler.post(poll);
            }
        });
        view.loadUrl(PAGE);
        handler.postDelayed(giveUp, GIVE_UP_MS);
    }

    /** Looks for the menu data every few seconds until it's there or time is up. */
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (view == null || done) return;
            view.evaluateJavascript(EXTRACT, result -> {
                if (done) return;
                if (result != null && !"null".equals(result)) {
                    send(result, true); // already a JavaScript string literal
                } else if (System.currentTimeMillis() - startedAt < GIVE_UP_MS) {
                    handler.postDelayed(poll, POLL_MS);
                }
            });
        }
    };

    private final Runnable giveUp = () -> {
        if (done) return;
        String why = lastStatus >= 400
            ? "Toast page answered " + lastStatus + " on the kitchen tablet"
            : "Toast page had no menu on the kitchen tablet";
        send(JSONObject.quote("{\"error\":" + JSONObject.quote(why) + "}"), false);
    };

    private void send(String literal, boolean ok) {
        done = true;
        sink.report(literal);
        handler.post(this::finish);
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, ok ? EVERY_MS : RETRY_MS);
    }

    private void finish() {
        handler.removeCallbacks(poll);
        handler.removeCallbacks(giveUp);
        if (view != null) {
            view.stopLoading();
            view.destroy();
            view = null;
        }
    }
}
