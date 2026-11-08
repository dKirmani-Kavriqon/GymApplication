import { screen, within } from '@testing-library/react';
import type { FreezeRequest } from '@gymverse/shared';
import { Members } from './Members';
import { installFakeApi } from '../test/fakeApi';
import { MEMBERS, makeGym } from '../test/fixtures';
import { makeFreeze } from '../test/fixtures3';
import { renderUi } from '../test/render';

function setup(onChanged = vi.fn()) {
  const all: FreezeRequest[] = [
    makeFreeze({ newEndsAt: '2026-12-12T00:00:00.000Z' }),
    makeFreeze({ id: 'fr-2', member: { id: 'u-anita', name: 'Anita Desai' }, days: 5, startsOn: '2026-11-20', endsOn: '2026-11-24', reason: 'Knee surgery' }),
    makeFreeze({ id: 'fr-3', status: 'approved', note: 'Get well soon', decidedAt: '2026-11-02T10:00:00.000Z' }),
  ];
  const fake = installFakeApi({
    'GET /gyms/:gymId/members': { members: MEMBERS },
    'GET /gyms/:gymId/freeze-requests': (req) => ({
      requests: all.filter((r) => !req.query.get('status') || r.status === req.query.get('status')),
    }),
    'PATCH /gyms/:gymId/freeze-requests/:id': (req) => {
      const body = req.body as { status: FreezeRequest['status']; note: string | null };
      const r = all.find((x) => x.id === req.params.id)!;
      return { ...r, ...body, decidedAt: '2026-11-08T10:00:00.000Z', newEndsAt: body.status === 'approved' ? '2026-12-12T00:00:00.000Z' : null };
    },
  });
  const utils = renderUi(<Members gym={makeGym()} role="owner" myUserId="u-owner" pendingFreezes={2} onFreezesChanged={onChanged} />);
  return { ...utils, fake, onChanged };
}

describe('Members: pause (freeze) requests', () => {
  it('shows a pending count on the tab and lists pending requests with days', async () => {
    const { user, fake } = setup();
    const tab = screen.getByRole('tab', { name: /Pause requests/ });
    expect(within(tab).getByText('2')).toBeInTheDocument();
    await user.click(tab);
    const items = await screen.findAllByTestId('freeze-request');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Ravi Kumar');
    expect(items[0]).toHaveTextContent('14 days');
    expect(items[0]).toHaveTextContent('Travelling for work');
    expect(items[0]).toHaveTextContent('If approved, membership ends 12 Dec 2026');
    expect(items[1]).not.toHaveTextContent('If approved');
    expect(fake.callsTo('GET /gyms/:gymId/freeze-requests')[0].query.get('status')).toBe('pending');
  });

  it('approves with a note and shows the new end date', async () => {
    const { user, fake, onChanged } = setup();
    await user.click(screen.getByRole('tab', { name: /Pause requests/ }));
    const [ravi] = await screen.findAllByTestId('freeze-request');
    await user.click(within(ravi).getByRole('button', { name: 'Approve' }));
    const form = within(ravi).getByRole('form', { name: 'Approve pause' });
    expect(form).toHaveTextContent("Approving adds 14 days to Ravi Kumar's membership.");
    await user.type(within(form).getByLabelText('Note to the member (optional)'), ' Enjoy the trip! ');
    await user.click(within(form).getByRole('button', { name: 'Confirm approval' }));

    expect(await screen.findByText('Pause approved for Ravi Kumar')).toBeInTheDocument();
    const call = fake.callsTo('PATCH /gyms/:gymId/freeze-requests/:id')[0];
    expect(call.params.id).toBe('fr-1');
    expect(call.body).toEqual({ status: 'approved', note: 'Enjoy the trip!' });
    expect(within(ravi).getByText('Approved')).toBeInTheDocument();
    expect(ravi).toHaveTextContent('Membership now ends 12 Dec 2026');
    expect(ravi).toHaveTextContent('Note: Enjoy the trip!');
    expect(within(ravi).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('rejects without a note (sends null)', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: /Pause requests/ }));
    const items = await screen.findAllByTestId('freeze-request');
    await user.click(within(items[1]).getByRole('button', { name: 'Reject' }));
    await user.click(within(items[1]).getByRole('button', { name: 'Confirm rejection' }));
    expect(await screen.findByText('Pause request rejected')).toBeInTheDocument();
    expect(fake.callsTo('PATCH /gyms/:gymId/freeze-requests/:id')[0]).toMatchObject({ params: { id: 'fr-2' }, body: { status: 'rejected', note: null } });
    expect(within(items[1]).getByText('Rejected')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: /Pause requests/ }));
    await screen.findAllByTestId('freeze-request');
    await user.click(screen.getByRole('tab', { name: 'Approved' }));
    expect(await screen.findByText('Note: Get well soon')).toBeInTheDocument();
    expect(screen.getAllByTestId('freeze-request')).toHaveLength(1);
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('Knee surgery', { exact: false });
    expect(screen.getAllByTestId('freeze-request')).toHaveLength(3);
    expect(fake.callsTo('GET /gyms/:gymId/freeze-requests').at(-1)!.query.get('status')).toBeNull();
  });

  it('trainers have no pause requests tab', async () => {
    installFakeApi({ 'GET /gyms/:gymId/members': { members: MEMBERS } });
    renderUi(<Members gym={makeGym()} role="trainer" myUserId="u-vikram" />);
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByRole('tab', { name: /Pause requests/ })).not.toBeInTheDocument();
  });
});
