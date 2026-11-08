import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, setup, workoutBody } from './helpers';

describe('community feed', () => {
  it('posts, likes (idempotent) and comments', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');
    const post = await call('POST', `/gyms/${gym.id}/posts`, member.token, { body: 'First 50 kg squat!' });
    assert.equal(post.status, 201);
    assert.deepEqual(
      { ...post.body, id: undefined, createdAt: undefined },
      {
        id: undefined,
        createdAt: undefined,
        author: { id: member.userId, name: 'Member 1', role: 'member' },
        body: 'First 50 kg squat!',
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
        mine: true,
        hidden: false,
      },
    );
    assert.equal((await call('POST', `/gyms/${gym.id}/posts`, member.token, { body: '   ' })).status, 400);

    const like1 = await call('PUT', `/gyms/${gym.id}/posts/${post.body.id}/like`, other.token);
    assert.deepEqual(like1.body, { likeCount: 1, likedByMe: true });
    assert.deepEqual((await call('PUT', `/gyms/${gym.id}/posts/${post.body.id}/like`, other.token)).body, { likeCount: 1, likedByMe: true });
    await call('PUT', `/gyms/${gym.id}/posts/${post.body.id}/like`, owner.token);
    assert.deepEqual((await call('DELETE', `/gyms/${gym.id}/posts/${post.body.id}/like`, other.token)).body, { likeCount: 1, likedByMe: false });
    assert.deepEqual((await call('DELETE', `/gyms/${gym.id}/posts/${post.body.id}/like`, other.token)).body, { likeCount: 1, likedByMe: false });

    const c1 = await call('POST', `/gyms/${gym.id}/posts/${post.body.id}/comments`, other.token, { body: 'Congrats!' });
    assert.equal(c1.status, 201);
    assert.equal(c1.body.mine, true);
    clock.advance(60_000);
    await call('POST', `/gyms/${gym.id}/posts/${post.body.id}/comments`, owner.token, { body: 'Proud of you' });
    const comments = (await call('GET', `/gyms/${gym.id}/posts/${post.body.id}/comments`, member.token)).body.comments;
    assert.deepEqual(comments.map((c: any) => c.body), ['Congrats!', 'Proud of you']);
    assert.equal(comments[0].author.name, 'Other');

    const feed = (await call('GET', `/gyms/${gym.id}/posts`, other.token)).body.posts;
    assert.equal(feed[0].commentCount, 2);
    assert.equal(feed[0].likeCount, 1);
    assert.equal(feed[0].mine, false);

    // Comment deletion: author or admin only.
    assert.equal((await call('DELETE', `/gyms/${gym.id}/comments/${c1.body.id}`, member.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/comments/${c1.body.id}`, other.token)).status, 204);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/comments/${c1.body.id}`, other.token)).status, 404);

    // Post deletion: author or admin only.
    assert.equal((await call('DELETE', `/gyms/${gym.id}/posts/${post.body.id}`, other.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/posts/${post.body.id}`, owner.token)).status, 204);
    assert.equal((await call('GET', `/gyms/${gym.id}/posts/${post.body.id}/comments`, member.token)).status, 404);
  });

  it('admins hide posts: members never see them, staff do', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    const post = (await call('POST', `/gyms/${gym.id}/posts`, member.token, { body: 'Spam spam' })).body;
    assert.equal((await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, trainer.token, { hidden: true })).status, 403);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, member.token, { hidden: true })).status, 403);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, owner.token, { hidden: 'yes' })).status, 400);
    const hidden = await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, owner.token, { hidden: true });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.hidden, true);

    assert.equal((await call('GET', `/gyms/${gym.id}/posts`, member.token)).body.posts.length, 0, 'even the author');
    assert.equal((await call('PUT', `/gyms/${gym.id}/posts/${post.id}/like`, member.token)).status, 404);
    assert.equal((await call('POST', `/gyms/${gym.id}/posts/${post.id}/comments`, member.token, { body: 'hi' })).status, 404);
    const staffFeed = (await call('GET', `/gyms/${gym.id}/posts`, trainer.token)).body.posts;
    assert.equal(staffFeed.length, 1);
    assert.equal(staffFeed[0].hidden, true);

    await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, owner.token, { hidden: false });
    assert.equal((await call('GET', `/gyms/${gym.id}/posts`, member.token)).body.posts.length, 1);
  });

  it('pages the feed 20 at a time with ?before', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    for (let i = 1; i <= 25; i++) {
      await call('POST', `/gyms/${gym.id}/posts`, member.token, { body: `Post ${i}` });
      clock.advance(60_000);
    }
    const page1 = (await call('GET', `/gyms/${gym.id}/posts`, member.token)).body.posts;
    assert.equal(page1.length, 20);
    assert.equal(page1[0].body, 'Post 25');
    const page2 = (await call('GET', `/gyms/${gym.id}/posts?before=${encodeURIComponent(page1[19].createdAt)}`, member.token)).body.posts;
    assert.deepEqual(page2.map((p: any) => p.body), ['Post 5', 'Post 4', 'Post 3', 'Post 2', 'Post 1']);
    assert.equal((await call('GET', `/gyms/${gym.id}/posts?before=yesterday`, member.token)).status, 400);
  });

  it('is blocked when community is switched off', async () => {
    const { call, gymWithMember, disableFeatures } = setup();
    const { owner, member, gym } = await gymWithMember();
    await disableFeatures(gym, owner.token, ['community']);
    for (const [method, url, body] of [
      ['GET', `/gyms/${gym.id}/posts`],
      ['POST', `/gyms/${gym.id}/posts`, { body: 'hi' }],
      ['GET', `/gyms/${gym.id}/challenges`],
    ] as Array<[string, string, unknown?]>) {
      const res = await call(method, url, member.token, body);
      assert.equal(res.status, 403, url);
      assert.equal(res.body.error, 'feature_disabled');
    }
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.activeChallenge, null);
  });
});

describe('challenges', () => {
  const november = { title: '3 check-ins in November', description: 'Show up', metric: 'checkins', target: 3, startsOn: '2026-11-01', endsOn: '2026-11-30' };

  it('admins create (members are notified); validation and roles', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('POST', `/gyms/${gym.id}/challenges`, member.token, november)).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/challenges`, trainer.token, november)).status, 403);
    const backwards = await call('POST', `/gyms/${gym.id}/challenges`, owner.token, { ...november, endsOn: '2026-10-01' });
    assert.equal(backwards.status, 400);
    assert.equal(backwards.body.issues[0].path, 'endsOn');
    assert.equal((await call('POST', `/gyms/${gym.id}/challenges`, owner.token, { ...november, metric: 'steps' })).status, 400);

    const created = await call('POST', `/gyms/${gym.id}/challenges`, owner.token, november);
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'active');
    assert.equal(created.body.participantCount, 0);
    assert.equal(created.body.myRank, null);

    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.equal(notes[0].kind, 'challenge');
    assert.equal(notes[0].link, `challenge:${created.body.id}`);
    assert.equal((await call('GET', `/gyms/${gym.id}/notifications`, owner.token)).body.notifications.length, 0, 'not the author');

    assert.equal((await call('DELETE', `/gyms/${gym.id}/challenges/${created.body.id}`, member.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/challenges/${created.body.id}`, owner.token)).status, 204);
    assert.equal((await call('PUT', `/gyms/${gym.id}/challenges/${created.body.id}/join`, member.token)).status, 404);
  });

  it('lists active first, then upcoming, then ended; joining an ended one is a 409', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const mk = async (title: string, startsOn: string, endsOn: string) =>
      (await call('POST', `/gyms/${gym.id}/challenges`, owner.token, { ...november, title, startsOn, endsOn })).body;
    const ended = await mk('October', '2026-10-01', '2026-10-31');
    await mk('December', '2026-12-01', '2026-12-31');
    await mk('November', '2026-11-01', '2026-11-30');
    await mk('This week', '2026-11-02', '2026-11-08');
    const list = (await call('GET', `/gyms/${gym.id}/challenges`, member.token)).body.challenges;
    assert.deepEqual(
      list.map((c: any) => [c.title, c.status]),
      [
        ['This week', 'active'],
        ['November', 'active'],
        ['December', 'upcoming'],
        ['October', 'ended'],
      ],
    );
    const join = await call('PUT', `/gyms/${gym.id}/challenges/${ended.id}/join`, member.token);
    assert.equal(join.status, 409);
    assert.equal(join.body.error, 'challenge_ended');
  });

  it('tracks progress, ranks the leaderboard, anonymises hidden stats and awards challenge_done', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const shy = await joinAs(gym, owner.token, '+919800000005', 'Shy Sam');
    const idle = await joinAs(gym, owner.token, '+919800000006', 'Idle Ian');
    await call('PATCH', '/me/profile', shy.token, { showStats: false });
    const ch = (await call('POST', `/gyms/${gym.id}/challenges`, owner.token, november)).body;

    clock.set('2026-10-31T04:30:00.000Z'); // before the challenge: does not count
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    clock.set('2026-11-06T04:30:00.000Z');
    const joined = await call('PUT', `/gyms/${gym.id}/challenges/${ch.id}/join`, member.token);
    assert.equal(joined.status, 200);
    assert.equal(joined.body.joined, true);
    assert.equal(joined.body.myProgress, 0);
    assert.deepEqual((await call('PUT', `/gyms/${gym.id}/challenges/${ch.id}/join`, member.token)).body.participantCount, 1, 'idempotent');
    await call('PUT', `/gyms/${gym.id}/challenges/${ch.id}/join`, shy.token);
    await call('PUT', `/gyms/${gym.id}/challenges/${ch.id}/join`, idle.token);

    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    await call('POST', `/gyms/${gym.id}/checkins`, shy.token, {});
    clock.set('2026-11-07T04:30:00.000Z');
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    clock.set('2026-11-08T04:30:00.000Z');
    const third = (await call('POST', `/gyms/${gym.id}/checkins`, member.token, {})).body;
    assert.ok(third.newBadges.includes('challenge_done'), JSON.stringify(third.newBadges));

    const mine = (await call('GET', `/gyms/${gym.id}/challenges`, member.token)).body.challenges[0];
    assert.equal(mine.myProgress, 3);
    assert.equal(mine.myRank, 1);
    assert.equal(mine.participantCount, 3);

    const board = (await call('GET', `/gyms/${gym.id}/challenges/${ch.id}/leaderboard`, owner.token)).body.entries;
    assert.deepEqual(
      board.map((e: any) => [e.rank, e.user.name, e.progress, e.completed, e.isMe]),
      [
        [1, 'Member 1', 3, true, false],
        [2, 'Member', 1, false, false],
        [3, 'Idle Ian', 0, false, false],
      ],
    );
    assert.notEqual(board[1].user.id, shy.userId, 'hidden people do not leak their id');
    const shyView = (await call('GET', `/gyms/${gym.id}/challenges/${ch.id}/leaderboard`, shy.token)).body.entries;
    assert.deepEqual([shyView[1].user.name, shyView[1].isMe], ['Shy Sam', true]);

    // Summary shows the joined active challenge.
    const summary = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(summary.activeChallenge.id, ch.id);
    assert.ok(summary.badges.includes('challenge_done'));

    // Leaving drops you from the board.
    const left = await call('DELETE', `/gyms/${gym.id}/challenges/${ch.id}/join`, idle.token);
    assert.equal(left.body.joined, false);
    assert.equal(left.body.myProgress, 0);
    assert.equal((await call('GET', `/gyms/${gym.id}/challenges/${ch.id}/leaderboard`, owner.token)).body.entries.length, 2);
  });

  it('counts workouts and booked classes (not waitlist places) in range', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');
    const workouts = (
      await call('POST', `/gyms/${gym.id}/challenges`, owner.token, { ...november, title: 'Workouts', metric: 'workouts', target: 2 })
    ).body;
    const classes = (
      await call('POST', `/gyms/${gym.id}/challenges`, owner.token, { ...november, title: 'Classes', metric: 'classes', target: 1 })
    ).body;
    for (const c of [workouts, classes]) {
      await call('PUT', `/gyms/${gym.id}/challenges/${c.id}/join`, member.token);
      await call('PUT', `/gyms/${gym.id}/challenges/${c.id}/join`, other.token);
    }
    await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(clock.now));
    await call('POST', `/gyms/${gym.id}/workouts`, member.token, workoutBody(new Date('2026-10-30T04:30:00.000Z')));
    const w = (await call('GET', `/gyms/${gym.id}/challenges`, member.token)).body.challenges.find((c: any) => c.id === workouts.id);
    assert.equal(w.myProgress, 1, 'October workout does not count');

    const cls = (
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'Spin',
        startsAt: new Date(clock.now.getTime() + DAY).toISOString(),
        durationMin: 45,
        capacity: 1,
      })
    ).body;
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, other.token); // waitlisted
    const board = (await call('GET', `/gyms/${gym.id}/challenges/${classes.id}/leaderboard`, member.token)).body.entries;
    assert.deepEqual(
      board.map((e: any) => [e.user.name, e.progress, e.completed]),
      [
        ['Member 1', 1, true],
        ['Other', 0, false],
      ],
    );
  });
});

describe('community v0.3 additions', () => {
  it('reads a single post and challenge; comments carry the author role; challenges their creator', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Coach Asha', 'trainer');
    const post = (await call('POST', `/gyms/${gym.id}/posts`, member.token, { body: 'Hello gym' })).body;
    const one = await call('GET', `/gyms/${gym.id}/posts/${post.id}`, trainer.token);
    assert.equal(one.status, 200);
    assert.deepEqual([one.body.id, one.body.body, one.body.mine], [post.id, 'Hello gym', false]);
    assert.equal((await call('GET', `/gyms/${gym.id}/posts/missing`, member.token)).status, 404);
    await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, owner.token, { hidden: true });
    assert.equal((await call('GET', `/gyms/${gym.id}/posts/${post.id}`, member.token)).status, 404, 'hidden posts follow the same rules');
    assert.equal((await call('GET', `/gyms/${gym.id}/posts/${post.id}`, trainer.token)).body.hidden, true);
    await call('PATCH', `/gyms/${gym.id}/posts/${post.id}`, owner.token, { hidden: false });

    await call('POST', `/gyms/${gym.id}/posts/${post.id}/comments`, trainer.token, { body: 'Welcome!' });
    await call('POST', `/gyms/${gym.id}/posts/${post.id}/comments`, member.token, { body: 'Thanks' });
    const comments = (await call('GET', `/gyms/${gym.id}/posts/${post.id}/comments`, member.token)).body.comments;
    assert.deepEqual(comments.map((c: any) => [c.author.name, c.author.role]), [
      ['Coach Asha', 'trainer'],
      ['Member 1', 'member'],
    ]);

    const ch = (
      await call('POST', `/gyms/${gym.id}/challenges`, owner.token, { title: 'November', metric: 'checkins', target: 3, startsOn: '2026-11-01', endsOn: '2026-11-30' })
    ).body;
    assert.deepEqual(ch.createdBy, { id: owner.userId, name: 'Owner 1' });
    const read = await call('GET', `/gyms/${gym.id}/challenges/${ch.id}`, member.token);
    assert.equal(read.status, 200);
    assert.deepEqual([read.body.title, read.body.status, read.body.joined, read.body.createdBy.name], ['November', 'active', false, 'Owner 1']);
    assert.equal((await call('GET', `/gyms/${gym.id}/challenges/missing`, member.token)).status, 404);
  });
});
