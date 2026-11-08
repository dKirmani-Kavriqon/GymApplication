import type {
  ActivityLevel,
  ArticleKind,
  ChallengeMetric,
  Equipment,
  FeatureKey,
  Gender,
  GoalId,
  Language,
  Level,
  MealType,
  MuscleGroup,
  NotificationKind,
  Role,
} from './schemas';
import type { MembershipStatus, Streak } from './dates';
import type { MemberThemeMode, ThemePreference } from './theme';
import type { ConsentState, Crowd } from './ops';

// ---------- people & gyms ----------

export interface User {
  id: string;
  phone: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Profile {
  goal: GoalId | null;
  gender: Gender | null;
  activityLevel: ActivityLevel | null;
  heightCm: number | null;
  weightKg: number | null;
  birthYear: number | null;
  bio: string | null;
  /** Member's own theme colour; null = use the gym's colours. */
  themeColor: string | null;
  /** 'gym' = follow the gym's light/dark preference. */
  themeMode: MemberThemeMode;
  showStats: boolean;
  /** Target gym visits per week (weekly goal card). Default 3. */
  weeklyGoal: number;
  notifyClassReminders: boolean;
  notifyAnnouncements: boolean;
  notifyWorkoutReminders: boolean;
  language: Language;
  /** True once the set-up wizard has been finished or skipped. */
  setupComplete: boolean;
}

export interface GymBranding {
  gymName: string;
  tagline: string | null;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  themePreference: ThemePreference;
  welcomeMessage: string | null;
}

export interface Gym {
  id: string;
  name: string;
  city: string;
  timezone: string;
  joinCode: string;
  branding: GymBranding;
  enabledFeatures: FeatureKey[];
  planTier: 'starter' | 'pro' | 'enterprise';
  /** v0.3: suspended by the platform admin (members see a notice, API returns 403 gym_suspended). */
  suspended?: boolean;
}

/** What an unauthenticated visitor sees after scanning a gym QR/code. */
export interface GymPreview {
  name: string;
  city: string;
  joinCode: string;
  branding: GymBranding;
}

export interface GymMembership {
  gym: Gym;
  role: Role;
  joinedAt: string;
}

export interface MeResponse {
  user: User;
  profile: Profile;
  memberships: GymMembership[];
  /** v0.3: terms/guardian consent state. */
  consent?: ConsentState;
  /** v0.3: may use the platform admin console. */
  isPlatformAdmin?: boolean;
}

export interface PersonRef {
  id: string;
  name: string | null;
}

// ---------- classes, plans, payments ----------

export interface ClassSession {
  id: string;
  title: string;
  trainerName: string | null;
  startsAt: string;
  durationMin: number;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  myStatus: 'booked' | 'waitlisted' | null;
  myWaitlistPosition: number | null;
}

export interface Plan {
  id: string;
  name: string;
  durationDays: number;
  pricePaise: number;
  benefits: string[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

export interface PaymentOrder {
  paymentId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  plan: Plan;
  status: 'created' | 'paid' | 'failed';
  /** Which checkout the client should open (Razorpay/Stripe in production). */
  provider: string;
  /** Only present with the development mock provider: lets the client complete checkout. */
  mockSignature?: string;
  /** Razorpay public key id, for opening checkout. */
  keyId?: string;
  /** Hosted checkout page for this order (production gateways). */
  checkoutUrl?: string;
  couponCode?: string | null;
  discountPaise?: number;
}

export interface PaymentRecord {
  id: string;
  planName: string;
  amountPaise: number;
  status: 'created' | 'paid' | 'failed';
  receiptNumber: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentResult {
  paymentId: string;
  status: 'paid';
  membershipEndsAt: string;
  receiptNumber: string;
}

// ---------- home & check-in ----------

export interface WeeklyGoal {
  /** Visits per week the member is aiming for. */
  goal: number;
  /** Check-ins so far this week (Monday-start, gym time zone). */
  visits: number;
  /** 0–100, capped. */
  percent: number;
  /** visits this week minus visits last week. */
  deltaVsLastWeek: number;
  /** Check-ins per day this week, Monday first (7 numbers, 0 or 1). */
  days: number[];
}

export interface MemberSummary {
  checkedInToday: boolean;
  streak: Streak;
  totalCheckIns: number;
  badges: string[];
  nextClass: ClassSession | null;
  announcement: Announcement | null;
  membership: MembershipStatus & { planName: string | null; endsAt: string | null };
  /** Days (YYYY-MM-DD) with a check-in in the last 28 days. */
  recentDays: string[];
  weekly: WeeklyGoal;
  unreadNotifications: number;
  /** A challenge the member has joined that is running now, else the newest active one. */
  activeChallenge: Challenge | null;
  /** Most recent routine assigned by a trainer, else a gym preset. */
  recommendedRoutine: Routine | null;
  /** v0.3: how busy the gym is right now. */
  crowd?: Crowd;
}

export interface CheckInResult {
  alreadyCheckedIn: boolean;
  checkedInAt: string;
  streak: Streak;
  newBadges: string[];
  totalCheckIns: number;
}

// ---------- staff reports ----------

export interface MemberRow {
  userId: string;
  name: string | null;
  phone: string;
  role: Role;
  joinedAt: string;
  lastVisit: string | null;
  totalCheckIns: number;
  membership: MembershipStatus & { endsAt: string | null };
  atRisk: boolean;
}

export interface AttendanceReport {
  days: Array<{ day: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
  today: number;
  activeMembers: number;
  totalMembers: number;
}

// ---------- workouts ----------

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  instructions: string[];
  videoUrl: string | null;
  /** True for the GymVerse built-in library (shared by all gyms). */
  builtIn: boolean;
}

export interface RoutineExercise {
  exerciseId: string;
  exercise: Exercise;
  sets: number;
  reps: number;
  weightKg: number | null;
  restSec: number;
}

export interface Routine {
  id: string;
  name: string;
  description: string | null;
  level: Level;
  /** 'preset' = published by gym staff for everyone; 'custom' = made by a member for themself. */
  kind: 'preset' | 'custom';
  /** Rough minutes: sets × (40s work + rest). */
  durationMin: number;
  createdBy: PersonRef;
  exercises: RoutineExercise[];
  /** Set when a trainer assigned this routine to the caller. */
  assignment: { by: PersonRef; note: string | null; at: string } | null;
  favourite: boolean;
  createdAt: string;
}

export interface RoutinesResponse {
  /** Assigned to me by a trainer, newest first. */
  assigned: Routine[];
  /** Gym presets. */
  presets: Routine[];
  /** My custom routines. */
  mine: Routine[];
}

export interface WorkoutSet {
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weightKg: number | null;
}

export interface WorkoutLog {
  id: string;
  routineId: string | null;
  routineName: string | null;
  startedAt: string;
  completedAt: string;
  durationMin: number;
  sets: WorkoutSet[];
  /** Σ reps × weight. */
  totalVolumeKg: number;
  notes: string | null;
}

export interface WorkoutLogResult {
  workout: WorkoutLog;
  newBadges: string[];
}

export interface Measurement {
  id: string;
  measuredOn: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
}

export interface ProgressStats {
  totalWorkouts: number;
  /** Last 8 weeks, oldest first; weekStart is the Monday (YYYY-MM-DD). */
  weekly: Array<{ weekStart: string; workouts: number; volumeKg: number; checkIns: number }>;
  /** From measurements, oldest first. */
  weight: Array<{ day: string; kg: number }>;
  /** Heaviest set per exercise, top 5 by weight. */
  personalBests: Array<{ exerciseId: string; exerciseName: string; weightKg: number; reps: number; on: string }>;
}

// ---------- resources & nutrition ----------

export interface Article {
  id: string;
  kind: ArticleKind;
  title: string;
  summary: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  tags: string[];
  readMinutes: number;
  publishedAt: string;
  author: PersonRef;
  favourite: boolean;
}

export interface MealIdea {
  id: string;
  title: string;
  mealType: MealType;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  ingredients: string[];
  steps: string[];
  imageUrl: string | null;
  tags: string[];
  favourite: boolean;
}

export interface MealPlanMeal {
  slot: MealType;
  title: string;
  description: string;
  calories: number;
  proteinG: number;
}

export interface MealPlan {
  id: string;
  title: string;
  goal: GoalId | null;
  description: string;
  caloriesPerDay: number;
  meals: MealPlanMeal[];
  favourite: boolean;
}

export interface FavouritesResponse {
  articles: Article[];
  routines: Routine[];
  mealIdeas: MealIdea[];
  mealPlans: MealPlan[];
}

// ---------- community ----------

export interface Post {
  id: string;
  author: PersonRef & { role: Role };
  body: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  mine: boolean;
  /** Only staff ever receive hidden posts (members never see them). */
  hidden: boolean;
}

export interface Comment {
  id: string;
  /** role (v0.3) lets the app show a Coach/Staff pill. */
  author: PersonRef & { role?: Role };
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  metric: ChallengeMetric;
  target: number;
  startsOn: string;
  endsOn: string;
  status: 'upcoming' | 'active' | 'ended';
  participantCount: number;
  joined: boolean;
  /** Count of the metric between startsOn and endsOn for the caller (0 if not joined). */
  myProgress: number;
  myRank: number | null;
  /** v0.3 */
  createdBy?: PersonRef;
}

export interface LeaderboardEntry {
  rank: number;
  user: PersonRef;
  progress: number;
  completed: boolean;
  isMe: boolean;
}

// ---------- notifications & support ----------

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** In-app destination: 'classes' | 'membership' | 'routine:<id>' | 'ticket:<id>' | 'challenge:<id>' | 'announcements' | null */
  link: string | null;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unread: number;
}

export interface SupportInfo {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  faqs: Array<{ q: string; a: string }>;
}

export interface TicketMessage {
  id: string;
  from: 'member' | 'staff';
  author: PersonRef;
  body: string;
  at: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  createdAt: string;
  updatedAt: string;
  member: PersonRef;
  messages: TicketMessage[];
}

// ---------- search ----------

export interface SearchResults {
  query: string;
  classes: ClassSession[];
  routines: Routine[];
  exercises: Exercise[];
  articles: Article[];
  mealIdeas: MealIdea[];
  trainers: PersonRef[];
}
