package com.tabla.tv;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Keeps the Tabla app itself up to date (the web app already updates by itself).
 *
 * A few times a day it reads tabla-version.json from the Tabla site. When that names a newer version,
 * it downloads tabla.apk and installs it over this app; Android only accepts it because it is signed
 * with the same key. Afterwards Android sends MY_PACKAGE_REPLACED and BootReceiver opens Tabla again.
 *
 * Android needs "Install unknown apps" allowed for Tabla once (the screen chooser offers a button).
 * On Android 12+ the update installs silently once Tabla has installed itself one time; on older
 * systems and Fire TV, Android asks "Install update?" and someone presses Install with the remote.
 */
public class Updater extends BroadcastReceiver {
    static final String BASE = "https://koteswararao-gutta.github.io/tabla-eco/";
    static final long EVERY_MS = 6 * 60 * 60_000L;
    /** If someone said no to the install question, ask again a day later, not every 6 hours. */
    static final long ASK_AGAIN_MS = 24 * 60 * 60_000L;
    private static volatile boolean busy;

    /** True when Android lets Tabla install updates of itself. */
    static boolean allowed(Context context) {
        if (Build.VERSION.SDK_INT >= 26) return context.getPackageManager().canRequestPackageInstalls();
        return true; // older Android: the "Unknown sources" setting used for the first install covers it
    }

    /** TVs and the kitchen tablet install updates only between these hours (local time), never during service. */
    static final int QUIET_FROM_HOUR = 3;
    static final int QUIET_TO_HOUR = 5;

    /** True when an update may install now: any time on a front or manager phone, 3 to 5 AM on TVs and the tablet. */
    static boolean goodTime(String screen, int hourOfDay) {
        if (screen != null && (screen.startsWith("manager") || screen.startsWith("front"))) return true;
        return hourOfDay >= QUIET_FROM_HOUR && hourOfDay < QUIET_TO_HOUR;
    }

    /** Checks at most every 6 hours; does nothing while a check or install is running.
     *  MainActivity calls this every 30 minutes, so TVs and the tablet get their turn between 3 and 5 AM. */
    static void checkSoon(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences p = prefs(app);
        long now = System.currentTimeMillis();
        if (!goodTime(p.getString("screen", null), Calendar.getInstance().get(Calendar.HOUR_OF_DAY))) return;
        if (busy || now - p.getLong("updateCheckedAt", 0) < EVERY_MS) return;
        if (Build.VERSION.SDK_INT < 21 || !allowed(app)) return;
        busy = true;
        p.edit().putLong("updateCheckedAt", now).apply();
        new Thread(() -> {
            try {
                run(app);
            } catch (Throwable ignored) {
                // No internet, site down, odd device: try again next time.
            } finally {
                busy = false;
            }
        }, "tabla-update").start();
    }

    private static void run(Context app) throws Exception {
        int latest = latestVersion();
        int installed = installedVersion(app);
        if (latest <= installed) return;
        SharedPreferences p = prefs(app);
        if (p.getInt("updateAskedFor", 0) == latest
            && System.currentTimeMillis() - p.getLong("updateAskedAt", 0) < ASK_AGAIN_MS) return;
        install(app, latest);
    }

    private static int latestVersion() throws Exception {
        HttpURLConnection c = open(BASE + "tabla-version.json?t=" + System.currentTimeMillis());
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) > 0 && out.size() < 10_000; ) out.write(buf, 0, n);
            Matcher m = Pattern.compile("\"versionCode\"\\s*:\\s*(\\d+)").matcher(out.toString("UTF-8"));
            return m.find() ? Integer.parseInt(m.group(1)) : 0;
        } finally {
            c.disconnect();
        }
    }

    @SuppressWarnings("deprecation")
    private static int installedVersion(Context app) throws Exception {
        PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
        return info.versionCode;
    }

    private static void install(Context app, int version) throws Exception {
        PackageInstaller installer = app.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(app.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int id = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(id);
        try {
            HttpURLConnection c = open(BASE + "tabla.apk?v=" + version);
            try (InputStream in = c.getInputStream();
                 OutputStream out = session.openWrite("tabla.apk", 0, -1)) {
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                session.fsync(out);
            } finally {
                c.disconnect();
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE; // Android fills in the result
            Intent result = new Intent(app, Updater.class).putExtra("version", version);
            PendingIntent done = PendingIntent.getBroadcast(app, 1, result, flags);
            session.commit(done.getIntentSender());
        } catch (Exception e) {
            session.abandon();
            throw e;
        } finally {
            session.close();
        }
    }

    /** Android's answer about the install. */
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) return;
        // Android wants someone to press Install. Show its question, and keep the watchdog from
        // pulling Tabla back over it for a while.
        Intent ask = intent.getParcelableExtra(Intent.EXTRA_INTENT);
        if (ask == null) return;
        prefs(context).edit()
            .putInt("updateAskedFor", intent.getIntExtra("version", 0))
            .putLong("updateAskedAt", System.currentTimeMillis())
            .apply();
        Watchdog.quiet(context, true);
        ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(ask);
        } catch (Exception ignored) {
        }
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20_000);
        c.setReadTimeout(60_000);
        c.setUseCaches(false);
        return c;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences("tabla", Context.MODE_PRIVATE);
    }
}
