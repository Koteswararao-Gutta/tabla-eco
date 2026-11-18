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
import { checkRequest, readOrderPhoto } from './readOrder.js';
import { alertFor, deadTokens, onRing, planReminder } from './reminders.js';

initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/** Manager app: "Scan paper order". Takes a photo, returns the order form's fields. Never saves anything. */
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
      throw new HttpsError('unavailable', 'Could not read the photo right now.');
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
  const after = event.data?.after?.data();
  const before = event.data?.before?.data();
  if (!after || after.status !== 'open') return;
  if (before && before.status === after.status && before.dueAt === after.dueAt) return; // nothing that moves the alarm
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

    const docs = (await db.collection('pushTokens').get()).docs.filter((d) => typeof d.get('token') === 'string');
    const tokens = docs.map((d) => d.get('token'));
    if (!tokens.length) return logger.info('orderReminder: no devices have alerts on');
    const alert = alertFor(order, now);
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      data: { ...alert, tag: `order-${orderId}` },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } },
    });
    const dead = deadTokens(tokens, res.responses);
    await Promise.all(docs.filter((d) => dead.includes(d.get('token'))).map((d) => d.ref.delete().catch(() => {})));
    logger.info(`orderReminder ${orderId}: sent ${res.successCount}, failed ${res.failureCount}, removed ${dead.length}`);
  },
);
