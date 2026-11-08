import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ClassSession } from '@gymverse/shared';
import { Classes } from './Classes';
import { apiError, installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { renderUi } from '../test/render';

const yoga: ClassSession = {
  id: 'c1',
  title: 'Sunrise Yoga',
  trainerName: 'Coach Vikram',
  startsAt: '2026-11-20T01:00:00.000Z',
  durationMin: 60,
  capacity: 10,
  bookedCount: 10,
  waitlistCount: 2,
  myStatus: null,
  myWaitlistPosition: null,
};

function setup(extra = {}) {
  const fake = installFakeApi({
    'GET /gyms/:gymId/classes': { classes: [yoga] },
    'POST /gyms/:gymId/classes': (req) => ({
      status: 201,
      body: { ...yoga, id: 'c2', bookedCount: 0, waitlistCount: 0, ...(req.body as object) },
    }),
    'DELETE /gyms/:gymId/classes/:id': { status: 204 },
    'GET /gyms/:gymId/classes/:id/attendees': {
      attendees: [
        { userId: 'u1', name: 'Ravi Kumar', phone: '+919999900002', status: 'booked' },
        { userId: 'u2', name: 'Anita Desai', phone: '+919999900100', status: 'waitlisted' },
      ],
    },
    ...extra,
  });
  return { ...renderUi(<Classes gym={makeGym()} />), fake };
}

describe('Classes', () => {
  it('lists sessions with booked/capacity and waitlist', async () => {
    const { fake } = setup();
    const row = await screen.findByTestId('class-row');
    expect(within(row).getByText('Sunrise Yoga')).toBeInTheDocument();
    expect(within(row).getByText('10/10 booked')).toBeInTheDocument();
    expect(within(row).getByText('2 waitlisted')).toBeInTheDocument();
    // 01:00Z is 6:30 am in Pune.
    expect(within(row).getByText(/6:30/)).toBeInTheDocument();
    expect(fake.callsTo('GET /gyms/:gymId/classes')[0].query.get('days')).toBe('30');
  });

  it('creates a class with an ISO startsAt in the gym time zone', async () => {
    const { user, fake } = setup();
    await screen.findByTestId('class-row');
    await user.click(screen.getByRole('button', { name: 'New class' }));
    const form = screen.getByRole('form', { name: 'Create class' });
    await user.type(within(form).getByLabelText('Title'), 'Evening HIIT');
    await user.type(within(form).getByLabelText('Trainer'), 'Coach Asha');
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-11-21' } });
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '18:30' } });
    await user.clear(within(form).getByLabelText('Duration (min)'));
    await user.type(within(form).getByLabelText('Duration (min)'), '45');
    await user.clear(within(form).getByLabelText('Capacity'));
    await user.type(within(form).getByLabelText('Capacity'), '15');
    await user.click(within(form).getByRole('button', { name: 'Create class' }));

    await waitFor(() => expect(fake.callsTo('POST /gyms/:gymId/classes')).toHaveLength(1));
    const body = fake.callsTo('POST /gyms/:gymId/classes')[0].body as Record<string, unknown>;
    expect(body).toEqual({
      title: 'Evening HIIT',
      trainerName: 'Coach Asha',
      startsAt: '2026-11-21T13:00:00.000Z',
      durationMin: 45,
      capacity: 15,
    });
    expect(String(body.startsAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await screen.findByText('Class created')).toBeInTheDocument();
  });

  it('shows the API error when creating fails', async () => {
    const { user } = setup({ 'POST /gyms/:gymId/classes': apiError(400, 'Must be at least 10', 'validation') });
    await screen.findByTestId('class-row');
    await user.click(screen.getByRole('button', { name: 'New class' }));
    const form = screen.getByRole('form', { name: 'Create class' });
    await user.type(within(form).getByLabelText('Title'), 'Quick one');
    await user.click(within(form).getByRole('button', { name: 'Create class' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Must be at least 10');
  });

  it('shows attendees', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Attendees' }));
    const list = await screen.findByRole('list', { name: 'Attendees for Sunrise Yoga' });
    expect(within(list).getByText('Ravi Kumar')).toBeInTheDocument();
    expect(within(list).getByText('waitlisted')).toBeInTheDocument();
  });

  it('marks attendance with one click and shows "x of y here"', async () => {
    const { user, fake } = setup({
      'GET /gyms/:gymId/classes/:id/attendees': {
        attendees: [
          { userId: 'u1', name: 'Ravi Kumar', phone: '+919999900002', status: 'booked', attended: true },
          { userId: 'u3', name: 'Meera Iyer', phone: '+919999900104', status: 'booked', attended: null },
          { userId: 'u2', name: 'Anita Desai', phone: '+919999900100', status: 'waitlisted', attended: null },
        ],
      },
      'PUT /gyms/:gymId/classes/:id/attendees/:userId': (req: { params: Record<string, string>; body: unknown }) => ({
        userId: req.params.userId,
        name: 'x',
        phone: 'x',
        status: 'booked',
        attended: (req.body as { attended: boolean }).attended,
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Attendees' }));
    expect(await screen.findByTestId('attendance-count')).toHaveTextContent('1 of 2 here');
    // Waitlisted people can't be marked.
    expect(screen.queryByRole('button', { name: 'Anita Desai attended' })).not.toBeInTheDocument();

    const meera = screen.getByRole('button', { name: 'Meera Iyer attended' });
    expect(meera).toHaveAttribute('aria-pressed', 'false');
    expect(meera).toHaveTextContent('Mark present');
    await user.click(meera);
    expect(meera).toHaveAttribute('aria-pressed', 'true');
    expect(meera).toHaveTextContent('Present');
    expect(screen.getByTestId('attendance-count')).toHaveTextContent('2 of 2 here');
    const put = fake.callsTo('PUT /gyms/:gymId/classes/:id/attendees/:userId');
    expect(put[0]).toMatchObject({ params: { id: 'c1', userId: 'u3' }, body: { attended: true } });

    await user.click(screen.getByRole('button', { name: 'Ravi Kumar attended' }));
    expect(screen.getByRole('button', { name: 'Ravi Kumar attended' })).toHaveTextContent('Absent');
    expect(fake.callsTo('PUT /gyms/:gymId/classes/:id/attendees/:userId')[1].body).toEqual({ attended: false });
    expect(screen.getByTestId('attendance-count')).toHaveTextContent('1 of 2 here');
  });

  it('rolls attendance back when saving fails', async () => {
    const { user } = setup({
      'PUT /gyms/:gymId/classes/:id/attendees/:userId': { status: 403, body: { error: 'forbidden', message: 'Only booked members can be marked.' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Attendees' }));
    const ravi = await screen.findByRole('button', { name: 'Ravi Kumar attended' });
    await user.click(ravi);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only booked members can be marked.');
    expect(ravi).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('attendance-count')).toHaveTextContent('0 of 1 here');
  });

  it('deletes a class after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByTestId('class-row')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/classes/:id')[0].params.id).toBe('c1');
  });

  it('does nothing when delete is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, fake } = setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(fake.callsTo('DELETE /gyms/:gymId/classes/:id')).toHaveLength(0);
    expect(screen.getByTestId('class-row')).toBeInTheDocument();
  });
});
