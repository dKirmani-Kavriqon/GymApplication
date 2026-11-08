import { z } from 'zod';
import { isHexColor, normalizeHex } from './color';
import { PALETTE } from './theme';

// ---------- enums & catalogues ----------

export const GOALS = [
  { id: 'lose_weight', label: 'Lose weight', emoji: '🔥' },
  { id: 'build_muscle', label: 'Build muscle', emoji: '💪' },
  { id: 'stay_active', label: 'Stay active', emoji: '🏃' },
  { id: 'get_flexible', label: 'Get flexible', emoji: '🧘' },
] as const;
export type GoalId = (typeof GOALS)[number]['id'];
const GOAL_IDS = GOALS.map((g) => g.id) as [GoalId, ...GoalId[]];

export const GENDERS = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'other', label: 'Other' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;
export type Gender = (typeof GENDERS)[number]['id'];
const GENDER_IDS = GENDERS.map((g) => g.id) as [Gender, ...Gender[]];

export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Mostly sitting', description: 'Desk job, little exercise' },
  { id: 'light', label: 'Lightly active', description: 'Walks, exercise 1–2 days a week' },
  { id: 'moderate', label: 'Active', description: 'Exercise 3–4 days a week' },
  { id: 'active', label: 'Very active', description: 'Exercise 5–6 days a week' },
  { id: 'athlete', label: 'Athlete', description: 'Hard training every day' },
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]['id'];
const ACTIVITY_IDS = ACTIVITY_LEVELS.map((a) => a.id) as [ActivityLevel, ...ActivityLevel[]];

export const FEATURES = [
  'checkin',
  'classes',
  'payments',
  'progress',
  'announcements',
  'badges',
  'workouts',
  'nutrition',
  'community',
  'resources',
  'support',
] as const;
export type FeatureKey = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<FeatureKey, { label: string; description: string }> = {
  checkin: { label: 'Check-in', description: 'One-tap check-in, streaks' },
  classes: { label: 'Classes', description: 'Schedule and bookings' },
  payments: { label: 'Payments', description: 'Buy and renew plans in-app' },
  progress: { label: 'Progress', description: 'Stats, charts and history' },
  announcements: { label: 'Announcements', description: 'News from the gym' },
  badges: { label: 'Badges', description: 'Achievements for members' },
  workouts: { label: 'Workouts', description: 'Routines, logging, trainer plans' },
  nutrition: { label: 'Nutrition', description: 'Meal plans and meal ideas' },
  community: { label: 'Community', description: 'Feed and challenges' },
  resources: { label: 'Resources', description: 'Articles, videos and tips' },
  support: { label: 'Help & support', description: 'FAQs and messaging the gym' },
};

export const ROLES = ['member', 'trainer', 'manager', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES: readonly Role[] = ['trainer', 'manager', 'owner'];
export const ADMIN_ROLES: readonly Role[] = ['manager', 'owner'];

export const MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'full_body', 'cardio', 'mobility'] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export const EQUIPMENT = ['none', 'dumbbell', 'barbell', 'machine', 'kettlebell', 'band', 'cable', 'bench', 'treadmill', 'bike', 'mat'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

export const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const ARTICLE_KINDS = ['article', 'video', 'tip'] as const;
export type ArticleKind = (typeof ARTICLE_KINDS)[number];

export const FAVOURITE_KINDS = ['article', 'routine', 'meal_idea', 'meal_plan'] as const;
export type FavouriteKind = (typeof FAVOURITE_KINDS)[number];

export const CHALLENGE_METRICS = [
  { id: 'checkins', label: 'Check-ins' },
  { id: 'workouts', label: 'Workouts logged' },
  { id: 'classes', label: 'Classes booked' },
] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number]['id'];
const METRIC_IDS = CHALLENGE_METRICS.map((m) => m.id) as [ChallengeMetric, ...ChallengeMetric[]];

export const NOTIFICATION_KINDS = [
  'announcement',
  'booking',
  'waitlist_promoted',
  'payment',
  'membership_expiring',
  'routine_assigned',
  'challenge',
  'support_reply',
  'workout_reminder',
  'class_reminder',
  'freeze_decision',
  'system',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी' },
] as const;
export type Language = (typeof LANGUAGES)[number]['id'];

// ---------- primitives ----------

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^\+?[0-9]{10,15}$/.test(v), 'Enter a valid phone number');

export const otpSchema = z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code');

export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Gym codes have 6 letters or numbers');

const hexColor = z
  .string()
  .refine(isHexColor, 'Use a colour like #6B0F1A')
  .transform(normalizeHex);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-08');
const url = z.string().url().max(2000);

// ---------- gym & profile ----------

export const brandingSchema = z.object({
  gymName: z.string().trim().min(2).max(60),
  tagline: z.string().trim().max(80).nullish(),
  logoUrl: url.nullish(),
  primaryColor: hexColor,
  accentColor: hexColor,
  themePreference: z.enum(['light', 'dark', 'auto']),
  welcomeMessage: z.string().trim().max(500).nullish(),
  enabledFeatures: z.array(z.enum(FEATURES)).optional(),
});
export type BrandingInput = z.input<typeof brandingSchema>;

export const createGymSchema = z.object({
  name: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(60),
  timezone: z.string().default('Asia/Kolkata'),
  primaryColor: hexColor.default(PALETTE.burgundy),
  accentColor: hexColor.default(PALETTE.rose),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  avatarUrl: url.nullish(),
  goal: z.enum(GOAL_IDS).nullish(),
  gender: z.enum(GENDER_IDS).nullish(),
  activityLevel: z.enum(ACTIVITY_IDS).nullish(),
  heightCm: z.number().min(80).max(250).nullish(),
  weightKg: z.number().min(20).max(350).nullish(),
  birthYear: z.number().int().min(1900).max(2100).nullish(),
  bio: z.string().trim().max(160).nullish(),
  /** Member's own theme colour; null = use the gym's colours. */
  themeColor: hexColor.nullish(),
  themeMode: z.enum(['gym', 'light', 'dark', 'auto']).optional(),
  showStats: z.boolean().optional(),
  weeklyGoal: z.number().int().min(1).max(7).optional(),
  notifyClassReminders: z.boolean().optional(),
  notifyAnnouncements: z.boolean().optional(),
  notifyWorkoutReminders: z.boolean().optional(),
  language: z.enum(['en', 'hi']).optional(),
  setupComplete: z.boolean().optional(),
});
export type ProfileInput = z.input<typeof profileSchema>;

// ---------- classes, plans, announcements ----------

export const createClassSchema = z.object({
  title: z.string().trim().min(2).max(60),
  trainerName: z.string().trim().max(60).nullish(),
  startsAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(10).max(240),
  capacity: z.number().int().min(1).max(500),
});

export const createPlanSchema = z.object({
  name: z.string().trim().min(2).max(40),
  durationDays: z.number().int().min(1).max(730),
  pricePaise: z.number().int().min(0).max(100_000_000),
  benefits: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(1).max(1000),
  pinned: z.boolean().default(false),
});

export const roleUpdateSchema = z.object({ role: z.enum(ROLES) });

// ---------- workouts ----------

export const exerciseSchema = z.object({
  name: z.string().trim().min(2).max(60),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
  instructions: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  videoUrl: url.nullish(),
});

export const routineExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(100),
  weightKg: z.number().min(0).max(500).nullish(),
  restSec: z.number().int().min(0).max(600).default(60),
});

export const routineSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullish(),
  level: z.enum(LEVELS).default('beginner'),
  /** Staff may publish gym presets; members always create 'custom'. */
  kind: z.enum(['preset', 'custom']).default('custom'),
  exercises: z.array(routineExerciseSchema).min(1).max(20),
});
export type RoutineInput = z.input<typeof routineSchema>;

export const assignRoutineSchema = z.object({
  userId: z.string().min(1),
  note: z.string().trim().max(300).nullish(),
});

export const workoutLogSchema = z.object({
  routineId: z.string().min(1).nullish(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  sets: z
    .array(
      z.object({
        exerciseId: z.string().min(1),
        reps: z.number().int().min(0).max(200),
        weightKg: z.number().min(0).max(500).nullish(),
      }),
    )
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).nullish(),
}).refine((w) => Date.parse(w.completedAt) >= Date.parse(w.startedAt), { message: 'A workout must finish after it starts', path: ['completedAt'] });
export type WorkoutLogInput = z.input<typeof workoutLogSchema>;

export const measurementSchema = z
  .object({
    measuredOn: day,
    weightKg: z.number().min(20).max(350).nullish(),
    bodyFatPct: z.number().min(2).max(70).nullish(),
    waistCm: z.number().min(30).max(250).nullish(),
  })
  .refine((m) => m.weightKg != null || m.bodyFatPct != null || m.waistCm != null, 'Enter at least one measurement');

// ---------- resources & nutrition ----------

export const articleSchema = z.object({
  kind: z.enum(ARTICLE_KINDS),
  title: z.string().trim().min(2).max(100),
  summary: z.string().trim().max(240).default(''),
  body: z.string().trim().max(20_000).default(''),
  imageUrl: url.nullish(),
  videoUrl: url.nullish(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
});

export const mealIdeaSchema = z.object({
  title: z.string().trim().min(2).max(80),
  mealType: z.enum(MEAL_TYPES),
  calories: z.number().int().min(0).max(3000),
  proteinG: z.number().min(0).max(300),
  carbsG: z.number().min(0).max(500).default(0),
  fatG: z.number().min(0).max(300).default(0),
  ingredients: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  steps: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  imageUrl: url.nullish(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
});

export const mealPlanSchema = z.object({
  title: z.string().trim().min(2).max(80),
  goal: z.enum(GOAL_IDS).nullish(),
  description: z.string().trim().max(500).default(''),
  caloriesPerDay: z.number().int().min(800).max(6000),
  meals: z
    .array(
      z.object({
        slot: z.enum(MEAL_TYPES),
        title: z.string().trim().min(2).max(80),
        description: z.string().trim().max(300).default(''),
        calories: z.number().int().min(0).max(3000),
        proteinG: z.number().min(0).max(300),
      }),
    )
    .min(1)
    .max(12),
});

// ---------- community ----------

export const postSchema = z.object({ body: z.string().trim().min(1).max(1000) });
export const commentSchema = z.object({ body: z.string().trim().min(1).max(500) });
export const postModerationSchema = z.object({ hidden: z.boolean() });

export const challengeSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(''),
    metric: z.enum(METRIC_IDS),
    target: z.number().int().min(1).max(1000),
    startsOn: day,
    endsOn: day,
  })
  .refine((c) => c.endsOn >= c.startsOn, { message: 'The end date must be on or after the start date', path: ['endsOn'] });

// ---------- notifications & support ----------

export const markReadSchema = z.object({ ids: z.array(z.string().min(1)).max(500).optional() });

export const supportInfoSchema = z.object({
  phone: z.string().trim().max(30).nullish(),
  whatsapp: z.string().trim().max(30).nullish(),
  email: z.string().trim().email().max(120).nullish().or(z.literal('').transform(() => null)),
  address: z.string().trim().max(300).nullish(),
  hours: z.string().trim().max(300).nullish(),
  faqs: z
    .array(z.object({ q: z.string().trim().min(2).max(200), a: z.string().trim().min(1).max(1000) }))
    .max(30)
    .default([]),
});

export const ticketSchema = z.object({
  subject: z.string().trim().min(2).max(120),
  message: z.string().trim().min(1).max(2000),
});
export const ticketMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const ticketStatusSchema = z.object({ status: z.enum(['open', 'answered', 'closed']) });

// ---------- helpers ----------

/** Formats paise (1/100 rupee) as e.g. "₹1,499". */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  const whole = Number.isInteger(rupees);
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function labelOf<T extends readonly { id: string; label: string }[]>(list: T, id: string | null | undefined): string {
  return list.find((x) => x.id === id)?.label ?? '';
}

/** "full_body" → "Full body" */
export function humanize(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
