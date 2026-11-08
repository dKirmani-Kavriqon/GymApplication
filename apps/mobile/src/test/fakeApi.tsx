import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type {
  AppNotification,
  Article,
  Challenge,
  ClassSession,
  Comment,
  Exercise,
  Gym,
  LeaderboardEntry,
  MealIdea,
  MealPlan,
  MeResponse,
  MemberSummary,
  Plan,
  Post,
  Profile,
  ProgressStats,
  Routine,
  SupportInfo,
  SupportTicket,
  WorkoutLog,
} from '@gymverse/shared';
import { ApiError, type Api } from '../api/client';
import { SessionProvider, memoryStorage, useSession } from '../state/session';
import { NavProvider, useNav, type NavValue, type TabKey } from '../navigation/Nav';
import { ToastProvider } from '../components/Toast';
import { ThemeProvider } from '../theme/ThemeContext';

export const NOW = new Date('2026-11-08T09:00:00');

// ---------- fixtures ----------

export const gymFixture = (over: Partial<Gym> = {}): Gym => ({
  id: 'gym-1',
  name: 'Flex Fitness',
  city: 'Pune',
  timezone: 'Asia/Kolkata',
  joinCode: 'FLEX42',
  planTier: 'starter',
  enabledFeatures: ['checkin', 'classes', 'payments', 'progress', 'announcements', 'badges', 'workouts', 'nutrition', 'community', 'resources', 'support'],
  branding: {
    gymName: 'Flex Fitness',
    tagline: 'Stronger every day',
    logoUrl: null,
    primaryColor: '#6B0F1A',
    accentColor: '#B54B6A',
    themePreference: 'light',
    welcomeMessage: 'Welcome to Flex!',
  },
  ...over,
});

export const profileFixture = (over: Partial<Profile> = {}): Profile => ({
  goal: 'stay_active',
  gender: 'male',
  activityLevel: 'moderate',
  heightCm: 172,
  weightKg: 81,
  birthYear: 1974,
  bio: null,
  themeColor: null,
  themeMode: 'gym',
  showStats: true,
  weeklyGoal: 4,
  notifyClassReminders: true,
  notifyAnnouncements: true,
  notifyWorkoutReminders: true,
  language: 'en',
  setupComplete: true,
  ...over,
});

export const meFixture = (over: Partial<MeResponse> = {}): MeResponse => ({
  user: { id: 'u1', phone: '+919999900002', name: 'Ravi Kumar', avatarUrl: null },
  profile: profileFixture(),
  memberships: [{ gym: gymFixture(), role: 'member', joinedAt: '2026-10-01T00:00:00Z' }],
  ...over,
});

export const exerciseFixture = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'ex_squat',
  name: 'Goblet squat',
  muscleGroup: 'legs',
  equipment: 'dumbbell',
  instructions: ['Hold the dumbbell at your chest', 'Sit back and down', 'Drive up through your heels'],
  videoUrl: null,
  builtIn: true,
  ...over,
});

export const routineFixture = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  name: 'Push day',
  description: 'Chest, shoulders and triceps',
  level: 'intermediate',
  kind: 'preset',
  durationMin: 40,
  createdBy: { id: 'coach', name: 'Coach Vikram' },
  exercises: [
    { exerciseId: 'ex_bench', exercise: exerciseFixture({ id: 'ex_bench', name: 'Bench press', muscleGroup: 'chest', equipment: 'barbell' }), sets: 3, reps: 10, weightKg: 40, restSec: 90 },
    { exerciseId: 'ex_squat', exercise: exerciseFixture(), sets: 3, reps: 12, weightKg: 16, restSec: 60 },
  ],
  assignment: null,
  favourite: false,
  createdAt: '2026-10-20T00:00:00Z',
  ...over,
});

export const workoutFixture = (over: Partial<WorkoutLog> = {}): WorkoutLog => ({
  id: 'w1',
  routineId: 'r1',
  routineName: 'Push day',
  startedAt: '2026-11-06T07:00:00Z',
  completedAt: '2026-11-06T07:42:00Z',
  durationMin: 42,
  sets: [
    { exerciseId: 'ex_bench', exerciseName: 'Bench press', setNumber: 1, reps: 10, weightKg: 40 },
    { exerciseId: 'ex_bench', exerciseName: 'Bench press', setNumber: 2, reps: 8, weightKg: 42.5 },
  ],
  totalVolumeKg: 740,
  notes: null,
  ...over,
});

export const progressFixture = (over: Partial<ProgressStats> = {}): ProgressStats => ({
  totalWorkouts: 7,
  weekly: [
    { weekStart: '2026-09-21', workouts: 1, volumeKg: 900, checkIns: 2 },
    { weekStart: '2026-09-28', workouts: 2, volumeKg: 1500, checkIns: 3 },
    { weekStart: '2026-10-05', workouts: 0, volumeKg: 0, checkIns: 1 },
    { weekStart: '2026-10-12', workouts: 1, volumeKg: 800, checkIns: 2 },
    { weekStart: '2026-10-19', workouts: 2, volumeKg: 1700, checkIns: 4 },
    { weekStart: '2026-10-26', workouts: 1, volumeKg: 950, checkIns: 3 },
    { weekStart: '2026-11-02', workouts: 2, volumeKg: 1800, checkIns: 3 },
    { weekStart: '2026-11-09', workouts: 0, volumeKg: 0, checkIns: 0 },
  ],
  weight: [
    { day: '2026-10-01', kg: 83 },
    { day: '2026-10-15', kg: 82.2 },
    { day: '2026-11-01', kg: 81.4 },
    { day: '2026-11-07', kg: 81 },
  ],
  personalBests: [{ exerciseId: 'ex_bench', exerciseName: 'Bench press', weightKg: 42.5, reps: 8, on: '2026-11-06' }],
  ...over,
});

export const articleFixture = (over: Partial<Article> = {}): Article => ({
  id: 'a1',
  kind: 'article',
  title: 'How to warm up properly',
  summary: 'Five minutes that prevent most gym injuries.',
  body: 'Start with light cardio.\n\nThen move through each joint.',
  imageUrl: null,
  videoUrl: null,
  tags: ['beginner', 'mobility'],
  readMinutes: 3,
  publishedAt: '2026-11-01T00:00:00Z',
  author: { id: 'coach', name: 'Coach Vikram' },
  favourite: false,
  ...over,
});

export const mealIdeaFixture = (over: Partial<MealIdea> = {}): MealIdea => ({
  id: 'm1',
  title: 'Paneer bhurji wrap',
  mealType: 'lunch',
  calories: 480,
  proteinG: 32,
  carbsG: 40,
  fatG: 20,
  ingredients: ['100 g paneer', '1 roti', 'Onion, tomato, spices'],
  steps: ['Crumble the paneer', 'Cook with onion and tomato', 'Wrap in the roti'],
  imageUrl: null,
  tags: ['high protein', 'vegetarian'],
  favourite: false,
  ...over,
});

export const mealPlanFixture = (over: Partial<MealPlan> = {}): MealPlan => ({
  id: 'mp1',
  title: 'Lean & strong (veg)',
  goal: 'build_muscle',
  description: 'High-protein vegetarian day.',
  caloriesPerDay: 2200,
  meals: [
    { slot: 'breakfast', title: 'Oats with whey', description: 'Oats, milk, banana, 1 scoop whey', calories: 520, proteinG: 38 },
    { slot: 'lunch', title: 'Dal, rice, paneer', description: '1 bowl dal, 1 cup rice, 100 g paneer', calories: 700, proteinG: 40 },
  ],
  favourite: false,
  ...over,
});

export const postFixture = (over: Partial<Post> = {}): Post => ({
  id: 'p1',
  author: { id: 'u2', name: 'Anita Desai', role: 'member' },
  body: 'Hit a new deadlift PR today! 🎉',
  createdAt: '2026-11-08T06:00:00Z',
  likeCount: 4,
  commentCount: 1,
  likedByMe: false,
  mine: false,
  hidden: false,
  ...over,
});

export const commentFixture = (over: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  author: { id: 'u3', name: 'Karan Mehta' },
  body: 'Congrats!',
  createdAt: '2026-11-08T06:30:00Z',
  mine: false,
  ...over,
});

export const challengeFixture = (over: Partial<Challenge> = {}): Challenge => ({
  id: 'ch1',
  title: '30 check-ins in November',
  description: 'Show up 30 times this month.',
  metric: 'checkins',
  target: 30,
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  status: 'active',
  participantCount: 12,
  joined: true,
  myProgress: 6,
  myRank: 4,
  ...over,
});

export const leaderboardFixture = (): LeaderboardEntry[] => [
  { rank: 1, user: { id: 'u2', name: 'Anita Desai' }, progress: 7, completed: false, isMe: false },
  { rank: 2, user: { id: 'u1', name: 'Ravi Kumar' }, progress: 6, completed: false, isMe: true },
];

export const notificationFixture = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  kind: 'routine_assigned',
  title: 'Coach Vikram assigned you Push day',
  body: 'Start with lighter weights this week.',
  createdAt: '2026-11-08T07:00:00Z',
  read: false,
  link: 'routine:r1',
  ...over,
});

export const supportFixture = (over: Partial<SupportInfo> = {}): SupportInfo => ({
  phone: '+91 98200 00000',
  whatsapp: '+91 98200 00000',
  email: 'hello@flexfitness.in',
  address: 'FC Road, Pune',
  hours: 'Mon–Sat 5am–11pm, Sun 6am–12pm',
  faqs: [
    { q: 'Can I freeze my membership?', a: 'Yes, up to 30 days a year. Ask at the front desk.' },
    { q: 'Are towels provided?', a: 'Towels are ₹20 at the desk.' },
  ],
  ...over,
});

export const ticketFixture = (over: Partial<SupportTicket> = {}): SupportTicket => ({
  id: 't1',
  subject: 'Locker key lost',
  status: 'answered',
  createdAt: '2026-11-05T10:00:00Z',
  updatedAt: '2026-11-05T12:00:00Z',
  member: { id: 'u1', name: 'Ravi Kumar' },
  messages: [
    { id: 'tm1', from: 'member', author: { id: 'u1', name: 'Ravi Kumar' }, body: 'I lost my locker key.', at: '2026-11-05T10:00:00Z' },
    { id: 'tm2', from: 'staff', author: { id: 'o1', name: 'Priya Sharma' }, body: 'No problem, collect a spare at the desk.', at: '2026-11-05T12:00:00Z' },
  ],
  ...over,
});

export const summaryFixture = (over: Partial<MemberSummary> = {}): MemberSummary => ({
  checkedInToday: false,
  streak: { current: 3, longest: 5 },
  totalCheckIns: 12,
  badges: ['first_checkin', 'streak_3'],
  nextClass: null,
  announcement: { id: 'a1', title: 'Diwali timings', body: 'Open 6am to 12pm', pinned: true, createdAt: '2026-11-07T00:00:00Z' },
  membership: { state: 'expiring', daysLeft: 5, planName: 'Monthly', endsAt: '2026-11-13T09:00:00Z' },
  recentDays: ['2026-11-05', '2026-11-06', '2026-11-07'],
  weekly: { goal: 4, visits: 3, percent: 75, deltaVsLastWeek: 1, days: [1, 0, 1, 0, 1, 0, 0] },
  unreadNotifications: 2,
  activeChallenge: challengeFixture(),
  recommendedRoutine: routineFixture({ assignment: { by: { id: 'coach', name: 'Coach Vikram' }, note: 'Go light this week', at: '2026-11-07T00:00:00Z' } }),
  ...over,
});

export const classFixture = (over: Partial<ClassSession> = {}): ClassSession => ({
  id: 'c1',
  title: 'Morning Yoga',
  trainerName: 'Coach Vikram',
  startsAt: '2026-11-09T07:00:00',
  durationMin: 45,
  capacity: 10,
  bookedCount: 4,
  waitlistCount: 0,
  myStatus: null,
  myWaitlistPosition: null,
  ...over,
});

export const plansFixture: Plan[] = [
  { id: 'p1', name: 'Monthly', durationDays: 30, pricePaise: 149900, benefits: ['Locker'] },
  { id: 'p2', name: 'Quarterly', durationDays: 90, pricePaise: 399900, benefits: ['Locker', '1 PT session'] },
];

// ---------- fake API ----------

export type FakeApi = { [K in keyof Api]: jest.Mock };

/** A jest-mocked Api with happy-path defaults for every endpoint; override any method per test. */
export function makeFakeApi(over: Partial<Record<keyof Api, (...args: any[]) => any>> = {}): FakeApi {
  const defaults: Record<keyof Api, (...args: any[]) => any> = {
    requestOtp: async () => ({ sent: true, devCode: '123456' }),
    verifyOtp: async () => ({ token: 'tok', isNewUser: false, user: meFixture().user }),
    me: async () => meFixture(),
    updateProfile: async (p: any) => {
      const m = meFixture();
      return { ...m, user: { ...m.user, name: p.name ?? m.user.name }, profile: { ...m.profile, ...p } };
    },
    previewGym: async (code: string) => {
      if (code !== 'FLEX42') throw new ApiError(404, 'not_found', 'We could not find a gym with that code.');
      const g = gymFixture();
      return { name: g.name, city: g.city, joinCode: g.joinCode, branding: g.branding };
    },
    joinGym: async () => ({ gym: gymFixture(), role: 'member', alreadyMember: false }),
    summary: async () => summaryFixture(),
    checkIn: async () => ({ alreadyCheckedIn: false, checkedInAt: NOW.toISOString(), streak: { current: 4, longest: 5 }, newBadges: [], totalCheckIns: 13 }),
    classes: async () => ({ classes: [classFixture()] }),
    book: async () => ({ session: classFixture({ myStatus: 'booked', bookedCount: 5 }), newBadges: [] }),
    cancelBooking: async () => ({ session: classFixture() }),
    plans: async () => ({ plans: plansFixture }),
    createOrder: async (_g: string, planId: string) => {
      const plan = plansFixture.find((p) => p.id === planId)!;
      return { paymentId: 'pay-1', providerOrderId: 'order_1', amountPaise: plan.pricePaise, currency: 'INR', plan, status: 'created', provider: 'mock', mockSignature: 'sig' };
    },
    verifyPayment: async () => ({ paymentId: 'pay-1', status: 'paid', membershipEndsAt: '2027-02-11T09:00:00Z', receiptNumber: 'FLEX42-00007' }),
    payments: async () => ({ payments: [] }),
    payment: async (_g: string, id: string) => ({ id, planName: 'Quarterly', amountPaise: 399900, status: 'paid', receiptNumber: 'FLEX42-00008', createdAt: NOW.toISOString(), paidAt: NOW.toISOString(), membershipEndsAt: '2027-02-11T09:00:00Z' }),
    announcements: async () => ({ announcements: [summaryFixture().announcement] }),

    exercises: async () => ({ exercises: [exerciseFixture(), exerciseFixture({ id: 'ex_bench', name: 'Bench press', muscleGroup: 'chest', equipment: 'barbell' })] }),
    routines: async () => ({
      assigned: [routineFixture({ id: 'r1', assignment: { by: { id: 'coach', name: 'Coach Vikram' }, note: 'Go light this week', at: '2026-11-07T00:00:00Z' } })],
      presets: [routineFixture({ id: 'r2', name: 'Beginner full body', level: 'beginner' })],
      mine: [routineFixture({ id: 'r3', name: 'My arm day', kind: 'custom', createdBy: { id: 'u1', name: 'Ravi Kumar' } })],
    }),
    routine: async (_g: string, id: string) => routineFixture({ id }),
    createRoutine: async (_g: string, input: any) => routineFixture({ id: 'r-new', name: input.name, kind: 'custom' }),
    updateRoutine: async (_g: string, id: string, input: any) => routineFixture({ id, name: input.name, kind: 'custom' }),
    deleteRoutine: async () => undefined,
    logWorkout: async () => ({ workout: workoutFixture({ id: 'w-new' }), newBadges: [] }),
    workouts: async () => ({ workouts: [workoutFixture()] }),
    progress: async () => progressFixture(),
    measurements: async () => ({ measurements: [{ id: 'ms1', measuredOn: '2026-11-07', weightKg: 81, bodyFatPct: null, waistCm: null }] }),
    addMeasurement: async (m: any) => ({ id: 'ms-new', bodyFatPct: null, waistCm: null, weightKg: null, ...m }),
    deleteMeasurement: async () => undefined,

    articles: async () => ({ articles: [articleFixture(), articleFixture({ id: 'a2', kind: 'video', title: 'Perfect push-up form', videoUrl: 'https://example.com/v.mp4' }), articleFixture({ id: 'a3', kind: 'tip', title: 'Drink water before you feel thirsty' })] }),
    article: async (_g: string, id: string) => articleFixture({ id }),
    favourites: async () => ({ articles: [], routines: [], mealIdeas: [], mealPlans: [] }),
    setFavourite: async (_g: string, _k: string, _id: string, on: boolean) => ({ favourite: on }),

    mealPlans: async () => ({ mealPlans: [mealPlanFixture()] }),
    mealPlan: async (_g: string, id: string) => mealPlanFixture({ id }),
    mealIdeas: async () => ({ mealIdeas: [mealIdeaFixture(), mealIdeaFixture({ id: 'm2', title: 'Moong dal chilla', mealType: 'breakfast' })] }),
    mealIdea: async (_g: string, id: string) => mealIdeaFixture({ id }),

    posts: async () => ({ posts: [postFixture()] }),
    createPost: async (_g: string, body: string) => postFixture({ id: 'p-new', body, mine: true, likeCount: 0, commentCount: 0, author: { id: 'u1', name: 'Ravi Kumar', role: 'member' } }),
    deletePost: async () => undefined,
    setLike: async (_g: string, _id: string, on: boolean) => ({ likeCount: on ? 5 : 4, likedByMe: on }),
    comments: async () => ({ comments: [commentFixture()] }),
    addComment: async (_g: string, _p: string, body: string) => commentFixture({ id: 'c-new', body, mine: true, author: { id: 'u1', name: 'Ravi Kumar' } }),
    deleteComment: async () => undefined,
    challenges: async () => ({ challenges: [challengeFixture(), challengeFixture({ id: 'ch2', title: 'Log 8 workouts', metric: 'workouts', target: 8, joined: false, myProgress: 0, myRank: null })] }),
    setJoined: async (_g: string, id: string, on: boolean) => {
      const base = id === 'ch2' ? challengeFixture({ id: 'ch2', title: 'Log 8 workouts', metric: 'workouts', target: 8 }) : challengeFixture({ id });
      return { ...base, joined: on, myProgress: on ? base.myProgress : 0, myRank: on ? base.myRank : null };
    },
    leaderboard: async () => ({ entries: leaderboardFixture() }),

    notifications: async () => ({ notifications: [notificationFixture(), notificationFixture({ id: 'n2', kind: 'announcement', title: 'Diwali timings', body: 'Open 6am to 12pm', link: 'announcements', read: true, createdAt: '2026-11-06T07:00:00Z' })], unread: 1 }),
    markRead: async () => ({ unread: 0 }),

    supportInfo: async () => supportFixture(),
    tickets: async () => ({ tickets: [ticketFixture()] }),
    ticket: async (_g: string, id: string) => ticketFixture({ id }),
    createTicket: async (_g: string, subject: string, message: string) =>
      ticketFixture({ id: 't-new', subject, status: 'open', messages: [{ id: 'm', from: 'member', author: { id: 'u1', name: 'Ravi Kumar' }, body: message, at: NOW.toISOString() }] }),
    replyTicket: async (_g: string, id: string, body: string) => {
      const t = ticketFixture({ id });
      return { ...t, status: 'open', messages: [...t.messages, { id: 'm-new', from: 'member', author: { id: 'u1', name: 'Ravi Kumar' }, body, at: NOW.toISOString() }] };
    },
    setTicketStatus: async (_g: string, id: string, status: any) => ticketFixture({ id, status }),

    registerDevice: async () => undefined,
    acceptConsent: async (input: any) => ({
      termsVersion: input.termsVersion,
      acceptedAt: NOW.toISOString(),
      guardianConsent: !!input.guardianConsent,
      guardianName: input.guardianName ?? null,
      needsConsent: false,
      needsGuardian: false,
    }),
    exportAccount: async () => ({ exportedAt: NOW.toISOString(), user: meFixture().user, profile: profileFixture(), memberships: [], checkIns: [], bookings: [], payments: [], workouts: [], measurements: [], posts: [], comments: [], tickets: [], notifications: [] }),
    deleteAccount: async () => undefined,
    checkInWith: async () => ({ alreadyCheckedIn: false, checkedInAt: NOW.toISOString(), streak: { current: 4, longest: 5 }, newBadges: [], totalCheckIns: 13 }),
    quoteCoupon: async (_g: string, code: string, planId: string) => {
      if (code.toUpperCase() !== 'DIWALI20') throw new ApiError(404, 'not_found', "That code isn't valid.");
      const plan = plansFixture.find((p) => p.id === planId)!;
      return { code: 'DIWALI20', plan, originalPaise: plan.pricePaise, discountPaise: Math.round(plan.pricePaise * 0.2), finalPaise: plan.pricePaise - Math.round(plan.pricePaise * 0.2) };
    },
    createOrderWithCoupon: async (_g: string, planId: string, couponCode?: string) => {
      const plan = plansFixture.find((p) => p.id === planId)!;
      const amount = couponCode ? plan.pricePaise - Math.round(plan.pricePaise * 0.2) : plan.pricePaise;
      return { paymentId: 'pay-1', providerOrderId: 'order_1', amountPaise: amount, currency: 'INR', plan, status: 'created', provider: 'mock', mockSignature: 'sig' };
    },
    referral: async () => ({ link: 'https://gymverse.app/join/FLEX42?ref=u1', message: 'Join me at Flex Fitness!', joined: 2, reward: '1 week free for both of you' }),
    freezeRequests: async () => ({ requests: [] }),
    requestFreeze: async (_g: string, input: any) => ({
      id: 'fr1',
      member: { id: 'u1', name: 'Ravi Kumar' },
      days: 11,
      status: 'pending',
      note: null,
      createdAt: NOW.toISOString(),
      decidedAt: null,
      ...input,
    }),
    trainerToday: async () => ({
      classes: [
        {
          ...classFixture({ id: 'c1', title: 'Morning Yoga', startsAt: '2026-11-08T07:00:00', bookedCount: 2 }),
          attendees: [
            { userId: 'u2', name: 'Anita Desai', phone: '+919999900100', status: 'booked', attended: null },
            { userId: 'u3', name: 'Karan Mehta', phone: '+919999900101', status: 'booked', attended: true },
          ],
        },
      ],
    }),
    markAttendance: async (_g: string, _c: string, userId: string, attended: boolean) => ({ userId, name: 'Anita Desai', phone: '+919999900100', status: 'booked', attended }),

    search: async (_g: string, q: string) => ({
      query: q,
      classes: [classFixture()],
      routines: [routineFixture()],
      exercises: [exerciseFixture()],
      articles: [articleFixture()],
      mealIdeas: [mealIdeaFixture()],
      trainers: [{ id: 'coach', name: 'Coach Vikram' }],
    }),
  };
  const out = {} as FakeApi;
  for (const key of Object.keys(defaults) as Array<keyof Api>) out[key] = jest.fn(over[key] ?? defaults[key]);
  return out;
}

// ---------- render helpers ----------

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** Renders children only once the restored session has a gym (screens assume one). */
function WhenReady({ children }: { children: React.ReactElement }) {
  const { status, activeGym } = useSession();
  return status === 'signedIn' && activeGym ? children : null;
}

function NavProbe({ into }: { into: { current: NavValue | null } }) {
  into.current = useNav();
  return null;
}

/**
 * Renders `ui` inside the real SessionProvider (backed by a fake API), NavProvider, ToastProvider
 * and ThemeProvider. Signed in with a gym unless `signedIn: false`.
 * `nav()` returns the live navigation state so tests can assert pushes: expect(nav().stack.at(-1)?.name).toBe('Article').
 */
export function renderApp(
  ui: React.ReactElement,
  { api = makeFakeApi(), signedIn = true, gate, tab = 'home' as TabKey }: { api?: FakeApi; signedIn?: boolean; gate?: boolean; tab?: TabKey } = {},
) {
  const storage = memoryStorage(signedIn ? { 'gv.token': 'tok', 'gv.introSeen': '1' } : { 'gv.introSeen': '1' });
  const navRef: { current: NavValue | null } = { current: null };
  const shouldGate = gate ?? (signedIn && (ui.type as { isRoot?: boolean })?.isRoot !== true);
  const utils = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SessionProvider makeApi={() => api as unknown as Api} storage={storage}>
        <ThemeProvider>
          <NavProvider initialTab={tab}>
            <ToastProvider>
              <NavProbe into={navRef} />
              {shouldGate ? <WhenReady>{ui}</WhenReady> : ui}
            </ToastProvider>
          </NavProvider>
        </ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>,
  );
  return { ...utils, api, storage, nav: () => navRef.current! };
}
