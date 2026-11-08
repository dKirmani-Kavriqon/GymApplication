import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FetchFn } from './sms';
import { HttpError } from './errors';

/**
 * Payment gateway abstraction. Production uses Razorpay (UPI, cards, netbanking); card data
 * never touches our servers. The mock provider lets the app run end-to-end in development.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Public key the app needs to open the gateway checkout (Razorpay key id). */
  readonly keyId?: string;
  createOrder(input: { amountPaise: number; currency: 'INR'; receipt: string }): Promise<{ orderId: string }>;
  verifyPayment(input: { orderId: string; paymentId: string; signature: string }): boolean;
  /** Verifies a webhook body signature; undefined when the provider has no webhooks. */
  verifyWebhook?(rawBody: Buffer | string, signature: string): boolean;
  /** Only implemented by the mock provider. */
  mockSignatureFor?(orderId: string): string;
}

const hmacHex = (secret: string, data: Buffer | string) => createHmac('sha256', secret).update(data).digest('hex');

/** Constant-time comparison of two hex signatures. */
export function safeEqualHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createMockPaymentProvider(secret = 'mock-payments-secret', webhookSecret = 'mock-webhook-secret'): PaymentProvider {
  const sign = (orderId: string) => hmacHex(secret, orderId);
  return {
    name: 'mock',
    async createOrder() {
      return { orderId: `order_mock_${randomUUID().replace(/-/g, '').slice(0, 14)}` };
    },
    verifyPayment({ orderId, signature }) {
      return safeEqualHex(sign(orderId), signature);
    },
    verifyWebhook(rawBody, signature) {
      return safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
    },
    mockSignatureFor: sign,
  };
}

export interface RazorpayOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetch?: FetchFn;
}

/** Razorpay Orders API + checkout signature + webhook signature (all HMAC-SHA256, hex). */
export function createRazorpayProvider(opts: RazorpayOptions): PaymentProvider {
  const fetchFn = opts.fetch ?? (globalThis.fetch as FetchFn);
  const auth = Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString('base64');
  return {
    name: 'razorpay',
    keyId: opts.keyId,
    async createOrder({ amountPaise, currency, receipt }) {
      let res: Response;
      try {
        res = await fetchFn('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
          body: JSON.stringify({ amount: amountPaise, currency, receipt }),
        });
      } catch {
        throw new HttpError(502, 'payment_gateway_unavailable', 'The payment gateway is not responding. Please try again.');
      }
      if (!res.ok) throw new HttpError(502, 'payment_gateway_error', 'We could not start the payment. Please try again.');
      const body = (await res.json()) as { id?: string };
      if (!body.id) throw new HttpError(502, 'payment_gateway_error', 'We could not start the payment. Please try again.');
      return { orderId: body.id };
    },
    verifyPayment({ orderId, paymentId, signature }) {
      return safeEqualHex(hmacHex(opts.keySecret, `${orderId}|${paymentId}`), signature);
    },
    verifyWebhook(rawBody, signature) {
      return safeEqualHex(hmacHex(opts.webhookSecret, rawBody), signature);
    },
  };
}
