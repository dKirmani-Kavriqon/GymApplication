import type { App } from '../http';
import { createHash } from 'node:crypto';
import { tx } from '../db';
import { HttpError } from '../errors';
import type { Ctx } from '../context';
import type { Row } from '../store';
import { completePayment } from '../domain/payments';

interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    order?: { entity?: { id?: string } };
  };
}

/**
 * Razorpay webhooks. The signature is an HMAC of the exact raw body, so the
 * handler reads `req.rawBody` (the framework keeps the exact bytes for every request).
 */
export function registerWebhookRoutes(app: App, ctx: Ctx): void {
  const { db, now, payments } = ctx;

  app.post('/webhooks/razorpay', async (req) => {
    if (!payments.verifyWebhook) throw new HttpError(404, 'not_found', 'Not found');
    const raw = Buffer.from(req.rawBody);
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !payments.verifyWebhook(raw, signature)) {
      throw new HttpError(400, 'bad_signature', 'Invalid webhook signature');
    }
    const event = (req.body ?? {}) as RazorpayEvent;
    // Razorpay retries deliveries; the event id (or a hash of the body) makes replays no-ops.
    const header = req.headers['x-razorpay-event-id'];
    const eventId = typeof header === 'string' && header ? header : createHash('sha256').update(raw).digest('hex');

    return tx(db, () => {
      const seen = db
        .prepare("INSERT OR IGNORE INTO webhook_events (id, provider, created_at) VALUES (?, 'razorpay', ?)")
        .run(eventId, now().toISOString());
      if (seen.changes === 0) return { ok: true, duplicate: true };
      if (event.event !== 'payment.captured' && event.event !== 'order.paid') return { ok: true, ignored: event.event ?? null };
      const orderId = event.payload?.payment?.entity?.order_id ?? event.payload?.order?.entity?.id;
      const paymentRef = event.payload?.payment?.entity?.id ?? null;
      if (!orderId) return { ok: true, ignored: 'no_order' };
      const pay = db.prepare('SELECT * FROM payments WHERE provider_order_id = ?').get(orderId) as Row | undefined;
      // Unknown order (e.g. created outside GymVerse): acknowledge so Razorpay stops retrying.
      if (!pay || !pay.user_id) return { ok: true, ignored: 'unknown_order' };
      completePayment(db, pay, paymentRef, now());
      return { ok: true };
    });
  });
}
