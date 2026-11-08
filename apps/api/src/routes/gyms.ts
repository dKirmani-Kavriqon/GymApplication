import type { App } from '../http';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  brandingSchema,
  checkBrandContrast,
  createGymSchema,
  joinCodeSchema,
  modesFor,
  referralSettingsSchema,
  type ReferralInfo,
} from '@gymverse/shared';
import { tx } from '../db';
import { notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';

export function registerGymRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.post('/gyms', async (req, reply) => {
    const userId = ctx.userIdOf(req);
    const input = createGymSchema.parse(req.body);
    const gym = tx(db, () => store.createGym(db, input, userId, now()));
    return reply.status(201).send(gym);
  });

  app.get('/gyms/preview/:code', async (req) => {
    const code = joinCodeSchema.parse((req.params as { code: string }).code);
    const gym = store.getGymByCode(db, code);
    if (!gym || gym.suspended) throw notFound('We could not find a gym with that code.');
    return store.toPreview(gym);
  });

  app.post('/gyms/join', async (req) => {
    const userId = ctx.userIdOf(req);
    const { code, ref } = z.object({ code: joinCodeSchema, ref: z.string().min(1).max(64).nullish() }).parse(req.body);
    const gym = store.getGymByCode(db, code);
    if (!gym || gym.suspended) throw notFound('We could not find a gym with that code.');
    const role = store.getRole(db, gym.id, userId);
    tx(db, () => {
      if (role) return;
      const known = db.prepare('SELECT referred_by FROM gym_members WHERE gym_id = ? AND user_id = ?').get(gym.id, userId) as
        | { referred_by: string | null }
        | undefined;
      store.addMember(db, gym.id, userId, 'member', now());
      // The referrer is stored once, and only if they are an active member of this gym.
      if (ref && ref !== userId && !known?.referred_by && store.getRole(db, gym.id, ref)) {
        db.prepare('UPDATE gym_members SET referred_by = ? WHERE gym_id = ? AND user_id = ?').run(ref, gym.id, userId);
      }
    });
    return { gym, role: role ?? 'member', alreadyMember: Boolean(role) };
  });

  app.get('/gyms/:gymId', async (req) => {
    const { gym, role } = ctx.gymAccess(req, undefined, { ownerMayReadSuspended: true });
    return { gym, role };
  });

  // ---------- referrals ----------

  app.get('/gyms/:gymId/referral', async (req): Promise<ReferralInfo> => {
    const { gym, userId } = ctx.gymAccess(req);
    const link = `https://gymverse.app/join/${gym.joinCode}?ref=${encodeURIComponent(userId)}`;
    const joined = (
      db.prepare('SELECT COUNT(*) AS n FROM gym_members WHERE gym_id = ? AND referred_by = ?').get(gym.id, userId) as { n: number }
    ).n;
    const reward = (db.prepare('SELECT referral_reward FROM gyms WHERE id = ?').get(gym.id) as { referral_reward: string | null }).referral_reward;
    return {
      link,
      message: `Join me at ${gym.name} on GymVerse! Use gym code ${gym.joinCode} or tap ${link}`,
      joined,
      reward: reward ?? null,
    };
  });

  app.put('/gyms/:gymId/referral', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { reward } = referralSettingsSchema.parse(req.body);
    db.prepare('UPDATE gyms SET referral_reward = ? WHERE id = ?').run(reward || null, gym.id);
    store.audit(db, gym.id, userId, 'referral.update', null, now());
    return { reward: reward || null };
  });

  app.patch('/gyms/:gymId/branding', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const b = brandingSchema.parse(req.body);
    db.prepare(
      `UPDATE gyms SET name = ?, tagline = ?, logo_url = ?, primary_color = ?, accent_color = ?, theme_pref = ?,
       welcome_message = ?, enabled_features = COALESCE(?, enabled_features) WHERE id = ?`,
    ).run(
      b.gymName,
      b.tagline ?? null,
      b.logoUrl ?? null,
      b.primaryColor,
      b.accentColor,
      b.themePreference,
      b.welcomeMessage ?? null,
      b.enabledFeatures ? JSON.stringify(b.enabledFeatures) : null,
      gym.id,
    );
    store.audit(db, gym.id, userId, 'branding.update', null, now());
    return {
      gym: store.getGym(db, gym.id),
      // Only warn about the surfaces the gym actually shows.
      contrastIssues: checkBrandContrast(b.primaryColor, b.accentColor, 3, modesFor(b.themePreference)),
    };
  });
}
