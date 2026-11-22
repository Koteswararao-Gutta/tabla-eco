# Setting up the Tabla screens

One page for setting up each TV and the kitchen tablet. The app is **Tabla** (package `com.tabla.tv`).

- Web app: `https://koteswararao-gutta.github.io/tabla-eco/`
- Screen app download: `https://koteswararao-gutta.github.io/tabla-eco/tabla.apk`

## The devices

- 3 Vizio TVs, each with a **Google TV box** plugged in (HDMI)
- 2 **Fire TV Sticks**
- 1 **Android tablet** in the kitchen

Any TV screen (TV 1 to TV 5) can run on any of the TV devices; you pick it when Tabla first opens.

**Can a Vizio install the app by itself?** No. Vizio SmartCast TVs are not Android and cannot install `tabla.apk`. Use a Google TV box (for example Google TV Streamer, Chromecast with Google TV, or an onn. 4K box) on HDMI.

## Every device (do this first)

1. Connect to the restaurant Wi-Fi.
2. **Time zone: Arizona (Phoenix).** Settings > Date & time (Fire TV: Settings > Preferences > Time zone). Automatic time ON, time zone "Phoenix" / "Mountain Standard Time (Arizona)". Not "Denver" (Arizona has no daylight saving).
3. Check for system updates. The web viewer updates separately: on a Google TV box or the tablet, update **Android System WebView** (and Chrome) in the Play Store; on Fire TV it comes with the system update.

## Google TV box

1. **Allow the install:** Settings > System > About > click "Android TV OS build" 7 times (turns on developer options). Then Settings > Apps > Security & restrictions > Unknown sources: turn on for the app you download with (Downloader from the Play Store is easiest).
2. **Install:** open Downloader, type the download address above, install, Open.
3. **Choose the screen** (TV 1 to TV 5). The bottom of this page shows "Web viewer: Chrome N". If it shows a red "too old" warning, update **Android System WebView** in the Play Store and restart.
4. **Auto-start:** on the same page press "Allow auto-start" and turn on "Display over other apps" for Tabla (or Settings > Apps > Special app access > Display over other apps). If the box has no such setting, use a computer with adb (as for Fire TV below): `adb connect <box-ip>:5555`, then `adb shell appops set com.tabla.tv SYSTEM_ALERT_WINDOW allow`.
5. **Automatic updates:** on the same page press "Allow automatic updates" and turn it on for Tabla (Settings > Apps > Special app access > Install unknown apps > Tabla). The button is gone once it is allowed.
6. **Tabla as the home app (optional, best):** if pressing Home shows "Choose a home app", pick Tabla > Always. Most Google TV boxes don't ask; then, from a computer with adb: `adb shell cmd package set-home-activity com.tabla.tv/.MainActivity`. To undo it, uninstall Tabla.
7. **Never sleep:** Settings > System > Energy (or Power & energy) > "Turn off display" / "When inactive": Never. Settings > System > Ambient mode (screensaver): Off.
8. **On the Vizio:** Settings > System > Power Mode: Quick Start. Turn off Sleep Timer, Auto Power Off and any Eco / energy-saving mode. Keep CEC on (System > CEC) so the Vizio remote turns both on together.

## Fire TV Stick

Fire TV cannot use Tabla as its home app. Instead Tabla comes back by itself when the TV turns on, and within up to 10 minutes if someone leaves it.

**Check the model first:** the newest Fire TV Sticks running **Vega OS** (for example Fire TV Stick 4K Select) are not Android and cannot install `tabla.apk`. Use an Android-based Fire TV Stick or a Google TV box instead.

1. **Developer options:** Settings > My Fire TV > About > click the device name 7 times. Then My Fire TV > Developer options: turn on **ADB debugging**.
2. **Downloader:** search for "Downloader" (by AFTVnews) and install it. Settings > My Fire TV > Developer options > Install unknown apps > Downloader: ON.
3. **Install:** in Downloader, type the download address above, Install, Open. Choose the screen. Check the "Web viewer" line (see above; on Fire TV, update with My Fire TV > About > Check for updates).
4. **Auto-start (needed):** Fire TV hides "Display over other apps", so grant it from a computer on the same Wi-Fi. Find the IP in My Fire TV > About > Network, then:
   ```
   adb connect <fire-tv-ip>:5555
   adb shell appops set com.tabla.tv SYSTEM_ALERT_WINDOW allow
   ```
   Accept the "Allow USB debugging?" prompt on the TV the first time.
   **Automatic updates:** Settings > My Fire TV > Developer options > Install unknown apps > **Tabla**: ON.
5. **Never sleep:** Settings > Display & Sounds (or Display & Audio) > Screensaver: Start time **Never**, Sleep **Never**. Turn off any "Energy saver" / auto power-off. Settings > Display & Sounds > Power Controls / HDMI CEC Device Control: ON.
6. **On the TV itself:** turn off its own sleep timer, auto power-off and eco mode.

**TV 5 volume:** the music plays at full volume inside the app, so set loudness with the TV remote and leave it. Make sure the TV isn't muted.

## Android tablet (kitchen)

1. Settings > Apps > (your browser or Files app) > Install unknown apps: Allow. Open the download address above in Chrome and install.
2. Open Tabla, choose **Kitchen tablet**, press "Allow auto-start" and allow it, then "Allow automatic updates" and allow it.
3. **Tabla as home:** Settings > Apps > Default apps > Home app > Tabla.
4. Settings > Apps > Tabla > Battery: **Unrestricted** (not optimised). Display > Screen timeout: the longest. Security > Screen lock: **None** (so it comes back after a power cut).
5. **Sound:** the 1-hour reminder uses the **media** volume: turn media volume up. Keep **Do Not Disturb off** (if it must be on, allow media sounds). Leave the tablet plugged in.

## Phone alerts (manager phones)

Phones can get a 1-hour reminder before each catering order, a 9:00 AM "Today's catering" list (only on days with orders), and alerts when the kitchen changes an order or the Toast menu can't be read. Until at least one phone has alerts on, nobody gets these (the server logs an error each time).

1. **Once, for the whole app:** Firebase console > Project settings > **Cloud Messaging** > Web Push certificates > **Generate key pair**. Copy the key and put it in `vapidKey` in `src/shared/data/firebaseConfig.ts` (it is public, not a secret). While it is empty the app doesn't offer alerts.
2. **On each manager phone:** open the Manager app link in **Chrome** (Android) or add it to the Home Screen and open it from there (iPhone: Share > "Add to Home Screen"). Go to Catering and press **Turn on alerts**, then Allow.
3. The **Tabla Android app** (the one on the TVs and the kitchen tablet) can't get phone alerts. Use Chrome or the Home Screen app on phones.
4. Test: add an order due in a bit over 1 hour; the phone should buzz about 1 hour before.

## Backups

See [backups.md](backups.md): turn them on once, and how to get back a lost order or payment.

## Getting out of Tabla (staff and owner)

- **Press Back 5 times quickly** (within 3 seconds). The "Which screen is this?" page opens. From there you can pick a different screen, allow auto-start, or press **Open device settings**.
- While that page has been opened, Tabla waits 30 minutes before pulling itself back to the front, so you have time in settings.
- On Fire TV, Home also leaves Tabla; it comes back within up to 10 minutes, or when the TV is turned off and on.

## Updates

- **Menus, pictures, music, orders:** change them in the Manager app; the screens show them right away.
- **The web app:** updates by itself. The kitchen tablet picks up a new version within a few minutes when nobody is using it; phones when the app is opened again; TVs reload once a night after 4 AM (or as soon as they are on again).
- **The screen app (`tabla.apk`):** updates itself. TVs and the kitchen tablet install a new version only between 3 and 5 AM, so leave them on overnight; phones may update any time. The screen goes dark for a few seconds and Tabla opens again on the same screen. On newer Android (12+) this is silent after the first update. On Fire TV and older Android a box asks "Do you want to install an update?" at that time; nobody is there to press **Install**, so it asks again the next night. To update such a screen during the day, download and install `tabla.apk` again the same way as the first time. The screen chooser (Back 5 times) shows the installed version as "Tabla app: 1.N".
- Copies installed before automatic updates existed (versions below 1.1000) must be updated by hand once: download and install again the same way. If Android says the app "conflicts" with an installed one (only for an early test copy), uninstall Tabla first, then install and choose the screen again.

## 24-hour test before opening day

Leave every screen running for a full day and tick each one:

- [ ] Each screen shows the right thing (TV 1 left, TV 2 right, TV 3/4 mirror, TV 5 music, kitchen).
- [ ] Pull the power plug, plug it back in: the screen comes back by itself (no remote).
- [ ] Turn the TV off and on with its remote: the screen comes back.
- [ ] Press Home: Tabla comes back (straight away on Google TV/tablet, within up to 10 minutes on Fire TV).
- [ ] Unplug the internet router for 10 minutes: screens keep showing; they catch up after it is back.
- [ ] Change a menu picture in the Manager app: all menu TVs show it.
- [ ] TV 5 plays music with sound; a catering clip shows between songs.
- [ ] Add a catering order due in a bit over 1 hour: the kitchen tablet rings about 1 hour before.
- [ ] Next morning: nothing went to sleep, screensaver or a "Are you still watching?" page; clocks show Arizona time.

## Music licence and ads (TV 5)

Playing music to customers in a restaurant usually needs a public-performance music licence (for example from ASCAP, BMI, SESAC, GMR, or a business music service). A personal YouTube account doesn't cover it. YouTube may also show **ads** between songs on TV 5; YouTube Premium removes most ads but is still a personal licence.
