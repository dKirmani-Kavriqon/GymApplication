import { screen, within } from '@testing-library/react';
import { Overview } from './Overview';
import { apiError, installFakeApi } from '../test/fakeApi';
import { MEMBERS, makeGym, makeReport } from '../test/fixtures';
import { renderUi } from '../test/render';

describe('Overview', () => {
  it('shows stats, charts and members at risk; Nudge calls the API once', async () => {
    const fake = installFakeApi({
      'POST /gyms/:gymId/members/:userId/nudge': { status: 204 },
      'GET /gyms/:gymId/reports/attendance': makeReport(),
      'GET /gyms/:gymId/members': { members: MEMBERS },
    });
    const { user } = renderUi(<Overview gym={makeGym()} />);
    expect(await screen.findByTestId('stat-today')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-active')).toHaveTextContent('5 / 6');
    expect(await screen.findByText('Anita Desai')).toBeInTheDocument();
    expect(screen.getByTestId('stat-risk')).toHaveTextContent('1');
    expect(screen.getByText('7a')).toBeInTheDocument(); // busiest hour

    const daily = screen.getByRole('figure', { name: 'Check-ins in the last 14 days' });
    expect(within(daily).getAllByTestId('chart-bar')).toHaveLength(14);
    const hourly = screen.getByRole('figure', { name: 'Check-ins by hour of day' });
    expect(within(hourly).getAllByTestId('chart-bar')).toHaveLength(19); // 5am–11pm
    expect(within(hourly).getByLabelText('7a: 9')).toHaveStyle({ height: '100%' });

    await user.click(screen.getByRole('button', { name: 'Nudge Anita Desai' }));
    expect(await screen.findByText('Nudge sent to Anita Desai')).toBeInTheDocument();
    const call = fake.callsTo('POST /gyms/:gymId/members/:userId/nudge')[0];
    expect(call.params.userId).toBe('u-anita');
    expect(call.body).toEqual({ kind: 'inactive' });
    expect(screen.getByRole('button', { name: 'Nudged Anita Desai' })).toBeDisabled();
  });

  it('shows an empty state when nobody is at risk', async () => {
    installFakeApi({
      'GET /gyms/:gymId/reports/attendance': makeReport(),
      'GET /gyms/:gymId/members': { members: MEMBERS.filter((m) => !m.atRisk) },
    });
    renderUi(<Overview gym={makeGym()} />);
    expect(await screen.findByText(/Nobody at risk/)).toBeInTheDocument();
  });

  it('shows API errors', async () => {
    installFakeApi({
      'GET /gyms/:gymId/reports/attendance': apiError(403, 'You do not have access to this.', 'forbidden'),
      'GET /gyms/:gymId/members': { members: [] },
    });
    renderUi(<Overview gym={makeGym()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this.');
  });

  it('shows the API message when the member was already nudged today', async () => {
    installFakeApi({
      'GET /gyms/:gymId/reports/attendance': makeReport(),
      'GET /gyms/:gymId/members': { members: MEMBERS },
      'POST /gyms/:gymId/members/:userId/nudge': apiError(409, 'Anita was already nudged today.', 'already_nudged'),
    });
    const { user } = renderUi(<Overview gym={makeGym()} />);
    await user.click(await screen.findByRole('button', { name: 'Nudge Anita Desai' }));
    expect(await screen.findByText('Anita was already nudged today.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nudged Anita Desai' })).toBeDisabled();
  });

  it('keeps the button enabled after other errors', async () => {
    installFakeApi({
      'GET /gyms/:gymId/reports/attendance': makeReport(),
      'GET /gyms/:gymId/members': { members: MEMBERS },
      'POST /gyms/:gymId/members/:userId/nudge': apiError(500, 'Push service down'),
    });
    const { user } = renderUi(<Overview gym={makeGym()} />);
    await user.click(await screen.findByRole('button', { name: 'Nudge Anita Desai' }));
    expect(await screen.findByText('Push service down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nudge Anita Desai' })).toBeEnabled();
  });
});
