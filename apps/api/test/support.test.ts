import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers';

const info = {
  phone: '+91 20 4000 4242',
  whatsapp: '+91 99999 00001',
  email: 'hello@gym.example',
  address: 'Koregaon Park, Pune',
  hours: 'Mon-Sat 6am-10pm',
  faqs: [{ q: 'Can I freeze my plan?', a: 'Yes, once for 15 days.' }],
};

describe('help & support info', () => {
  it('is empty until an admin sets it', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const empty = await call('GET', `/gyms/${gym.id}/support`, member.token);
    assert.deepEqual(empty.body, { phone: null, whatsapp: null, email: null, address: null, hours: null, faqs: [] });

    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('PUT', `/gyms/${gym.id}/support`, member.token, info)).status, 403);
    assert.equal((await call('PUT', `/gyms/${gym.id}/support`, trainer.token, info)).status, 403);
    assert.equal((await call('PUT', `/gyms/${gym.id}/support`, owner.token, { ...info, email: 'not-an-email' })).status, 400);
    assert.equal((await call('PUT', `/gyms/${gym.id}/support`, owner.token, { ...info, faqs: [{ q: '?', a: '' }] })).status, 400);

    const put = await call('PUT', `/gyms/${gym.id}/support`, owner.token, info);
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, info);
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/support`, member.token)).body, info);
    const cleared = await call('PUT', `/gyms/${gym.id}/support`, owner.token, { email: '' });
    assert.deepEqual(cleared.body, { phone: null, whatsapp: null, email: null, address: null, hours: null, faqs: [] });
  });

  it('is blocked when support is switched off', async () => {
    const { call, gymWithMember, disableFeatures } = setup();
    const { owner, member, gym } = await gymWithMember();
    await disableFeatures(gym, owner.token, ['support']);
    for (const url of [`/gyms/${gym.id}/support`, `/gyms/${gym.id}/support/tickets`]) {
      const res = await call('GET', url, member.token);
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'feature_disabled');
    }
  });
});

describe('support tickets', () => {
  it('members open tickets; staff reply (answered + notification); member replies reopen', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Coach', 'trainer');
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');

    const t = await call('POST', `/gyms/${gym.id}/support/tickets`, member.token, { subject: 'Locker broken', message: 'Locker 12 will not lock.' });
    assert.equal(t.status, 201);
    assert.equal(t.body.status, 'open');
    assert.deepEqual(t.body.member, { id: member.userId, name: 'Member 1' });
    assert.deepEqual(t.body.messages.map((m: any) => [m.from, m.body]), [['member', 'Locker 12 will not lock.']]);
    assert.equal((await call('POST', `/gyms/${gym.id}/support/tickets`, member.token, { subject: 'x', message: '' })).status, 400);

    assert.equal((await call('GET', `/gyms/${gym.id}/support/tickets/${t.body.id}`, other.token)).status, 404);
    assert.equal((await call('POST', `/gyms/${gym.id}/support/tickets/${t.body.id}/messages`, other.token, { body: 'hi' })).status, 404);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/support/tickets/${t.body.id}`, other.token, { status: 'closed' })).status, 404);
    assert.equal((await call('GET', `/gyms/${gym.id}/support/tickets`, other.token)).body.tickets.length, 0);

    clock.advance(60_000);
    const reply = await call('POST', `/gyms/${gym.id}/support/tickets/${t.body.id}/messages`, trainer.token, { body: 'Fixed it, try again.' });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.status, 'answered');
    assert.deepEqual(reply.body.messages.map((m: any) => [m.from, m.author.name]), [
      ['member', 'Member 1'],
      ['staff', 'Coach'],
    ]);
    assert.ok(reply.body.updatedAt > reply.body.createdAt);
    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.equal(notes[0].kind, 'support_reply');
    assert.equal(notes[0].link, `ticket:${t.body.id}`);

    const again = await call('POST', `/gyms/${gym.id}/support/tickets/${t.body.id}/messages`, member.token, { body: 'Still stuck' });
    assert.equal(again.body.status, 'open');
    assert.equal((await call('POST', `/gyms/${gym.id}/support/tickets/${t.body.id}/messages`, member.token, { body: '' })).status, 400);

    const closed = await call('PATCH', `/gyms/${gym.id}/support/tickets/${t.body.id}`, member.token, { status: 'closed' });
    assert.equal(closed.body.status, 'closed');
    assert.equal((await call('PATCH', `/gyms/${gym.id}/support/tickets/${t.body.id}`, owner.token, { status: 'done' })).status, 400);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/support/tickets/${t.body.id}`, owner.token, { status: 'open' })).body.status, 'open');
  });

  it('members list their own tickets, staff list all, newest update first, with a status filter', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');
    const first = (await call('POST', `/gyms/${gym.id}/support/tickets`, member.token, { subject: 'First', message: 'a' })).body;
    clock.advance(60_000);
    await call('POST', `/gyms/${gym.id}/support/tickets`, other.token, { subject: 'Second', message: 'b' });
    clock.advance(60_000);
    await call('POST', `/gyms/${gym.id}/support/tickets/${first.id}/messages`, owner.token, { body: 'Answer' });

    assert.deepEqual((await call('GET', `/gyms/${gym.id}/support/tickets`, member.token)).body.tickets.map((t: any) => t.subject), ['First']);
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/support/tickets`, owner.token)).body.tickets.map((t: any) => t.subject), [
      'First',
      'Second',
    ]);
    assert.deepEqual(
      (await call('GET', `/gyms/${gym.id}/support/tickets?status=open`, owner.token)).body.tickets.map((t: any) => t.subject),
      ['Second'],
    );
    assert.equal((await call('GET', `/gyms/${gym.id}/support/tickets?status=lost`, owner.token)).status, 400);
  });
});
