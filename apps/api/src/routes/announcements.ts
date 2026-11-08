import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { ADMIN_ROLES, announcementSchema } from '@gymverse/shared';
import { tx } from '../db';
import type { Ctx } from '../context';
import * as store from '../store';
import { notifyGym } from '../domain/notifications';

export function registerAnnouncementRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.get('/gyms/:gymId/announcements', async (req) => {
    const { gym } = ctx.gymAccess(req);
    const rows = db
      .prepare('SELECT * FROM announcements WHERE gym_id = ? ORDER BY pinned DESC, created_at DESC LIMIT 50')
      .all(gym.id) as Record<string, unknown>[];
    return { announcements: rows.map(store.mapAnnouncement) };
  });

  app.post('/gyms/:gymId/announcements', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const a = announcementSchema.parse(req.body);
    const id = randomUUID();
    tx(db, () => {
      db.prepare('INSERT INTO announcements (id, gym_id, title, body, pinned, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        gym.id,
        a.title,
        a.body,
        a.pinned ? 1 : 0,
        userId,
        now().toISOString(),
      );
      notifyGym(
        db,
        gym.id,
        { kind: 'announcement', title: a.title, body: a.body.length > 140 ? `${a.body.slice(0, 137)}...` : a.body, link: 'announcements' },
        now(),
        { exceptUserId: userId, pref: 'notify_announcements' },
      );
      store.audit(db, gym.id, userId, 'announcement.create', id, now());
    });
    return reply.status(201).send(store.mapAnnouncement(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as Record<string, unknown>));
  });
}
