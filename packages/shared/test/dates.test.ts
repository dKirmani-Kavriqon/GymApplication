import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeStreak,
  dayKey,
  daysBetween,
  earnedBadges,
  formatInr,
  hourOf,
  joinCodeSchema,
  membershipStatus,
  phoneSchema,
  profileSchema,
} from '../src';

describe('day helpers', () => {
  it('computes the calendar day in the gym time zone', () => {
    // 20:00 UTC is already the next day in India (UTC+5:30).
    const d = new Date('2026-11-07T20:00:00Z');
    expect(dayKey(d, 'UTC')).toBe('2026-11-07');
    expect(dayKey(d, 'Asia/Kolkata')).toBe('2026-11-08');
    expect(hourOf(d, 'Asia/Kolkata')).toBe(1);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7);
  });
});

describe('computeStreak', () => {
  it('is zero with no visits', () => {
    expect(computeStreak([], '2026-11-08')).toEqual({ current: 0, longest: 0 });
  });

  it('counts consecutive days ending today', () => {
    const days = ['2026-11-06', '2026-11-07', '2026-11-08'];
    expect(computeStreak(days, '2026-11-08')).toEqual({ current: 3, longest: 3 });
  });

  it('keeps the streak alive until the member misses a full day', () => {
    const days = ['2026-11-06', '2026-11-07'];
    expect(computeStreak(days, '2026-11-08').current).toBe(2);
    expect(computeStreak(days, '2026-11-09').current).toBe(0);
  });

  it('tracks the longest run separately and ignores duplicates', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-03', '2026-11-04', '2026-11-07', '2026-11-08'];
    expect(computeStreak(days, '2026-11-08')).toEqual({ current: 2, longest: 4 });
  });
});

describe('membershipStatus', () => {
  const now = new Date('2026-11-08T10:00:00Z');
  it('classifies none / active / expiring / expired', () => {
    expect(membershipStatus(null, now)).toEqual({ state: 'none', daysLeft: 0 });
    expect(membershipStatus('2026-12-08T10:00:00Z', now)).toEqual({ state: 'active', daysLeft: 30 });
    expect(membershipStatus('2026-11-13T10:00:00Z', now)).toEqual({ state: 'expiring', daysLeft: 5 });
    expect(membershipStatus('2026-11-01T10:00:00Z', now)).toEqual({ state: 'expired', daysLeft: 0 });
  });
});

describe('badges', () => {
  it('awards badges by stats', () => {
    expect(earnedBadges({ totalCheckIns: 0, longestStreak: 0, totalBookings: 0 })).toEqual([]);
    expect(earnedBadges({ totalCheckIns: 10, longestStreak: 7, totalBookings: 1 })).toEqual([
      'first_checkin',
      'streak_3',
      'streak_7',
      'checkins_10',
      'first_class',
    ]);
  });
});

describe('schemas', () => {
  it('cleans phone numbers', () => {
    expect(phoneSchema.parse(' +91 98765-43210 ')).toBe('+919876543210');
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });

  it('upper-cases join codes', () => {
    expect(joinCodeSchema.parse('ab12cd')).toBe('AB12CD');
    expect(joinCodeSchema.safeParse('ABC').success).toBe(false);
  });

  it('validates profile fields', () => {
    expect(profileSchema.parse({ goal: 'build_muscle', themeColor: '#abc' }).themeColor).toBe('#AABBCC');
    expect(profileSchema.safeParse({ goal: 'fly' }).success).toBe(false);
    expect(profileSchema.safeParse({ heightCm: 20 }).success).toBe(false);
  });

  it('formats rupees from paise', () => {
    expect(formatInr(149900)).toBe('₹1,499');
    expect(formatInr(1205050)).toBe('₹12,050.50');
  });
});
