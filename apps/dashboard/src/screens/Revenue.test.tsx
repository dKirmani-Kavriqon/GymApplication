import { screen, within } from '@testing-library/react';
import { Revenue, monthChange } from './Revenue';
import { Overview } from './Overview';
import { apiError, installFakeApi } from '../test/fakeApi';
import { MEMBERS, makeGym, makeReport } from '../test/fixtures';
import { makeRevenue } from '../test/fixtures3';
import { renderUi } from '../test/render';

describe('monthChange', () => {
  it('describes the change vs last month', () => {
    expect(monthChange(1200, 1000)).toEqual({ text: '+20% vs last month', tone: 'up' });
    expect(monthChange(900, 1000)).toEqual({ text: '−10% vs last month', tone: 'down' });
    expect(monthChange(500, 0)).toEqual({ text: 'New this month', tone: 'up' });
    expect(monthChange(0, 0)).toEqual({ text: 'No payments yet', tone: 'flat' });
  });
});

describe('Revenue', () => {
  it('shows this month vs last, unpaid members, coupon discounts, daily chart and by-plan table', async () => {
    installFakeApi({ 'GET /gyms/:gymId/reports/revenue': makeRevenue() });
    renderUi(<Revenue gym={makeGym()} />);
    expect(await screen.findByTestId('rev-this-month')).toHaveTextContent('₹12,000');
    expect(screen.getByTestId('rev-last-month')).toHaveTextContent('₹10,000');
    expect(screen.getByText('+20% vs last month')).toBeInTheDocument();
    expect(screen.getByTestId('rev-unpaid')).toHaveTextContent('4');
    expect(screen.getByTestId('rev-coupons')).toHaveTextContent('₹450');

    const chart = screen.getByRole('figure', { name: 'Revenue in the last 30 days' });
    const bars = within(chart).getAllByTestId('chart-bar');
    expect(bars).toHaveLength(30);
    expect(bars[0]).toHaveStyle({ height: '100%' });

    const table = screen.getByRole('table', { name: 'Revenue by plan' });
    expect(within(table).getByText('Monthly')).toBeInTheDocument();
    expect(within(table).getByText('₹8,994')).toBeInTheDocument();
  });

  it('lists renewals due and "Remind" sends a renewal nudge', async () => {
    const fake = installFakeApi({
      'GET /gyms/:gymId/reports/revenue': makeRevenue(),
      'POST /gyms/:gymId/members/:userId/nudge': { status: 204 },
    });
    const { user } = renderUi(<Revenue gym={makeGym()} />);
    const renewal = await screen.findByTestId('renewal');
    expect(renewal).toHaveTextContent('Ravi Kumar');
    expect(renewal).toHaveTextContent('Monthly');
    await user.click(within(renewal).getByRole('button', { name: 'Remind Ravi Kumar' }));
    expect(await screen.findByText('Renewal reminder sent to Ravi Kumar')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/members/:userId/nudge')[0]).toMatchObject({ params: { userId: 'u-ravi' }, body: { kind: 'renewal' } });
    expect(within(renewal).getByRole('button', { name: 'Reminded Ravi Kumar' })).toBeDisabled();
  });

  it('"Remind" shows the API message on 409 already_nudged', async () => {
    installFakeApi({
      'GET /gyms/:gymId/reports/revenue': makeRevenue(),
      'POST /gyms/:gymId/members/:userId/nudge': apiError(409, 'Ravi already got a reminder today.', 'already_nudged'),
    });
    const { user } = renderUi(<Revenue gym={makeGym()} />);
    await user.click(await screen.findByRole('button', { name: 'Remind Ravi Kumar' }));
    expect(await screen.findByText('Ravi already got a reminder today.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reminded Ravi Kumar' })).toBeDisabled();
  });

  it('shows the API error', async () => {
    installFakeApi({ 'GET /gyms/:gymId/reports/revenue': apiError(403, 'Only managers and owners can do that.', 'forbidden') });
    renderUi(<Revenue gym={makeGym()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only managers and owners can do that.');
  });
});

describe('Overview revenue tile', () => {
  const routes = {
    'GET /gyms/:gymId/reports/attendance': makeReport(),
    'GET /gyms/:gymId/members': { members: MEMBERS },
    'GET /gyms/:gymId/reports/revenue': makeRevenue(),
  };

  it('admins see collected this month and can jump to Revenue', async () => {
    const open = vi.fn();
    const fake = installFakeApi(routes);
    const { user } = renderUi(<Overview gym={makeGym()} showRevenue onOpenRevenue={open} />);
    const tile = await screen.findByTestId('revenue-tile');
    expect(tile).toHaveTextContent('₹12,000');
    expect(tile).toHaveTextContent('+20% vs last month');
    expect(tile).toHaveTextContent('1 renewal due this week');
    await user.click(within(tile).getByRole('button', { name: 'Open revenue' }));
    expect(open).toHaveBeenCalled();
    expect(fake.callsTo('GET /gyms/:gymId/reports/revenue')).toHaveLength(1);
  });

  it('is not fetched for trainers', async () => {
    const fake = installFakeApi(routes);
    renderUi(<Overview gym={makeGym()} />);
    await screen.findByTestId('stat-today');
    expect(screen.queryByTestId('revenue-tile')).not.toBeInTheDocument();
    expect(fake.callsTo('GET /gyms/:gymId/reports/revenue')).toHaveLength(0);
  });
});
