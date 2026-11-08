import { buildApp, type AppOptions } from '../src/app';
import type { PushMessage, PushSender, PushTicket } from '../src/push';

export interface Clock {
  now: Date;
  advance(ms: number): void;
  set(iso: string): void;
}

export function makeClock(iso = '2026-11-08T04:30:00.000Z'): Clock {
  const c: Clock = {
    now: new Date(iso),
    advance(ms) {
      c.now = new Date(c.now.getTime() + ms);
    },
    set(next) {
      c.now = new Date(next);
    },
  };
  return c;
}

export const DAY = 86_400_000;

/** Records every push the app sends; `tickets` decides each message's result (default ok). */
export function fakePush(tickets: (m: PushMessage) => PushTicket = () => ({ status: 'ok' })) {
  const sent: PushMessage[] = [];
  const sender: PushSender = async (messages) => {
    sent.push(...messages);
    return messages.map(tickets);
  };
  return { sent, sender };
}

/** Generous limits so ordinary tests never trip the limiter (rate-limit tests pass their own). */
export const TEST_LIMITS = { globalPerMin: 100_000, authPerMin: 100_000, checkinPerMin: 100_000 };

export function setup(clock = makeClock(), extra: Partial<AppOptions> = {}) {
  const push = fakePush();
  const app = buildApp({
    now: () => clock.now,
    exposeDevOtp: true,
    tokenSecret: 'test-secret',
    rateLimit: TEST_LIMITS,
    push: push.sender,
    ...extra,
  });

  async function call<T = any>(method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    let parsed: unknown = null;
    try {
      parsed = res.body ? res.json() : null;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers };
  }

  async function login(phone: string, name?: string): Promise<{ token: string; userId: string }> {
    const req = await call('POST', '/auth/otp/request', undefined, { phone });
    if (req.status !== 200) throw new Error(`otp request failed: ${JSON.stringify(req.body)}`);
    const ver = await call('POST', '/auth/otp/verify', undefined, { phone, code: req.body.devCode });
    if (ver.status !== 200) throw new Error(`otp verify failed: ${JSON.stringify(ver.body)}`);
    if (name) await call('PATCH', '/me/profile', ver.body.token, { name });
    return { token: ver.body.token, userId: ver.body.user.id };
  }

  /** Creates a gym owned by a fresh user, plus a member who joined with the code. */
  async function gymWithMember(suffix = '1') {
    const owner = await login(`+91900000000${suffix}`, `Owner ${suffix}`);
    const gymRes = await call('POST', '/gyms', owner.token, { name: `Gym ${suffix}`, city: 'Pune' });
    const gym = gymRes.body;
    const member = await login(`+91911111111${suffix}`, `Member ${suffix}`);
    await call('POST', '/gyms/join', member.token, { code: gym.joinCode });
    return { owner, member, gym };
  }

  /** Logs a new person in, joins them to `gym` and (as the owner) gives them `role`. */
  async function joinAs(gym: { id: string; joinCode: string }, ownerToken: string, phone: string, name: string, role = 'member') {
    const person = await login(phone, name);
    await call('POST', '/gyms/join', person.token, { code: gym.joinCode });
    if (role !== 'member') {
      const res = await call('PATCH', `/gyms/${gym.id}/members/${person.userId}`, ownerToken, { role });
      if (res.status !== 200) throw new Error(`role change failed: ${JSON.stringify(res.body)}`);
    }
    return person;
  }

  /** Switches every feature on except `off` (owner token required). */
  async function disableFeatures(gym: { id: string }, ownerToken: string, off: string[]) {
    const all = ['checkin', 'classes', 'payments', 'progress', 'announcements', 'badges', 'workouts', 'nutrition', 'community', 'resources', 'support'];
    const res = await call('PATCH', `/gyms/${gym.id}/branding`, ownerToken, {
      gymName: 'Feature Test',
      primaryColor: '#6B0F1A',
      accentColor: '#B54B6A',
      themePreference: 'light',
      enabledFeatures: all.filter((f) => !off.includes(f)),
    });
    if (res.status !== 200) throw new Error(`branding failed: ${JSON.stringify(res.body)}`);
  }

  return { app, clock, call, login, gymWithMember, joinAs, disableFeatures, pushes: push.sent };
}

/** A small valid routine body using built-in exercises. */
export function routineBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Upper body',
    level: 'beginner',
    exercises: [
      { exerciseId: 'ex_bench_press', sets: 3, reps: 10, weightKg: 40, restSec: 60 },
      { exerciseId: 'ex_bent_over_row', sets: 3, reps: 10, weightKg: 30, restSec: 80 },
    ],
    ...overrides,
  };
}

/** A workout log body; `at` is the completion time. */
export function workoutBody(at: Date, overrides: Record<string, unknown> = {}) {
  return {
    startedAt: new Date(at.getTime() - 45 * 60_000).toISOString(),
    completedAt: at.toISOString(),
    sets: [
      { exerciseId: 'ex_back_squat', reps: 8, weightKg: 50 },
      { exerciseId: 'ex_back_squat', reps: 8, weightKg: 55 },
      { exerciseId: 'ex_push_up', reps: 15 },
    ],
    ...overrides,
  };
}
