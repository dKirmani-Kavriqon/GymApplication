import type { App } from '../http';
import { markReadSchema, type NotificationsResponse } from '@gymverse/shared';
import type { Ctx } from '../context';
import type { Row } from '../store';
import { ensureMembershipExpiring, mapNotification, unreadCount } from '../domain/notifications';

export function registerNotificationRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.get('/gyms/:gymId/notifications', async (req): Promise<NotificationsResponse> => {
    const { gym, userId } = ctx.gymAccess(req);
    ensureMembershipExpiring(db, gym, userId, now());
    const rows = db
      .prepare('SELECT * FROM notifications WHERE gym_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50')
      .all(gym.id, userId) as Row[];
    return { notifications: rows.map(mapNotification), unread: unreadCount(db, gym.id, userId) };
  });

  app.post('/gyms/:gymId/notifications/read', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    const { ids } = markReadSchema.parse(req.body ?? {});
    const ts = now().toISOString();
    if (ids === undefined) {
      db.prepare('UPDATE notifications SET read_at = ? WHERE gym_id = ? AND user_id = ? AND read_at IS NULL').run(ts, gym.id, userId);
    } else if (ids.length > 0) {
      const marks = ids.map(() => '?').join(', ');
      db.prepare(`UPDATE notifications SET read_at = ? WHERE gym_id = ? AND user_id = ? AND read_at IS NULL AND id IN (${marks})`).run(
        ts,
        gym.id,
        userId,
        ...ids,
      );
    }
    return { unread: unreadCount(db, gym.id, userId) };
  });
}
