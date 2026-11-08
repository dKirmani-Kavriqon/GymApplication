import { addDays, dayKey, type Challenge, type ChallengeMetric, type Gym, type LeaderboardEntry } from '@gymverse/shared';
import type { Db } from '../db';
import { notFound } from '../errors';

// Note: this module must not import ../store (store imports it for badge syncing).

type Row = Record<string, unknown>;

export interface ParticipantProgress {
  userId: string;
  progress: number;
  joinedAt: string;
}

export function getChallengeRow(db: Db, gymId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM challenges WHERE id = ? AND gym_id = ?').get(id, gymId) as Row | undefined;
  if (!r) throw notFound('Challenge not found');
  return r;
}

export function challengeStatus(row: Row, today: string): Challenge['status'] {
  if (today < (row.starts_on as string)) return 'upcoming';
  if (today > (row.ends_on as string)) return 'ended';
  return 'active';
}

/**
 * Metric counts between startsOn and endsOn (inclusive, gym time zone) for the
 * given users. Check-ins and workouts store their gym-local day; classes are
 * counted by the day the booked class starts.
 */
export function metricCounts(
  db: Db,
  gym: Gym,
  metric: ChallengeMetric,
  startsOn: string,
  endsOn: string,
  userIds: string[],
): Map<string, number> {
  const out = new Map<string, number>(userIds.map((u) => [u, 0]));
  if (userIds.length === 0) return out;
  const marks = userIds.map(() => '?').join(', ');
  if (metric === 'checkins' || metric === 'workouts') {
    const table = metric === 'checkins' ? 'checkins' : 'workout_logs';
    const rows = db
      .prepare(
        `SELECT user_id, COUNT(*) AS n FROM ${table}
         WHERE gym_id = ? AND day >= ? AND day <= ? AND user_id IN (${marks}) GROUP BY user_id`,
      )
      .all(gym.id, startsOn, endsOn, ...userIds) as Array<{ user_id: string; n: number }>;
    for (const r of rows) out.set(r.user_id, r.n);
    return out;
  }
  // classes: bookings (not waitlist places) for classes starting in range. Pre-filter with a
  // UTC window one day wider on each side, then apply the exact gym-local day.
  const rows = db
    .prepare(
      `SELECT b.user_id, c.starts_at FROM bookings b
       JOIN class_sessions c ON c.id = b.session_id AND c.gym_id = b.gym_id
       WHERE b.gym_id = ? AND b.status = 'booked' AND c.starts_at >= ? AND c.starts_at < ? AND b.user_id IN (${marks})`,
    )
    .all(gym.id, `${addDays(startsOn, -1)}T00:00:00.000Z`, `${addDays(endsOn, 2)}T00:00:00.000Z`, ...userIds) as Array<{
    user_id: string;
    starts_at: string;
  }>;
  for (const r of rows) {
    const day = dayKey(new Date(r.starts_at), gym.timezone);
    if (day >= startsOn && day <= endsOn) out.set(r.user_id, (out.get(r.user_id) ?? 0) + 1);
  }
  return out;
}

/** All participants with their progress, best first (ties: who joined first). */
export function participantProgress(db: Db, gym: Gym, row: Row): ParticipantProgress[] {
  const parts = db
    .prepare('SELECT user_id, joined_at FROM challenge_participants WHERE challenge_id = ? AND gym_id = ? ORDER BY joined_at, rowid')
    .all(row.id as string, gym.id) as Array<{ user_id: string; joined_at: string }>;
  const counts = metricCounts(
    db,
    gym,
    row.metric as ChallengeMetric,
    row.starts_on as string,
    row.ends_on as string,
    parts.map((p) => p.user_id),
  );
  const list = parts.map((p) => ({ userId: p.user_id, joinedAt: p.joined_at, progress: counts.get(p.user_id) ?? 0 }));
  // Array.prototype.sort is stable, so equal progress keeps join order.
  return list.sort((a, b) => b.progress - a.progress);
}

/** Competition ranking: equal progress shares a rank (1, 1, 3). */
function rankOf(list: ParticipantProgress[], index: number): number {
  return list.filter((p) => p.progress > list[index].progress).length + 1;
}

export function mapChallenge(db: Db, gym: Gym, row: Row, viewerId: string, now: Date): Challenge {
  const parts = participantProgress(db, gym, row);
  const myIndex = parts.findIndex((p) => p.userId === viewerId);
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    metric: row.metric as ChallengeMetric,
    target: row.target as number,
    startsOn: row.starts_on as string,
    endsOn: row.ends_on as string,
    status: challengeStatus(row, dayKey(now, gym.timezone)),
    participantCount: parts.length,
    joined: myIndex >= 0,
    myProgress: myIndex >= 0 ? parts[myIndex].progress : 0,
    myRank: myIndex >= 0 ? rankOf(parts, myIndex) : null,
    createdBy: {
      id: row.created_by as string,
      name: (db.prepare('SELECT name FROM users WHERE id = ?').get(row.created_by as string) as { name: string | null } | undefined)?.name ?? null,
    },
  };
}

export function leaderboard(db: Db, gym: Gym, row: Row, viewerId: string): LeaderboardEntry[] {
  const parts = participantProgress(db, gym, row);
  const people = db.prepare('SELECT u.name, p.show_stats FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?');
  return parts.map((p, i) => {
    const rank = rankOf(parts, i);
    const isMe = p.userId === viewerId;
    const person = people.get(p.userId) as { name: string | null; show_stats: number | null } | undefined;
    const hidden = !isMe && person?.show_stats === 0;
    return {
      rank,
      // People who hide their stats are anonymised, including their id.
      user: hidden ? { id: `anonymous-${i + 1}`, name: 'Member' } : { id: p.userId, name: person?.name ?? null },
      progress: p.progress,
      completed: p.progress >= (row.target as number),
      isMe,
    };
  });
}

/** Ordering for lists: active (ending soonest) first, then upcoming (starting soonest), then ended (latest first). */
export function sortChallenges(list: Challenge[]): Challenge[] {
  const weight = { active: 0, upcoming: 1, ended: 2 } as const;
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return weight[a.status] - weight[b.status];
    if (a.status === 'active') return a.endsOn.localeCompare(b.endsOn);
    if (a.status === 'upcoming') return a.startsOn.localeCompare(b.startsOn);
    return b.endsOn.localeCompare(a.endsOn);
  });
}

/**
 * Marks joined challenges whose target the user has now reached and returns
 * how many challenges they have completed in this gym.
 */
export function syncChallengeCompletions(db: Db, gym: Gym, userId: string, now: Date): number {
  const open = db
    .prepare(
      `SELECT c.* FROM challenges c JOIN challenge_participants p ON p.challenge_id = c.id AND p.gym_id = c.gym_id
       WHERE c.gym_id = ? AND p.user_id = ? AND p.completed_at IS NULL`,
    )
    .all(gym.id, userId) as Row[];
  const mark = db.prepare('UPDATE challenge_participants SET completed_at = ? WHERE challenge_id = ? AND user_id = ? AND gym_id = ?');
  for (const c of open) {
    const n =
      metricCounts(db, gym, c.metric as ChallengeMetric, c.starts_on as string, c.ends_on as string, [userId]).get(userId) ?? 0;
    if (n >= (c.target as number)) mark.run(now.toISOString(), c.id as string, userId, gym.id);
  }
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM challenge_participants WHERE gym_id = ? AND user_id = ? AND completed_at IS NOT NULL')
      .get(gym.id, userId) as { n: number }
  ).n;
}
