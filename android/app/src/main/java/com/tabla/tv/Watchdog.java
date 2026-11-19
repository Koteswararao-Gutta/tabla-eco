package com.tabla.tv;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;

/**
 * Brings Tabla back to the front when something else is showing: when the screen turns on, when the
 * device is unlocked, and every ~5 minutes (an inexact alarm that never wakes a sleeping device, so it
 * costs almost no battery). Mainly for Fire TV, where Tabla cannot be the home app.
 *
 * On Android 10 and newer, an app in the background may only open itself if it has the
 * "Display over other apps" permission (the device setup guide grants it). Without it the attempt is
 * simply ignored by the system.
 *
 * It never acts on the manager app (a phone). It stays quiet while the screen hasn't been chosen yet, and for 30 minutes after the screen chooser
 * was opened (Back 5 times), so the owner can change settings without being pulled back.
 */
public class Watchdog extends BroadcastReceiver {
    static final long EVERY_MS = 5 * 60_000;
    static final long QUIET_MS = 30 * 60_000;

    /** True while MainActivity is the screen in front (set in its onResume / onPause). */
    static volatile boolean inFront;
    private static boolean screenEventsHeard;

    /** Safe to call many times: the alarm is replaced, the screen listener is added once. */
    static void start(Context context) {
        Context app = context.getApplicationContext();
        try {
            AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent tick = PendingIntent.getBroadcast(app, 0, new Intent(app, Watchdog.class), flags);
            if (am != null) {
                am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + EVERY_MS, EVERY_MS, tick);
            }
        } catch (Exception ignored) {
            // No alarm: boot and screen-on still bring Tabla back.
        }
        // Screen on / unlock can't be listened for from the manifest, only while the app is running.
        synchronized (Watchdog.class) {
            if (screenEventsHeard) return;
            screenEventsHeard = true;
        }
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        try {
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(new Watchdog(), f, Context.RECEIVER_EXPORTED);
            else app.registerReceiver(new Watchdog(), f);
        } catch (Exception ignored) {
        }
    }

    /** Leave the owner alone for a while (the screen chooser is open, maybe going into settings). */
    static void quiet(Context context, boolean on) {
        prefs(context).edit().putLong("quietUntil", on ? System.currentTimeMillis() + QUIET_MS : 0).apply();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (inFront) return;
        SharedPreferences p = prefs(context);
        String screen = p.getString("screen", null);
        if (screen == null) return; // not set up yet
        if (screen.startsWith("manager")) return; // a manager phone is a normal phone: never take it over
        if (isQuiet(context)) return;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) return; // screen off: wait for it to come on
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (Exception ignored) {
            // The system refused (no "Display over other apps" permission); try again next time.
        }
    }

    /** True for 30 minutes after the screen chooser was opened. */
    static boolean isQuiet(Context context) {
        return System.currentTimeMillis() < prefs(context).getLong("quietUntil", 0);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences("tabla", Context.MODE_PRIVATE);
    }
}
