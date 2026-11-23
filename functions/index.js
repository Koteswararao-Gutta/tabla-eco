// Tabla server code (Firebase Cloud Functions). Deployed by .github/workflows/functions.yml.
import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import {
  ALL_TRIES, afterWrong, appName, cleanName, CODE_RE, CODE_RULE, codeMatches, DEVICE_TRIES, deviceModel, hashCode, MAX_DEVICES,
  SEEN_EVERY_MS, shortId, triesLeft, waitMinutes,
} from './devices.js';
import { editAlertFor, kitchenEdit } from './edits.js';
import { checkRequest, LIMIT_REACHED, menuNames, readError, readOrderPhoto, takeDailyRead, UNREADABLE, UNREADABLE_TEXT } from './readOrder.js';
import { alertFor, chunks, deadTokens, onRing, planReminder, sendShouldRetry, shouldSchedule, TIME_ZONE } from './reminders.js';
import { restaurantDay, SUMMARY_WINDOW_MS, summaryFor, todaysOrders } from './summary.js';
import { MENU_LINK, nextStatus, readReport } from './toastMenu.js';

initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/** Manager app: "Scan paper order" and "Paste message". Takes a photo or a pasted message, returns the order form's fields. Never saves anything. */
export const readOrder = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: '256MiB', maxInstances: 3 },
  async (req) => {
    await mustBeAllowed(req);
    const problem = checkRequest(req.data);
    if (problem) throw new HttpsError('invalid-argument', problem);
    // At most DAILY_LIMIT reads a day (restaurant time), so a stuck button or a leaked link can't run up the bill.
    // If the counter itself can't be reached, the read still goes ahead (logged).
    const allowed = await takeDailyRead(getFirestore(), Date.now()).catch((e) => {
      logger.error('readOrder: daily counter failed', e);
      return true;
    });
    if (!allowed) {
      logger.warn('readOrder: daily limit reached');
      throw new HttpsError('resource-exhausted', LIMIT_REACHED);
    }
    try {
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 2 });
      // The menu's dish names, so items come back with the same names the order form picks from.
      // Without it (no menu saved yet, or a read error) items come back as written.
      const menu = await getFirestore()
        .doc('toastMenu/current')
        .get()
        .then((s) => menuNames(s.data()), () => []);
      return await readOrderPhoto(client, req.data, menu);
    } catch (e) {
      const kind = readError(e);
      if (kind === 'setup') logger.error(`readOrder: the request was refused, check the model and settings: ${e?.message ?? e}`, e);
      else logger.error('readOrder failed', e);
      if (kind === 'unreadable') throw new HttpsError('invalid-argument', req.data.text !== undefined ? UNREADABLE_TEXT : UNREADABLE);
      throw new HttpsError('unavailable', 'Could not read the order right now.');
    }
  },
);

// ---------- 1-hour reminders ----------

/** Sets an alarm for one order. Saving the same order again at the same time doesn't set a second one. */
async function scheduleReminder(orderId, order) {
  const plan = planReminder(orderId, order, Date.now());
  if (!plan) return;
  try {
    await getFunctions()
      .taskQueue('orderReminder')
      .enqueue({ orderId, dueAt: plan.dueAt }, { scheduleTime: new Date(plan.at), id: plan.id });
  } catch (e) {
    if (e?.code !== 'functions/task-already-exists') throw e;
  }
}

/** Stop retrying a save's alarm after this long (a problem that lasts hours needs a fix, not more tries). */
const RETRY_FOR_MS = 6 * 60 * 60_000;

/** Every time an order is saved: set its alarm (completed, deleted or moved orders are checked when it rings),
 *  and when the kitchen edited it, tell the phones what changed.
 *  retry: if setting the alarm fails (e.g. a short Cloud Tasks outage), Firebase runs this again. A repeat is safe:
 *  the alarm's id makes the same alarm count once, and the edit alert is sent only after the alarm is set. */
export const orderSaved = onDocumentWritten({ document: 'orders/{orderId}', maxInstances: 3, retry: true }, async (event) => {
  const after = event.data?.after?.data() ?? null;
  const before = event.data?.before?.data() ?? null;
  const { orderId } = event.params;
  const age = Date.now() - Date.parse(event.time);
  if (age > RETRY_FOR_MS) {
    logger.error(`orderSaved: gave up on order ${orderId} after ${Math.round(age / 60_000)} min of retries`);
    return;
  }
  // Throws on failure, so the whole save is tried again.
  if (shouldSchedule(before, after)) await scheduleReminder(orderId, after); // else nothing moves the alarm
  const edit = kitchenEdit(before, after);
  // The tag makes a repeat replace the same alert on the phone.
  if (edit) {
    try {
      await sendToAllDevices(editAlertFor(after, edit), `edit-${orderId}-${edit.at}`);
    } catch (e) {
      logger.error('kitchen edit alert failed', e); // never retried: the alarm above is what matters
    }
  }
});

/** The alarm: re-reads the order and sends the alert to every device that turned alerts on. */
export const orderReminder = onTaskDispatched(
  { retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 }, rateLimits: { maxConcurrentDispatches: 3 }, maxInstances: 3 },
  async (req) => {
    const { orderId, dueAt } = req.data ?? {};
    if (typeof orderId !== 'string' || typeof dueAt !== 'number') return;
    const db = getFirestore();
    const snap = await db.doc(`orders/${orderId}`).get();
    const order = snap.exists ? snap.data() : null;
    const now = Date.now();
    const what = onRing(order, { dueAt }, now);
    if (what === 'later') return scheduleReminder(orderId, order);
    if (what === 'skip') return;

    const result = await sendToAllDevices(alertFor(order, now), `order-${orderId}`, 'high');
    // Remember it was sent for this time, so a retry or a move away and back doesn't ring again.
    if (result.sent > 0) return void (await snap.ref.update({ remindedFor: dueAt }));
    // Nobody got it: an error in Cloud Logging, with the order id.
    logger.error(`orderReminder: the 1-hour reminder for order ${orderId} reached no phone (${result.failed} failed)`);
    // The failure may pass (not just phones that are gone): throw, so Cloud Tasks tries again.
    if (sendShouldRetry(result)) throw new Error(`reminder for order ${orderId}: no phone got it (${result.failed} failed), trying again`);
  },
);

// ---------- Morning summary ----------

/** 9:00 AM restaurant time: one alert listing today's open catering orders. No orders today, no alert. */
export const morningSummary = onSchedule(
  { schedule: '0 9 * * *', timeZone: TIME_ZONE, retryCount: 1, maxInstances: 1 },
  async () => {
    const now = Date.now();
    const snap = await getFirestore()
      .collection('orders')
      .where('dueAt', '>=', now - SUMMARY_WINDOW_MS)
      .where('dueAt', '<=', now + SUMMARY_WINDOW_MS)
      .get();
    const today = todaysOrders(snap.docs.map((d) => ({ ...d.data(), id: d.id })), now);
    const alert = summaryFor(today);
    if (!alert) return void logger.info('morningSummary: no catering orders today');
    await sendToAllDevices(alert, `summary-${restaurantDay(now)}`);
  },
);

// ---------- Toast menu ----------

/**
 * Kitchen tablet: once an hour its app reads Tabla's Toast ordering page (Toast blocks cloud servers, so the
 * tablet does it over the restaurant's internet) and sends { menus } or { error } here. Saves the menu to
 * toastMenu/current only when something changed, keeps toastMenu/status, and alerts the phones once if it keeps failing.
 */
export const reportToastMenu = onCall({ memory: '256MiB', timeoutSeconds: 30, maxInstances: 2 }, async (req) => {
  await mustBeAllowed(req);
  if (JSON.stringify(req.data ?? null).length > 3_000_000) throw new HttpsError('invalid-argument', 'Menu report too big.');
  const db = getFirestore();
  const currentRef = db.doc('toastMenu/current');
  const statusRef = db.doc('toastMenu/status');
  const now = Date.now();
  const source = 'kitchen tablet';
  const { menu, error } = readReport(req.data);
  let result;
  let saveError = null;
  if (menu) {
    try {
      const saved = await currentRef.get();
      if (saved.get('hash') !== menu.hash) {
        await currentRef.set({ ...menu, changedAt: now, source });
        logger.info(`reportToastMenu: menu changed (${menu.itemCount} items, ${menu.soldOutCount} sold out)`);
      }
      result = { ok: true, source, itemCount: menu.itemCount, soldOutCount: menu.soldOutCount };
    } catch (e) {
      // Saving failed (e.g. the menu grew too big): count it as a failed try, so it alerts like any other.
      logger.error('reportToastMenu: could not save the menu', e);
      saveError = e;
      result = { ok: false, error: `could not save the menu: ${e?.message ?? e}` };
    }
  } else {
    logger.warn('reportToastMenu: the tablet could not read the Toast menu', error);
    result = { ok: false, error };
  }
  const prev = (await statusRef.get()).data() ?? null;
  const { status, alert } = nextStatus(prev, result, now);
  await statusRef.set(status);
  if (alert) await sendToAllDevices({ ...alert, link: MENU_LINK }, 'toast-menu');
  if (saveError) throw new HttpsError('internal', 'Could not save the menu.');
  return result;
});

/** Sends one alert to every phone that turned alerts on, 500 at a time, and forgets phones that are gone.
 *  Returns { sent, failed, removed }: how many got it, how many didn't, and how many of those were gone for good. */
async function sendToAllDevices(alert, tag, urgency = 'normal') {
  // Once per address: a phone that turned alerts on before addresses moved to their own secret id has two docs
  // with the same address, and must still get each alert once.
  const seen = new Set();
  const docs = (await getFirestore().collection('pushTokens').get()).docs.filter((d) => {
    const token = d.get('token');
    if (typeof token !== 'string' || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
  if (!docs.length) {
    // An error (not info), so it shows among Cloud Logging's errors: with alerts on nowhere, nobody hears them.
    logger.error(`${tag} alert reached no phone: no devices have alerts on (turn alerts on in the manager app on each phone)`);
    return { sent: 0, failed: 0, removed: 0 };
  }
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const batch of chunks(docs)) {
    const tokens = batch.map((d) => d.get('token'));
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      data: { ...alert, tag },
      webpush: { headers: { Urgency: urgency, TTL: '3600' } },
    });
    sent += res.successCount;
    failed += res.failureCount;
    const dead = deadTokens(tokens, res.responses);
    removed += dead.length;
    await Promise.all(batch.filter((d) => dead.includes(d.get('token'))).map((d) => d.ref.delete().catch(() => {})));
  }
  if (sent === 0) logger.error(`${tag} alert reached no phone: all ${failed} sends failed (${removed} phones were gone)`);
  else logger.info(`${tag} alert: sent ${sent}, failed ${failed}, removed ${removed}`);
  return { sent, failed, removed };
}

// ---------- Approved devices ----------
// See devices.js. access/locked exists = locked; access/code = the code's hash (server only);
// access/info = what the Devices screen shows; devices/{uid} = one approved device; codeTries/* = wrong-code counters.

const isApproved = (req) => req.auth?.token?.tabla === true;
const isLocked = async () => (await getFirestore().doc('access/locked').get()).exists;

/** Server calls from the apps: an approved device, or any signed-in device while the app is still open. */
async function mustBeAllowed(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please open the Tabla app.');
  if (!isApproved(req) && (await isLocked())) throw new HttpsError('permission-denied', 'This device is not approved yet.');
}

/** Marks a device approved: the claim on its sign-in, and its row in the Devices list. */
async function approve(uid, how, data) {
  const db = getFirestore();
  const count = (await db.collection('devices').count().get()).data().count;
  if (count >= MAX_DEVICES) throw new HttpsError('resource-exhausted', 'Too many devices. Please remove old ones in More > Devices.');
  await getAuth().setCustomUserClaims(uid, { tabla: true });
  const now = Date.now();
  await db.doc(`devices/${uid}`).set({ id: uid, app: appName(data?.app), model: deviceModel(data?.model), name: null, how, approvedAt: now, lastSeen: now });
  logger.info(`device ${shortId(uid)} approved (${how}, ${appName(data?.app)})`);
}

/**
 * Every app calls this when it opens (and every few hours). Approved: refreshes "last seen".
 * Not approved: approves it while the app is open (not locked); when locked, says a code is needed.
 */
export const checkIn = onCall({ memory: '256MiB', timeoutSeconds: 20, maxInstances: 3 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please open the Tabla app.');
  const uid = req.auth.uid;
  const ref = getFirestore().doc(`devices/${uid}`);
  const saved = isApproved(req) ? await ref.get() : null;
  if (saved?.exists) {
    const now = Date.now();
    const app = appName(req.data?.app);
    if (now - (saved.get('lastSeen') ?? 0) >= SEEN_EVERY_MS || saved.get('app') !== app) await ref.update({ lastSeen: now, app });
    return { approved: true };
  }
  // Not approved (or approved but no longer in the list: a leftover of a removed device).
  if (await isLocked()) {
    if (saved) await getAuth().setCustomUserClaims(uid, null);
    return { approved: false };
  }
  await approve(uid, 'open', req.data);
  return { approved: true };
});

/** The code screen: approves this device when the restaurant code is right. Wrong codes are limited. */
export const enterCode = onCall({ memory: '256MiB', timeoutSeconds: 20, maxInstances: 2 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please open the Tabla app.');
  const uid = req.auth.uid;
  const code = typeof req.data?.code === 'string' ? req.data.code.trim() : '';
  const db = getFirestore();
  const mine = db.doc(`codeTries/${uid}`);
  const all = db.doc('codeTries/all');
  const now = Date.now();
  // Counted in one step, so many tries at once can't slip past the limit.
  const verdict = await db.runTransaction(async (tx) => {
    const [m, a, saved] = await Promise.all([tx.get(mine), tx.get(all), tx.get(db.doc('access/code'))]);
    if (triesLeft(m.data(), DEVICE_TRIES, now) === 0) return { wait: waitMinutes(m.data(), DEVICE_TRIES, now) };
    if (triesLeft(a.data(), ALL_TRIES, now) === 0) return { wait: waitMinutes(a.data(), ALL_TRIES, now) };
    if (!saved.exists) return { noCode: true };
    if (CODE_RE.test(code) && codeMatches(code, saved.data())) return { ok: true };
    tx.set(mine, afterWrong(m.data(), DEVICE_TRIES, now));
    tx.set(all, afterWrong(a.data(), ALL_TRIES, now));
    return { wrong: true };
  });
  if (verdict.wait) throw new HttpsError('resource-exhausted', `Too many wrong codes. Please wait ${verdict.wait} minute${verdict.wait === 1 ? '' : 's'} and try again.`);
  if (verdict.noCode) throw new HttpsError('failed-precondition', 'No restaurant code is set yet. Set one in the manager app: More > Devices.');
  if (verdict.wrong) {
    logger.warn(`enterCode: wrong code from device ${shortId(uid)}`);
    throw new HttpsError('permission-denied', "That code didn't work. Please try again.");
  }
  await approve(uid, 'code', req.data);
  await mine.delete().catch(() => {});
  return { approved: true };
});

/** More > Devices (approved devices only): set the code, lock or open the app, rename or remove a device. */
export const manageDevices = onCall({ memory: '256MiB', timeoutSeconds: 30, maxInstances: 2 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please open the Tabla app.');
  if (!isApproved(req)) throw new HttpsError('permission-denied', 'This device is not approved.');
  const db = getFirestore();
  const { action } = req.data ?? {};
  const now = Date.now();
  const info = db.doc('access/info');
  if (action === 'setCode') {
    const code = typeof req.data.code === 'string' ? req.data.code.trim() : '';
    if (!CODE_RE.test(code)) throw new HttpsError('invalid-argument', CODE_RULE);
    await db.doc('access/code').set({ ...hashCode(code), at: now });
    await info.set({ codeSetAt: now, updatedAt: now }, { merge: true });
    await db.doc('codeTries/all').delete().catch(() => {});
    logger.info(`restaurant code changed by device ${shortId(req.auth.uid)}`);
    return { ok: true };
  }
  if (action === 'lock') {
    if (!(await db.doc('access/code').get()).exists) throw new HttpsError('failed-precondition', 'Set the restaurant code first.');
    await db.doc('access/locked').set({ at: now });
    await info.set({ locked: true, lockedAt: now, updatedAt: now }, { merge: true });
    logger.info(`app locked to approved devices by device ${shortId(req.auth.uid)}`);
    return { ok: true };
  }
  if (action === 'unlock') {
    await db.doc('access/locked').delete();
    await info.set({ locked: false, lockedAt: null, updatedAt: now }, { merge: true });
    logger.info(`app opened again by device ${shortId(req.auth.uid)}`);
    return { ok: true };
  }
  const uid = typeof req.data.uid === 'string' ? req.data.uid : '';
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'Which device?');
  const ref = db.doc(`devices/${uid}`);
  if (action === 'rename') {
    if (!(await ref.get()).exists) throw new HttpsError('not-found', 'That device is no longer in the list.');
    await ref.update({ name: cleanName(req.data.name) });
    return { ok: true };
  }
  if (action === 'remove') {
    if (uid === req.auth.uid) throw new HttpsError('failed-precondition', "You can't remove the device you are using.");
    await ref.delete();
    // Deleting its sign-in signs it out within minutes; the app then signs in again as a new, unapproved device.
    try {
      await getAuth().deleteUser(uid);
    } catch (e) {
      if (e?.code !== 'auth/user-not-found') throw e;
    }
    logger.info(`device ${shortId(uid)} removed by device ${shortId(req.auth.uid)}`);
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});
