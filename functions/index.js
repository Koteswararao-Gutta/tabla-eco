// Tabla server code (Firebase Cloud Functions). Deployed by .github/workflows/functions.yml.
import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { checkRequest, readError, readOrderPhoto, UNREADABLE, UNREADABLE_TEXT } from './readOrder.js';
import { alertFor, chunks, deadTokens, onRing, planReminder, shouldSchedule, TIME_ZONE } from './reminders.js';
import { MENU_LINK, nextStatus, readFromPage, readToastMenu, readWithChrome } from './toastMenu.js';

initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/** Manager app: "Scan paper order" and "Paste message". Takes a photo or a pasted message, returns the order form's fields. Never saves anything. */
export const readOrder = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: '256MiB', maxInstances: 3 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Please open the Tabla app.');
    const problem = checkRequest(req.data);
    if (problem) throw new HttpsError('invalid-argument', problem);
    try {
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 2 });
      return await readOrderPhoto(client, req.data);
    } catch (e) {
      logger.error('readOrder failed', e);
      if (readError(e) === 'unreadable') throw new HttpsError('invalid-argument', req.data.text !== undefined ? UNREADABLE_TEXT : UNREADABLE);
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

/** Every time an order is saved: set its alarm (completed, deleted or moved orders are checked when it rings). */
export const orderSaved = onDocumentWritten({ document: 'orders/{orderId}', maxInstances: 3 }, async (event) => {
  const after = event.data?.after?.data() ?? null;
  const before = event.data?.before?.data() ?? null;
  if (!shouldSchedule(before, after)) return; // nothing that moves the alarm (e.g. only remindedFor changed)
  await scheduleReminder(event.params.orderId, after);
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

    const sent = await sendToAllDevices(alertFor(order, now), `order-${orderId}`, 'high');
    // Remember it was sent for this time, so a retry or a move away and back doesn't ring again.
    if (sent > 0) await snap.ref.update({ remindedFor: dueAt });
  },
);

// ---------- Toast menu ----------

/**
 * Every hour: reads the menu from Tabla's Toast ordering page and saves it to toastMenu/current
 * (only when something changed). Backup: a hidden Chrome. If both fail, the last good menu stays and,
 * after two failed runs in a row, the phones get one alert.
 */
export const syncToastMenu = onSchedule(
  { schedule: 'every 1 hours', timeZone: TIME_ZONE, memory: '2GiB', timeoutSeconds: 300, maxInstances: 1, retryCount: 0 },
  async () => {
    const db = getFirestore();
    const currentRef = db.doc('toastMenu/current');
    const statusRef = db.doc('toastMenu/status');
    const now = Date.now();
    // Mark the try first, so a run that gets killed (time limit, memory) still shows: startedAt newer than lastTryAt.
    await statusRef.set({ startedAt: now }, { merge: true });
    let result;
    try {
      const { menu, source } = await readToastMenu([
        ['page', () => readFromPage()],
        ['chrome', () => readWithChrome()],
      ]);
      const saved = await currentRef.get();
      if (saved.get('hash') !== menu.hash) {
        await currentRef.set({ ...menu, changedAt: now, source });
        logger.info(`syncToastMenu: menu changed (${menu.itemCount} items, ${menu.soldOutCount} sold out) via ${source}`);
      }
      result = { ok: true, source };
    } catch (e) {
      logger.warn('syncToastMenu: could not read the Toast menu', e?.message ?? e);
      result = { ok: false, error: e?.message ?? e };
    }
    const prev = (await statusRef.get()).data() ?? null;
    const { status, alert } = nextStatus(prev, result, now);
    await statusRef.set({ ...status, startedAt: now });
    if (alert) await sendToAllDevices({ ...alert, link: MENU_LINK }, 'toast-menu');
  },
);

/** Sends one alert to every phone that turned alerts on, 500 at a time, and forgets phones that are gone. Returns how many got it. */
async function sendToAllDevices(alert, tag, urgency = 'normal') {
  const docs = (await getFirestore().collection('pushTokens').get()).docs.filter((d) => typeof d.get('token') === 'string');
  if (!docs.length) {
    logger.info(`${tag} alert: no devices have alerts on`);
    return 0;
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
  logger.info(`${tag} alert: sent ${sent}, failed ${failed}, removed ${removed}`);
  return sent;
}
