// Tabla server code (Firebase Cloud Functions). Deployed by .github/workflows/functions.yml.
import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { editAlertFor, kitchenEdit } from './edits.js';
import { checkRequest, readError, readOrderPhoto, UNREADABLE, UNREADABLE_TEXT } from './readOrder.js';
import { alertFor, chunks, deadTokens, onRing, planReminder, shouldSchedule, TIME_ZONE } from './reminders.js';
import { MENU_LINK, nextStatus, readReport } from './toastMenu.js';

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

/** Every time an order is saved: set its alarm (completed, deleted or moved orders are checked when it rings),
 *  and when the kitchen edited it, tell the phones what changed. */
export const orderSaved = onDocumentWritten({ document: 'orders/{orderId}', maxInstances: 3 }, async (event) => {
  const after = event.data?.after?.data() ?? null;
  const before = event.data?.before?.data() ?? null;
  const { orderId } = event.params;
  const edit = kitchenEdit(before, after);
  // Retries can repeat this; the tag makes a repeat replace the same alert on the phone.
  if (edit) {
    try {
      await sendToAllDevices(editAlertFor(after, edit), `edit-${orderId}-${edit.at}`);
    } catch (e) {
      logger.error('kitchen edit alert failed', e); // never stops the 1-hour reminder below
    }
  }
  if (!shouldSchedule(before, after)) return; // nothing that moves the alarm (e.g. only remindedFor changed)
  await scheduleReminder(orderId, after);
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
 * Kitchen tablet: once an hour its app reads Tabla's Toast ordering page (Toast blocks cloud servers, so the
 * tablet does it over the restaurant's internet) and sends { menus } or { error } here. Saves the menu to
 * toastMenu/current only when something changed, keeps toastMenu/status, and alerts the phones once if it keeps failing.
 */
export const reportToastMenu = onCall({ memory: '256MiB', timeoutSeconds: 30, maxInstances: 2 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please open the Tabla app.');
  if (JSON.stringify(req.data ?? null).length > 3_000_000) throw new HttpsError('invalid-argument', 'Menu report too big.');
  const db = getFirestore();
  const currentRef = db.doc('toastMenu/current');
  const statusRef = db.doc('toastMenu/status');
  const now = Date.now();
  const source = 'kitchen tablet';
  const { menu, error } = readReport(req.data);
  let result;
  if (menu) {
    const saved = await currentRef.get();
    if (saved.get('hash') !== menu.hash) {
      await currentRef.set({ ...menu, changedAt: now, source });
      logger.info(`reportToastMenu: menu changed (${menu.itemCount} items, ${menu.soldOutCount} sold out)`);
    }
    result = { ok: true, source, itemCount: menu.itemCount, soldOutCount: menu.soldOutCount };
  } else {
    logger.warn('reportToastMenu: the tablet could not read the Toast menu', error);
    result = { ok: false, error };
  }
  const prev = (await statusRef.get()).data() ?? null;
  const { status, alert } = nextStatus(prev, result, now);
  await statusRef.set(status);
  if (alert) await sendToAllDevices({ ...alert, link: MENU_LINK }, 'toast-menu');
  return result;
});

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
