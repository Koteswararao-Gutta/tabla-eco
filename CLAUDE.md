# Tabla Eco

Small internal system for Tabla, an Indian restaurant: 5 TVs, a kitchen tablet and a manager phone app. No login, no payments. Keep everything simple and minimal (ChatGPT/Claude-like look).

Plans: system plan https://claude.ai/artifact/LxM1Y7otkLEgTrYQpzoZTa · build plan https://claude.ai/artifact/Dx3DdyjXJTSJvGXeCBHQRj

## Screens (one web app, live on GitHub Pages; TVs and tablet run it inside the Android app in `android/`)

One web app (Vite + React + TypeScript), hash routes:

| Route | Screen | Folder (owner) |
| --- | --- | --- |
| `#/tv/1` … `#/tv/4` | Front menu TVs. TV 1 left, TV 2 right; TV 3/TV 4 mirror them | `src/tv-menu/` (agent 1) |
| `#/manager/screens` | Manager: TV tiles, picture list per TV, + to add | `src/manager/screens/` (agent 2) |
| `#/tv/5` | Music TV: YouTube playlist + catering clip between songs | `src/tv-music/` (agent 3) |
| `#/manager/catering`, `#/kitchen` | Catering orders; kitchen tablet with PIN | `src/manager/catering/`, `src/kitchen/` (agent 4) |
| `#/manager/staff` | Shift planner (port of `reference/shift-planner.html`) | `src/manager/staff/` (agent 5) |
| `#/front/catering` | Front app for front staff: the same Catering only. No Screens, no Staff, no ☰ | `src/manager/ManagerShell.tsx` (`mode="front"`, `src/manager/mode.tsx`) |

Two links, one code base: `#/manager` (everything, no PIN) and `#/front` (front staff). The front app has its own page, `front/index.html` (link `…/tabla-eco/front/`), with its own manifest, icon and name written in, because iPhone Safari reads those once as a page loads; the root page sends any `#/front` link there. One service worker at the top folder serves both pages (`swUrl()` from `@shared/data`). Inside these apps build links with `useAppBase()` from `src/manager/mode.tsx`, never a hard-coded `/manager`; check `useAppMode() === 'front'` for anything that differs in the front app.

Foundation-owned (do not edit from an agent branch; ask instead): `src/shared/**`, `src/App.tsx`, `src/main.tsx`, `src/manager/ManagerShell.tsx`, configs, `e2e/helpers.ts`, `e2e/foundation.spec.ts`, this file.

## Rules

- **Data only through `@shared/data`** (`store`, `useCollection`, `useDoc`, `usePictureUrl`, `useNow`, `useHeartbeat`). Never touch localStorage, IndexedDB or a backend directly (per-device values: `deviceValue` / `setDeviceValue`). The live app runs on `FirebaseStore` (Firestore + anonymous sign-in); tests and `VITE_STORE=local` previews run on `LocalStore` (one browser; windows sync via the storage event). Screens must not depend on local-only behaviour. Sample data is only ever written to an empty database; never write code that deletes or overwrites existing data.
- **Time:** use `store.now()` / `useNow()` for anything synced, never `Date.now()`.
- **Menu loop sync:** use `loopPosition(slots, now, loop)` and `pictureFor` from `@shared/clock/loop`, with `loop = useSingleton('loop')`. Seconds and transition live on the `Slot`, shared by all menu TVs. After any change to slots, the manager calls `restartLoop(slotId)` so every TV shows the change at once.
- **Ads:** slot kind `'catering'` is shown as "Ad" (the stored name stays for older TVs and the rules). An ad with videos is a pair (`pictures.tv1` left, `pictures.tv2` right; `Picture.video` = `{ src, sound, seconds }`); sound is set on both pictures, so sound on = all 4 TVs. `Slot.every` (`{ by: 'rounds' | 'minutes', n }`) makes it play between menu pictures (see `walkPosition` in `@shared/clock/loop`; the walk restarts at 4 AM Arizona). Write `Slot.every` only when `tvsOnOldCode` (manager screens logic) is empty: older TVs ignore it and would drift. Videos load only through `store.videoUrl` / `store.releaseVideo` (`ads/…` site files or `stored:<id>` phone uploads in `videoData`). Never delete a picture that has a video; the app pauses or stops ads instead.
  - Phone videos are stored as `videoData/{id}` with 900 KB `chunks` (meta written last), at most 20 MB per video (checked in the app and in `firestore.rules`); each device also keeps its last few in its own IndexedDB cache (`@shared/data/videoCache`), read first. A TV loads only the videos of live ads, one at a time.
  - Pause = set `endsAt` to the end of the item playing now (`loopPosition(...).endsAt`), with no `restartLoop`, so nothing jumps. Other ad edits (Play again, How often, Replace videos, Remove ad) call `restartLoop(null)`, so the loop starts again at the first menu picture; only Add ad starts with the ad. Remove ad deletes only the slot, never pictures or videos.
  - Raise `ADS_CODE_VERSION` (sent in the heartbeat) when TVs must run new code before the manager may write a new kind of ad data; the manager waits until no TV reports an older version.
- **Picture fallback:** in a `special` or `catering` slot, a TV with no picture shows its partner's (one picture fills the pair). In a `menu` slot it never borrows; a menu picture added to TV 1 stays on TV 1.
- **Loading vs missing:** `useSingleton`/`useDoc` return `undefined` while loading and `null` when missing. Wait while `undefined` (e.g. a TV must not compute its slot before `loop` arrives); treat `null` as "use defaults" (no loop anchor, kitchen PIN `1234` if settings are missing).
- **Single documents** (music, settings, staffConfig, loop): `useSingleton`, `saveSingleton`, `updateSingleton`. Never pass `undefined` field values; use `null` to clear.
- **Pictures:** `pictureUrl` already serves from a local cache that works offline. Don't build another cache; the menu TV preloads the `next` slot's picture.
- **Look:** use `@shared/ui` components and `.t-*` classes / CSS variables from `theme.css`. Area-specific CSS goes in a `.css` file inside your folder, using the variables. No new colours, no UI libraries.
- **Screens must survive:** reloads, the internet dropping, missing pictures, empty data. TVs never show a browser error or a blank white page.
- **Keep it simple.** No features beyond the plan. Big touch targets (48 px+). Plain words in the UI.
- Each area exports a default component from its `index.tsx`. Tests for an area go in `e2e/<area>.spec.ts` (e.g. `e2e/tv-menu.spec.ts`) and unit tests next to the code as `*.test.ts`.

## Server and devices

- Cloud Functions in `functions/` (AI order reading, 1-hour phone alerts, Toast menu sync) and `firestore.rules` deploy automatically from main after the Tests workflow passes (`.github/workflows/functions.yml`); the site and `tabla.apk` publish the same way (`pages.yml`).
- Device setup for the owner: `docs/device-setup.md`.

## Commands

```
npm install
npm run dev          # http://localhost:5173/#/  (open screens in separate windows)
npm run typecheck
npm test             # unit tests (vitest)
npm run e2e          # Chrome tests (Playwright). In the cloud container: PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e
npm test --prefix rules-test   # Firestore rules on the emulator (needs Java 21)
```

Parallel agents each use their own test port: `PW_PORT=4181` agent 1, `4182` agent 2, `4183` agent 3, `4184` agent 4, `4185` agent 5, `4190` integration.

Sample data seeds on first load (PIN 1234). Reset by clearing site data, or `resetDemoData()` from `@shared/seed/seed`.

## Definition of done (every agent)

1. `npm run typecheck`, `npm test` and your `e2e/<area>.spec.ts` pass.
2. Screenshots of your screens checked by eye (TV views at 1920x1080, phone views at 390x844).
3. Only files in your folder (plus your e2e spec) changed.
4. The architect agent approves (must-fix items cleared).
