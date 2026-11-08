import { FEATURES, addDays } from '@gymverse/shared';
import type { AttendanceReport, Gym, MeResponse, MemberRow, Plan, Role } from '@gymverse/shared';

export function makeGym(overrides: Partial<Gym> = {}): Gym {
  return {
    id: 'gym-1',
    name: 'Flex Fitness',
    city: 'Pune',
    timezone: 'Asia/Kolkata',
    joinCode: 'FLEX42',
    branding: {
      gymName: 'Flex Fitness',
      tagline: 'Stronger every day',
      logoUrl: null,
      primaryColor: '#E11D48',
      accentColor: '#D97706',
      themePreference: 'auto',
      welcomeMessage: 'Welcome to Flex!',
    },
    enabledFeatures: [...FEATURES],
    planTier: 'starter',
    ...overrides,
  };
}

export function makeMe(role: Role = 'owner', gym: Gym = makeGym()): MeResponse {
  return {
    user: { id: 'user-owner', phone: '+919999900001', name: 'Priya Sharma', avatarUrl: null },
    profile: {
      goal: null,
      gender: null,
      activityLevel: null,
      heightCm: null,
      weightKg: null,
      birthYear: null,
      bio: null,
      themeColor: null,
      themeMode: 'gym',
      showStats: true,
      weeklyGoal: 3,
      notifyClassReminders: true,
      notifyAnnouncements: true,
      notifyWorkoutReminders: true,
      language: 'en',
      setupComplete: true,
    },
    memberships: [{ gym, role, joinedAt: '2026-01-01T00:00:00.000Z' }],
  };
}

export function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    userId: 'u-' + Math.random().toString(36).slice(2, 8),
    name: 'Member',
    phone: '+919999900100',
    role: 'member',
    joinedAt: '2026-09-01T00:00:00.000Z',
    lastVisit: '2026-11-01',
    totalCheckIns: 3,
    membership: { state: 'active', daysLeft: 20, endsAt: '2026-11-28T00:00:00.000Z' },
    atRisk: false,
    ...overrides,
  };
}

export const MEMBERS: MemberRow[] = [
  makeMember({ userId: 'u-owner', name: 'Priya Sharma', phone: '+919999900001', role: 'owner', lastVisit: null, totalCheckIns: 0, membership: { state: 'none', daysLeft: 0, endsAt: null } }),
  makeMember({ userId: 'u-ravi', name: 'Ravi Kumar', phone: '+919999900002', totalCheckIns: 12 }),
  makeMember({
    userId: 'u-anita',
    name: 'Anita Desai',
    phone: '+919999900100',
    lastVisit: '2026-10-01',
    atRisk: true,
    membership: { state: 'expired', daysLeft: 0, endsAt: '2026-10-20T00:00:00.000Z' },
  }),
  makeMember({ userId: 'u-vikram', name: 'Coach Vikram', phone: '+919999900003', role: 'trainer', totalCheckIns: 0 }),
];

export function makeReport(): AttendanceReport {
  const days = Array.from({ length: 14 }, (_, i) => ({ day: addDays('2026-10-26', i), count: i % 4 }));
  return {
    days,
    peakHours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 7 ? 9 : hour === 18 ? 6 : 0 })),
    today: 4,
    activeMembers: 5,
    totalMembers: 6,
  };
}

export const PLANS: Plan[] = [
  { id: 'p1', name: 'Monthly', durationDays: 30, pricePaise: 149900, benefits: ['Full gym access', 'Locker'] },
  { id: 'p2', name: 'Yearly', durationDays: 365, pricePaise: 1299900, benefits: [] },
];
