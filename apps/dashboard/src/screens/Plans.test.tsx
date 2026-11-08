import { screen, waitFor, within } from '@testing-library/react';
import type { Announcement } from '@gymverse/shared';
import { Plans, parseBenefits } from './Plans';
import { Announcements, sortAnnouncements } from './Announcements';
import { apiError, installFakeApi } from '../test/fakeApi';
import { PLANS, makeGym } from '../test/fixtures';
import { renderUi } from '../test/render';

describe('parseBenefits', () => {
  it('splits lines, trims and drops blanks', () => {
    expect(parseBenefits(' Full gym access \r\n\nLocker\n  ')).toEqual(['Full gym access', 'Locker']);
    expect(parseBenefits('')).toEqual([]);
  });
});

describe('Plans', () => {
  it('lists plans with formatted INR prices', async () => {
    installFakeApi({ 'GET /gyms/:gymId/plans': { plans: PLANS } });
    renderUi(<Plans gym={makeGym()} role="owner" />);
    const cards = await screen.findAllByTestId('plan-card');
    expect(within(cards[0]).getByText('₹1,499')).toBeInTheDocument();
    expect(within(cards[0]).getByText('30 days')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Locker')).toBeInTheDocument();
    expect(within(cards[1]).getByText('₹12,999')).toBeInTheDocument();
  });

  it('creates a plan with the price in paise', async () => {
    const fake = installFakeApi({
      'GET /gyms/:gymId/plans': { plans: PLANS },
      'POST /gyms/:gymId/plans': (req) => ({ status: 201, body: { id: 'p9', ...(req.body as object) } }),
    });
    const { user } = renderUi(<Plans gym={makeGym()} role="manager" />);
    await screen.findAllByTestId('plan-card');
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    const form = screen.getByRole('form', { name: 'Create plan' });
    await user.type(within(form).getByLabelText('Plan name'), 'Student');
    await user.clear(within(form).getByLabelText('Duration (days)'));
    await user.type(within(form).getByLabelText('Duration (days)'), '60');
    await user.type(within(form).getByLabelText('Price (₹)'), '2,499.50');
    await user.type(within(form).getByLabelText('Benefits (one per line)'), 'Gym access{Enter}{Enter}Locker');
    await user.click(within(form).getByRole('button', { name: 'Create plan' }));
    await screen.findByText('Plan created');
    expect(fake.callsTo('POST /gyms/:gymId/plans')[0].body).toEqual({
      name: 'Student',
      durationDays: 60,
      pricePaise: 249950,
      benefits: ['Gym access', 'Locker'],
    });
    expect(screen.getByText('₹2,499.50')).toBeInTheDocument();
  });

  it('rejects a bad price before calling the API', async () => {
    const fake = installFakeApi({ 'GET /gyms/:gymId/plans': { plans: [] } });
    const { user } = renderUi(<Plans gym={makeGym()} role="owner" />);
    await screen.findByText(/No plans yet/);
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    await user.type(screen.getByLabelText('Plan name'), 'Odd');
    await user.type(screen.getByLabelText('Price (₹)'), 'free');
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a price in rupees');
    expect(fake.callsTo('POST /gyms/:gymId/plans')).toHaveLength(0);
  });

  it('archives a plan', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fake = installFakeApi({
      'GET /gyms/:gymId/plans': { plans: PLANS },
      'DELETE /gyms/:gymId/plans/:id': { status: 204 },
    });
    const { user } = renderUi(<Plans gym={makeGym()} role="owner" />);
    const [first] = await screen.findAllByTestId('plan-card');
    await user.click(within(first).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.getAllByTestId('plan-card')).toHaveLength(1));
    expect(fake.callsTo('DELETE /gyms/:gymId/plans/:id')[0].params.id).toBe('p1');
  });
});

describe('Announcements', () => {
  const list: Announcement[] = [
    { id: 'a1', title: 'Old news', body: 'Hello', pinned: false, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'a2', title: 'Diwali timings', body: 'Open 6–12', pinned: true, createdAt: '2026-09-01T00:00:00.000Z' },
  ];

  it('sorts pinned first, then newest', () => {
    const extra = { id: 'a3', title: 'New', body: 'x', pinned: false, createdAt: '2026-11-01T00:00:00.000Z' };
    expect(sortAnnouncements([...list, extra]).map((a) => a.id)).toEqual(['a2', 'a3', 'a1']);
  });

  it('lists and creates announcements', async () => {
    const fake = installFakeApi({
      'GET /gyms/:gymId/announcements': { announcements: list },
      'POST /gyms/:gymId/announcements': (req) => ({
        status: 201,
        body: { id: 'a9', createdAt: '2026-11-08T00:00:00.000Z', ...(req.body as object) },
      }),
    });
    const { user } = renderUi(<Announcements gym={makeGym()} role="owner" />);
    expect(await screen.findAllByTestId('announcement')).toHaveLength(2);
    expect(screen.getByText('Pinned')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Title'), 'Pool closed');
    await user.type(screen.getByLabelText('Message'), 'Maintenance on Sunday.');
    await user.click(screen.getByLabelText('Pin to top'));
    await user.click(screen.getByRole('button', { name: 'Post announcement' }));
    await screen.findByText('Announcement posted');
    expect(fake.callsTo('POST /gyms/:gymId/announcements')[0].body).toEqual({
      title: 'Pool closed',
      body: 'Maintenance on Sunday.',
      pinned: true,
    });
    const titles = screen.getAllByTestId('announcement').map((el) => within(el).getByRole('heading').textContent);
    expect(titles[0]).toContain('Pool closed');
    expect(screen.getByLabelText('Title')).toHaveValue('');
  });

  it('shows the API error message', async () => {
    installFakeApi({
      'GET /gyms/:gymId/announcements': { announcements: [] },
      'POST /gyms/:gymId/announcements': apiError(403, 'Your gym has not switched this feature on.', 'feature_disabled'),
    });
    const { user } = renderUi(<Announcements gym={makeGym()} role="manager" />);
    await screen.findByText('No announcements yet.');
    await user.type(screen.getByLabelText('Title'), 'Hi there');
    await user.type(screen.getByLabelText('Message'), 'Body');
    await user.click(screen.getByRole('button', { name: 'Post announcement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your gym has not switched this feature on.');
  });
});
