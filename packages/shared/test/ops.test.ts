import { describe, expect, it } from 'vitest';
import { applyCoupon, couponSchema, crowdLevel, deviceSchema, freezeRequestSchema, isMinor } from '../src';

describe('coupons', () => {
  it('applies percent and flat discounts, never below zero', () => {
    expect(applyCoupon(149900, { kind: 'percent', amount: 20 })).toBe(119920);
    expect(applyCoupon(149900, { kind: 'flat', amount: 50000 })).toBe(99900);
    expect(applyCoupon(10000, { kind: 'flat', amount: 50000 })).toBe(0);
    expect(applyCoupon(149900, { kind: 'percent', amount: 100 })).toBe(0);
  });

  it('validates codes and caps percentages at 100', () => {
    expect(couponSchema.parse({ code: 'diwali20', kind: 'percent', amount: 20 }).code).toBe('DIWALI20');
    expect(couponSchema.safeParse({ code: 'x', kind: 'flat', amount: 100 }).success).toBe(false);
    expect(couponSchema.safeParse({ code: 'BIG', kind: 'percent', amount: 150 }).success).toBe(false);
  });
});

describe('crowd meter', () => {
  it('classifies by recent check-ins, scaled to gym size', () => {
    expect(crowdLevel(3, 100)).toBe('quiet');
    expect(crowdLevel(12, 100)).toBe('moderate');
    expect(crowdLevel(30, 100)).toBe('busy');
    expect(crowdLevel(30, 1000)).toBe('quiet'); // a big gym needs more people to feel busy
    expect(crowdLevel(60, 1000)).toBe('moderate');
  });
});

describe('consent & freeze', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  it('detects minors from birth year', () => {
    expect(isMinor(2010, now)).toBe(true);
    expect(isMinor(2000, now)).toBe(false);
    expect(isMinor(null, now)).toBe(false);
  });

  it('validates freeze dates and push tokens', () => {
    expect(freezeRequestSchema.safeParse({ startsOn: '2026-11-10', endsOn: '2026-11-01', reason: 'Travel' }).success).toBe(false);
    expect(freezeRequestSchema.safeParse({ startsOn: '2026-11-10', endsOn: '2026-11-20', reason: 'Travel' }).success).toBe(true);
    expect(deviceSchema.safeParse({ token: 'ExponentPushToken[abc123]', platform: 'ios' }).success).toBe(true);
    expect(deviceSchema.safeParse({ token: 'random', platform: 'ios' }).success).toBe(false);
  });
});
