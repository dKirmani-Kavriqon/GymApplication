import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, routineBody, setup, workoutBody } from './helpers';

describe('exercise library', () => {
  it('lists the built-in library plus the gym own exercises, with filters', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const all = (await call('GET', `/gyms/${gym.id}/exercises`, member.token)).body.exercises;
    assert.ok(all.length >= 20, `expected a built-in library, got ${all.length}`);
    assert.ok(all.every((e: any) => e.builtIn && e.id.startsWith('ex_') && e.instructions.length > 0));
    const groups = new Set(all.map((e: any) => e.muscleGroup));
    for (const g of ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'full_body', 'cardio', 'mobility']) assert.ok(groups.has(g), g);

    const squats = (await call('GET', `/gyms/${gym.id}/exercises?q=SQUAT`, member.token)).body.exercises;
    assert.ok(squats.length >= 2 && squats.every((e: any) => /squat/i.test(e.name)));
    const chest = (await call('GET', `/gyms/${gym.id}/exercises?muscle=chest`, member.token)).body.exercises;
    assert.ok(chest.length > 0 && chest.every((e: any) => e.muscleGroup === 'chest'));
    assert.equal((await call('GET', `/gyms/${gym.id}/exercises?muscle=wings`, member.token)).status, 400);

    const created = await call('POST', `/gyms/${gym.id}/exercises`, owner.token, {
      name: 'Sled push',
      muscleGroup: 'full_body',
      equipment: 'none',
      instructions: ['Push the sled 20 m'],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.builtIn, false);
    const sled = (await call('GET', `/gyms/${gym.id}/exercises?q=sled`, member.token)).body.exercises;
    assert.deepEqual(sled.map((e: any) => e.id), [created.body.id]);
  });

  it('only staff add exercises, with validation', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000001', 'Trainer T', 'trainer');
    const body = { name: 'Farmer carry', muscleGroup: 'full_body', equipment: 'dumbbell' };
    assert.equal((await call('POST', `/gyms/${gym.id}/exercises`, member.token, body)).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/exercises`, trainer.token, body)).status, 201);
    assert.equal((await call('POST', `/gyms/${gym.id}/exercises`, trainer.token, { ...body, equipment: 'rocket' })).status, 400);
  });
});

describe('routines', () => {
  it('members create custom routines; only staff publish presets', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const mine = await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody());
    assert.equal(mine.status, 201);
    assert.equal(mine.body.kind, 'custom');
    assert.equal(mine.body.durationMin, 11); // 3×(40+60) + 3×(40+80) seconds
    assert.equal(mine.body.exercises[0].exercise.name, 'Barbell bench press');
    assert.equal(mine.body.createdBy.name, 'Member 1');
    assert.equal(mine.body.assignment, null);

    assert.equal((await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody({ kind: 'preset' }))).status, 403);
    const preset = await call('POST', `/gyms/${gym.id}/routines`, owner.token, routineBody({ name: 'Gym preset', kind: 'preset' }));
    assert.equal(preset.status, 201);

    const list = (await call('GET', `/gyms/${gym.id}/routines`, member.token)).body;
    assert.deepEqual(list.presets.map((r: any) => r.name), ['Gym preset']);
    assert.deepEqual(list.mine.map((r: any) => r.name), ['Upper body']);
    assert.deepEqual(list.assigned, []);
  });

  it('validates routines and their exercises', async () => {
    const { call, gymWithMember } = setup();
    const { member, gym } = await gymWithMember();
    assert.equal((await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody({ exercises: [] }))).status, 400);
    assert.equal((await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody({ name: 'x' }))).status, 400);
    const unknown = await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody({ exercises: [{ exerciseId: 'ex_nope', sets: 3, reps: 5 }] }));
    assert.equal(unknown.status, 404);
  });

  it('custom routines are private; staff can see them; edit and delete rules', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    const mine = (await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody())).body;

    assert.equal((await call('GET', `/gyms/${gym.id}/routines/${mine.id}`, other.token)).status, 404);
    assert.equal((await call('GET', `/gyms/${gym.id}/routines/${mine.id}`, trainer.token)).status, 200);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/routines/${mine.id}`, other.token, routineBody())).status, 404);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/routines/${mine.id}`, trainer.token, routineBody())).status, 403);

    const edited = await call('PATCH', `/gyms/${gym.id}/routines/${mine.id}`, member.token, routineBody({ name: 'Upper body v2' }));
    assert.equal(edited.status, 200);
    assert.equal(edited.body.name, 'Upper body v2');
    assert.equal(edited.body.kind, 'custom');
    assert.equal((await call('PATCH', `/gyms/${gym.id}/routines/${mine.id}`, member.token, routineBody({ kind: 'preset' }))).status, 403);

    // Presets: any staff edits, only admins (or the creator) delete.
    const preset = (await call('POST', `/gyms/${gym.id}/routines`, owner.token, routineBody({ name: 'Preset', kind: 'preset' }))).body;
    const byTrainer = await call('PATCH', `/gyms/${gym.id}/routines/${preset.id}`, trainer.token, routineBody({ name: 'Preset v2' }));
    assert.equal(byTrainer.status, 200);
    assert.equal(byTrainer.body.kind, 'preset', 'kind is kept when not sent');
    assert.equal((await call('PATCH', `/gyms/${gym.id}/routines/${preset.id}`, member.token, routineBody())).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/routines/${preset.id}`, trainer.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/routines/${preset.id}`, member.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/routines/${preset.id}`, owner.token)).status, 204);
    assert.equal((await call('GET', `/gyms/${gym.id}/routines/${preset.id}`, member.token)).status, 404);

    assert.equal((await call('DELETE', `/gyms/${gym.id}/routines/${mine.id}`, member.token)).status, 204);
  });

  it('staff assign routines; the member sees and is notified; staff view member workouts', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Coach Asha', 'trainer');
    const preset = (await call('POST', `/gyms/${gym.id}/routines`, owner.token, routineBody({ name: 'Starter', kind: 'preset' }))).body;
    const plan = (await call('POST', `/gyms/${gym.id}/routines`, trainer.token, routineBody({ name: 'For Member 1' }))).body;

    // Before any assignment the summary recommends a preset.
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.recommendedRoutine.id, preset.id);

    const assign = await call('POST', `/gyms/${gym.id}/routines/${plan.id}/assign`, trainer.token, { userId: member.userId, note: 'Twice a week' });
    assert.equal(assign.status, 200);
    assert.deepEqual(assign.body, { assigned: true });
    assert.equal((await call('POST', `/gyms/${gym.id}/routines/${plan.id}/assign`, member.token, { userId: member.userId })).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/routines/${plan.id}/assign`, trainer.token, { userId: 'nobody' })).status, 404);

    const list = (await call('GET', `/gyms/${gym.id}/routines`, member.token)).body;
    assert.equal(list.assigned.length, 1);
    assert.equal(list.assigned[0].assignment.by.name, 'Coach Asha');
    assert.equal(list.assigned[0].assignment.note, 'Twice a week');
    assert.equal((await call('GET', `/gyms/${gym.id}/routines/${plan.id}`, member.token)).status, 200, 'assigned routines are visible');

    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    const n = notes.find((x: any) => x.kind === 'routine_assigned');
    assert.equal(n.link, `routine:${plan.id}`);
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.recommendedRoutine.id, plan.id);

    await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(clock.now, { routineId: plan.id }));
    const view = await call('GET', `/gyms/${gym.id}/members/${member.userId}/workouts`, trainer.token);
    assert.equal(view.status, 200);
    assert.equal(view.body.workouts.length, 1);
    assert.equal(view.body.workouts[0].routineName, 'For Member 1');
    assert.deepEqual(view.body.assigned.map((r: any) => r.id), [plan.id]);
    assert.equal((await call('GET', `/gyms/${gym.id}/members/${trainer.userId}/workouts`, member.token)).status, 403);
    assert.equal((await call('GET', `/gyms/${gym.id}/members/unknown-user/workouts`, trainer.token)).status, 404);
    void DAY;
  });
});

describe('workout logging and progress', () => {
  it('logs a workout with set numbers, volume and the first workout badge', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    const res = await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(clock.now, { notes: 'Felt strong' }));
    assert.equal(res.status, 201);
    const w = res.body.workout;
    assert.deepEqual(res.body.newBadges, ['first_workout']);
    assert.equal(w.durationMin, 45);
    assert.equal(w.totalVolumeKg, 840);
    assert.equal(w.notes, 'Felt strong');
    assert.deepEqual(
      w.sets.map((s: any) => [s.exerciseName, s.setNumber, s.weightKg]),
      [
        ['Barbell back squat', 1, 50],
        ['Barbell back squat', 2, 55],
        ['Push-up', 1, null],
      ],
    );
    const again = await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(clock.now));
    assert.deepEqual(again.body.newBadges, []);
    const summary = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.ok(summary.badges.includes('first_workout'));
  });

  it('awards workouts_10 on the tenth workout and lists newest first', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    let last: any;
    for (let i = 0; i < 10; i++) {
      last = (await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(new Date(clock.now.getTime() - (10 - i) * DAY)))).body;
    }
    assert.deepEqual(last.newBadges, ['workouts_10']);
    const list = (await call('GET', `/gyms/${gym.id}/workouts?limit=3`, member.token)).body.workouts;
    assert.equal(list.length, 3);
    assert.ok(list[0].completedAt > list[1].completedAt);
    assert.equal((await call('GET', `/gyms/${gym.id}/workouts?limit=500`, member.token)).status, 400);
  });

  it('rejects invalid workouts', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');
    const theirs = (await call('POST', `/gyms/${gym.id}/routines`, other.token, routineBody())).body;
    const end = clock.now;
    const backwards = workoutBody(end, { startedAt: new Date(end.getTime() + 60_000).toISOString() });
    assert.equal((await call('POST', `/gyms/${gym.id}/workouts`, member.token, backwards)).status, 400);
    assert.equal((await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(end, { sets: [] }))).status, 400);
    assert.equal(
      (await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(end, { sets: [{ exerciseId: 'ex_fake', reps: 5 }] }))).status,
      404,
    );
    assert.equal((await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(end, { routineId: theirs.id }))).status, 404);
  });

  it('computes progress: weekly buckets, personal bests and weight', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    // Clock: Sunday 8 Nov 2026 (IST). This week starts Monday 2 Nov.
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(clock.now));
    await call(
      'POST',
      `/gyms/${gym.id}/workouts`,
      member.token,
      workoutBody(new Date(clock.now.getTime() - 7 * DAY), { sets: [{ exerciseId: 'ex_bench_press', reps: 5, weightKg: 60 }] }),
    );
    await call('POST', '/me/measurements', member.token, { measuredOn: '2026-10-20', weightKg: 82 });
    await call('POST', '/me/measurements', member.token, { measuredOn: '2026-11-07', weightKg: 80.5, waistCm: 90 });
    await call('POST', '/me/measurements', member.token, { measuredOn: '2026-11-01', bodyFatPct: 22 });

    const p = (await call('GET', `/gyms/${gym.id}/progress`, member.token)).body;
    assert.equal(p.totalWorkouts, 2);
    assert.equal(p.weekly.length, 8);
    assert.equal(p.weekly[7].weekStart, '2026-11-02');
    assert.equal(p.weekly[0].weekStart, '2026-09-14');
    assert.deepEqual(p.weekly[7], { weekStart: '2026-11-02', workouts: 1, volumeKg: 840, checkIns: 1 });
    assert.deepEqual(p.weekly[6], { weekStart: '2026-10-26', workouts: 1, volumeKg: 300, checkIns: 0 });
    assert.deepEqual(p.weight, [
      { day: '2026-10-20', kg: 82 },
      { day: '2026-11-07', kg: 80.5 },
    ]);
    assert.deepEqual(
      p.personalBests.map((b: any) => [b.exerciseId, b.weightKg, b.reps, b.on]),
      [
        ['ex_bench_press', 60, 5, '2026-11-01'],
        ['ex_back_squat', 55, 8, '2026-11-08'],
      ],
    );
  });

  it('is blocked when the gym switched workouts off', async () => {
    const { call, gymWithMember, disableFeatures, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    await call('POST', `/gyms/${gym.id}/routines`, owner.token, routineBody({ kind: 'preset' }));
    await disableFeatures(gym, owner.token, ['workouts']);
    for (const [method, url, body] of [
      ['GET', `/gyms/${gym.id}/exercises`],
      ['GET', `/gyms/${gym.id}/routines`],
      ['POST', `/gyms/${gym.id}/routines`, routineBody()],
      ['POST', `/gyms/${gym.id}/workouts`, workoutBody(clock.now)],
      ['GET', `/gyms/${gym.id}/workouts`],
      ['GET', `/gyms/${gym.id}/progress`],
    ] as Array<[string, string, unknown?]>) {
      const res = await call(method, url, member.token, body);
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.equal(res.body.error, 'feature_disabled');
    }
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.recommendedRoutine, null);
  });
});

describe('measurements', () => {
  it('records personal measurements and keeps the profile weight current', async () => {
    const { call, login } = setup();
    const me = await login('+919800000010');
    const a = await call('POST', '/me/measurements', me.token, { measuredOn: '2026-11-01', weightKg: 80 });
    assert.equal(a.status, 201);
    assert.deepEqual({ ...a.body, id: undefined }, { id: undefined, measuredOn: '2026-11-01', weightKg: 80, bodyFatPct: null, waistCm: null });
    assert.equal((await call('GET', '/me', me.token)).body.profile.weightKg, 80);

    await call('POST', '/me/measurements', me.token, { measuredOn: '2026-10-01', weightKg: 83 });
    assert.equal((await call('GET', '/me', me.token)).body.profile.weightKg, 80, 'an older entry does not overwrite');
    await call('POST', '/me/measurements', me.token, { measuredOn: '2026-11-05', weightKg: 79.4 });
    assert.equal((await call('GET', '/me', me.token)).body.profile.weightKg, 79.4);

    const list = (await call('GET', '/me/measurements', me.token)).body.measurements;
    assert.deepEqual(list.map((m: any) => m.measuredOn), ['2026-10-01', '2026-11-01', '2026-11-05']);

    assert.equal((await call('POST', '/me/measurements', me.token, { measuredOn: '2026-11-06' })).status, 400);
    assert.equal((await call('POST', '/me/measurements', me.token, { measuredOn: '6 Nov', weightKg: 80 })).status, 400);

    const other = await login('+919800000011');
    assert.equal((await call('DELETE', `/me/measurements/${a.body.id}`, other.token)).status, 404);
    assert.equal((await call('GET', '/me/measurements', other.token)).body.measurements.length, 0);
    assert.equal((await call('DELETE', `/me/measurements/${a.body.id}`, me.token)).status, 204);
    assert.equal((await call('GET', '/me/measurements', me.token)).body.measurements.length, 2);
    assert.equal((await call('GET', '/me/measurements')).status, 401);
  });
});
