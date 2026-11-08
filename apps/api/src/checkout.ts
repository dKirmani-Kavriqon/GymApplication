import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived tokens for the hosted checkout page (`/pay/:paymentId?t=`). The page is opened in
 * the phone's browser, which has no API token, so the link itself must prove who may pay.
 * Bound to one payment and one user, signed with the token secret under its own prefix so an
 * auth token can never be passed off as a checkout token (or the other way round).
 */
export const CHECKOUT_TTL_MS = 30 * 60_000;

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(`checkout:${payload}`).digest('base64url');

export function signCheckoutToken(paymentId: string, userId: string, secret: string, now: Date): string {
  const payload = b64(JSON.stringify({ p: paymentId, u: userId, exp: now.getTime() + CHECKOUT_TTL_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

export type CheckoutTokenResult = { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyCheckoutToken(token: string | undefined, paymentId: string, secret: string, now: Date): CheckoutTokenResult {
  const [payload, sig] = (token ?? '').split('.');
  if (!payload || !sig) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  let data: { p?: unknown; u?: unknown; exp?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (data.p !== paymentId || typeof data.u !== 'string' || typeof data.exp !== 'number') return { ok: false, reason: 'invalid' };
  if (data.exp < now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, userId: data.u };
}
