import type { App } from '../http';
import { z } from 'zod';
import { otpSchema, phoneSchema, profileSchema, type MeResponse } from '@gymverse/shared';
import { tx } from '../db';
import { consumeOtp, issueOtp, signToken, upsertUserByPhone } from '../auth';
import type { Ctx } from '../context';
import * as store from '../store';
import { HttpError } from '../errors';
import { smsFailed } from '../sms';
import { consentState } from './account';

export function meResponse(ctx: Ctx, userId: string): MeResponse {
  return {
    user: store.getUser(ctx.db, userId),
    profile: store.getProfile(ctx.db, userId),
    memberships: store.listMemberships(ctx.db, userId),
    consent: consentState(ctx.db, userId, ctx.now()),
    isPlatformAdmin: ctx.isPlatformAdmin(userId),
  };
}

export function registerAuthRoutes(app: App, ctx: Ctx): void {
  const { db, now, secret } = ctx;

  app.post('/auth/otp/request', async (req) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
    const code = issueOtp(db, phone, secret, now());
    try {
      await ctx.sendOtp(phone, code);
    } catch (err) {
      // The OTP row is kept: the rate limit still counts it, and a retry issues a fresh code.
      if (err instanceof HttpError) throw err;
      ctx.log().error({ err: (err as Error).message }, 'OTP sender failed');
      throw smsFailed();
    }
    return { sent: true, ...(ctx.opts.exposeDevOtp ? { devCode: code } : {}) };
  });

  app.post('/auth/otp/verify', async (req) => {
    const { phone, code } = z.object({ phone: phoneSchema, code: otpSchema }).parse(req.body);
    consumeOtp(db, phone, code, secret, now());
    const { id, isNew } = upsertUserByPhone(db, phone, now());
    return { token: signToken(id, secret, now()), isNewUser: isNew, user: store.getUser(db, id) };
  });

  app.get('/me', async (req) => meResponse(ctx, ctx.userIdOf(req)));

  app.patch('/me/profile', async (req) => {
    const userId = ctx.userIdOf(req);
    const p = profileSchema.parse(req.body);
    const bool = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
    tx(db, () => {
      if (p.name !== undefined || p.avatarUrl !== undefined) {
        db.prepare('UPDATE users SET name = COALESCE(?, name), avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END WHERE id = ?').run(
          p.name ?? null,
          p.avatarUrl !== undefined ? 1 : 0,
          p.avatarUrl ?? null,
          userId,
        );
      }
      // [column, value]: undefined = not sent (leave alone), null = clear. zod only allows null on nullable fields.
      const fields: Array<[string, unknown]> = [
        ['goal', p.goal],
        ['gender', p.gender],
        ['activity_level', p.activityLevel],
        ['height_cm', p.heightCm],
        ['weight_kg', p.weightKg],
        ['birth_year', p.birthYear],
        ['bio', p.bio],
        ['theme_color', p.themeColor],
        ['theme_mode', p.themeMode],
        ['show_stats', bool(p.showStats)],
        ['weekly_goal', p.weeklyGoal],
        ['notify_class_reminders', bool(p.notifyClassReminders)],
        ['notify_announcements', bool(p.notifyAnnouncements)],
        ['notify_workout_reminders', bool(p.notifyWorkoutReminders)],
        ['language', p.language],
        ['setup_complete', bool(p.setupComplete)],
      ];
      const cols = fields.filter(([, v]) => v !== undefined);
      if (cols.length) {
        db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(userId);
        const set = cols.map(([c]) => `${c} = ?`).join(', ');
        db.prepare(`UPDATE profiles SET ${set} WHERE user_id = ?`).run(...(cols.map(([, v]) => v ?? null) as never[]), userId);
      }
    });
    return meResponse(ctx, userId);
  });
}
