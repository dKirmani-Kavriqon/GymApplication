import { randomInt, randomUUID } from 'node:crypto';
import {
  ADMIN_ROLES,
  DEFAULT_BRANDING,
  FEATURES,
  STAFF_ROLES,
  computeStreak,
  dayKey,
  earnedBadges,
  membershipStatus,
  type Announcement,
  type ClassSession,
  type FeatureKey,
  type Gym,
  type GymPreview,
  type PersonRef,
  type Plan,
  type Profile,
  type Role,
  type ThemePreference,
  type User,
} from '@gymverse/shared';
import type { Db } from './db';
import { notFound } from './errors';
import { syncChallengeCompletions } from './domain/challenges';

// All functions that touch tenant data take `gymId` and filter on it.

export type Row = Record<string, unknown>;

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

export function newJoinCode(db: Db): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += JOIN_CODE_ALPHABET[randomInt(0, JOIN_CODE_ALPHABET.length)];
    const taken = db.prepare('SELECT 1 FROM gyms WHERE join_code = ?').get(code);
    if (!taken) return code;
  }
}

export function mapGym(r: Row): Gym {
  return {
    id: r.id as string,
    name: r.name as string,
    city: r.city as string,
    timezone: r.timezone as string,
    joinCode: r.join_code as string,
    planTier: r.plan_tier as Gym['planTier'],
    enabledFeatures: JSON.parse(r.enabled_features as string) as FeatureKey[],
    suspended: r.suspended === 1,
    branding: {
      gymName: r.name as string,
      tagline: (r.tagline as string) ?? null,
      logoUrl: (r.logo_url as string) ?? null,
      primaryColor: r.primary_color as string,
      accentColor: r.accent_color as string,
      themePreference: r.theme_pref as Gym['branding']['themePreference'],
      welcomeMessage: (r.welcome_message as string) ?? null,
    },
  };
}

export function toPreview(g: Gym): GymPreview {
  return { name: g.name, city: g.city, joinCode: g.joinCode, branding: g.branding };
}

export function getGym(db: Db, gymId: string): Gym {
  const r = db.prepare('SELECT * FROM gyms WHERE id = ?').get(gymId) as Row | undefined;
  if (!r) throw notFound('Gym not found');
  return mapGym(r);
}

export function getGymByCode(db: Db, code: string): Gym | null {
  const r = db.prepare('SELECT * FROM gyms WHERE join_code = ?').get(code) as Row | undefined;
  return r ? mapGym(r) : null;
}

export function createGym(
  db: Db,
  input: { name: string; city: string; timezone: string; primaryColor: string; accentColor: string; themePreference?: ThemePreference },
  ownerId: string,
  now: Date,
): Gym {
  const id = randomUUID();
  const ts = now.toISOString();
  db.prepare(
    `INSERT INTO gyms (id, name, city, timezone, join_code, primary_color, accent_color, theme_pref, enabled_features, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.city,
    input.timezone,
    newJoinCode(db),
    input.primaryColor,
    input.accentColor,
    input.themePreference ?? DEFAULT_BRANDING.themePreference,
    JSON.stringify(FEATURES),
    ts,
  );
  db.prepare('INSERT INTO branches (id, gym_id, name, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), id, 'Main', ts);
  addMember(db, id, ownerId, 'owner', now);
  return getGym(db, id);
}

export function addMember(db: Db, gymId: string, userId: string, role: Role, now: Date): void {
  db.prepare(
    `INSERT INTO gym_members (gym_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (gym_id, user_id) DO UPDATE SET
       -- A deactivated person coming back must not regain an old staff role.
       role = CASE WHEN gym_members.status = 'inactive' THEN excluded.role ELSE gym_members.role END,
       joined_at = CASE WHEN gym_members.status = 'inactive' THEN excluded.joined_at ELSE gym_members.joined_at END,
       status = 'active'`,
  ).run(gymId, userId, role, now.toISOString());
}

export function getRole(db: Db, gymId: string, userId: string): Role | null {
  const r = db
    .prepare("SELECT role FROM gym_members WHERE gym_id = ? AND user_id = ? AND status = 'active'")
    .get(gymId, userId) as { role: Role } | undefined;
  return r?.role ?? null;
}

export function getUser(db: Db, userId: string): User {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
  if (!r) throw notFound('User not found');
  return { id: r.id as string, phone: r.phone as string, name: (r.name as string) ?? null, avatarUrl: (r.avatar_url as string) ?? null };
}

export function getProfile(db: Db, userId: string): Profile {
  const r = (db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) ?? {}) as Row;
  const flag = (v: unknown, dflt: boolean) => (v === undefined || v === null ? dflt : v === 1);
  return {
    goal: (r.goal as Profile['goal']) ?? null,
    gender: (r.gender as Profile['gender']) ?? null,
    activityLevel: (r.activity_level as Profile['activityLevel']) ?? null,
    heightCm: (r.height_cm as number) ?? null,
    weightKg: (r.weight_kg as number) ?? null,
    birthYear: (r.birth_year as number) ?? null,
    bio: (r.bio as string) ?? null,
    themeColor: (r.theme_color as string) ?? null,
    themeMode: (r.theme_mode as Profile['themeMode']) ?? 'gym',
    showStats: flag(r.show_stats, true),
    weeklyGoal: (r.weekly_goal as number) ?? 3,
    notifyClassReminders: flag(r.notify_class_reminders, true),
    notifyAnnouncements: flag(r.notify_announcements, true),
    notifyWorkoutReminders: flag(r.notify_workout_reminders, true),
    language: (r.language as Profile['language']) ?? 'en',
    setupComplete: flag(r.setup_complete, false),
  };
}

export function listMemberships(db: Db, userId: string) {
  const rows = db
    .prepare(
      `SELECT g.*, m.role AS m_role, m.joined_at AS m_joined
       FROM gym_members m JOIN gyms g ON g.id = m.gym_id
       WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.joined_at`,
    )
    .all(userId) as Row[];
  return rows.map((r) => ({ gym: mapGym(r), role: r.m_role as Role, joinedAt: r.m_joined as string }));
}

// ---------- check-ins, streaks, badges ----------

export function checkInDays(db: Db, gymId: string, userId: string): string[] {
  return (db.prepare('SELECT day FROM checkins WHERE gym_id = ? AND user_id = ? ORDER BY day').all(gymId, userId) as Array<{ day: string }>).map(
    (r) => r.day,
  );
}

export function bookingCount(db: Db, gymId: string, userId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE gym_id = ? AND user_id = ?').get(gymId, userId) as { n: number }).n;
}

export function workoutCount(db: Db, gymId: string, userId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM workout_logs WHERE gym_id = ? AND user_id = ?').get(gymId, userId) as { n: number }).n;
}

export function memberBadges(db: Db, gymId: string, userId: string): string[] {
  return (
    db.prepare('SELECT badge_id FROM user_badges WHERE gym_id = ? AND user_id = ? ORDER BY earned_at, badge_id').all(gymId, userId) as Array<{
      badge_id: string;
    }>
  ).map((r) => r.badge_id);
}

/**
 * Awards any newly earned badges and returns their ids. Also records challenge
 * completions (reaching a joined challenge's target earns `challenge_done`).
 */
export function syncBadges(db: Db, gym: Gym, userId: string, now: Date): string[] {
  const days = checkInDays(db, gym.id, userId);
  const streak = computeStreak(days, dayKey(now, gym.timezone));
  const earned = earnedBadges({
    totalCheckIns: days.length,
    longestStreak: streak.longest,
    totalBookings: bookingCount(db, gym.id, userId),
    totalWorkouts: workoutCount(db, gym.id, userId),
    challengesCompleted: syncChallengeCompletions(db, gym, userId, now),
  });
  const have = new Set(memberBadges(db, gym.id, userId));
  const fresh = earned.filter((b) => !have.has(b));
  const insert = db.prepare('INSERT INTO user_badges (gym_id, user_id, badge_id, earned_at) VALUES (?, ?, ?, ?)');
  for (const b of fresh) insert.run(gym.id, userId, b, now.toISOString());
  return fresh;
}

// ---------- classes ----------

export function getSessionRow(db: Db, gymId: string, sessionId: string): Row {
  const r = db.prepare('SELECT * FROM class_sessions WHERE id = ? AND gym_id = ?').get(sessionId, gymId) as Row | undefined;
  if (!r) throw notFound('Class not found');
  return r;
}

export function mapSession(db: Db, r: Row, userId: string): ClassSession {
  const counts = db
    .prepare(
      `SELECT SUM(status = 'booked') AS booked, SUM(status = 'waitlisted') AS waitlisted
       FROM bookings WHERE session_id = ? AND gym_id = ?`,
    )
    .get(r.id as string, r.gym_id as string) as { booked: number | null; waitlisted: number | null };
  const mine = db
    .prepare('SELECT status, rowid AS seq FROM bookings WHERE session_id = ? AND user_id = ? AND gym_id = ?')
    .get(r.id as string, userId, r.gym_id as string) as { status: 'booked' | 'waitlisted'; seq: number } | undefined;
  let position: number | null = null;
  if (mine?.status === 'waitlisted') {
    position = (
      db
        .prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND status = 'waitlisted' AND rowid <= ?")
        .get(r.id as string, mine.seq) as { n: number }
    ).n;
  }
  return {
    id: r.id as string,
    title: r.title as string,
    trainerName: (r.trainer_name as string) ?? null,
    startsAt: r.starts_at as string,
    durationMin: r.duration_min as number,
    capacity: r.capacity as number,
    bookedCount: counts.booked ?? 0,
    waitlistCount: counts.waitlisted ?? 0,
    myStatus: mine?.status ?? null,
    myWaitlistPosition: position,
  };
}

// ---------- plans & memberships ----------

export function mapPlan(r: Row): Plan {
  return {
    id: r.id as string,
    name: r.name as string,
    durationDays: r.duration_days as number,
    pricePaise: r.price_paise as number,
    benefits: JSON.parse(r.benefits as string) as string[],
  };
}

export function currentSubscription(db: Db, gymId: string, userId: string): { endsAt: string; planName: string } | null {
  const r = db
    .prepare(
      `SELECT s.ends_at, p.name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.gym_id = ? AND s.user_id = ? ORDER BY s.ends_at DESC LIMIT 1`,
    )
    .get(gymId, userId) as { ends_at: string; name: string } | undefined;
  return r ? { endsAt: r.ends_at, planName: r.name } : null;
}

export function membershipFor(db: Db, gymId: string, userId: string, now: Date) {
  const sub = currentSubscription(db, gymId, userId);
  return { ...membershipStatus(sub?.endsAt, now), endsAt: sub?.endsAt ?? null, planName: sub?.planName ?? null };
}

// ---------- announcements ----------

export function mapAnnouncement(r: Row): Announcement {
  return {
    id: r.id as string,
    title: r.title as string,
    body: r.body as string,
    pinned: r.pinned === 1,
    createdAt: r.created_at as string,
  };
}

export function audit(db: Db, gymId: string, actorId: string, action: string, target: string | null, now: Date): void {
  db.prepare('INSERT INTO audit_log (id, gym_id, actor_id, action, target, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    gymId,
    actorId,
    action,
    target,
    now.toISOString(),
  );
}

// ---------- small shared helpers ----------

export const isStaff = (role: Role): boolean => STAFF_ROLES.includes(role);
export const isAdmin = (role: Role): boolean => ADMIN_ROLES.includes(role);

export function personRef(db: Db, userId: string): PersonRef {
  const r = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string | null } | undefined;
  return { id: userId, name: r?.name ?? null };
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Case-insensitive substring match used by search and list filters. */
export function matches(haystack: string | null | undefined, needle: string): boolean {
  return Boolean(haystack) && haystack!.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}
