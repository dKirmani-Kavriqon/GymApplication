import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';
import { HttpError } from './errors';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_MS = 10 * 60 * 1000;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(userId: string, secret: string, now: Date): string {
  const payload = b64url(JSON.stringify({ sub: userId, exp: now.getTime() + TOKEN_TTL_MS }));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Returns the user id for a valid, unexpired token, otherwise null. */
export function verifyToken(token: string, secret: string, now: Date): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp < now.getTime()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

function hashOtp(phone: string, code: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${phone}:${code}`).digest('hex');
}

/** Sends the OTP by SMS. Production plugs in MSG91/Twilio; dev logs it. */
export type OtpSender = (phone: string, code: string) => Promise<void> | void;

export function issueOtp(db: Db, phone: string, secret: string, now: Date): string {
  const windowStart = new Date(now.getTime() - OTP_WINDOW_MS).toISOString();
  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND created_at > ?')
    .get(phone, windowStart) as { n: number };
  if (recent.n >= OTP_MAX_PER_WINDOW) {
    throw new HttpError(429, 'too_many_requests', 'Too many codes requested. Try again in a few minutes.');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE phone = ? AND consumed = 0').run(phone);
  db.prepare(
    'INSERT INTO otp_codes (id, phone, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), phone, hashOtp(phone, code, secret), new Date(now.getTime() + OTP_TTL_MS).toISOString(), now.toISOString());
  return code;
}

export function consumeOtp(db: Db, phone: string, code: string, secret: string, now: Date): void {
  const row = db
    .prepare(
      'SELECT id, code_hash, expires_at, attempts FROM otp_codes WHERE phone = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1',
    )
    .get(phone) as { id: string; code_hash: string; expires_at: string; attempts: number } | undefined;
  const invalid = new HttpError(400, 'invalid_code', 'That code is not right. Check the SMS and try again.');
  if (!row) throw invalid;
  if (row.expires_at < now.toISOString()) {
    throw new HttpError(400, 'code_expired', 'That code has expired. Ask for a new one.');
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, 'too_many_attempts', 'Too many tries. Ask for a new code.');
  }
  const ok = timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashOtp(phone, code, secret)));
  if (!ok) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw invalid;
  }
  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(row.id);
}

/** Finds or creates the user for a verified phone number. */
export function upsertUserByPhone(db: Db, phone: string, now: Date): { id: string; isNew: boolean } {
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
  if (existing) return { id: existing.id, isNew: false };
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)').run(id, phone, now.toISOString());
  db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(id);
  return { id, isNew: true };
}
