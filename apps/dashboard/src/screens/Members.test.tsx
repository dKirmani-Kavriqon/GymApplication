import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@gymverse/shared';
import { Members, filterMembers } from './Members';
import { apiError, installFakeApi } from '../test/fakeApi';
import { MEMBERS, makeGym } from '../test/fixtures';
import { WORKOUTS, makeRoutine } from '../test/fixtures2';
import { renderUi } from '../test/render';

function setup(role: Role = 'owner', extra = {}) {
  const fake = installFakeApi({
    'GET /gyms/:gymId/members': { members: MEMBERS },
    'POST /gyms/:gymId/members/import': { created: 1, added: 2, skipped: 0 },
    'PATCH /gyms/:gymId/members/:userId': (req) => ({ userId: req.params.userId, role: (req.body as { role: string }).role }),
    'DELETE /gyms/:gymId/members/:userId': { status: 204 },
    ...extra,
  });
  const utils = renderUi(<Members gym={makeGym()} role={role} myUserId="u-owner" />);
  return { ...utils, fake };
}

const rowFor = (name: string) => screen.getByText(name).closest('tr')!;

describe('filterMembers', () => {
  it('matches name case-insensitively and phone digits', () => {
    expect(filterMembers(MEMBERS, 'ANITA').map((m) => m.name)).toEqual(['Anita Desai']);
    expect(filterMembers(MEMBERS, '900002').map((m) => m.name)).toEqual(['Ravi Kumar']);
    expect(filterMembers(MEMBERS, '  ')).toHaveLength(MEMBERS.length);
    expect(filterMembers(MEMBERS, 'zzz')).toHaveLength(0);
  });
});

describe('Members', () => {
  it('renders the table with at-risk badge, last visit, check-ins and membership', async () => {
    setup();
    await screen.findByText('Anita Desai');
    expect(screen.getAllByTestId('member-row')).toHaveLength(4);
    const anita = rowFor('Anita Desai');
    expect(within(anita).getByText('At risk')).toBeInTheDocument();
    expect(within(anita).getByText('Expired')).toBeInTheDocument();
    expect(within(anita).getByText('+919999900100')).toBeInTheDocument();
    const ravi = rowFor('Ravi Kumar');
    expect(within(ravi).queryByText('At risk')).not.toBeInTheDocument();
    expect(within(ravi).getByText('12')).toBeInTheDocument();
    expect(within(ravi).getByText('Active · 20d left')).toBeInTheDocument();
    expect(within(rowFor('Priya Sharma')).getByText('Never')).toBeInTheDocument();
    expect(screen.getByText(/1 at risk/)).toBeInTheDocument();
  });

  it('search filters rows', async () => {
    const { user } = setup();
    await screen.findByText('Anita Desai');
    await user.type(screen.getByLabelText('Search members'), 'ravi');
    expect(screen.getAllByTestId('member-row')).toHaveLength(1);
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search members'));
    await user.type(screen.getByLabelText('Search members'), '0003');
    expect(screen.getAllByTestId('member-row')).toHaveLength(1);
    expect(screen.getByText('Coach Vikram')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search members'));
    await user.type(screen.getByLabelText('Search members'), 'nobody');
    expect(screen.getByText('No members match your search.')).toBeInTheDocument();
  });

  it('owner changes a role', async () => {
    const { user, fake } = setup('owner');
    await screen.findByText('Ravi Kumar');
    await user.selectOptions(screen.getByLabelText('Role for Ravi Kumar'), 'trainer');
    await waitFor(() => expect(fake.callsTo('PATCH /gyms/:gymId/members/:userId')).toHaveLength(1));
    const call = fake.callsTo('PATCH /gyms/:gymId/members/:userId')[0];
    expect(call.params.userId).toBe('u-ravi');
    expect(call.body).toEqual({ role: 'trainer' });
    expect(await screen.findByText('Ravi Kumar is now trainer')).toBeInTheDocument();
    expect(screen.getByLabelText('Role for Ravi Kumar')).toHaveValue('trainer');
  });

  it('shows the API message when a role change fails', async () => {
    const { user } = setup('owner', {
      'PATCH /gyms/:gymId/members/:userId': apiError(409, 'A gym needs at least one owner.', 'last_owner'),
    });
    await screen.findByText('Ravi Kumar');
    await user.selectOptions(screen.getByLabelText('Role for Ravi Kumar'), 'manager');
    expect(await screen.findByRole('alert')).toHaveTextContent('A gym needs at least one owner.');
  });

  it('admin deactivates a member after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup('manager');
    await screen.findByText('Ravi Kumar');
    // Owners can't be removed, and the current user can't remove themselves.
    expect(within(rowFor('Priya Sharma')).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    await user.click(within(rowFor('Ravi Kumar')).getByRole('button', { name: 'Deactivate' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/members/:userId')[0].params.userId).toBe('u-ravi');
  });

  it('imports pasted CSV rows and shows the result', async () => {
    const { user, fake } = setup('owner');
    await screen.findByText('Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Import CSV' }));
    fireEvent.change(screen.getByLabelText('CSV rows'), {
      target: { value: 'phone,name\n\n9876543210,"Rao, Kiran"\n+919812345678,Asha\nbad,Row\n' },
    });
    const preview = screen.getByTestId('csv-preview');
    expect(preview).toHaveTextContent('2 rows ready');
    expect(preview).toHaveTextContent('header detected');
    expect(preview).toHaveTextContent('Line 5: "bad" is not a valid phone number');

    await user.click(screen.getByRole('button', { name: 'Import 2 members' }));
    expect(await screen.findByTestId('import-result')).toHaveTextContent(
      'Import done: 1 new accounts created, 2 added to the gym, 0 skipped',
    );
    expect(fake.callsTo('POST /gyms/:gymId/members/import')[0].body).toEqual({
      rows: [
        { phone: '+919876543210', name: 'Rao, Kiran' },
        { phone: '+919812345678', name: 'Asha' },
      ],
    });
    // The member list is refreshed after an import.
    await waitFor(() => expect(fake.callsTo('GET /gyms/:gymId/members')).toHaveLength(2));
  });

  it('reads an uploaded CSV file', async () => {
    const { user } = setup('owner');
    await screen.findByText('Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Import CSV' }));
    const file = new File(['9876543210,Asha\n9812345678,Kiran\n9800000000,Sam\n'], 'members.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('CSV file'), file);
    expect(await screen.findByText('3 rows ready')).toBeInTheDocument();
    expect(screen.getByLabelText('CSV rows')).toHaveValue('9876543210,Asha\n9812345678,Kiran\n9800000000,Sam\n');
  });

  it('shows the API error when the import fails', async () => {
    const { user } = setup('owner', {
      'POST /gyms/:gymId/members/import': apiError(400, 'Enter a valid phone number', 'validation'),
    });
    await screen.findByText('Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Import CSV' }));
    fireEvent.change(screen.getByLabelText('CSV rows'), { target: { value: '9876543210' } });
    await user.click(screen.getByRole('button', { name: 'Import 1 member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid phone number');
  });

  it('shows the load error message', async () => {
    installFakeApi({ 'GET /gyms/:gymId/members': apiError(403, 'You do not have access to this.', 'forbidden') });
    renderUi(<Members gym={makeGym()} role="trainer" myUserId="x" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this.');
  });
});

describe('Members: workout history', () => {
  it('opens a member\'s logged workouts and assigned routines', async () => {
    const fake = installFakeApi({
      'GET /gyms/:gymId/members': { members: MEMBERS },
      'GET /gyms/:gymId/members/:userId/workouts': {
        workouts: WORKOUTS,
        assigned: [
          makeRoutine({
            assignment: { by: { id: 'u-vikram', name: 'Coach Vikram' }, note: 'Twice a week', at: '2026-11-05T10:00:00.000Z' },
          }),
        ],
      },
    });
    const { user } = renderUi(<Members gym={makeGym()} role="trainer" myUserId="u-vikram" showWorkouts />);
    await screen.findByText('Ravi Kumar');
    // Trainers get the Workouts action but no admin actions.
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Workouts for Ravi Kumar' }));

    const dialog = screen.getByRole('dialog', { name: 'Workouts · Ravi Kumar' });
    const log = await within(dialog).findByTestId('workout-log');
    expect(fake.callsTo('GET /gyms/:gymId/members/:userId/workouts')[0].params.userId).toBe('u-ravi');
    expect(within(log).getByText('Beginner full body')).toBeInTheDocument();
    expect(within(log).getByText('760 kg')).toBeInTheDocument();
    expect(within(log).getByText('10 × 40 kg, 8 × 45 kg')).toBeInTheDocument();
    expect(within(log).getByText('Plank')).toBeInTheDocument();
    expect(within(log).getByText(/40 min · 3 sets/)).toBeInTheDocument();
    expect(within(log).getByText('Note: Felt strong')).toBeInTheDocument();
    const assigned = within(dialog).getByTestId('assigned-routine');
    expect(assigned).toHaveTextContent('by Coach Vikram');
    expect(assigned).toHaveTextContent('“Twice a week”');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an empty history', async () => {
    installFakeApi({
      'GET /gyms/:gymId/members': { members: MEMBERS },
      'GET /gyms/:gymId/members/:userId/workouts': { workouts: [], assigned: [] },
    });
    const { user } = renderUi(<Members gym={makeGym()} role="owner" myUserId="u-owner" showWorkouts />);
    await screen.findByText('Anita Desai');
    await user.click(screen.getByRole('button', { name: 'Workouts for Anita Desai' }));
    expect(await screen.findByText("Anita Desai hasn't logged a workout yet.")).toBeInTheDocument();
    expect(screen.getByText(/No routines assigned yet/)).toBeInTheDocument();
  });

  it('has no Workouts action when the feature is off', async () => {
    setup('owner');
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByRole('button', { name: /Workouts for/ })).not.toBeInTheDocument();
  });
});
