/** v0.3 layer of the FLEX42 demo data (see demo-seed.ts): coupon, door code, freeze, referral, attendance, consent. */
import { randomBytes, randomUUID } from 'node:crypto';
import { CURRENT_TERMS_VERSION, addDays, dayKey, type Gym } from '@gymverse/shared';
import type { Db } from './db';
import * as store from './store';

export interface DemoPeople {
  owner: string;
  ravi: string;
  coach: string;
  anita: string;
  karan: string;
}

export function seedV03(db: Db, gym: Gym, people: DemoPeople, now: Date): void {
  const DAY = 86_400_000;
  const ago = (days: number, minutes = 0) => new Date(now.getTime() - days * DAY - minutes * 60_000);
  const today = dayKey(now, gym.timezone);
  const { owner, ravi, coach, anita, karan } = people;

  // Ravi has finished set-up and accepted the current terms, so the demo login goes straight to Home.
  db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(ravi);
  db.prepare('UPDATE profiles SET setup_complete = 1 WHERE user_id = ?').run(ravi);
  for (const u of [owner, ravi, coach]) {
    db.prepare(
      `INSERT INTO consents (user_id, terms_version, accepted_at, guardian_consent, guardian_name) VALUES (?, ?, ?, 0, NULL)
       ON CONFLICT (user_id) DO UPDATE SET terms_version = excluded.terms_version, accepted_at = excluded.accepted_at`,
    ).run(u, CURRENT_TERMS_VERSION, ago(30).toISOString());
  }

  // Coupon, door code and referral reward.
  db.prepare(
    `INSERT OR IGNORE INTO coupons (id, gym_id, code, kind, amount, plan_ids, expires_on, max_uses, uses, active, created_at)
     VALUES (?, ?, 'DIWALI20', 'percent', 20, '[]', ?, 200, 0, 1, ?)`,
  ).run(randomUUID(), gym.id, addDays(today, 30), ago(5).toISOString());
  db.prepare('INSERT OR IGNORE INTO door_codes (gym_id, token, rotated_at) VALUES (?, ?, ?)').run(
    gym.id,
    randomBytes(24).toString('base64url'),
    ago(10).toISOString(),
  );
  db.prepare('UPDATE gyms SET referral_reward = ? WHERE id = ?').run('Refer a friend and get 1 week free when they join', gym.id);

  // Anita has a quarterly membership and is asking to pause it.
  const quarterly = db.prepare("SELECT id FROM plans WHERE gym_id = ? AND name = 'Quarterly'").get(gym.id) as { id: string } | undefined;
  if (quarterly && !store.currentSubscription(db, gym.id, anita)) {
    db.prepare('INSERT INTO subscriptions (id, gym_id, user_id, plan_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(),
      gym.id,
      anita,
      quarterly.id,
      ago(20).toISOString(),
      new Date(now.getTime() + 70 * DAY).toISOString(),
      ago(20).toISOString(),
    );
  }
  db.prepare(
    `INSERT INTO freeze_requests (id, gym_id, user_id, starts_on, ends_on, days, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, 14, ?, 'pending', ?)`,
  ).run(randomUUID(), gym.id, anita, addDays(today, 10), addDays(today, 23), 'Visiting family in Nagpur for two weeks.', ago(1).toISOString());

  // Yesterday's class with attendance marked (trainer screens and the attendance report).
  const yesterday = addDays(today, -1);
  db.prepare(
    'INSERT INTO class_sessions (id, gym_id, title, trainer_name, starts_at, duration_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), gym.id, 'Evening Strength', 'Coach Vikram', `${yesterday}T12:30:00.000Z`, 45, 12, ago(6).toISOString());
  const startOfYesterday = new Date(`${addDays(yesterday, -1)}T18:30:00.000Z`).toISOString(); // 00:00 IST
  const endOfYesterday = new Date(`${yesterday}T18:30:00.000Z`).toISOString();
  const pastClasses = (
    db
      .prepare('SELECT id, starts_at FROM class_sessions WHERE gym_id = ? AND starts_at >= ? AND starts_at < ?')
      .all(gym.id, new Date(new Date(startOfYesterday).getTime() - DAY).toISOString(), new Date(new Date(endOfYesterday).getTime() + DAY).toISOString()) as Array<{
      id: string;
      starts_at: string;
    }>
  ).filter((c) => dayKey(new Date(c.starts_at), gym.timezone) === yesterday);
  const book = db.prepare("INSERT OR IGNORE INTO bookings (id, gym_id, session_id, user_id, status, created_at) VALUES (?, ?, ?, ?, 'booked', ?)");
  const mark = db.prepare('UPDATE bookings SET attended = ?, attendance_marked_at = ? WHERE session_id = ? AND user_id = ? AND gym_id = ?');
  for (const c of pastClasses) {
    for (const [u, attended] of [
      [ravi, 1],
      [karan, 1],
      [anita, 0],
    ] as const) {
      book.run(randomUUID(), gym.id, c.id, u, ago(2).toISOString());
      mark.run(attended, now.toISOString(), c.id, u, gym.id);
    }
  }
}
