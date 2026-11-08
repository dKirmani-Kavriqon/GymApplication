import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers';

describe('gym onboarding and branding', () => {
  it('creates a gym with the creator as owner and a 6-char join code', async () => {
    const { call, login } = setup();
    const owner = await login('+919000000001');
    const res = await call('POST', '/gyms', owner.token, { name: 'Iron Temple', city: 'Mumbai', primaryColor: '#e11d48' });
    assert.equal(res.status, 201);
    assert.match(res.body.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(res.body.branding.primaryColor, '#E11D48');
    assert.ok(res.body.enabledFeatures.includes('checkin'));
    const me = await call('GET', '/me', owner.token);
    assert.equal(me.body.memberships[0].role, 'owner');
  });

  it('shows a public branding preview for a join code', async () => {
    const { call, login } = setup();
    const owner = await login('+919000000001');
    const gym = (await call('POST', '/gyms', owner.token, { name: 'Iron Temple', city: 'Mumbai' })).body;
    const preview = await call('GET', `/gyms/preview/${gym.joinCode.toLowerCase()}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.name, 'Iron Temple');
    assert.equal(preview.body.id, undefined, 'preview must not leak the gym id');
    assert.equal((await call('GET', '/gyms/preview/ZZZZZZ')).status, 404);
  });

  it('lets a member join by code, idempotently', async () => {
    const { call, login } = setup();
    const owner = await login('+919000000001');
    const gym = (await call('POST', '/gyms', owner.token, { name: 'Iron Temple', city: 'Mumbai' })).body;
    const member = await login('+919111111111');
    const j1 = await call('POST', '/gyms/join', member.token, { code: gym.joinCode });
    assert.equal(j1.body.role, 'member');
    assert.equal(j1.body.alreadyMember, false);
    const j2 = await call('POST', '/gyms/join', member.token, { code: gym.joinCode });
    assert.equal(j2.body.alreadyMember, true);
    const me = await call('GET', '/me', member.token);
    assert.equal(me.body.memberships.length, 1);
    assert.equal(me.body.memberships[0].gym.name, 'Iron Temple');
  });

  it('supports belonging to several gyms', async () => {
    const { call, gymWithMember, login } = setup();
    const a = await gymWithMember('1');
    const b = await gymWithMember('2');
    await call('POST', '/gyms/join', a.member.token, { code: b.gym.joinCode });
    const me = await call('GET', '/me', a.member.token);
    assert.deepEqual(me.body.memberships.map((m: any) => m.gym.name).sort(), ['Gym 1', 'Gym 2']);
    void login;
  });

  it('owner updates branding and gets contrast warnings for unreadable colours', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const body = {
      gymName: 'Sunshine Yoga',
      tagline: 'Breathe',
      primaryColor: '#FFE600',
      accentColor: '#0EA5E9',
      themePreference: 'light',
      enabledFeatures: ['checkin', 'classes', 'announcements'],
    };
    const res = await call('PATCH', `/gyms/${gym.id}/branding`, owner.token, body);
    assert.equal(res.status, 200);
    assert.equal(res.body.gym.name, 'Sunshine Yoga');
    assert.deepEqual(res.body.gym.enabledFeatures, ['checkin', 'classes', 'announcements']);
    assert.ok(res.body.contrastIssues.some((i: any) => i.field === 'primary' && i.against === 'light'));

    const asMember = await call('PATCH', `/gyms/${gym.id}/branding`, member.token, body);
    assert.equal(asMember.status, 403);
    const badColour = await call('PATCH', `/gyms/${gym.id}/branding`, owner.token, { ...body, primaryColor: 'red' });
    assert.equal(badColour.status, 400);
  });

  it('blocks disabled features', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    await call('PATCH', `/gyms/${gym.id}/branding`, owner.token, {
      gymName: 'Yoga Only',
      primaryColor: '#4F46E5',
      accentColor: '#F59E0B',
      themePreference: 'auto',
      enabledFeatures: ['classes'],
    });
    const res = await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'feature_disabled');
  });
});

describe('staff tools', () => {
  it('imports members from a spreadsheet, skipping existing ones', async () => {
    const { call, gymWithMember, login } = setup();
    const { owner, member, gym } = await gymWithMember();
    const res = await call('POST', `/gyms/${gym.id}/members/import`, owner.token, {
      rows: [
        { phone: '+91 98200 00001', name: 'Asha' },
        { phone: '+919820000002', name: 'Bilal' },
        { phone: '+919111111111' }, // the existing member
      ],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { created: 2, added: 2, skipped: 1 });
    // The imported person sees their gym immediately after first login.
    const asha = await login('+919820000001');
    const me = await call('GET', '/me', asha.token);
    assert.equal(me.body.user.name, 'Asha');
    assert.equal(me.body.memberships[0].gym.id, gym.id);
    assert.equal((await call('POST', `/gyms/${gym.id}/members/import`, member.token, { rows: [{ phone: '+919820000003' }] })).status, 403);
  });

  it('only owners change roles and the last owner cannot be demoted', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const promote = await call('PATCH', `/gyms/${gym.id}/members/${member.userId}`, owner.token, { role: 'trainer' });
    assert.equal(promote.status, 200);
    const trainerList = await call('GET', `/gyms/${gym.id}/members`, member.token);
    assert.equal(trainerList.status, 200, 'trainers can see members');
    const byTrainer = await call('PATCH', `/gyms/${gym.id}/members/${owner.userId}`, member.token, { role: 'member' });
    assert.equal(byTrainer.status, 403);
    const demoteSelf = await call('PATCH', `/gyms/${gym.id}/members/${owner.userId}`, owner.token, { role: 'member' });
    assert.equal(demoteSelf.status, 409);
  });

  it('deactivates a member, who then loses access', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    assert.equal((await call('DELETE', `/gyms/${gym.id}/members/${member.userId}`, owner.token)).status, 204);
    assert.equal((await call('GET', `/gyms/${gym.id}`, member.token)).status, 404);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/members/${owner.userId}`, owner.token)).status, 409);
  });

  it('a deactivated staff member who rejoins comes back as a plain member', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    await call('PATCH', `/gyms/${gym.id}/members/${member.userId}`, owner.token, { role: 'manager' });
    await call('DELETE', `/gyms/${gym.id}/members/${member.userId}`, owner.token);
    const rejoin = await call('POST', '/gyms/join', member.token, { code: gym.joinCode });
    assert.equal(rejoin.body.role, 'member');
    const me = await call('GET', '/me', member.token);
    assert.equal(me.body.memberships[0].role, 'member');
    assert.equal((await call('GET', `/gyms/${gym.id}/members`, member.token)).status, 403);

    // Same via CSV import.
    await call('PATCH', `/gyms/${gym.id}/members/${member.userId}`, owner.token, { role: 'trainer' });
    await call('DELETE', `/gyms/${gym.id}/members/${member.userId}`, owner.token);
    await call('POST', `/gyms/${gym.id}/members/import`, owner.token, { rows: [{ phone: '+919111111111' }] });
    assert.equal((await call('GET', '/me', member.token)).body.memberships[0].role, 'member');
  });

  it('posts announcements that members see, pinned first', async () => {
    const { call, gymWithMember, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: 'Holiday timings', body: 'Closed Sunday', pinned: true });
    clock.advance(60_000);
    await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: 'New bikes', body: 'Spin bikes arrived' });
    const list = await call('GET', `/gyms/${gym.id}/announcements`, member.token);
    assert.deepEqual(list.body.announcements.map((a: any) => a.title), ['Holiday timings', 'New bikes']);
    assert.equal((await call('POST', `/gyms/${gym.id}/announcements`, member.token, { title: 'Hi', body: 'x' })).status, 403);
  });
});
