/**
 * v0.3 contract: production + remaining PRD features (see docs/API-v0.3.md).
 * Coupons, attendance, door QR check-in, crowd meter, referrals, revenue, membership freeze,
 * push devices, consent, account export/deletion, platform admin.
 */
import { z } from 'zod';
import type { PersonRef, Plan } from './types';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-08');

// ---------- coupons ----------

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, 'Coupon codes are 3–20 letters or numbers'),
    kind: z.enum(['percent', 'flat']),
    /** percent: 1–100; flat: paise. */
    amount: z.number().int().min(1),
    planIds: z.array(z.string().min(1)).max(20).default([]),
    expiresOn: day.nullish(),
    maxUses: z.number().int().min(1).max(100_000).nullish(),
    active: z.boolean().default(true),
  })
  .refine((c) => c.kind !== 'percent' || c.amount <= 100, { message: 'A percentage discount can be at most 100', path: ['amount'] });
export type CouponInput = z.input<typeof couponSchema>;

export interface Coupon {
  id: string;
  code: string;
  kind: 'percent' | 'flat';
  amount: number;
  /** Empty = all plans. */
  planIds: string[];
  expiresOn: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  createdAt: string;
}

export interface CouponQuote {
  code: string;
  plan: Plan;
  originalPaise: number;
  discountPaise: number;
  finalPaise: number;
}

/** Price after a coupon, never below zero. */
export function applyCoupon(pricePaise: number, coupon: Pick<Coupon, 'kind' | 'amount'>): number {
  const discount = coupon.kind === 'percent' ? Math.round((pricePaise * coupon.amount) / 100) : coupon.amount;
  return Math.max(0, pricePaise - discount);
}

// ---------- attendance & door check-in ----------

export const attendanceSchema = z.object({ attended: z.boolean() });

export interface Attendee {
  userId: string;
  name: string | null;
  phone: string;
  status: 'booked' | 'waitlisted';
  /** null = not marked yet. */
  attended: boolean | null;
}

/** QR at the gym door. Members scan it; the token proves they're physically there. Rotate if leaked. */
export interface DoorCode {
  /** Encoded in the QR: gymverse://checkin/<token> */
  token: string;
  url: string;
  rotatedAt: string;
}

export const qrCheckInSchema = z.object({
  method: z.enum(['button', 'qr', 'geo', 'staff']).default('button'),
  /** Required when method = 'qr'. */
  doorToken: z.string().min(8).max(200).optional(),
  /** Client time when the check-in happened (offline queue); accepted up to 12h old and counted for the gym day it happened on. */
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export interface Crowd {
  level: 'quiet' | 'moderate' | 'busy';
  /** Check-ins in the last 90 minutes. */
  recentCheckIns: number;
}

/** quiet < 10, moderate < 25, busy ≥ 25 recent check-ins (scaled for small gyms by member count). */
export function crowdLevel(recent: number, totalMembers: number): Crowd['level'] {
  const scale = Math.max(1, totalMembers / 200);
  if (recent < 10 * scale) return 'quiet';
  if (recent < 25 * scale) return 'moderate';
  return 'busy';
}

// ---------- referrals ----------

export interface ReferralInfo {
  /** Share text + link the member sends to friends. */
  link: string;
  message: string;
  /** Friends who joined with this member's link. */
  joined: number;
  reward: string | null;
}

export const referralSettingsSchema = z.object({ reward: z.string().trim().max(120).nullish() });

// ---------- revenue ----------

export interface RevenueReport {
  collectedThisMonthPaise: number;
  collectedLastMonthPaise: number;
  /** Paid amounts per day, last 30 days, oldest first. */
  daily: Array<{ day: string; paise: number }>;
  byPlan: Array<{ planId: string; planName: string; count: number; paise: number }>;
  /** Members whose membership ends in the next 7 days. */
  renewalsDue: Array<{ userId: string; name: string | null; phone: string; endsAt: string; planName: string }>;
  /** Members with no active membership (expired or never bought). */
  unpaidMembers: number;
  couponDiscountsThisMonthPaise: number;
}

// ---------- nudges ----------

/** Staff nudges a member: renewal reminder or a 'we miss you' for at-risk members. Max one per member per kind per day. */
export const nudgeSchema = z.object({ kind: z.enum(['renewal', 'inactive']), message: z.string().trim().max(200).nullish() });

// ---------- membership freeze ----------

export const freezeRequestSchema = z
  .object({
    startsOn: day,
    endsOn: day,
    reason: z.string().trim().min(2).max(300),
  })
  .refine((f) => f.endsOn >= f.startsOn, { message: 'The end date must be on or after the start date', path: ['endsOn'] });

export const freezeDecisionSchema = z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).nullish() });

export interface FreezeRequest {
  id: string;
  member: PersonRef;
  startsOn: string;
  endsOn: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** Membership end date after this pause is applied (approved), or if it were approved (pending). */
  newEndsAt: string | null;
}

/** Max freeze days per request; owners can't approve more. */
export const MAX_FREEZE_DAYS = 60;

// ---------- devices, consent, account ----------

export const deviceSchema = z.object({
  /** Expo push token: ExponentPushToken[...] */
  token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/, 'Not an Expo push token'),
  platform: z.enum(['ios', 'android', 'web']),
});

export const consentSchema = z.object({
  /** Version of the terms + privacy policy shown. */
  termsVersion: z.string().min(1).max(20),
  /** Required (true) when the member is under 18. */
  guardianConsent: z.boolean().optional(),
  guardianName: z.string().trim().max(60).nullish(),
});

export const CURRENT_TERMS_VERSION = '2026-11';

export interface ConsentState {
  termsVersion: string | null;
  acceptedAt: string | null;
  guardianConsent: boolean;
  guardianName: string | null;
  /** True when the member must (re)accept: never accepted or an older version. */
  needsConsent: boolean;
  /** True when the profile birth year says under 18 and there is no guardian consent yet. */
  needsGuardian: boolean;
}

export function isMinor(birthYear: number | null | undefined, now: Date): boolean {
  return !!birthYear && now.getFullYear() - birthYear < 18;
}

export interface AccountExport {
  exportedAt: string;
  user: unknown;
  profile: unknown;
  memberships: unknown[];
  checkIns: unknown[];
  bookings: unknown[];
  payments: unknown[];
  workouts: unknown[];
  measurements: unknown[];
  posts: unknown[];
  comments: unknown[];
  tickets: unknown[];
  notifications: unknown[];
}

export const deleteAccountSchema = z.object({ confirm: z.literal('DELETE') });

// ---------- platform admin ----------

export interface AdminGymRow {
  id: string;
  name: string;
  city: string;
  joinCode: string;
  planTier: 'starter' | 'pro' | 'enterprise';
  suspended: boolean;
  createdAt: string;
  owners: PersonRef[];
  members: number;
  activeMembers30d: number;
  checkIns30d: number;
  revenue30dPaise: number;
}

export interface AdminStats {
  gyms: number;
  suspendedGyms: number;
  users: number;
  members: number;
  checkInsToday: number;
  checkIns30d: number;
  revenue30dPaise: number;
  /** Weekly active members / members, as a fraction 0–1 (PRD goal ≥ 0.45). */
  weeklyActiveRate: number;
}

export const adminGymUpdateSchema = z.object({
  planTier: z.enum(['starter', 'pro', 'enterprise']).optional(),
  suspended: z.boolean().optional(),
});
