package com.tabla.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import java.net.ConnectException;

/**
 * Gives Tabla, once, the settings that otherwise need a computer with adb, by talking to the device's
 * own ADB (see AdbSelf). Runs when a TV or kitchen screen is chosen, if anything is still missing:
 * - "Display over other apps": opens by itself when the TV turns on (Fire TV hides this setting)
 * - "Install unknown apps": updates itself
 * - no battery limits, so the 5-minute watchdog keeps running
 * - Tabla as the home app (not on Fire TV, which doesn't allow another home app)
 * Afterwards Updater can also install updates through ADB with no "Install?" question (Fire TV, Android 11
 * and older), as long as ADB debugging stays on.
 */
final class SelfSetup {
    interface Done {
        void done(String message);
    }

    private SelfSetup() {
    }

    static boolean amazon() {
        return "Amazon".equalsIgnoreCase(Build.MANUFACTURER);
    }

    /** True when ADB accepted Tabla's key on this device (so updates can install with no question). */
    static boolean adbReady(Context context) {
        return prefs(context).getBoolean("adbOk", false);
    }

    static void forget(Context context) {
        prefs(context).edit().putBoolean("adbOk", false).apply();
    }

    /** True when something is still missing that this can fix. */
    static boolean needed(Context context) {
        boolean overlay = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
        boolean quietUpdates = Build.VERSION.SDK_INT >= 31 || adbReady(context);
        return !overlay || !Updater.allowed(context) || !quietUpdates;
    }

    /** Connects (the TV may ask "Allow USB debugging?" once) and sets everything. Calls back on the main thread. */
    static void run(Context context, String screen, Done done) {
        Context app = context.getApplicationContext();
        Handler main = new Handler(Looper.getMainLooper());
        Watchdog.quiet(app, true); // the "Allow USB debugging?" box must not be covered while someone reads it
        new Thread(() -> {
            String message;
            try (AdbSelf adb = AdbSelf.connect("127.0.0.1", AdbSelf.PORT, app.getFilesDir(), 90_000)) {
                prefs(app).edit().putBoolean("adbOk", true).apply();
                String pkg = app.getPackageName();
                adb.shell("appops set " + pkg + " SYSTEM_ALERT_WINDOW allow");
                if (Build.VERSION.SDK_INT >= 26) adb.shell("appops set " + pkg + " REQUEST_INSTALL_PACKAGES allow");
                if (Build.VERSION.SDK_INT >= 23) adb.shell("dumpsys deviceidle whitelist +" + pkg);
                if (!amazon() && Build.VERSION.SDK_INT >= 24 && !phone(screen)) {
                    adb.shell("cmd package set-home-activity " + pkg + "/.MainActivity");
                }
                message = "Tabla is set up: it opens by itself when the TV turns on, and updates by itself.";
            } catch (ConnectException e) {
                message = amazon()
                    ? "To finish setup, turn on Settings > My Fire TV > Developer options > ADB debugging, then press Back 5 times and choose the screen again."
                    : "To finish setup, turn on USB debugging in Developer options, then press Back 5 times and choose the screen again.";
            } catch (AdbSelf.NotAllowed e) {
                message = "Setup not finished: the TV's question \"Allow USB debugging?\" was not allowed. Press Back 5 times and choose the screen again.";
            } catch (Throwable e) {
                message = "Setup could not finish (" + e.getClass().getSimpleName() + "). Press Back 5 times and choose the screen again.";
            }
            final String m = message;
            Watchdog.quiet(app, false);
            main.post(() -> done.done(m));
        }, "tabla-setup").start();
    }

    static boolean phone(String screen) {
        return screen != null && (screen.startsWith("manager") || screen.startsWith("front"));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences("tabla", Context.MODE_PRIVATE);
    }
}
