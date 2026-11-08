import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { STAFF_ROLES, attendanceSchema, createClassSchema, dayKey, type Attendee } from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError, notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { formatWhen, notify } from '../domain/notifications';
import { recordCheckIn } from './checkins';

export function attendeesOf(db: Db, gymId: string, classId: string): Attendee[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.phone, b.status, b.attended FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.session_id = ? AND b.gym_id = ? ORDER BY b.status, b.rowid`,
    )
    .all(classId, gymId) as Array<{ id: string; name: string | null; phone: string; status: Attendee['status']; attended: number | null }>;
  return rows.map((r) => ({
    userId: r.id,
    name: r.name,
    phone: r.phone,
    status: r.status,
    attended: r.attended === null ? null : r.attended === 1,
  }));
}

export function registerClassRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.get('/gyms/:gymId/classes', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'classes');
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(60).default(14) }).parse(req.query);
    const from = now();
    const to = new Date(from.getTime() + days * 86_400_000);
    const rows = db
      .prepare('SELECT * FROM class_sessions WHERE gym_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at')
      .all(gym.id, new Date(from.getTime() - 60 * 60_000).toISOString(), to.toISOString()) as Record<string, unknown>[];
    return { classes: rows.map((r) => store.mapSession(db, r, userId)) };
  });

  app.post('/gyms/:gymId/classes', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, STAFF_ROLES);
    const c = createClassSchema.parse(req.body);
    const id = randomUUID();
    db.prepare(
      'INSERT INTO class_sessions (id, gym_id, title, trainer_name, starts_at, duration_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, gym.id, c.title, c.trainerName ?? null, new Date(c.startsAt).toISOString(), c.durationMin, c.capacity, now().toISOString());
    store.audit(db, gym.id, userId, 'class.create', id, now());
    return reply.status(201).send(store.mapSession(db, store.getSessionRow(db, gym.id, id), userId));
  });

  app.delete('/gyms/:gymId/classes/:classId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, STAFF_ROLES);
    const { classId } = req.params as { classId: string };
    store.getSessionRow(db, gym.id, classId);
    db.prepare('DELETE FROM class_sessions WHERE id = ? AND gym_id = ?').run(classId, gym.id);
    store.audit(db, gym.id, userId, 'class.delete', classId, now());
    return reply.status(204).send();
  });

  app.post('/gyms/:gymId/classes/:classId/book', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'classes');
    const { classId } = req.params as { classId: string };
    return tx(db, () => {
      const row = store.getSessionRow(db, gym.id, classId);
      if ((row.starts_at as string) <= now().toISOString()) {
        throw new HttpError(409, 'class_started', 'This class has already started.');
      }
      const already = db.prepare('SELECT 1 FROM bookings WHERE session_id = ? AND user_id = ?').get(classId, userId);
      if (!already) {
        const { n } = db
          .prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND gym_id = ? AND status = 'booked'")
          .get(classId, gym.id) as { n: number };
        const status = n < (row.capacity as number) ? 'booked' : 'waitlisted';
        db.prepare('INSERT INTO bookings (id, gym_id, session_id, user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          randomUUID(),
          gym.id,
          classId,
          userId,
          status,
          now().toISOString(),
        );
        const when = formatWhen(row.starts_at as string, gym.timezone);
        notify(
          db,
          gym.id,
          userId,
          status === 'booked'
            ? { kind: 'booking', title: 'Class booked', body: `You're booked for ${row.title} on ${when}.`, link: 'classes' }
            : {
                kind: 'booking',
                title: 'You are on the waitlist',
                body: `${row.title} on ${when} is full. We'll let you know if a place opens up.`,
                link: 'classes',
              },
          now(),
        );
      }
      const newBadges = store.syncBadges(db, gym, userId, now());
      return { session: store.mapSession(db, row, userId), newBadges };
    });
  });

  app.delete('/gyms/:gymId/classes/:classId/book', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    const { classId } = req.params as { classId: string };
    return tx(db, () => {
      const row = store.getSessionRow(db, gym.id, classId);
      const mine = db
        .prepare('SELECT id, status FROM bookings WHERE session_id = ? AND user_id = ? AND gym_id = ?')
        .get(classId, userId, gym.id) as { id: string; status: string } | undefined;
      if (!mine) throw notFound('You are not booked on this class.');
      db.prepare('DELETE FROM bookings WHERE id = ?').run(mine.id);
      let promotedUserId: string | null = null;
      if (mine.status === 'booked') {
        const next = db
          .prepare("SELECT id, user_id FROM bookings WHERE session_id = ? AND gym_id = ? AND status = 'waitlisted' ORDER BY rowid LIMIT 1")
          .get(classId, gym.id) as { id: string; user_id: string } | undefined;
        if (next) {
          db.prepare("UPDATE bookings SET status = 'booked' WHERE id = ?").run(next.id);
          promotedUserId = next.user_id;
          notify(
            db,
            gym.id,
            next.user_id,
            {
              kind: 'waitlist_promoted',
              title: "You're in!",
              body: `A place opened up in ${row.title} on ${formatWhen(row.starts_at as string, gym.timezone)}. You're now booked.`,
              link: 'classes',
            },
            now(),
          );
        }
      }
      return { session: store.mapSession(db, row, userId), promotedUserId };
    });
  });

  app.get('/gyms/:gymId/classes/:classId/attendees', async (req) => {
    const { gym } = ctx.gymAccess(req, STAFF_ROLES);
    const { classId } = req.params as { classId: string };
    store.getSessionRow(db, gym.id, classId);
    return { attendees: attendeesOf(db, gym.id, classId) };
  });

  app.put('/gyms/:gymId/classes/:classId/attendees/:memberId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, STAFF_ROLES);
    const { classId, memberId } = req.params as { classId: string; memberId: string };
    const row = store.getSessionRow(db, gym.id, classId);
    const { attended } = attendanceSchema.parse(req.body);
    return tx(db, () => {
      const booking = db
        .prepare('SELECT id, status FROM bookings WHERE session_id = ? AND user_id = ? AND gym_id = ?')
        .get(classId, memberId, gym.id) as { id: string; status: string } | undefined;
      if (!booking || booking.status !== 'booked') throw notFound('That member is not booked on this class.');
      db.prepare('UPDATE bookings SET attended = ?, attendance_marked_at = ? WHERE id = ?').run(attended ? 1 : 0, now().toISOString(), booking.id);
      if (attended) {
        // Showing up to class counts as a visit that day (staff check-in) if they had not checked in.
        const start = new Date(row.starts_at as string);
        const at = start < now() ? start : now();
        if (recordCheckIn(db, gym, memberId, dayKey(start, gym.timezone), at, 'staff')) store.syncBadges(db, gym, memberId, now());
      }
      store.audit(db, gym.id, userId, attended ? 'attendance.present' : 'attendance.absent', `${classId}:${memberId}`, now());
      return attendeesOf(db, gym.id, classId).find((a) => a.userId === memberId)!;
    });
  });

  app.get('/gyms/:gymId/trainer/today', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, STAFF_ROLES);
    const at = now();
    const today = dayKey(at, gym.timezone);
    const myName = (store.personRef(db, userId).name ?? '').trim().toLocaleLowerCase();
    const rows = (
      db
        .prepare('SELECT * FROM class_sessions WHERE gym_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at')
        .all(gym.id, new Date(at.getTime() - 36 * 3600_000).toISOString(), new Date(at.getTime() + 36 * 3600_000).toISOString()) as Row[]
    ).filter((r) => dayKey(new Date(r.starts_at as string), gym.timezone) === today);
    const mine = (r: Row) => Boolean(myName) && ((r.trainer_name as string | null) ?? '').trim().toLocaleLowerCase() === myName;
    // Stable sort: the caller's own classes first, each group in start order.
    rows.sort((a, b) => Number(mine(b)) - Number(mine(a)));
    return {
      classes: rows.map((r) => ({ ...store.mapSession(db, r, userId), attendees: attendeesOf(db, gym.id, r.id as string) })),
    };
  });
}
