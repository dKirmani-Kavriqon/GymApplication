import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  challengeSchema,
  commentSchema,
  dayKey,
  postModerationSchema,
  postSchema,
  type Comment,
  type Post,
  type Role,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError, forbidden, notFound } from '../errors';
import type { Ctx, GymAccess } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { notifyGym } from '../domain/notifications';
import { challengeStatus, getChallengeRow, leaderboard, mapChallenge, sortChallenges } from '../domain/challenges';

function mapPost(db: Db, r: Row, viewerId: string): Post {
  const gymId = r.gym_id as string;
  const author = db
    .prepare('SELECT u.name, m.role FROM users u LEFT JOIN gym_members m ON m.user_id = u.id AND m.gym_id = ? WHERE u.id = ?')
    .get(gymId, r.author_id as string) as { name: string | null; role: Role | null } | undefined;
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM post_likes WHERE post_id = ? AND gym_id = ?) AS likes,
              (SELECT COUNT(*) FROM comments WHERE post_id = ? AND gym_id = ?) AS comments,
              (SELECT COUNT(*) FROM post_likes WHERE post_id = ? AND gym_id = ? AND user_id = ?) AS mine`,
    )
    .get(r.id as string, gymId, r.id as string, gymId, r.id as string, gymId, viewerId) as { likes: number; comments: number; mine: number };
  return {
    id: r.id as string,
    author: { id: r.author_id as string, name: author?.name ?? null, role: author?.role ?? 'member' },
    body: r.body as string,
    createdAt: r.created_at as string,
    likeCount: counts.likes,
    commentCount: counts.comments,
    likedByMe: counts.mine > 0,
    mine: r.author_id === viewerId,
    hidden: r.hidden === 1,
  };
}

/** The author's role in this gym ("member" once they have left). */
function roleIn(db: Db, gymId: string, userId: string): Role {
  const m = db.prepare('SELECT role FROM gym_members WHERE gym_id = ? AND user_id = ?').get(gymId, userId) as { role: Role } | undefined;
  return m?.role ?? 'member';
}

function mapComment(db: Db, r: Row, viewerId: string): Comment {
  return {
    id: r.id as string,
    author: { ...store.personRef(db, r.author_id as string), role: roleIn(db, r.gym_id as string, r.author_id as string) },
    body: r.body as string,
    createdAt: r.created_at as string,
    mine: r.author_id === viewerId,
  };
}

/** A post the caller may see: hidden posts only exist for staff (404 for everyone else). */
function getVisiblePost(db: Db, access: GymAccess, postId: string): Row {
  const r = db.prepare('SELECT * FROM posts WHERE id = ? AND gym_id = ?').get(postId, access.gym.id) as Row | undefined;
  if (!r || (r.hidden === 1 && !store.isStaff(access.role))) throw notFound('Post not found');
  return r;
}

export function registerCommunityRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  // ---------- feed ----------

  app.get('/gyms/:gymId/posts', async (req) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const { before } = z.object({ before: z.string().datetime({ offset: true }).optional() }).parse(req.query);
    const staff = store.isStaff(role);
    const params: string[] = [gym.id];
    if (before) params.push(new Date(before).toISOString());
    const rows = db
      .prepare(
        `SELECT * FROM posts WHERE gym_id = ? ${staff ? '' : 'AND hidden = 0'} ${before ? 'AND created_at < ?' : ''}
         ORDER BY created_at DESC, rowid DESC LIMIT 20`,
      )
      .all(...params) as Row[];
    return { posts: rows.map((r) => mapPost(db, r, userId)) };
  });

  app.post('/gyms/:gymId/posts', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const { body } = postSchema.parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO posts (id, gym_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, gym.id, userId, body, now().toISOString());
    return reply.status(201).send(mapPost(db, db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as Row, userId));
  });

  app.get('/gyms/:gymId/posts/:postId', async (req) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    return mapPost(db, getVisiblePost(db, access, postId), access.userId);
  });

  app.get('/gyms/:gymId/challenges/:challengeId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const { challengeId } = req.params as { challengeId: string };
    return mapChallenge(db, gym, getChallengeRow(db, gym.id, challengeId), userId, now());
  });

  app.patch('/gyms/:gymId/posts/:postId', async (req) => {
    const access = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    getVisiblePost(db, access, postId);
    const { hidden } = postModerationSchema.parse(req.body);
    db.prepare('UPDATE posts SET hidden = ? WHERE id = ? AND gym_id = ?').run(hidden ? 1 : 0, postId, access.gym.id);
    store.audit(db, access.gym.id, access.userId, hidden ? 'post.hide' : 'post.unhide', postId, now());
    return mapPost(db, getVisiblePost(db, access, postId), access.userId);
  });

  app.delete('/gyms/:gymId/posts/:postId', async (req, reply) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    const post = getVisiblePost(db, access, postId);
    if (post.author_id !== access.userId && !store.isAdmin(access.role)) throw forbidden();
    db.prepare('DELETE FROM posts WHERE id = ? AND gym_id = ?').run(postId, access.gym.id);
    if (post.author_id !== access.userId) store.audit(db, access.gym.id, access.userId, 'post.delete', postId, now());
    return reply.status(204).send();
  });

  const likeState = (postId: string, gymId: string, userId: string) => {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS n, SUM(user_id = ?) AS mine FROM post_likes WHERE post_id = ? AND gym_id = ?`,
      )
      .get(userId, postId, gymId) as { n: number; mine: number | null };
    return { likeCount: r.n, likedByMe: (r.mine ?? 0) > 0 };
  };

  app.put('/gyms/:gymId/posts/:postId/like', async (req) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    getVisiblePost(db, access, postId);
    db.prepare('INSERT OR IGNORE INTO post_likes (post_id, gym_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
      postId,
      access.gym.id,
      access.userId,
      now().toISOString(),
    );
    return likeState(postId, access.gym.id, access.userId);
  });

  app.delete('/gyms/:gymId/posts/:postId/like', async (req) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    getVisiblePost(db, access, postId);
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND gym_id = ? AND user_id = ?').run(postId, access.gym.id, access.userId);
    return likeState(postId, access.gym.id, access.userId);
  });

  // ---------- comments ----------

  app.get('/gyms/:gymId/posts/:postId/comments', async (req) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    getVisiblePost(db, access, postId);
    const rows = db
      .prepare('SELECT * FROM comments WHERE post_id = ? AND gym_id = ? ORDER BY created_at, rowid')
      .all(postId, access.gym.id) as Row[];
    return { comments: rows.map((r) => mapComment(db, r, access.userId)) };
  });

  app.post('/gyms/:gymId/posts/:postId/comments', async (req, reply) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { postId } = req.params as { postId: string };
    getVisiblePost(db, access, postId);
    const { body } = commentSchema.parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO comments (id, gym_id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      access.gym.id,
      postId,
      access.userId,
      body,
      now().toISOString(),
    );
    return reply.status(201).send(mapComment(db, db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row, access.userId));
  });

  app.delete('/gyms/:gymId/comments/:commentId', async (req, reply) => {
    const access = ctx.gymAccess(req);
    ctx.featureGuard(access.gym, 'community');
    const { commentId } = req.params as { commentId: string };
    const c = db.prepare('SELECT * FROM comments WHERE id = ? AND gym_id = ?').get(commentId, access.gym.id) as Row | undefined;
    if (!c) throw notFound('Comment not found');
    getVisiblePost(db, access, c.post_id as string);
    if (c.author_id !== access.userId && !store.isAdmin(access.role)) throw forbidden();
    db.prepare('DELETE FROM comments WHERE id = ? AND gym_id = ?').run(commentId, access.gym.id);
    if (c.author_id !== access.userId) store.audit(db, access.gym.id, access.userId, 'comment.delete', commentId, now());
    return reply.status(204).send();
  });

  // ---------- challenges ----------

  app.get('/gyms/:gymId/challenges', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const rows = db.prepare('SELECT * FROM challenges WHERE gym_id = ?').all(gym.id) as Row[];
    return { challenges: sortChallenges(rows.map((r) => mapChallenge(db, gym, r, userId, now()))) };
  });

  app.post('/gyms/:gymId/challenges', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'community');
    const c = challengeSchema.parse(req.body);
    const id = randomUUID();
    tx(db, () => {
      db.prepare(
        `INSERT INTO challenges (id, gym_id, title, description, metric, target, starts_on, ends_on, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, gym.id, c.title, c.description, c.metric, c.target, c.startsOn, c.endsOn, userId, now().toISOString());
      notifyGym(
        db,
        gym.id,
        { kind: 'challenge', title: `New challenge: ${c.title}`, body: c.description || 'Join in and climb the leaderboard.', link: `challenge:${id}` },
        now(),
        { exceptUserId: userId },
      );
      store.audit(db, gym.id, userId, 'challenge.create', id, now());
    });
    return reply.status(201).send(mapChallenge(db, gym, getChallengeRow(db, gym.id, id), userId, now()));
  });

  app.delete('/gyms/:gymId/challenges/:challengeId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'community');
    const { challengeId } = req.params as { challengeId: string };
    getChallengeRow(db, gym.id, challengeId);
    db.prepare('DELETE FROM challenges WHERE id = ? AND gym_id = ?').run(challengeId, gym.id);
    store.audit(db, gym.id, userId, 'challenge.delete', challengeId, now());
    return reply.status(204).send();
  });

  app.put('/gyms/:gymId/challenges/:challengeId/join', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const { challengeId } = req.params as { challengeId: string };
    const row = getChallengeRow(db, gym.id, challengeId);
    if (challengeStatus(row, dayKey(now(), gym.timezone)) === 'ended') {
      throw new HttpError(409, 'challenge_ended', 'This challenge has already ended.');
    }
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO challenge_participants (challenge_id, gym_id, user_id, joined_at) VALUES (?, ?, ?, ?)').run(
        challengeId,
        gym.id,
        userId,
        now().toISOString(),
      );
      // Progress counts from the start date, so joining late can complete it straight away.
      store.syncBadges(db, gym, userId, now());
    });
    return mapChallenge(db, gym, row, userId, now());
  });

  app.delete('/gyms/:gymId/challenges/:challengeId/join', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const { challengeId } = req.params as { challengeId: string };
    const row = getChallengeRow(db, gym.id, challengeId);
    db.prepare('DELETE FROM challenge_participants WHERE challenge_id = ? AND gym_id = ? AND user_id = ?').run(challengeId, gym.id, userId);
    return mapChallenge(db, gym, row, userId, now());
  });

  app.get('/gyms/:gymId/challenges/:challengeId/leaderboard', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'community');
    const { challengeId } = req.params as { challengeId: string };
    return { entries: leaderboard(db, gym, getChallengeRow(db, gym.id, challengeId), userId) };
  });
}
