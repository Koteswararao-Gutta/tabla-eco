package com.tabla.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens the Tabla screen when the TV or tablet finishes starting up, and after Tabla updated itself.
 *  Front and manager phones are left alone. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Watchdog.start(context); // alarms are cleared on restart (and on update)
        String screen = context.getSharedPreferences("tabla", Context.MODE_PRIVATE).getString("screen", "");
        if (screen.startsWith("manager") || screen.startsWith("front")) {
            return; // a phone: a normal phone, so Tabla never opens by itself (not on start-up, not after an update)
        }
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (Exception ignored) {
            // Some systems refuse; the app can still be opened from the home screen.
        }
    }
}
