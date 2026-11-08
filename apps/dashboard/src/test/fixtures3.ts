import { addDays } from '@gymverse/shared';
import type { AdminGymRow, AdminStats, Coupon, DoorCode, FreezeRequest, RevenueReport } from '@gymverse/shared';

export function makeCoupon(o: Partial<Coupon> = {}): Coupon {
  return {
    id: 'cp-1',
    code: 'WELCOME10',
    kind: 'percent',
    amount: 10,
    planIds: [],
    expiresOn: null,
    maxUses: null,
    uses: 3,
    active: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...o,
  };
}

export function makeRevenue(o: Partial<RevenueReport> = {}): RevenueReport {
  return {
    collectedThisMonthPaise: 1_200_000,
    collectedLastMonthPaise: 1_000_000,
    daily: Array.from({ length: 30 }, (_, i) => ({ day: addDays('2026-10-10', i), paise: i % 3 === 0 ? 149_900 : 0 })),
    byPlan: [
      { planId: 'p1', planName: 'Monthly', count: 6, paise: 899_400 },
      { planId: 'p2', planName: 'Yearly', count: 1, paise: 300_600 },
    ],
    renewalsDue: [{ userId: 'u-ravi', name: 'Ravi Kumar', phone: '+919999900002', endsAt: '2026-11-12T00:00:00.000Z', planName: 'Monthly' }],
    unpaidMembers: 4,
    couponDiscountsThisMonthPaise: 45_000,
    ...o,
  };
}

export const DOOR: DoorCode = { token: 'door-token-aaaa', url: 'gymverse://checkin/door-token-aaaa', rotatedAt: '2026-11-01T10:00:00.000Z' };

export function makeFreeze(o: Partial<FreezeRequest> = {}): FreezeRequest {
  return {
    id: 'fr-1',
    member: { id: 'u-ravi', name: 'Ravi Kumar' },
    startsOn: '2026-11-15',
    endsOn: '2026-11-28',
    days: 14,
    reason: 'Travelling for work',
    status: 'pending',
    note: null,
    createdAt: '2026-11-07T10:00:00.000Z',
    decidedAt: null,
    newEndsAt: null,
    ...o,
  };
}

export const ADMIN_STATS: AdminStats = {
  gyms: 12,
  suspendedGyms: 1,
  users: 840,
  members: 790,
  checkInsToday: 133,
  checkIns30d: 4210,
  revenue30dPaise: 98_765_00,
  weeklyActiveRate: 0.38,
};

export function makeAdminGym(o: Partial<AdminGymRow> = {}): AdminGymRow {
  return {
    id: 'gym-1',
    name: 'Flex Fitness',
    city: 'Pune',
    joinCode: 'FLEX42',
    planTier: 'starter',
    suspended: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    owners: [{ id: 'user-owner', name: 'Priya Sharma' }],
    members: 120,
    activeMembers30d: 80,
    checkIns30d: 900,
    revenue30dPaise: 1_200_000,
    ...o,
  };
}
