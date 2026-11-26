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

## Quick version (any TV device)

1. Turn on developer options and **ADB debugging** (Fire TV) / **USB debugging** (Google TV), and allow installs from **Downloader** (steps below).
2. In Downloader, type `koteswararao-gutta.github.io/tabla-eco/tabla.apk`, Install, Open.
3. Pick the screen (TV 1 to TV 5). The TV asks **"Allow USB debugging?"**: tick **Always allow from this computer** and press **OK**.
4. A note says "Tabla is set up". Done: it opens by itself when the TV turns on, and installs its own updates at night with no questions. Never install it again.

Leave ADB / USB debugging **on**: Tabla uses it to install its updates quietly. If a TV ever shows "Allow USB debugging?" when nobody is setting it up, press **Cancel**.

## Google TV box

1. **Developer options:** Settings > System > About > click "Android TV OS build" 7 times. Then Settings > System > Developer options: turn on **USB debugging**.
2. **Downloader:** install "Downloader" (by AFTVnews) from the Play Store. Settings > Apps > Security & restrictions > Unknown sources > Downloader: ON.
3. **Install:** open Downloader, type the download address above, Install, Open.
4. **Choose the screen** and answer the "Allow USB debugging?" question as in the quick version. Tabla gives itself auto-start, automatic updates and becomes the home app (Home leads back to it).
   If the note says it couldn't finish (some newer boxes don't offer this), press Back 5 times, then "Allow auto-start" (turn on "Display over other apps" for Tabla) and "Allow automatic updates". On Android 12+ boxes updates are quiet anyway.
5. Check the "Web viewer" line at the bottom of the chooser. If it shows a red "too old" warning, update **Android System WebView** in the Play Store and restart.
6. **Never sleep:** Settings > System > Energy (or Power & energy) > "Turn off display" / "When inactive": Never. Settings > System > Ambient mode (screensaver): Off.
7. **On the Vizio:** Settings > System > Power Mode: Quick Start. Turn off Sleep Timer, Auto Power Off and any Eco / energy-saving mode. Keep CEC on (System > CEC) so the Vizio remote turns both on together.

## Fire TV Stick

Fire TV cannot use Tabla as its home app. Instead Tabla comes back by itself when the TV turns on, and within 30 seconds if someone leaves it.

**Check the model first:** the newest Fire TV Sticks running **Vega OS** (for example Fire TV Stick 4K Select) are not Android and cannot install `tabla.apk`. Use an Android-based Fire TV Stick or a Google TV box instead.

1. **Developer options:** Settings > My Fire TV > About > click the device name 7 times. Then My Fire TV > Developer options: turn on **ADB debugging**.
2. **Downloader:** search for "Downloader" (by AFTVnews) and install it. Settings > My Fire TV > Developer options > Install unknown apps > Downloader: ON.
3. **Install:** in Downloader, type the download address above, Install, Open.
4. **Choose the screen** and answer "Allow USB debugging?" (tick Always allow, OK). Tabla gives itself auto-start and quiet updates; no computer needed. Check the "Web viewer" line (update with My Fire TV > About > Check for updates).
   Only if that fails and keeps failing: from a computer on the same Wi-Fi, `adb connect <fire-tv-ip>:5555` then `adb shell appops set com.tabla.tv SYSTEM_ALERT_WINDOW allow` (IP in My Fire TV > About > Network).
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

## Approved devices and the restaurant code

The app can be locked so that only the restaurant's own phones, tablets and TVs open it. Someone who gets hold of a link sees a "restaurant code" screen and nothing else.

Turning it on (once):

1. Do nothing for a day after the update goes live. Every device that opens the app adds itself to the list in the manager app: ☰ More > Devices. TVs pick up the update at their 4 AM reload; phones and the kitchen tablet when they next open the app.
2. In ☰ More > Devices, check the list. The page says "Not in the list yet: ..." for any TV or the kitchen tablet still missing; wait for those. Rename devices if it helps ("Ravi's phone"). Remove anything you don't recognise.
3. Tap **Set code** and pick 6 to 10 digits. Write it down; it isn't shown again (you can always set a new one).
4. Tap **Lock to these devices**.

After that:

- **A new phone, tablet or TV** shows the code screen the first time. Type the code once (on a TV, use the remote's arrows and OK, or its number keys). It stays approved.
- **A lost phone or someone who left:** ☰ More > Devices > Remove. It stops working within 15 minutes.
- **A device that loses its sign-in** (site data cleared, app reinstalled) shows the code screen instead of the menu or orders. Type the code again.
- **5 wrong codes** on one device wait 15 minutes; 20 wrong codes from anywhere in an hour pause the code screen for everyone for up to an hour. Approved devices are never affected.
- **Something wrong?** ☰ More > Devices > "Open the app to anyone again" undoes the lock at once.

## Backups

See [backups.md](backups.md): turn them on once, and how to get back a lost order or payment.

## Getting out of Tabla (staff and owner)

- **Press Back 5 times quickly** (within 3 seconds). The "Which screen is this?" page opens. From there you can pick a different screen, allow auto-start, or press **Open device settings**.
- While that page has been opened, Tabla waits 30 minutes before pulling itself back to the front, so you have time in settings.
- On Fire TV, Home also leaves Tabla; it comes back within 30 seconds, or when the TV is turned off and on.

## Updates

- **Menus, pictures, music, orders:** change them in the Manager app; the screens show them right away.
- **The web app:** updates by itself. The kitchen tablet picks up a new version within a few minutes when nobody is using it; phones when the app is opened again; TVs reload once a night after 4 AM (or as soon as they are on again).
- **The screen app (`tabla.apk`):** updates itself. TVs and the kitchen tablet install a new version only between 3 and 5 AM, so leave them on overnight; phones may update any time. The screen goes dark for a few seconds and Tabla opens again on the same screen. On a TV that Tabla set up itself (ADB / USB debugging on, "Allow USB debugging?" answered once) this is always silent. Without that, newer Android (12+) is silent after the first update, while Fire TV and older Android show "Install update?" at night, which nobody answers; then turn debugging on and choose the screen again (Back 5 times) to fix it for good. The screen chooser shows the installed version as "Tabla app: 1.N".
- Copies installed before automatic updates existed (versions below 1.1000) must be updated by hand once: download and install again the same way. If Android says the app "conflicts" with an installed one (only for an early test copy), uninstall Tabla first, then install and choose the screen again.

## 24-hour test before opening day

Leave every screen running for a full day and tick each one:

- [ ] Each screen shows the right thing (TV 1 left, TV 2 right, TV 3/4 mirror, TV 5 music, kitchen).
- [ ] Pull the power plug, plug it back in: the screen comes back by itself (no remote).
- [ ] Turn the TV off and on with its remote: the screen comes back.
- [ ] Press Home: Tabla comes back (straight away on Google TV/tablet, within 30 seconds on Fire TV).
- [ ] Unplug the internet router for 10 minutes: screens keep showing; they catch up after it is back.
- [ ] Change a menu picture in the Manager app: all menu TVs show it.
- [ ] TV 5 plays music with sound; a catering clip shows between songs.
- [ ] Add a catering order due in a bit over 1 hour: the kitchen tablet rings about 1 hour before.
- [ ] Next morning: nothing went to sleep, screensaver or a "Are you still watching?" page; clocks show Arizona time.

## Music licence and ads (TV 5)

Playing music to customers in a restaurant usually needs a public-performance music licence (for example from ASCAP, BMI, SESAC, GMR, or a business music service). A personal YouTube account doesn't cover it. YouTube may also show **ads** between songs on TV 5; YouTube Premium removes most ads but is still a personal licence.
